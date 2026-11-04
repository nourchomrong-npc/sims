import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzySearchScore } from './searchMatching.js';

test('fuzzy search accepts up to two misspelled words', () => {
  assert.notEqual(fuzzySearchScore('studen nam', 'Student name'), null);
});

test('fuzzy search rejects queries with more than two misspelled words', () => {
  assert.equal(fuzzySearchScore('studentx nane coda', 'Student name code'), null);
});

test('fuzzy search supports exact prefixes and case-insensitive matches', () => {
  assert.equal(fuzzySearchScore('STUD nam', 'Student Name'), 0);
});
