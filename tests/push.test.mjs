import assert from 'node:assert/strict';
import { test } from 'node:test';

import { chunk, deadTokens, toMessages } from '../supabase/functions/_shared/push.ts';

test('one message per device', () => {
  const messages = toMessages([
    { id: 1, title: 'Sam did it!', body: 'Ran the 5k', data: { post_id: 'p1' }, tokens: ['a', 'b'] },
    { id: 2, title: 'No devices', body: '', data: {}, tokens: [] },
  ]);
  assert.deepEqual(
    messages.map((m) => [m.to, m.title, m.data.post_id]),
    [
      ['a', 'Sam did it!', 'p1'],
      ['b', 'Sam did it!', 'p1'],
    ],
  );
});

test('chunks to Expo’s batch size', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('finds uninstalled devices from the tickets', () => {
  const messages = toMessages([{ id: 1, title: 't', body: 'b', data: {}, tokens: ['ok', 'gone', 'other'] }]);
  const tickets = [
    { status: 'ok' },
    { status: 'error', details: { error: 'DeviceNotRegistered' } },
    { status: 'error', details: { error: 'MessageRateExceeded' } },
  ];
  assert.deepEqual(deadTokens(messages, tickets), ['gone']);
});
