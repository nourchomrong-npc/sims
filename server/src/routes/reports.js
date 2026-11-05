import { apiRoutes } from './apiRoutes.js';

export function registerReportsRoutes(router, context) {
  const { z, pool, expensiveLimiter, publicizeRows, parse, manager, academic, linkedTeacherId, teacherAssignmentFilter } = context;

  router.get(apiRoutes.reports, expensiveLimiter, academic, async (req, res) => {
    const { type } = parse(z.object({
      type: z.enum(['enrollment', 'attendance', 'attendance-monthly', 'frequent-absence', 'results', 'class-performance', 'students-by-class', 'enrollment-trends'])
    }), req.params);
    let sql;
    let params = [];
    const teacherId = await linkedTeacherId(req);
    if (type === 'enrollment') {
      const scope = teacherAssignmentFilter(teacherId, 'e.class_id');
      sql = `SELECT s.student_code, s.english_name, s.gender, s.enrollment_date, s.status, c.name class_name, c.grade_level
        FROM students s JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1
          AND e.academic_year_id = ? AND e.enrollment_type = 'Homeroom'
        JOIN classes c ON c.id = e.class_id AND c.is_deleted = 0
        WHERE s.status <> 'Archived' AND s.is_deleted = 0 ${scope.sql} ORDER BY s.enrollment_date DESC`;
      params = [req.academicYearId || 0, ...scope.params];
    } else if (type === 'attendance') {
      const scope = teacherAssignmentFilter(teacherId, 'ar.class_id', 'ar.subject_id');
      sql = `SELECT ar.attendance_date, s.student_code, s.english_name, c.name class_name,
        CASE WHEN ar.subject_id IS NULL THEN 'Daily (legacy)' ELSE COALESCE(sub.name, 'Hidden subject') END AS subject_name,
        CASE WHEN schedule.id IS NULL THEN 'Legacy' ELSE
          CONCAT(TO_CHAR(schedule.start_time, 'HH24:MI'), '–', TO_CHAR(schedule.end_time, 'HH24:MI')) END AS schedule_time,
        ar.status, ar.note
        FROM attendance_records ar JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
        JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
        LEFT JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
        LEFT JOIN class_schedules schedule ON schedule.id = ar.schedule_id
        WHERE c.academic_year_id = ?
          AND (? IS NULL OR ar.attendance_date >= ?) AND (? IS NULL OR ar.attendance_date <= ?) ${scope.sql}
        ORDER BY ar.attendance_date DESC, c.name, s.english_name`;
      const filters = parse(z.object({
        from: z.string().date().optional(),
        to: z.string().date().optional()
      }).refine(value => !value.from || !value.to || value.from <= value.to, {
        path: ['to'], message: 'End date must not be before start date'
      }), req.query);
      const from = filters.from || null;
      const to = filters.to || null;
      params = [req.academicYearId || 0, from, from, to, to, ...scope.params];
    } else if (type === 'attendance-monthly') {
      const scope = teacherAssignmentFilter(teacherId, 'ar.class_id', 'ar.subject_id');
      sql = `SELECT TO_CHAR(ar.attendance_date, 'YYYY-MM') month, c.name class_name, sub.name subject_name,
        COUNT(*) total_records,
        COUNT(*) FILTER (WHERE ar.status = 'Present') present,
        COUNT(*) FILTER (WHERE ar.status = 'Late') late,
        COUNT(*) FILTER (WHERE ar.status = 'Absent') absent,
        COUNT(*) FILTER (WHERE ar.status = 'Excused') excused,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present','Late')) / COUNT(*),1) attendance_rate
        FROM attendance_records ar JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
        JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
        JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
        WHERE c.academic_year_id = ? ${scope.sql}
        GROUP BY month, c.id, sub.id ORDER BY month DESC, c.name, sub.name`;
      params = [req.academicYearId || 0, ...scope.params];
    } else if (type === 'frequent-absence') {
      const scope = teacherAssignmentFilter(teacherId, 'ar.class_id', 'ar.subject_id');
      sql = `SELECT s.student_code, s.english_name, c.name class_name, sub.name subject_name, COUNT(*) absences,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present','Late')) / COUNT(*),1) attendance_rate
        FROM attendance_records ar JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
        JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
        JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
        WHERE c.academic_year_id = ?
          AND ar.attendance_date >= CURRENT_DATE - INTERVAL '30 days' ${scope.sql}
        GROUP BY s.id, c.id, sub.id HAVING COUNT(*) >= 3 ORDER BY absences DESC`;
      params = [req.academicYearId || 0, ...scope.params];
    } else if (type === 'results') {
      const scope = teacherAssignmentFilter(teacherId, 'a.class_id', 'a.subject_id');
      sql = `SELECT s.student_code, s.english_name, c.grade_level, c.name class_name,
        sub.name subject, a.title assessment, a.assessment_date, a.maximum_score, ss.score,
        ROUND(100 * ss.score / a.maximum_score,1) percentage, t.name term
        FROM student_scores ss JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
        JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0
        JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
        JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
        JOIN terms t ON t.id = a.term_id WHERE c.academic_year_id = ? ${scope.sql}
        ORDER BY s.english_name, sub.name`;
      params = [req.academicYearId || 0, ...scope.params];
    } else if (type === 'class-performance') {
      const scope = teacherAssignmentFilter(teacherId, 'a.class_id', 'a.subject_id');
      sql = `SELECT c.name class_name, c.grade_level, sub.name subject,
        ROUND(AVG(100 * ss.score / a.maximum_score),1) average_percentage, COUNT(ss.id) scores
        FROM student_scores ss JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
        JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0
        JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
        JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
        WHERE c.academic_year_id = ? ${scope.sql}
        GROUP BY c.id, sub.id ORDER BY c.grade_level, c.name, sub.name`;
      params = [req.academicYearId || 0, ...scope.params];
    } else if (type === 'students-by-class') {
      const scope = teacherAssignmentFilter(teacherId, 'e.class_id');
      sql = `SELECT c.grade_level, c.name class_name, s.student_code, s.english_name, e.enrollment_date
        FROM student_enrollments e JOIN classes c ON c.id = e.class_id AND c.is_deleted = 0
        JOIN students s ON s.id = e.student_id WHERE e.current = 1
        AND e.academic_year_id = ?
        AND s.status = 'Active' AND s.is_deleted = 0
        AND e.enrollment_type = 'Homeroom'
        ${scope.sql}
        ORDER BY c.grade_level, c.name, s.english_name`;
      params = [req.academicYearId || 0, ...scope.params];
    } else if (type === 'enrollment-trends') {
      const scope = teacherAssignmentFilter(teacherId, 'e.class_id');
      sql = `SELECT TO_CHAR(s.enrollment_date, 'YYYY-MM') month, COUNT(DISTINCT s.id) enrollments
        FROM students s JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1 AND e.enrollment_type = 'Homeroom'
        WHERE s.is_deleted = 0 AND e.academic_year_id = ?
        ${scope.sql}
        GROUP BY month ORDER BY month`;
      params = [req.academicYearId || 0, ...scope.params];
    } else {
      return res.status(404).json({ error: 'Unknown report type' });
    }
    const [rows] = await pool.execute(sql, params);
    res.json(rows);
  });
  router.get(apiRoutes.decisionSupport, expensiveLimiter, manager, async (req, res) => {
    const filters = parse(z.object({
      attendance_threshold: z.coerce.number().min(0).max(100).default(80),
      performance_threshold: z.coerce.number().min(0).max(100).default(60),
      attendance_days: z.coerce.number().int().refine(value => [1, 7, 30, 90].includes(value), 'Invalid attendance period').default(30),
      attendance_from: z.string().date().optional(),
      attendance_to: z.string().date().optional()
    }).superRefine((value, context) => {
      if (Boolean(value.attendance_from) !== Boolean(value.attendance_to)) {
        context.addIssue({ code: 'custom', path: [value.attendance_from ? 'attendance_to' : 'attendance_from'], message: 'Both attendance range dates are required' });
      }
      if (value.attendance_from && value.attendance_to && value.attendance_from > value.attendance_to) {
        context.addIssue({ code: 'custom', path: ['attendance_to'], message: 'End date must not be before start date' });
      }
    }), req.query);
    const attendanceThreshold = filters.attendance_threshold;
    const performanceThreshold = filters.performance_threshold;
    const attendanceDays = filters.attendance_days;
    const customAttendanceRange = Boolean(filters.attendance_from && filters.attendance_to);
    const attendanceDateFilter = customAttendanceRange
      ? 'ar.attendance_date BETWEEN ? AND ?'
      : attendanceDays === 1
      ? 'ar.attendance_date = CURRENT_DATE'
      : `ar.attendance_date >= CURRENT_DATE - INTERVAL '${attendanceDays - 1} days'`;
    const [attendance] = await pool.execute(`
      SELECT s.id, s.student_code, s.gender, s.english_name, c.public_id class_id, c.name class_name, c.grade_level, sub.name subject,
        ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present','Late')) / COUNT(*),1) value
      FROM attendance_records ar JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      JOIN subjects sub ON sub.id = ar.subject_id AND sub.is_deleted = 0
      WHERE ${attendanceDateFilter} AND s.status = 'Active' AND c.academic_year_id = ?
      GROUP BY s.id, c.id, sub.id
      HAVING ROUND(100.0 * COUNT(*) FILTER (WHERE ar.status IN ('Present','Late')) / COUNT(*),1) < ?
      ORDER BY value
    `, customAttendanceRange
      ? [filters.attendance_from, filters.attendance_to, req.academicYearId || 0, attendanceThreshold]
      : [req.academicYearId || 0, attendanceThreshold]);
    const [performance] = await pool.execute(`
      SELECT s.id, s.student_code, s.gender, s.english_name, c.public_id class_id, c.name class_name, c.grade_level, sub.name subject,
        ROUND(AVG(100 * ss.score / a.maximum_score),1) value
      FROM student_scores ss JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0
      JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
      JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
      JOIN terms t ON t.id = a.term_id AND CURRENT_DATE BETWEEN t.start_date AND t.end_date
      WHERE c.academic_year_id = ?
      GROUP BY s.id, c.id, sub.id HAVING ROUND(AVG(100 * ss.score / a.maximum_score),1) < ? ORDER BY value
    `, [req.academicYearId || 0, performanceThreshold]);
    const [classAverages] = await pool.query(`
      SELECT c.name class_name, sub.name subject, ROUND(AVG(100 * ss.score / a.maximum_score),1) average
      FROM student_scores ss JOIN assessments a ON a.id = ss.assessment_id AND a.is_deleted = 0
      JOIN students s ON s.id = ss.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = a.class_id AND c.is_deleted = 0
      JOIN subjects sub ON sub.id = a.subject_id AND sub.is_deleted = 0
      WHERE c.academic_year_id = ?
      GROUP BY c.id, sub.id ORDER BY average
    `, [req.academicYearId || 0]);
    const [trends] = await pool.query(`
      SELECT TO_CHAR(e.enrollment_date, 'YYYY-MM') AS "month", COUNT(*) AS enrollments
      FROM student_enrollments e
      JOIN students s ON s.id = e.student_id AND s.is_deleted = 0
      WHERE e.academic_year_id = ?
      GROUP BY TO_CHAR(e.enrollment_date, 'YYYY-MM')
      ORDER BY TO_CHAR(e.enrollment_date, 'YYYY-MM') DESC
      LIMIT 12
    `, [req.academicYearId || 0]);
    res.json({
      thresholds: { attendance: attendanceThreshold, performance: performanceThreshold },
      attendance: (await publicizeRows(pool, 'students', attendance)).map(row => ({
        ...row,
        reason: `Attendance is ${row.value}% ${customAttendanceRange
          ? `from ${filters.attendance_from} to ${filters.attendance_to}`
          : attendanceDays === 1 ? 'today' : `over the last ${attendanceDays} days`}, below the ${attendanceThreshold}% review threshold.`
      })),
      performance: (await publicizeRows(pool, 'students', performance)).map(row => ({ ...row, reason: `Average in ${row.subject} is ${row.value}%, below the ${performanceThreshold}% review threshold for the current term.` })),
      classAverages,
      enrollmentTrends: trends.reverse()
    });
  });
}
