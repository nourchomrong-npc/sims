import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_HOST ||= 'localhost';
process.env.DB_PORT ||= '5432';
process.env.DB_NAME ||= 'test';
process.env.DB_USER ||= 'test';
process.env.DB_PASSWORD ||= 'test';
const { toPostgresQuery } = await import('../src/config/db.js');

test('parameterizes placeholders without changing quoted question marks', () => {
  assert.equal(
    toPostgresQuery(`SELECT '?' AS literal, "?" AS quoted, ? AS value, ? IS NULL`),
    `SELECT '?' AS literal, "?" AS quoted, $1 AS value, $2::text IS NULL`
  );
});

test('keeps escaped SQL quotes intact while parameterizing values', () => {
  assert.equal(
    toPostgresQuery(`SELECT 'it''s ?' AS literal, ? AS value`),
    `SELECT 'it''s ?' AS literal, $1 AS value`
  );
});

test('allows PostgreSQL to infer nullable room parameters during schedule conflict checks', () => {
  assert.equal(
    toPostgresQuery('SELECT ?::text IS NOT NULL AND room = ?'),
    'SELECT $1::text IS NOT NULL AND room = $2'
  );
});
