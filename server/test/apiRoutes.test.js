import test from 'node:test';
import assert from 'node:assert/strict';
import { apiRoutes as backendRoutes } from '../src/routes/apiRoutes.js';
import { apiRoutes as frontendRoutes, apiRoute } from '../../client/src/services/apiRoutes.js';

function flattenRoutes(routes, prefix = '', flattened = {}) {
  for (const [key, value] of Object.entries(routes)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      flattened[name] = value;
    } else {
      flattenRoutes(value, name, flattened);
    }
  }
  return flattened;
}

test('frontend API route map matches backend endpoint paths', () => {
  const frontend = flattenRoutes(frontendRoutes);
  const backend = flattenRoutes(backendRoutes);
  assert.deepEqual(frontend, Object.fromEntries(
    Object.keys(frontend).map(key => [key, backend[key]])
  ));
});

test('frontend API route builder encodes path parameters', () => {
  assert.equal(
    apiRoute(frontendRoutes.trash.restore, { entity: 'class schedules', id: 'a/b' }),
    '/trash/class%20schedules/a%2Fb/restore'
  );
  assert.throws(() => apiRoute(frontendRoutes.users.item), /Missing value for API route parameter "id"/);
});
