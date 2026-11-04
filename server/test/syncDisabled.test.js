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
process.env.SYNC_ENABLED = 'false';

const sync = await import('../src/services/sync.js');

test('SYNC_ENABLED=false disables both manual and automatic sync controls', async () => {
  await assert.rejects(sync.runSyncNow(), { status: 409 });
  await assert.rejects(sync.setAutomaticSyncEnabled(true), { status: 409 });
});
