// Sends queued push notifications. Run it every minute with a Supabase cron
// job (see README); it also queues the private next-day check-ins that are
// due. Requires the x-cron-secret header to match the CRON_SECRET secret.

import { createClient } from '@supabase/supabase-js';

import {
  chunk,
  deadTokens,
  EXPO_BATCH,
  EXPO_PUSH_URL,
  toMessages,
  type PushTicket,
  type QueuedNotification,
} from '../_shared/push.ts';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('Forbidden', { status: 403 });
  }

  await admin.rpc('queue_due_checkins');

  const { data, error } = await admin.rpc('claim_notifications', { batch: 500 });
  if (error) return new Response(error.message, { status: 500 });

  const messages = toMessages((data ?? []) as QueuedNotification[]);
  let sent = 0;
  const gone: string[] = [];

  for (const batch of chunk(messages, EXPO_BATCH)) {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error('expo push failed', res.status, await res.text());
      continue;
    }
    const { data: tickets } = (await res.json()) as { data: PushTicket[] };
    sent += tickets.filter((t) => t.status === 'ok').length;
    gone.push(...deadTokens(batch, tickets));
  }

  if (gone.length) await admin.rpc('forget_push_tokens', { tokens: gone });

  return new Response(JSON.stringify({ messages: messages.length, sent, forgotten: gone.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
