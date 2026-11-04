import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const requiredVariables = [
  'SYNC_TEST_LOCAL_DB_HOST', 'SYNC_TEST_LOCAL_DB_NAME', 'SYNC_TEST_LOCAL_DB_USER',
  'SYNC_TEST_CLOUD_DB_HOST', 'SYNC_TEST_CLOUD_DB_NAME', 'SYNC_TEST_CLOUD_DB_USER'
];
const integrationConfigured = requiredVariables.every(name => process.env[name]) &&
  process.env.SYNC_TEST_ALLOW_PLAINTEXT_LOOPBACK === 'true';

if (!integrationConfigured) {
  test('PostgreSQL bidirectional sync integration', {
    skip: 'Configure isolated *_sync_test databases and explicitly allow loopback plaintext for the test cluster'
  }, () => {});
} else {
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1']);
  const databaseNames = [
    process.env.SYNC_TEST_LOCAL_DB_NAME,
    process.env.SYNC_TEST_CLOUD_DB_NAME
  ];
  if (!loopbackHosts.has(process.env.SYNC_TEST_LOCAL_DB_HOST) ||
      !loopbackHosts.has(process.env.SYNC_TEST_CLOUD_DB_HOST) ||
      databaseNames.some(name => !name.endsWith('_sync_test'))) {
    throw new Error('Sync integration tests require loopback hosts and database names ending in _sync_test');
  }

  process.env.DB_MODE = 'HYBRID';
  process.env.LOCAL_DB_HOST = process.env.SYNC_TEST_LOCAL_DB_HOST;
  process.env.LOCAL_DB_PORT = process.env.SYNC_TEST_LOCAL_DB_PORT || '5432';
  process.env.LOCAL_DB_NAME = process.env.SYNC_TEST_LOCAL_DB_NAME;
  process.env.LOCAL_DB_USER = process.env.SYNC_TEST_LOCAL_DB_USER;
  process.env.LOCAL_DB_PASSWORD = process.env.SYNC_TEST_LOCAL_DB_PASSWORD || '';
  process.env.CLOUD_DB_HOST = process.env.SYNC_TEST_CLOUD_DB_HOST;
  process.env.CLOUD_DB_PORT = process.env.SYNC_TEST_CLOUD_DB_PORT || '5432';
  process.env.CLOUD_DB_NAME = process.env.SYNC_TEST_CLOUD_DB_NAME;
  process.env.CLOUD_DB_USER = process.env.SYNC_TEST_CLOUD_DB_USER;
  process.env.CLOUD_DB_PASSWORD = process.env.SYNC_TEST_CLOUD_DB_PASSWORD || '';
  process.env.CLOUD_DB_SSL = 'true';
  process.env.SYNC_ENABLED = 'true';
  process.env.SYNC_AUTO_ENABLED = 'false';
  process.env.SYNC_BATCH_SIZE = '100';

  const [{ getDatabaseMode, getDatabasePool }, sync] = await Promise.all([
    import('../src/config/db.js'),
    import('../src/services/sync.js')
  ]);
  const local = getDatabasePool('local');
  const cloud = getDatabasePool('cloud');
  cloud.options.ssl = false;

  test('captures direct SQL changes, deduplicates replay, resolves conflicts, and recovers after offline retry', async t => {
    async function cleanOldFixtures(pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.sync_apply', 'true', TRUE)");
        await client.query("DELETE FROM classes WHERE name LIKE 'SYNC-%'");
        await client.query("DELETE FROM academic_years WHERE name LIKE 'SYNC-%'");
        await client.query(`
          UPDATE sync_outbox SET status = 'synced'
          WHERE table_name IN ('academic_years', 'classes')
            AND (after_data ->> 'name' LIKE 'SYNC-%' OR before_data ->> 'name' LIKE 'SYNC-%')
        `);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    await Promise.all([cleanOldFixtures(local), cleanOldFixtures(cloud)]);
    await sync.initializeSync();
    assert.equal(await sync.changeDatabaseMode('HYBRID'), 'hybrid');
    assert.equal(getDatabaseMode(), 'hybrid');
    assert.equal(await sync.changeDatabaseMode('LOCAL'), 'local_only');
    assert.equal(getDatabaseMode(), 'local_only');
    assert.equal(await sync.changeDatabaseMode('CLOUD'), 'cloud_only');
    assert.equal(getDatabaseMode(), 'cloud_only');
    assert.equal(await sync.changeDatabaseMode('HYBRID'), 'hybrid');
    assert.equal(getDatabaseMode(), 'hybrid');
    const localState = await local.query('SELECT node_id FROM sync_state WHERE singleton = TRUE');
    const cloudState = await cloud.query('SELECT node_id FROM sync_state WHERE singleton = TRUE');
    assert.ok(localState.rows[0] && cloudState.rows[0], 'sync migrations must be applied to both test databases');

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const localPublicId = randomUUID();
    const cloudPublicId = randomUUID();
    const offlinePublicId = randomUUID();
    const classPublicIds = [];
    const yearsToClean = [localPublicId, cloudPublicId, offlinePublicId];

    async function clean(pool) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.sync_apply', 'true', TRUE)");
        if (classPublicIds.length) {
          await client.query('DELETE FROM classes WHERE public_id = ANY($1::uuid[])', [classPublicIds]);
        }
        await client.query('DELETE FROM academic_years WHERE public_id = ANY($1::uuid[])', [yearsToClean]);
        await client.query(`
          UPDATE sync_outbox SET status = 'synced'
          WHERE record_key ->> 'public_id' = ANY($1::text[])
        `, [[...classPublicIds, ...yearsToClean]]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    }

    t.after(async () => {
      try {
        await Promise.all([clean(local), clean(cloud)]);
      } finally {
        await Promise.all([local.end(), cloud.end()]);
      }
    });

    const occupiedIdResult = await local.query(
      'SELECT COALESCE(MAX(id), 0)::BIGINT + 100000 AS id FROM academic_years'
    );
    const occupiedId = occupiedIdResult.rows[0].id;
    await local.query(`
      INSERT INTO academic_years (id, public_id, name, start_date, end_date)
      VALUES ($1, $2, $3, '2026-01-01', '2026-12-31')
    `, [occupiedId, localPublicId, `SYNC-L-${suffix}`]);
    await cloud.query(`
      INSERT INTO academic_years (id, public_id, name, start_date, end_date)
      VALUES ($1, $2, $3, '2026-01-01', '2026-12-31')
    `, [occupiedId, cloudPublicId, `SYNC-C-${suffix}`]);
    await sync.runSyncNow();

    const [localCopy, cloudCopy] = await Promise.all([
      cloud.query('SELECT id FROM academic_years WHERE public_id = $1', [localPublicId]),
      local.query('SELECT id FROM academic_years WHERE public_id = $1', [cloudPublicId])
    ]);
    assert.notEqual(localCopy.rows[0].id, occupiedId, 'destination remaps colliding primary keys');
    assert.notEqual(cloudCopy.rows[0].id, occupiedId, 'reverse direction remaps colliding primary keys');

    const classPublicId = randomUUID();
    classPublicIds.push(classPublicId);
    await local.query(`
      INSERT INTO classes (public_id, name, grade_level, academic_year_id)
      VALUES ($1, $2, 'Grade 1', $3)
    `, [classPublicId, `SYNC-CLASS-${suffix}`, occupiedId]);
    await sync.runSyncNow();
    const translatedRelationship = await cloud.query(`
      SELECT year.public_id FROM classes class_record
      JOIN academic_years year ON year.id = class_record.academic_year_id
      WHERE class_record.public_id = $1
    `, [classPublicId]);
    assert.equal(translatedRelationship.rows[0]?.public_id, localPublicId);

    const duplicateEvent = await local.query(`
      SELECT event_id FROM sync_outbox
      WHERE table_name = 'academic_years' AND record_key ->> 'public_id' = $1
      ORDER BY id LIMIT 1
    `, [localPublicId]);
    await local.query(
      "UPDATE sync_outbox SET status = 'pending', next_attempt_at = CURRENT_TIMESTAMP WHERE event_id = $1",
      [duplicateEvent.rows[0].event_id]
    );
    await sync.runSyncNow();
    const duplicateCount = await cloud.query('SELECT COUNT(*)::INTEGER AS count FROM academic_years WHERE public_id = $1', [localPublicId]);
    assert.equal(duplicateCount.rows[0].count, 1);

    await cloud.query(
      "UPDATE academic_years SET name = $2 WHERE public_id = $1",
      [localPublicId, `SYNC-CLOUD-${suffix}`]
    );
    await sync.runSyncNow();
    const [updatedLocal, updatedCloud] = await Promise.all([
      local.query('SELECT name FROM academic_years WHERE public_id = $1', [localPublicId]),
      cloud.query('SELECT name FROM academic_years WHERE public_id = $1', [localPublicId])
    ]);
    assert.equal(updatedLocal.rows[0].name, `SYNC-CLOUD-${suffix}`);
    assert.equal(updatedCloud.rows[0].name, `SYNC-CLOUD-${suffix}`);

    await local.query('UPDATE academic_years SET name = $2 WHERE public_id = $1', [localPublicId, `SYNC-LOCAL-X-${suffix}`]);
    await cloud.query('UPDATE academic_years SET name = $2 WHERE public_id = $1', [localPublicId, `SYNC-CLOUD-X-${suffix}`]);
    await sync.runSyncNow();
    const conflict = await local.query(
      "SELECT conflict_id FROM sync_conflicts WHERE status = 'unresolved' AND record_key ->> 'public_id' = $1 LIMIT 1",
      [localPublicId]
    );
    const cloudConflict = conflict.rows[0] ? null : await cloud.query(
      "SELECT conflict_id FROM sync_conflicts WHERE status = 'unresolved' AND record_key ->> 'public_id' = $1 LIMIT 1",
      [localPublicId]
    );
    const conflictId = conflict.rows[0]?.conflict_id || cloudConflict?.rows[0]?.conflict_id;
    assert.ok(conflictId, 'concurrent updates must be presented for manual resolution');
    await sync.resolveSyncConflict(conflictId, 'keep_local');
    const [resolvedLocal, resolvedCloud] = await Promise.all([
      local.query('SELECT name FROM academic_years WHERE public_id = $1', [localPublicId]),
      cloud.query('SELECT name FROM academic_years WHERE public_id = $1', [localPublicId])
    ]);
    assert.equal(resolvedLocal.rows[0].name, `SYNC-LOCAL-X-${suffix}`);
    assert.equal(resolvedCloud.rows[0].name, `SYNC-LOCAL-X-${suffix}`);

    await cloud.query('DELETE FROM classes WHERE public_id = $1', [classPublicId]);
    await sync.runSyncNow();
    await cloud.query('DELETE FROM academic_years WHERE public_id = $1', [localPublicId]);
    await sync.runSyncNow();
    const [deletedLocal, deletedCloud] = await Promise.all([
      local.query('SELECT 1 FROM academic_years WHERE public_id = $1', [localPublicId]),
      cloud.query('SELECT 1 FROM academic_years WHERE public_id = $1', [localPublicId])
    ]);
    assert.equal(deletedLocal.rowCount, 0);
    assert.equal(deletedCloud.rowCount, 0);

    await local.query(`
      INSERT INTO academic_years (public_id, name, start_date, end_date)
      VALUES ($1, $2, '2027-01-01', '2027-12-31')
    `, [offlinePublicId, `SYNC-OFF-${suffix}`]);
    const originalCloudConnect = cloud.connect;
    cloud.connect = callback => {
      const error = Object.assign(new Error('simulated unavailable cloud connection'), { code: 'ECONNREFUSED' });
      if (typeof callback === 'function') {
        queueMicrotask(() => callback(error));
        return undefined;
      }
      return Promise.reject(error);
    };
    let offlineError;
    try {
      await sync.runSyncNow();
    } catch (error) {
      offlineError = error;
    } finally {
      cloud.connect = originalCloudConnect;
    }
    assert.equal(offlineError?.code, 'ECONNREFUSED');
    const failed = await local.query(
      "SELECT event_id FROM sync_outbox WHERE table_name = 'academic_years' AND record_key ->> 'public_id' = $1 AND status = 'failed'",
      [offlinePublicId]
    );
    assert.ok(failed.rows[0], 'offline delivery must remain queued as a failed event');
    await sync.retryFailedSyncEvents();
    await sync.runSyncNow();
    const recovered = await cloud.query('SELECT 1 FROM academic_years WHERE public_id = $1', [offlinePublicId]);
    assert.equal(recovered.rowCount, 1);
  });
}
