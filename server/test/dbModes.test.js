import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_MODE = 'LOCAL';
process.env.LOCAL_DB_HOST = 'local-db.example.test';
process.env.LOCAL_DB_NAME = 'sims_local';
process.env.LOCAL_DB_USER = 'sims';
process.env.LOCAL_DB_PASSWORD = '';
process.env.CLOUD_DB_HOST = 'cloud-db.example.test';
process.env.CLOUD_DB_NAME = 'sims_cloud';
process.env.CLOUD_DB_USER = 'sims';
process.env.CLOUD_DB_PASSWORD = 'cloud-test-password';

const { getDatabaseMode, getDatabasePool, normalizeDatabaseMode, runWithDatabaseMode, setDatabaseMode, validateDatabaseMode } =
  await import('../src/config/db.js');

test('database modes select independent pools and pin a request to its starting mode', async () => {
  const localPool = getDatabasePool('local');
  const cloudPool = getDatabasePool('cloud');
  assert.notEqual(localPool, cloudPool);
  assert.equal(getDatabaseMode(), 'local_only');
  assert.equal(getDatabasePool(), localPool);
  assert.equal(validateDatabaseMode('hybrid'), localPool);
  assert.equal(localPool.options.password, '');
  assert.equal(normalizeDatabaseMode('CLOUD'), 'cloud_only');
  assert.equal(normalizeDatabaseMode('HYBRID'), 'hybrid');

  const requestPool = await runWithDatabaseMode('cloud_only', async () => {
    await Promise.resolve();
    return getDatabasePool();
  });
  assert.equal(requestPool, cloudPool);
  assert.equal(getDatabasePool(), localPool);

  setDatabaseMode('CLOUD');
  assert.equal(getDatabasePool(), cloudPool);
  setDatabaseMode('LOCAL');
  assert.equal(getDatabasePool(), localPool);
  setDatabaseMode('hybrid');
  assert.equal(getDatabasePool(), localPool);
  assert.throws(() => setDatabaseMode('invalid'), /must be LOCAL/);
});

test('cloud PostgreSQL pools always verify TLS certificates', () => {
  const ssl = getDatabasePool('cloud').options.ssl;
  assert.equal(ssl.rejectUnauthorized, true);
});
