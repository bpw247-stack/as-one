// An in-memory stand-in for the As One backend, used only by the demo build
// (EXPO_PUBLIC_DEMO=1). It follows the same rules as the database functions in
// supabase/migrations — who sees what, anonymity, blocks, the Corner guarantee —
// closely enough to try the app in a browser with nothing set up. The real
// rules live in Postgres; when they change, this is a convenience to update,
// not a source of truth.

import { seed } from '@/lib/demo/seed';

type Id = string;

export type Profile = { id: Id; username: string; display_name: string; bio: string; birth_date: string };
export type Post = {
  id: Id;
  author_id: Id;
  kind: string;
  body: string;
  is_anonymous: boolean;
  to_corner: boolean;
  to_everyone: boolean;
  published_at: number;
  comments_private: boolean;
  follow_up_of: Id | null;
  is_crisis: boolean;
  hidden_for_review: boolean;
  notify_buddies: boolean;
  photos: string[];
  song: { id: string; title: string; artist: string; artwork_url: string | null; url: string } | null;
};
export type Reaction = { post_id: Id; reactor_id: Id; reaction: string; show_name: boolean; created_at: number };
export type Comment = {
  id: Id;
  post_id: Id;
  author_id: Id;
  body: string;
  reply_to: Id | null;
  is_private: boolean;
  hidden_for_review: boolean;
  created_at: number;
};
export type Report = {
  id: Id;
  reporter_id: Id;
  target_type: 'post' | 'comment' | 'profile';
  target_id: Id;
  target_user_id: Id;
  reason: string;
  details: string;
  status: 'open' | 'actioned' | 'dismissed';
  decision: string | null;
  decided_by: Id | null;
  decided_at: number | null;
  created_at: number;
};

export class DemoError extends Error {}
const fail = (message: string): never => {
  throw new DemoError(message);
};

let counter = 0;
export const newId = () => `demo-${Date.now().toString(36)}-${(counter++).toString(36)}`;
const iso = (t: number) => new Date(t).toISOString();
const pairKey = (a: Id, b: Id) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const ALLOWED_REACTIONS: Record<string, string[]> = {
  struggle: ['support', 'not_alone', 'strength'],
  goal: ['believe', 'got_this'],
  milestone: ['proud', 'congrats'],
  life_event: ['happy_for_you', 'thinking_of_you'],
  song: ['song_hits', 'thanks_for_sharing', 'adding_it'],
  crisis: ['not_alone', 'life_matters', 'here_for_you', 'strength'],
};

export class DemoBackend {
  profiles = new Map<Id, Profile>();
  emails = new Map<string, Id>();
  corners = new Set<string>();
  cornerRequests: { from: Id; to: Id; created_at: number }[] = [];
  blocks: { blocker: Id; blocked: Id; created_at: number }[] = [];
  buddies = new Set<string>();
  buddyRequests: { from: Id; to: Id; created_at: number }[] = [];
  posts: Post[] = [];
  reactions: Reaction[] = [];
  comments: Comment[] = [];
  anonViews = new Set<string>();
  moderators = new Set<Id>();
  reports: Report[] = [];
  appeals: { id: Id; report_id: Id; user_id: Id; message: string; status: string; decided_by: Id | null; created_at: number }[] = [];
  restrictions = new Map<Id, { comment_paused: boolean; suspended_until: number | null; banned: boolean; warnings: number }>();
  blockedAttempts: { user_id: Id; category: string; excerpt: string; created_at: number }[] = [];
  crisisSupportUntil = new Map<Id, number>();
  storage = new Map<string, string>();

  constructor() {
    seed(this);
  }

  // ---- helpers -------------------------------------------------------------

  isBlocked(a: Id, b: Id) {
    return this.blocks.some((x) => (x.blocker === a && x.blocked === b) || (x.blocker === b && x.blocked === a));
  }
  inCorner(a: Id, b: Id) {
    return this.corners.has(pairKey(a, b));
  }
  areBuddies(a: Id, b: Id) {
    return this.buddies.has(pairKey(a, b));
  }
  buddyIds(me: Id) {
    return [...this.buddies].map((k) => k.split('|')).filter((p) => p.includes(me)).map((p) => (p[0] === me ? p[1] : p[0]));
  }
  cornerIds(me: Id) {
    return [...this.corners].map((k) => k.split('|')).filter((p) => p.includes(me)).map((p) => (p[0] === me ? p[1] : p[0]));
  }
  profile(id: Id) {
    return this.profiles.get(id) ?? fail('Not found');
  }
  publicProfile(p: Profile) {
    return { id: p.id, username: p.username, display_name: p.display_name, bio: p.bio };
  }
  byUsername(username: string) {
    const u = username.trim().toLowerCase();
    return [...this.profiles.values()].find((p) => p.username.toLowerCase() === u);
  }
  assertActive(me: Id) {
    const r = this.restrictions.get(me);
    if (r && (r.banned || (r.suspended_until ?? 0) > Date.now())) fail('Your account is suspended');
  }
  restriction(me: Id) {
    let r = this.restrictions.get(me);
    if (!r) {
      r = { comment_paused: false, suspended_until: null, banned: false, warnings: 0 };
      this.restrictions.set(me, r);
    }
    return r;
  }

  canView(p: Post, viewer: Id) {
    return (
      p.author_id === viewer ||
      (p.published_at <= Date.now() &&
        !p.hidden_for_review &&
        !this.isBlocked(viewer, p.author_id) &&
        (p.to_everyone || (p.to_corner && this.inCorner(viewer, p.author_id))))
    );
  }
  canComment(p: Post, viewer: Id) {
    return !p.is_anonymous && !p.is_crisis && p.author_id !== viewer && p.published_at <= Date.now() && this.inCorner(viewer, p.author_id);
  }
  canSeePhotos(p: Post, viewer: Id) {
    return p.author_id === viewer || (p.to_corner && !p.is_anonymous && !p.hidden_for_review && this.inCorner(viewer, p.author_id));
  }
  canReadComment(c: Comment, p: Post, viewer: Id) {
    if (this.isBlocked(viewer, c.author_id)) return false;
    if (c.hidden_for_review && viewer !== c.author_id) return false;
    if (viewer === p.author_id || viewer === c.author_id) return true;
    const parent = c.reply_to ? this.comments.find((x) => x.id === c.reply_to) : null;
    if (parent && parent.author_id === viewer) return true;
    return !c.is_private && this.canView(p, viewer) && (!parent || !parent.is_private);
  }

  feedPost(p: Post, viewer: Id, textOnly = false) {
    const author = this.profiles.get(p.author_id);
    const mine = p.author_id === viewer;
    const published = p.is_anonymous && !mine ? new Date(p.published_at).setMinutes(0, 0, 0) : p.published_at;
    const original = p.follow_up_of ? this.posts.find((o) => o.id === p.follow_up_of) : null;
    return {
      id: p.id,
      kind: p.kind,
      body: p.body,
      is_anonymous: p.is_anonymous,
      to_corner: p.to_corner,
      to_everyone: p.to_everyone,
      published_at: iso(published),
      author_username: p.is_anonymous ? null : (author?.username ?? null),
      author_display_name: p.is_anonymous ? null : (author?.display_name ?? null),
      is_mine: mine,
      my_reactions: this.reactions.filter((r) => r.post_id === p.id && r.reactor_id === viewer).map((r) => r.reaction).sort(),
      reaction_count: mine ? this.reactions.filter((r) => r.post_id === p.id).length : null,
      comment_count: this.comments.filter((c) => c.post_id === p.id && this.canReadComment(c, p, viewer)).length,
      can_comment: this.canComment(p, viewer),
      comments_private: p.comments_private,
      follow_up_of: p.follow_up_of,
      follow_up_excerpt: original ? original.body.slice(0, 120) : null,
      is_crisis: p.is_crisis,
      photo_paths: !textOnly && this.canSeePhotos(p, viewer) ? p.photos : [],
      song_title: p.song?.title ?? null,
      song_artist: p.song?.artist ?? null,
      song_artwork_url: p.song?.artwork_url ?? null,
      song_url: p.song?.url ?? null,
    };
  }

  // ---- accounts --------------------------------------------------------------

  signUp(email: string, meta: { username?: string; display_name?: string; birth_date?: string }) {
    const username = (meta.username ?? '').trim();
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) fail('Database error saving new user');
    if (this.byUsername(username)) fail('Database error saving new user');
    const dob = meta.birth_date ? new Date(meta.birth_date) : null;
    if (!dob || Number.isNaN(dob.getTime())) fail('A valid date of birth is required');
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (dob! > cutoff) fail('As One is for people 18 and older');
    const id = newId();
    this.profiles.set(id, { id, username, display_name: meta.display_name || username, bio: '', birth_date: meta.birth_date! });
    this.emails.set(email.toLowerCase(), id);
    return id;
  }

  deleteAccount(me: Id) {
    const myPosts = new Set(this.posts.filter((p) => p.author_id === me).map((p) => p.id));
    this.posts = this.posts.filter((p) => p.author_id !== me);
    this.comments = this.comments.filter((c) => c.author_id !== me && !myPosts.has(c.post_id));
    this.reactions = this.reactions.filter((r) => r.reactor_id !== me && !myPosts.has(r.post_id));
    for (const k of [...this.corners]) if (k.split('|').includes(me)) this.corners.delete(k);
    for (const k of [...this.buddies]) if (k.split('|').includes(me)) this.buddies.delete(k);
    this.cornerRequests = this.cornerRequests.filter((r) => r.from !== me && r.to !== me);
    this.buddyRequests = this.buddyRequests.filter((r) => r.from !== me && r.to !== me);
    this.blocks = this.blocks.filter((b) => b.blocker !== me && b.blocked !== me);
    this.profiles.delete(me);
    for (const [email, id] of this.emails) if (id === me) this.emails.delete(email);
  }

  // ---- table reads (what the app reads directly, with RLS applied) -----------

  table(name: string, me: Id): Record<string, unknown>[] {
    switch (name) {
      case 'profiles':
        return [...this.profiles.values()].filter((p) => !this.isBlocked(me, p.id)).map((p) => this.publicProfile(p));
      case 'corners':
        return [...this.corners]
          .map((k) => k.split('|'))
          .filter((p) => p.includes(me))
          .map(([user_a, user_b]) => ({ user_a, user_b }));
      case 'corner_requests':
        return this.cornerRequests
          .filter((r) => r.from === me || r.to === me)
          .map((r) => ({ from_user: r.from, to_user: r.to, created_at: iso(r.created_at) }));
      case 'blocks':
        return this.blocks.filter((b) => b.blocker === me).map((b) => ({ blocked: b.blocked }));
      default:
        return fail(`Unknown table ${name}`);
    }
  }

  // ---- publishing (what the screen function does after screening) -----------

  createPost(
    me: Id,
    a: {
      kind: string;
      body: string;
      anonymous: boolean;
      to_corner: boolean;
      to_everyone: boolean;
      comments_private?: boolean;
      follow_up_of?: string | null;
      crisis?: boolean;
      notify_buddies?: boolean;
      photos?: string[];
      song?: Post['song'];
    },
  ) {
    this.assertActive(me);
    let { anonymous, to_corner, to_everyone } = a;
    if (a.follow_up_of) {
      const o = this.posts.find((p) => p.id === a.follow_up_of);
      if (!o || o.author_id !== me) fail('You can only follow up on your own posts');
      if (o!.kind !== 'goal') fail('Follow-ups are for goals');
      ({ is_anonymous: anonymous, to_corner, to_everyone } = o!);
    }
    if ((a.kind === 'song') !== Boolean(a.song)) fail('Song posts need a song');
    if (anonymous && (to_corner || !to_everyone)) fail('Anonymous posts can only be shared with everyone');
    if (!to_corner && !to_everyone) fail('Choose who can see this post');
    const body = a.body.trim();
    if (!body || body.length > 2000) fail('Posts need between 1 and 2000 characters');
    const photos = a.photos ?? [];
    if (photos.length && (anonymous || !to_corner)) fail('Photos are for Corner posts only');
    const post: Post = {
      id: newId(),
      author_id: me,
      kind: a.kind,
      body,
      is_anonymous: anonymous,
      to_corner,
      to_everyone,
      // The real delay is 1–10 minutes; the demo uses 10–30 seconds.
      published_at: Date.now() + (anonymous ? 10_000 + Math.random() * 20_000 : 0),
      comments_private: Boolean(a.comments_private),
      follow_up_of: a.follow_up_of ?? null,
      is_crisis: Boolean(a.crisis),
      hidden_for_review: false,
      notify_buddies: Boolean(a.notify_buddies) && !anonymous,
      photos,
      song: a.song ?? null,
    };
    this.posts.push(post);
    if (a.crisis) this.crisisSupportUntil.set(me, Date.now() + 48 * 3600e3);
    return post.id;
  }

  addComment(me: Id, postId: Id, body: string, replyTo: Id | null) {
    this.assertActive(me);
    if (this.restrictions.get(me)?.comment_paused) fail('Your ability to comment is paused while we review recent activity');
    const p = this.posts.find((x) => x.id === postId);
    if (!p || !this.canView(p, me)) fail('Post not found');
    let parent: Comment | undefined;
    if (replyTo) {
      parent = this.comments.find((c) => c.id === replyTo);
      if (p!.author_id !== me) fail('Only the poster can reply to comments');
      if (!parent || parent.post_id !== postId || parent.reply_to) fail('Comment not found');
    } else if (!this.canComment(p!, me)) {
      fail('Only people in their Corner can comment here');
    }
    const text = body.trim();
    if (!text || text.length > 1000) fail('Comments need between 1 and 1000 characters');
    const c: Comment = {
      id: newId(),
      post_id: postId,
      author_id: me,
      body: text,
      reply_to: replyTo,
      is_private: parent ? parent.is_private : p!.comments_private,
      hidden_for_review: false,
      created_at: Date.now(),
    };
    this.comments.push(c);
    return c.id;
  }

  recordBlockedAttempt(me: Id, category: string, excerpt: string) {
    this.blockedAttempts.push({ user_id: me, category, excerpt: excerpt.slice(0, 500), created_at: Date.now() });
    const recent = this.blockedAttempts.filter((b) => b.user_id === me && b.created_at > Date.now() - 86400e3).length;
    if (recent >= 3) {
      this.restriction(me).comment_paused = true;
      return true;
    }
    return false;
  }

  // ---- RPCs --------------------------------------------------------------------

  rpc(name: string, me: Id, a: Record<string, any>): unknown {
    const fn = (this.rpcs as unknown as Record<string, (me: Id, a: Record<string, any>) => unknown>)[name];
    if (!fn) fail(`Not available in the demo: ${name}`);
    return fn.call(this, me, a);
  }

  rpcs = {
    send_corner_request(this: DemoBackend, me: Id, a: { target_username: string }) {
      const target = this.byUsername(a.target_username);
      if (!target || this.isBlocked(me, target.id)) fail('No one with that username');
      if (target!.id === me) fail("You can't add yourself");
      if (this.inCorner(me, target!.id)) return 'already_connected';
      const theirs = this.cornerRequests.findIndex((r) => r.from === target!.id && r.to === me);
      if (theirs >= 0) {
        this.cornerRequests.splice(theirs, 1);
        this.corners.add(pairKey(me, target!.id));
        return 'connected';
      }
      if (!this.cornerRequests.some((r) => r.from === me && r.to === target!.id)) {
        this.cornerRequests.push({ from: me, to: target!.id, created_at: Date.now() });
      }
      return 'sent';
    },
    respond_corner_request(this: DemoBackend, me: Id, a: { requester: Id; accept: boolean }) {
      const i = this.cornerRequests.findIndex((r) => r.from === a.requester && r.to === me);
      if (i < 0) fail('That request no longer exists');
      this.cornerRequests.splice(i, 1);
      if (a.accept && !this.isBlocked(me, a.requester)) this.corners.add(pairKey(me, a.requester));
    },
    cancel_corner_request(this: DemoBackend, me: Id, a: { target: Id }) {
      this.cornerRequests = this.cornerRequests.filter((r) => !(r.from === me && r.to === a.target));
    },
    remove_from_corner(this: DemoBackend, me: Id, a: { other: Id }) {
      this.corners.delete(pairKey(me, a.other));
      this.buddies.delete(pairKey(me, a.other));
      this.buddyRequests = this.buddyRequests.filter((r) => pairKey(r.from, r.to) !== pairKey(me, a.other));
    },
    block_user(this: DemoBackend, me: Id, a: { other: Id }) {
      if (a.other === me) fail("You can't block yourself");
      if (!this.blocks.some((b) => b.blocker === me && b.blocked === a.other)) {
        this.blocks.push({ blocker: me, blocked: a.other, created_at: Date.now() });
      }
      this.rpcs.remove_from_corner.call(this, me, a);
      this.cornerRequests = this.cornerRequests.filter((r) => pairKey(r.from, r.to) !== pairKey(me, a.other));
    },
    unblock_user(this: DemoBackend, me: Id, a: { other: Id }) {
      this.blocks = this.blocks.filter((b) => !(b.blocker === me && b.blocked === a.other));
    },
    my_blocked(this: DemoBackend, me: Id) {
      return this.blocks
        .filter((b) => b.blocker === me)
        .map((b) => this.profiles.get(b.blocked))
        .filter(Boolean)
        .map((p) => ({ id: p!.id, username: p!.username, display_name: p!.display_name }));
    },
    delete_account(this: DemoBackend, me: Id) {
      this.deleteAccount(me);
    },
    delete_post(this: DemoBackend, me: Id, a: { post_id: Id }) {
      const before = this.posts.length;
      this.posts = this.posts.filter((p) => !(p.id === a.post_id && p.author_id === me));
      if (this.posts.length === before) fail('Post not found');
      this.comments = this.comments.filter((c) => c.post_id !== a.post_id);
      this.reactions = this.reactions.filter((r) => r.post_id !== a.post_id);
    },
    corner_feed(this: DemoBackend, me: Id, a: { before: string | null; page_size: number }) {
      const before = a.before ? Date.parse(a.before) : Infinity;
      return this.posts
        .filter(
          (p) =>
            p.to_corner &&
            !p.is_anonymous &&
            p.published_at <= Date.now() &&
            p.published_at < before &&
            (!p.hidden_for_review || p.author_id === me) &&
            (p.author_id === me || this.inCorner(me, p.author_id)),
        )
        .sort((x, y) => y.published_at - x.published_at)
        .slice(0, Math.min(a.page_size ?? 20, 50))
        .map((p) => this.feedPost(p, me));
    },
    everyone_feed(this: DemoBackend, me: Id, a: { page_offset: number; page_size: number }) {
      const size = Math.min(a.page_size ?? 20, 50);
      const visible = (p: Post) =>
        p.to_everyone && p.published_at <= Date.now() && (!p.hidden_for_review || p.author_id === me) && !this.isBlocked(me, p.author_id);
      const base = this.posts
        .filter(visible)
        .sort((x, y) => y.published_at - x.published_at)
        .slice(a.page_offset ?? 0, (a.page_offset ?? 0) + size);
      const result = [...base];
      if (!a.page_offset) {
        // The Corner guarantee, with at least as many decoys (see the migration).
        const unseen = (p: Post) =>
          p.is_anonymous && visible(p) && p.author_id !== me && p.published_at > Date.now() - 14 * 86400e3 &&
          !base.includes(p) && !this.anonViews.has(`${me}|${p.id}`);
        const fromCorner = this.posts.filter((p) => unseen(p) && this.inCorner(me, p.author_id)).slice(0, 5);
        if (fromCorner.length) {
          const decoys = this.posts
            .filter((p) => unseen(p) && !this.inCorner(me, p.author_id))
            .sort(() => Math.random() - 0.5)
            .slice(0, Math.max(fromCorner.length, 2));
          for (const p of [...fromCorner, ...decoys].sort(() => Math.random() - 0.5)) {
            result.splice(Math.floor(Math.random() * (result.length + 1)), 0, p);
          }
        }
      }
      for (const p of result) if (p.is_anonymous && p.author_id !== me) this.anonViews.add(`${me}|${p.id}`);
      return result.map((p) => this.feedPost(p, me, true));
    },
    profile_posts(this: DemoBackend, me: Id, a: { username: string; before: string | null; page_size: number }) {
      const owner = this.byUsername(a.username);
      if (!owner || this.isBlocked(me, owner.id)) return [];
      const before = a.before ? Date.parse(a.before) : Infinity;
      return this.posts
        .filter(
          (p) =>
            p.author_id === owner.id && !p.is_anonymous && (p.to_everyone || p.author_id === me) &&
            p.published_at <= Date.now() && p.published_at < before && (!p.hidden_for_review || p.author_id === me),
        )
        .sort((x, y) => y.published_at - x.published_at)
        .slice(0, Math.min(a.page_size ?? 20, 50))
        .map((p) => this.feedPost(p, me));
    },
    my_posts(this: DemoBackend, me: Id, a: { before: string | null; page_size: number }) {
      const before = a.before ? Date.parse(a.before) : Infinity;
      return this.posts
        .filter((p) => p.author_id === me && p.published_at < before)
        .sort((x, y) => y.published_at - x.published_at)
        .slice(0, Math.min(a.page_size ?? 20, 50))
        .map((p) => this.feedPost(p, me));
    },
    get_post(this: DemoBackend, me: Id, a: { post_id: Id }) {
      const p = this.posts.find((x) => x.id === a.post_id);
      return p && this.canView(p, me) ? [this.feedPost(p, me)] : [];
    },
    set_comments_private(this: DemoBackend, me: Id, a: { post_id: Id; private: boolean }) {
      const p = this.posts.find((x) => x.id === a.post_id && x.author_id === me) ?? fail('Post not found');
      p.comments_private = a.private;
    },
    react(this: DemoBackend, me: Id, a: { post_id: Id; reaction: string; show_name: boolean }) {
      this.assertActive(me);
      const p = this.posts.find((x) => x.id === a.post_id);
      if (!p || !this.canView(p, me)) fail('Post not found');
      if (p!.author_id === me) fail("You can't react to your own post");
      if (!ALLOWED_REACTIONS[p!.is_crisis ? 'crisis' : p!.kind]?.includes(a.reaction)) {
        fail("That reaction isn't available for this post");
      }
      const existing = this.reactions.find((r) => r.post_id === a.post_id && r.reactor_id === me && r.reaction === a.reaction);
      if (existing) existing.show_name = a.show_name;
      else this.reactions.push({ post_id: a.post_id, reactor_id: me, reaction: a.reaction, show_name: a.show_name, created_at: Date.now() });
    },
    unreact(this: DemoBackend, me: Id, a: { post_id: Id; reaction: string }) {
      this.reactions = this.reactions.filter((r) => !(r.post_id === a.post_id && r.reactor_id === me && r.reaction === a.reaction));
    },
    post_reactions(this: DemoBackend, me: Id, a: { post_id: Id }) {
      const p = this.posts.find((x) => x.id === a.post_id);
      if (!p || p.author_id !== me) return [];
      return this.reactions
        .filter((r) => r.post_id === p.id)
        .sort((x, y) => y.created_at - x.created_at)
        .map((r) => {
          const who = this.profiles.get(r.reactor_id);
          return {
            reaction: r.reaction,
            username: r.show_name ? (who?.username ?? null) : null,
            display_name: r.show_name ? (who?.display_name ?? null) : null,
            created_at: iso(r.created_at),
          };
        });
    },
    post_comments(this: DemoBackend, me: Id, a: { post_id: Id }) {
      const p = this.posts.find((x) => x.id === a.post_id);
      if (!p || !this.canView(p, me)) return [];
      return this.comments
        .filter((c) => c.post_id === p.id && this.canReadComment(c, p, me))
        .sort((x, y) => x.created_at - y.created_at)
        .map((c) => {
          const who = this.profile(c.author_id);
          return {
            id: c.id,
            body: c.body,
            reply_to: c.reply_to,
            is_private: c.is_private,
            created_at: iso(c.created_at),
            author_username: who.username,
            author_display_name: who.display_name,
            is_mine: c.author_id === me,
            is_poster: c.author_id === p.author_id,
          };
        });
    },
    delete_comment(this: DemoBackend, me: Id, a: { comment_id: Id }) {
      const c = this.comments.find((x) => x.id === a.comment_id);
      const p = c && this.posts.find((x) => x.id === c.post_id);
      if (!c || !p || (c.author_id !== me && p.author_id !== me)) fail('Comment not found');
      this.comments = this.comments.filter((x) => x.id !== a.comment_id && x.reply_to !== a.comment_id);
    },
    my_activity(this: DemoBackend, me: Id) {
      const items: Record<string, unknown>[] = [];
      const excerpt = (p: Post) => p.body.slice(0, 80);
      for (const r of this.reactions) {
        const p = this.posts.find((x) => x.id === r.post_id);
        if (!p || p.author_id !== me || this.isBlocked(me, r.reactor_id)) continue;
        const who = this.profiles.get(r.reactor_id);
        items.push({
          kind: 'reaction', post_id: p.id, post_excerpt: excerpt(p), reaction: r.reaction,
          actor_username: r.show_name ? who?.username : null, actor_display_name: r.show_name ? who?.display_name : null,
          body: null, created_at: r.created_at,
        });
      }
      for (const c of this.comments) {
        const p = this.posts.find((x) => x.id === c.post_id);
        if (!p || this.isBlocked(me, c.author_id)) continue;
        const who = this.profile(c.author_id);
        const parent = c.reply_to ? this.comments.find((x) => x.id === c.reply_to) : null;
        if (p.author_id === me && c.author_id !== me) {
          items.push({ kind: 'comment', post_id: p.id, post_excerpt: excerpt(p), reaction: null, actor_username: who.username, actor_display_name: who.display_name, body: c.body.slice(0, 160), created_at: c.created_at });
        } else if (parent?.author_id === me) {
          items.push({ kind: 'reply', post_id: p.id, post_excerpt: excerpt(p), reaction: null, actor_username: p.is_anonymous ? null : who.username, actor_display_name: p.is_anonymous ? null : who.display_name, body: c.body.slice(0, 160), created_at: c.created_at });
        }
      }
      for (const f of this.posts) {
        if (!f.follow_up_of || f.author_id === me || !this.canView(f, me)) continue;
        const o = this.posts.find((x) => x.id === f.follow_up_of);
        const supported = o && (this.reactions.some((r) => r.post_id === o.id && r.reactor_id === me) || this.comments.some((c) => c.post_id === o.id && c.author_id === me));
        if (!o || !supported) continue;
        const who = this.profile(f.author_id);
        items.push({ kind: 'follow_up', post_id: f.id, post_excerpt: excerpt(f), reaction: null, actor_username: f.is_anonymous ? null : who.username, actor_display_name: f.is_anonymous ? null : who.display_name, body: excerpt(o), created_at: f.published_at });
      }
      return items
        .sort((x, y) => (y.created_at as number) - (x.created_at as number))
        .slice(0, 50)
        .map((i) => ({ ...i, created_at: iso(i.created_at as number) }));
    },

    // ---- safety ----
    my_status(this: DemoBackend, me: Id) {
      const r = this.restrictions.get(me);
      const until = this.crisisSupportUntil.get(me);
      return [{
        crisis_support_until: until ? iso(until) : null,
        comment_paused: r?.comment_paused ?? false,
        suspended_until: r?.suspended_until ? iso(r.suspended_until) : null,
        banned: r?.banned ?? false,
        is_moderator: this.moderators.has(me),
      }];
    },
    my_decisions(this: DemoBackend, me: Id) {
      return this.reports
        .filter((r) => r.target_user_id === me && r.status === 'actioned')
        .map((r) => ({
          report_id: r.id, target_type: r.target_type, reason: r.reason, decision: r.decision,
          decided_at: iso(r.decided_at ?? Date.now()),
          appeal_status: this.appeals.find((a) => a.report_id === r.id)?.status ?? null,
        }));
    },
    report_content(this: DemoBackend, me: Id, a: { target_type: Report['target_type']; target_id: Id; reason: string; details: string }) {
      const severe = ['threat', 'self_harm_encouragement', 'doxxing'].includes(a.reason);
      let owner: Id | undefined;
      if (a.target_type === 'post') {
        const p = this.posts.find((x) => x.id === a.target_id);
        if (!p || !this.canView(p, me)) fail('Not found');
        owner = p!.author_id;
        if (severe) p!.hidden_for_review = true;
      } else if (a.target_type === 'comment') {
        const c = this.comments.find((x) => x.id === a.target_id);
        const p = c && this.posts.find((x) => x.id === c.post_id);
        if (!c || !p || !this.canReadComment(c, p, me)) fail('Not found');
        owner = c!.author_id;
        if (severe) c!.hidden_for_review = true;
      } else {
        const p = this.profiles.get(a.target_id);
        if (!p || this.isBlocked(me, p.id)) fail('Not found');
        owner = p!.id;
      }
      if (owner === me) fail("You can't report yourself");
      if (this.reports.some((r) => r.reporter_id === me && r.target_type === a.target_type && r.target_id === a.target_id)) return;
      this.reports.push({
        id: newId(), reporter_id: me, target_type: a.target_type, target_id: a.target_id, target_user_id: owner!,
        reason: a.reason, details: a.details ?? '', status: 'open', decision: null, decided_by: null, decided_at: null, created_at: Date.now(),
      });
    },
    review_queue(this: DemoBackend, me: Id) {
      if (!this.moderators.has(me)) fail('Moderators only');
      const severe = (r: Report) => ['threat', 'self_harm_encouragement', 'doxxing'].includes(r.reason);
      return this.reports
        .filter((r) => r.status === 'open')
        .sort((x, y) => Number(severe(y)) - Number(severe(x)) || x.created_at - y.created_at)
        .map((r) => ({
          report_id: r.id, target_type: r.target_type, target_id: r.target_id, reason: r.reason, details: r.details,
          content:
            r.target_type === 'post' ? (this.posts.find((p) => p.id === r.target_id)?.body ?? null)
            : r.target_type === 'comment' ? (this.comments.find((c) => c.id === r.target_id)?.body ?? null)
            : (() => { const p = this.profiles.get(r.target_id); return p ? `${p.display_name} — ${p.bio}` : null; })(),
          author_username: this.profiles.get(r.target_user_id)?.username ?? null,
          author_prior_actions: this.reports.filter((x) => x.target_user_id === r.target_user_id && x.status === 'actioned').length,
          report_count: this.reports.filter((x) => x.target_type === r.target_type && x.target_id === r.target_id && x.status === 'open').length,
          created_at: iso(r.created_at),
        }));
    },
    decide_report(this: DemoBackend, me: Id, a: { report_id: Id; decision: string; bad_faith: boolean }) {
      if (!this.moderators.has(me)) fail('Moderators only');
      const r = this.reports.find((x) => x.id === a.report_id && x.status === 'open') ?? fail('Report not found');
      const same = this.reports.filter((x) => x.target_type === r.target_type && x.target_id === r.target_id && x.status === 'open');
      if (a.decision === 'dismiss') {
        const target = r.target_type === 'post' ? this.posts.find((p) => p.id === r.target_id) : this.comments.find((c) => c.id === r.target_id);
        if (target) target.hidden_for_review = false;
        for (const x of same) Object.assign(x, { status: 'dismissed', decision: 'dismiss', decided_by: me, decided_at: Date.now() });
        if (a.bad_faith) this.restriction(r.reporter_id).warnings += 1;
        return;
      }
      if (r.target_type === 'post') this.posts = this.posts.filter((p) => p.id !== r.target_id);
      else if (r.target_type === 'comment') this.comments = this.comments.filter((c) => c.id !== r.target_id);
      else { const p = this.profiles.get(r.target_id); if (p) Object.assign(p, { bio: '', display_name: p.username }); }
      this.applyPenalty(r.target_user_id, a.decision);
      for (const x of same) Object.assign(x, { status: 'actioned', decision: x === r ? a.decision : 'covered', decided_by: me, decided_at: Date.now() });
    },
    pause_queue(this: DemoBackend, me: Id) {
      if (!this.moderators.has(me)) fail('Moderators only');
      return [...this.restrictions].filter(([, r]) => r.comment_paused).map(([id]) => ({
        username: this.profiles.get(id)?.username ?? 'deleted',
        attempts: this.blockedAttempts.filter((b) => b.user_id === id).map((b) => ({ category: b.category, excerpt: b.excerpt, at: iso(b.created_at) })),
        paused_at: iso(Date.now()),
      }));
    },
    decide_pause(this: DemoBackend, me: Id, a: { username: string; decision: string }) {
      if (!this.moderators.has(me)) fail('Moderators only');
      const who = this.byUsername(a.username) ?? fail('Nothing to review');
      if (a.decision === 'restore') this.restriction(who.id).comment_paused = false;
      else if (a.decision !== 'restrict') this.applyPenalty(who.id, a.decision);
    },
    appeal(this: DemoBackend, me: Id, a: { report_id: Id; message: string }) {
      if (!this.reports.some((r) => r.id === a.report_id && r.target_user_id === me && r.status === 'actioned')) fail('Nothing to appeal');
      if (this.appeals.some((x) => x.report_id === a.report_id)) fail('You have already appealed this decision');
      this.appeals.push({ id: newId(), report_id: a.report_id, user_id: me, message: a.message.trim(), status: 'open', decided_by: null, created_at: Date.now() });
    },
    appeal_queue(this: DemoBackend, me: Id) {
      if (!this.moderators.has(me)) fail('Moderators only');
      return this.appeals
        .filter((x) => x.status === 'open' && this.reports.find((r) => r.id === x.report_id)?.decided_by !== me)
        .map((x) => {
          const r = this.reports.find((y) => y.id === x.report_id)!;
          return { appeal_id: x.id, reason: r.reason, decision: r.decision, message: x.message, author_username: this.profiles.get(x.user_id)?.username, created_at: iso(x.created_at) };
        });
    },
    decide_appeal(this: DemoBackend, me: Id, a: { appeal_id: Id; overturn: boolean }) {
      if (!this.moderators.has(me)) fail('Moderators only');
      const x = this.appeals.find((y) => y.id === a.appeal_id && y.status === 'open') ?? fail('Appeal not found');
      if (this.reports.find((r) => r.id === x.report_id)?.decided_by === me) fail('A different moderator has to review this appeal');
      if (a.overturn) Object.assign(this.restriction(x.user_id), { suspended_until: null, banned: false });
      x.status = a.overturn ? 'overturned' : 'upheld';
      x.decided_by = me;
    },

    // ---- buddies ----
    send_buddy_request(this: DemoBackend, me: Id, a: { other: Id }) {
      this.assertActive(me);
      if (!this.inCorner(me, a.other)) fail("Buddies have to be in each other's Corner first");
      if (this.areBuddies(me, a.other)) return 'already_buddies';
      if (this.buddyIds(me).length >= 10) fail('You already have 10 buddies');
      const theirs = this.buddyRequests.findIndex((r) => r.from === a.other && r.to === me);
      if (theirs >= 0) {
        if (this.buddyIds(a.other).length >= 10) fail("They can't add more buddies right now");
        this.buddyRequests.splice(theirs, 1);
        this.buddies.add(pairKey(me, a.other));
        return 'connected';
      }
      if (!this.buddyRequests.some((r) => r.from === me && r.to === a.other)) {
        this.buddyRequests.push({ from: me, to: a.other, created_at: Date.now() });
      }
      return 'sent';
    },
    respond_buddy_request(this: DemoBackend, me: Id, a: { requester: Id; accept: boolean }) {
      const i = this.buddyRequests.findIndex((r) => r.from === a.requester && r.to === me);
      if (i < 0) fail('That request no longer exists');
      this.buddyRequests.splice(i, 1);
      if (!a.accept) return;
      if (!this.inCorner(me, a.requester)) fail("Buddies have to be in each other's Corner first");
      if (this.buddyIds(me).length >= 10) fail('You already have 10 buddies');
      this.buddies.add(pairKey(me, a.requester));
    },
    cancel_buddy_request(this: DemoBackend, me: Id, a: { target: Id }) {
      this.buddyRequests = this.buddyRequests.filter((r) => !(r.from === me && r.to === a.target));
    },
    remove_buddy(this: DemoBackend, me: Id, a: { other: Id }) {
      this.buddies.delete(pairKey(me, a.other));
    },
    my_buddies(this: DemoBackend, me: Id) {
      return this.buddyIds(me).map((id) => this.profile(id)).map((p) => ({ id: p.id, username: p.username, display_name: p.display_name }));
    },
    my_buddy_requests(this: DemoBackend, me: Id) {
      return this.buddyRequests
        .filter((r) => r.from === me || r.to === me)
        .map((r) => {
          const p = this.profile(r.to === me ? r.from : r.to);
          return { id: p.id, username: p.username, display_name: p.display_name, incoming: r.to === me };
        });
    },
    buddy_status(this: DemoBackend, me: Id, a: { other: Id }) {
      if (this.areBuddies(me, a.other)) return 'buddies';
      if (this.buddyRequests.some((r) => r.from === me && r.to === a.other)) return 'request_sent';
      if (this.buddyRequests.some((r) => r.from === a.other && r.to === me)) return 'request_received';
      return 'none';
    },
    buddy_suggestions(this: DemoBackend, me: Id) {
      const month = Date.now() - 30 * 86400e3;
      return this.cornerIds(me)
        .filter((other) => !this.areBuddies(me, other) && !this.buddyRequests.some((r) => pairKey(r.from, r.to) === pairKey(me, other)))
        .map((other) => {
          const supports = (from: Id, to: Id) =>
            this.reactions.filter((r) => r.reactor_id === from && r.show_name && r.created_at > month && this.posts.find((p) => p.id === r.post_id && p.author_id === to && !p.is_anonymous)).length +
            this.comments.filter((c) => c.author_id === from && c.created_at > month && this.posts.find((p) => p.id === c.post_id && p.author_id === to)).length;
          const theirs = supports(other, me);
          const mine = supports(me, other);
          return { other, score: theirs + mine, both: theirs > 0 && mine > 0 };
        })
        .filter((s) => s.both && s.score >= 3)
        .sort((x, y) => y.score - x.score)
        .slice(0, 3)
        .map((s) => { const p = this.profile(s.other); return { id: p.id, username: p.username, display_name: p.display_name }; });
    },
    register_push_token() {},
    unregister_push_token() {},
  };

  applyPenalty(who: Id, decision: string) {
    const r = this.restriction(who);
    if (decision === 'warn') r.warnings += 1;
    else if (decision === 'suspend_7') r.suspended_until = Date.now() + 7 * 86400e3;
    else if (decision === 'suspend_30') r.suspended_until = Date.now() + 30 * 86400e3;
    else if (decision === 'ban') r.banned = true;
  }
}
