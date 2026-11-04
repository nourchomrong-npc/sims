import { apiRoutes } from './apiRoutes.js';

export function registerTrashRoutes(router, context) {
  const { z, pool, requireAuth, requirePasswordChanged, logError, activityRecordSnapshot, logActivity, deleteStudentPhotoIfUnreferenced, resolvePublicId, parse, publicId, admin, schoolManager, invalidateUserSessions, createdAtQuery, createdAtFilter, validateClassSchedule, trashEntities } = context;

  router.get(apiRoutes.trash.collection, requireAuth, requirePasswordChanged, schoolManager, async (req, res) => {
    const filters = parse(createdAtQuery, req.query);
    const createdRange = createdAtFilter(filters, 'trash_rows.deleted_at');
    const [rows] = await pool.execute(`
      SELECT * FROM (
      SELECT trash.entity_type AS entity, student.public_id AS id, student.english_name AS display_name,
        student.student_code AS description, student.status, trash.deleted_at
      FROM trash_records trash JOIN students student ON student.public_id = trash.record_public_id AND student.is_deleted = 1
      WHERE trash.entity_type = 'students'
      UNION ALL
      SELECT trash.entity_type, teacher.public_id, teacher.full_name, teacher.teacher_code, teacher.employment_status, trash.deleted_at
      FROM trash_records trash JOIN teachers teacher ON teacher.public_id = trash.record_public_id AND teacher.is_deleted = 1
      WHERE trash.entity_type = 'teachers'
      UNION ALL
      SELECT trash.entity_type, class_record.public_id, class_record.name, class_record.grade_level,
        CASE WHEN class_record.active = 1 THEN 'Active' ELSE 'Inactive' END, trash.deleted_at
      FROM trash_records trash JOIN classes class_record ON class_record.public_id = trash.record_public_id AND class_record.is_deleted = 1
      WHERE trash.entity_type = 'classes'
      UNION ALL
      SELECT trash.entity_type, subject.public_id, subject.name, subject.code,
        CASE WHEN subject.active = 1 THEN 'Active' ELSE 'Inactive' END, trash.deleted_at
      FROM trash_records trash JOIN subjects subject ON subject.public_id = trash.record_public_id AND subject.is_deleted = 1
      WHERE trash.entity_type = 'subjects'
      UNION ALL
      SELECT trash.entity_type, app_user.public_id, app_user.full_name, app_user.username || ' · ' || app_user.role,
        CASE WHEN app_user.active = 1 THEN 'Active' ELSE 'Inactive' END, trash.deleted_at
      FROM trash_records trash JOIN users app_user ON app_user.public_id = trash.record_public_id AND app_user.is_deleted = 1
      WHERE trash.entity_type = 'users'
      UNION ALL
      SELECT trash.entity_type, assessment.public_id, assessment.title, 'Assessment', 'Hidden', trash.deleted_at
      FROM trash_records trash JOIN assessments assessment ON assessment.public_id = trash.record_public_id AND assessment.is_deleted = 1
      WHERE trash.entity_type = 'assessments'
      UNION ALL
      SELECT trash.entity_type, schedule.public_id,
        COALESCE(class_record.name, 'Class') || ' · ' || COALESCE(subject.name, 'Subject'),
        teacher.full_name,
        CASE WHEN schedule.active = 1 THEN 'Active' ELSE 'Inactive' END, trash.deleted_at
      FROM trash_records trash
      JOIN class_schedules schedule ON schedule.public_id = trash.record_public_id AND schedule.is_deleted = 1
      LEFT JOIN classes class_record ON class_record.id = schedule.class_id
      LEFT JOIN subjects subject ON subject.id = schedule.subject_id
      LEFT JOIN teachers teacher ON teacher.id = schedule.teacher_id
      WHERE trash.entity_type = 'class-schedules'
      ) AS trash_rows
      WHERE TRUE ${createdRange.sql}
      ORDER BY trash_rows.deleted_at ${filters.sort_order === 'oldest' ? 'ASC' : 'DESC'} NULLS LAST,
        trash_rows.entity, trash_rows.display_name
    `, createdRange.params);
    res.json(req.session.user.role === 'SuperAdmin' ? rows : rows.filter(row => row.entity !== 'users'));
  });
  router.post(apiRoutes.trash.restore, requireAuth, requirePasswordChanged, schoolManager, async (req, res) => {
    const { entity, id: publicRecordId } = parse(z.object({
      entity: z.enum(Object.keys(trashEntities)),
      id: publicId
    }), req.params);
    const { table, activityEntity } = trashEntities[entity];
    if (entity === 'users' && req.session.user.role !== 'SuperAdmin') {
      return res.status(403).json({ error: 'Only a SuperAdmin can manage user accounts' });
    }
    const id = await resolvePublicId(pool, table, publicRecordId, 404, true);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[trashRecord]] = await connection.execute(
        'SELECT record_public_id FROM trash_records WHERE entity_type = ? AND record_public_id = ? FOR UPDATE',
        [entity, publicRecordId]
      );
      const [[record]] = await connection.execute(
        `SELECT is_deleted FROM ${table} WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (!trashRecord || !record?.is_deleted) {
        await connection.rollback();
        return res.status(404).json({ error: 'Record is not in Trash or does not exist' });
      }
      if (entity === 'class-schedules') {
        const [[schedule]] = await connection.execute(`
          SELECT class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room
          FROM class_schedules WHERE id = ?
        `, [id]);
        await validateClassSchedule(schedule, id);
      }
      let restoredUserStatus;
      if (entity === 'users') {
        const [[user]] = await connection.execute('SELECT active FROM users WHERE id = ?', [id]);
        restoredUserStatus = user?.active ? 'Active' : 'Inactive';
      }
      await connection.execute(
        `UPDATE ${table} SET is_deleted = 0, deleted_at = NULL WHERE id = ?`,
        [id]
      );
      await connection.execute(
        'DELETE FROM trash_records WHERE entity_type = ? AND record_public_id = ?',
        [entity, publicRecordId]
      );
      const details = entity === 'users' ? {
        changes: [{ field: 'account_status', label: 'Account status', before: 'In Trash', after: restoredUserStatus }],
        summary: `Account status: In Trash → ${restoredUserStatus}`
      } : null;
      await logActivity(connection, req.session.user.internalId, 'restored', activityEntity, id, details);
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  router.delete(apiRoutes.trash.item, requireAuth, requirePasswordChanged, admin, async (req, res) => {
    const { entity, id: publicRecordId } = parse(z.object({
      entity: z.enum(Object.keys(trashEntities)),
      id: publicId
    }), req.params);
    const { table, activityEntity } = trashEntities[entity];
    if (entity === 'users' && req.session.user.role !== 'SuperAdmin') {
      return res.status(403).json({ error: 'Only a SuperAdmin can manage user accounts' });
    }
    const id = await resolvePublicId(pool, table, publicRecordId, 404, true);
    const connection = await pool.getConnection();
    let photoUrl = null;
    let photoCleanupPending = false;
    try {
      await connection.beginTransaction();
      const [[trashRecord]] = await connection.execute(
        'SELECT record_public_id FROM trash_records WHERE entity_type = ? AND record_public_id = ? FOR UPDATE',
        [entity, publicRecordId]
      );
      if (!trashRecord) {
        await connection.rollback();
        return res.status(404).json({ error: 'Record is not in Trash or does not exist' });
      }
      const recordBefore = await activityRecordSnapshot(connection, activityEntity, id);
      if (entity === 'students') {
        const [[student]] = await connection.execute(
          'SELECT photo_url FROM students WHERE id = ? AND is_deleted = 1 FOR UPDATE',
          [id]
        );
        if (!student) {
          await connection.rollback();
          return res.status(404).json({ error: 'Record is not in Trash or does not exist' });
        }
        photoUrl = student.photo_url;
      }
      let deletedUserSnapshot = null;
      let deletedUserStatus = 'In Trash';
      if (entity === 'users') {
        const [[otherAdmin]] = await connection.execute(
          "SELECT id FROM users WHERE role = 'SuperAdmin' AND active = 1 AND is_deleted = 0 AND id <> ? LIMIT 1",
          [id]
        );
        if (!otherAdmin) {
          await connection.rollback();
          return res.status(409).json({ error: 'The last administrator account cannot be permanently deleted' });
        }
        const [[deletedUser]] = await connection.execute(
          'SELECT id, username, full_name, role FROM users WHERE id = ? FOR UPDATE',
          [id]
        );
        deletedUserSnapshot = deletedUser ? {
          id: String(deletedUser.id),
          display_name: deletedUser.full_name || null,
          username: deletedUser.username || null,
          roles: deletedUser.role ? [deletedUser.role] : []
        } : null;
        await invalidateUserSessions(connection, id);
      }
      const [result] = await connection.execute(
        `DELETE FROM ${table} WHERE id = ? AND is_deleted = 1`,
        [id]
      );
      if (!result.affectedRows) {
        await connection.rollback();
        return res.status(404).json({ error: 'Record is not in Trash or does not exist' });
      }
      await connection.execute(
        'DELETE FROM trash_records WHERE entity_type = ? AND record_public_id = ?',
        [entity, publicRecordId]
      );
      const details = {
        record_before: recordBefore,
        ...(entity === 'users' ? {
        ...(deletedUserSnapshot ? { affected_user: deletedUserSnapshot } : {}),
        changes: [{
          field: 'account_status',
          label: 'Account status',
          before: deletedUserStatus,
          after: 'Permanently deleted'
        }],
        summary: `Account status: ${deletedUserStatus} → Permanently deleted`
        } : {})
      };
      await logActivity(connection, req.session.user.internalId, 'permanently_deleted', activityEntity, id, details);
      await connection.commit();
      if (photoUrl) {
        try {
          await deleteStudentPhotoIfUnreferenced(pool, photoUrl);
        } catch (cleanupError) {
          photoCleanupPending = true;
          logError({ event: 'student_photo_cleanup_failed', requestId: req.requestId, name: cleanupError.name });
        }
      }
      res.json({ success: true, photo_cleanup_pending: photoCleanupPending });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === '23503') {
        return res.status(409).json({ error: 'This record has linked history and cannot be permanently deleted' });
      }
      throw error;
    } finally {
      connection.release();
    }
  });
}
