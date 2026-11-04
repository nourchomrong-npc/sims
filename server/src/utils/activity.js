import { AsyncLocalStorage } from 'node:async_hooks';

const requestContext = new AsyncLocalStorage();
const activityTables = {
  user: 'users',
  academic_year: 'academic_years',
  student: 'students',
  teacher: 'teachers',
  class: 'classes',
  term: 'terms',
  student_enrollment: 'student_enrollments',
  subject: 'subjects',
  teacher_assignment: 'teacher_assignments',
  class_schedule: 'class_schedules',
  attendance_record: 'attendance_records',
  assessment: 'assessments',
  student_score: 'student_scores',
  grading_scale: 'grading_scales'
};

function browserDetails(userAgent) {
  const browserMatchers = [
    ['Edge', /Edg(?:e|A|iOS)?\/([\d.]+)/],
    ['Opera', /(?:OPR|Opera)\/([\d.]+)/],
    ['Firefox', /(?:Firefox|FxiOS)\/([\d.]+)/],
    ['Chrome', /(?:Chrome|CriOS)\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/]
  ];
  const match = browserMatchers.find(([, pattern]) => pattern.test(userAgent));
  if (!match) return 'Unknown';
  const [, version] = userAgent.match(match[1]);
  return `${match[0]} ${version.split('.')[0]}`;
}

function operatingSystem(userAgent) {
  if (/Windows NT 10\.0/i.test(userAgent)) return 'Windows 10/11';
  if (/Windows NT 6\.3/i.test(userAgent)) return 'Windows 8.1';
  if (/Windows NT 6\.1/i.test(userAgent)) return 'Windows 7';
  if (/Android/i.test(userAgent)) return 'Android';
  if (/iPad/i.test(userAgent)) return 'iPadOS';
  if (/iPhone|iPod/i.test(userAgent)) return 'iOS';
  if (/CrOS/i.test(userAgent)) return 'ChromeOS';
  if (/Mac OS X|Macintosh/i.test(userAgent)) return 'macOS';
  if (/Linux/i.test(userAgent)) return 'Linux';
  return 'Unknown';
}

function deviceType(userAgent) {
  if (/iPad|Tablet/i.test(userAgent)) return 'Tablet';
  if (/Mobile|iPhone|iPod|Android/i.test(userAgent)) return 'Mobile';
  if (/Windows|Macintosh|Mac OS X|Linux|CrOS/i.test(userAgent)) return 'Desktop';
  return 'Unknown';
}

function referrerPath(referrer) {
  if (!referrer) return null;
  try {
    const url = new URL(referrer);
    return `${url.origin}${url.pathname}`.slice(0, 500);
  } catch {
    return null;
  }
}

export function requestActivityDetails(req) {
  const userAgent = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '').slice(0, 500);
  return {
    requestId: req.requestId || null,
    method: String(req.method || 'UNKNOWN').slice(0, 12),
    url: String(req.originalUrl || req.url || '').split('?')[0].slice(0, 500),
    ip: req.ip || req.socket?.remoteAddress || null,
    device: deviceType(userAgent),
    os: operatingSystem(userAgent),
    browser: browserDetails(userAgent),
    userAgent: userAgent || null,
    referrer: referrerPath(req.get?.('referer') || req.headers?.referer),
    language: String(req.get?.('accept-language') || req.headers?.['accept-language'] || '').slice(0, 100) || null
  };
}

export function activityRequestContext(req, res, next) {
  const activityState = { activityLogged: false };
  req.activityLogState = activityState;
  requestContext.run({ ...requestActivityDetails(req), activityState }, next);
}

export function activityLoggedForRequest(req) {
  return req.activityLogState?.activityLogged === true;
}

export function superAdminActivityAudit(db) {
  return (req, res, next) => {
    if (req.session?.user?.role !== 'SuperAdmin' ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
      ['/class-schedules/validate', '/sync/connections/test', '/connections/test'].includes(req.path)) {
      return next();
    }

    const sendJson = res.json.bind(res);
    res.json = body => {
      if (res.statusCode < 200 || res.statusCode >= 300 || body?.unchanged === true || activityLoggedForRequest(req)) {
        return sendJson(body);
      }

      const method = req.method;
      const path = String(req.originalUrl || req.url || '').split('?')[0].slice(0, 500);
      const fields = Object.keys(req.body || {})
        .filter(field => !/(?:password|secret|token|hash|authorization|cookie)/i.test(field));
      logActivity(db, req.session.user.internalId, 'superadmin_action', 'system', null, {
        summary: `SuperAdmin request: ${method} ${path}`,
        fields
      }).then(() => sendJson(body), next);
      return res;
    };
    next();
  };
}

export function activityIdentity(user) {
  if (!user) return null;
  const roles = Array.isArray(user.roles) ? user.roles.filter(Boolean) : user.role ? [user.role] : [];
  return {
    id: user.id == null ? null : String(user.id),
    public_id: user.public_id || null,
    display_name: user.full_name || null,
    username: user.username || null,
    roles
  };
}

export async function getActivityIdentity(db, userId) {
  if (userId == null) return null;
  const [[user]] = await db.execute(
    'SELECT id, public_id, username, full_name, role FROM users WHERE id = ?',
    [userId]
  );
  return activityIdentity(user) || { id: String(userId), public_id: null, display_name: null, username: null, roles: [] };
}

function sanitizeDetails(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeDetails).filter(item => item !== undefined);
  }
  if (!value || typeof value !== 'object') return value;
  if (typeof value.field === 'string' && /(?:password|secret|token|hash)/i.test(value.field)) {
    return undefined;
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:password|secret|token|hash|authorization|cookie)/i.test(key))
    .map(([key, item]) => [key, sanitizeDetails(item)])
    .filter(([, item]) => item !== undefined));
}

export function sanitizeActivityDetails(details) {
  if (details == null) return null;
  const normalized = typeof details === 'object' && !Array.isArray(details)
    ? details
    : { value: details };
  return sanitizeDetails(normalized);
}

export async function activityRecordSnapshot(db, entity, entityId) {
  const table = activityTables[entity];
  if (!table || entityId == null) return null;
  const [[record]] = await db.execute(`SELECT * FROM ${table} WHERE id = ?`, [entityId]);
  if (!record) return null;
  const snapshot = { ...record, public_id: record.public_id || null };
  delete snapshot.id;
  if (entity === 'student') {
    const [[enrollment]] = await db.execute(`
      SELECT c.public_id AS class_id, c.name AS class_name, c.grade_level
      FROM student_enrollments e JOIN classes c ON c.id = e.class_id
      WHERE e.student_id = ? AND e.current = 1
      ORDER BY e.id DESC LIMIT 1
    `, [entityId]);
    snapshot.class_id = enrollment?.class_id ?? null;
    snapshot.class_name = enrollment?.class_name ?? null;
    snapshot.class_grade_level = enrollment?.grade_level ?? null;
    if (record.photo_url) {
      const [[photo]] = await db.execute(
        'SELECT title FROM student_photos WHERE url = ? LIMIT 1',
        [record.photo_url]
      );
      if (photo?.title) snapshot.photo_title = photo.title;
    }
  }
  return sanitizeActivityDetails(snapshot);
}

export async function hydrateActivityRecordTimestamps(db, rows) {
  const grouped = new Map();
  const candidates = [];
  const attendanceCandidates = [];
  for (const row of rows) {
    let details = row.details;
    if (typeof details === 'string') {
      try {
        details = JSON.parse(details);
      } catch {
        details = null;
      }
    }
    if (row.action === 'recorded_attendance') {
      const scheduleId = details?.class_schedule_id;
      const date = details?.date || details?.attendance_date;
      const students = Array.isArray(details?.affected_students) ? details.affected_students : [];
      const studentCodes = students
        .filter(student => !student.created_at && !student.updated_at && student.student_code)
        .map(student => student.student_code);
      if (row.entity_id != null && /^\d+$/.test(String(scheduleId)) && date && studentCodes.length) {
        attendanceCandidates.push({ row, details, students, scheduleId, date, studentCodes });
      }
      continue;
    }
    if (row.entity_id == null) continue;
    const table = activityTables[row.entity];
    if (!table) continue;
    const timestamps = details?.record_timestamps;
    const snapshot = details?.record_after || details?.record_before;
    if (timestamps?.created_at || timestamps?.updated_at || snapshot?.created_at || snapshot?.updated_at) continue;
    if (!grouped.has(table)) grouped.set(table, new Set());
    grouped.get(table).add(String(row.entity_id));
    candidates.push({ row, table, details: details && typeof details === 'object' ? details : {} });
  }

  const timestampsByRecord = new Map();
  await Promise.all([...grouped].map(async ([table, ids]) => {
    const values = [...ids];
    const [records] = await db.execute(
      `SELECT id, created_at, updated_at FROM ${table} WHERE id IN (${values.map(() => '?').join(', ')})`,
      values
    );
    for (const record of records) {
      timestampsByRecord.set(`${table}:${record.id}`, {
        created_at: record.created_at ?? null,
        updated_at: record.updated_at ?? null
      });
    }
  }));

  await Promise.all(attendanceCandidates.map(async ({ row, details, students, scheduleId, date, studentCodes }) => {
    const [records] = await db.execute(`
      SELECT student.student_code, attendance.created_at, attendance.updated_at
      FROM attendance_records attendance
      JOIN students student ON student.id = attendance.student_id
      WHERE attendance.class_id = ? AND attendance.schedule_id = ? AND attendance.attendance_date = ?
        AND student.student_code IN (${studentCodes.map(() => '?').join(', ')})
    `, [row.entity_id, scheduleId, date, ...studentCodes]);
    const recordsByStudent = new Map(records.map(record => [record.student_code, record]));
    let hydrated = false;
    const affectedStudents = students.map(student => {
      if (student.created_at || student.updated_at) return student;
      const record = recordsByStudent.get(student.student_code);
      if (!record) return student;
      hydrated = true;
      return {
        ...student,
        created_at: record.created_at ?? null,
        updated_at: record.updated_at ?? null,
        timestamps_source: 'current_record'
      };
    });
    if (hydrated) {
      row.details = {
        ...details,
        affected_students: affectedStudents,
        record_timestamps_source: 'current_record'
      };
    }
  }));

  for (const { row, table, details } of candidates) {
    const timestamps = timestampsByRecord.get(`${table}:${row.entity_id}`);
    if (!timestamps) continue;
    row.details = {
      ...details,
      record_timestamps: timestamps,
      record_timestamps_source: 'current_record'
    };
  }
  return rows;
}

export function activityRecordChanges(before, after) {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const field of keys) {
    if (field === 'public_id' || field === 'photo_title') continue;
    if (field === 'photo_url') {
      const photoChanged = JSON.stringify(before.photo_url ?? null) !== JSON.stringify(after.photo_url ?? null);
      const titleChanged = JSON.stringify(before.photo_title ?? null) !== JSON.stringify(after.photo_title ?? null);
      if (!photoChanged && !titleChanged) continue;
      changes.push({
        field,
        label: 'Photo',
        before: before.photo_url ?? null,
        after: after.photo_url ?? null,
        ...(Object.hasOwn(before, 'photo_title') || Object.hasOwn(after, 'photo_title') ? {
          before_title: before.photo_title ?? null,
          after_title: after.photo_title ?? null
        } : {})
      });
      continue;
    }
    if (JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null)) changes.push({
      field,
      label: field.replaceAll('_', ' ').replace(/\b\w/g, character => character.toUpperCase()),
      before: before[field] ?? null,
      after: after[field] ?? null
    });
  }
  if (!keys.has('photo_url') && (before.photo_title ?? null) !== (after.photo_title ?? null)) {
    changes.push({
      field: 'photo_title',
      label: 'Photo Title',
      before: before.photo_title ?? null,
      after: after.photo_title ?? null
    });
  }
  return changes;
}

export async function logActivity(db, userId, action, entity, entityId, details = null, options = {}) {
  const request = requestContext.getStore();
  const { activityState, ...requestDetails } = request || {};
  const actor = options.actorSnapshot || await getActivityIdentity(db, userId);
  const affectedUser = entity === 'user' && entityId != null
    ? await getActivityIdentity(db, entityId)
    : null;
  const recordAfter = details?.record_after || (options.skipRecordSnapshot !== true &&
    ['created', 'updated', 'archived', 'restored', 'moved_to_trash'].includes(action)
    ? await activityRecordSnapshot(db, entity, entityId)
    : null);
  const timestampSource = recordAfter || details?.record_before;
  let recordTimestamps = timestampSource &&
    (Object.hasOwn(timestampSource, 'created_at') || Object.hasOwn(timestampSource, 'updated_at'))
    ? {
      created_at: timestampSource.created_at ?? null,
      updated_at: timestampSource.updated_at ?? null
    }
    : null;
  if (!recordTimestamps && activityTables[entity] && entityId != null) {
    const [[timestamps]] = await db.execute(
      `SELECT created_at, updated_at FROM ${activityTables[entity]} WHERE id = ?`,
      [entityId]
    );
    if (timestamps) {
      recordTimestamps = {
        created_at: timestamps.created_at ?? null,
        updated_at: timestamps.updated_at ?? null
      };
    }
  }
  const recordChanges = details?.record_before && recordAfter
    ? sanitizeActivityDetails({ changes: activityRecordChanges(details.record_before, recordAfter) })?.changes
    : undefined;
  const changes = details?.changes || recordChanges;
  const summary = details?.summary || (changes?.length
    ? changes.map(change => `${change.label}: ${change.before ?? 'Not recorded'} → ${change.after ?? 'Not recorded'}`).join(' · ')
    : undefined);
  const activityDetails = sanitizeActivityDetails({
    ...(details && typeof details === 'object' && !Array.isArray(details) ? details : details == null ? {} : { value: details }),
    ...(recordAfter ? { record_after: recordAfter } : {}),
    ...(recordTimestamps ? { record_timestamps: recordTimestamps } : {}),
    ...(changes ? { changes } : {}),
    ...(summary ? { summary } : {}),
    actor,
    ...(affectedUser && !details?.affected_user ? { affected_user: affectedUser } : {}),
    ...(request ? { request: requestDetails } : {})
  });
  await db.execute(
    'INSERT INTO activity_logs (user_id, action, entity, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    [userId, action, entity, entityId, activityDetails == null ? null : JSON.stringify(activityDetails)]
  );
  if (activityState) activityState.activityLogged = true;
}
