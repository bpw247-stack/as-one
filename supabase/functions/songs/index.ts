// Song search for song posts. Signed-in users only; proxies Apple's catalog so
// the app works on the web too and the request shape stays in one place.
//
//   POST { query: string }  →  { songs: Song[] }

import { createClient } from '@supabase/supabase-js';

import { searchSongs } from '../_shared/itunes.ts';

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

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  const { data: auth } = jwt ? await admin.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return reply({ error: 'Not signed in' }, 401);

  const { query } = (await req.json().catch(() => ({}))) as { query?: string };
  const q = (query ?? '').trim().slice(0, 100);
  if (!q) return reply({ songs: [] });

  try {
    return reply({ songs: await searchSongs(q) });
  } catch (err) {
    console.error(err);
    return reply({ error: 'Song search is unavailable right now' }, 502);
  }
});
