import test from 'node:test';
import assert from 'node:assert/strict';
import { generateRecordCode } from '../src/utils/recordCodes.js';

test('generates stable, entity-specific codes from inserted record IDs', () => {
  assert.equal(generateRecordCode('students', 1), 'STU-000001');
  assert.equal(generateRecordCode('teachers', 123), 'TCH-000123');
  assert.equal(generateRecordCode('subjects', 1000000), 'SUB-1000000');
});

test('rejects unknown record types and invalid IDs', () => {
  assert.throws(() => generateRecordCode('classes', 1), /Unsupported record code entity/);
  assert.throws(() => generateRecordCode('students', 0), /valid record ID/);
});
