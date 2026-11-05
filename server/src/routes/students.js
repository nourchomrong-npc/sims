import { apiRoutes } from './apiRoutes.js';

export function registerStudentsRoutes(router, context) {
  const { randomUUID, z, pool, uploadLimiter, logError, activityRecordSnapshot, logActivity, deleteStudentPhoto, deleteStudentPhotoIfUnreferenced, readStudentPhoto, recordStudentPhoto, saveStudentPhoto, studentPhotoContentType, studentPhotoPublicId, publicIdFor, publicizeRows, resolvePublicId, generateRecordCode, idParam, parse, publicId, studentInput, schoolManager, academic, includeDeletedRecords, linkedTeacherId, teacherAssignmentFilter, createdAtQuery, createdAtFilter, createdAtOrder, requestedPage } = context;

  router.get(apiRoutes.students.photo, academic, async (req, res) => {
    try {
      const teacherId = await linkedTeacherId(req);
      if (teacherId) {
        const [[visiblePhoto]] = await pool.execute(`
          SELECT 1 FROM students s
          JOIN student_enrollments enrollment ON enrollment.student_id = s.id AND enrollment.current = 1
            AND enrollment.academic_year_id = ?
          JOIN teacher_assignments assignment ON assignment.class_id = enrollment.class_id
            AND assignment.teacher_id = ? AND assignment.active = 1
              AND assignment.academic_year_id = enrollment.academic_year_id
              AND (enrollment.enrollment_type = 'Homeroom' OR assignment.subject_id = enrollment.subject_id)
          WHERE s.photo_url = ? AND s.status = 'Active' AND s.is_deleted = 0
        `, [req.academicYearId || 0, teacherId, `/student-photos/${req.params.filename}`]);
        if (!visiblePhoto) return res.status(404).json({ error: 'Student photo not found' });
      }
      const photo = await readStudentPhoto(req.params.filename);
      res.set('Content-Type', studentPhotoContentType(req.params.filename)).set('Cache-Control', 'private, no-store').send(photo);
    } catch (error) {
      if (error.code === 'ENOENT') return res.status(404).json({ error: 'Student photo not found' });
      throw error;
    }
  });
  router.get(apiRoutes.students.timetable, academic, async (req, res) => {
    const { id: studentPublicId } = parse(idParam, req.params);
    const studentId = await resolvePublicId(pool, 'students', studentPublicId, 404);
    const filters = parse(z.object({ academic_year_id: publicId.optional() }), req.query);
    if (filters.academic_year_id) {
      const requestedYearId = await resolvePublicId(pool, 'academic_years', filters.academic_year_id, 400);
      if (String(requestedYearId) !== String(req.academicYearId || 0)) {
        return res.status(400).json({ error: 'Student timetables are limited to the selected academic year' });
      }
    }
    const yearId = req.academicYearId || 0;
    if (!yearId) return res.json({ student_id: studentPublicId, main_grade: null, enrollments: [] });
    const [[student]] = await pool.execute(`
      SELECT s.id, s.public_id, s.student_code, s.english_name, c.grade_level AS main_grade,
        c.name AS homeroom_class
      FROM students s
      LEFT JOIN student_enrollments home ON home.student_id = s.id
        AND home.academic_year_id = ? AND home.current = 1 AND home.enrollment_type = 'Homeroom'
      LEFT JOIN classes c ON c.id = home.class_id
      WHERE s.id = ? AND s.is_deleted = 0
    `, [yearId, studentId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const teacherId = await linkedTeacherId(req);
    const [rows] = await pool.execute(`
      SELECT enrollment.id, enrollment.public_id, enrollment.class_id, enrollment.subject_id,
        enrollment.academic_year_id, enrollment.enrollment_type, class_record.name AS class_name,
        class_record.grade_level, subject.name AS subject_name, schedule.id AS schedule_id,
        schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.room,
        COALESCE(schedule_teacher.full_name, homeroom_teacher.full_name) AS teacher_name
      FROM student_enrollments enrollment
      JOIN classes class_record ON class_record.id = enrollment.class_id AND class_record.is_deleted = 0
      LEFT JOIN class_schedules schedule ON schedule.class_id = enrollment.class_id
        AND schedule.active = 1 AND schedule.is_deleted = 0
        AND (enrollment.enrollment_type = 'Homeroom' OR schedule.subject_id = enrollment.subject_id)
      LEFT JOIN subjects subject ON subject.id = COALESCE(enrollment.subject_id, schedule.subject_id)
      LEFT JOIN teachers schedule_teacher ON schedule_teacher.id = schedule.teacher_id
      LEFT JOIN teachers homeroom_teacher ON homeroom_teacher.id = class_record.homeroom_teacher_id
      WHERE enrollment.student_id = ? AND enrollment.academic_year_id = ? AND enrollment.current = 1
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM teacher_assignments assignment
          WHERE assignment.teacher_id = ? AND assignment.class_id = enrollment.class_id
            AND assignment.active = 1
            AND assignment.academic_year_id = enrollment.academic_year_id
            AND (enrollment.enrollment_type = 'Homeroom' OR assignment.subject_id = enrollment.subject_id)
        ))
      ORDER BY schedule.day_of_week NULLS LAST, schedule.start_time NULLS LAST,
        class_record.grade_level, subject.name
    `, [studentId, yearId, teacherId, teacherId]);
    const enrollments = await publicizeRows(pool, 'student_enrollments', rows, {
      class_id: 'classes', subject_id: 'subjects', schedule_id: 'class_schedules',
      academic_year_id: 'academic_years'
    });
    res.json({
      student_id: student.public_id,
      student_code: student.student_code,
      student_name: student.english_name,
      main_grade: student.main_grade,
      homeroom_class: student.homeroom_class,
      enrollments
    });
  });
  router.get(apiRoutes.students.collection, academic, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const teacherId = await linkedTeacherId(req);
    const filters = parse(z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['Active', 'Archived', 'Graduated', 'Withdrawn']).optional(),
      gender: z.enum(['Female', 'Male', 'Other']).optional(),
      class_id: publicId.optional()
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 's.created_at');
    const page = requestedPage(req);
    const search = `%${filters.q || ''}%`;
    const status = filters.status || null;
    const gender = filters.gender || null;
    const classId = filters.class_id ? await resolvePublicId(pool, 'classes', filters.class_id, 400) : null;
    const yearId = req.academicYearId || 0;
    const teacherFilter = teacherId ? `
      AND EXISTS (
        SELECT 1 FROM student_enrollments visible_enrollment
        JOIN teacher_assignments visible_assignment
          ON visible_assignment.class_id = visible_enrollment.class_id
          AND visible_assignment.teacher_id = ? AND visible_assignment.active = 1
          AND visible_assignment.academic_year_id = visible_enrollment.academic_year_id
          AND (visible_enrollment.enrollment_type = 'Homeroom'
            OR visible_assignment.subject_id = visible_enrollment.subject_id)
        WHERE visible_enrollment.student_id = s.id AND visible_enrollment.current = 1
          AND visible_enrollment.academic_year_id = ?
      )
    ` : '';
    const fromWhere = `
      FROM students s
      LEFT JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1
        AND e.enrollment_type = 'Homeroom'
        AND e.academic_year_id = ?
      LEFT JOIN classes c ON c.id = e.class_id AND c.is_deleted = 0
      LEFT JOIN student_photos photo ON photo.url = s.photo_url
      WHERE (s.student_code LIKE ? OR s.english_name LIKE ? OR COALESCE(s.khmer_name,'') LIKE ?)
        AND (? IS NULL OR s.status = ?)
        AND (? IS NULL OR s.gender = ?)
        AND (? IS NULL OR EXISTS (
          SELECT 1 FROM student_enrollments class_filter
          WHERE class_filter.student_id = s.id AND class_filter.current = 1 AND class_filter.class_id = ?
            AND class_filter.academic_year_id = ?
        ))
        AND (? = 1 OR s.is_deleted = 0)
        ${teacherFilter}
        ${createdRange.sql}
    `;
    const params = [yearId, search, search, search, status, status, gender, gender, classId, classId,
      yearId, includeDeleted, ...(teacherId ? [teacherId, yearId] : []), ...createdRange.params];
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(DISTINCT s.id) AS total ${fromWhere}`, params),
        pool.execute(`
      SELECT s.*, c.id AS class_id, c.name AS class_name, c.grade_level, e.id AS enrollment_id,
        photo.title AS photo_title
      ${fromWhere}
      ${createdAtOrder(createdFilters, 's.created_at', 's.id')} LIMIT ? OFFSET ?
    `, [...params, page.pageSize, page.offset])
      ])
      : [null, await pool.execute(`
        SELECT s.*, c.id AS class_id, c.name AS class_name, c.grade_level, e.id AS enrollment_id,
          photo.title AS photo_title
        ${fromWhere}
        ${createdAtOrder(createdFilters, 's.created_at', 's.id')} LIMIT 500
      `, params)];
    const rows = rowsResult[0];
    const publicRows = await publicizeRows(pool, 'students', rows, {
      class_id: 'classes',
      enrollment_id: 'student_enrollments'
    });
    const resultRows = publicRows.map(row => ({
      ...row,
      photo_public_id: studentPhotoPublicId(row.photo_url)
    }));
    if (page) return res.json({
      rows: resultRows,
      total: Number(countResult[0][0].total),
      page: page.page,
      page_size: page.pageSize
    });
    res.json(resultRows);
  });
  router.post(apiRoutes.students.collection, uploadLimiter, schoolManager, async (req, res) => {
    const data = parse(studentInput, req.body);
    if (data.remove_photo) return res.status(400).json({ error: 'A photo cannot be removed while creating a student' });
    if (data.class_id) data.class_id = await resolvePublicId(pool, 'classes', data.class_id, 400);
    const connection = await pool.getConnection();
    let storedPhoto;
    let transactionStarted = false;
    try {
      if (data.photo_data) storedPhoto = await saveStudentPhoto(data.photo_data);
      await connection.beginTransaction();
      transactionStarted = true;
      const [result] = await connection.execute(`
        INSERT INTO students (student_code, english_name, khmer_name, gender, date_of_birth, place_of_birth,
          address, phone, email, guardian_name, guardian_phone, enrollment_date, status, photo_url)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [data.student_code || `TMP-${randomUUID().slice(0, 12)}`, data.english_name, data.khmer_name || null, data.gender, data.date_of_birth || null,
        data.place_of_birth || null, data.address || null, data.phone || null, data.email || null,
        data.guardian_name || null, data.guardian_phone || null, data.enrollment_date, data.status, storedPhoto?.url || null]);
      if (!data.student_code) {
        data.student_code = generateRecordCode('students', result.insertId);
        await connection.execute('UPDATE students SET student_code = ? WHERE id = ?', [data.student_code, result.insertId]);
      }
      const photoUrl = storedPhoto?.url || null;
      if (photoUrl) {
        const ownerId = await publicIdFor(connection, 'students', result.insertId);
        await recordStudentPhoto(connection, ownerId, photoUrl, data.photo_title || 'Student profile photo');
      }
      if (data.class_id) {
        const yearId = req.academicYearId || 0;
        if (!yearId) throw Object.assign(new Error('Select an academic year before enrolling students'), { status: 400 });
        if (data.status !== 'Active') throw Object.assign(new Error('Only active students can be enrolled in a class'), { status: 400 });
        const [[classInfo]] = await connection.execute(`
          SELECT c.capacity, c.academic_year_id,
            (SELECT COUNT(DISTINCT e.student_id) FROM student_enrollments e WHERE e.class_id = c.id AND e.current = 1) AS enrollment_count
          FROM classes c WHERE c.id = ? AND c.active = 1 FOR UPDATE
        `, [data.class_id]);
        if (!classInfo || String(classInfo.academic_year_id) !== String(yearId)) {
          throw Object.assign(new Error('Select an active class in the selected academic year'), { status: 400 });
        }
        if (classInfo.enrollment_count >= classInfo.capacity) {
          throw Object.assign(new Error('The selected class is at capacity'), { status: 400 });
        }
        await connection.execute(
          'INSERT INTO student_enrollments (student_id, class_id, academic_year_id, enrollment_date, current) VALUES (?, ?, ?, ?, 1)',
          [result.insertId, data.class_id, yearId, data.enrollment_date]
        );
      }
      await logActivity(connection, req.session.user.internalId, 'created', 'student', result.insertId, { student_code: data.student_code });
      await connection.commit();
      transactionStarted = false;
      const publicId = await publicIdFor(connection, 'students', result.insertId);
      storedPhoto = null;
      res.status(201).json({
        id: publicId,
        student_code: data.student_code,
        photo_url: photoUrl,
        photo_public_id: studentPhotoPublicId(photoUrl)
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      if (storedPhoto) {
        try { await deleteStudentPhoto(storedPhoto.url); } catch (cleanupError) {
          logError({ event: 'student_photo_cleanup_failed', requestId: req.requestId, name: cleanupError.name });
        }
      }
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Student code already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.patch(apiRoutes.students.item, uploadLimiter, schoolManager, async (req, res) => {
    const { id: publicStudentId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'students', publicStudentId);
    const data = parse(studentInput.partial(), req.body);
    if (data.class_id) data.class_id = await resolvePublicId(pool, 'classes', data.class_id, 400);
    if (data.status && data.status !== 'Active') delete data.class_id;
    if (data.photo_data && data.remove_photo) return res.status(400).json({ error: 'Choose a photo or remove the existing photo, not both' });
    const photoChanged = Boolean(data.photo_data) || data.remove_photo === true;
    const fields = Object.keys(data).filter(field => !['photo_data', 'photo_title', 'remove_photo'].includes(field));
    if (!fields.length && !photoChanged && !data.photo_title) return res.status(400).json({ error: 'No student fields provided' });
    const columns = {
      student_code: 'student_code', english_name: 'english_name', khmer_name: 'khmer_name', gender: 'gender',
      date_of_birth: 'date_of_birth', place_of_birth: 'place_of_birth', address: 'address', phone: 'phone',
      email: 'email', guardian_name: 'guardian_name', guardian_phone: 'guardian_phone',
      enrollment_date: 'enrollment_date', status: 'status'
    };
    const set = fields.filter(field => columns[field]).map(field => `${columns[field]} = ?`);
    if (!set.length && !fields.includes('class_id') && !photoChanged && !data.photo_title) return res.status(400).json({ error: 'No editable student fields provided' });
    const connection = await pool.getConnection();
    let storedPhoto;
    let transactionStarted = false;
    let previousPhotoUrl;
    let photoCleanupPending = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [[student]] = await connection.execute('SELECT id, status, photo_url FROM students WHERE id = ? FOR UPDATE', [id]);
      if (!student) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(404).json({ error: 'Student not found' });
      }
      const recordBefore = await activityRecordSnapshot(connection, 'student', id);
      previousPhotoUrl = student.photo_url;
      if (data.photo_data) storedPhoto = await saveStudentPhoto(data.photo_data);
      const nextPhotoUrl = storedPhoto?.url ?? (data.remove_photo ? null : undefined);
      const resultingPhotoUrl = nextPhotoUrl === undefined ? previousPhotoUrl : nextPhotoUrl;
      if (data.photo_title && !resultingPhotoUrl) {
        await connection.rollback();
        transactionStarted = false;
        return res.status(400).json({ error: 'Upload a photo before setting its title' });
      }
      if (nextPhotoUrl !== undefined) set.push('photo_url = ?');
      if (set.length) {
        await connection.execute(`UPDATE students SET ${set.join(', ')} WHERE id = ?`,
          [...fields.filter(field => columns[field]).map(field => data[field] ?? null),
            ...(nextPhotoUrl !== undefined ? [nextPhotoUrl] : []), id]);
      }
      if (resultingPhotoUrl && (storedPhoto || data.photo_title)) {
        await recordStudentPhoto(
          connection,
          publicStudentId,
          resultingPhotoUrl,
          data.photo_title || recordBefore.photo_title || 'Student profile photo'
        );
      }
      if (data.status && data.status !== 'Active' && !Object.hasOwn(data, 'class_id')) {
        await connection.execute(
          'UPDATE student_enrollments SET current = 0, exit_date = ? WHERE student_id = ? AND current = 1 AND academic_year_id = ?',
          [data.enrollment_date || new Date().toISOString().slice(0, 10), id, req.academicYearId || 0]
        );
      }
      if (Object.hasOwn(data, 'class_id')) {
        const [current] = await connection.execute(
          "SELECT id, class_id FROM student_enrollments WHERE student_id = ? AND academic_year_id = ? AND current = 1 AND enrollment_type = 'Homeroom' FOR UPDATE",
          [id, req.academicYearId || 0]
        );
        if (data.class_id === null) {
          if (current.length) {
            await connection.execute("UPDATE student_enrollments SET current = 0, exit_date = ? WHERE student_id = ? AND academic_year_id = ? AND current = 1 AND enrollment_type = 'Homeroom'",
              [data.enrollment_date || new Date().toISOString().slice(0, 10), id, req.academicYearId || 0]);
          }
        } else if (!current[0] || current[0].class_id !== data.class_id) {
          const yearId = req.academicYearId || 0;
          if (!yearId) throw Object.assign(new Error('Select an academic year before managing class enrollment'), { status: 400 });
          if ((data.status || student.status) !== 'Active') {
            throw Object.assign(new Error('Only active students can be enrolled in a class'), { status: 400 });
          }
          const [[classInfo]] = await connection.execute(`
            SELECT c.capacity, c.academic_year_id,
              (SELECT COUNT(DISTINCT e.student_id) FROM student_enrollments e WHERE e.class_id = c.id AND e.current = 1 AND e.student_id <> ?) AS enrollment_count
            FROM classes c WHERE c.id = ? AND c.active = 1 FOR UPDATE
          `, [id, data.class_id]);
          if (!classInfo || String(classInfo.academic_year_id) !== String(yearId)) {
            throw Object.assign(new Error('Select an active class in the selected academic year'), { status: 400 });
          }
          if (classInfo.enrollment_count >= classInfo.capacity) {
            throw Object.assign(new Error('The selected class is at capacity'), { status: 400 });
          }
          if (current[0] && current[0].class_id !== data.class_id) {
            await connection.execute('UPDATE student_enrollments SET current = 0, exit_date = ? WHERE id = ?',
              [data.enrollment_date || new Date().toISOString().slice(0, 10), current[0].id]);
          }
          await connection.execute(`
            INSERT INTO student_enrollments (student_id, class_id, academic_year_id, enrollment_date, current, enrollment_type)
            VALUES (?, ?, ?, ?, 1, 'Homeroom')
            ON CONFLICT
            DO UPDATE SET enrollment_date = EXCLUDED.enrollment_date, exit_date = NULL, current = 1
          `, [id, data.class_id, yearId, data.enrollment_date || new Date().toISOString().slice(0, 10)]);
        }
      }
      await logActivity(connection, req.session.user.internalId, 'updated', 'student', id, {
        fields: [
          ...fields,
          ...(photoChanged ? ['photo_url'] : []),
          ...(data.photo_title ? ['photo_title'] : [])
        ],
        record_before: recordBefore
      });
      await connection.commit();
      transactionStarted = false;
      storedPhoto = null;
      if (photoChanged && previousPhotoUrl && previousPhotoUrl !== resultingPhotoUrl) {
        try {
          await deleteStudentPhotoIfUnreferenced(pool, previousPhotoUrl);
        } catch (cleanupError) {
          photoCleanupPending = true;
          logError({ event: 'student_photo_cleanup_failed', requestId: req.requestId, name: cleanupError.name });
        }
      }
      res.json({
        success: true,
        photo_url: resultingPhotoUrl,
        photo_public_id: studentPhotoPublicId(resultingPhotoUrl),
        photo_cleanup_pending: photoCleanupPending
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      if (storedPhoto) {
        try { await deleteStudentPhoto(storedPhoto.url); } catch (cleanupError) {
          logError({ event: 'student_photo_cleanup_failed', requestId: req.requestId, name: cleanupError.name });
        }
      }
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Student code already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.students.archive, schoolManager, async (req, res) => {
    const { id: publicStudentId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'students', publicStudentId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const recordBefore = await activityRecordSnapshot(connection, 'student', id);
      const [result] = await connection.execute("UPDATE students SET status = 'Archived' WHERE id = ? AND status <> 'Archived'", [id]);
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ error: 'Active student not found' });
      }
      await connection.execute(
        'UPDATE student_enrollments SET current = 0, exit_date = CURRENT_DATE WHERE student_id = ? AND current = 1',
        [id]
      );
      await logActivity(connection, req.session.user.internalId, 'archived', 'student', id, { record_before: recordBefore });
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}
