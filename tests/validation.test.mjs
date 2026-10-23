import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ageOn, parseBirthDate, usernameError } from '../src/lib/validation.ts';

test('usernameError', () => {
  assert.equal(usernameError('sam_99'), null);
  assert.match(usernameError('ab'), /at least 3/);
  assert.match(usernameError('a'.repeat(21)), /at most 20/);
  assert.match(usernameError('no spaces'), /letters, numbers/);
});

test('parseBirthDate', () => {
  assert.equal(parseBirthDate('3/7/1995'), '1995-03-07');
  assert.equal(parseBirthDate(' 12/31/2000 '), '2000-12-31');
  assert.equal(parseBirthDate('2/30/2000'), null);
  assert.equal(parseBirthDate('1995-03-07'), null);
  assert.equal(parseBirthDate(''), null);
});

test('ageOn turns 18 on the birthday, not the day after', () => {
  const today = new Date(2026, 9, 23);
  assert.equal(ageOn('2008-10-23', today), 18);
  assert.equal(ageOn('2008-10-24', today), 17);
  assert.equal(ageOn('1990-01-01', today), 36);
});
