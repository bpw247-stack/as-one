// Posting and feeds. Posts are only reachable through database functions, which
// strip the author from anonymous posts before anything reaches the app.

import { supabase } from '@/lib/supabase';

export type PostKind = 'struggle' | 'goal' | 'milestone' | 'life_event';

export type Audience = 'corner' | 'everyone' | 'both' | 'anonymous';

export type FeedPost = {
  id: string;
  kind: PostKind;
  body: string;
  is_anonymous: boolean;
  to_corner: boolean;
  to_everyone: boolean;
  published_at: string;
  /** Null for anonymous posts. */
  author_username: string | null;
  author_display_name: string | null;
  is_mine: boolean;
};

export const POST_KINDS: { kind: PostKind; label: string; prompt: string }[] = [
  { kind: 'struggle', label: 'Struggle', prompt: "What's weighing on you?" },
  { kind: 'goal', label: 'Goal', prompt: 'What do you want to achieve, and by when?' },
  { kind: 'milestone', label: 'Milestone', prompt: 'What did you accomplish?' },
  { kind: 'life_event', label: 'Life event', prompt: "What's happening in your life?" },
];

export const KIND_LABELS = Object.fromEntries(POST_KINDS.map((k) => [k.kind, k.label])) as Record<
  PostKind,
  string
>;

export const AUDIENCES: { audience: Audience; label: string; description: string }[] = [
  { audience: 'corner', label: 'My Corner', description: 'Only people in your Corner will see this.' },
  { audience: 'everyone', label: 'Everyone', description: 'Anyone on As One can see this and send a reaction.' },
  { audience: 'both', label: 'Both', description: 'Shows in your Corner and in the Everyone feed.' },
  {
    audience: 'anonymous',
    label: 'Anonymous',
    description:
      "Goes to the Everyone feed with no name attached. No one, not even your Corner, will know it's you. It appears after a few minutes.",
  },
];

export const MAX_POST_LENGTH = 2000;
export const PAGE_SIZE = 20;

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function createPost(kind: PostKind, body: string, audience: Audience): Promise<string> {
  return check(
    await supabase.rpc('create_post', {
      kind,
      body,
      anonymous: audience === 'anonymous',
      to_corner: audience === 'corner' || audience === 'both',
      to_everyone: audience !== 'corner',
    }),
  );
}

export async function deletePost(postId: string) {
  check(await supabase.rpc('delete_post', { post_id: postId }));
}

export async function cornerFeed(before?: string): Promise<FeedPost[]> {
  return check(await supabase.rpc('corner_feed', { before: before ?? null, page_size: PAGE_SIZE })) ?? [];
}

export async function everyoneFeed(pageIndex: number): Promise<FeedPost[]> {
  return (
    check(
      await supabase.rpc('everyone_feed', { page_offset: pageIndex * PAGE_SIZE, page_size: PAGE_SIZE }),
    ) ?? []
  );
}

export async function profilePosts(username: string, before?: string): Promise<FeedPost[]> {
  return (
    check(
      await supabase.rpc('profile_posts', { username, before: before ?? null, page_size: PAGE_SIZE }),
    ) ?? []
  );
}

export async function myPosts(before?: string): Promise<FeedPost[]> {
  return check(await supabase.rpc('my_posts', { before: before ?? null, page_size: PAGE_SIZE })) ?? [];
}
