-- As One — Phase 3: reactions, comments, goal follow-ups, and Activity.
--
-- Who can say what:
--   * Anyone who can see a post can send a preset reaction (never to their own).
--   * Only people in the poster's Corner can write comments, and only on named
--     posts. Anonymous posts are reactions-only for everyone.
--   * Comments are flat. Commenters can't reply to each other; the poster can
--     reply to any comment.
--   * Reaction counts are visible only to the poster. Each reactor decides
--     whether the poster sees their name.

-- ---------------------------------------------------------------------------
-- Post changes
-- ---------------------------------------------------------------------------

alter table public.posts
  -- "Only I see comments": each commenter sees only their own comment and the
  -- poster's reply to it.
  add column comments_private boolean not null default false,
  -- A follow-up posted from an original goal ("I did it!").
  add column follow_up_of uuid references public.posts (id) on delete set null;

create index posts_follow_up_idx on public.posts (follow_up_of) where follow_up_of is not null;

-- ---------------------------------------------------------------------------
-- Visibility helpers
-- ---------------------------------------------------------------------------

-- Can this viewer see this post at all? Mirrors the feed rules.
create function private.can_view(p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.author_id = viewer
    or (
      p.published_at <= now()
      and not private.is_blocked_between(viewer, p.author_id)
      and (p.to_everyone or (p.to_corner and private.in_corner(viewer, p.author_id)))
    );
$$;

-- Can this viewer write a comment on this post? Corner members only, named
-- posts only.
create function private.can_comment(p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not p.is_anonymous
    and p.author_id <> viewer
    and p.published_at <= now()
    and private.in_corner(viewer, p.author_id);
$$;

-- The preset reactions for each kind of post.
create function private.allowed_reactions(kind text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case kind
    when 'struggle' then array['support', 'not_alone', 'strength']
    when 'goal' then array['believe', 'got_this']
    when 'milestone' then array['proud', 'congrats']
    when 'life_event' then array['happy_for_you', 'thinking_of_you']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- Reactions
-- ---------------------------------------------------------------------------

create table public.reactions (
  post_id uuid not null references public.posts (id) on delete cascade,
  reactor_id uuid not null references public.profiles (id) on delete cascade,
  reaction text not null,
  -- The reactor's choice: show the poster my name, or appear as "Someone".
  show_name boolean not null,
  created_at timestamptz not null default now(),
  primary key (post_id, reactor_id, reaction)
);
create index reactions_reactor_idx on public.reactions (reactor_id);

-- ---------------------------------------------------------------------------
-- Comments
-- ---------------------------------------------------------------------------

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 1000),
  -- Set only on the poster's replies.
  reply_to uuid references public.comments (id) on delete cascade,
  -- Captured from the post when written: switching a post's comments from
  -- private to public later doesn't expose comments written in private.
  is_private boolean not null,
  created_at timestamptz not null default now()
);
create index comments_post_idx on public.comments (post_id, created_at);
create index comments_author_idx on public.comments (author_id);

alter table public.reactions enable row level security;
alter table public.comments enable row level security;
revoke all on public.reactions, public.comments from anon, authenticated;

-- Can this viewer read this comment?
create function private.can_read_comment(c public.comments, p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_blocked_between(viewer, c.author_id)
    and (
      viewer = p.author_id
      or viewer = c.author_id
      -- A reply to my private comment is mine to read.
      or exists (
        select 1 from public.comments parent
        where parent.id = c.reply_to and parent.author_id = viewer
      )
      or (
        not c.is_private
        and private.can_view(p, viewer)
        and (
          c.reply_to is null
          or exists (select 1 from public.comments parent where parent.id = c.reply_to and not parent.is_private)
        )
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- Feed rows gain reactions, comments and follow-up info
-- ---------------------------------------------------------------------------

alter type public.feed_post
  add attribute my_reactions text[],
  -- Only filled in on your own posts: counts are never public.
  add attribute reaction_count int,
  add attribute comment_count int,
  add attribute can_comment boolean,
  add attribute comments_private boolean,
  add attribute follow_up_of uuid,
  add attribute follow_up_excerpt text;

create or replace function private.to_feed_post(p public.posts, viewer uuid)
returns public.feed_post
language sql
stable
security definer
set search_path = ''
as $$
  select row(
    p.id,
    p.kind,
    p.body,
    p.is_anonymous,
    p.to_corner,
    p.to_everyone,
    case when p.is_anonymous and p.author_id <> viewer
      then date_trunc('hour', p.published_at)
      else p.published_at
    end,
    case when p.is_anonymous then null else pr.username end,
    case when p.is_anonymous then null else pr.display_name end,
    p.author_id = viewer,
    coalesce(
      (select array_agg(r.reaction order by r.reaction) from public.reactions r
       where r.post_id = p.id and r.reactor_id = viewer),
      '{}'
    ),
    case when p.author_id = viewer
      then (select count(*)::int from public.reactions r where r.post_id = p.id)
    end,
    (select count(*)::int from public.comments c where c.post_id = p.id and private.can_read_comment(c, p, viewer)),
    private.can_comment(p, viewer),
    p.comments_private,
    p.follow_up_of,
    (select left(o.body, 120) from public.posts o where o.id = p.follow_up_of)
  )::public.feed_post
  from public.profiles pr
  where pr.id = p.author_id;
$$;

-- ---------------------------------------------------------------------------
-- Posting (replaces the Phase 2 version)
-- ---------------------------------------------------------------------------

drop function public.create_post(text, text, boolean, boolean, boolean);

-- A follow-up takes its audience from the original goal, so an anonymous goal
-- gets an anonymous follow-up and a Corner-only goal stays Corner-only.
create function public.create_post(
  kind text,
  body text,
  anonymous boolean,
  to_corner boolean,
  to_everyone boolean,
  comments_private boolean default false,
  follow_up_of uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  original public.posts;
  new_id uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if follow_up_of is not null then
    select * into original from public.posts where id = create_post.follow_up_of;
    if original.id is null or original.author_id <> me then
      raise exception 'You can only follow up on your own posts';
    end if;
    if original.kind <> 'goal' then
      raise exception 'Follow-ups are for goals';
    end if;
    anonymous := original.is_anonymous;
    to_corner := original.to_corner;
    to_everyone := original.to_everyone;
  end if;

  if anonymous and (to_corner or not to_everyone) then
    raise exception 'Anonymous posts can only be shared with everyone';
  end if;
  if not (to_corner or to_everyone) then
    raise exception 'Choose who can see this post';
  end if;

  -- Phase 4 adds screening for serious ill intent and crisis detection here.

  insert into public.posts (
    author_id, kind, body, is_anonymous, to_corner, to_everyone, published_at,
    comments_private, follow_up_of
  )
  values (
    me,
    kind,
    btrim(body),
    anonymous,
    to_corner,
    to_everyone,
    case when anonymous
      then now() + make_interval(secs => 60 + floor(random() * 540)::int)  -- 1–10 minutes
      else now()
    end,
    coalesce(comments_private, false),
    create_post.follow_up_of
  )
  returning id into new_id;

  return new_id;
end;
$$;

create function public.get_post(post_id uuid)
returns setof public.feed_post
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_feed_post(p, auth.uid())
  from public.posts p
  where p.id = post_id and private.can_view(p, auth.uid());
$$;

-- Applies to comments written from now on; earlier ones keep their setting.
create function public.set_comments_private(post_id uuid, private boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.posts set comments_private = set_comments_private.private
  where id = post_id and author_id = auth.uid();
  if not found then
    raise exception 'Post not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reacting
-- ---------------------------------------------------------------------------

create function public.react(post_id uuid, reaction text, show_name boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.posts;
begin
  select * into p from public.posts where id = post_id;
  if p.id is null or not private.can_view(p, me) then
    raise exception 'Post not found';
  end if;
  if p.author_id = me then
    raise exception 'You can''t react to your own post';
  end if;
  if not (reaction = any (private.allowed_reactions(p.kind))) then
    raise exception 'That reaction isn''t available for this post';
  end if;

  insert into public.reactions (post_id, reactor_id, reaction, show_name)
  values (post_id, me, reaction, show_name)
  on conflict on constraint reactions_pkey do update set show_name = excluded.show_name;
end;
$$;

create function public.unreact(post_id uuid, reaction text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.reactions r
  where r.post_id = unreact.post_id and r.reactor_id = auth.uid() and r.reaction = unreact.reaction;
$$;

-- For the poster only: every reaction on their post, with names only where
-- the reactor chose to share them.
create function public.post_reactions(post_id uuid)
returns table (reaction text, username text, display_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.reaction,
    case when r.show_name then pr.username end,
    case when r.show_name then pr.display_name end,
    r.created_at
  from public.reactions r
  join public.posts p on p.id = r.post_id
  join public.profiles pr on pr.id = r.reactor_id
  where r.post_id = post_reactions.post_id
    and p.author_id = auth.uid()
  order by r.created_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Commenting
-- ---------------------------------------------------------------------------

create function public.add_comment(post_id uuid, body text, reply_to uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.posts;
  parent public.comments;
  new_id uuid;
begin
  select * into p from public.posts where id = post_id;
  if p.id is null or not private.can_view(p, me) then
    raise exception 'Post not found';
  end if;

  if reply_to is not null then
    -- Only the poster replies, and only to top-level comments on this post.
    select * into parent from public.comments where id = add_comment.reply_to;
    if p.author_id <> me then
      raise exception 'Only the poster can reply to comments';
    end if;
    if parent.id is null or parent.post_id <> p.id or parent.reply_to is not null then
      raise exception 'Comment not found';
    end if;
    if private.is_blocked_between(me, parent.author_id) then
      raise exception 'Comment not found';
    end if;
  elsif not private.can_comment(p, me) then
    raise exception 'Only people in their Corner can comment here';
  end if;

  -- Phase 4 adds screening for serious ill intent here.

  insert into public.comments (post_id, author_id, body, reply_to, is_private)
  values (
    p.id,
    me,
    btrim(body),
    add_comment.reply_to,
    coalesce(parent.is_private, p.comments_private)
  )
  returning id into new_id;
  return new_id;
end;
$$;

-- The commenter or the poster can delete a comment (and its replies).
create function public.delete_comment(comment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.comments c
  using public.posts p
  where c.id = comment_id
    and p.id = c.post_id
    and auth.uid() in (c.author_id, p.author_id);
  if not found then
    raise exception 'Comment not found';
  end if;
end;
$$;

create function public.post_comments(post_id uuid)
returns table (
  id uuid,
  body text,
  reply_to uuid,
  is_private boolean,
  created_at timestamptz,
  author_username text,
  author_display_name text,
  is_mine boolean,
  is_poster boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.body,
    c.reply_to,
    c.is_private,
    c.created_at,
    pr.username,
    pr.display_name,
    c.author_id = auth.uid(),
    c.author_id = p.author_id
  from public.comments c
  join public.posts p on p.id = c.post_id
  join public.profiles pr on pr.id = c.author_id
  where c.post_id = post_comments.post_id
    and private.can_view(p, auth.uid())
    and private.can_read_comment(c, p, auth.uid())
  order by c.created_at;
$$;

-- ---------------------------------------------------------------------------
-- Activity: reactions and comments on my posts, replies to my comments, and
-- follow-ups on goals I supported. Shown in-app only, never as a ping.
-- ---------------------------------------------------------------------------

create function public.my_activity(page_size int default 50)
returns table (
  kind text,           -- 'reaction' | 'comment' | 'reply' | 'follow_up'
  post_id uuid,
  post_excerpt text,
  reaction text,
  actor_username text, -- null when the reactor stayed anonymous ("Someone")
  actor_display_name text,
  body text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id)
  select * from (
    select 'reaction', p.id, left(p.body, 80), r.reaction,
      case when r.show_name then pr.username end,
      case when r.show_name then pr.display_name end,
      null::text, r.created_at
    from public.reactions r
    join public.posts p on p.id = r.post_id
    join public.profiles pr on pr.id = r.reactor_id
    where p.author_id = (select id from me)
      and not private.is_blocked_between((select id from me), r.reactor_id)

    union all
    select 'comment', p.id, left(p.body, 80), null, pr.username, pr.display_name, left(c.body, 160), c.created_at
    from public.comments c
    join public.posts p on p.id = c.post_id
    join public.profiles pr on pr.id = c.author_id
    where p.author_id = (select id from me)
      and c.author_id <> (select id from me)
      and not private.is_blocked_between((select id from me), c.author_id)

    union all
    select 'reply', p.id, left(p.body, 80), null,
      case when p.is_anonymous then null else pr.username end,
      case when p.is_anonymous then null else pr.display_name end,
      left(c.body, 160), c.created_at
    from public.comments c
    join public.comments parent on parent.id = c.reply_to
    join public.posts p on p.id = c.post_id
    join public.profiles pr on pr.id = c.author_id
    where parent.author_id = (select id from me)
      and not private.is_blocked_between((select id from me), c.author_id)

    union all
    -- Follow-ups on goals I reacted to or commented on. The author stays hidden
    -- when the goal was anonymous.
    select 'follow_up', f.id, left(f.body, 80), null,
      case when f.is_anonymous then null else pr.username end,
      case when f.is_anonymous then null else pr.display_name end,
      left(o.body, 80), f.published_at
    from public.posts f
    join public.posts o on o.id = f.follow_up_of
    join public.profiles pr on pr.id = f.author_id
    where f.author_id <> (select id from me)
      and f.published_at <= now()
      and private.can_view(f, (select id from me))
      and (
        exists (select 1 from public.reactions r where r.post_id = o.id and r.reactor_id = (select id from me))
        or exists (select 1 from public.comments c where c.post_id = o.id and c.author_id = (select id from me))
      )
  ) a (kind, post_id, post_excerpt, reaction, actor_username, actor_display_name, body, created_at)
  order by created_at desc
  limit least(page_size, 100);
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function
  public.create_post(text, text, boolean, boolean, boolean, boolean, uuid),
  public.get_post(uuid),
  public.set_comments_private(uuid, boolean),
  public.react(uuid, text, boolean),
  public.unreact(uuid, text),
  public.post_reactions(uuid),
  public.add_comment(uuid, text, uuid),
  public.delete_comment(uuid),
  public.post_comments(uuid),
  public.my_activity(int),
  private.can_view(public.posts, uuid),
  private.can_comment(public.posts, uuid),
  private.can_read_comment(public.comments, public.posts, uuid),
  private.allowed_reactions(text)
from public, anon;

grant execute on function
  public.create_post(text, text, boolean, boolean, boolean, boolean, uuid),
  public.get_post(uuid),
  public.set_comments_private(uuid, boolean),
  public.react(uuid, text, boolean),
  public.unreact(uuid, text),
  public.post_reactions(uuid),
  public.add_comment(uuid, text, uuid),
  public.delete_comment(uuid),
  public.post_comments(uuid),
  public.my_activity(int)
to authenticated;
