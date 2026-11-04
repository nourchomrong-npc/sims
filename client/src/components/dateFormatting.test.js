import test from 'node:test';
import assert from 'node:assert/strict';
import { dateInputValue, formatDate, formatDateTime, formatDisplayValue, formatTime } from './dateFormatting.js';

test('formats database date strings without changing their calendar day', () => {
  const formattedDate = formatDate('2026-10-06');
  assert.equal(formatDate('2026-10-06T00:00:00.000Z'), formattedDate);
  assert.notEqual(formattedDate, '2026-10-06T00:00:00.000Z');
  assert.equal(dateInputValue('2026-10-06T00:00:00.000Z'), '2026-10-06');
});

test('formats times clearly and leaves time input values in database format', () => {
  const expected = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  }).format(new Date(2000, 0, 1, 8, 5));
  assert.equal(formatTime('08:05:00'), expected);
  assert.equal(formatDisplayValue('start_time', '08:05:00'), expected);
  assert.equal(formatTime('08:05–09:15'), `${expected}–${new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12'
  }).format(new Date(2000, 0, 1, 9, 15))}`);
  assert.equal(formatTime('invalid'), 'invalid');
});

test('formats timestamps and handles empty or invalid values safely', () => {
  assert.equal(formatDisplayValue('created_at', 'invalid'), '—');
  assert.equal(formatDisplayValue('date', null), '—');
  assert.notEqual(formatDateTime('2026-10-06T08:05:00.000Z'), '2026-10-06T08:05:00.000Z');
  assert.equal(formatDisplayValue('logged_time', '2026-10-06T08:05:00.000Z'), formatDateTime('2026-10-06T08:05:00.000Z'));
});
