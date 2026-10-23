import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVerdict, screen, SCREENING_MODEL } from '../supabase/functions/_shared/screening.ts';

// A stand-in for the Anthropic client that records the request and returns a canned response.
function fakeClient(respond) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          return respond(params);
        },
      },
    },
  };
}
const answer = (json, stop_reason = 'end_turn') => () => ({
  stop_reason,
  stop_details: null,
  content: [{ type: 'text', text: JSON.stringify(json) }],
});

test('asks the default model with fallbacks and a strict JSON schema', async () => {
  const client = fakeClient(answer({ verdict: 'allow', category: 'none' }));
  assert.deepEqual(await screen(client, { kind: 'post', postKind: 'struggle', text: 'Rough week.' }), {
    verdict: 'allow',
  });
  const [params] = client.calls;
  assert.equal(params.model, SCREENING_MODEL);
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(params.output_config.format.type, 'json_schema');
  assert.equal(params.output_config.format.schema.additionalProperties, false);
  assert.equal('temperature' in params, false);
  assert.equal('thinking' in params, false);
  assert.match(params.messages[0].content, /<content>\nRough week.\n<\/content>/);
});

test('comments are screened with the post as context', async () => {
  const client = fakeClient(answer({ verdict: 'allow', category: 'none' }));
  await screen(client, { kind: 'comment', text: 'proud of you', postExcerpt: '3 months sober' });
  assert.match(client.calls[0].messages[0].content, /<post>\n3 months sober\n<\/post>/);
});

test('block, crisis and allow verdicts', async () => {
  assert.deepEqual(
    await screen(fakeClient(answer({ verdict: 'block', category: 'threat' })), { kind: 'post', postKind: 'goal', text: 'x' }),
    { verdict: 'block', category: 'threat' },
  );
  assert.deepEqual(
    await screen(fakeClient(answer({ verdict: 'crisis', category: 'none' })), { kind: 'post', postKind: 'struggle', text: 'x' }),
    { verdict: 'crisis' },
  );
});

test('anything that is not a clean answer publishes nothing', async () => {
  const input = { kind: 'post', postKind: 'struggle', text: 'x' };
  assert.deepEqual(await screen(fakeClient(answer({}, 'refusal')), input), { verdict: 'unavailable' });
  assert.deepEqual(await screen(fakeClient(answer({}, 'max_tokens')), input), { verdict: 'unavailable' });
  const failing = fakeClient(() => {
    throw new Error('network down');
  });
  const errors = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await screen(failing, input), { verdict: 'unavailable' });
  } finally {
    console.error = errors;
  }
});

test('parseVerdict rejects malformed output and defaults unknown block categories', () => {
  assert.deepEqual(parseVerdict([{ type: 'text', text: 'not json' }]), { verdict: 'unavailable' });
  assert.deepEqual(parseVerdict([]), { verdict: 'unavailable' });
  assert.deepEqual(parseVerdict([{ type: 'text', text: '{"verdict":"maybe"}' }]), { verdict: 'unavailable' });
  assert.deepEqual(parseVerdict([{ type: 'text', text: '{"verdict":"block","category":"??"}' }]), {
    verdict: 'block',
    category: 'harassment',
  });
});
