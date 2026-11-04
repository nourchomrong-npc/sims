import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeLoginQrHash, loginQrPayload } from './loginQr.js';

test('credential QR opens the site and fills login fields from the URL fragment', () => {
  const credentials = { username: 'teacher-01', temporary_password: 'a secret & password' };
  const url = new URL(loginQrPayload(credentials, 'https://school.example/login?campaign=ignored'));

  assert.equal(url.origin + url.pathname, 'https://school.example/login');
  assert.equal(url.search, '');
  assert.deepEqual(consumeLoginQrHash(url.hash), {
    found: true,
    credentials: { username: credentials.username, password: credentials.temporary_password },
    error: ''
  });
});

test('credential QR parser ignores unrelated fragments and rejects damaged codes', () => {
  assert.deepEqual(consumeLoginQrHash('#section'), {
    found: false,
    credentials: null,
    error: ''
  });
  assert.equal(consumeLoginQrHash('#sims-login=%broken').error, 'The credential QR code is invalid or damaged.');
});
