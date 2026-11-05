import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { registerReportsRoutes } from '../src/routes/reports.js';
import { apiRoutes } from '../src/routes/apiRoutes.js';

function createReportsRoutes() {
  const routes = new Map();
  const queries = [];
  const pool = {
    execute: async (sql, params) => {
      queries.push({ sql, params });
      return [[]];
    },
    query: async (sql, params) => {
      queries.push({ sql, params });
      return [[]];
    }
  };
  const router = {
    get: (path, ...handlers) => routes.set(path, handlers.at(-1))
  };
  registerReportsRoutes(router, {
    z,
    pool,
    expensiveLimiter: () => {},
    publicizeRows: async (_pool, _table, rows) => rows,
    parse: (schema, input) => schema.parse(input),
    manager: () => {},
    academic: () => {},
    linkedTeacherId: async () => null,
    teacherAssignmentFilter: () => ({ sql: '', params: [] })
  });
  return { routes, queries };
}

async function callRoute(handler, req) {
  let response;
  await handler(req, { json: value => { response = value; } });
  return response;
}

test('every MIS report query is scoped to the selected academic year', async () => {
  const { routes, queries } = createReportsRoutes();
  const reportTypes = [
    'enrollment', 'attendance', 'attendance-monthly', 'frequent-absence',
    'results', 'class-performance', 'students-by-class', 'enrollment-trends'
  ];

  for (const type of reportTypes) {
    queries.length = 0;
    await callRoute(routes.get(apiRoutes.reports), {
      params: { type },
      query: {},
      academicYearId: 42
    });
    assert.equal(queries.length, 1, `${type} should execute one query`);
    assert.match(queries[0].sql, /(?:c|e)\.academic_year_id\s*=\s*\?/i, type);
    assert.ok(queries[0].params.includes(42), `${type} should bind the selected year`);
  }
});

test('decision-support queries are scoped to the selected academic year', async () => {
  const { routes, queries } = createReportsRoutes();
  await callRoute(routes.get(apiRoutes.decisionSupport), {
    params: {},
    query: {},
    academicYearId: 42
  });

  assert.equal(queries.length, 4);
  for (const { sql, params } of queries) {
    assert.match(sql, /(?:c|e)\.academic_year_id\s*=\s*\?/i);
    assert.ok(params.includes(42));
  }
});
