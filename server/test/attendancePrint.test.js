import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

process.env.DB_HOST ||= 'localhost';
process.env.DB_PORT ||= '5432';
process.env.DB_NAME ||= 'test';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.SUPABASE_URL ||= 'https://storage.example.test';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';

const [{ pool }, { default: api }] = await Promise.all([
  import('../src/config/db.js'),
  import('../src/routes/api.js')
]);

test('attendance combines multi-class and multi-word student search filters', async t => {
  const classIds = [
    'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1',
    'e190c068-0710-4301-8c28-59e20d88c790'
  ];
  const originalExecute = pool.execute;
  const capturedQueries = [];
  pool.execute = async (sql, params = []) => {
    if (sql.includes('SELECT id, public_id FROM academic_years WHERE is_current = 1 LIMIT 1')) {
      return [[{ id: 1, public_id: 'cf4dfdf6-bae4-45de-9a5d-c2a89a80e234' }], []];
    }
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) return [[{ active: true, is_deleted: false }], []];
    if (sql.includes('SELECT id, public_id FROM classes WHERE public_id IN')) {
      return [[{ id: 11, public_id: classIds[0] }, { id: 12, public_id: classIds[1] }], []];
    }
    if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('attendance_records ar')) {
      capturedQueries.push({ sql, params });
      return [[{ total: 0 }], []];
    }
    if (sql.includes('SELECT ar.id, ar.public_id, ar.student_id')) {
      capturedQueries.push({ sql, params });
      return [[], []];
    }
    throw new Error(`Unexpected query in attendance print test: ${sql}`);
  };
  t.after(() => {
    pool.execute = originalExecute;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { role: 'Admin', internalId: 1 } };
    next();
  });
  app.use('/api', api);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/attendance?class_ids=${classIds.join(',')}&q=Kunthea%20Ly%20STU-2026-009&status=Absent&page=1&page_size=100`);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { rows: [], total: 0, page: 1, page_size: 100 });
  assert.equal(capturedQueries.length, 2);
  for (const { sql, params } of capturedQueries) {
    assert.match(sql, /ar\.class_id IN \(\?, \?\)/);
    assert.deepEqual(params.slice(4, 6), [11, 12]);
    assert.match(sql, /ar\.status = \?/);
    assert.deepEqual(params.slice(10, 12), ['Absent', 'Absent']);
    assert.equal((sql.match(/s\.english_name ILIKE \? OR s\.student_code ILIKE \?/g) || []).length, 3);
    assert.deepEqual(params.slice(12, 18), [
      '%Kunthea%', '%Kunthea%', '%Ly%', '%Ly%', '%STU-2026-009%', '%STU-2026-009%'
    ]);
    assert.equal((sql.match(/\?/g) || []).length, params.length);
  }
});

test('attendance status updates are audited and unchanged statuses do not create duplicate events', async t => {
  const attendanceId = 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1';
  const actorId = 9;
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  const events = [];
  const record = {
    id: 33, public_id: attendanceId, student_id: 12, class_id: 4, subject_id: 7,
    schedule_id: 8, attendance_date: '2026-10-29', status: 'Present', note: null
  };
  pool.execute = async (sql, params = []) => {
    if (sql.includes('SELECT id, public_id FROM academic_years WHERE is_current = 1 LIMIT 1')) {
      return [[{ id: 1, public_id: 'cf4dfdf6-bae4-45de-9a5d-c2a89a80e234' }], []];
    }
    if (sql.includes('SELECT id FROM attendance_records WHERE public_id = ?')) return [[{ id: record.id }], []];
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) return [[{ active: true, is_deleted: false }], []];
    throw new Error(`Unexpected pool query in attendance status test: ${sql}`);
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      if (sql.includes('FROM attendance_records ar JOIN classes c') && sql.includes('FOR UPDATE')) {
        assert.equal(params[1], 1, 'attendance records are read only for the selected academic year');
        return [[{ ...record }], []];
      }
      if (sql.includes('FROM attendance_records ar') && sql.includes('WHERE ar.id = ?')) {
        return [[{
          english_name: 'Student Example', student_code: 'S-12', class_name: 'Grade 8A',
          grade_level: 'Grade 8', subject_name: 'History', teacher_name: 'Teacher Example',
          teacher_code: 'T-6', day_of_week: 4, start_time: '09:00', end_time: '10:00', room: 'Room 2'
        }], []];
      }
      if (sql.includes('UPDATE attendance_records SET status = ?')) {
        assert.equal(params[3], 1, 'attendance updates are limited to the selected academic year');
        record.status = params[0];
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('SELECT id, public_id, username, full_name, role FROM users WHERE id = ?')) {
        return [[{ id: actorId, public_id: 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190', username: 'admin', full_name: 'Admin User', role: 'Admin' }], []];
      }
      if (sql.includes('SELECT created_at, updated_at FROM attendance_records WHERE id = ?')) {
        return [[{ created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-29T09:00:00.000Z' }], []];
      }
      if (sql.includes('INSERT INTO activity_logs')) {
        events.push(JSON.parse(params[4]));
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected connection query in attendance status test: ${sql}`);
    }
  });
  t.after(() => {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { role: 'Admin', internalId: actorId } };
    next();
  });
  app.use('/api', api);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const endpoint = `http://127.0.0.1:${server.address().port}/api/attendance/${attendanceId}`;
  const update = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'Absent' })
  });
  assert.equal(update.status, 200, await update.clone().text());
  assert.deepEqual(await update.json(), { success: true, status: 'Absent' });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].changes, [{
    field: 'status', label: 'Attendance Status', before: 'Present', after: 'Absent'
  }]);
  assert.equal(events[0].student, 'Student Example');
  assert.equal(events[0].class, 'Grade 8A');
  assert.equal(events[0].subject, 'History');
  assert.equal(events[0].teacher, 'Teacher Example');
  assert.equal(events[0].date, '2026-10-29');
  assert.equal(events[0].record_after, undefined, 'attendance updates should not expose technical row snapshots');

  const unchanged = await fetch(endpoint, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'Absent' })
  });
  assert.equal(unchanged.status, 200, await unchanged.clone().text());
  assert.deepEqual(await unchanged.json(), { success: true, status: 'Absent', unchanged: true });
  assert.equal(events.length, 1);
});

test('teachers can submit attendance and update only their assigned class and subject', async t => {
  const attendanceId = 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1';
  const classPublicId = 'b7a8b1ce-f383-44ab-b5dd-7f28c21d4190';
  const subjectPublicId = 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190';
  const schedulePublicId = '97c8b1ce-f383-44ab-b5dd-7f28c21d4190';
  const studentPublicId = '87c8b1ce-f383-44ab-b5dd-7f28c21d4190';
  const actorId = 9;
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  let assigned = false;
  let updateCount = 0;
  let insertCount = 0;
  const activityEvents = [];
  const record = {
    id: 33, public_id: attendanceId, student_id: 12, class_id: 4, subject_id: 7,
    schedule_id: 8, attendance_date: '2026-10-29', status: 'Present', note: null
  };
  pool.execute = async (sql, params = []) => {
    if (sql.includes('SELECT id, public_id FROM academic_years WHERE is_current = 1 LIMIT 1')) {
      return [[{ id: 1, public_id: 'cf4dfdf6-bae4-45de-9a5d-c2a89a80e234' }], []];
    }
    if (sql.includes('SELECT id FROM attendance_records WHERE public_id = ?')) return [[{ id: record.id }], []];
    if (sql.includes('SELECT id FROM classes WHERE public_id = ?')) return [[{ id: 4 }], []];
    if (sql.includes('SELECT id FROM subjects WHERE public_id = ?')) return [[{ id: 7 }], []];
    if (sql.includes('SELECT id FROM class_schedules WHERE public_id = ?')) return [[{ id: 8 }], []];
    if (sql.includes('SELECT id, public_id FROM students WHERE public_id IN')) {
      return [[{ id: 12, public_id: studentPublicId }], []];
    }
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) return [[{ active: true, is_deleted: false }], []];
    if (sql.includes('SELECT t.id FROM users u JOIN teachers t')) return [[{ id: 6 }], []];
    throw new Error(`Unexpected pool query in teacher attendance test: ${sql}`);
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      if (sql.includes('FROM class_schedules schedule')) {
        return [assigned ? [{
          class_name: 'Grade 8A', grade_level: 'Grade 8', subject_name: 'History',
          teacher_name: 'Teacher Example', teacher_code: 'T-6',
          start_time: '09:00', end_time: '10:00', room: null
        }] : [], []];
      }
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        return [[{ student_id: 12, english_name: 'Student Example', student_code: 'S-12' }], []];
      }
      if (sql.includes('FROM attendance_records ar') && sql.includes('WHERE ar.class_id = ?')) {
        return [[{
          student_id: 12, status: 'Absent', english_name: 'Student Example', student_code: 'S-12'
        }], []];
      }
      if (sql.includes('SELECT student_id, created_at, updated_at') && sql.includes('FROM attendance_records')) {
        return [[{
          student_id: 12,
          created_at: '2026-10-29T08:00:00.000Z',
          updated_at: '2026-10-29T08:00:00.000Z'
        }], []];
      }
      if (sql.includes('FROM attendance_records ar') && sql.includes('WHERE ar.id = ?')) {
        return [[{
          english_name: 'Student Example', student_code: 'S-12', class_name: 'Grade 8A',
          grade_level: 'Grade 8', subject_name: 'History', teacher_name: 'Teacher Example',
          teacher_code: 'T-6', day_of_week: 4, start_time: '09:00', end_time: '10:00', room: null
        }], []];
      }
      if (sql.includes('INSERT INTO attendance_records')) {
        insertCount += 1;
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('FROM attendance_records WHERE id = ? FOR UPDATE')) return [[{ ...record }], []];
      if (sql.includes('FROM teacher_assignments assignment')) return [assigned ? [{ id: 1 }] : [], []];
      if (sql.includes('UPDATE attendance_records SET status = ?')) {
        assert.equal(params[3], 1, 'attendance updates are limited to the selected academic year');
        updateCount += 1;
        record.status = params[0];
        return [{ affectedRows: 1 }, []];
      }
      if (sql.includes('SELECT * FROM attendance_records WHERE id = ?')) return [[{ ...record }], []];
      if (sql.includes('SELECT id, public_id, username, full_name, role FROM users WHERE id = ?')) {
        return [[{ id: actorId, public_id: 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190', username: 'teacher', full_name: 'Teacher User', role: 'Teacher' }], []];
      }
      if (sql.includes('SELECT created_at, updated_at FROM attendance_records WHERE id = ?')) {
        return [[{ created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-29T09:00:00.000Z' }], []];
      }
      if (sql.includes('SELECT created_at, updated_at FROM classes WHERE id = ?')) {
        return [[{ created_at: '2026-09-01T08:00:00.000Z', updated_at: '2026-10-15T08:00:00.000Z' }], []];
      }
      if (sql.includes('INSERT INTO activity_logs')) {
        activityEvents.push(JSON.parse(params[4]));
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected connection query in teacher attendance test: ${sql}`);
    }
  });
  t.after(() => {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { role: 'Teacher', internalId: actorId } };
    next();
  });
  app.use('/api', api);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(error.status || 500).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));

  const endpoint = `http://127.0.0.1:${server.address().port}/api/attendance/${attendanceId}`;
  const submit = assigned => fetch(`http://127.0.0.1:${server.address().port}/api/attendance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      attendance_date: '2026-10-29',
      class_id: classPublicId,
      subject_id: subjectPublicId,
      schedule_id: schedulePublicId,
      records: [{ student_id: studentPublicId, status: 'Present' }]
    })
  });
  const update = status => fetch(endpoint, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status })
  });

  let response = await submit(false);
  assert.equal(response.status, 400, await response.clone().text());
  assert.equal(insertCount, 0, 'unassigned teacher cannot submit attendance');

  assigned = true;
  response = await submit(true);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { success: true, saved: 1, unmarked: 0 });
  assert.equal(insertCount, 1);
  assert.deepEqual(activityEvents.at(-1).changes, [{
    field: 'attendance_status',
    label: 'Student Example · S-12 attendance status',
    before: 'Absent',
    after: 'Present'
  }]);
  assert.equal(activityEvents.at(-1).outcome, 'Attendance saved: 1 marked, 0 unmarked; 1 status change.');
  assert.equal(activityEvents.at(-1).class, 'Grade 8A');
  assert.equal(activityEvents.at(-1).subject, 'History');
  assert.equal(activityEvents.at(-1).grade, 'Grade 8');
  assert.equal(activityEvents.at(-1).date, '2026-10-29');
  assert.deepEqual(activityEvents.at(-1).affected_students, [{
    name: 'Student Example', student_code: 'S-12', status: 'Present',
    created_at: '2026-10-29T08:00:00.000Z', updated_at: '2026-10-29T08:00:00.000Z'
  }]);

  assigned = false;
  response = await update('Absent');
  assert.equal(response.status, 403, await response.clone().text());
  assert.equal(updateCount, 0, 'unassigned teacher cannot update attendance');

  assigned = true;
  response = await update('Absent');
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(await response.json(), { success: true, status: 'Absent' });
  assert.equal(updateCount, 1);
});
