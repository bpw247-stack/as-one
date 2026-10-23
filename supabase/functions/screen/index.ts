// The only way text and photos get published on As One. The app sends posts,
// comments and profile edits here; this function checks who's signed in,
// screens the text (and any photos), and only then writes it with the service
// role. The database refuses those writes from anyone else, so screening
// can't be skipped.
//
// Photos: the app uploads JPEGs to pending/<user id>/ in the post-photos
// bucket and sends their paths. They're stripped of metadata here, screened
// with the text, then stored under posts/<post id>/ and attached.
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

import { isJpeg, MAX_PHOTO_BYTES, stripJpegMetadata, toBase64 } from '../_shared/jpeg.ts';
import { screen, type ScreeningInput } from '../_shared/screening.ts';

const PHOTO_BUCKET = 'post-photos';

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
      /** Paths of JPEGs the app uploaded to pending/<user id>/. */
      photos?: string[];
    }
  | { action: 'comment'; post_id: string; body: string; reply_to?: string | null }
  | { action: 'profile'; display_name: string; bio: string };

/** Downloads the app's pending uploads and strips their metadata. */
async function loadPendingPhotos(userId: string, paths: string[]): Promise<Uint8Array[]> {
  if (paths.length > 4) throw new Error('Up to 4 photos per post');
  const allowed = new RegExp(`^pending/${userId}/[A-Za-z0-9_-]+\\.jpg$`);
  return Promise.all(
    paths.map(async (path) => {
      if (!allowed.test(path)) throw new Error('Invalid photo');
      const { data, error } = await admin.storage.from(PHOTO_BUCKET).download(path);
      if (error || !data) throw new Error('A photo could not be read');
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length > MAX_PHOTO_BYTES || !isJpeg(bytes)) throw new Error('Photos must be JPEGs under 8 MB');
      return stripJpegMetadata(bytes);
    }),
  );
}

async function removePending(paths: string[]) {
  if (paths.length) await admin.storage.from(PHOTO_BUCKET).remove(paths);
}

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
  const pendingPhotos = request.action === 'post' ? (request.photos ?? []) : [];
  let photos: Uint8Array[] = [];
  switch (request.action) {
    case 'post':
      if (pendingPhotos.length) {
        if (request.anonymous || !request.to_corner || request.follow_up_of) {
          return reply({ error: 'Photos are for Corner posts only' }, 400);
        }
        try {
          photos = await loadPendingPhotos(userId, pendingPhotos);
        } catch (err) {
          return reply({ error: err instanceof Error ? err.message : 'A photo could not be read' }, 400);
        }
      }
      input = { kind: 'post', postKind: request.kind, text: request.body, images: photos.map(toBase64) };
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
    await removePending(pendingPhotos);
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

    if (photos.length) {
      const postId = data as string;
      const stored = photos.map((_, i) => `posts/${postId}/${i}.jpg`);
      try {
        for (const [i, bytes] of photos.entries()) {
          const { error: uploadError } = await admin.storage
            .from(PHOTO_BUCKET)
            .upload(stored[i], bytes, { contentType: 'image/jpeg' });
          if (uploadError) throw uploadError;
        }
        const { error: attachError } = await admin.rpc('attach_photos', {
          actor: userId,
          post_id: postId,
          paths: stored,
        });
        if (attachError) throw attachError;
      } catch (err) {
        console.error('storing photos failed', err);
        return reply({ error: 'Your post was shared, but its photos could not be saved.' }, 500);
      } finally {
        await removePending(pendingPhotos);
      }
    }
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
