import { apiRoutes } from './apiRoutes.js';

export function registerSubjectsRoutes(router, context) {
  const { randomUUID, z, pool, activityRecordSnapshot, logActivity, publicIdFor, publicizeRows, resolvePublicId, generateRecordCode, displayNameSchema, idParam, parse, schoolManager, academic, includeDeletedRecords, linkedTeacherId, createdAtQuery, createdAtFilter, createdAtOrder, requestedPage } = context;

  router.get(apiRoutes.subjects.collection, academic, async (req, res) => {
    const includeDeleted = includeDeletedRecords(req);
    const teacherId = await linkedTeacherId(req);
    const filters = parse(z.object({
      q: z.string().max(100).optional(),
      status: z.enum(['Active', 'Inactive']).optional()
    }), req.query);
    const createdFilters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(createdFilters, 's.created_at');
    const page = requestedPage(req);
    const search = filters.q ? `%${filters.q}%` : null;
    const whereSql = `
      WHERE (? = 1 OR s.is_deleted = 0)
        AND (? IS NULL OR s.active = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = ? AND ta.subject_id = s.id AND ta.active = 1))
        AND (? IS NULL OR s.code LIKE ? OR s.name LIKE ? OR COALESCE(s.description, '') LIKE ?)
        ${createdRange.sql}
    `;
    const active = filters.status === undefined ? null : filters.status === 'Active';
    const params = [includeDeleted, active, active, teacherId, teacherId, search, search, search, search, ...createdRange.params];
    const [countResult, rowsResult] = page
      ? await Promise.all([
        pool.execute(`SELECT COUNT(*) AS total FROM subjects s ${whereSql}`, params),
        pool.execute(`
      SELECT s.* FROM subjects s
      ${whereSql}
      ${createdAtOrder(createdFilters, 's.created_at', 's.id')} LIMIT ? OFFSET ?
    `, [...params, page.pageSize, page.offset])
      ])
      : [null, await pool.execute(`
        SELECT s.* FROM subjects s
        ${whereSql}
        ${createdAtOrder(createdFilters, 's.created_at', 's.id')}
      `, params)];
    const rows = await publicizeRows(pool, 'subjects', rowsResult[0]);
    if (page) return res.json({ rows, total: Number(countResult[0][0].total), page: page.page, page_size: page.pageSize });
    res.json(rows);
  });
  router.post(apiRoutes.subjects.collection, schoolManager, async (req, res) => {
    const data = parse(z.object({
      code: z.string().trim().min(1).max(30).optional(), name: displayNameSchema(120),
      description: z.string().max(500).optional().nullable()
    }), req.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute('INSERT INTO subjects (code, name, description) VALUES (?, ?, ?)',
        [data.code || `TMP-${randomUUID().slice(0, 12)}`, data.name, data.description || null]);
      if (!data.code) {
        data.code = generateRecordCode('subjects', result.insertId);
        await connection.execute('UPDATE subjects SET code = ? WHERE id = ?', [data.code, result.insertId]);
      }
      await logActivity(connection, req.session.user.internalId, 'created', 'subject', result.insertId);
      const id = await publicIdFor(connection, 'subjects', result.insertId);
      await connection.commit();
      res.status(201).json({ id, code: data.code });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Subject code already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.patch(apiRoutes.subjects.item, schoolManager, async (req, res) => {
    const { id: publicSubjectId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'subjects', publicSubjectId);
    const data = parse(z.object({
      code: z.string().trim().min(1).max(30).optional(),
      name: displayNameSchema(120).optional(),
      description: z.string().max(500).nullable().optional(),
      active: z.boolean().optional()
    }), req.body);
    const fields = Object.keys(data);
    if (!fields.length) return res.status(400).json({ error: 'No subject fields provided' });
    try {
      const recordBefore = await activityRecordSnapshot(pool, 'subject', id);
      const [result] = await pool.execute(
        `UPDATE subjects SET ${fields.map(key => `${key} = ?`).join(', ')} WHERE id = ?`,
        [...fields.map(key => data[key] ?? null), id]
      );
      if (!result.affectedRows) return res.status(404).json({ error: 'Subject not found' });
      await logActivity(pool, req.session.user.internalId, 'updated', 'subject', id, { fields, record_before: recordBefore });
      res.json({ success: true });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Subject code already exists' });
      throw error;
    }
  });
}
