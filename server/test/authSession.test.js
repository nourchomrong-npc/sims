import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcrypt';
import express from 'express';
import session from 'express-session';

process.env.DB_HOST ||= 'localhost';
process.env.DB_PORT ||= '5432';
process.env.DB_NAME ||= 'test';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
process.env.SUPABASE_URL ||= 'https://storage.example.test';
process.env.SUPABASE_SECRET_KEY ||= 'test-secret-key';

const [{ pool }, { default: api }, { default: sync }, { configureRateLimiters }] = await Promise.all([
  import('../src/config/db.js'),
  import('../src/routes/api.js'),
  import('../src/routes/sync.js'),
  import('../src/middleware/rateLimit.js')
]);
configureRateLimiters(null);

test('login creates a cookie-backed session for protected routes until logout', async t => {
  const password = 'a-valid-test-password';
  const user = {
    id: 17,
    public_id: 'a79f3de3-24ae-4016-a488-c04d46278f0b',
    username: 'admin',
    password_hash: await bcrypt.hash(password, 4),
    full_name: 'Test SuperAdmin',
    role: 'SuperAdmin',
    must_change_password: false,
    active: true
  };
  const originalExecute = pool.execute;
  pool.execute = async sql => {
    if (sql.includes('FROM users WHERE username = ? AND is_deleted = 0')) {
      return [[user], []];
    }
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) {
      return [[{ active: true, is_deleted: false }], []];
    }
    if (sql.includes('INSERT INTO activity_logs')) {
      return [{ affectedRows: 1 }, []];
    }
    if (/^\s*SELECT\b/i.test(sql)) return [[], []];
    throw new Error(`Unexpected database query in auth-session test: ${sql}`);
  };
  t.after(() => {
    pool.execute = originalExecute;
  });

  const app = express();
  app.use(express.json());
  app.use(session({
    name: 'sims.sid',
    secret: 'test-only-session-secret-that-is-long-enough',
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: false, sameSite: 'lax' }
  }));
  app.use('/api/sync', sync);
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

  for (const path of ['/auth/me', '/meta', '/dashboard', '/sync/status', '/sync/connections/test']) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 401, `${path} must reject logged-out requests`);
  }

  const rejectedLogin = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password: 'wrong-password' })
  });
  assert.equal(rejectedLogin.status, 401);
  assert.equal(rejectedLogin.headers.get('set-cookie'), null);

  const login = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user.username, password })
  });
  assert.equal(login.status, 200);
  assert.deepEqual((await login.json()).user, {
    id: user.public_id,
    username: user.username,
    full_name: user.full_name,
    role: user.role,
    must_change_password: false
  });
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookie = setCookie.match(/sims\.sid=[^;]+/)?.[0];
  assert.ok(cookie, 'login should return the session cookie');

  const currentUser = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(currentUser.status, 200, 'the session should persist across requests');
  assert.equal((await currentUser.json()).user.id, user.public_id);

  const metadata = await fetch(`${baseUrl}/meta`, { headers: { Cookie: cookie } });
  assert.equal(metadata.status, 200, 'an authenticated academic user should reach protected metadata');

  const logout = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } });
  assert.equal(afterLogout.status, 401, 'logout should invalidate the stored session');
});
