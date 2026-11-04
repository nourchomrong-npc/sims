import { logError, logInfo } from '../utils/logger.js';
import {
  getDatabaseMode,
  getDatabasePool,
  normalizeDatabaseMode,
  setDatabaseMode,
  validateDatabaseMode
} from '../config/db.js';

const TABLES = [
  'users', 'trash_records', 'academic_years', 'teachers', 'classes', 'students',
  'student_photos', 'terms', 'student_enrollments', 'subjects', 'teacher_assignments',
  'class_schedules', 'class_schedule_time_slots', 'attendance_records', 'assessments',
  'student_scores', 'grading_scales', 'activity_logs'
];
const ACTIVITY_ENTITY_TABLES = {
  user: 'users',
  academic_year: 'academic_years',
  student: 'students',
  teacher: 'teachers',
  class: 'classes',
  term: 'terms',
  student_enrollment: 'student_enrollments',
  subject: 'subjects',
  teacher_assignment: 'teacher_assignments',
  class_schedule: 'class_schedules',
  attendance_record: 'attendance_records',
  assessment: 'assessments',
  student_score: 'student_scores',
  grading_scale: 'grading_scales'
};
const TABLE_SET = new Set(TABLES);
const MODES = new Set(['local_only', 'cloud_only', 'hybrid']);
const BATCH_SIZE = Number(process.env.SYNC_BATCH_SIZE || 100);
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL || process.env.SYNC_INTERVAL_MS || 15000);
const MAX_RETRY_SECONDS = Number(process.env.SYNC_MAX_RETRY_SECONDS || 900);
const SYNC_HISTORY_PAGE_SIZE = 10;
const SYNC_ENABLED = readBooleanSetting('SYNC_ENABLED', true);
const AUTO_SYNC_DEFAULT = readBooleanSetting('SYNC_AUTO_ENABLED', true);
const schemaCache = new WeakMap();
let workerTimer;
let currentRun;
let automaticSyncEnabled = AUTO_SYNC_DEFAULT;

function readBooleanSetting(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

for (const [name, value] of Object.entries({
  SYNC_BATCH_SIZE: BATCH_SIZE,
  SYNC_INTERVAL_MS: INTERVAL_MS,
  SYNC_MAX_RETRY_SECONDS: MAX_RETRY_SECONDS
})) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parseJson(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function databaseLabel(database) {
  return database === 'local' ? 'local' : 'cloud';
}

function poolFor(database) {
  const pool = getDatabasePool(database);
  if (!pool) {
    throw Object.assign(new Error(`${databaseLabel(database)} PostgreSQL is not configured`), { status: 503 });
  }
  return pool;
}

async function tableSchema(database, tableName) {
  if (!TABLE_SET.has(tableName)) throw new Error('Unsupported synchronization table');
  const pool = poolFor(database);
  let cache = schemaCache.get(pool);
  if (!cache) {
    cache = new Map();
    schemaCache.set(pool, cache);
  }
  if (cache.has(tableName)) return cache.get(tableName);

  const [columnsResult, foreignKeysResult] = await Promise.all([
    pool.query(`
      SELECT column_name, is_generated, is_identity, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position
    `, [tableName]),
    pool.query(`
      SELECT key_column.column_name, referenced.table_name AS referenced_table,
        referenced.column_name AS referenced_column
      FROM information_schema.table_constraints constraint_row
      JOIN information_schema.key_column_usage key_column
        ON key_column.constraint_catalog = constraint_row.constraint_catalog
        AND key_column.constraint_schema = constraint_row.constraint_schema
        AND key_column.constraint_name = constraint_row.constraint_name
      JOIN information_schema.constraint_column_usage referenced
        ON referenced.constraint_catalog = constraint_row.constraint_catalog
        AND referenced.constraint_schema = constraint_row.constraint_schema
        AND referenced.constraint_name = constraint_row.constraint_name
      WHERE constraint_row.constraint_type = 'FOREIGN KEY'
        AND constraint_row.table_schema = 'public'
        AND constraint_row.table_name = $1
    `, [tableName])
  ]);
  if (!columnsResult.rows.length) throw new Error(`Synchronization table "${tableName}" is missing`);
  const schema = {
    columns: columnsResult.rows,
    columnNames: new Set(columnsResult.rows.map(row => row.column_name)),
    generated: new Set(columnsResult.rows.filter(row => row.is_generated === 'ALWAYS').map(row => row.column_name)),
    foreignKeys: foreignKeysResult.rows
  };
  cache.set(tableName, schema);
  return schema;
}

function identityCondition(tableName, key) {
  const identity = tableName === 'class_schedule_time_slots'
    ? ['class_id', 'start_time']
    : tableName === 'trash_records'
      ? ['entity_type', 'record_public_id']
      : Object.hasOwn(key, 'public_id') ? ['public_id'] : ['id'];
  return {
    columns: identity,
    values: identity.map(column => key[column])
  };
}

async function mapForeignKeys(sourcePool, targetPool, tableName, input, sourceNodeId = null) {
  if (!input) return input;
  const mapped = { ...input };
  const schema = await tableSchema('local', tableName);
  for (const foreignKey of schema.foreignKeys) {
    const { column_name: column, referenced_table: referencedTable, referenced_column: referencedColumn } = foreignKey;
    if (mapped[column] === null || mapped[column] === undefined || referencedColumn !== 'id') continue;
    if (!TABLE_SET.has(referencedTable)) throw new Error(`Unsupported foreign-key target "${referencedTable}"`);

    const sourceRow = await sourcePool.query(
      `SELECT public_id FROM public.${quoteIdentifier(referencedTable)} WHERE id = $1`,
      [mapped[column]]
    );
    const publicId = sourceRow.rows[0]?.public_id;
    if (!publicId) throw new Error(`Cannot resolve ${tableName}.${column} to a public UUID`);
    const targetRow = await targetPool.query(
      `SELECT id FROM public.${quoteIdentifier(referencedTable)} WHERE public_id = $1`,
      [publicId]
    );
    if (!targetRow.rows[0]) throw new Error(`Synchronization dependency "${referencedTable}" is not available`);
    mapped[column] = targetRow.rows[0].id;
  }
  if (tableName === 'trash_records' && mapped.deleted_by != null) {
    const sourceUser = await sourcePool.query('SELECT public_id FROM public.users WHERE id = $1', [mapped.deleted_by]);
    if (!sourceUser.rows[0]?.public_id) throw new Error('Cannot resolve trash_records.deleted_by to a public UUID');
    const targetUser = await targetPool.query('SELECT id FROM public.users WHERE public_id = $1', [sourceUser.rows[0].public_id]);
    if (!targetUser.rows[0]) throw new Error('Synchronization dependency "users" is not available');
    mapped.deleted_by = targetUser.rows[0].id;
  }
  if (tableName === 'activity_logs' && mapped.entity_id != null) {
    const referencedTable = ACTIVITY_ENTITY_TABLES[mapped.entity];
    if (referencedTable) {
      const sourceEntity = await sourcePool.query(
        `SELECT public_id FROM public.${quoteIdentifier(referencedTable)} WHERE id = $1`,
        [mapped.entity_id]
      );
      const publicId = sourceEntity.rows[0]?.public_id ||
        mapped.details?.record_before?.public_id ||
        mapped.details?.record_after?.public_id;
      let targetEntity;
      if (publicId) {
        targetEntity = await targetPool.query(
          `SELECT id FROM public.${quoteIdentifier(referencedTable)} WHERE public_id = $1`,
          [publicId]
        );
      }
      if (targetEntity?.rows[0]) {
        mapped.entity_id = targetEntity.rows[0].id;
      } else if (sourceNodeId) {
        const idMap = await targetPool.query(`
          SELECT local_id FROM sync_id_map
          WHERE source_node_id = $1 AND table_name = $2 AND source_id = $3
        `, [sourceNodeId, referencedTable, mapped.entity_id]);
        mapped.entity_id = idMap.rows[0]?.local_id ?? null;
      } else {
        mapped.entity_id = null;
      }
    }
  }
  return mapped;
}

async function mapRecordKey(sourcePool, targetPool, tableName, key) {
  if (tableName === 'class_schedule_time_slots' && key.class_public_id) {
    const classRecord = await targetPool.query(
      'SELECT id FROM public.classes WHERE public_id = $1',
      [key.class_public_id]
    );
    if (!classRecord.rows[0]) throw new Error('Synchronization dependency "classes" is not available');
    return { class_id: classRecord.rows[0].id, start_time: key.start_time };
  }
  return mapForeignKeys(sourcePool, targetPool, tableName, key);
}

async function findRecord(client, tableName, key) {
  const { columns, values } = identityCondition(tableName, key);
  const where = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(' AND ');
  const result = await client.query(`
    SELECT record.*, sync_row_as_json(to_jsonb(record), $${values.length + 1}) AS __sync_json
    FROM public.${quoteIdentifier(tableName)} record
    WHERE ${where} FOR UPDATE
  `, [...values, tableName]);
  return result.rows[0] || null;
}

function comparable(record) {
  if (!record) return null;
  const source = record.__sync_json || record;
  return Object.fromEntries(Object.keys(source)
    .filter(key => !['id', 'created_at', 'updated_at'].includes(key))
    .sort()
    .map(key => {
      const value = source[key];
      if (value instanceof Date) return [key, value.toISOString()];
      return [key, value];
    }));
}

function sameRecord(left, right) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

function plainRecord(record) {
  if (!record) return null;
  const { __sync_json, ...plain } = record;
  return plain;
}

async function storeIdMapping(client, sourceNodeId, tableName, sourceData, destinationData) {
  if (!sourceNodeId || !sourceData?.id || !sourceData?.public_id || !destinationData?.id) return;
  const schema = await tableSchema('local', tableName);
  const idColumn = schema.columns.find(column => column.column_name === 'id');
  if (idColumn?.data_type !== 'bigint') return;
  await client.query(`
    INSERT INTO sync_id_map (source_node_id, table_name, source_id, record_public_id, local_id)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (source_node_id, table_name, source_id) DO UPDATE
      SET record_public_id = EXCLUDED.record_public_id, local_id = EXCLUDED.local_id,
          mapped_at = CURRENT_TIMESTAMP
  `, [sourceNodeId, tableName, sourceData.id, sourceData.public_id, destinationData.id]);
}

async function writeRecord(client, sourcePool, targetPool, tableName, operation, key, sourceData, sourceNodeId = null) {
  const schema = await tableSchema('local', tableName);
  const mappedKey = await mapRecordKey(sourcePool, targetPool, tableName, key);
  const current = await findRecord(client, tableName, mappedKey);

  if (operation === 'DELETE') {
    if (!current) return { current: null, written: false };
    await storeIdMapping(client, sourceNodeId, tableName, sourceData, current);
    const identity = identityCondition(tableName, mappedKey);
    const where = identity.columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(' AND ');
    await client.query(`DELETE FROM public.${quoteIdentifier(tableName)} WHERE ${where}`, identity.values);
    return { current: plainRecord(current), written: true };
  }

  const mappedData = await mapForeignKeys(sourcePool, targetPool, tableName, sourceData, sourceNodeId);
  const row = Object.fromEntries(Object.entries(mappedData)
    .filter(([column]) => schema.columnNames.has(column) && !schema.generated.has(column)));

  if (!current) {
    const idColumn = schema.columns.find(column => column.column_name === 'id');
    if (Object.hasOwn(row, 'id') && idColumn?.data_type === 'bigint' && schema.columnNames.has('public_id')) {
      const occupant = await client.query(
        `SELECT public_id FROM public.${quoteIdentifier(tableName)} WHERE id = $1`,
        [row.id]
      );
      if (occupant.rows.length && occupant.rows[0].public_id !== row.public_id) delete row.id;
    }
    const columns = Object.keys(row);
    const values = columns.map(column => row[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`);
    await client.query(
      `INSERT INTO public.${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')}) VALUES (${placeholders.join(', ')})`,
      values
    );
    const inserted = await findRecord(client, tableName, mappedKey);
    await storeIdMapping(client, sourceNodeId, tableName, sourceData, inserted);
    if (row.id !== undefined && idColumn?.is_identity === 'YES' && idColumn.data_type === 'bigint') {
      await client.query(
        `SELECT setval(pg_get_serial_sequence($1, 'id'), GREATEST((SELECT MAX(id) FROM public.${quoteIdentifier(tableName)}), 1), TRUE)`,
        [`public.${tableName}`]
      );
    }
    return { current: null, written: true };
  }

  const identity = identityCondition(tableName, mappedKey);
  delete row.id;
  const columns = Object.keys(row);
  if (!columns.length) return { current: plainRecord(current), written: false };
  const assignments = columns.map((column, index) => `${quoteIdentifier(column)} = $${index + 1}`).join(', ');
  const where = identity.columns.map((column, index) => `${quoteIdentifier(column)} = $${columns.length + index + 1}`).join(' AND ');
  await client.query(
    `UPDATE public.${quoteIdentifier(tableName)} SET ${assignments} WHERE ${where}`,
    [...columns.map(column => row[column]), ...identity.values]
  );
  await storeIdMapping(client, sourceNodeId, tableName, sourceData, current);
  return { current: plainRecord(current), written: true };
}

async function unresolvedConflict(database, tableName, key) {
  const result = await database.query(
    `SELECT 1 FROM sync_conflicts
     WHERE status = 'unresolved' AND table_name = $1 AND record_key = $2::jsonb
     LIMIT 1`,
    [tableName, JSON.stringify(key)]
  );
  return result.rows.length > 0;
}

async function applyEvent(sourceDatabase, targetDatabase, event) {
  const sourcePool = poolFor(sourceDatabase);
  const targetPool = poolFor(targetDatabase);
  if (!TABLE_SET.has(event.table_name)) throw new Error('Unsupported synchronization table');
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    const inbox = await client.query('SELECT status FROM sync_inbox WHERE event_id = $1 FOR UPDATE', [event.event_id]);
    if (inbox.rows[0]?.status === 'applied') {
      await client.query('COMMIT');
      return 'duplicate';
    }
    if (inbox.rows[0]?.status === 'conflict') {
      await client.query('COMMIT');
      return 'conflict';
    }

    const rawKey = parseJson(event.record_key);
    if (await unresolvedConflict(client, event.table_name, rawKey) ||
        await unresolvedConflict(sourcePool, event.table_name, rawKey)) {
      await client.query('ROLLBACK');
      return 'blocked';
    }
    const key = await mapRecordKey(sourcePool, targetPool, event.table_name, rawKey);
    const current = await findRecord(client, event.table_name, key);
    const before = parseJson(event.before_data);
    const after = parseJson(event.after_data);
    let mappedBefore = before;
    let mappedAfter = after;
    if (before) mappedBefore = await mapForeignKeys(sourcePool, targetPool, event.table_name, before, event.origin_node_id);
    if (after) mappedAfter = await mapForeignKeys(sourcePool, targetPool, event.table_name, after, event.origin_node_id);

    const isDelete = event.operation === 'DELETE';
    const alreadyApplied = isDelete ? !current : current && sameRecord(current, mappedAfter);
    if (alreadyApplied && current) {
      await storeIdMapping(client, event.origin_node_id, event.table_name, after || before, current);
    }
    const expectedCurrent = before || after;
    if (!alreadyApplied && current && expectedCurrent && !sameRecord(current, before ? mappedBefore : mappedAfter)) {
      const conflictId = event.event_id;
      const stateResult = await client.query('SELECT node_id FROM sync_state WHERE singleton = TRUE');
      const targetNodeId = stateResult.rows[0]?.node_id;
      await client.query(`
        INSERT INTO sync_conflicts (
          event_id, origin_node_id, target_node_id, table_name, record_key, local_data, remote_data
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb)
        ON CONFLICT (event_id) DO NOTHING
      `, [
        conflictId, event.origin_node_id, targetNodeId, event.table_name, JSON.stringify(rawKey),
        JSON.stringify(plainRecord(current)), after ? JSON.stringify(after) : null
      ]);
      await client.query(`
        INSERT INTO sync_inbox (event_id, origin_node_id, status)
        VALUES ($1, $2, 'conflict')
        ON CONFLICT (event_id) DO UPDATE SET status = 'conflict'
      `, [event.event_id, event.origin_node_id]);
      await client.query('COMMIT');
      return 'conflict';
    }

    if (!alreadyApplied) {
      await client.query("SELECT set_config('app.sync_apply', 'true', TRUE)");
      await writeRecord(
        client,
        sourcePool,
        targetPool,
        event.table_name,
        event.operation,
        rawKey,
        after || before,
        event.origin_node_id
      );
    }
    await client.query(`
      INSERT INTO sync_inbox (event_id, origin_node_id, status, applied_at)
      VALUES ($1, $2, 'applied', CURRENT_TIMESTAMP)
      ON CONFLICT (event_id) DO UPDATE SET status = 'applied', applied_at = CURRENT_TIMESTAMP
    `, [event.event_id, event.origin_node_id]);
    await client.query('COMMIT');
    return alreadyApplied ? 'duplicate' : 'applied';
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

function retryDelaySeconds(attempts) {
  return Math.min(5 * (2 ** Math.min(attempts, 12)), MAX_RETRY_SECONDS);
}

async function getCloudStudentPhotoUrls() {
  const photoUrls = new Set();
  const result = await poolFor('cloud').query(
    "SELECT DISTINCT url FROM student_photos WHERE url IS NOT NULL AND url <> ''"
  );
  for (const row of result.rows) photoUrls.add(row.url);
  return [...photoUrls];
}

async function processDirection(sourceDatabase, targetDatabase, startedAt) {
  const sourcePool = poolFor(sourceDatabase);
  const targetPool = poolFor(targetDatabase);
  const direction = `${sourceDatabase}_to_${targetDatabase}`;
  const history = await sourcePool.query(`
    INSERT INTO sync_history (direction, status, started_at) VALUES ($1, 'running', $2) RETURNING id
  `, [direction, startedAt]);
  const historyId = history.rows[0].id;
  let applied = 0;
  let conflicts = 0;
  let failures = 0;

  try {
    const { rows: events } = await sourcePool.query(`
      SELECT outbox.* FROM sync_outbox outbox
      WHERE outbox.status IN ('pending', 'failed')
        AND outbox.next_attempt_at <= CURRENT_TIMESTAMP
        AND NOT EXISTS (
          SELECT 1 FROM sync_outbox earlier
          WHERE earlier.table_name = outbox.table_name
            AND earlier.record_key = outbox.record_key
            AND earlier.id < outbox.id
            AND earlier.status IN ('pending', 'failed', 'conflict')
        )
      ORDER BY outbox.id
      LIMIT $1
    `, [BATCH_SIZE]);
    for (const event of events) {
      try {
        const result = await applyEvent(sourceDatabase, targetDatabase, event);
        if (result === 'blocked') continue;
        if (result === 'conflict') {
          conflicts += 1;
          await sourcePool.query(
            `UPDATE sync_outbox SET status = 'conflict', last_error = 'Manual conflict resolution required' WHERE id = $1`,
            [event.id]
          );
        } else {
          applied += result === 'applied' ? 1 : 0;
          await sourcePool.query(`
            UPDATE sync_outbox SET status = 'synced', synced_at = CURRENT_TIMESTAMP, last_error = NULL
            WHERE id = $1
          `, [event.id]);
          await targetPool.query(`
            INSERT INTO sync_cursors (peer_node_id, last_received_event_id)
            VALUES ($1, $2)
            ON CONFLICT (peer_node_id) DO UPDATE
              SET last_received_event_id = GREATEST(sync_cursors.last_received_event_id, EXCLUDED.last_received_event_id),
                  updated_at = CURRENT_TIMESTAMP
          `, [event.origin_node_id, event.id]);
        }
      } catch (error) {
        failures += 1;
        const attempts = Number(event.attempts) + 1;
        await sourcePool.query(`
          UPDATE sync_outbox SET status = 'failed', attempts = $2,
            next_attempt_at = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 second'),
            last_error = $4
          WHERE id = $1
        `, [event.id, attempts, retryDelaySeconds(attempts), error.code || error.name || 'sync_error']);
        logError({
          event: 'sync.event_failed',
          direction,
          eventId: event.event_id,
          table: event.table_name,
          code: error.code || error.name
        });
      }
    }
    const status = failures ? (applied || conflicts ? 'partial' : 'failed') : 'completed';
    await sourcePool.query(`
      UPDATE sync_history SET status = $2, completed_at = CURRENT_TIMESTAMP,
        sent_count = $3, conflict_count = $4,
        error_message = CASE WHEN $5 > 0 THEN 'One or more events require retry' ELSE NULL END
      WHERE id = $1
    `, [historyId, status, applied, conflicts, failures]);
    return { applied, conflicts, failures, processed: events.length };
  } catch (error) {
    await sourcePool.query(`
      UPDATE sync_history SET status = 'failed', completed_at = CURRENT_TIMESTAMP, error_message = $2
      WHERE id = $1
    `, [historyId, error.code || error.name || 'sync_error']);
    throw error;
  }
}

export async function runSyncNow(direction = 'both') {
  if (!['local_to_cloud', 'cloud_to_local', 'both'].includes(direction)) {
    throw Object.assign(new Error('Synchronization direction must be local_to_cloud, cloud_to_local, or both'), { status: 400 });
  }
  if (!SYNC_ENABLED) {
    throw Object.assign(new Error('Synchronization is disabled by the local backend configuration'), { status: 409 });
  }
  if (getDatabaseMode() !== 'hybrid') {
    throw Object.assign(new Error('Synchronization is available only in Hybrid mode'), { status: 409 });
  }
  if (currentRun) return currentRun;
  currentRun = (async () => {
    const startedAt = new Date();
    const localResult = direction !== 'cloud_to_local'
      ? await processDirection('local', 'cloud', startedAt)
      : null;
    const cloudResult = direction !== 'local_to_cloud'
      ? await processDirection('cloud', 'local', startedAt)
      : null;
    const photoStorage = process.env.STORAGE_DRIVER === 'local'
      ? await (await import('../utils/studentPhotos.js')).syncPendingStudentPhotos({
        direction,
        photoUrls: direction !== 'local_to_cloud' ? await getCloudStudentPhotoUrls() : []
      })
      : { processed: 0, synced: 0, failed: 0, uploaded: 0, downloaded: 0 };
    if (photoStorage.failed) {
      logError({ event: 'sync.student_photos_failed', failed: photoStorage.failed });
    }
    logInfo({
      event: 'sync.run_completed',
      localToCloud: localResult,
      cloudToLocal: cloudResult,
      photoStorage,
      direction
    });
    return { localToCloud: localResult, cloudToLocal: cloudResult, photoStorage, direction };
  })();
  try {
    return await currentRun;
  } finally {
    currentRun = null;
  }
}

export function startSyncWorker() {
  if (workerTimer || !SYNC_ENABLED || !automaticSyncEnabled || getDatabaseMode() !== 'hybrid') return;
  workerTimer = setInterval(() => {
    runSyncNow().catch(error => logError({
      event: 'sync.worker_failed',
      code: error.code || error.name
    }));
  }, INTERVAL_MS);
  workerTimer.unref();
}

export function stopSyncWorker() {
  if (workerTimer) clearInterval(workerTimer);
  workerTimer = undefined;
}

export async function initializeSync() {
  const cloudModeConfigured = normalizeDatabaseMode(process.env.DB_MODE) === 'cloud_only';
  const preferredDatabase = getDatabaseMode() === 'cloud_only' ? 'cloud' : 'local';
  const alternateDatabase = preferredDatabase === 'cloud' ? 'local' : 'cloud';
  const candidates = [
    [preferredDatabase, getDatabasePool(preferredDatabase)],
    [alternateDatabase, getDatabasePool(alternateDatabase)]
  ].filter(([, database], index, values) => database && values.findIndex(([, candidate]) => candidate === database) === index);
  let state;
  let stateDatabase;
  for (const [databaseName, database] of candidates) {
    try {
      state = await database.query('SELECT node_id, mode, auto_enabled, auto_configured FROM sync_state WHERE singleton = TRUE');
      stateDatabase = database;
      break;
    } catch (error) {
      if (error.code === '42P01') {
        logError({ event: 'sync.migration_missing', database: databaseName });
        continue;
      }
      logError({ event: 'sync.database_unavailable', database: databaseName, code: error.code || error.name });
    }
  }
  if (!state) return { enabled: false, reason: 'migration_missing_or_database_unavailable' };
  if (!state.rows[0] || state.rows[0].mode === 'disabled' || !state.rows[0].auto_configured) {
    await stateDatabase.query(
      `INSERT INTO sync_state (singleton, mode, auto_enabled, auto_configured)
       VALUES (TRUE, $1, $2, TRUE)
       ON CONFLICT (singleton) DO UPDATE SET
         mode = CASE WHEN sync_state.mode = 'disabled' THEN EXCLUDED.mode ELSE sync_state.mode END,
         auto_enabled = EXCLUDED.auto_enabled, auto_configured = TRUE, updated_at = CURRENT_TIMESTAMP`,
      [getDatabaseMode(), AUTO_SYNC_DEFAULT]
    );
    automaticSyncEnabled = AUTO_SYNC_DEFAULT;
  } else {
    automaticSyncEnabled = state.rows[0].auto_enabled;
  }
  if (!cloudModeConfigured && state.rows[0]?.mode && state.rows[0].mode !== 'disabled' &&
      state.rows[0].mode !== getDatabaseMode()) {
    try {
      if (state.rows[0].mode === 'hybrid') {
        validateDatabaseMode('hybrid');
        for (const database of ['local', 'cloud']) {
          await poolFor(database).query('SELECT node_id FROM sync_state WHERE singleton = TRUE');
        }
      }
      setDatabaseMode(state.rows[0].mode);
    } catch (error) {
      logError({
        event: 'sync.persisted_mode_unavailable',
        persistedMode: state.rows[0].mode,
        configuredMode: getDatabaseMode(),
        code: error.code || error.name
      });
      return { enabled: false, reason: 'persisted_mode_unavailable' };
    }
  }
  if (getDatabaseMode() === 'hybrid') {
    startSyncWorker();
  }
  return { enabled: true };
}

export async function changeDatabaseMode(mode) {
  mode = normalizeDatabaseMode(mode);
  if (!MODES.has(mode)) throw Object.assign(new Error('Invalid database mode'), { status: 400 });
  if (mode === 'hybrid') {
    validateDatabaseMode(mode);
    for (const database of ['local', 'cloud']) {
      try {
        await poolFor(database).query('SELECT node_id FROM sync_state WHERE singleton = TRUE');
      } catch (error) {
        if (error.code === '42P01') {
          throw Object.assign(
            new Error(`Apply migrate_sync.postgres.sql to the ${database} database before enabling Hybrid Mode`),
            { status: 503 }
          );
        }
        throw error;
      }
    }
  } else {
    await poolFor(mode === 'cloud_only' ? 'cloud' : 'local').query('SELECT 1');
  }

  let persisted = false;
  const configuredPools = [
    ['local', getDatabasePool('local')],
    ['cloud', getDatabasePool('cloud')]
  ].filter(([, database], index, values) => database && values.findIndex(([, candidate]) => candidate === database) === index);
  for (const [databaseName, database] of configuredPools) {
    try {
      const result = await database.query(
        `UPDATE sync_state SET mode = $1, auto_enabled = $2, auto_configured = TRUE,
           updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE`,
        [mode, automaticSyncEnabled]
      );
      if (result.rowCount > 0) persisted = true;
    } catch (error) {
      logError({ event: 'sync.mode_persistence_failed', database: databaseName, code: error.code || error.name });
    }
  }
  if (!persisted) throw Object.assign(new Error('Could not persist the selected database mode; apply the synchronization migration first'), { status: 503 });
  setDatabaseMode(mode);
  if (mode === 'hybrid') startSyncWorker();
  else stopSyncWorker();
  return mode;
}

export async function setAutomaticSyncEnabled(enabled) {
  if (!SYNC_ENABLED) {
    throw Object.assign(new Error('Synchronization is disabled by the local backend configuration'), { status: 409 });
  }
  if (getDatabaseMode() !== 'hybrid') {
    throw Object.assign(new Error('Automatic synchronization can be changed only in Hybrid mode'), { status: 409 });
  }
  const database = getDatabasePool('local') || getDatabasePool('cloud');
  if (!database) throw Object.assign(new Error('No database is configured for synchronization settings'), { status: 503 });
  const result = await database.query(
    'UPDATE sync_state SET auto_enabled = $1, auto_configured = TRUE, updated_at = CURRENT_TIMESTAMP WHERE singleton = TRUE',
    [enabled]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('Synchronization settings are missing; apply migrate_sync.postgres.sql'), { status: 503 });
  }
  automaticSyncEnabled = enabled;
  if (automaticSyncEnabled) startSyncWorker();
  else stopSyncWorker();
  return { autoEnabled: automaticSyncEnabled };
}

export async function testDatabaseConnection(database) {
  if (!['local', 'cloud'].includes(database)) {
    throw Object.assign(new Error('Database must be local or cloud'), { status: 400 });
  }
  const pool = getDatabasePool(database);
  if (!pool) return { database, configured: false, connected: false, error: 'not_configured' };
  const startedAt = performance.now();
  try {
    await pool.query('SELECT 1');
    return { database, configured: true, connected: true, latencyMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    logError({ event: 'sync.connection_test_failed', database, code: error.code || error.name });
    return {
      database,
      configured: true,
      connected: false,
      error: error.code || 'database_unavailable'
    };
  }
}

async function databaseStatus(database) {
  const pool = getDatabasePool(database);
  if (!pool) return { configured: false, connected: false };
  const localPool = getDatabasePool('local');
  const cloudPool = getDatabasePool('cloud');
  if (localPool && localPool === cloudPool &&
      database !== (getDatabaseMode() === 'cloud_only' ? 'cloud' : 'local')) {
    return { configured: false, connected: false };
  }
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    return {
      configured: true,
      connected: false,
      error: error.code || 'database_unavailable'
    };
  }
  try {
    const counts = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::INTEGER AS pending,
        COUNT(*) FILTER (WHERE status = 'failed')::INTEGER AS failed,
        COUNT(*) FILTER (WHERE status = 'conflict')::INTEGER AS blocked
      FROM sync_outbox
    `);
    const conflicts = await pool.query(
      `SELECT COUNT(*)::INTEGER AS count FROM sync_conflicts WHERE status = 'unresolved'`
    );
    return {
      configured: true,
      connected: true,
      pending: counts.rows[0].pending,
      failed: counts.rows[0].failed,
      blocked: counts.rows[0].blocked,
      conflicts: conflicts.rows[0].count,
      syncReady: true
    };
  } catch (error) {
    if (error.code === '42P01') {
      return { configured: true, connected: true, syncReady: false, error: 'sync_migration_missing' };
    }
    return {
      configured: true,
      connected: true,
      syncReady: false,
      error: error.code || 'database_unavailable'
    };
  }
}

function safeRow(row) {
  if (!row) return null;
  const safe = { ...row };
  delete safe.password_hash;
  return safe;
}

export async function getSyncDashboard() {
  const [local, cloud] = await Promise.all([
    databaseStatus('local'),
    databaseStatus('cloud')
  ]);
  const history = [];
  const conflicts = [];
  const failedEvents = [];
  for (const database of ['local', 'cloud']) {
    const databasePool = getDatabasePool(database);
    if (!databasePool) continue;
    if (!(database === 'local' ? local : cloud).connected) continue;
    try {
      const [historyRows, conflictRows, failedRows] = await Promise.all([
        databasePool.query('SELECT * FROM sync_history ORDER BY started_at DESC LIMIT 50'),
        databasePool.query(`
          SELECT conflict_id, event_id, table_name, record_key, local_data, remote_data,
            status, resolution, created_at, resolved_at
          FROM sync_conflicts ORDER BY created_at DESC LIMIT 100
        `),
        databasePool.query(`
          SELECT event_id, table_name, operation, record_key, status, attempts,
            last_error, created_at, next_attempt_at
          FROM sync_outbox WHERE status IN ('failed', 'conflict')
          ORDER BY created_at DESC LIMIT 50
        `)
      ]);
      history.push(...historyRows.rows.map(row => ({ ...row, database })));
      conflicts.push(...conflictRows.rows.map(row => ({
        ...row,
        database,
        local_data: safeRow(parseJson(row.local_data)),
        remote_data: safeRow(parseJson(row.remote_data))
      })));
      failedEvents.push(...failedRows.rows.map(row => ({ ...row, database })));
    } catch (error) {
      if (error.code !== '42P01') {
        logError({ event: 'sync.dashboard_query_failed', database, code: error.code || error.name });
        throw error;
      }
    }
  }
  history.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));
  conflicts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  failedEvents.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const photoStorage = process.env.STORAGE_DRIVER === 'local'
    ? await (await import('../utils/studentPhotos.js')).getStudentPhotoSyncStatus()
    : { enabled: false, pending: 0, failed: 0, running: false };
  return {
    mode: getDatabaseMode(),
    syncEnabled: SYNC_ENABLED,
    autoEnabled: automaticSyncEnabled,
    syncRunning: Boolean(currentRun),
    photoStorage,
    local,
    cloud,
    lastSuccessfulSync: history.find(item => item.status === 'completed')?.completed_at || null,
    lastError: failedEvents[0]?.last_error || null,
    history: history.slice(0, 50),
    conflicts: conflicts.slice(0, 100),
    failedEvents: failedEvents.slice(0, 50)
  };
}

export async function getSyncHistoryPage(requestedPage, status = 'all', databaseFilter = 'all', from = null, to = null) {
  const statusFilter = status === 'all' ? null : status;
  const databases = await Promise.all(['local', 'cloud'].map(async database => {
    if (databaseFilter !== 'all' && database !== databaseFilter) {
      return { database, pool: null, total: 0 };
    }
    const databasePool = getDatabasePool(database);
    if (!databasePool) return { database, pool: null, total: 0 };

    const status = await databaseStatus(database);
    if (!status.connected) return { database, pool: null, total: 0 };

    try {
      const result = await databasePool.query(`
        SELECT COUNT(*)::INTEGER AS total FROM sync_history
        WHERE ($1::VARCHAR IS NULL OR status = $1::VARCHAR)
          AND ($2::TIMESTAMPTZ IS NULL OR started_at >= $2::TIMESTAMPTZ)
          AND ($3::TIMESTAMPTZ IS NULL OR started_at <= $3::TIMESTAMPTZ)
      `, [statusFilter, from, to]);
      return { database, pool: databasePool, total: Number(result.rows[0].total) };
    } catch (error) {
      if (error.code === '42P01') return { database, pool: null, total: 0 };
      logError({ event: 'sync.history_count_failed', database, code: error.code || error.name });
      throw error;
    }
  }));
  const total = databases.reduce((sum, item) => sum + item.total, 0);
  const pageCount = Math.ceil(total / SYNC_HISTORY_PAGE_SIZE);
  const page = Math.min(requestedPage, Math.max(pageCount, 1));
  const offset = (page - 1) * SYNC_HISTORY_PAGE_SIZE;
  const rowLimit = offset + SYNC_HISTORY_PAGE_SIZE;
  const history = [];

  await Promise.all(databases.map(async ({ database, pool, total: databaseTotal }) => {
    if (!pool || !databaseTotal) return;
    try {
      const result = await pool.query(`
        SELECT id, started_at, direction, status, sent_count, conflict_count
        FROM sync_history
        WHERE ($1::VARCHAR IS NULL OR status = $1::VARCHAR)
          AND ($2::TIMESTAMPTZ IS NULL OR started_at >= $2::TIMESTAMPTZ)
          AND ($3::TIMESTAMPTZ IS NULL OR started_at <= $3::TIMESTAMPTZ)
        ORDER BY started_at DESC, id DESC
        LIMIT $4
      `, [statusFilter, from, to, rowLimit]);
      history.push(...result.rows.map(row => ({ ...row, database })));
    } catch (error) {
      if (error.code === '42P01') return;
      logError({ event: 'sync.history_query_failed', database, code: error.code || error.name });
      throw error;
    }
  }));

  history.sort((a, b) =>
    new Date(b.started_at) - new Date(a.started_at) ||
    (a.database === b.database ? 0 : a.database === 'local' ? -1 : 1) ||
    String(b.id).localeCompare(String(a.id), undefined, { numeric: true })
  );
  return {
    history: history.slice(offset, offset + SYNC_HISTORY_PAGE_SIZE),
    page,
    pageSize: SYNC_HISTORY_PAGE_SIZE,
    total,
    pageCount,
    statusFilter: status
  };
}

export async function retryFailedSyncEvents() {
  if (getDatabaseMode() !== 'hybrid') {
    throw Object.assign(new Error('Retry is available only in Hybrid mode'), { status: 409 });
  }
  let retried = 0;
  const unavailable = [];
  for (const database of ['local', 'cloud']) {
    const databasePool = getDatabasePool(database);
    if (!databasePool) continue;
    try {
      const result = await databasePool.query(`
        UPDATE sync_outbox SET status = 'pending', attempts = 0,
          next_attempt_at = CURRENT_TIMESTAMP, last_error = NULL
        WHERE status = 'failed'
      `);
      retried += result.rowCount;
    } catch (error) {
      unavailable.push(database);
      logError({ event: 'sync.retry_database_unavailable', database, code: error.code || error.name });
    }
  }
  const photoRetried = process.env.STORAGE_DRIVER === 'local'
    ? await (await import('../utils/studentPhotos.js')).retryFailedStudentPhotoSync()
    : 0;
  return { retried, photoRetried, unavailable };
}

export async function getSyncEventDetails(eventId) {
  const details = [];
  for (const database of ['local', 'cloud']) {
    const databasePool = getDatabasePool(database);
    if (!databasePool) continue;
    try {
      const result = await databasePool.query(`
        SELECT event_id, table_name, operation, record_key, before_data, after_data,
          status, attempts, last_error, created_at, synced_at
        FROM sync_outbox WHERE event_id = $1
      `, [eventId]);
      for (const row of result.rows) {
        details.push({
          ...row,
          database,
          before_data: safeRow(parseJson(row.before_data)),
          after_data: safeRow(parseJson(row.after_data))
        });
      }
    } catch (error) {
      if (error.code === '42P01') continue;
      logError({ event: 'sync.event_details_database_unavailable', database, code: error.code || error.name });
    }
  }
  return details;
}

export async function resolveSyncConflict(conflictId, resolution) {
  if (!['keep_local', 'keep_cloud'].includes(resolution)) {
    throw Object.assign(new Error('Resolution must be keep_local or keep_cloud'), { status: 400 });
  }
  const localPool = poolFor('local');
  const cloudPool = poolFor('cloud');
  let conflict;
  let conflictDatabase;
  for (const [database, databasePool] of [['local', localPool], ['cloud', cloudPool]]) {
    const result = await databasePool.query(
      `SELECT * FROM sync_conflicts WHERE conflict_id = $1 AND status = 'unresolved'`,
      [conflictId]
    );
    if (result.rows[0]) {
      conflict = result.rows[0];
      conflictDatabase = database;
      break;
    }
  }
  if (!conflict) throw Object.assign(new Error('Unresolved synchronization conflict not found'), { status: 404 });

  const sourceDatabase = conflictDatabase === 'local' ? 'cloud' : 'local';
  const preferredDatabase = resolution === 'keep_local' ? 'local' : 'cloud';
  const sourcePool = poolFor(preferredDatabase);
  const sourceState = await sourcePool.query('SELECT node_id FROM sync_state WHERE singleton = TRUE');
  const targetDatabase = preferredDatabase === 'local' ? 'cloud' : 'local';
  const targetPool = poolFor(targetDatabase);
  const eventResult = await poolFor(sourceDatabase).query(
    `SELECT * FROM sync_outbox WHERE event_id = $1`,
    [conflict.event_id]
  );
  const originalEvent = eventResult.rows[0];
  if (!originalEvent) throw new Error('The original synchronization event is missing');

  const conflictKey = parseJson(conflict.record_key);
  const preferredKey = await mapRecordKey(sourcePool, sourcePool, conflict.table_name, conflictKey);
  const preferredClient = await sourcePool.connect();
  let preferredSnapshot;
  try {
    await preferredClient.query('BEGIN');
    preferredSnapshot = plainRecord(await findRecord(preferredClient, conflict.table_name, preferredKey));
    await preferredClient.query('COMMIT');
  } catch (error) {
    await preferredClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    preferredClient.release();
  }

  const eventIds = [];
  for (const databasePool of [localPool, cloudPool]) {
    const result = await databasePool.query(`
      SELECT event_id FROM sync_outbox
      WHERE table_name = $1 AND record_key = $2::jsonb
        AND status IN ('pending', 'failed', 'conflict')
    `, [conflict.table_name, JSON.stringify(conflictKey)]);
    eventIds.push(...result.rows.map(row => row.event_id));
  }
  const targetClient = await targetPool.connect();
  try {
    await targetClient.query('BEGIN');
    await targetClient.query("SELECT set_config('app.sync_apply', 'false', TRUE)");
    await writeRecord(
      targetClient,
      sourcePool,
      targetPool,
      conflict.table_name,
      preferredSnapshot ? 'UPDATE' : 'DELETE',
      conflictKey,
      preferredSnapshot,
      sourceState.rows[0]?.node_id
    );
    await targetClient.query('COMMIT');
  } catch (error) {
    await targetClient.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    targetClient.release();
  }

  await poolFor(sourceDatabase).query(
    `UPDATE sync_outbox SET status = 'synced', synced_at = CURRENT_TIMESTAMP WHERE event_id = $1`,
    [conflict.event_id]
  );
  await poolFor(conflictDatabase).query(
    `UPDATE sync_inbox SET status = 'applied', applied_at = CURRENT_TIMESTAMP WHERE event_id = $1`,
    [conflict.event_id]
  );
  await poolFor(conflictDatabase).query(`
    UPDATE sync_conflicts SET status = 'resolved', resolution = $2, resolved_at = CURRENT_TIMESTAMP
    WHERE conflict_id = $1
  `, [conflictId, resolution]);
  if (eventIds.length) {
    for (const databasePool of [localPool, cloudPool]) {
      await databasePool.query(
        `UPDATE sync_outbox SET status = 'synced', synced_at = CURRENT_TIMESTAMP WHERE event_id = ANY($1::uuid[])`,
        [eventIds]
      );
      await databasePool.query(
        `UPDATE sync_inbox SET status = 'applied', applied_at = CURRENT_TIMESTAMP WHERE event_id = ANY($1::uuid[])`,
        [eventIds]
      );
    }
  }
  for (const databasePool of [localPool, cloudPool]) {
    await databasePool.query(`
      UPDATE sync_conflicts SET status = 'resolved', resolution = $3, resolved_at = CURRENT_TIMESTAMP
      WHERE table_name = $1 AND record_key = $2::jsonb AND status = 'unresolved'
    `, [conflict.table_name, JSON.stringify(conflictKey), resolution]);
  }
  return { conflictId, resolution };
}
