// The only way text gets published on As One. The app sends posts, comments
// and profile edits here; this function checks who's signed in, screens the
// text, and only then writes it with the service role. The database refuses
// those writes from anyone else, so screening can't be skipped.
//
// Responses (JSON):
//   { status: 'ok', id? }            published
//   { status: 'crisis' }             post not published yet: show the helpline,
//                                    then resend with crisis_acknowledged: true
//   { status: 'blocked', paused }    not published; paused = commenting paused
//   { status: 'unavailable' }        screening couldn't run; nothing published
//   { error }                        anything else (with a 4xx/5xx status)

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

import { screen, type ScreeningInput } from '../_shared/screening.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

const anthropic = new Anthropic(); // ANTHROPIC_API_KEY, set with `supabase secrets set`
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

type Request =
  | {
      action: 'post';
      kind: string;
      body: string;
      anonymous: boolean;
      to_corner: boolean;
      to_everyone: boolean;
      comments_private?: boolean;
      follow_up_of?: string | null;
      crisis_acknowledged?: boolean;
      notify_buddies?: boolean;
    }
  | { action: 'comment'; post_id: string; body: string; reply_to?: string | null }
  | { action: 'profile'; display_name: string; bio: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  const userId = auth.user?.id;
  if (!userId) return reply({ error: 'Not signed in' }, 401);

  let request: Request;
  try {
    request = await req.json();
  } catch {
    return reply({ error: 'Invalid request' }, 400);
  }

  let input: ScreeningInput;
  switch (request.action) {
    case 'post':
      input = { kind: 'post', postKind: request.kind, text: request.body };
      break;
    case 'comment': {
      // Context for the screener: the post being commented on. Read through
      // get_post as the commenter, so this can't be used to read hidden posts.
      const asUser = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: `Bearer ${jwt}` } },
        auth: { persistSession: false },
      });
      const { data } = await asUser.rpc('get_post', { post_id: request.post_id });
      const post = data?.[0];
      if (!post) return reply({ error: 'Post not found' }, 404);
      input = { kind: 'comment', text: request.body, postExcerpt: String(post.body).slice(0, 1000) };
      break;
    }
    case 'profile':
      input = { kind: 'profile', displayName: request.display_name, bio: request.bio };
      break;
    default:
      return reply({ error: 'Unknown action' }, 400);
  }

  const result = await screen(anthropic, input);

  if (result.verdict === 'unavailable') return reply({ status: 'unavailable' });

  if (result.verdict === 'block') {
    const excerpt = request.action === 'profile' ? `${request.display_name} — ${request.bio}` : request.body;
    const { data: paused } = await admin.rpc('record_blocked_attempt', {
      actor: userId,
      target: request.action,
      category: result.category,
      excerpt,
    });
    return reply({ status: 'blocked', paused: paused === true });
  }

  const crisis = result.verdict === 'crisis';

  if (request.action === 'post') {
    // A crisis post still goes up — but only after the person has seen the
    // helpline and chosen to continue.
    if (crisis && !request.crisis_acknowledged) return reply({ status: 'crisis' });
    const { data, error } = await admin.rpc('create_post', {
      actor: userId,
      kind: request.kind,
      body: request.body,
      anonymous: request.anonymous,
      to_corner: request.to_corner,
      to_everyone: request.to_everyone,
      comments_private: request.comments_private ?? false,
      follow_up_of: request.follow_up_of ?? null,
      crisis,
      notify_buddies: request.notify_buddies ?? false,
    });
    if (error) return reply({ error: error.message }, 400);
    return reply({ status: 'ok', id: data, support: crisis });
  }

  if (request.action === 'comment') {
    const { data, error } = await admin.rpc('add_comment', {
      actor: userId,
      post_id: request.post_id,
      body: request.body,
      reply_to: request.reply_to ?? null,
    });
    if (error) return reply({ error: error.message }, 400);
    // A commenter who seems to be struggling themselves gets the helpline too.
    return reply({ status: 'ok', id: data, support: crisis });
  }

  const { error } = await admin.rpc('update_profile', {
    actor: userId,
    display_name: request.display_name,
    bio: request.bio,
  });
  if (error) return reply({ error: error.message }, 400);
  return reply({ status: 'ok', support: crisis });
});
