import { apiRoutes } from './apiRoutes.js';

export function registerUsersRoutes(router, context) {
  const { bcrypt, z, pool, sensitiveAuthLimiter, activityRecordSnapshot, getActivityIdentity, hydrateActivityRecordTimestamps, logActivity, sanitizeActivityDetails, publicIdFor, publicizeEntityIds, publicizeRows, resolvePublicId, displayNameSchema, idParam, parse, publicId, admin, userManager, assignableUserRoles, canManageUserRole, generateTemporaryPassword, invalidateUserSessions, includeDeletedRecords, createdAtQuery, createdAtFilter, createdAtOrder, requestedPage } = context;

  router.get(apiRoutes.users.collection, userManager, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const filters = parse(z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['Active', 'Inactive']).optional(),
      role: z.enum(['Admin', 'Teacher', 'School Manager']).optional()
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 'u.created_at');
    const page = requestedPage(req);
    const search = filters.q ? `%${filters.q}%` : null;
    const visibleRoles = assignableUserRoles[req.session.user.role];
    if (filters.role && !visibleRoles.includes(filters.role)) {
      return res.status(403).json({ error: `You cannot view ${filters.role} accounts` });
    }
    const roleScopeSql = `AND u.role IN (${visibleRoles.map(() => '?').join(', ')})`;
    const fromWhere = `
      FROM users u LEFT JOIN teachers teacher ON teacher.id = u.teacher_id
      WHERE (? = 1 OR u.is_deleted = 0)
        AND (? IS NULL OR u.active = ?)
        ${roleScopeSql}
        AND (? IS NULL OR u.role = ?)
        AND (? IS NULL OR u.username LIKE ? OR u.full_name LIKE ? OR u.role LIKE ?
          OR COALESCE(teacher.full_name, '') LIKE ? OR COALESCE(teacher.teacher_code, '') LIKE ?
          OR EXISTS (SELECT 1 FROM teacher_assignments ta
            JOIN classes c ON c.id = ta.class_id AND c.is_deleted = 0
            JOIN subjects s ON s.id = ta.subject_id AND s.is_deleted = 0
            WHERE ta.teacher_id = teacher.id AND ta.active = 1
              AND CONCAT(c.grade_level, ' ', c.name, ' · ', s.name) LIKE ?))
        ${createdRange.sql}
    `;
    const active = filters.status === undefined ? null : filters.status === 'Active';
    const params = [includeDeleted, active, active, ...visibleRoles, filters.role || null, filters.role || null,
      search, search, search, search, search, search, search, ...createdRange.params];
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(*) AS total ${fromWhere}`, params),
        pool.execute(`
      SELECT u.id, u.username, u.full_name, u.role, u.teacher_id, u.active, u.is_deleted, u.created_at, u.updated_at,
        teacher.full_name AS teacher_full_name, teacher.teacher_code,
      (SELECT STRING_AGG(DISTINCT CONCAT(c.grade_level, ' ', c.name, ' · ', s.name), ', '
        ORDER BY CONCAT(c.grade_level, ' ', c.name, ' · ', s.name))
         FROM teacher_assignments ta
         JOIN classes c ON c.id = ta.class_id AND c.is_deleted = 0
         JOIN subjects s ON s.id = ta.subject_id AND s.is_deleted = 0
         WHERE ta.teacher_id = teacher.id AND ta.active = 1) AS teacher_assignments
      ${fromWhere}
      ${createdAtOrder(createdFilters, 'u.created_at', 'u.id')} LIMIT ? OFFSET ?
    `, [...params, page.pageSize, page.offset])
      ])
      : [null, await pool.execute(`
        SELECT u.id, u.username, u.full_name, u.role, u.teacher_id, u.active, u.is_deleted, u.created_at, u.updated_at,
          teacher.full_name AS teacher_full_name, teacher.teacher_code,
          (SELECT STRING_AGG(DISTINCT CONCAT(c.grade_level, ' ', c.name, ' · ', s.name), ', '
            ORDER BY CONCAT(c.grade_level, ' ', c.name, ' · ', s.name))
           FROM teacher_assignments ta
           JOIN classes c ON c.id = ta.class_id AND c.is_deleted = 0
           JOIN subjects s ON s.id = ta.subject_id AND s.is_deleted = 0
           WHERE ta.teacher_id = teacher.id AND ta.active = 1) AS teacher_assignments
        ${fromWhere}
        ORDER BY u.full_name
      `, params)];
    const rows = await publicizeRows(pool, 'users', rowsResult[0], { teacher_id: 'teachers' });
    if (page) return res.json({ rows, total: Number(countResult[0][0].total), page: page.page, page_size: page.pageSize });
    res.json(rows);
  });
  router.post(apiRoutes.users.collection, sensitiveAuthLimiter, userManager, async (req, res) => {
    const data = parse(z.object({
      username: z.string().trim().min(3).max(80), full_name: displayNameSchema(150),
      role: z.enum(['SuperAdmin', 'Admin', 'Teacher', 'School Manager']),
      teacher_id: publicId.nullable().optional(), password: z.string().min(12).max(200).nullable().optional(),
      must_change_password: z.boolean().optional()
    }), req.body);
    if (data.role === 'SuperAdmin' || !canManageUserRole(req.session.user.role, data.role)) {
      return res.status(403).json({ error: `You cannot create a ${data.role} account` });
    }
    if (data.role === 'Teacher' && !data.teacher_id) {
      return res.status(400).json({ error: 'Select the teacher profile linked to this account' });
    }
    if (data.role !== 'Teacher' && data.teacher_id) {
      return res.status(400).json({ error: 'Only teacher accounts can be linked to a teacher profile' });
    }
    const teacherId = data.teacher_id
      ? await resolvePublicId(pool, 'teachers', data.teacher_id, 400)
      : null;
    if (teacherId) {
      const [[teacher]] = await pool.execute(
        "SELECT id FROM teachers WHERE id = ? AND employment_status = 'Active' AND is_deleted = 0",
        [teacherId]
      );
      if (!teacher) return res.status(400).json({ error: 'Select an active teacher profile' });
    }
    const temporaryPassword = data.password || generateTemporaryPassword();
    const hash = await bcrypt.hash(temporaryPassword, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(
        'INSERT INTO users (username, password_hash, full_name, role, teacher_id, must_change_password) VALUES (?, ?, ?, ?, ?, ?)',
        [data.username, hash, data.full_name, data.role, teacherId, data.must_change_password ? 1 : 1]
      );
      await logActivity(connection, req.session.user.internalId, 'created', 'user', result.insertId, { username: data.username, role: data.role, teacher_id: teacherId, temporary_password_issued: true });
      const id = await publicIdFor(connection, 'users', result.insertId);
      await connection.commit();
      res.status(201).json({
        id,
        username: data.username,
        must_change_password: true,
        ...(data.password ? {} : { temporary_password: temporaryPassword })
      });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') {
        if (error.message.includes('uq_users_teacher_id')) return res.status(409).json({ error: 'This teacher profile is already linked to another user' });
        return res.status(409).json({ error: 'Username already exists' });
      }
      throw error;
    } finally {
      connection.release();
    }
  });
  router.patch(apiRoutes.users.item, userManager, async (req, res) => {
    const { id: publicUserId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'users', publicUserId);
    const data = parse(z.object({
      username: z.string().trim().min(3).max(80).optional(),
      full_name: displayNameSchema(150).optional(),
      role: z.enum(['SuperAdmin', 'Admin', 'Teacher', 'School Manager']).optional(),
      teacher_id: publicId.nullable().optional(),
      active: z.boolean().optional()
    }), req.body);
    if (id === req.session.user.internalId && data.active === false) return res.status(400).json({ error: 'You cannot deactivate your own account' });
    if (id === req.session.user.internalId && data.role && data.role !== 'SuperAdmin') {
      return res.status(400).json({ error: 'You cannot remove your own SuperAdmin role' });
    }
    if (!Object.keys(data).length) return res.status(400).json({ error: 'No user fields provided' });
    const requestedTeacherId = data.teacher_id
      ? await resolvePublicId(pool, 'teachers', data.teacher_id, 400)
      : data.teacher_id === null ? null : undefined;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[currentUser]] = await connection.execute(
        'SELECT id, username, full_name, role, teacher_id, active FROM users WHERE id = ? FOR UPDATE',
        [id]
      );
      if (!currentUser) {
        await connection.rollback();
        return res.status(404).json({ error: 'User not found' });
      }
      if (!canManageUserRole(req.session.user.role, currentUser.role)) {
        await connection.rollback();
        return res.status(403).json({ error: `You cannot manage ${currentUser.role} accounts` });
      }
      if (data.role === 'SuperAdmin' && currentUser.role !== 'SuperAdmin') {
        await connection.rollback();
        return res.status(403).json({ error: 'SuperAdmin accounts can only be promoted directly in the database' });
      }
      if (data.role && data.role !== currentUser.role && !canManageUserRole(req.session.user.role, data.role)) {
        await connection.rollback();
        return res.status(403).json({ error: `You cannot assign the ${data.role} role` });
      }
      if (data.active === false && currentUser.role === 'SuperAdmin' && currentUser.active) {
        const [[admins]] = await connection.execute(
          "SELECT COUNT(*) AS total FROM users WHERE role = 'SuperAdmin' AND active = 1 AND is_deleted = 0"
        );
        if (Number(admins.total) <= 1) {
          await connection.rollback();
          return res.status(400).json({ error: 'The last active administrator cannot be disabled' });
        }
      }
      const role = data.role || currentUser.role;
      let teacherId = requestedTeacherId === undefined ? currentUser.teacher_id : requestedTeacherId;
      if (role === 'Teacher' && !teacherId) {
        await connection.rollback();
        return res.status(400).json({ error: 'Select the teacher profile linked to this account' });
      }
      if (role !== 'Teacher' && data.teacher_id) {
        await connection.rollback();
        return res.status(400).json({ error: 'Only teacher accounts can be linked to a teacher profile' });
      }
      if (role !== 'Teacher') teacherId = null;
      if (teacherId) {
        const [[teacher]] = await connection.execute(
          "SELECT id FROM teachers WHERE id = ? AND employment_status = 'Active' AND is_deleted = 0",
          [teacherId]
        );
        if (!teacher) {
          await connection.rollback();
          return res.status(400).json({ error: 'Select an active teacher profile' });
        }
      }
  
      const nextUser = {
        username: data.username ?? currentUser.username,
        full_name: data.full_name ?? currentUser.full_name,
        role,
        active: data.active ?? currentUser.active,
        teacher_id: teacherId
      };
      const changes = [
        ['username', 'Username', currentUser.username, nextUser.username],
        ['full_name', 'Display name', currentUser.full_name, nextUser.full_name],
        ['role', 'Role', currentUser.role, nextUser.role],
        ['active', 'Account status', currentUser.active ? 'Active' : 'Inactive', nextUser.active ? 'Active' : 'Inactive'],
        ['teacher_id', 'Teacher profile', currentUser.teacher_id, nextUser.teacher_id]
      ].filter(([key, , before, after]) => {
        if (key === 'active') return Boolean(currentUser.active) !== Boolean(nextUser.active);
        if (key === 'teacher_id') return String(before ?? '') !== String(after ?? '');
        return before !== after;
      }).map(([field, label, before, after]) => ({ field, label, before, after }));
      for (const change of changes.filter(item => item.field === 'teacher_id')) {
        change.before = change.before == null ? null : await publicIdFor(connection, 'teachers', change.before);
        change.after = change.after == null ? null : await publicIdFor(connection, 'teachers', change.after);
      }
  
      if (!changes.length) {
        await connection.commit();
        return res.json({ success: true, unchanged: true });
      }
      const actorSnapshot = await getActivityIdentity(connection, req.session.user.internalId);
      const recordBefore = await activityRecordSnapshot(connection, 'user', id);
      const [result] = await connection.execute(
        'UPDATE users SET username = ?, full_name = ?, role = ?, active = ?, teacher_id = ? WHERE id = ?',
        [nextUser.username, nextUser.full_name, nextUser.role, nextUser.active, nextUser.teacher_id, id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ error: 'User not found' });
      }
      if (changes.some(change => ['role', 'active'].includes(change.field))) {
        await invalidateUserSessions(connection, id);
      }
      const usernameChange = changes.find(change => change.field === 'username');
      const roleChange = changes.find(change => change.field === 'role');
      const summary = usernameChange && roleChange
        ? `${usernameChange.before} / ${roleChange.before} → ${usernameChange.after} / ${roleChange.after}`
        : changes.map(change => `${change.label}: ${change.before} → ${change.after}`).join(' · ');
      await logActivity(connection, req.session.user.internalId, 'updated', 'user', id, {
        fields: changes.map(change => change.field),
        summary,
        changes,
        record_before: recordBefore
      }, { actorSnapshot });
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_users_teacher_id')) {
        return res.status(409).json({ error: 'This teacher profile is already linked to another user' });
      }
      if (error.code === 'ER_DUP_ENTRY' && error.message.includes('uq_users_username')) {
        return res.status(409).json({ error: 'Username already exists' });
      }
      throw error;
    } finally {
      connection.release();
    }
  });
  router.get(apiRoutes.activityLogs, admin, async (req, res) => {
    const filters = parse(z.object({
      page: z.coerce.number().int().min(1).optional(),
      page_size: z.coerce.number().int().min(1).max(100).optional(),
      q: z.string().max(100).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
      action: z.string().max(80).optional(),
      username: z.string().max(80).optional(),
      entity: z.string().max(80).optional(),
      sort_order: z.enum(['latest', 'oldest']).default('latest')
    }).refine(value => !value.from || !value.to || value.from <= value.to, {
      path: ['to'], message: 'End date must not be before start date'
    }), req.query);
    const page = requestedPage(req);
    const whereParts = [];
    const params = [];
    if (filters.from) {
      whereParts.push('al.created_at >= ?');
      params.push(`${filters.from.replace('T', ' ')}:00`);
    }
    if (filters.to) {
      whereParts.push('al.created_at <= ?');
      params.push(`${filters.to.replace('T', ' ')}:59`);
    }
    if (filters.action) {
      whereParts.push('al.action = ?');
      params.push(filters.action);
    }
    if (filters.username === '__no_user__') {
      whereParts.push(`COALESCE(al.details -> 'actor' ->> 'public_id', activity_actor.public_id::text) IS NULL`);
    } else if (filters.username) {
      whereParts.push(`(activity_actor.public_id::text = ? OR al.details -> 'actor' ->> 'public_id' = ?)`);
      params.push(filters.username, filters.username);
    }
    if (filters.entity) {
      whereParts.push('al.entity = ?');
      params.push(filters.entity);
    }
    if (filters.q) {
      const search = `%${filters.q}%`;
      whereParts.push(`(COALESCE(al.details -> 'actor' ->> 'username', '') LIKE ?
        OR COALESCE(al.details -> 'actor' ->> 'display_name', '') LIKE ?
        OR COALESCE(CAST(al.details -> 'actor' -> 'roles' AS TEXT), '') LIKE ?
        OR al.action LIKE ? OR al.entity LIKE ?
        OR CAST(al.entity_id AS TEXT) LIKE ? OR CAST(al.details AS TEXT) LIKE ?)`);
      params.push(search, search, search, search, search, search, search);
    }
    const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const joins = 'FROM activity_logs al LEFT JOIN users activity_actor ON activity_actor.id = al.user_id';
    const queryRows = `
      SELECT al.id, al.public_id AS event_id, al.user_id AS legacy_actor_id,
        al.action, al.entity, al.entity_id, al.details, al.created_at,
        CASE al.entity
          WHEN 'student' THEN (SELECT CONCAT(student_code, ' · ', english_name) FROM students WHERE id = al.entity_id)
          WHEN 'attendance_record' THEN (
            SELECT CONCAT(student.student_code, ' · ', student.english_name)
            FROM attendance_records attendance
            JOIN students student ON student.id = attendance.student_id
            WHERE attendance.id = al.entity_id
          )
          WHEN 'teacher' THEN (SELECT CONCAT(teacher_code, ' · ', full_name) FROM teachers WHERE id = al.entity_id)
          WHEN 'class' THEN (SELECT CONCAT(grade_level, ' · ', name) FROM classes WHERE id = al.entity_id)
          WHEN 'subject' THEN (SELECT CONCAT(code, ' · ', name) FROM subjects WHERE id = al.entity_id)
          WHEN 'user' THEN CASE WHEN al.details -> 'affected_user' IS NOT NULL
            THEN CONCAT(al.details -> 'affected_user' ->> 'username', ' · ', al.details -> 'affected_user' ->> 'display_name')
            ELSE NULL END
          WHEN 'term' THEN (SELECT CONCAT(name, ' · ', start_date, ' to ', end_date) FROM terms WHERE id = al.entity_id)
          WHEN 'grading_scale' THEN (SELECT CONCAT(label, ' · ', minimum_percentage, '%–', maximum_percentage, '%') FROM grading_scales WHERE id = al.entity_id)
          WHEN 'assessment' THEN (SELECT title FROM assessments WHERE id = al.entity_id)
          WHEN 'teacher_assignment' THEN (
            SELECT CONCAT(teacher.full_name, ' · ', subject.name, ' / ', assigned_class.name)
            FROM teacher_assignments assignment
            JOIN teachers teacher ON teacher.id = assignment.teacher_id
            JOIN subjects subject ON subject.id = assignment.subject_id
            JOIN classes assigned_class ON assigned_class.id = assignment.class_id
            WHERE assignment.id = al.entity_id
          )
          WHEN 'class_schedule' THEN (
            SELECT CONCAT(scheduled_class.name, ' · ', subject.name, ' / ', teacher.full_name)
            FROM class_schedules schedule_row
            JOIN classes scheduled_class ON scheduled_class.id = schedule_row.class_id
            JOIN subjects subject ON subject.id = schedule_row.subject_id
            JOIN teachers teacher ON teacher.id = schedule_row.teacher_id
            WHERE schedule_row.id = al.entity_id
          )
          ELSE NULL
        END AS record_label
      ${joins}
      ${whereSql}
      ORDER BY al.created_at ${filters.sort_order === 'oldest' ? 'ASC' : 'DESC'} NULLS LAST,
        al.id ${filters.sort_order === 'oldest' ? 'ASC' : 'DESC'}
    `;
    function presentActivityRows(rows) {
      return rows.map(row => {
        let parsedDetails = row.details;
        if (typeof parsedDetails === 'string') {
          try {
            parsedDetails = JSON.parse(parsedDetails);
          } catch {
            parsedDetails = { message: 'Details unavailable (invalid legacy data)' };
          }
        }
        const details = sanitizeActivityDetails(parsedDetails);
        const actor = details?.actor || {
          id: row.legacy_actor_id == null ? null : String(row.legacy_actor_id),
          display_name: null,
          username: null,
          roles: []
        };
        const { legacy_actor_id: _legacyActorId, ...visibleRow } = row;
        return { ...visibleRow, details, actor, affected_user: details?.affected_user || null };
      });
    }
    if (!page) {
      const [rows] = await pool.execute(`${queryRows} LIMIT 500`, params);
      const hydratedRows = await hydrateActivityRecordTimestamps(pool, rows);
      return res.json(await publicizeEntityIds(pool, presentActivityRows(hydratedRows)));
    }
    const pageSize = page.pageSize;
    const [countResult, rowsResult, optionsResult] = await Promise.all([
      pool.execute(`SELECT COUNT(*) AS total ${joins} ${whereSql}`, params),
      pool.execute(`${queryRows} LIMIT ? OFFSET ?`, [...params, pageSize, page.offset]),
      page.page === 1 ? Promise.all([
        pool.execute('SELECT DISTINCT action FROM activity_logs ORDER BY action'),
        pool.execute('SELECT DISTINCT entity FROM activity_logs WHERE entity IS NOT NULL ORDER BY entity'),
        pool.execute(`SELECT DISTINCT
            COALESCE(al.details -> 'actor' ->> 'public_id', activity_actor.public_id::text) AS actor_id,
            COALESCE(al.details -> 'actor' ->> 'display_name', 'Historical identity unavailable') AS display_name,
            al.details -> 'actor' ->> 'username' AS username,
            al.details -> 'actor' -> 'roles' AS roles
          FROM activity_logs al
          LEFT JOIN users activity_actor ON activity_actor.id = al.user_id
          WHERE COALESCE(al.details -> 'actor' ->> 'public_id', activity_actor.public_id::text) IS NOT NULL
          ORDER BY display_name, username`)
      ]) : Promise.resolve(null)
    ]);
    const count = countResult[0][0];
    const rows = await hydrateActivityRecordTimestamps(pool, rowsResult[0]);
    const [actions, entities, users] = optionsResult
      ? optionsResult.map(result => result[0])
      : [[], [], []];
    const actorOptions = new Map();
    for (const row of users) {
      const identityLabel = [row.display_name, row.username, Array.isArray(row.roles) ? row.roles.join(', ') : '']
        .filter(Boolean)
        .join(' · ');
      const labels = actorOptions.get(row.actor_id) || [];
      if (!labels.includes(identityLabel)) labels.push(identityLabel);
      actorOptions.set(row.actor_id, labels);
    }
    res.json({
      rows: await publicizeEntityIds(pool, presentActivityRows(rows)),
      total: Number(count.total),
      page: page.page,
      page_size: pageSize,
      ...(optionsResult ? {
        filterOptions: {
          actions: actions.map(row => row.action),
          entities: entities.map(row => row.entity),
          users: [...actorOptions].map(([id, labels]) => [id, labels.join(' / ')])
        }
      } : {})
    });
  });
}
