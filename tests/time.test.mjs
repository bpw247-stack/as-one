import assert from 'node:assert/strict';
import { test } from 'node:test';

import { anonymousTimeAgo, isPending, timeAgo } from '../src/lib/time.ts';

const now = new Date('2026-10-23T12:00:00Z');
const ago = (seconds) => new Date(now.getTime() - seconds * 1000).toISOString();

test('timeAgo', () => {
  assert.equal(timeAgo(ago(10), now), 'Just now');
  assert.equal(timeAgo(ago(5 * 60), now), '5m');
  assert.equal(timeAgo(ago(3 * 3600), now), '3h');
  assert.equal(timeAgo(ago(2 * 86400), now), '2d');
  assert.match(timeAgo(ago(30 * 86400), now), /Sep/);
});

test('anonymousTimeAgo never shows minutes', () => {
  assert.equal(anonymousTimeAgo(ago(5 * 60), now), 'Within the hour');
  assert.equal(anonymousTimeAgo(ago(59 * 60), now), 'Within the hour');
  assert.equal(anonymousTimeAgo(ago(2 * 3600), now), '2h');
});

test('isPending', () => {
  assert.equal(isPending(new Date(now.getTime() + 60_000).toISOString(), now), true);
  assert.equal(isPending(ago(1), now), false);
});
