import { Router } from 'express';
import { apiRoutes } from './apiRoutes.js';
import { z } from 'zod';
import { pool } from '../config/db.js';
import { requireRole } from '../middleware/auth.js';
import { expensiveLimiter } from '../middleware/rateLimit.js';
import { publicizeRows, resolvePublicId } from '../utils/publicIds.js';
import { parse, publicId } from '../utils/validation.js';
import {
  buildDashboardAttendance,
  buildDashboardAttendanceLeaders,
  buildDashboardEnrollment,
  dashboardDateInPhnomPenh,
  dashboardMonthStart,
  dashboardShiftDate
} from '../utils/dashboard.js';

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


router.get(apiRoutes.dashboard, expensiveLimiter, academic, async (req, res) => {
  const filters = parse(z.object({
    period: z.enum(['1', '7', '30', '90', '180', '365', 'custom']).default('180'),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    class_id: publicId.optional(),
    grade_level: z.string().trim().min(1).max(30).optional(),
    academic_year_id: publicId.optional(),
    term_id: publicId.optional(),
    subject_id: publicId.optional()
  }).superRefine((value, context) => {
    if (value.period === 'custom' && (!value.from || !value.to)) {
      context.addIssue({ code: 'custom', path: ['from'], message: 'A start and end date are required for a custom range' });
    }
    if (value.period !== 'custom' && (value.from || value.to)) {
      context.addIssue({ code: 'custom', path: ['period'], message: 'Custom dates require the custom period option' });
    }
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'The end date must be on or after the start date' });
    }
  }), req.query);
  const today = dashboardDateInPhnomPenh();
  let startDate;
  let endDate = today;
  if (filters.period === 'custom') {
    startDate = filters.from;
    endDate = filters.to;
    const dayCount = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
    if (dayCount > 366) throw Object.assign(new Error('Custom dashboard ranges cannot exceed 366 days'), { status: 400 });
  } else if (filters.period === '180') {
    startDate = dashboardMonthStart(today, -5);
  } else if (filters.period === '365') {
    startDate = dashboardMonthStart(today, -11);
  } else {
    startDate = dashboardShiftDate(today, -(Number(filters.period) - 1));
  }

  const classId = filters.class_id ? await resolvePublicId(pool, 'classes', filters.class_id, 400) : null;
  const yearId = filters.academic_year_id ? await resolvePublicId(pool, 'academic_years', filters.academic_year_id, 400) : null;
  const termId = filters.term_id ? await resolvePublicId(pool, 'terms', filters.term_id, 400) : null;
  const subjectId = filters.subject_id ? await resolvePublicId(pool, 'subjects', filters.subject_id, 400) : null;
  const teacherId = await linkedTeacherId(req);

  function classFilters(alias) {
    return {
      sql: `${classId ? ` AND ${alias}.id = ?` : ''}${filters.grade_level ? ` AND ${alias}.grade_level = ?` : ''}${yearId ? ` AND ${alias}.academic_year_id = ?` : ''}`,
      params: [...(classId ? [classId] : []), ...(filters.grade_level ? [filters.grade_level] : []), ...(yearId ? [yearId] : [])]
    };
  }
  function attendanceFilters(classAlias = 'c', attendanceAlias = 'ar') {
    const scope = classFilters(classAlias);
    return {
      sql: `${scope.sql}${subjectId ? ` AND ${attendanceAlias}.subject_id = ?` : ''}${teacherId ? ` AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = ${attendanceAlias}.class_id AND ta.subject_id = ${attendanceAlias}.subject_id AND ta.teacher_id = ? AND ta.active = 1)` : ''}`,
      params: [...scope.params, ...(subjectId ? [subjectId] : []), ...(teacherId ? [teacherId] : [])]
    };
  }
  const studentScope = classFilters('c');
  const attendanceScope = attendanceFilters();
  const scoreScope = classFilters('c');
  const scoreSubjectScope = subjectId ? ' AND a.subject_id = ?' : '';
  const scoreTermScope = termId ? ' AND a.term_id = ?' : '';
  const scoreDateScope = teacherId
    ? ' AND a.assessment_date <= ?'
    : ' AND a.assessment_date BETWEEN ? AND ?';
  const scoreDateParams = teacherId ? [today] : [startDate, endDate];
  const scoreTeacherScope = teacherId
    ? ' AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = a.class_id AND ta.subject_id = a.subject_id AND ta.teacher_id = ? AND ta.active = 1)'
    : '';
  const enrollmentTeacherScope = teacherId
    ? ' AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = e.class_id AND ta.teacher_id = ? AND ta.active = 1)'
    : '';
  const enrollmentClassScope = classFilters('c');
  const intervalDays = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1;
  const attendanceInterval = intervalDays <= 31 ? 'day' : intervalDays <= 180 ? 'week' : 'month';

  const [
    [studentTotals], [teacherTotals], [classTotals], [subjectTotals], [periodAttendance], [overallPerformance],
    [attendanceRows], [scheduleWeekdays], [enrollmentRows], [lowAttendance], [attendanceLeaderRows], [performanceRows]
  ] = await Promise.all([
    pool.execute(`
      SELECT COUNT(DISTINCT s.id) AS students
      FROM students s
      JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1
      JOIN classes c ON c.id = e.class_id AND c.is_deleted = 0
      WHERE s.status = 'Active' AND s.is_deleted = 0 ${studentScope.sql}
        ${teacherId ? 'AND EXISTS (SELECT 1 FROM teacher_assignments scoped WHERE scoped.class_id = c.id AND scoped.teacher_id = ? AND scoped.active = 1)' : ''}
    `, [...studentScope.params, ...(teacherId ? [teacherId] : [])]),
    pool.execute(`
      SELECT COUNT(DISTINCT teacher.id) AS teachers FROM teachers teacher
      WHERE teacher.employment_status = 'Active' AND teacher.is_deleted = 0
        ${teacherId ? 'AND teacher.id = ?' : ''}
        ${classId || filters.grade_level || yearId ? `AND EXISTS (SELECT 1 FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id WHERE ta.teacher_id = teacher.id AND ta.active = 1${classFilters('c').sql})` : ''}
    `, [...(teacherId ? [teacherId] : []), ...(classId || filters.grade_level || yearId ? classFilters('c').params : [])]),
    pool.execute(`
      SELECT COUNT(*) AS classes FROM classes c
      WHERE c.active = 1 AND c.is_deleted = 0 ${classFilters('c').sql}
        ${teacherId ? 'AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = c.id AND ta.teacher_id = ? AND ta.active = 1)' : ''}
    `, [...classFilters('c').params, ...(teacherId ? [teacherId] : [])]),
    pool.execute(`
      SELECT COUNT(DISTINCT sub.id) AS subjects FROM subjects sub
      WHERE sub.active = 1 AND sub.is_deleted = 0
        ${subjectId ? 'AND sub.id = ?' : ''}
        ${teacherId || classId || filters.grade_level || yearId ? `AND EXISTS (SELECT 1 FROM teacher_assignments ta JOIN classes c ON c.id = ta.class_id WHERE ta.subject_id = sub.id AND ta.active = 1${classFilters('c').sql}${teacherId ? ' AND ta.teacher_id = ?' : ''})` : ''}
    `, [...(subjectId ? [subjectId] : []), ...(teacherId || classId || filters.grade_level || yearId ? [...classFilters('c').params, ...(teacherId ? [teacherId] : [])] : [])]),
    pool.execute(`
      SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present', 'Late')) / NULLIF(COUNT(*), 0), 1) AS attendance_rate
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
      WHERE ar.attendance_date BETWEEN ? AND ? AND (ar.subject_id IS NULL OR sub.id IS NOT NULL) ${attendanceScope.sql}
    `, [startDate, endDate, ...attendanceScope.params]),
    pool.execute(`
      SELECT ROUND(AVG(ss.score / a.maximum_score * 100), 1) AS average_performance
      FROM student_scores ss
      JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0 AND a.maximum_score > 0
      JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
      JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
      WHERE ss.score <= a.maximum_score ${scoreDateScope}
        ${scoreScope.sql}${scoreSubjectScope}${scoreTermScope}${scoreTeacherScope}
    `, [...scoreDateParams, ...scoreScope.params, ...(subjectId ? [subjectId] : []), ...(termId ? [termId] : []), ...(teacherId ? [teacherId] : [])]),
    pool.execute(`
      SELECT ar.attendance_date AS date, ar.status, COUNT(*) AS total
      FROM attendance_records ar
      JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
      WHERE ar.attendance_date BETWEEN ? AND ? AND (ar.subject_id IS NULL OR sub.id IS NOT NULL) ${attendanceScope.sql}
      GROUP BY ar.attendance_date, ar.status ORDER BY ar.attendance_date
    `, [startDate, endDate, ...attendanceScope.params]),
    pool.execute(`
      SELECT DISTINCT schedule.day_of_week
      FROM class_schedules schedule
      JOIN classes c ON c.id = schedule.class_id AND c.active = 1 AND c.is_deleted = 0
      WHERE schedule.active = 1 AND schedule.is_deleted = 0 ${classFilters('c').sql}
        ${subjectId ? 'AND schedule.subject_id = ?' : ''}
        ${teacherId ? 'AND schedule.teacher_id = ? AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.class_id = schedule.class_id AND ta.subject_id = schedule.subject_id AND ta.teacher_id = ? AND ta.active = 1)' : ''}
      ORDER BY schedule.day_of_week
    `, [...classFilters('c').params, ...(subjectId ? [subjectId] : []), ...(teacherId ? [teacherId, teacherId] : [])]),
    pool.execute(`
      SELECT TO_CHAR(e.enrollment_date, 'YYYY-MM') AS month, COUNT(DISTINCT e.student_id) AS total
      FROM student_enrollments e
      JOIN students s ON s.id = e.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = e.class_id AND c.is_deleted = 0
      WHERE e.enrollment_date BETWEEN ? AND ? ${enrollmentClassScope.sql}
        ${yearId ? 'AND e.academic_year_id = ?' : ''}
        ${enrollmentTeacherScope}
      GROUP BY month ORDER BY month
    `, [startDate, endDate, ...enrollmentClassScope.params, ...(yearId ? [yearId] : []), ...(teacherId ? [teacherId] : [])]),
    pool.execute(`
      SELECT s.id, s.student_code, s.english_name,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present', 'Late')) / COUNT(*), 1) AS attendance_rate
      FROM students s
      JOIN attendance_records ar ON ar.student_id = s.id
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
      WHERE s.status = 'Active' AND s.is_deleted = 0
        AND ar.attendance_date BETWEEN ? AND ? AND ar.subject_id IS NOT NULL AND sub.id IS NOT NULL ${attendanceScope.sql}
      GROUP BY s.id
      HAVING ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present', 'Late')) / COUNT(*), 1) < 80
      ORDER BY attendance_rate LIMIT 10
    `, [dashboardShiftDate(today, -29), today, ...attendanceScope.params]),
    pool.execute(`
      SELECT s.id, s.student_code, s.english_name,
        COUNT(*) FILTER (WHERE ar.status = 'Present') AS present,
        COUNT(*) FILTER (WHERE ar.status = 'Absent') AS absent,
        COUNT(*) FILTER (WHERE ar.status = 'Late') AS late,
        COUNT(*) FILTER (WHERE ar.status = 'Excused') AS excused
      FROM students s
      JOIN attendance_records ar ON ar.student_id = s.id
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
      WHERE s.status = 'Active' AND s.is_deleted = 0
        AND ar.attendance_date BETWEEN ? AND ?
        AND (ar.subject_id IS NULL OR sub.id IS NOT NULL) ${attendanceScope.sql}
      GROUP BY s.id
    `, [startDate, endDate, ...attendanceScope.params]),
    pool.execute(`
      SELECT sub.name AS subject, ROUND(AVG(ss.score / a.maximum_score * 100), 1) AS average,
        COUNT(*) AS score_count, COUNT(DISTINCT a.id) AS assessment_count
      FROM student_scores ss
      JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0 AND a.maximum_score > 0
      JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
      JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
      WHERE ss.score <= a.maximum_score ${scoreDateScope}
        ${scoreScope.sql}${scoreSubjectScope}${scoreTermScope}${scoreTeacherScope}
      GROUP BY sub.id ORDER BY score_count DESC, sub.name LIMIT 12
    `, [...scoreDateParams, ...scoreScope.params, ...(subjectId ? [subjectId] : []), ...(termId ? [termId] : []), ...(teacherId ? [teacherId] : [])])
  ]);

  const attendance = buildDashboardAttendance(
    startDate,
    endDate,
    attendanceInterval,
    attendanceRows,
    scheduleWeekdays.map(row => row.day_of_week)
  );
  const enrollment = buildDashboardEnrollment(startDate, endDate, enrollmentRows);
  const attendanceLeaders = buildDashboardAttendanceLeaders(attendanceLeaderRows);
  const leaderStatuses = Object.keys(attendanceLeaders);
  const publicLeaderRows = await Promise.all(leaderStatuses.map(status =>
    publicizeRows(pool, 'students', attendanceLeaders[status])
  ));
  leaderStatuses.forEach((status, index) => { attendanceLeaders[status] = publicLeaderRows[index]; });
  const totals = {
    students: studentTotals[0].students,
    teachers: teacherTotals[0].teachers,
    classes: classTotals[0].classes,
    subjects: subjectTotals[0].subjects,
    attendance_rate: periodAttendance[0].attendance_rate,
    average_performance: overallPerformance[0].average_performance
  };
  res.json({
    range: {
      from: startDate,
      to: endDate,
      attendance_interval: attendanceInterval,
      attendance_calendar: scheduleWeekdays.length ? 'timetable' : 'calendar'
    },
    totals,
    attendance,
    attendanceLeaders,
    enrollment,
    lowAttendance: await publicizeRows(pool, 'students', lowAttendance),
    performance: performanceRows
  });
});

router.get(apiRoutes.meta, academic, async (req, res) => {
  const teacherId = await linkedTeacherId(req);
  const [[currentYearRows], [academicYearRows]] = await Promise.all([
    pool.execute('SELECT id, name, start_date, end_date, is_current FROM academic_years WHERE is_current = 1 LIMIT 1'),
    pool.execute('SELECT id, name, start_date, end_date, is_current FROM academic_years ORDER BY start_date DESC')
  ]);
  const year = currentYearRows[0];
  const [termsResult, dashboardTermsResult, classesResult, classSubjectsResult,
    teacherAssignmentsResult, teachersResult, subjectsResult, studentsResult] = await Promise.all([
    pool.execute('SELECT id, name, academic_year_id, start_date, end_date FROM terms WHERE academic_year_id = ? ORDER BY start_date', [year?.id || 0]),
    pool.execute('SELECT id, name, academic_year_id, start_date, end_date FROM terms ORDER BY start_date DESC'),
    pool.execute(`
    SELECT c.id, c.name, c.grade_level, c.capacity, c.academic_year_id, ay.name AS academic_year,
      c.homeroom_teacher_id, teacher.full_name AS homeroom_teacher,
      (SELECT COUNT(*) FROM student_enrollments e JOIN students s ON s.id = e.student_id
       WHERE e.class_id = c.id AND e.current = 1 AND s.status = 'Active' AND s.is_deleted = 0) AS student_count
    FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id
    LEFT JOIN teachers teacher ON teacher.id = c.homeroom_teacher_id AND teacher.is_deleted = 0
    WHERE c.active = 1 AND c.is_deleted = 0
      AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
        WHERE ta.teacher_id = ? AND ta.class_id = c.id AND ta.active = 1))
    ORDER BY c.grade_level, c.name
  `, [teacherId, teacherId]),
    pool.execute(`
    SELECT DISTINCT c.public_id AS class_id, s.public_id AS subject_id FROM teacher_assignments ta
    JOIN classes c ON c.id = ta.class_id AND c.active = 1 AND c.is_deleted = 0
    JOIN subjects s ON s.id = ta.subject_id AND s.active = 1 AND s.is_deleted = 0
    JOIN teachers teacher ON teacher.id = ta.teacher_id
      AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
    WHERE ta.active = 1 AND (? IS NULL OR ta.teacher_id = ?) ORDER BY class_id, subject_id
  `, [teacherId, teacherId]),
    pool.execute(`
    SELECT ta.id, ta.teacher_id, ta.subject_id, ta.class_id, ta.academic_year_id,
      teacher.full_name AS teacher_name, subject.name AS subject_name, schedule_class.name AS class_name
    FROM teacher_assignments ta
    JOIN teachers teacher ON teacher.id = ta.teacher_id AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
    JOIN subjects subject ON subject.id = ta.subject_id AND subject.active = 1 AND subject.is_deleted = 0
    JOIN classes schedule_class ON schedule_class.id = ta.class_id AND schedule_class.active = 1 AND schedule_class.is_deleted = 0
    WHERE ta.active = 1 AND (? IS NULL OR ta.teacher_id = ?)
    ORDER BY schedule_class.grade_level, schedule_class.name, subject.name, teacher.full_name
  `, [teacherId, teacherId]),
    pool.execute(`
    SELECT teacher.id, teacher.teacher_code, teacher.full_name, teacher.email, teacher.phone, teacher.employment_status,
      (SELECT STRING_AGG(DISTINCT CONCAT(c.grade_level, ' ', c.name, ' · ', subject.name), ', '
        ORDER BY CONCAT(c.grade_level, ' ', c.name, ' · ', subject.name))
       FROM teacher_assignments ta
       JOIN classes c ON c.id = ta.class_id AND c.active = 1 AND c.is_deleted = 0
       JOIN subjects subject ON subject.id = ta.subject_id AND subject.active = 1 AND subject.is_deleted = 0
       WHERE ta.teacher_id = teacher.id AND ta.active = 1) AS assignments
    FROM teachers teacher
    WHERE teacher.employment_status = 'Active' AND teacher.is_deleted = 0
      AND (? IS NULL OR teacher.id = ?) ORDER BY teacher.full_name
  `, [teacherId, teacherId]),
    pool.execute(`
    SELECT subject.id, subject.code, subject.name, subject.description, subject.active
    FROM subjects subject WHERE subject.active = 1 AND subject.is_deleted = 0
      AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
        WHERE ta.teacher_id = ? AND ta.subject_id = subject.id AND ta.active = 1))
    ORDER BY subject.name
  `, [teacherId, teacherId]),
    pool.execute(`
    SELECT s.id, s.student_code, s.english_name, e.class_id FROM students s
    JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1 WHERE s.status = 'Active' AND s.is_deleted = 0
      AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
        WHERE ta.teacher_id = ? AND ta.class_id = e.class_id AND ta.active = 1))
    ORDER BY s.english_name
  `, [teacherId, teacherId])
  ]);
  const terms = termsResult[0];
  const dashboardTerms = dashboardTermsResult[0];
  const classes = classesResult[0];
  const classSubjects = classSubjectsResult[0];
  const teacherAssignments = teacherAssignmentsResult[0];
  const teachers = teachersResult[0];
  const subjects = subjectsResult[0];
  const students = studentsResult[0];
  const [
    [publicYear], publicAcademicYears, publicTerms, publicDashboardTerms,
    publicClasses, publicTeacherAssignments, publicTeachers, publicSubjects, publicStudents
  ] = await Promise.all([
    publicizeRows(pool, 'academic_years', year ? [year] : []),
    publicizeRows(pool, 'academic_years', academicYearRows),
    publicizeRows(pool, 'terms', terms, { academic_year_id: 'academic_years' }),
    publicizeRows(pool, 'terms', dashboardTerms, { academic_year_id: 'academic_years' }),
    publicizeRows(pool, 'classes', classes, {
      academic_year_id: 'academic_years',
      homeroom_teacher_id: 'teachers'
    }),
    publicizeRows(pool, 'teacher_assignments', teacherAssignments, {
      teacher_id: 'teachers',
      class_id: 'classes',
      subject_id: 'subjects',
      academic_year_id: 'academic_years'
    }),
    publicizeRows(pool, 'teachers', teachers),
    publicizeRows(pool, 'subjects', subjects),
    publicizeRows(pool, 'students', students, { class_id: 'classes' })
  ]);
  res.json({
    academicYear: publicYear || null,
    academicYears: publicAcademicYears,
    terms: publicTerms,
    dashboardTerms: publicDashboardTerms,
    classes: publicClasses,
    classSubjects,
    teacherAssignments: publicTeacherAssignments,
    teachers: publicTeachers,
    subjects: publicSubjects,
    students: publicStudents
  });
});

export default router;
