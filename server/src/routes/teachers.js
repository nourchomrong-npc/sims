import { apiRoutes } from './apiRoutes.js';

export function registerTeachersRoutes(router, context) {
  const { bcrypt, randomUUID, z, pool, sensitiveAuthLimiter, activityRecordSnapshot, getActivityIdentity, logActivity, publicIdFor, publicizeRows, resolvePublicId, resolvePublicIds, generateRecordCode, displayNameSchema, idParam, parse, publicId, superAdmin, schoolManager, academic, generateTemporaryPassword, includeDeletedRecords, linkedTeacherId, createdAtQuery, createdAtFilter, createdAtOrder, requestedPage } = context;

  router.get(apiRoutes.teachers.collection, academic, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const teacherId = await linkedTeacherId(req);
    const filters = parse(z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['Active', 'On Leave', 'Inactive']).optional(),
      class_id: publicId.optional(),
      subject_id: publicId.optional()
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 't.created_at');
    const page = requestedPage(req);
    const search = filters.q ? `%${filters.q}%` : null;
    const classId = filters.class_id ? await resolvePublicId(pool, 'classes', filters.class_id, 400) : null;
    const subjectId = filters.subject_id ? await resolvePublicId(pool, 'subjects', filters.subject_id, 400) : null;
    const whereSql = `
      WHERE (? = 1 OR t.is_deleted = 0) AND (? IS NULL OR t.id = ?)
        AND (? IS NULL OR t.employment_status = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = t.id AND ta.class_id = ? AND ta.active = 1 AND ta.academic_year_id = ?))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = t.id AND ta.subject_id = ? AND ta.active = 1 AND ta.academic_year_id = ?))
        AND (? IS NULL OR t.teacher_code LIKE ? OR t.full_name LIKE ? OR COALESCE(t.email, '') LIKE ?
          OR COALESCE(t.phone, '') LIKE ?
          OR EXISTS (SELECT 1 FROM users u WHERE u.teacher_id = t.id AND u.username LIKE ?)
          OR EXISTS (SELECT 1 FROM teacher_assignments ta
            JOIN subjects subject ON subject.id = ta.subject_id
            JOIN classes assigned_class ON assigned_class.id = ta.class_id
            WHERE ta.teacher_id = t.id AND ta.academic_year_id = ?
              AND CONCAT(subject.name, ' / ', assigned_class.name) LIKE ?))
        ${createdRange.sql}
    `;
    const params = [includeDeleted, teacherId, teacherId, filters.status || null, filters.status || null,
      classId, classId, req.academicYearId || 0, subjectId, subjectId, req.academicYearId || 0,
      search, search, search, search, search, search, req.academicYearId || 0, search, ...createdRange.params];
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(*) AS total FROM teachers t ${whereSql}`, params),
        pool.execute(`
      SELECT t.*, STRING_AGG(DISTINCT CONCAT(s.name, ' / ', c.name), ', ' ORDER BY CONCAT(s.name, ' / ', c.name)) assignments,
        (SELECT u.username FROM users u WHERE u.teacher_id = t.id LIMIT 1) AS account_username
      FROM teachers t LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.active = 1
        AND ta.academic_year_id = ?
      LEFT JOIN subjects s ON s.id = ta.subject_id AND s.is_deleted = 0
      LEFT JOIN classes c ON c.id = ta.class_id AND c.is_deleted = 0
      ${whereSql}
      GROUP BY t.id ${createdAtOrder(createdFilters, 't.created_at', 't.id')} LIMIT ? OFFSET ?
    `, [req.academicYearId || 0, ...params, page.pageSize, page.offset])
      ])
      : [null, await pool.execute(`
        SELECT t.*, STRING_AGG(DISTINCT CONCAT(s.name, ' / ', c.name), ', ' ORDER BY CONCAT(s.name, ' / ', c.name)) assignments,
          (SELECT u.username FROM users u WHERE u.teacher_id = t.id LIMIT 1) AS account_username
        FROM teachers t LEFT JOIN teacher_assignments ta ON ta.teacher_id = t.id AND ta.active = 1
          AND ta.academic_year_id = ?
        LEFT JOIN subjects s ON s.id = ta.subject_id AND s.is_deleted = 0
        LEFT JOIN classes c ON c.id = ta.class_id AND c.is_deleted = 0
        ${whereSql}
        GROUP BY t.id ${createdAtOrder(createdFilters, 't.created_at', 't.id')}
      `, [req.academicYearId || 0, ...params])];
    const rows = await publicizeRows(pool, 'teachers', rowsResult[0]);
    if (page) return res.json({ rows, total: Number(countResult[0][0].total), page: page.page, page_size: page.pageSize });
    res.json(rows);
  });
  router.post(apiRoutes.teachers.collection, schoolManager, async (req, res) => {
    const data = parse(z.object({
      teacher_code: z.string().trim().min(1).max(30).optional(), full_name: displayNameSchema(150),
      email: z.string().max(254).email().optional().nullable(), phone: z.string().max(30).optional().nullable(),
      hire_date: z.string().date().optional().nullable(), employment_status: z.enum(['Active', 'On Leave', 'Inactive']).default('Active')
    }), req.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute(`INSERT INTO teachers (teacher_code, full_name, email, phone, hire_date, employment_status)
        VALUES (?, ?, ?, ?, ?, ?)`, [data.teacher_code || `TMP-${randomUUID().slice(0, 12)}`, data.full_name, data.email || null, data.phone || null, data.hire_date || null, data.employment_status]);
      if (!data.teacher_code) {
        data.teacher_code = generateRecordCode('teachers', result.insertId);
        await connection.execute('UPDATE teachers SET teacher_code = ? WHERE id = ?', [data.teacher_code, result.insertId]);
      }
      await logActivity(connection, req.session.user.internalId, 'created', 'teacher', result.insertId,
        { teacher_code: data.teacher_code });
      const id = await publicIdFor(connection, 'teachers', result.insertId);
      await connection.commit();
      res.status(201).json({ id, teacher_code: data.teacher_code });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Teacher code or email already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.teachers.generateAccount, sensitiveAuthLimiter, superAdmin, async (req, res) => {
    const { id: publicTeacherId } = parse(idParam, req.params);
    const teacherId = await resolvePublicId(pool, 'teachers', publicTeacherId);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[teacher]] = await connection.execute(`
        SELECT id, teacher_code, full_name FROM teachers
        WHERE id = ? AND employment_status = 'Active' AND is_deleted = 0 FOR UPDATE
      `, [teacherId]);
      if (!teacher) throw Object.assign(new Error('Select an active teacher profile'), { status: 400 });
      const [[existingAccount]] = await connection.execute(
        'SELECT id, username, full_name, role, active, is_deleted FROM users WHERE teacher_id = ? FOR UPDATE',
        [teacherId]
      );
      if (existingAccount && (!existingAccount.active || existingAccount.is_deleted)) {
        throw Object.assign(new Error('The teacher login account is inactive and cannot be regenerated'), { status: 409 });
      }
  
      const temporaryPassword = generateTemporaryPassword();
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      let username;
      let accountId;
      let accountBefore = null;
      if (existingAccount) {
        username = existingAccount.username;
        accountId = existingAccount.id;
        accountBefore = await activityRecordSnapshot(connection, 'user', accountId);
        await connection.execute(`
          UPDATE users SET password_hash = ?, full_name = ?, must_change_password = 1
          WHERE id = ?
        `, [passwordHash, teacher.full_name, accountId]);
      } else {
        const baseUsername = `teacher-${teacher.teacher_code.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 55)}`;
        username = baseUsername;
        const [[usernameExists]] = await connection.execute('SELECT id FROM users WHERE username = ?', [username]);
        if (usernameExists) username = `${baseUsername}-${randomUUID().slice(0, 8)}`;
        const [result] = await connection.execute(`
          INSERT INTO users (username, password_hash, full_name, role, teacher_id, must_change_password)
          VALUES (?, ?, ?, 'Teacher', ?, 1)
        `, [username, passwordHash, teacher.full_name, teacherId]);
        accountId = result.insertId;
      }
      const changes = existingAccount && existingAccount.full_name !== teacher.full_name
        ? [{ field: 'full_name', label: 'Display name', before: existingAccount.full_name, after: teacher.full_name }]
        : [];
      await logActivity(connection, req.session.user.internalId, existingAccount ? 'regenerated_credentials' : 'created', 'user', accountId, {
        username,
        role: 'Teacher',
        teacher_id: teacherId,
        temporary_password_issued: true,
        ...(accountBefore ? {
          record_before: accountBefore,
          record_after: await activityRecordSnapshot(connection, 'user', accountId)
        } : {}),
        ...(changes.length ? { changes, summary: `Display name: ${changes[0].before} → ${changes[0].after}` } : {})
      });
      await connection.commit();
      res.status(existingAccount ? 200 : 201).json({ username, temporary_password: temporaryPassword, created: !existingAccount });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'The teacher or username already has an account' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.patch(apiRoutes.teachers.item, schoolManager, async (req, res) => {
    const { id: publicTeacherId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'teachers', publicTeacherId);
    const data = parse(z.object({
      teacher_code: z.string().trim().min(1).max(30).optional(),
      full_name: displayNameSchema(150).optional(),
      email: z.string().max(254).email().optional().nullable(),
      phone: z.string().max(30).optional().nullable(),
      hire_date: z.string().date().optional().nullable(),
      employment_status: z.enum(['Active', 'On Leave', 'Inactive']).optional()
    }), req.body);
    const columns = ['teacher_code', 'full_name', 'email', 'phone', 'hire_date', 'employment_status'];
    const fields = columns.filter(key => data[key] !== undefined);
    if (!fields.length) return res.status(400).json({ error: 'No teacher fields provided' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const recordBefore = await activityRecordSnapshot(connection, 'teacher', id);
      const [[currentTeacher]] = await connection.execute('SELECT id FROM teachers WHERE id = ? FOR UPDATE', [id]);
      if (!currentTeacher) {
        await connection.rollback();
        return res.status(404).json({ error: 'Teacher not found' });
      }
      let linkedAccount = null;
      if (data.full_name !== undefined) {
        const [[account]] = await connection.execute(
          'SELECT id, username, full_name, role FROM users WHERE teacher_id = ? FOR UPDATE',
          [id]
        );
        linkedAccount = account || null;
        if (account && req.session.user.role !== 'SuperAdmin' && account.full_name !== data.full_name) {
          await connection.rollback();
          return res.status(403).json({ error: 'Only a SuperAdmin can update the name of a linked user account' });
        }
      }
      const [result] = await connection.execute(
        `UPDATE teachers SET ${fields.map(key => `${key} = ?`).join(', ')} WHERE id = ?`,
        [...fields.map(key => data[key] ?? null), id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ error: 'Teacher not found' });
      }
      const changes = linkedAccount && linkedAccount.full_name !== data.full_name
        ? [{ field: 'full_name', label: 'Display name', before: linkedAccount.full_name, after: data.full_name }]
        : [];
      if (changes.length) {
        await connection.execute('UPDATE users SET full_name = ? WHERE id = ?', [data.full_name, linkedAccount.id]);
      }
      const details = {
        fields,
        record_before: recordBefore,
        ...(changes.length ? {
          affected_user: await getActivityIdentity(connection, linkedAccount.id),
          changes,
          summary: `Display name: ${changes[0].before} → ${changes[0].after}`
        } : {})
      };
      await logActivity(connection, req.session.user.internalId, 'updated', 'teacher', id, details);
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Teacher code or email already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.teachers.assignments, schoolManager, async (req, res) => {
    const data = parse(z.object({
      teacher_id: publicId,
      subject_ids: z.array(publicId).min(1).max(100).refine(ids => new Set(ids).size === ids.length, 'Subjects must be unique'),
      class_id: publicId,
      academic_year_id: publicId
    }), req.body);
    const publicData = { ...data };
    data.teacher_id = await resolvePublicId(pool, 'teachers', data.teacher_id, 400);
    data.subject_ids = await resolvePublicIds(pool, 'subjects', data.subject_ids, 400);
    data.class_id = await resolvePublicId(pool, 'classes', data.class_id, 400);
    data.academic_year_id = await resolvePublicId(pool, 'academic_years', data.academic_year_id, 400);
    if (String(data.academic_year_id) !== String(req.academicYearId || 0)) {
      return res.status(400).json({ error: 'Select the academic year shown in the header' });
    }
    const connection = await pool.getConnection();
    let transactionStarted = false;
    try {
      await connection.beginTransaction();
      transactionStarted = true;
      const [[valid]] = await connection.execute(`
        SELECT c.academic_year_id, c.active AS class_active, t.employment_status
        FROM classes c JOIN teachers t ON t.id = ? AND t.is_deleted = 0
        WHERE c.id = ? AND c.is_deleted = 0
        FOR UPDATE
      `, [data.teacher_id, data.class_id]);
      if (!valid || valid.academic_year_id !== data.academic_year_id ||
          valid.class_active !== 1 || valid.employment_status !== 'Active') {
        throw Object.assign(new Error('Choose an active teacher and class in the selected academic year'), { status: 400 });
      }
      const subjectPlaceholders = data.subject_ids.map(() => '?').join(', ');
      const [activeSubjects] = await connection.execute(`
        SELECT id FROM subjects
        WHERE id IN (${subjectPlaceholders}) AND active = 1 AND is_deleted = 0
        FOR UPDATE
      `, data.subject_ids);
      if (activeSubjects.length !== data.subject_ids.length) {
        throw Object.assign(new Error('Choose only active subjects'), { status: 400 });
      }
      const assignmentIds = [];
      for (let index = 0; index < data.subject_ids.length; index += 1) {
        const subjectId = data.subject_ids[index];
        const [result] = await connection.execute(`
          INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, academic_year_id)
          VALUES (?, ?, ?, ?)
        `, [data.teacher_id, subjectId, data.class_id, data.academic_year_id]);
        assignmentIds.push(result.insertId);
        await logActivity(connection, req.session.user.internalId, 'created', 'teacher_assignment', result.insertId, {
          teacher_id: publicData.teacher_id,
          subject_id: publicData.subject_ids[index],
          class_id: publicData.class_id,
          academic_year_id: publicData.academic_year_id
        });
      }
      await connection.commit();
      transactionStarted = false;
      res.status(201).json({
        ids: await Promise.all(assignmentIds.map(id => publicIdFor(connection, 'teacher_assignments', id)))
      });
    } catch (error) {
      if (transactionStarted) await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This teacher is already assigned to that subject and class' });
      throw error;
    } finally {
      connection.release();
    }
  });
}
