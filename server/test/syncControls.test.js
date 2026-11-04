import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_MODE = 'HYBRID';
process.env.LOCAL_DB_HOST = 'local-db.example.test';
process.env.LOCAL_DB_NAME = 'sims_local';
process.env.LOCAL_DB_USER = 'sims';
process.env.LOCAL_DB_PASSWORD = '';
process.env.CLOUD_DB_HOST = 'cloud-db.example.test';
process.env.CLOUD_DB_NAME = 'sims_cloud';
process.env.CLOUD_DB_USER = 'sims';
process.env.CLOUD_DB_PASSWORD = 'cloud-test-password';
process.env.CLOUD_DB_SSL = 'true';
process.env.SYNC_ENABLED = 'true';
process.env.SYNC_AUTO_ENABLED = 'false';

const [{ getDatabasePool }, sync] = await Promise.all([
  import('../src/config/db.js'),
  import('../src/services/sync.js')
]);

test('database connection tests expose only connectivity and timing', async t => {
  const local = getDatabasePool('local');
  const cloud = getDatabasePool('cloud');
  const originalLocalQuery = local.query;
  const originalCloudQuery = cloud.query;
  t.after(() => {
    local.query = originalLocalQuery;
    cloud.query = originalCloudQuery;
  });
  local.query = async () => ({ rows: [{ '?column?': 1 }] });
  cloud.query = async () => {
    throw Object.assign(new Error('connection rejected'), { code: 'ECONNREFUSED' });
  };

  const localResult = await sync.testDatabaseConnection('local');
  const cloudResult = await sync.testDatabaseConnection('cloud');
  assert.deepEqual(Object.keys(localResult).sort(), ['connected', 'configured', 'database', 'latencyMs'].sort());
  assert.equal(localResult.database, 'local');
  assert.equal(localResult.configured, true);
  assert.equal(localResult.connected, true);
  assert.equal(typeof localResult.latencyMs, 'number');
  assert.equal(cloudResult.database, 'cloud');
  assert.equal(cloudResult.configured, true);
  assert.equal(cloudResult.connected, false);
  assert.equal(cloudResult.error, 'ECONNREFUSED');
  assert.equal(Object.hasOwn(cloudResult, 'password'), false);
  await assert.rejects(sync.testDatabaseConnection('unknown'), { status: 400 });
});

test('automatic sync preference is persisted and manual sync remains available while paused', async t => {
  const local = getDatabasePool('local');
  const cloud = getDatabasePool('cloud');
  const originalLocalQuery = local.query;
  const originalCloudQuery = cloud.query;
  t.after(() => {
    local.query = originalLocalQuery;
    cloud.query = originalCloudQuery;
  });

  const historyIds = { local: 1, cloud: 2 };
  const historyStartedAt = [];
  const stubQuery = database => async (sql, params = []) => {
    if (sql.includes('UPDATE sync_state SET auto_enabled')) return { rowCount: 1 };
    if (sql.includes('INSERT INTO sync_history')) {
      historyStartedAt.push({ database, startedAt: params[1] });
      return { rows: [{ id: historyIds[database] }], rowCount: 1 };
    }
    if (sql.includes('SELECT outbox.*')) return { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE sync_history')) return { rowCount: 1 };
    throw new Error(`Unexpected ${database} database query: ${sql}`);
  };
  local.query = stubQuery('local');
  cloud.query = stubQuery('cloud');

  assert.deepEqual(await sync.setAutomaticSyncEnabled(false), { autoEnabled: false });
  const result = await sync.runSyncNow();
  assert.equal(result.localToCloud.processed, 0);
  assert.equal(result.cloudToLocal.processed, 0);
  assert.equal(historyStartedAt.length, 2);
  assert.equal(historyStartedAt[0].startedAt, historyStartedAt[1].startedAt);

  assert.deepEqual(await sync.setAutomaticSyncEnabled(true), { autoEnabled: true });
  assert.deepEqual(await sync.setAutomaticSyncEnabled(false), { autoEnabled: false });
});

test('manual synchronization can run local-to-cloud, cloud-to-local, or both directions', async t => {
  const local = getDatabasePool('local');
  const cloud = getDatabasePool('cloud');
  const originalLocalQuery = local.query;
  const originalCloudQuery = cloud.query;
  t.after(() => {
    local.query = originalLocalQuery;
    cloud.query = originalCloudQuery;
  });

  const directions = [];
  const stubQuery = database => async (sql, params = []) => {
    if (sql.includes('INSERT INTO sync_history')) {
      directions.push({ database, direction: params[0] });
      return { rows: [{ id: directions.length }], rowCount: 1 };
    }
    if (sql.includes('SELECT outbox.*')) return { rows: [], rowCount: 0 };
    if (sql.includes('UPDATE sync_history')) return { rowCount: 1 };
    throw new Error(`Unexpected ${database} database query: ${sql}`);
  };
  local.query = stubQuery('local');
  cloud.query = stubQuery('cloud');

  const localToCloud = await sync.runSyncNow('local_to_cloud');
  assert.equal(localToCloud.direction, 'local_to_cloud');
  assert.ok(localToCloud.localToCloud);
  assert.equal(localToCloud.cloudToLocal, null);
  assert.deepEqual(directions.map(item => item.direction), ['local_to_cloud']);

  directions.length = 0;
  const cloudToLocal = await sync.runSyncNow('cloud_to_local');
  assert.equal(cloudToLocal.direction, 'cloud_to_local');
  assert.equal(cloudToLocal.localToCloud, null);
  assert.ok(cloudToLocal.cloudToLocal);
  assert.deepEqual(directions.map(item => item.direction), ['cloud_to_local']);

  directions.length = 0;
  const both = await sync.runSyncNow('both');
  assert.equal(both.direction, 'both');
  assert.ok(both.localToCloud);
  assert.ok(both.cloudToLocal);
  assert.deepEqual(directions.map(item => item.direction), ['local_to_cloud', 'cloud_to_local']);
  await assert.rejects(sync.runSyncNow('invalid'), { status: 400 });
});

test('synchronization history is paginated across local and cloud databases', async t => {
  const local = getDatabasePool('local');
  const cloud = getDatabasePool('cloud');
  const originalLocalQuery = local.query;
  const originalCloudQuery = cloud.query;
  t.after(() => {
    local.query = originalLocalQuery;
    cloud.query = originalCloudQuery;
  });

  const records = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1,
    started_at: new Date(Date.UTC(2026, 0, 1, 0, Math.floor(index / 2))).toISOString(),
    direction: 'local_to_cloud',
    status: index < 5 ? 'failed' : 'completed',
    sent_count: index,
    conflict_count: 0,
    database: index % 2 === 0 ? 'local' : 'cloud'
  }));
  const stubQuery = database => async (sql, params = []) => {
    if (sql === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM sync_outbox')) {
      return { rows: [{ pending: 0, failed: 0, blocked: 0 }] };
    }
    if (sql.includes('FROM sync_conflicts WHERE status')) return { rows: [{ count: 0 }] };
    const matchesFilters = item => item.database === database &&
      (!params[0] || item.status === params[0]) &&
      (!params[1] || new Date(item.started_at) >= new Date(params[1])) &&
      (!params[2] || new Date(item.started_at) <= new Date(params[2]));
    if (sql.includes('COUNT(*)::INTEGER AS total FROM sync_history')) {
      return {
        rows: [{
          total: records.filter(matchesFilters).length
        }]
      };
    }
    if (sql.includes('FROM sync_history')) {
      return {
        rows: records
          .filter(matchesFilters)
          .sort((a, b) =>
            new Date(b.started_at) - new Date(a.started_at) || b.id - a.id
          )
          .slice(0, params[3])
      };
    }
    throw new Error(`Unexpected ${database} database query: ${sql}`);
  };
  local.query = stubQuery('local');
  cloud.query = stubQuery('cloud');

  const page = await sync.getSyncHistoryPage(2);
  assert.equal(page.page, 2);
  assert.equal(page.pageSize, 10);
  assert.equal(page.total, 24);
  assert.equal(page.pageCount, 3);
  assert.deepEqual(page.history.map(item => item.id), [13, 14, 11, 12, 9, 10, 7, 8, 5, 6]);

  const firstPage = await sync.getSyncHistoryPage(1);
  assert.deepEqual(firstPage.history.map(item => item.database), [
    'local', 'cloud', 'local', 'cloud', 'local',
    'cloud', 'local', 'cloud', 'local', 'cloud'
  ]);

  const lastPage = await sync.getSyncHistoryPage(99);
  assert.equal(lastPage.page, 3);
  assert.deepEqual(lastPage.history.map(item => item.id), [3, 4, 1, 2]);

  const failed = await sync.getSyncHistoryPage(1, 'failed');
  assert.equal(failed.total, 5);
  assert.equal(failed.pageCount, 1);
  assert.deepEqual(failed.history.map(item => item.id), [5, 3, 4, 1, 2]);

  const from = records[8].started_at;
  const to = records[12].started_at;
  const localRange = await sync.getSyncHistoryPage(1, 'all', 'local', from, to);
  assert.equal(localRange.total, 3);
  assert.deepEqual(localRange.history.map(item => item.database), ['local', 'local', 'local']);
  assert.deepEqual(localRange.history.map(item => item.id), [13, 11, 9]);
});
