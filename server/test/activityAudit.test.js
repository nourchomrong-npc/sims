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

const [{ pool }, { default: api }, { configureRateLimiters }] = await Promise.all([
  import('../src/config/db.js'),
  import('../src/routes/api.js'),
  import('../src/middleware/rateLimit.js')
]);
configureRateLimiters(null);

test('user updates audit historical identities and only actual changes in one transaction', async t => {
  const userPublicId = 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1';
  const teacherPublicId = 'e190c068-0710-4301-8c28-59e20d88c790';
  const actorPublicId = 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190';
  let target = null;
  const events = [];
  let invalidatedSessions = 0;
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;

  pool.execute = async (sql, params = []) => {
    if (sql.includes('SELECT id FROM users WHERE public_id = ?')) return [[{ id: 22 }], []];
    if (sql.includes('SELECT id FROM teachers WHERE public_id = ?')) return [[{ id: 12 }], []];
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) return [[{ active: true, is_deleted: false }], []];
    throw new Error(`Unexpected pool query in activity audit test: ${sql}`);
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql, params = []) {
      if (sql.includes('SELECT id, username, full_name, role, teacher_id, active FROM users WHERE id = ? FOR UPDATE')) {
        return [[{ ...target }], []];
      }
      if (sql.includes('SELECT id FROM teachers WHERE id = ? FOR UPDATE')) return [[{ id: 12 }], []];
      if (sql.includes('SELECT id, username, full_name, role FROM users WHERE teacher_id = ? FOR UPDATE')) {
        return [[{ id: target.id, username: target.username, full_name: target.full_name, role: target.role }], []];
      }
      if (sql.includes('SELECT * FROM users WHERE id = ?')) {
        return [[{ ...target, id: target.id, public_id: userPublicId }], []];
      }
      if (sql.includes('SELECT * FROM teachers WHERE id = ?')) {
        return [[{ id: 12, public_id: teacherPublicId, full_name: 'Teacher Name Updated', teacher_code: 'T-12' }], []];
      }
      if (sql.includes('SELECT id, public_id, username, full_name, role FROM users WHERE id = ?')) {
        const identity = Number(params[0]) === 9
          ? { id: 9, public_id: actorPublicId, username: 'operator', full_name: 'Operator Name', role: 'SuperAdmin' }
          : { id: target.id, public_id: userPublicId, username: target.username, full_name: target.full_name, role: target.role };
        return [[identity], []];
      }
      if (sql.includes("SELECT id FROM teachers WHERE id = ? AND employment_status = 'Active'")) {
        return [[{ id: 12 }], []];
      }
      if (sql.includes("SELECT COUNT(*) AS total FROM users WHERE role = 'SuperAdmin'")) {
        return [[{ total: 2 }], []];
      }
      if (sql.includes('SELECT public_id FROM teachers WHERE id = ?')) return [[{ public_id: teacherPublicId }], []];
      if (sql.startsWith('UPDATE users SET username = ?')) {
        [target.username, target.full_name, target.role, target.active, target.teacher_id] = params;
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('UPDATE teachers SET')) return [{ affectedRows: 1 }, []];
      if (sql.startsWith('UPDATE users SET full_name = ?')) {
        target.full_name = params[0];
        return [{ affectedRows: 1 }, []];
      }
      if (sql.startsWith('DELETE FROM user_sessions WHERE')) {
        invalidatedSessions += 1;
        return [{ affectedRows: 0 }, []];
      }
      if (sql.includes('INSERT INTO activity_logs')) {
        events.push(JSON.parse(params[4]));
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected connection query in activity audit test: ${sql}`);
    }
  });
  t.after(() => {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { role: 'SuperAdmin', internalId: 9 } };
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
  const endpoint = `http://127.0.0.1:${server.address().port}/api/users/${userPublicId}`;

  async function update(initialUser, fields) {
    target = { id: 22, username: 'ABC', full_name: 'Before Name', role: 'SuperAdmin', active: 1, teacher_id: null, ...initialUser };
    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields)
    });
    assert.equal(response.status, 200, (await response.clone().text()));
    return events.at(-1);
  }

  const combined = await update({}, { username: 'CBA', role: 'Teacher', teacher_id: teacherPublicId });
  assert.deepEqual(combined.changes.filter(change => ['username', 'role'].includes(change.field)), [
    { field: 'username', label: 'Username', before: 'ABC', after: 'CBA' },
    { field: 'role', label: 'Role', before: 'SuperAdmin', after: 'Teacher' }
  ]);
  assert.match(combined.summary, /ABC \/ SuperAdmin → CBA \/ Teacher/);
  assert.deepEqual(combined.actor, {
    id: '9',
    public_id: actorPublicId,
    display_name: 'Operator Name',
    username: 'operator',
    roles: ['SuperAdmin']
  });
  assert.deepEqual(combined.affected_user, {
    id: '22',
    public_id: userPublicId,
    display_name: 'Before Name',
    username: 'CBA',
    roles: ['Teacher']
  });

  const usernameOnly = await update({}, { username: 'CBA' });
  assert.deepEqual(usernameOnly.changes.map(change => change.field), ['username']);
  assert.equal(usernameOnly.summary, 'Username: ABC → CBA');

  const roleOnly = await update({}, { role: 'School Manager' });
  assert.deepEqual(roleOnly.changes.map(change => change.field), ['role']);
  assert.equal(roleOnly.summary, 'Role: SuperAdmin → School Manager');

  const accountStatus = await update({}, { active: false });
  assert.deepEqual(accountStatus.changes, [
    { field: 'active', label: 'Account status', before: 'Active', after: 'Inactive' }
  ]);
  assert.ok(invalidatedSessions >= 3, 'role and status changes should invalidate the target account sessions');

  const displayName = await update({}, { full_name: 'After Name' });
  assert.deepEqual(displayName.changes, [
    { field: 'full_name', label: 'Display name', before: 'Before Name', after: 'After Name' }
  ]);

  const eventCount = events.length;
  await update({}, { username: 'ABC' });
  assert.equal(events.length, eventCount, 'unchanged values should not create duplicate audit events');

  target = { id: 22, username: 'ABC', full_name: 'Before Name', role: 'Teacher', active: 1, teacher_id: 12 };
  const teacherResponse = await fetch(`http://127.0.0.1:${server.address().port}/api/teachers/${teacherPublicId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Teacher Name Updated' })
  });
  assert.equal(teacherResponse.status, 200);
  const teacherEvent = events.at(-1);
  assert.deepEqual(teacherEvent.changes, [
    { field: 'full_name', label: 'Display name', before: 'Before Name', after: 'Teacher Name Updated' }
  ]);
  assert.equal(teacherEvent.affected_user.display_name, 'Teacher Name Updated');
});
