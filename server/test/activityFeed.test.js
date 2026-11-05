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

test('activity feed is admin-only and returns snapshots without replacing legacy identities', async t => {
  const originalExecute = pool.execute;
  let role = 'Teacher';
  let usedPublicActorFilter = false;
  const historicalRow = {
    id: 1,
    event_id: '13e17f52-13da-4a2d-b9a8-5cc05ed05c6a',
    legacy_actor_id: 22,
    action: 'updated',
    entity: 'user',
    entity_id: null,
    details: {
      actor: { id: '22', public_id: 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1', display_name: 'Old Name', username: 'ABC', roles: ['Administrator'] },
      affected_user: { id: '22', public_id: 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1', display_name: 'New Name', username: 'CBA', roles: ['Teacher'] },
      changes: [
        { field: 'username', before: 'ABC', after: 'CBA' },
        { field: 'password', before: 'old-secret', after: 'new-secret' }
      ],
      password_hash: 'must-not-be-returned'
    },
    created_at: '2026-01-02T03:04:05.000Z',
    record_label: 'CBA · New Name'
  };
  const legacyRow = {
    id: 2,
    event_id: 'e536a0f4-4a26-41bc-af52-3af19f1c2a15',
    legacy_actor_id: 99,
    action: 'login',
    entity: 'user',
    entity_id: null,
    details: null,
    created_at: '2025-01-02T03:04:05.000Z',
    record_label: null
  };
  pool.execute = async (sql, params = []) => {
    if (sql.includes('SELECT id, public_id FROM academic_years WHERE is_current = 1 LIMIT 1')) {
      return [[{ id: 1, public_id: 'cf4dfdf6-bae4-45de-9a5d-c2a89a80e234' }], []];
    }
    if (sql.includes('SELECT active, is_deleted FROM users WHERE id = ?')) {
      return [[{ active: true, is_deleted: false }], []];
    }
    if (sql.includes('SELECT COUNT(*) AS total FROM activity_logs')) return [[{ total: 2 }], []];
    if (sql.includes('SELECT al.id, al.public_id AS event_id')) {
      usedPublicActorFilter = sql.includes("details -> 'actor' ->> 'public_id'");
      assert.deepEqual(params, [
        '2025-01-01 00:00:00',
        '2026-01-01 23:59:59',
        'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1',
        'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1',
        '%ABC%', '%ABC%', '%ABC%', '%ABC%', '%ABC%', '%ABC%', '%ABC%',
        25, 0
      ]);
      assert.match(sql, /ORDER BY al\.created_at ASC NULLS LAST/);
      return [[historicalRow, legacyRow], []];
    }
    if (sql.includes('SELECT DISTINCT action FROM activity_logs')) return [[{ action: 'login' }, { action: 'updated' }], []];
    if (sql.includes('SELECT DISTINCT entity FROM activity_logs')) return [[{ entity: 'user' }], []];
    if (sql.includes('SELECT DISTINCT') && sql.includes('AS actor_id')) {
      assert.match(sql, /COALESCE\(al\.details -> 'actor' ->> 'public_id', activity_actor\.public_id::text\)/);
      return [[
        { actor_id: 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1', display_name: 'Old Name', username: 'ABC', roles: ['Administrator'] },
        { actor_id: 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1', display_name: 'New Name', username: 'CBA', roles: ['Teacher'] }
      ], []];
    }
    if (sql.includes('SELECT id, public_id FROM users WHERE id IN (')) {
      return [[{ id: 99, public_id: 'b6f0b0b4-4d64-40e4-98bd-946447260aa4' }], []];
    }
    if (sql.includes('SELECT id, public_id FROM activity_logs')) {
      return [[
        { id: 1, public_id: historicalRow.event_id },
        { id: 2, public_id: legacyRow.event_id }
      ], []];
    }
    throw new Error(`Unexpected database query in activity feed test: ${sql}`);
  };
  t.after(() => { pool.execute = originalExecute; });

  const app = express();
  app.use((req, res, next) => {
    req.session = { user: { role, internalId: 10 } };
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
  const url = `http://127.0.0.1:${server.address().port}/api/activity-logs?page=1&page_size=25&q=ABC&username=c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1&from=2025-01-01T00%3A00&to=2026-01-01T23%3A59&sort_order=oldest`;

  const forbidden = await fetch(url);
  assert.equal(forbidden.status, 403);

  role = 'Admin';
  const response = await fetch(url);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.page, 1);
  assert.equal(result.page_size, 25);
  assert.equal(result.total, 2);
  assert.equal(result.rows[0].actor.display_name, 'Old Name');
  assert.equal(result.rows[0].actor.username, 'ABC');
  assert.equal(result.rows[0].actor.public_id, 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1');
  assert.equal('id' in result.rows[0].actor, false);
  assert.deepEqual(result.rows[0].actor.roles, ['Administrator']);
  assert.equal(result.rows[0].affected_user.username, 'CBA');
  assert.equal(result.rows[0].affected_user.public_id, 'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1');
  assert.equal('id' in result.rows[0].affected_user, false);
  assert.equal(result.rows[0].details.password_hash, undefined);
  assert.equal(result.rows[0].details.changes.length, 1);
  assert.doesNotMatch(JSON.stringify(result.rows[0].details), /old-secret|new-secret|must-not-be-returned/);
  assert.deepEqual(result.rows[1].actor, {
    public_id: 'b6f0b0b4-4d64-40e4-98bd-946447260aa4',
    display_name: null,
    username: null,
    roles: []
  });
  assert.equal(usedPublicActorFilter, true);
  assert.deepEqual(result.filterOptions.users, [[
    'c7a8a10b-d1e9-4c87-8fed-0d8c998ed4a1',
    'Old Name · ABC · Administrator / New Name · CBA · Teacher'
  ]]);
});
