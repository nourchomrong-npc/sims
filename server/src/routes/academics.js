import { apiRoutes } from './apiRoutes.js';
import { transactionalMutation } from '../utils/transactions.js';

export function registerAcademicsRoutes(router, context) {
  const { z, pool, logActivity, publicIdFor, publicizeRows, resolvePublicId, resolvePublicIds, displayNameSchema, idParam, parse, publicId, admin, schoolManager, academic, includeDeletedRecords, linkedTeacherId, teacherAssignmentFilter, createdAtQuery, createdAtFilter, createdAtOrder, requestedPage } = context;

  router.get(apiRoutes.attendance.collection, academic, async (req, res) => {
    const filters = parse(z.object({
      date: z.string().date().optional(),
      class_id: publicId.optional(),
      class_ids: z.preprocess(
        value => typeof value === 'string' ? value.split(',') : value,
        z.array(publicId).min(1).max(500).optional()
      ),
      subject_id: publicId.optional(),
      schedule_id: publicId.optional(),
      status: z.enum(['Present', 'Absent', 'Late', 'Excused']).optional(),
      q: z.string().trim().min(1).max(100).optional(),
      page: z.coerce.number().int().min(1).optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional()
    }).superRefine((value, context) => {
      if (value.class_id && value.class_ids) {
        context.addIssue({ code: 'custom', path: ['class_ids'], message: 'Use either class_id or class_ids, not both' });
      }
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 'ar.created_at');
    const classId = filters.class_id ? await resolvePublicId(pool, 'classes', filters.class_id, 400) : null;
    const classIds = filters.class_ids
      ? await resolvePublicIds(pool, 'classes', [...new Set(filters.class_ids)], 400)
      : null;
    const subjectId = filters.subject_id ? await resolvePublicId(pool, 'subjects', filters.subject_id, 400) : null;
    const scheduleId = filters.schedule_id ? await resolvePublicId(pool, 'class_schedules', filters.schedule_id, 400) : null;
    const searchTerms = filters.q?.split(/\s+/).filter(Boolean) || [];
    const searchSql = searchTerms.length
      ? `AND (${searchTerms.map(() => '(s.english_name ILIKE ? OR s.student_code ILIKE ?)').join(' AND ')})`
      : '';
    const isPaginated = filters.page !== undefined || filters.page_size !== undefined;
    const page = filters.page || 1;
    const pageSize = filters.page_size || 25;
    const offset = (page - 1) * pageSize;
    const teacherFilter = teacherAssignmentFilter(await linkedTeacherId(req), 'ar.class_id', 'ar.subject_id');
    const whereSql = `
      WHERE (? IS NULL OR ar.attendance_date = ?)
        AND (? IS NULL OR ar.class_id = ?)
        ${classIds ? `AND ar.class_id IN (${classIds.map(() => '?').join(', ')})` : ''}
        AND (? IS NULL OR ar.subject_id = ?)
        AND (? IS NULL OR ar.schedule_id = ?)
        AND (? IS NULL OR ar.status = ?)
        ${searchSql}
        ${teacherFilter.sql}
        ${createdRange.sql}
        AND c.academic_year_id = ?
    `;
    const whereParams = [filters.date || null, filters.date || null, classId, classId, ...(classIds || []), subjectId, subjectId,
      scheduleId, scheduleId, filters.status || null, filters.status || null,
      ...searchTerms.flatMap(term => [`%${term}%`, `%${term}%`]),
      ...teacherFilter.params, ...createdRange.params, req.academicYearId || 0];
    if (isPaginated) {
      const [[count]] = await pool.execute(`
        SELECT COUNT(*) AS total
        FROM attendance_records ar JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
        JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
        LEFT JOIN subjects sub ON sub.id = ar.subject_id
        LEFT JOIN class_schedules schedule ON schedule.id = ar.schedule_id
        ${whereSql}
      `, whereParams);
      const [rows] = await pool.execute(`
        SELECT ar.id, ar.public_id, ar.student_id, ar.class_id, ar.subject_id, ar.schedule_id, ar.attendance_date,
        ar.status, ar.note, ar.recorded_by, ar.created_at, ar.updated_at,
        s.student_code, s.english_name, c.name AS class_name,
        CASE WHEN ar.subject_id IS NULL THEN 'Daily (legacy)' ELSE COALESCE(sub.name, 'Hidden subject') END AS subject_name,
        CASE WHEN schedule.id IS NULL THEN NULL
          ELSE CONCAT(TO_CHAR(schedule.start_time, 'HH24:MI'), '–', TO_CHAR(schedule.end_time, 'HH24:MI')) END AS schedule_time,
        schedule.day_of_week
      FROM attendance_records ar JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id
      LEFT JOIN class_schedules schedule ON schedule.id = ar.schedule_id
      ${whereSql}
      ${createdAtOrder(createdFilters, 'ar.created_at', 'ar.id')}
      LIMIT ? OFFSET ?
      `, [...whereParams, pageSize, offset]);
      const publicRows = await publicizeRows(pool, 'attendance_records', rows, {
      student_id: 'students',
      class_id: 'classes',
      subject_id: 'subjects',
      schedule_id: 'class_schedules',
      recorded_by: 'users'
      });
      return res.json({ rows: publicRows, total: Number(count.total), page, page_size: pageSize });
    }
    const resultLimit = searchTerms.length ? '' : 'LIMIT 1000';
    const [rows] = await pool.execute(`
      SELECT ar.id, ar.public_id, ar.student_id, ar.class_id, ar.subject_id, ar.schedule_id, ar.attendance_date,
      ar.status, ar.note, ar.recorded_by, ar.created_at, ar.updated_at,
      s.student_code, s.english_name, c.name AS class_name,
      CASE WHEN ar.subject_id IS NULL THEN 'Daily (legacy)' ELSE COALESCE(sub.name, 'Hidden subject') END AS subject_name,
      CASE WHEN schedule.id IS NULL THEN NULL
        ELSE CONCAT(TO_CHAR(schedule.start_time, 'HH24:MI'), '–', TO_CHAR(schedule.end_time, 'HH24:MI')) END AS schedule_time,
      schedule.day_of_week
      FROM attendance_records ar JOIN students s ON s.id = ar.student_id AND s.is_deleted = 0
      JOIN classes c ON c.id = ar.class_id AND c.is_deleted = 0
      LEFT JOIN subjects sub ON sub.id = ar.subject_id
      LEFT JOIN class_schedules schedule ON schedule.id = ar.schedule_id
      ${whereSql}
      ${createdAtOrder(createdFilters, 'ar.created_at', 'ar.id')} ${resultLimit}
    `, whereParams);
    res.json(await publicizeRows(pool, 'attendance_records', rows, {
      student_id: 'students',
      class_id: 'classes',
      subject_id: 'subjects',
      schedule_id: 'class_schedules',
      recorded_by: 'users'
    }));
  });
  router.patch(apiRoutes.attendance.item, academic, async (req, res) => {
    const { status } = parse(z.object({
      status: z.enum(['Present', 'Absent', 'Late', 'Excused'])
    }), req.body);
    const id = await resolvePublicId(pool, 'attendance_records', req.params.id, 404);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[record]] = await connection.execute(`
        SELECT ar.id, ar.public_id, ar.student_id, ar.class_id, ar.subject_id, ar.schedule_id,
          ar.attendance_date, ar.status, ar.note
        FROM attendance_records ar JOIN classes c ON c.id = ar.class_id
        WHERE ar.id = ? AND c.academic_year_id = ? FOR UPDATE
      `, [id, req.academicYearId || 0]);
      if (!record) throw Object.assign(new Error('Attendance record not found'), { status: 404 });
      const teacherId = await linkedTeacherId(req);
      if (teacherId) {
        const [[assignment]] = await connection.execute(`
          SELECT assignment.id FROM teacher_assignments assignment
          JOIN classes c ON c.id = assignment.class_id AND c.active = 1 AND c.is_deleted = 0
          JOIN subjects subject ON subject.id = assignment.subject_id AND subject.active = 1 AND subject.is_deleted = 0
          WHERE assignment.teacher_id = ? AND assignment.class_id = ? AND assignment.subject_id = ?
            AND assignment.active = 1 AND assignment.academic_year_id = c.academic_year_id
            AND assignment.academic_year_id = ?
        `, [teacherId, record.class_id, record.subject_id, req.academicYearId || 0]);
        if (!assignment) {
          throw Object.assign(new Error('You are not assigned to this class and subject'), { status: 403 });
        }
      }
      if (record.status === status) {
        await connection.commit();
        return res.json({ success: true, status, unchanged: true });
      }
      const [[contextRecord]] = await connection.execute(`
        SELECT s.english_name, s.student_code, c.name AS class_name, c.grade_level,
          subject.name AS subject_name, teacher.full_name AS teacher_name, teacher.teacher_code,
          schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.room
        FROM attendance_records ar
        JOIN students s ON s.id = ar.student_id
        JOIN classes c ON c.id = ar.class_id
        LEFT JOIN subjects subject ON subject.id = ar.subject_id
        LEFT JOIN class_schedules schedule ON schedule.id = ar.schedule_id
        LEFT JOIN teachers teacher ON teacher.id = schedule.teacher_id
        WHERE ar.id = ?
      `, [id]);
      await connection.execute(`
        UPDATE attendance_records SET status = ?, recorded_by = ? WHERE id = ?
          AND EXISTS (SELECT 1 FROM classes c
            WHERE c.id = attendance_records.class_id AND c.academic_year_id = ?)
      `, [status, req.session.user.internalId, id, req.academicYearId || 0]);
      await logActivity(connection, req.session.user.internalId, 'updated', 'attendance_record', id, {
        changes: [{ field: 'status', label: 'Attendance Status', before: record.status, after: status }],
        student: contextRecord?.english_name || 'Unknown student',
        student_code: contextRecord?.student_code || null,
        class: contextRecord?.class_name || null,
        grade: contextRecord?.grade_level || null,
        subject: contextRecord?.subject_name || null,
        teacher: contextRecord?.teacher_name || null,
        teacher_code: contextRecord?.teacher_code || null,
        date: record.attendance_date,
        schedule_day: contextRecord?.day_of_week || null,
        start_time: contextRecord?.start_time || null,
        end_time: contextRecord?.end_time || null,
        room: contextRecord?.room || null,
        outcome: `Attendance status changed from ${record.status} to ${status}.`
      }, { skipRecordSnapshot: true });
      await connection.commit();
      res.json({ success: true, status });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.attendance.collection, academic, async (req, res) => {
    const data = parse(z.object({
      attendance_date: z.string().date(), class_id: publicId, subject_id: publicId, schedule_id: publicId,
      records: z.array(z.object({
        student_id: publicId,
        status: z.enum(['Present', 'Absent', 'Late', 'Excused']).nullable(),
        note: z.string().max(255).optional().nullable()
      })).min(1).max(100)
    }), req.body);
    if (new Set(data.records.map(row => row.student_id)).size !== data.records.length) {
      return res.status(400).json({ error: 'A student may appear only once per attendance submission' });
    }
    data.class_id = await resolvePublicId(pool, 'classes', data.class_id, 400);
    data.subject_id = await resolvePublicId(pool, 'subjects', data.subject_id, 400);
    data.schedule_id = await resolvePublicId(pool, 'class_schedules', data.schedule_id, 400);
    const studentIds = await resolvePublicIds(pool, 'students', data.records.map(row => row.student_id));
    data.records = data.records.map((record, index) => ({ ...record, student_id: studentIds[index] }));
    const teacherId = await linkedTeacherId(req);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const weekday = new Date(`${data.attendance_date}T00:00:00Z`).getUTCDay() || 7;
      const [[classSubject]] = await connection.execute(`
        SELECT c.academic_year_id, c.name AS class_name, c.grade_level, sub.name AS subject_name,
          teacher.full_name AS teacher_name, teacher.teacher_code,
          schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.room
        FROM class_schedules schedule
        JOIN teacher_assignments ta ON ta.class_id = schedule.class_id
          AND ta.subject_id = schedule.subject_id AND ta.teacher_id = schedule.teacher_id
          AND ta.academic_year_id = (SELECT academic_year_id FROM classes WHERE id = schedule.class_id)
          AND ta.active = 1
        JOIN classes c ON c.id = schedule.class_id AND c.active = 1 AND c.is_deleted = 0
        JOIN subjects sub ON sub.id = schedule.subject_id AND sub.active = 1 AND sub.is_deleted = 0
        JOIN teachers teacher ON teacher.id = schedule.teacher_id
          AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
        WHERE schedule.id = ? AND schedule.class_id = ? AND schedule.subject_id = ?
          AND schedule.active = 1 AND schedule.is_deleted = 0 AND schedule.day_of_week = ?
          AND c.academic_year_id = ? AND (? IS NULL OR schedule.teacher_id = ?) LIMIT 1
      `, [data.schedule_id, data.class_id, data.subject_id, weekday, req.academicYearId || 0, teacherId, teacherId]);
      if (!classSubject) {
        throw Object.assign(new Error('Choose a class schedule for the selected date and subject'), { status: 400 });
      }
      const [members] = await connection.execute(`
        SELECT DISTINCT ON (e.student_id) e.student_id, e.id AS enrollment_id, s.english_name, s.student_code
        FROM student_enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.class_id = ? AND e.academic_year_id = ? AND e.current = 1
          AND (e.enrollment_type = 'Homeroom' OR (e.enrollment_type = 'Subject' AND e.subject_id = ?))
          AND s.status = 'Active' AND s.is_deleted = 0
          AND e.student_id IN (${data.records.map(() => '?').join(', ')})
        ORDER BY e.student_id, CASE WHEN e.enrollment_type = 'Subject' THEN 0 ELSE 1 END
      `, [data.class_id, req.academicYearId || 0, data.subject_id, ...data.records.map(row => row.student_id)]);
      if (members.length !== data.records.length) throw Object.assign(new Error('Every student must be actively enrolled in the selected class'), { status: 400 });
      const membersByStudent = new Map(members.map(member => [String(member.student_id), member]));
      const [existingRecords] = await connection.execute(`
        SELECT ar.student_id, ar.status, s.english_name, s.student_code
        FROM attendance_records ar
        JOIN students s ON s.id = ar.student_id
        WHERE ar.class_id = ? AND ar.schedule_id = ? AND ar.attendance_date = ?
          AND ar.student_id IN (${data.records.map(() => '?').join(', ')})
      `, [data.class_id, data.schedule_id, data.attendance_date, ...data.records.map(row => row.student_id)]);
      const existingByStudent = new Map(existingRecords.map(record => [String(record.student_id), record]));
      const changes = [];
      const affectedStudents = [];
      for (const record of data.records) {
        const existing = existingByStudent.get(String(record.student_id));
        const member = membersByStudent.get(String(record.student_id));
        const studentName = [member?.english_name, member?.student_code].filter(Boolean).join(' · ');
        affectedStudents.push({
          name: member?.english_name || 'Unknown student',
          student_code: member?.student_code || null,
          status: record.status || 'Unmarked'
        });
        if ((existing?.status ?? null) !== record.status) {
          changes.push({
            field: 'attendance_status',
            label: `${studentName || `Student ${record.student_id}`} attendance status`,
            before: existing?.status ?? null,
            after: record.status
          });
        }
        if (record.status === null) {
          await connection.execute(`
            DELETE FROM attendance_records
            WHERE student_id = ? AND class_id = ? AND schedule_id = ? AND attendance_date = ?
          `, [record.student_id, data.class_id, data.schedule_id, data.attendance_date]);
          continue;
        }
        await connection.execute(`
          INSERT INTO attendance_records
            (student_id, class_id, subject_id, schedule_id, attendance_date, status, note, recorded_by, student_enrollment_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (student_id, class_id, attendance_schedule_scope, attendance_date)
          DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by,
            student_enrollment_id = EXCLUDED.student_enrollment_id
        `, [record.student_id, data.class_id, data.subject_id, data.schedule_id, data.attendance_date,
          record.status, record.note || null, req.session.user.internalId, member?.enrollment_id || null]);
      }
      const savedCount = data.records.filter(record => record.status !== null).length;
      const unmarkedCount = data.records.length - savedCount;
      const [attendanceTimestamps] = await connection.execute(`
        SELECT student_id, created_at, updated_at
        FROM attendance_records
        WHERE class_id = ? AND schedule_id = ? AND attendance_date = ?
          AND student_id IN (${data.records.map(() => '?').join(', ')})
      `, [data.class_id, data.schedule_id, data.attendance_date, ...data.records.map(record => record.student_id)]);
      const timestampsByStudent = new Map(attendanceTimestamps.map(record => [String(record.student_id), record]));
      data.records.forEach((record, index) => {
        const timestamps = timestampsByStudent.get(String(record.student_id));
        if (timestamps) {
          affectedStudents[index].created_at = timestamps.created_at ?? null;
          affectedStudents[index].updated_at = timestamps.updated_at ?? null;
        }
      });
      await logActivity(connection, req.session.user.internalId, 'recorded_attendance', 'class', data.class_id,
        { class: classSubject.class_name, grade: classSubject.grade_level,
          subject_id: data.subject_id, subject: classSubject.subject_name,
          teacher: classSubject.teacher_name, teacher_code: classSubject.teacher_code,
          class_schedule_id: data.schedule_id, schedule_day: weekday, start_time: classSubject.start_time,
          end_time: classSubject.end_time, room: classSubject.room, date: data.attendance_date, records: savedCount,
          unmarked: unmarkedCount, affected_students: affectedStudents, changes,
          outcome: `Attendance saved: ${savedCount} marked, ${unmarkedCount} unmarked; ${changes.length} status change${changes.length === 1 ? '' : 's'}.`,
          ...(!changes.length ? { summary: 'No attendance statuses changed.' } : {}) });
      await connection.commit();
      res.json({ success: true, saved: savedCount, unmarked: data.records.length - savedCount });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  router.get(apiRoutes.assessments.collection, academic, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const teacherFilter = teacherAssignmentFilter(await linkedTeacherId(req), 'a.class_id', 'a.subject_id');
    const filters = parse(z.object({
      q: z.string().max(100).optional(),
      options: z.enum(['true']).optional(),
      status: z.enum(['Active', 'In Trash']).optional(),
      class_id: publicId.optional(),
      subject_id: publicId.optional(),
      term_id: publicId.optional()
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 'a.created_at');
    const page = requestedPage(req);
    const search = filters.q ? `%${filters.q}%` : null;
    const classId = filters.class_id ? await resolvePublicId(pool, 'classes', filters.class_id, 400) : null;
    const subjectId = filters.subject_id ? await resolvePublicId(pool, 'subjects', filters.subject_id, 400) : null;
    const termId = filters.term_id ? await resolvePublicId(pool, 'terms', filters.term_id, 400) : null;
    const joins = `
      FROM assessments a
      JOIN subjects sub ON sub.id = a.subject_id AND (? = 1 OR sub.is_deleted = 0)
      JOIN classes c ON c.id = a.class_id AND (? = 1 OR c.is_deleted = 0)
      JOIN terms t ON t.id = a.term_id
    `;
    const whereSql = `
      WHERE (? = 1 OR a.is_deleted = 0)
        AND (? IS NULL OR a.is_deleted = ?)
        AND (? IS NULL OR a.title LIKE ? OR sub.name LIKE ? OR c.name LIKE ? OR t.name LIKE ?)
        AND (? IS NULL OR a.class_id = ?)
        AND (? IS NULL OR a.subject_id = ?)
        AND (? IS NULL OR a.term_id = ?)
        AND c.academic_year_id = ?
        ${teacherFilter.sql}
        ${createdRange.sql}
    `;
    const deleted = filters.status === undefined ? null : filters.status === 'In Trash';
    const params = [includeDeleted, includeDeleted, includeDeleted, deleted, deleted, search, search, search, search, search,
      classId, classId, subjectId, subjectId, termId, termId, req.academicYearId || 0,
      ...teacherFilter.params, ...createdRange.params];
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(DISTINCT a.id) AS total ${joins} ${whereSql}`, params),
        pool.execute(`
      SELECT a.*, sub.name AS subject, c.name AS class_name, t.name AS term_name,
        COUNT(score_student.id) AS score_count
      ${joins}
      LEFT JOIN student_scores ss ON ss.assessment_id = a.id
      LEFT JOIN students score_student ON score_student.id = ss.student_id AND score_student.is_deleted = 0
      ${whereSql}
      GROUP BY a.id, sub.name, c.name, t.name, t.start_date
      ${createdAtOrder(createdFilters, 'a.created_at', 'a.id')}
      ${page ? 'LIMIT ? OFFSET ?' : ''}
    `, page ? [...params, page.pageSize, page.offset] : params)
      ])
      : [null, await pool.execute(`
        SELECT a.*, sub.name AS subject, c.name AS class_name, t.name AS term_name,
          COUNT(score_student.id) AS score_count
        ${joins}
        LEFT JOIN student_scores ss ON ss.assessment_id = a.id
        LEFT JOIN students score_student ON score_student.id = ss.student_id AND score_student.is_deleted = 0
        ${whereSql}
        GROUP BY a.id, sub.name, c.name, t.name, t.start_date
        ${createdAtOrder(createdFilters, 'a.created_at', 'a.id')}
      `, params)];
    const rows = await publicizeRows(pool, 'assessments', rowsResult[0], {
      subject_id: 'subjects',
      class_id: 'classes',
      term_id: 'terms',
      created_by: 'users'
    });
    if (page) return res.json({ rows, total: Number(countResult[0][0].total), page: page.page, page_size: page.pageSize });
    res.json(rows);
  });
  router.get(apiRoutes.assessments.scores, academic, async (req, res) => {
    const { id: assessmentPublicId } = parse(idParam, req.params);
    const assessmentId = await resolvePublicId(pool, 'assessments', assessmentPublicId);
    const teacherId = await linkedTeacherId(req);
    const teacherScope = teacherId
      ? `AND EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = ? AND ta.class_id = a.class_id
            AND ta.subject_id = a.subject_id AND ta.active = 1)`
      : '';
    const params = teacherId
      ? [req.academicYearId || 0, assessmentId, teacherId]
      : [req.academicYearId || 0, assessmentId];
    const [scores] = await pool.execute(`
      SELECT student.public_id AS student_id, student.student_code, student.english_name,
        score.score, score.comment
      FROM student_scores score
      JOIN assessments a ON a.id = score.assessment_id AND a.is_deleted = 0
      JOIN classes cls ON cls.id = a.class_id AND cls.academic_year_id = ?
      JOIN students student ON student.id = score.student_id AND student.is_deleted = 0
      WHERE a.id = ? ${teacherScope}
      ORDER BY student.english_name, student.student_code
    `, params);
    res.json(scores);
  });
  router.get(apiRoutes.classes.results, academic, async (req, res) => {
    const { id: classPublicId } = parse(idParam, req.params);
    const filters = parse(z.object({
      subject_id: publicId.optional(),
      term_id: publicId.optional()
    }), req.query);
    const classId = await resolvePublicId(pool, 'classes', classPublicId);
    const subjectId = filters.subject_id ? await resolvePublicId(pool, 'subjects', filters.subject_id, 400) : null;
    const termId = filters.term_id ? await resolvePublicId(pool, 'terms', filters.term_id, 400) : null;
    const teacherFilter = teacherAssignmentFilter(await linkedTeacherId(req), 'assessment.class_id', 'assessment.subject_id');
    const [results] = await pool.execute(`
      SELECT student.public_id AS student_id, student.student_code, student.english_name,
        subject.name AS subject, assessment.title AS assessment, assessment.assessment_date,
        term.name AS term, assessment.maximum_score, score.score,
        ROUND(100 * score.score / assessment.maximum_score, 1) AS percentage, score.comment
      FROM student_scores score
      JOIN students student ON student.id = score.student_id AND student.is_deleted = 0
      JOIN assessments assessment ON assessment.id = score.assessment_id AND assessment.is_deleted = 0
      JOIN subjects subject ON subject.id = assessment.subject_id AND subject.is_deleted = 0
      JOIN terms term ON term.id = assessment.term_id
      JOIN classes cls ON cls.id = assessment.class_id AND cls.is_deleted = 0
      WHERE cls.id = ?
        AND cls.academic_year_id = ?
        AND (?::bigint IS NULL OR assessment.subject_id = ?)
        AND (?::bigint IS NULL OR assessment.term_id = ?)
        ${teacherFilter.sql}
      ORDER BY student.english_name, subject.name, assessment.assessment_date, assessment.title
    `, [classId, req.academicYearId || 0, subjectId, subjectId, termId, termId, ...teacherFilter.params]);
    res.json(results);
  });
  router.post(apiRoutes.assessments.collection, admin, transactionalMutation(pool, async (req, res) => {
    const data = parse(z.object({
      title: displayNameSchema(150), subject_id: publicId,
      class_id: publicId, term_id: publicId,
      assessment_date: z.string().date(), maximum_score: z.coerce.number().positive().max(100)
    }), req.body);
    data.subject_id = await resolvePublicId(pool, 'subjects', data.subject_id, 400);
    data.class_id = await resolvePublicId(pool, 'classes', data.class_id, 400);
    data.term_id = await resolvePublicId(pool, 'terms', data.term_id, 400);
    const [[valid]] = await pool.execute(`
      SELECT c.academic_year_id, t.academic_year_id AS term_year, t.start_date, t.end_date, s.active AS subject_active
      FROM classes c JOIN terms t ON t.id = ? JOIN subjects s ON s.id = ?
      WHERE c.id = ?
    `, [data.term_id, data.subject_id, data.class_id]);
    if (!valid || String(valid.academic_year_id) !== String(req.academicYearId || 0) ||
        String(valid.academic_year_id) !== String(valid.term_year) || !valid.subject_active ||
        data.assessment_date < valid.start_date || data.assessment_date > valid.end_date) {
      return res.status(400).json({ error: 'The class and term must belong to the same academic year, the subject must be active, and the assessment date must be within the term' });
    }
    const teacherId = await linkedTeacherId(req);
    if (teacherId) {
      const [[assignment]] = await pool.execute(
        'SELECT 1 FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND active = 1',
        [teacherId, data.class_id, data.subject_id]
      );
      if (!assignment) return res.status(403).json({ error: 'You are not assigned to this class and subject' });
    }
    const [result] = await pool.execute(`INSERT INTO assessments (title, subject_id, class_id, term_id, assessment_date, maximum_score, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`, [data.title, data.subject_id, data.class_id, data.term_id, data.assessment_date, data.maximum_score, req.session.user.internalId]);
    await logActivity(pool, req.session.user.internalId, 'created', 'assessment', result.insertId);
    res.status(201).json({ id: await publicIdFor(pool, 'assessments', result.insertId) });
  }));
  router.post(apiRoutes.scores, admin, async (req, res) => {
    const data = parse(z.object({
      assessment_id: publicId,
      scores: z.array(z.object({ student_id: publicId, score: z.coerce.number().min(0).max(100), comment: z.string().max(255).optional().nullable() })).min(1).max(100)
    }), req.body);
    if (new Set(data.scores.map(row => row.student_id)).size !== data.scores.length) {
      return res.status(400).json({ error: 'A student may appear only once per score submission' });
    }
    data.assessment_id = await resolvePublicId(pool, 'assessments', data.assessment_id, 400);
    const studentIds = await resolvePublicIds(pool, 'students', data.scores.map(row => row.student_id));
    data.scores = data.scores.map((score, index) => ({ ...score, student_id: studentIds[index] }));
    const teacherId = await linkedTeacherId(req);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[assessment]] = await connection.execute(`
        SELECT a.class_id, a.subject_id, a.title, a.maximum_score
        FROM assessments a JOIN classes c ON c.id = a.class_id
        WHERE a.id = ? AND c.academic_year_id = ?
      `, [data.assessment_id, req.academicYearId || 0]);
      if (!assessment) throw Object.assign(new Error('Assessment not found'), { status: 404 });
      if (teacherId) {
        const [[assignment]] = await connection.execute(
          'SELECT 1 FROM teacher_assignments WHERE teacher_id = ? AND class_id = ? AND subject_id = ? AND active = 1',
          [teacherId, assessment.class_id, assessment.subject_id]
        );
        if (!assignment) throw Object.assign(new Error('You are not assigned to this class and subject'), { status: 403 });
      }
      if (data.scores.some(row => row.score > assessment.maximum_score)) throw Object.assign(new Error('Score cannot exceed the assessment maximum'), { status: 400 });
      for (const row of data.scores) {
        const [[enrollment]] = await connection.execute(`
          SELECT id FROM student_enrollments
          WHERE student_id = ? AND class_id = ? AND academic_year_id = ? AND current = 1
            AND (enrollment_type = 'Homeroom' OR (enrollment_type = 'Subject' AND subject_id = ?))
          ORDER BY CASE WHEN enrollment_type = 'Subject' THEN 0 ELSE 1 END
          LIMIT 1
        `, [row.student_id, assessment.class_id, req.academicYearId || 0, assessment.subject_id]);
        if (!enrollment) throw Object.assign(new Error('A student is not currently enrolled in the assessment class and subject'), { status: 400 });
        await connection.execute(`
          INSERT INTO student_scores (assessment_id, student_id, score, comment, entered_by, student_enrollment_id)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (assessment_id, student_id)
          DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, entered_by = EXCLUDED.entered_by,
            student_enrollment_id = EXCLUDED.student_enrollment_id
        `, [data.assessment_id, row.student_id, row.score, row.comment || null, req.session.user.internalId, enrollment.id]);
      }
      await logActivity(connection, req.session.user.internalId, 'entered_scores', 'assessment', data.assessment_id, {
        assessment: assessment.title, maximum_score: assessment.maximum_score, count: data.scores.length
      });
      await connection.commit();
      res.json({ success: true, saved: data.scores.length });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}
