import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';

const databaseModes = ['local_only', 'cloud_only', 'hybrid'];
const requestDatabaseMode = new AsyncLocalStorage();
const databaseModeAliases = {
  local: 'local_only',
  local_only: 'local_only',
  cloud: 'cloud_only',
  cloud_only: 'cloud_only',
  hybrid: 'hybrid'
};

export function normalizeDatabaseMode(mode) {
  if (typeof mode !== 'string') return null;
  const normalizedMode = mode.trim().toLowerCase();
  return Object.hasOwn(databaseModeAliases, normalizedMode) ? databaseModeAliases[normalizedMode] : null;
}

const initialMode = normalizeDatabaseMode(process.env.DB_MODE || 'cloud_only');
if (!initialMode) {
  throw new Error('DB_MODE must be LOCAL, CLOUD, HYBRID, local_only, cloud_only, or hybrid');
}

function hasSettings(prefix) {
  return Object.entries(process.env).some(([key, value]) => key.startsWith(`${prefix}_`) && Boolean(value?.trim()));
}

function readPoolConfig(prefix, fallbackPrefix = null, forceSsl = false) {
  const value = name => process.env[`${prefix}_${name}`] ??
    (fallbackPrefix ? process.env[`${fallbackPrefix}_${name}`] : undefined);
  const required = ['HOST', 'NAME', 'USER', 'PASSWORD'];
  const missing = required.filter(name => value(name) === undefined || value(name) === null ||
    (name !== 'PASSWORD' && !value(name).trim()));
  if (missing.length) {
    if (missing.every(name => !value(name))) return null;
    throw new Error(`Missing PostgreSQL connection settings for ${prefix}: ${missing.join(', ')}`);
  }

  const sslSetting = process.env[`${prefix}_SSL`] ||
    (fallbackPrefix ? process.env[`${fallbackPrefix}_SSL`] : undefined);
  if (forceSsl && sslSetting === 'false') {
    throw new Error(`${prefix}_SSL cannot be disabled for cloud PostgreSQL connections`);
  }
  const sslEnabled = forceSsl || process.env.NODE_ENV === 'production' || sslSetting === 'true';
  const caPath = value('SSL_CA')?.trim();
  let ca;
  if (caPath) {
    try {
      ca = readFileSync(path.resolve(process.cwd(), caPath), 'utf8');
    } catch (error) {
      throw new Error(`Unable to read the PostgreSQL CA certificate at "${caPath}": ${error.message}`, { cause: error });
    }
  }
  const poolConfig = {
    host: value('HOST'),
    port: Number(value('PORT') || 5432),
    database: value('NAME'),
    user: value('USER'),
    password: value('PASSWORD'),
    max: Number(value('CONNECTION_LIMIT') || 10),
    connectionTimeoutMillis: Number(value('CONNECT_TIMEOUT_MS') || 10000),
    idleTimeoutMillis: Number(value('IDLE_TIMEOUT_MS') || 30000),
    ssl: sslEnabled ? { rejectUnauthorized: true, ...(ca ? { ca } : {}) } : undefined
  };
  if (!Number.isInteger(poolConfig.port) || poolConfig.port < 1 || poolConfig.port > 65535 ||
      !Number.isInteger(poolConfig.max) || poolConfig.max < 1 ||
      !Number.isInteger(poolConfig.connectionTimeoutMillis) || poolConfig.connectionTimeoutMillis < 1 ||
      !Number.isInteger(poolConfig.idleTimeoutMillis) || poolConfig.idleTimeoutMillis < 1) {
    throw new Error(`${prefix} pool size and timeouts must be positive integers`);
  }
  return poolConfig;
}

const localHasSettings = hasSettings('LOCAL_DB');
const cloudHasSettings = hasSettings('CLOUD_DB');
const legacyConfig = readPoolConfig(
  'DB',
  null,
  initialMode === 'cloud_only' && !localHasSettings && !cloudHasSettings
);
const localConfig = localHasSettings
  ? readPoolConfig('LOCAL_DB', 'DB')
  : cloudHasSettings ? null : legacyConfig;
const cloudConfig = cloudHasSettings
  ? readPoolConfig('CLOUD_DB', 'DB', true)
  : localHasSettings && legacyConfig ? readPoolConfig('DB', null, true) : legacyConfig;
const sharedPool = !localHasSettings && !cloudHasSettings && legacyConfig
  ? new pg.Pool(legacyConfig)
  : null;
const pools = {
  local: sharedPool || (localConfig ? new pg.Pool(localConfig) : null),
  cloud: sharedPool || (cloudConfig ? new pg.Pool(cloudConfig) : null)
};

let activeMode = initialMode;

function sameDatabase(left, right) {
  return left && right &&
    left.host.toLowerCase() === right.host.toLowerCase() &&
    left.port === right.port &&
    left.database === right.database &&
    left.user === right.user;
}

function databaseForMode(mode) {
  const database = mode === 'cloud_only' ? pools.cloud : pools.local;
  if (!database) {
    throw new Error(`${mode} requires a configured ${mode === 'cloud_only' ? 'CLOUD_DB' : 'LOCAL_DB'} PostgreSQL connection`);
  }
  if (mode === 'hybrid' && (!pools.local || !pools.cloud || pools.local === pools.cloud || sameDatabase(localConfig, cloudConfig))) {
    throw new Error('Hybrid mode requires distinct LOCAL_DB and CLOUD_DB PostgreSQL connections');
  }
  return database;
}

export function getDatabaseMode() {
  return activeMode;
}

export function bindDatabaseMode(req, res, next) {
  requestDatabaseMode.run(activeMode, next);
}

export function runWithDatabaseMode(mode, callback) {
  const normalizedMode = normalizeDatabaseMode(mode);
  if (!normalizedMode) throw new Error('Invalid request database mode');
  return requestDatabaseMode.run(normalizedMode, callback);
}

export function setDatabaseMode(mode) {
  const normalizedMode = normalizeDatabaseMode(mode);
  if (!normalizedMode) {
    throw new Error('Database mode must be LOCAL, CLOUD, HYBRID, local_only, cloud_only, or hybrid');
  }
  validateDatabaseMode(normalizedMode);
  activeMode = normalizedMode;
}

export function validateDatabaseMode(mode) {
  const normalizedMode = normalizeDatabaseMode(mode);
  if (!normalizedMode) {
    throw new Error('Database mode must be LOCAL, CLOUD, HYBRID, local_only, cloud_only, or hybrid');
  }
  return databaseForMode(normalizedMode);
}

export function getDatabasePool(target) {
  if (target === 'local') return pools.local;
  if (target === 'cloud') return pools.cloud;
  return databaseForMode(requestDatabaseMode.getStore() || activeMode);
}

const activePgPool = {
  query: (...args) => databaseForMode(requestDatabaseMode.getStore() || activeMode).query(...args),
  connect: (...args) => databaseForMode(requestDatabaseMode.getStore() || activeMode).connect(...args),
  end: async () => {
    const distinctPools = [...new Set(Object.values(pools).filter(Boolean))];
    const results = await Promise.allSettled(distinctPools.map(database => database.end()));
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw new AggregateError(failures, 'One or more PostgreSQL pools failed to close');
  }
};

export const pgPool = activePgPool;

function normalizeError(error) {
  if (error.code === '23505') {
    error.originalCode = error.code;
    error.code = 'ER_DUP_ENTRY';
  } else if (error.code === '23503') {
    error.originalCode = error.code;
    error.code = 'ER_ROW_IS_REFERENCED_2';
  }
  return error;
}

function parameterize(sql) {
  let output = '';
  let parameterIndex = 0;
  let quote = null;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (quote) {
      output += character;
      if (character === quote) {
        if (sql[index + 1] === quote) {
          output += sql[index + 1];
          index += 1;
        } else {
          quote = null;
        }
      } else if (character === '\\' && quote === "'" && index + 1 < sql.length) {
        output += sql[index + 1];
        index += 1;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === '?') {
      parameterIndex += 1;
      const nullCheck = /^\s+IS\s+NULL\b/i.test(sql.slice(index + 1));
      output += nullCheck ? `$${parameterIndex}::text` : `$${parameterIndex}`;
    } else {
      output += character;
    }
  }
  return output;
}

export function toPostgresQuery(sql) {
  return parameterize(sql);
}

function normalizeValues(values = []) {
  return values.map(value => typeof value === 'boolean' ? Number(value) : value);
}

function isInsert(sql) {
  return /^\s*INSERT\s+INTO\b/i.test(sql);
}

async function execute(client, sql, values = []) {
  const query = toPostgresQuery(sql);
  const text = isInsert(query) && !/\bRETURNING\b/i.test(query)
    ? `${query.trim().replace(/;$/, '')} RETURNING id`
    : query;
  try {
    const result = await client.query(text, normalizeValues(values));
    if (/^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(query)) {
      return [{
        affectedRows: result.rowCount,
        insertId: isInsert(query) ? result.rows[0]?.id : undefined
      }, result.fields];
    }
    return [result.rows, result.fields];
  } catch (error) {
    throw normalizeError(error);
  }
}

function wrapClient(client, release) {
  let released = false;
  return {
    execute: (sql, values) => execute(client, sql, values),
    query: (sql, values) => execute(client, sql, values),
    async beginTransaction() {
      await client.query('BEGIN');
    },
    async commit() {
      await client.query('COMMIT');
    },
    async rollback() {
      await client.query('ROLLBACK');
    },
    release() {
      if (released) return;
      released = true;
      release();
    }
  };
}

export const pool = {
  execute: (sql, values) => execute(databaseForMode(requestDatabaseMode.getStore() || activeMode), sql, values),
  query: (sql, values) => execute(databaseForMode(requestDatabaseMode.getStore() || activeMode), sql, values),
  async getConnection() {
    const client = await databaseForMode(requestDatabaseMode.getStore() || activeMode).connect();
    return wrapClient(client, () => client.release());
  },
  end: () => activePgPool.end()
};
