// Publishing goes through the `screen` edge function, which checks the text
// for serious ill intent (and signs of crisis) before writing it. The database
// won't accept these writes any other way.

import { FunctionsHttpError } from '@supabase/supabase-js';

import type { Audience, PostKind } from '@/lib/posts';
import { supabase } from '@/lib/supabase';

export type PublishResult =
  | { status: 'ok'; id?: string; support?: boolean }
  /** Post held: show the helpline, then call again with crisisAcknowledged. */
  | { status: 'crisis' }
  | { status: 'blocked'; paused: boolean }
  | { status: 'unavailable' };

export const BLOCKED_MESSAGE =
  "This can't be posted on As One. Support here means no hate, threats or attacks — try saying it with care.";
export const PAUSED_MESSAGE =
  'Your ability to comment is paused while we review recent activity. You can still post and react.';
export const UNAVAILABLE_MESSAGE = "We couldn't check this right now, so it wasn't posted. Please try again in a moment.";

async function invoke(body: Record<string, unknown>): Promise<PublishResult> {
  const { data, error } = await supabase.functions.invoke('screen', { body });
  if (error) {
    // Database errors come back as { error } with a 4xx status.
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null);
      throw new Error(detail?.error ?? error.message);
    }
    throw new Error(error.message);
  }
  return data as PublishResult;
}

export function publishPost(
  kind: PostKind,
  body: string,
  audience: Audience,
  options: {
    commentsPrivate?: boolean;
    followUpOf?: string;
    crisisAcknowledged?: boolean;
    notifyBuddies?: boolean;
    photos?: string[];
  } = {},
) {
  return invoke({
    action: 'post',
    kind,
    body,
    anonymous: audience === 'anonymous',
    to_corner: audience === 'corner' || audience === 'both',
    to_everyone: audience !== 'corner',
    comments_private: options.commentsPrivate ?? false,
    follow_up_of: options.followUpOf ?? null,
    crisis_acknowledged: options.crisisAcknowledged ?? false,
    notify_buddies: options.notifyBuddies ?? false,
    photos: options.photos ?? [],
  });
}

export function publishComment(postId: string, body: string, replyTo?: string) {
  return invoke({ action: 'comment', post_id: postId, body, reply_to: replyTo ?? null });
}

export function publishProfile(displayName: string, bio: string) {
  return invoke({ action: 'profile', display_name: displayName, bio });
}

/** Turns a non-ok result into the message to show, or null if it published. */
export function problemWith(result: PublishResult): string | null {
  switch (result.status) {
    case 'blocked':
      return result.paused ? PAUSED_MESSAGE : BLOCKED_MESSAGE;
    case 'unavailable':
      return UNAVAILABLE_MESSAGE;
    default:
      return null;
  }
}
