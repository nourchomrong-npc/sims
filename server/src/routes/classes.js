import { apiRoutes } from './apiRoutes.js';
import { transactionalMutation } from '../utils/transactions.js';

export function registerClassesRoutes(router, context) {
  const { z, pool, activityRecordSnapshot, logActivity, publicIdFor, publicizeRows, resolvePublicId, resolvePublicIds, displayNameSchema, idParam, parse, publicId, schoolManager, academic, includeDeletedRecords, linkedTeacherId, teacherAssignmentFilter, createdAtQuery, createdAtFilter, createdAtOrder, requestedPage, classScheduleInput, validateScheduleAssignment, validateClassSchedule, resolveClassScheduleIds, classScheduleTimeSlotInput, classTimeSlotError, scheduleBatchInput, internalDeleteIdsHasId } = context;

  router.get(apiRoutes.classes.collection, academic, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const teacherFilter = teacherAssignmentFilter(await linkedTeacherId(req), 'c.id');
    const filters = parse(z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['Active', 'Inactive']).optional(),
      grade: z.string().max(50).optional(),
      academic_year_id: publicId.optional(),
      teacher_id: publicId.optional()
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 'c.created_at');
    const page = requestedPage(req);
    const search = filters.q ? `%${filters.q}%` : null;
    const academicYearId = filters.academic_year_id
      ? await resolvePublicId(pool, 'academic_years', filters.academic_year_id, 400)
      : req.academicYearId ?? 0;
    const homeroomTeacherId = filters.teacher_id ? await resolvePublicId(pool, 'teachers', filters.teacher_id, 400) : null;
    const fromWhere = `
      FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id
      LEFT JOIN teachers t ON t.id = c.homeroom_teacher_id AND t.is_deleted = 0
      LEFT JOIN student_enrollments e ON e.class_id = c.id
      LEFT JOIN students s ON s.id = e.student_id AND s.is_deleted = 0
      WHERE (? = 1 OR c.is_deleted = 0)
        AND (? IS NULL OR c.active = ?)
        AND (? IS NULL OR c.grade_level = ?)
        AND (? IS NULL OR c.academic_year_id = ?)
        AND (? IS NULL OR c.homeroom_teacher_id = ?)
        AND (? IS NULL OR c.name LIKE ? OR c.grade_level LIKE ? OR ay.name LIKE ? OR COALESCE(t.full_name, '') LIKE ?)
        ${teacherFilter.sql}
        ${createdRange.sql}
    `;
    const active = filters.status === undefined ? null : filters.status === 'Active';
    const params = [includeDeleted, active, active, filters.grade || null, filters.grade || null,
      academicYearId, academicYearId, homeroomTeacherId, homeroomTeacherId,
      search, search, search, search, search, ...teacherFilter.params, ...createdRange.params];
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(DISTINCT c.id) AS total ${fromWhere}`, params),
        pool.execute(`
      SELECT c.*, ay.name AS academic_year, t.full_name AS homeroom_teacher,
        COUNT(DISTINCT CASE WHEN e.current = 1 AND s.status = 'Active' THEN s.id END) AS student_count
      ${fromWhere}
      GROUP BY c.id, ay.name, t.full_name ${createdAtOrder(createdFilters, 'c.created_at', 'c.id')}
      LIMIT ? OFFSET ?
    `, [...params, page.pageSize, page.offset])
      ])
      : [null, await pool.execute(`
        SELECT c.*, ay.name AS academic_year, t.full_name AS homeroom_teacher,
          COUNT(DISTINCT CASE WHEN e.current = 1 AND s.status = 'Active' THEN s.id END) AS student_count
        ${fromWhere}
        GROUP BY c.id, ay.name, t.full_name ${createdAtOrder(createdFilters, 'c.created_at', 'c.id')}
      `, params)];
    const rows = await publicizeRows(pool, 'classes', rowsResult[0], {
      academic_year_id: 'academic_years',
      homeroom_teacher_id: 'teachers'
    });
    if (page) return res.json({ rows, total: Number(countResult[0][0].total), page: page.page, page_size: page.pageSize });
    res.json(rows);
  });
  router.post(apiRoutes.classes.collection, schoolManager, transactionalMutation(pool, async (req, res) => {
    const data = parse(z.object({
      name: displayNameSchema(80), grade_level: displayNameSchema(50),
      academic_year_id: publicId, capacity: z.coerce.number().int().positive().max(500),
      homeroom_teacher_id: publicId.nullable().optional()
    }), req.body);
    const [[grade]] = await pool.execute(
      'SELECT id FROM grades WHERE name = ? AND active = 1 AND is_deleted = 0',
      [data.grade_level]
    );
    if (!grade) return res.status(400).json({ error: 'Select a grade level configured for this school' });
    data.academic_year_id = await resolvePublicId(pool, 'academic_years', data.academic_year_id, 400);
    if (data.homeroom_teacher_id) data.homeroom_teacher_id = await resolvePublicId(pool, 'teachers', data.homeroom_teacher_id, 400);
    const [[year]] = await pool.execute('SELECT id FROM academic_years WHERE id = ?', [data.academic_year_id]);
    if (!year) return res.status(400).json({ error: 'Academic year not found' });
    if (data.homeroom_teacher_id) {
      const [[teacher]] = await pool.execute("SELECT id FROM teachers WHERE id = ? AND employment_status = 'Active'", [data.homeroom_teacher_id]);
      if (!teacher) return res.status(400).json({ error: 'Select an active homeroom teacher' });
    }
    const [result] = await pool.execute('INSERT INTO classes (name, grade_level, academic_year_id, capacity, homeroom_teacher_id) VALUES (?, ?, ?, ?, ?)',
      [data.name, data.grade_level, data.academic_year_id, data.capacity, data.homeroom_teacher_id || null]);
    await logActivity(pool, req.session.user.internalId, 'created', 'class', result.insertId);
    res.status(201).json({ id: await publicIdFor(pool, 'classes', result.insertId) });
  }));
  router.patch(apiRoutes.classes.item, schoolManager, transactionalMutation(pool, async (req, res) => {
    const { id: publicClassId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'classes', publicClassId);
    const data = parse(z.object({
      name: displayNameSchema(80).optional(),
      grade_level: displayNameSchema(50).optional(),
      capacity: z.coerce.number().int().positive().max(500).optional(),
      homeroom_teacher_id: publicId.nullable().optional(),
      active: z.boolean().optional()
    }), req.body);
    if (data.grade_level !== undefined) {
      const [[grade]] = await pool.execute(
        'SELECT id FROM grades WHERE name = ? AND active = 1 AND is_deleted = 0',
        [data.grade_level]
      );
      if (!grade) return res.status(400).json({ error: 'Select a grade level configured for this school' });
    }
    if (data.homeroom_teacher_id) data.homeroom_teacher_id = await resolvePublicId(pool, 'teachers', data.homeroom_teacher_id, 400);
    const fields = Object.keys(data);
    if (!fields.length) return res.status(400).json({ error: 'No class fields provided' });
    if (data.homeroom_teacher_id) {
      const [[teacher]] = await pool.execute("SELECT id FROM teachers WHERE id = ? AND employment_status = 'Active'", [data.homeroom_teacher_id]);
      if (!teacher) return res.status(400).json({ error: 'Select an active homeroom teacher' });
    }
    if (data.capacity !== undefined) {
      const [[count]] = await pool.execute('SELECT COUNT(DISTINCT student_id) AS total FROM student_enrollments WHERE class_id = ? AND current = 1', [id]);
      if (data.capacity < count.total) return res.status(400).json({ error: `Capacity cannot be below current enrollment (${count.total})` });
    }
    try {
      const recordBefore = await activityRecordSnapshot(pool, 'class', id);
      const [result] = await pool.execute(
        `UPDATE classes SET ${fields.map(key => `${key} = ?`).join(', ')} WHERE id = ?`,
        [...fields.map(key => data[key] ?? null), id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Class not found' });
      await logActivity(pool, req.session.user.internalId, 'updated', 'class', id, { fields, record_before: recordBefore });
      res.json({ success: true });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Class name already exists for the academic year' });
      throw error;
    }
  }));
  router.get(apiRoutes.classSchedules.timeSlots, academic, async (req, res) => {
    const filters = parse(z.object({ class_id: publicId }), req.query);
    const classId = await resolvePublicId(pool, 'classes', filters.class_id, 400);
    const teacherId = await linkedTeacherId(req);
    if (teacherId) {
      const [[assignment]] = await pool.execute(
        'SELECT id FROM teacher_assignments WHERE class_id = ? AND teacher_id = ? AND active = 1 LIMIT 1',
        [classId, teacherId]
      );
      if (!assignment) return res.status(403).json({ error: 'You are not assigned to this class' });
    }
    try {
      const [slots] = await pool.execute(`
        SELECT start_time, end_time FROM class_schedule_time_slots
        WHERE class_id = ? ORDER BY start_time
      `, [classId]);
      res.json(slots);
    } catch (error) {
      throw classTimeSlotError(error);
    }
  });
  router.post(apiRoutes.classSchedules.timeSlots, schoolManager, transactionalMutation(pool, async (req, res) => {
    const data = parse(classScheduleTimeSlotInput, req.body);
    const classId = await resolvePublicId(pool, 'classes', data.class_id, 400);
    const [[classRecord]] = await pool.execute('SELECT id FROM classes WHERE id = ? AND active = 1 AND is_deleted = 0', [classId]);
    if (!classRecord) return res.status(404).json({ error: 'Class not found or inactive' });
    try {
      await pool.execute(`
        INSERT INTO class_schedule_time_slots (class_id, start_time, end_time) VALUES (?, ?, ?) RETURNING class_id
      `, [classId, data.start_time, data.end_time]);
      res.status(201).json({ success: true });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
        return res.status(409).json({ error: 'A time slot already starts at this time for the selected class' });
      }
      throw classTimeSlotError(error);
    }
  }));
  router.delete(apiRoutes.classSchedules.timeSlots, schoolManager, async (req, res) => {
    const data = parse(classScheduleTimeSlotInput, req.body);
    const classId = await resolvePublicId(pool, 'classes', data.class_id, 400);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute('LOCK TABLE class_schedules IN SHARE ROW EXCLUSIVE MODE');
      const [[slot]] = await connection.execute(`
        SELECT start_time, end_time FROM class_schedule_time_slots
        WHERE class_id = ? AND start_time = ? AND end_time = ? FOR UPDATE
      `, [classId, data.start_time, data.end_time]);
      if (!slot) {
        await connection.rollback();
        return res.status(404).json({ error: 'Time slot not found' });
      }
      const [[schedule]] = await connection.execute(`
        SELECT id FROM class_schedules WHERE class_id = ? AND is_deleted = 0
          AND start_time < ? AND end_time > ? LIMIT 1
      `, [classId, data.end_time, data.start_time]);
      if (schedule) {
        await connection.rollback();
        return res.status(409).json({ error: 'This time slot cannot be removed while it has a scheduled lesson' });
      }
      await connection.execute(`
        DELETE FROM class_schedule_time_slots WHERE class_id = ? AND start_time = ? AND end_time = ?
      `, [classId, data.start_time, data.end_time]);
      if (req.session.user.role === 'SuperAdmin') {
        await logActivity(connection, req.session.user.internalId, 'superadmin_action', 'system', null, {
          summary: `SuperAdmin request: ${req.method} ${String(req.originalUrl || req.url || '').split('?')[0].slice(0, 500)}`,
          fields: Object.keys(req.body || {})
            .filter(field => !/(?:password|secret|token|hash|authorization|cookie)/i.test(field))
        });
      }
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw classTimeSlotError(error);
    } finally {
      connection.release();
    }
  });
  router.get(apiRoutes.classSchedules.collection, academic, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const includeInactive = ['Admin', 'SuperAdmin'].includes(req.session.user.role) ? 1 : 0;
    const teacherId = await linkedTeacherId(req);
    const filters = parse(z.object({
      class_id: publicId.optional(),
      day_of_week: z.coerce.number().int().min(1).max(7).optional(),
      status: z.enum(['Active', 'Inactive']).optional(),
      time_from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      time_to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
      created_from: z.string().date().optional(),
      created_to: z.string().date().optional(),
      sort_order: z.enum(['latest', 'oldest']).optional()
    }).superRefine((value, context) => {
      if (value.time_from && value.time_to && value.time_from >= value.time_to) {
        context.addIssue({ code: 'custom', path: ['time_to'], message: 'End time must be after start time' });
      }
      if (value.created_from && value.created_to && value.created_from > value.created_to) {
        context.addIssue({ code: 'custom', path: ['created_to'], message: 'End date must not be before start date' });
      }
    }), req.query);
    const createdRange = createdAtFilter(filters, 'schedule_row.created_at');
    const classId = filters.class_id ? await resolvePublicId(pool, 'classes', filters.class_id, 400) : null;
    const page = requestedPage(req);
    const scheduleFilterParams = [
      filters.day_of_week ?? null, filters.day_of_week ?? null,
      filters.time_from ?? null, filters.time_from ?? null,
      filters.time_to ?? null, filters.time_to ?? null
    ];
    const fromWhere = `
      FROM class_schedules schedule_row
      JOIN classes c ON c.id = schedule_row.class_id AND (? = 1 OR c.active = 1) AND c.is_deleted = 0
      JOIN subjects s ON s.id = schedule_row.subject_id AND (? = 1 OR s.active = 1) AND s.is_deleted = 0
      JOIN teachers t ON t.id = schedule_row.teacher_id AND (? = 1 OR t.employment_status = 'Active') AND t.is_deleted = 0
      JOIN teacher_assignments class_assignment ON class_assignment.class_id = schedule_row.class_id
        AND class_assignment.subject_id = schedule_row.subject_id AND class_assignment.teacher_id = schedule_row.teacher_id
        AND (? = 1 OR class_assignment.active = 1) AND class_assignment.academic_year_id = c.academic_year_id
      JOIN academic_years ay ON ay.id = c.academic_year_id
      WHERE (? = 1 OR schedule_row.active = 1) AND (? = 1 OR schedule_row.is_deleted = 0)
        AND (? IS NULL OR schedule_row.active = ?)
        AND (? IS NULL OR schedule_row.class_id = ?)
        AND (? IS NULL OR schedule_row.teacher_id = ?)
      AND (? IS NULL OR schedule_row.day_of_week = ?)
      AND (? IS NULL OR schedule_row.end_time > ?)
      AND (? IS NULL OR schedule_row.start_time < ?)
      ${createdRange.sql}
    `;
    const active = filters.status === undefined ? null : filters.status === 'Active';
    const params = [includeInactive, includeInactive, includeInactive, includeInactive, includeInactive,
      includeDeleted, active, active, classId, classId, teacherId, teacherId, ...scheduleFilterParams, ...createdRange.params];
    const scheduleOrder = filters.sort_order
      ? createdAtOrder(filters, 'schedule_row.created_at', 'schedule_row.id')
      : 'ORDER BY schedule_row.day_of_week, schedule_row.start_time, c.grade_level, c.name, schedule_row.id';
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(DISTINCT schedule_row.id) AS total ${fromWhere}`, params),
        pool.execute(`
      SELECT schedule_row.*, c.name AS class_name, c.grade_level, s.name AS subject_name, s.code AS subject_code,
        t.full_name AS teacher_name, ay.name AS academic_year
      ${fromWhere}
      ${scheduleOrder}
      LIMIT ? OFFSET ?
    `, [...params, page.pageSize, page.offset])
      ])
      : [null, await pool.execute(`
        SELECT schedule_row.*, c.name AS class_name, c.grade_level, s.name AS subject_name, s.code AS subject_code,
          t.full_name AS teacher_name, ay.name AS academic_year
        ${fromWhere}
        ${scheduleOrder}
      `, params)];
    const rows = await publicizeRows(pool, 'class_schedules', rowsResult[0], {
      class_id: 'classes',
      subject_id: 'subjects',
      teacher_id: 'teachers'
    });
    if (page) return res.json({ rows, total: Number(countResult[0][0].total), page: page.page, page_size: page.pageSize });
    res.json(rows);
  });
  router.post(apiRoutes.classSchedules.validate, schoolManager, async (req, res) => {
    const parsed = parse(classScheduleInput.extend({
      ignored_schedule_ids: z.array(publicId).max(100).optional()
    }), req.body);
    const { ignored_schedule_ids: ignoredPublicIds = [], ...scheduleInput } = parsed;
    const data = await resolveClassScheduleIds(scheduleInput);
    const ignoredIds = await resolvePublicIds(pool, 'class_schedules', ignoredPublicIds, 400);
    await validateClassSchedule(data, null, pool, ignoredIds);
    res.json({ valid: true });
  });
  router.post(apiRoutes.classSchedules.collection, schoolManager, transactionalMutation(pool, async (req, res) => {
    const data = await resolveClassScheduleIds(parse(classScheduleInput, req.body));
    await validateClassSchedule(data);
    const [result] = await pool.execute(`
      INSERT INTO class_schedules (class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [data.class_id, data.subject_id, data.teacher_id, data.day_of_week, data.start_time, data.end_time, data.room || null]);
    await logActivity(pool, req.session.user.internalId, 'created', 'class_schedule', result.insertId, {
      day_of_week: data.day_of_week, start_time: data.start_time, end_time: data.end_time, room: data.room || null
    });
    res.status(201).json({ id: await publicIdFor(pool, 'class_schedules', result.insertId) });
  }));
  router.patch(apiRoutes.classSchedules.item, schoolManager, transactionalMutation(pool, async (req, res) => {
    const { id: publicScheduleId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'class_schedules', publicScheduleId);
    if (Object.keys(req.body).length === 1 && Object.hasOwn(req.body, 'active')) {
      const { active } = parse(z.object({ active: z.boolean() }), req.body);
      const recordBefore = await activityRecordSnapshot(pool, 'class_schedule', id);
      if (active) {
        const [[schedule]] = await pool.execute(`
          SELECT class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room
          FROM class_schedules WHERE id = ? AND is_deleted = 0
        `, [id]);
        if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
        await validateClassSchedule(schedule, id);
      }
      const [result] = await pool.execute('UPDATE class_schedules SET active = ? WHERE id = ? AND is_deleted = 0', [active, id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Schedule not found' });
      await logActivity(pool, req.session.user.internalId, 'updated', 'class_schedule', id, { fields: ['active'], record_before: recordBefore });
      return res.json({ success: true });
    }
    const data = await resolveClassScheduleIds(parse(classScheduleInput, req.body));
    await validateClassSchedule(data, id);
    const recordBefore = await activityRecordSnapshot(pool, 'class_schedule', id);
    const [result] = await pool.execute(`
      UPDATE class_schedules SET class_id = ?, subject_id = ?, teacher_id = ?, day_of_week = ?,
        start_time = ?, end_time = ?, room = ? WHERE id = ?
    `, [data.class_id, data.subject_id, data.teacher_id, data.day_of_week, data.start_time, data.end_time, data.room || null, id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Schedule not found' });
    await logActivity(pool, req.session.user.internalId, 'updated', 'class_schedule', id, {
      day_of_week: data.day_of_week, start_time: data.start_time, end_time: data.end_time, room: data.room || null,
      record_before: recordBefore
    });
    res.json({ success: true });
  }));
  router.put(apiRoutes.classSchedules.batch, schoolManager, async (req, res) => {
    const data = parse(scheduleBatchInput, req.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const classId = await resolvePublicId(connection, 'classes', data.class_id, 400);
      const [[classRecord]] = await connection.execute(
        'SELECT id, academic_year_id FROM classes WHERE id = ? AND active = 1 AND is_deleted = 0 FOR UPDATE',
        [classId]
      );
      if (!classRecord) throw Object.assign(new Error('Class not found or inactive'), { status: 404 });
  
      await connection.execute('LOCK TABLE class_schedules IN SHARE ROW EXCLUSIVE MODE');
      const [existingRows] = await connection.execute(`
        SELECT schedule_row.id, schedule_row.public_id, schedule_row.class_id, schedule_row.subject_id,
          schedule_row.teacher_id, schedule_row.day_of_week, schedule_row.start_time, schedule_row.end_time,
          schedule_row.room, schedule_row.active, schedule_row.is_deleted, c.academic_year_id
        FROM class_schedules schedule_row
        JOIN classes c ON c.id = schedule_row.class_id
        WHERE c.academic_year_id = ? AND schedule_row.is_deleted = 0
        FOR UPDATE OF schedule_row
      `, [classRecord.academic_year_id]);
  
      const updatesByPublicId = new Map(data.updates.map(item => [item.id, item]));
      const deleteIds = new Set(data.deletes);
      const internalUpdateIds = new Map();
      for (const [publicScheduleId, update] of updatesByPublicId) {
        const id = await resolvePublicId(connection, 'class_schedules', publicScheduleId, 400);
        const existing = existingRows.find(row => String(row.id) === String(id));
        if (!existing || String(existing.class_id) !== String(classId)) {
          throw Object.assign(new Error('Every updated schedule must belong to the selected class'), { status: 400 });
        }
        internalUpdateIds.set(publicScheduleId, id);
      }
      const internalDeleteIds = new Map();
      for (const publicScheduleId of deleteIds) {
        const id = await resolvePublicId(connection, 'class_schedules', publicScheduleId, 400);
        const existing = existingRows.find(row => String(row.id) === String(id));
        if (!existing || String(existing.class_id) !== String(classId)) {
          throw Object.assign(new Error('Every removed schedule must belong to the selected class'), { status: 400 });
        }
        internalDeleteIds.set(publicScheduleId, id);
      }
  
      const finalRows = existingRows
        .filter(row => row.active)
        .filter(row => !internalDeleteIdsHasId(internalDeleteIds, row.id))
        .map(row => {
          const update = data.updates.find(item => internalUpdateIds.get(item.id) === row.id);
          return update ? { ...row, ...update, id: row.id } : row;
        });
      const resolvedUpdates = [];
      for (const update of data.updates) {
        const resolved = {
          ...update,
          id: internalUpdateIds.get(update.id),
          class_id: classId,
          subject_id: await resolvePublicId(connection, 'subjects', update.subject_id, 400),
          teacher_id: await resolvePublicId(connection, 'teachers', update.teacher_id, 400),
          room: update.room || null
        };
        await validateScheduleAssignment(resolved, connection);
        resolvedUpdates.push(resolved);
      }
      const resolvedCreates = [];
      for (const create of data.creates) {
        const resolved = {
          ...create,
          class_id: classId,
          subject_id: await resolvePublicId(connection, 'subjects', create.subject_id, 400),
          teacher_id: await resolvePublicId(connection, 'teachers', create.teacher_id, 400),
          room: create.room || null
        };
        await validateScheduleAssignment(resolved, connection);
        resolvedCreates.push(resolved);
        finalRows.push({ ...resolved, academic_year_id: classRecord.academic_year_id });
      }
      for (const update of resolvedUpdates) {
        const current = finalRows.find(row => String(row.id) === String(update.id));
        if (current) Object.assign(current, update);
      }
      for (let firstIndex = 0; firstIndex < finalRows.length; firstIndex += 1) {
        const first = finalRows[firstIndex];
        if (first.end_time <= first.start_time) {
          throw Object.assign(new Error('The schedule end time must be after its start time'), { status: 400 });
        }
        for (let secondIndex = firstIndex + 1; secondIndex < finalRows.length; secondIndex += 1) {
          const second = finalRows[secondIndex];
          const sameYear = String(first.academic_year_id) === String(second.academic_year_id);
          const sameResource = String(first.class_id) === String(second.class_id) ||
            (sameYear && (String(first.teacher_id) === String(second.teacher_id) ||
              (first.room && second.room && first.room.toLowerCase() === second.room.toLowerCase())));
          const overlaps = Number(first.day_of_week) === Number(second.day_of_week) &&
            first.start_time < second.end_time && first.end_time > second.start_time;
          if (sameResource && overlaps) {
            throw Object.assign(new Error('This change conflicts with another class, teacher, or room schedule'), { status: 409 });
          }
        }
      }
  
      for (const update of resolvedUpdates) {
        const recordBefore = await activityRecordSnapshot(connection, 'class_schedule', update.id);
        await connection.execute(`
          INSERT INTO class_schedule_time_slots (class_id, start_time, end_time) VALUES (?, ?, ?)
          ON CONFLICT (class_id, start_time) DO UPDATE SET end_time = EXCLUDED.end_time
          RETURNING class_id
        `, [classId, update.start_time, update.end_time]);
        await connection.execute(`
          UPDATE class_schedules SET subject_id = ?, teacher_id = ?, day_of_week = ?, start_time = ?, end_time = ?, room = ?
          WHERE id = ? AND class_id = ? AND is_deleted = 0
        `, [update.subject_id, update.teacher_id, update.day_of_week, update.start_time, update.end_time,
          update.room, update.id, classId]);
        await logActivity(connection, req.session.user.internalId, 'updated', 'class_schedule', update.id, {
          day_of_week: update.day_of_week, start_time: update.start_time, end_time: update.end_time, room: update.room,
          record_before: recordBefore
        });
      }
      const createdIds = [];
      for (const create of resolvedCreates) {
        await connection.execute(`
          INSERT INTO class_schedule_time_slots (class_id, start_time, end_time) VALUES (?, ?, ?)
          ON CONFLICT (class_id, start_time) DO UPDATE SET end_time = EXCLUDED.end_time
          RETURNING class_id
        `, [classId, create.start_time, create.end_time]);
        const [result] = await connection.execute(`
          INSERT INTO class_schedules (class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [classId, create.subject_id, create.teacher_id, create.day_of_week, create.start_time, create.end_time, create.room]);
        createdIds.push(await publicIdFor(connection, 'class_schedules', result.insertId));
        await logActivity(connection, req.session.user.internalId, 'created', 'class_schedule', result.insertId, {
          day_of_week: create.day_of_week, start_time: create.start_time, end_time: create.end_time, room: create.room
        });
      }
      for (const [publicScheduleId, id] of internalDeleteIds) {
        const record = existingRows.find(row => String(row.id) === String(id));
        const recordBefore = await activityRecordSnapshot(connection, 'class_schedule', id);
        await connection.execute(`
          UPDATE class_schedules SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ? AND is_deleted = 0
        `, [id]);
        await connection.execute(`
          INSERT INTO trash_records (entity_type, record_public_id, deleted_at, deleted_by)
          VALUES ('class-schedules', ?, CURRENT_TIMESTAMP, ?)
          ON CONFLICT (entity_type, record_public_id)
          DO UPDATE SET deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by
          RETURNING record_public_id
        `, [record.public_id || publicScheduleId, req.session.user.internalId]);
        await logActivity(connection, req.session.user.internalId, 'moved_to_trash', 'class_schedule', id, { record_before: recordBefore });
      }
      await connection.commit();
      res.json({ success: true, created: createdIds });
    } catch (error) {
      await connection.rollback();
      throw classTimeSlotError(error);
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.classSchedules.restore, schoolManager, async (req, res) => {
    const { id: publicScheduleId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'class_schedules', publicScheduleId, 404, true);
    const [[schedule]] = await pool.execute(`
      SELECT class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, is_deleted
      FROM class_schedules WHERE id = ?
    `, [id]);
    if (!schedule || !schedule.is_deleted) {
      return res.status(404).json({ error: 'Schedule is already visible or does not exist' });
    }
    await validateClassSchedule(schedule, id);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[trashRecord]] = await connection.execute(
        'SELECT record_public_id FROM trash_records WHERE entity_type = ? AND record_public_id = ? FOR UPDATE',
        ['class-schedules', publicScheduleId]
      );
      if (!trashRecord) {
        await connection.rollback();
        return res.status(404).json({ error: 'Schedule is not in Trash' });
      }
      const recordBefore = await activityRecordSnapshot(connection, 'class_schedule', id);
      await connection.execute('UPDATE class_schedules SET is_deleted = 0, deleted_at = NULL WHERE id = ?', [id]);
      await connection.execute(
        'DELETE FROM trash_records WHERE entity_type = ? AND record_public_id = ?',
        ['class-schedules', publicScheduleId]
      );
      await logActivity(connection, req.session.user.internalId, 'restored', 'class_schedule', id, { record_before: recordBefore });
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
