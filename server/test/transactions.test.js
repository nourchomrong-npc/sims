import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_HOST ||= 'localhost';
process.env.DB_PORT ||= '5432';
process.env.DB_NAME ||= 'test';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';

const [{ pool }, { transactionalMutation }] = await Promise.all([
  import('../src/config/db.js'),
  import('../src/utils/transactions.js')
]);

function fakeResponse() {
  const response = {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    end() {
      return this;
    }
  };
  return response;
}

function installConnection(t, query) {
  const events = [];
  const originalGetConnection = pool.getConnection;
  pool.getConnection = async () => ({
    async query(sql, params) {
      events.push(sql);
      return query(sql, params);
    },
    async execute(sql, params) {
      const result = await this.query(sql, params);
      if (/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(sql)) {
        return [{ affectedRows: result.rowCount, insertId: result.rows[0]?.id }, result.fields];
      }
      return [result.rows, result.fields];
    },
    async beginTransaction() {
      events.push('BEGIN');
    },
    async commit() {
      events.push('COMMIT');
    },
    async rollback() {
      events.push('ROLLBACK');
    },
    release() {
      events.push('RELEASE');
    }
  });
  t.after(() => {
    pool.getConnection = originalGetConnection;
  });
  return events;
}

test('batch mutation rolls back earlier statements when a later SQL statement fails', async t => {
  const events = installConnection(t, async (sql, params) => {
    if (params.includes('FAIL')) throw new Error('injected SQL failure');
    return { rows: [], rowCount: 1, fields: [] };
  });
  const response = fakeResponse();
  let nextError;

  await transactionalMutation(pool, async (req, res) => {
    await pool.execute('INSERT INTO sample_records (name) VALUES (?)', ['first']);
    await pool.execute('UPDATE sample_records SET name = ? WHERE id = ?', ['FAIL', 1]);
    res.status(200).json({ success: true });
  })({}, response, error => { nextError = error; });

  assert.match(nextError.message, /injected SQL failure/);
  assert.equal(events.filter(event => event === 'COMMIT').length, 0);
  assert.equal(events.filter(event => event === 'ROLLBACK').length, 1);
  assert.equal(response.body, undefined);
});

test('SuperAdmin audit failure rolls back the mutation before returning a response', async t => {
  const events = installConnection(t, async sql => {
    if (sql.includes('SELECT id, public_id, username, full_name, role FROM users')) {
      return { rows: [{ id: 8, public_id: 'actor', username: 'admin', full_name: 'Admin', role: 'SuperAdmin' }], rowCount: 1, fields: [] };
    }
    if (sql.includes('INSERT INTO activity_logs')) throw new Error('injected audit failure');
    return { rows: [], rowCount: 1, fields: [] };
  });
  const response = fakeResponse();
  let nextError;

  await transactionalMutation(pool, async (req, res) => {
    await pool.execute('INSERT INTO sample_records (name) VALUES (?)', ['created']);
    res.status(201).json({ success: true });
  })({
    method: 'POST',
    path: '/sample-records',
    originalUrl: '/sample-records',
    body: {},
    session: { user: { role: 'SuperAdmin', internalId: 8 } }
  }, response, error => { nextError = error; });

  assert.match(nextError.message, /injected audit failure/);
  assert.equal(events.filter(event => event === 'COMMIT').length, 0);
  assert.equal(events.filter(event => event === 'ROLLBACK').length, 1);
  assert.equal(response.body, undefined);
});

test('a validation response after a mutation rolls the transaction back', async t => {
  const events = installConnection(t, async () => ({ rows: [], rowCount: 1, fields: [] }));
  const response = fakeResponse();

  await transactionalMutation(pool, async (req, res) => {
    await pool.execute('INSERT INTO sample_records (name) VALUES (?)', ['temporary']);
    res.status(400).json({ error: 'invalid batch item' });
  })({}, response, error => { throw error; });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, { error: 'invalid batch item' });
  assert.equal(events.filter(event => event === 'COMMIT').length, 0);
  assert.equal(events.filter(event => event === 'ROLLBACK').length, 1);
});
