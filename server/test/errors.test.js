import test from 'node:test';
import assert from 'node:assert/strict';
import { errorHandler } from '../src/middleware/errors.js';

test('logs internal server error messages without exposing them in the response', () => {
  const entries = [];
  const originalError = console.error;
  console.error = value => entries.push(JSON.parse(value));
  const response = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };

  try {
    errorHandler(
      Object.assign(new Error('relation "trash_records" does not exist'), { code: '42P01' }),
      { requestId: 'test-request-id' },
      response,
      error => { throw error; }
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: 'An unexpected server error occurred',
    request_id: 'test-request-id'
  });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'http.request_error');
  assert.equal(entries[0].requestId, 'test-request-id');
  assert.equal(entries[0].message, 'relation "trash_records" does not exist');
  assert.equal(entries[0].code, '42P01');
});
