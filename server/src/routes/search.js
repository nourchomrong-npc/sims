import { Router } from 'express';
import { apiRoutes } from './apiRoutes.js';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { requireRole } from '../middleware/auth.js';

const router = Router();
const academic = requireRole('Admin', 'SuperAdmin', 'School Manager', 'Teacher');

async function linkedTeacherId(req) {
  if (req.session.user.role !== 'Teacher') return null;
  const [[teacher]] = await pool.execute(
    "SELECT t.id FROM users u JOIN teachers t ON t.id = u.teacher_id AND t.employment_status = 'Active' AND t.is_deleted = 0 WHERE u.id = ? AND u.role = 'Teacher'",
    [req.session.user.internalId]
  );
  if (!teacher) throw Object.assign(new Error('This teacher account is not linked to an active teacher profile'), { status: 403 });
  return teacher.id;
}

function teacherAssignmentFilter(teacherId, classColumn, subjectColumn = null) {
  if (!teacherId) return { sql: '', params: [] };
  return {
    sql: ` AND EXISTS (SELECT 1 FROM teacher_assignments scoped_assignment
      WHERE scoped_assignment.teacher_id = ? AND scoped_assignment.class_id = ${classColumn}
        ${subjectColumn ? `AND scoped_assignment.subject_id = ${subjectColumn}` : ''}
        AND scoped_assignment.active = 1)`,
    params: [teacherId]
  };
}

router.get(apiRoutes.search, academic, async (req, res) => {
  const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
  const pattern = `%${q}%`;
  const teacherId = await linkedTeacherId(req);
  const studentScope = teacherAssignmentFilter(teacherId, 'e.class_id');
  const classScope = teacherAssignmentFilter(teacherId, 'c.id');
  const subjectScope = teacherAssignmentFilter(teacherId, 'ta.class_id', 'ta.subject_id');
  const scheduleScope = teacherAssignmentFilter(teacherId, 'schedule.class_id', 'schedule.subject_id');
  const scheduleTeacherScope = teacherId ? ' AND schedule.teacher_id = ?' : '';
  const attendanceScope = teacherAssignmentFilter(teacherId, 'ar.class_id', 'ar.subject_id');
  const assessmentScope = teacherAssignmentFilter(teacherId, 'a.class_id', 'a.subject_id');
  const queryRows = async (sql, params) => (await pool.execute(sql, params))[0];

  const [students, classes, subjects, schedules, attendance, results, teachers] = await Promise.all([
    queryRows(`
      SELECT s.public_id AS id, s.student_code, s.english_name, s.phone, s.email, s.status,
        c.name AS class_name, c.grade_level, 'Students' AS page, 'Student' AS category
      FROM students s
      LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1
      LEFT JOIN classes c ON c.id = e.class_id AND c.is_deleted = 0
      WHERE s.is_deleted = 0 AND s.status = 'Active'
        AND (s.student_code LIKE ? OR s.english_name LIKE ? OR COALESCE(s.khmer_name, '') LIKE ?
          OR COALESCE(s.phone, '') LIKE ? OR COALESCE(s.email, '') LIKE ? OR COALESCE(c.name, '') LIKE ?)
        ${studentScope.sql}
      ORDER BY s.english_name LIMIT 5
    `, [pattern, pattern, pattern, pattern, pattern, pattern, ...studentScope.params]),
    queryRows(`
      SELECT c.public_id AS id, c.name, c.grade_level, ay.name AS academic_year,
        (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
          WHERE e.class_id = c.id AND e.current = 1 AND s.status = 'Active' AND s.is_deleted = 0) AS student_count,
        'Classes' AS page, 'Class' AS category
      FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id
      WHERE c.is_deleted = 0 AND c.active = 1
        AND (c.name LIKE ? OR c.grade_level LIKE ? OR ay.name LIKE ?)
        ${classScope.sql}
      ORDER BY c.grade_level, c.name LIMIT 5
    `, [pattern, pattern, pattern, ...classScope.params]),
    queryRows(`
      SELECT DISTINCT sub.public_id AS id, sub.code, sub.name, sub.description,
        'Subjects' AS page, 'Subject' AS category
      FROM subjects sub
      LEFT JOIN teacher_assignments ta ON ta.subject_id = sub.id AND ta.active = 1
      WHERE sub.is_deleted = 0 AND sub.active = 1
        AND (sub.code LIKE ? OR sub.name LIKE ? OR COALESCE(sub.description, '') LIKE ?)
        ${subjectScope.sql}
      ORDER BY sub.name LIMIT 5
    `, [pattern, pattern, pattern, ...subjectScope.params]),
    queryRows(`
      SELECT schedule.public_id AS id, c.name AS class_name, c.grade_level, sub.name AS subject,
        teacher.full_name AS teacher_name, schedule.day_of_week, schedule.start_time, schedule.end_time,
        schedule.room, 'Class Schedule' AS page, 'Class schedule' AS category
      FROM class_schedules schedule
      JOIN classes c ON c.id = schedule.class_id AND c.is_deleted = 0
      JOIN subjects sub ON sub.id = schedule.subject_id AND sub.is_deleted = 0
      JOIN teachers teacher ON teacher.id = schedule.teacher_id AND teacher.is_deleted = 0
      WHERE schedule.is_deleted = 0 AND schedule.active = 1
        AND (c.name LIKE ? OR c.grade_level LIKE ? OR sub.name LIKE ? OR sub.code LIKE ?
          OR teacher.full_name LIKE ? OR COALESCE(schedule.room, '') LIKE ?)
        ${scheduleTeacherScope}
        ${scheduleScope.sql}
      ORDER BY c.grade_level, c.name, schedule.day_of_week, schedule.start_time LIMIT 5
    `, [pattern, pattern, pattern, pattern, pattern, pattern, ...(teacherId ? [teacherId] : []), ...scheduleScope.params]),
    queryRows(`
      SELECT ar.public_id AS id, ar.attendance_date, ar.status, s.student_code, s.english_name,
        c.name AS class_name, c.grade_level, sub.name AS subject, 'Attendance' AS page, 'Attendance' AS category
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id
      WHERE (s.student_code LIKE ? OR s.english_name LIKE ? OR c.name LIKE ? OR COALESCE(sub.name, '') LIKE ?
        OR ar.status LIKE ? OR CAST(ar.attendance_date AS TEXT) LIKE ?)
        ${attendanceScope.sql}
      ORDER BY ar.attendance_date DESC LIMIT 5
    `, [pattern, pattern, pattern, pattern, pattern, pattern, ...attendanceScope.params]),
    queryRows(`
      SELECT ss.public_id AS id, s.student_code, s.english_name, a.title AS assessment,
        sub.name AS subject, c.name AS class_name, t.name AS term_name, ss.score,
        a.maximum_score, ROUND(100 * ss.score / a.maximum_score, 1) AS percentage,
        'Academic Results' AS page, 'Academic result' AS category
      FROM student_scores ss
      JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0
      JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
      JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
      JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
      JOIN terms t ON t.id = a.term_id
      WHERE (s.student_code LIKE ? OR s.english_name LIKE ? OR a.title LIKE ? OR sub.name LIKE ?
        OR c.name LIKE ? OR t.name LIKE ?)
        ${assessmentScope.sql}
      ORDER BY a.assessment_date DESC, s.english_name LIMIT 5
    `, [pattern, pattern, pattern, pattern, pattern, pattern, ...assessmentScope.params]),
    teacherId ? Promise.resolve([]) : queryRows(`
      SELECT public_id AS id, teacher_code, full_name, email, phone, employment_status,
        'Teachers' AS page, 'Teacher' AS category
      FROM teachers
      WHERE is_deleted = 0
        AND (teacher_code LIKE ? OR full_name LIKE ? OR COALESCE(email, '') LIKE ? OR COALESCE(phone, '') LIKE ?)
      ORDER BY full_name LIMIT 5
    `, [pattern, pattern, pattern, pattern])
  ]);

  res.json({
    query: q,
    groups: [
      { category: 'Students', results: students },
      { category: 'Teachers', results: teachers },
      { category: 'Classes', results: classes },
      { category: 'Subjects', results: subjects },
      { category: 'Class Schedule', results: schedules },
      { category: 'Attendance', results: attendance },
      { category: 'Academic Results', results }
    ].filter(group => group.results.length)
  });
});

export default router;
