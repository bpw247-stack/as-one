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
  /** Reactions I've sent on this post. */
  my_reactions: string[];
  /** Only set on my own posts. Counts are never public. */
  reaction_count: number | null;
  comment_count: number;
  can_comment: boolean;
  comments_private: boolean;
  follow_up_of: string | null;
  follow_up_excerpt: string | null;
};

export type Comment = {
  id: string;
  body: string;
  reply_to: string | null;
  is_private: boolean;
  created_at: string;
  author_username: string;
  author_display_name: string;
  is_mine: boolean;
  is_poster: boolean;
};

export type ReactionEntry = {
  reaction: string;
  /** Null when the reactor chose not to share their name. */
  username: string | null;
  display_name: string | null;
  created_at: string;
};

export type ActivityItem = {
  kind: 'reaction' | 'comment' | 'reply' | 'follow_up';
  post_id: string;
  post_excerpt: string;
  reaction: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  body: string | null;
  created_at: string;
};

export const POST_KINDS: { kind: PostKind; label: string; prompt: string }[] = [
  { kind: 'struggle', label: 'Struggle', prompt: "What's weighing on you?" },
  { kind: 'goal', label: 'Goal', prompt: 'What do you want to achieve, and by when?' },
  { kind: 'milestone', label: 'Milestone', prompt: 'What did you accomplish?' },
  { kind: 'life_event', label: 'Life event', prompt: "What's happening in your life?" },
];

/** The preset reactions for each kind of post (must match the database). */
export const REACTIONS: Record<PostKind, { key: string; label: string }[]> = {
  struggle: [
    { key: 'support', label: 'I support you' },
    { key: 'not_alone', label: "You're not alone" },
    { key: 'strength', label: 'Sending strength' },
  ],
  goal: [
    { key: 'believe', label: 'I believe in you' },
    { key: 'got_this', label: "You've got this" },
  ],
  milestone: [
    { key: 'proud', label: 'So proud of you' },
    { key: 'congrats', label: 'Congratulations' },
  ],
  life_event: [
    { key: 'happy_for_you', label: 'Happy for you' },
    { key: 'thinking_of_you', label: 'Thinking of you' },
  ],
};

export const REACTION_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(REACTIONS).flatMap((list) => list.map((r) => [r.key, r.label])),
);

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
export const MAX_COMMENT_LENGTH = 1000;
export const PAGE_SIZE = 20;

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function createPost(
  kind: PostKind,
  body: string,
  audience: Audience,
  options: { commentsPrivate?: boolean; followUpOf?: string } = {},
): Promise<string> {
  return check(
    await supabase.rpc('create_post', {
      kind,
      body,
      anonymous: audience === 'anonymous',
      to_corner: audience === 'corner' || audience === 'both',
      to_everyone: audience !== 'corner',
      comments_private: options.commentsPrivate ?? false,
      follow_up_of: options.followUpOf ?? null,
    }),
  );
}

export async function getPost(postId: string): Promise<FeedPost | null> {
  const rows: FeedPost[] = check(await supabase.rpc('get_post', { post_id: postId })) ?? [];
  return rows[0] ?? null;
}

export async function setCommentsPrivate(postId: string, isPrivate: boolean) {
  check(await supabase.rpc('set_comments_private', { post_id: postId, private: isPrivate }));
}

export async function react(postId: string, reaction: string, showName: boolean) {
  check(await supabase.rpc('react', { post_id: postId, reaction, show_name: showName }));
}

export async function unreact(postId: string, reaction: string) {
  check(await supabase.rpc('unreact', { post_id: postId, reaction }));
}

/** Only returns anything for the poster. */
export async function postReactions(postId: string): Promise<ReactionEntry[]> {
  return check(await supabase.rpc('post_reactions', { post_id: postId })) ?? [];
}

export async function postComments(postId: string): Promise<Comment[]> {
  return check(await supabase.rpc('post_comments', { post_id: postId })) ?? [];
}

export async function addComment(postId: string, body: string, replyTo?: string) {
  check(await supabase.rpc('add_comment', { post_id: postId, body, reply_to: replyTo ?? null }));
}

export async function deleteComment(commentId: string) {
  check(await supabase.rpc('delete_comment', { comment_id: commentId }));
}

export async function myActivity(): Promise<ActivityItem[]> {
  return check(await supabase.rpc('my_activity', { page_size: 50 })) ?? [];
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
