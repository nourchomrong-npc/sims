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

test('user management follows the SuperAdmin, Admin, and School Manager role hierarchy', async t => {
  const originalExecute = pool.execute;
  const originalGetConnection = pool.getConnection;
  let role = 'Admin';
  let targetRole = 'Teacher';
  let listQuery = '';
  let listParams = [];
  pool.execute = async (sql, params = []) => {
    if (sql.includes('SELECT id, public_id FROM academic_years WHERE is_current = 1 LIMIT 1')) {
      return [[{ id: 1, public_id: 'cf4dfdf6-bae4-45de-9a5d-c2a89a80e234' }], []];
    }
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) return [[{ active: true, is_deleted: false }], []];
    if (sql.includes('SELECT id FROM users WHERE public_id = ?')) return [[{ id: 9 }], []];
    if (sql.includes('SELECT COUNT(*) AS total') && sql.includes('FROM users u')) {
      listParams = params;
      return [[{ total: 0 }], []];
    }
    if (sql.includes('SELECT u.id, u.username, u.full_name')) {
      listQuery = sql;
      return [[], []];
    }
    if (sql.includes('FROM trash_records trash')) return [[], []];
    throw new Error(`Unexpected query in role authorization test: ${sql}`);
  };
  pool.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async execute(sql) {
      if (sql.includes('SELECT id, username, full_name, role, teacher_id, active FROM users WHERE id = ? FOR UPDATE')) {
        return [[{ id: 9, username: 'staff', full_name: 'Staff User', role: targetRole, teacher_id: null, active: true }], []];
      }
      throw new Error(`Unexpected connection query in role authorization test: ${sql}`);
    }
  });
  t.after(() => {
    pool.execute = originalExecute;
    pool.getConnection = originalGetConnection;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { role, internalId: 1 } };
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
  const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

  for (const [path, method, body] of [
    ['/users/9b3dc75a-0413-4b66-96d3-68286e52fdc9/hide', 'POST'],
    ['/trash/users/9b3dc75a-0413-4b66-96d3-68286e52fdc9/restore', 'POST'],
    ['/trash/users/9b3dc75a-0413-4b66-96d3-68286e52fdc9', 'DELETE'],
    ['/auth/password/reset', 'POST', { user_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9' }],
    ['/teachers/9b3dc75a-0413-4b66-96d3-68286e52fdc9/generate-account', 'POST']
  ]) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {})
    });
    assert.equal(response.status, 403, `${method} ${path} should be forbidden for Admin: ${await response.clone().text()}`);
  }

  let response = await fetch(`${baseUrl}/users?page=1&page_size=25`);
  assert.equal(response.status, 200);
  assert.match(listQuery, /u\.role IN \(\?, \?\)/);
  assert.match(listQuery, /AND \(\? IS NULL OR u\.role = \?\)/);
  assert.equal(listParams.length, 14, 'Admin user list binds role scope, role filter, and all seven search parameters');
  assert.deepEqual(listParams.slice(3, 5), ['Teacher', 'School Manager']);
  response = await fetch(`${baseUrl}/users?page=1&page_size=25&role=Teacher`);
  assert.equal(response.status, 200);
  assert.deepEqual(listParams.slice(5, 7), ['Teacher', 'Teacher']);
  response = await fetch(`${baseUrl}/users?page=1&page_size=25&role=Admin`);
  assert.equal(response.status, 403, 'Admin cannot filter for Admin accounts');

  const createRequest = roleName => fetch(`${baseUrl}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'new-user', full_name: 'New User', role: roleName })
  });
  response = await createRequest('Admin');
  assert.equal(response.status, 403, 'Admin cannot create another Admin');
  role = 'SuperAdmin';
  response = await createRequest('SuperAdmin');
  assert.equal(response.status, 403, 'SuperAdmin cannot create another SuperAdmin account');

  role = 'Admin';
  response = await fetch(`${baseUrl}/users/9b3dc75a-0413-4b66-96d3-68286e52fdc9`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'Admin' })
  });
  assert.equal(response.status, 403, 'Admin cannot promote a Teacher to Admin');

  role = 'School Manager';
  targetRole = 'School Manager';
  response = await fetch(`${baseUrl}/users?page=1&page_size=25`, {
    headers: { 'X-Academic-Year-Id': 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1' }
  });
  assert.equal(response.status, 403, 'School Manager cannot switch away from the current academic year');
  response = await fetch(`${baseUrl}/users?page=1&page_size=25`);
  assert.equal(response.status, 200);
  assert.match(listQuery, /u\.role IN \(\?\)/);
  assert.equal(listParams.length, 13, 'School Manager user list binds its role scope, role filter, and all seven search parameters');
  assert.equal(listParams[3], 'Teacher');
  response = await fetch(`${baseUrl}/users?page=1&page_size=25&role=Admin`);
  assert.equal(response.status, 403, 'School Manager cannot filter for Admin accounts');
  response = await fetch(`${baseUrl}/users?page=1&page_size=25&role=School%20Manager`);
  assert.equal(response.status, 403, 'School Manager cannot filter for School Manager accounts');
  response = await createRequest('School Manager');
  assert.equal(response.status, 403, 'School Manager cannot create another School Manager');
  response = await createRequest('Teacher');
  assert.equal(response.status, 400, 'School Manager can create Teachers, but must link an active teacher profile');
  response = await fetch(`${baseUrl}/users/9b3dc75a-0413-4b66-96d3-68286e52fdc9`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'Teacher' })
  });
  assert.equal(response.status, 403, 'School Manager cannot update a School Manager account');
  for (const [path, method] of [
    ['/students', 'POST'],
    ['/students/not-a-uuid', 'PATCH'],
    ['/students/not-a-uuid/delete', 'POST'],
    ['/teachers', 'POST'],
    ['/teachers/not-a-uuid', 'PATCH'],
    ['/teachers/not-a-uuid/delete', 'POST'],
    ['/teacher-assignments', 'POST'],
    ['/classes', 'POST'],
    ['/classes/not-a-uuid', 'PATCH'],
    ['/classes/not-a-uuid/delete', 'POST'],
    ['/subjects', 'POST'],
    ['/subjects/not-a-uuid', 'PATCH'],
    ['/subjects/not-a-uuid/delete', 'POST'],
    ['/class-schedules', 'POST'],
    ['/class-schedules/not-a-uuid', 'PATCH'],
    ['/class-schedules/not-a-uuid/delete', 'POST'],
    ['/class-schedules/batch', 'PUT'],
    ['/attendance', 'POST'],
    ['/attendance/9b3dc75a-0413-4b66-96d3-68286e52fdc9', 'PATCH']
  ]) {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 400, `${method} ${path} should reach School Manager input validation: ${await response.clone().text()}`);
  }
  response = await fetch(`${baseUrl}/trash`);
  assert.equal(response.status, 200, 'School Manager can view Trash to restore school records');
  response = await fetch(`${baseUrl}/trash/students/invalid/restore`, { method: 'POST' });
  assert.equal(response.status, 400, 'School Manager can reach school-record restore validation');
  response = await fetch(`${baseUrl}/trash/students/invalid`, { method: 'DELETE' });
  assert.equal(response.status, 403, 'School Manager cannot permanently delete trashed records');
  response = await fetch(`${baseUrl}/reports/invalid`);
  assert.equal(response.status, 400, 'School Manager can reach school MIS report validation');
  response = await fetch(`${baseUrl}/terms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  assert.equal(response.status, 403, 'School Manager cannot modify administrator-only academic terms');

  role = 'SuperAdmin';
  response = await fetch(`${baseUrl}/users?page=1&page_size=25`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { rows: [], total: 0, page: 1, page_size: 25 });
  assert.match(listQuery, /u\.role IN \(\?, \?, \?\)/, 'SuperAdmin list also excludes SuperAdmin accounts');
  assert.equal(listParams.length, 15, 'SuperAdmin user list binds non-SuperAdmin role scope, role filter, and seven search parameters');
  assert.deepEqual(listParams.slice(3, 6), ['Admin', 'Teacher', 'School Manager']);
  response = await fetch(`${baseUrl}/users?page=1&page_size=25&role=SuperAdmin`);
  assert.equal(response.status, 400, 'SuperAdmin is not a selectable user-list filter');
});
