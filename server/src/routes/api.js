import { Router } from 'express';
import { apiRoutes } from './apiRoutes.js';
import bcrypt from 'bcrypt';
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, runWithAcademicYearContext } from '../config/db.js';
import { requireAuth, requirePasswordChanged, requireRole } from '../middleware/auth.js';
import { expensiveLimiter, loginLimiter, sensitiveAuthLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { logError } from '../utils/logger.js';
import { activityRecordChanges, activityRecordSnapshot, activityRequestContext, getActivityIdentity, hydrateActivityRecordTimestamps, logActivity, sanitizeActivityDetails, superAdminActivityAudit } from '../utils/activity.js';
import { deleteStudentPhoto, deleteStudentPhotoIfUnreferenced, readStudentPhoto, recordStudentPhoto, saveStudentPhoto, studentPhotoContentType, studentPhotoPublicId } from '../utils/studentPhotos.js';
import { publicIdFor, publicizeEntityIds, publicizeRows, resolvePublicId, resolvePublicIds } from '../utils/publicIds.js';
import { generateRecordCode } from '../utils/recordCodes.js';
import searchRouter from './search.js';
import { registerTrashRoutes } from './trash.js';
import { registerAuthRoutes } from './auth.js';
import { registerStudentsRoutes } from './students.js';
import { registerTeachersRoutes } from './teachers.js';
import { registerClassesRoutes } from './classes.js';
import { registerSubjectsRoutes } from './subjects.js';
import { registerAcademicsRoutes } from './academics.js';
import dashboardRouter from './dashboard.js';
import { registerReportsRoutes } from './reports.js';
import { registerUsersRoutes } from './users.js';
import { registerSchoolSetupRoutes } from './schoolSetup.js';
import { registerAcademicYearTransitionRoutes } from './academicYearTransitions.js';
import { academicYearInput, displayNameSchema, idParam, loginInput, parse, publicId, studentInput } from '../utils/validation.js';

const router = Router();
router.use(activityRequestContext);
router.use(superAdminActivityAudit(pool));
const superAdmin = requireRole('SuperAdmin');
const admin = requireRole('Admin', 'SuperAdmin');
const manager = admin;
const schoolManager = requireRole('Admin', 'SuperAdmin', 'School Manager');
const userManager = requireRole('SuperAdmin', 'Admin', 'School Manager');
const academic = requireRole('Admin', 'SuperAdmin', 'School Manager', 'Teacher');
const assignableUserRoles = {
  SuperAdmin: ['Admin', 'Teacher', 'School Manager'],
  Admin: ['Teacher', 'School Manager'],
  'School Manager': ['Teacher']
};
function canManageUserRole(actorRole, targetRole) {
  return actorRole === 'SuperAdmin' || Boolean(assignableUserRoles[actorRole]?.includes(targetRole));
}
let dummyPasswordHash;

async function verifyPassword(password, storedHash) {
  if (!storedHash) {
    if (!dummyPasswordHash) {
      dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), 12);
    }
    storedHash = await dummyPasswordHash;
  }
  return bcrypt.compare(password, storedHash);
}

function generateTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  const bytes = randomBytes(18);
  let password = '';
  for (const byte of bytes) {
    password += alphabet[byte % alphabet.length];
  }
  return password;
}

async function invalidateUserSessions(connection, userId) {
  await connection.execute(
    `DELETE FROM user_sessions WHERE CAST(sess -> 'user' ->> 'internalId' AS BIGINT) = ?`,
    [userId]
  );
}

function includeDeletedRecords(req) {
  const { include_deleted: includeDeleted } = parse(
    z.object({ include_deleted: z.enum(['true', 'false']).optional() }),
    req.query
  );
  if (includeDeleted === 'true' && !['Admin', 'SuperAdmin', 'School Manager'].includes(req.session.user.role)) {
    throw Object.assign(new Error('Insufficient permission to view hidden records'), { status: 403 });
  }
  return includeDeleted === 'true';
}

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

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  page_size: z.coerce.number().int().min(1).max(100).optional()
});

const createdAtQuery = z.object({
  created_from: z.string().date().optional(),
  created_to: z.string().date().optional(),
  sort_order: z.enum(['latest', 'oldest']).default('latest')
}).refine(value => !value.created_from || !value.created_to || value.created_from <= value.created_to, {
  path: ['created_to'], message: 'End date must not be before start date'
});

function createdAtFilter(filters, column) {
  const clauses = [];
  const params = [];
  if (filters.created_from) {
    clauses.push(`${column} >= ?`);
    params.push(filters.created_from);
  }
  if (filters.created_to) {
    const nextDay = new Date(`${filters.created_to}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    clauses.push(`${column} < ?`);
    params.push(nextDay.toISOString().slice(0, 10));
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

function createdAtOrder(filters, column, idColumn) {
  const direction = filters.sort_order === 'oldest' ? 'ASC' : 'DESC';
  return `ORDER BY ${column} ${direction} NULLS LAST, ${idColumn} ${direction}`;
}

function requestedPage(req) {
  const filters = parse(paginationQuery, req.query);
  if (filters.page === undefined && filters.page_size === undefined) return null;
  const page = filters.page || 1;
  const pageSize = filters.page_size || 25;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const classScheduleInput = z.object({
  class_id: publicId,
  subject_id: publicId,
  teacher_id: publicId,
  day_of_week: z.coerce.number().int().min(1).max(7),
  start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  room: z.string().trim().max(80).nullable().optional()
});

async function validateScheduleAssignment(data, executor = pool) {
  const [[assignment]] = await executor.execute(`
    SELECT c.id FROM teacher_assignments ta
    JOIN classes c ON c.id = ta.class_id AND c.active = 1 AND c.is_deleted = 0
    JOIN subjects s ON s.id = ta.subject_id AND s.active = 1 AND s.is_deleted = 0
    JOIN teachers t ON t.id = ta.teacher_id AND t.employment_status = 'Active' AND t.is_deleted = 0
    WHERE ta.class_id = ? AND ta.subject_id = ? AND ta.teacher_id = ? AND ta.active = 1
      AND ta.academic_year_id = c.academic_year_id
  `, [data.class_id, data.subject_id, data.teacher_id]);
  if (!assignment) {
    throw Object.assign(new Error('The teacher must be actively assigned to this subject and class'), { status: 400 });
  }
}

async function validateClassSchedule(data, excludedId = null, executor = pool, ignoredIds = []) {
  if (data.end_time <= data.start_time) {
    throw Object.assign(new Error('The schedule end time must be after its start time'), { status: 400 });
  }
  await validateScheduleAssignment(data, executor);
  const [[conflict]] = await executor.execute(`
    SELECT existing_schedule.id FROM class_schedules existing_schedule
    JOIN classes existing_class ON existing_class.id = existing_schedule.class_id
    JOIN classes requested_class ON requested_class.id = ?
    WHERE existing_schedule.active = 1 AND existing_schedule.is_deleted = 0 AND existing_schedule.day_of_week = ?
      AND (existing_schedule.class_id = ? OR ((existing_schedule.teacher_id = ? OR
        (?::text IS NOT NULL AND existing_schedule.room = ?)) AND existing_class.academic_year_id = requested_class.academic_year_id))
      AND existing_schedule.start_time < ? AND existing_schedule.end_time > ?
      AND (? IS NULL OR existing_schedule.id <> ?)
      ${ignoredIds.length ? `AND existing_schedule.id NOT IN (${ignoredIds.map(() => '?').join(', ')})` : ''}
    LIMIT 1
  `, [data.class_id, data.day_of_week, data.class_id, data.teacher_id, data.room || null, data.room || null,
    data.end_time, data.start_time, excludedId, excludedId, ...ignoredIds]);
  if (conflict) {
    throw Object.assign(new Error('This time overlaps another schedule for the selected class, teacher, or room'), { status: 409 });
  }
}

async function resolveClassScheduleIds(data) {
  return {
    ...data,
    class_id: await resolvePublicId(pool, 'classes', data.class_id, 400),
    subject_id: await resolvePublicId(pool, 'subjects', data.subject_id, 400),
    teacher_id: await resolvePublicId(pool, 'teachers', data.teacher_id, 400)
  };
}

function registerVisibilityRoutes(endpoint, table, entity, middleware) {
  const hideHandler = async (req, res) => {
    const { id: publicRecordId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, table, publicRecordId, 404, true);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[record]] = await connection.execute(
        `SELECT * FROM ${table} WHERE id = ? FOR UPDATE`,
        [id]
      );
      if (!record || record.is_deleted) {
        await connection.rollback();
        return res.status(404).json({ error: 'Record is already in Trash or does not exist' });
      }
      if (['classes', 'assessments', 'class_schedules'].includes(table)) {
        const yearSql = table === 'classes'
          ? 'SELECT academic_year_id FROM classes WHERE id = ?'
          : table === 'assessments'
            ? 'SELECT c.academic_year_id FROM assessments item JOIN classes c ON c.id = item.class_id WHERE item.id = ?'
            : 'SELECT c.academic_year_id FROM class_schedules item JOIN classes c ON c.id = item.class_id WHERE item.id = ?';
        const [[yearRecord]] = await connection.execute(yearSql, [id]);
        if (!yearRecord || String(yearRecord.academic_year_id) !== String(req.academicYearId || 0)) {
          await connection.rollback();
          return res.status(404).json({ error: 'Record not found in the selected academic year' });
        }
      }
      const recordBefore = await activityRecordSnapshot(connection, entity, id);
      if (table === 'users' && id === req.session.user.internalId) {
        await connection.rollback();
        return res.status(400).json({ error: 'You cannot delete your own account' });
      }
      let userTarget = null;
      if (table === 'users') {
        [[userTarget]] = await connection.execute('SELECT role, active FROM users WHERE id = ?', [id]);
        if (userTarget?.role === 'SuperAdmin' && userTarget.active) {
          const [[admins]] = await connection.execute(
            "SELECT COUNT(*) AS total FROM users WHERE role = 'SuperAdmin' AND active = 1 AND is_deleted = 0"
          );
          if (Number(admins.total) <= 1) {
            await connection.rollback();
            return res.status(400).json({ error: 'The last active administrator cannot be moved to Trash' });
          }
        }
      }
      await connection.execute(
        `UPDATE ${table} SET is_deleted = 1, deleted_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [id]
      );
      if (table === 'users') await invalidateUserSessions(connection, id);
      await connection.execute(`
        INSERT INTO trash_records (entity_type, record_public_id, deleted_at, deleted_by)
        VALUES (?, ?, CURRENT_TIMESTAMP, ?)
        ON CONFLICT (entity_type, record_public_id)
        DO UPDATE SET deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by
        RETURNING record_public_id
      `, [endpoint, record.public_id, req.session.user.internalId]);
      const details = table === 'users' ? {
        changes: [{
          field: 'account_status',
          label: 'Account status',
          before: userTarget?.active ? 'Active' : 'Inactive',
          after: 'In Trash'
        }],
        summary: `Account status: ${userTarget?.active ? 'Active' : 'Inactive'} → In Trash`
      } : {};
      details.record_before = recordBefore;
      await logActivity(connection, req.session.user.internalId, 'moved_to_trash', entity, id, details);
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  const restoreHandler = async (req, res) => {
    const { id: publicRecordId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, table, publicRecordId, 404, true);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[record]] = await connection.execute(
        `SELECT * FROM ${table} WHERE id = ? FOR UPDATE`,
        [id]
      );
      let trashRecord;
      if (record?.is_deleted) {
        [[trashRecord]] = await connection.execute(
          'SELECT record_public_id FROM trash_records WHERE entity_type = ? AND record_public_id = ? FOR UPDATE',
          [endpoint, record.public_id]
        );
      }
      if (!record?.is_deleted || !trashRecord) {
        await connection.rollback();
        return res.status(404).json({ error: 'Record is already visible or does not exist' });
      }
      if (['classes', 'assessments', 'class_schedules'].includes(table)) {
        const yearSql = table === 'classes'
          ? 'SELECT academic_year_id FROM classes WHERE id = ?'
          : table === 'assessments'
            ? 'SELECT c.academic_year_id FROM assessments item JOIN classes c ON c.id = item.class_id WHERE item.id = ?'
            : 'SELECT c.academic_year_id FROM class_schedules item JOIN classes c ON c.id = item.class_id WHERE item.id = ?';
        const [[yearRecord]] = await connection.execute(yearSql, [id]);
        if (!yearRecord || String(yearRecord.academic_year_id) !== String(req.academicYearId || 0)) {
          await connection.rollback();
          return res.status(404).json({ error: 'Record not found in the selected academic year' });
        }
      }
      const recordBefore = await activityRecordSnapshot(connection, entity, id);
      let previousAccountStatus;
      if (table === 'users') {
        const [[user]] = await connection.execute('SELECT active FROM users WHERE id = ?', [id]);
        previousAccountStatus = user?.active ? 'Active' : 'Inactive';
      }
      await connection.execute(
        `UPDATE ${table} SET is_deleted = 0, deleted_at = NULL WHERE id = ?`,
        [id]
      );
      await connection.execute(
        'DELETE FROM trash_records WHERE entity_type = ? AND record_public_id = ?',
        [endpoint, record.public_id]
      );
      const details = table === 'users' ? {
        changes: [{ field: 'account_status', label: 'Account status', before: 'In Trash', after: previousAccountStatus }],
        summary: `Account status: In Trash → ${previousAccountStatus}`
      } : {};
      details.record_before = recordBefore;
      await logActivity(connection, req.session.user.internalId, 'restored', entity, id, details);
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };

  router.post(apiRoutes.visibility.delete.replace(':entity', endpoint), middleware, hideHandler);
  router.put(apiRoutes.visibility.delete.replace(':entity', endpoint), middleware, hideHandler);
  router.patch(apiRoutes.visibility.delete.replace(':entity', endpoint), middleware, hideHandler);
  router.post(apiRoutes.visibility.hide.replace(':entity', endpoint), middleware, hideHandler);
  router.put(apiRoutes.visibility.hide.replace(':entity', endpoint), middleware, hideHandler);
  router.patch(apiRoutes.visibility.hide.replace(':entity', endpoint), middleware, hideHandler);
  router.post(apiRoutes.visibility.restore.replace(':entity', endpoint), middleware, restoreHandler);
  router.put(apiRoutes.visibility.restore.replace(':entity', endpoint), middleware, restoreHandler);
  router.patch(apiRoutes.visibility.restore.replace(':entity', endpoint), middleware, restoreHandler);
}

const trashEntities = {
  students: { table: 'students', activityEntity: 'student' },
  teachers: { table: 'teachers', activityEntity: 'teacher' },
  classes: { table: 'classes', activityEntity: 'class' },
  subjects: { table: 'subjects', activityEntity: 'subject' },
  users: { table: 'users', activityEntity: 'user' },
  assessments: { table: 'assessments', activityEntity: 'assessment' },
  'class-schedules': { table: 'class_schedules', activityEntity: 'class_schedule' }
};




function publicUser(user) {
  return {
    id: user.publicId,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    must_change_password: user.must_change_password
  };
}







async function resetUserPassword(connection, adminUserId, targetId) {
  const [[target]] = await connection.execute('SELECT username, role, active, is_deleted FROM users WHERE id = ?', [targetId]);
  if (!target || target.is_deleted) {
    throw Object.assign(new Error('User not found'), { status: 404 });
  }
  if (targetId === adminUserId) {
    throw Object.assign(new Error('You cannot reset your own account password here'), { status: 400 });
  }
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await bcrypt.hash(temporaryPassword, 12);
  await connection.execute(
    'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
    [passwordHash, targetId]
  );
  await invalidateUserSessions(connection, targetId);
  await logActivity(connection, adminUserId, 'password_reset', 'user', targetId, {
    username: target.username,
    role: target.role,
    temporary_password_issued: true
  });
  return { username: target.username, temporary_password: temporaryPassword };
}

const classScheduleTimeSlotInput = z.object({
  class_id: publicId,
  start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
  end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
}).superRefine((value, context) => {
  if (value.end_time <= value.start_time) {
    context.addIssue({ code: 'custom', path: ['end_time'], message: 'End time must be after start time' });
  }
});

function classTimeSlotError(error) {
  if (error.code === '42P01') {
    return Object.assign(new Error('The class time-slot database migration is missing. Apply database/migrate_class_schedule_time_slots.postgres.sql and retry.'), { status: 503 });
  }
  return error;
}

const scheduleBatchInput = z.object({
  class_id: publicId,
  updates: z.array(z.object({
    id: publicId,
    subject_id: publicId,
    teacher_id: publicId,
    day_of_week: z.coerce.number().int().min(1).max(7),
    start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    room: z.string().trim().max(80).nullable().optional()
  })).max(250),
  creates: z.array(classScheduleInput.omit({ class_id: true })).max(100),
  deletes: z.array(publicId).max(100)
}).superRefine((value, context) => {
  const updatedIds = value.updates.map(item => item.id);
  if (new Set(updatedIds).size !== updatedIds.length ||
      new Set(value.deletes).size !== value.deletes.length ||
      updatedIds.some(id => value.deletes.includes(id))) {
    context.addIssue({ code: 'custom', message: 'A schedule cannot be updated or removed more than once' });
  }
});


function internalDeleteIdsHasId(ids, id) {
  return [...ids.values()].some(value => String(value) === String(id));
}

const routeContext = {
  bcrypt,
  randomBytes,
  randomUUID,
  z,
  pool,
  requireAuth,
  requirePasswordChanged,
  requireRole,
  expensiveLimiter,
  loginLimiter,
  sensitiveAuthLimiter,
  uploadLimiter,
  logError,
  activityRecordChanges,
  activityRecordSnapshot,
  getActivityIdentity,
  hydrateActivityRecordTimestamps,
  logActivity,
  sanitizeActivityDetails,
  deleteStudentPhoto,
  deleteStudentPhotoIfUnreferenced,
  readStudentPhoto,
  recordStudentPhoto,
  saveStudentPhoto,
  studentPhotoContentType,
  studentPhotoPublicId,
  publicIdFor,
  publicizeEntityIds,
  publicizeRows,
  resolvePublicId,
  resolvePublicIds,
  generateRecordCode,
  academicYearInput,
  displayNameSchema,
  idParam,
  loginInput,
  parse,
  publicId,
  studentInput,
  superAdmin,
  admin,
  manager,
  schoolManager,
  userManager,
  academic,
  assignableUserRoles,
  canManageUserRole,
  verifyPassword,
  generateTemporaryPassword,
  invalidateUserSessions,
  includeDeletedRecords,
  linkedTeacherId,
  teacherAssignmentFilter,
  paginationQuery,
  createdAtQuery,
  createdAtFilter,
  createdAtOrder,
  requestedPage,
  classScheduleInput,
  validateScheduleAssignment,
  validateClassSchedule,
  resolveClassScheduleIds,
  registerVisibilityRoutes,
  trashEntities,
  publicUser,
  resetUserPassword,
  classScheduleTimeSlotInput,
  classTimeSlotError,
  scheduleBatchInput,
  internalDeleteIdsHasId
};

registerTrashRoutes(router, routeContext);
registerAuthRoutes(router, routeContext);
router.use(requireAuth, requirePasswordChanged);
router.use(async (req, res, next) => {
  const [[currentYear]] = await pool.execute(
    'SELECT id, public_id FROM academic_years WHERE is_current = 1 LIMIT 1'
  );
  const requestedYearId = req.get('X-Academic-Year-Id');
  let academicYearId = currentYear?.id || null;

  if (requestedYearId) {
    if (!['Admin', 'SuperAdmin'].includes(req.session.user.role)) {
      if (requestedYearId !== currentYear?.public_id) {
        return res.status(403).json({ error: 'Only administrators can switch the academic year.' });
      }
    } else {
      academicYearId = await resolvePublicId(pool, 'academic_years', requestedYearId, 400);
    }
  }

  req.academicYearId = academicYearId;
  runWithAcademicYearContext(academicYearId, next);
});
router.use(searchRouter);
registerStudentsRoutes(router, routeContext);
registerTeachersRoutes(router, routeContext);
registerClassesRoutes(router, routeContext);
registerSubjectsRoutes(router, routeContext);
registerAcademicsRoutes(router, routeContext);
registerAcademicYearTransitionRoutes(router, routeContext);
registerReportsRoutes(router, routeContext);
registerUsersRoutes(router, routeContext);
registerSchoolSetupRoutes(router, routeContext);
router.use(dashboardRouter);
registerVisibilityRoutes('students', 'students', 'student', schoolManager);
registerVisibilityRoutes('teachers', 'teachers', 'teacher', schoolManager);
registerVisibilityRoutes('classes', 'classes', 'class', schoolManager);
registerVisibilityRoutes('subjects', 'subjects', 'subject', schoolManager);
registerVisibilityRoutes('assessments', 'assessments', 'assessment', schoolManager);
registerVisibilityRoutes('users', 'users', 'user', superAdmin);
registerVisibilityRoutes('class-schedules', 'class_schedules', 'class_schedule', schoolManager);

export default router;
