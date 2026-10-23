-- As One — Phase 2: posts and feeds.
--
-- Anonymity is enforced here. Nobody can read the posts table directly; the
-- only way to see posts is through the feed functions below, and those never
-- return who wrote an anonymous post to anyone but its author.

-- ---------------------------------------------------------------------------
-- Posts
-- ---------------------------------------------------------------------------

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('struggle', 'goal', 'milestone', 'life_event')),
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  is_anonymous boolean not null default false,
  to_corner boolean not null,
  to_everyone boolean not null,
  created_at timestamptz not null default now(),
  -- When the post appears in feeds. Anonymous posts go live after a short
  -- random delay so they can't be matched to their author by timing.
  published_at timestamptz not null default now(),
  check (to_corner or to_everyone),
  -- Anonymous posts only go to the Everyone feed, so a small Corner can't
  -- narrow down who wrote them.
  check (not is_anonymous or (to_everyone and not to_corner))
);
create index posts_author_idx on public.posts (author_id, published_at desc);
create index posts_everyone_idx on public.posts (published_at desc) where to_everyone;
create index posts_corner_idx on public.posts (published_at desc) where to_corner;

-- Which anonymous posts each person has already been shown, so posts from
-- their Corner are guaranteed to reach them once (see everyone_feed).
create table public.anonymous_post_views (
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid not null references public.posts (id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (viewer_id, post_id)
);

alter table public.posts enable row level security;
alter table public.anonymous_post_views enable row level security;
-- No policies: the tables are reachable only through the functions below.
revoke all on public.posts, public.anonymous_post_views from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What a feed row looks like to the app
-- ---------------------------------------------------------------------------

-- author_* columns are null for anonymous posts. is_mine is only ever true
-- for the viewer's own posts, which is how authors recognize theirs.
create type public.feed_post as (
  id uuid,
  kind text,
  body text,
  is_anonymous boolean,
  to_corner boolean,
  to_everyone boolean,
  published_at timestamptz,
  author_username text,
  author_display_name text,
  is_mine boolean
);

-- Shapes a post for a viewer. Anonymous posts lose their author, and (unless
-- they're the viewer's own) their time is rounded to the hour so it can't be
-- matched to someone's activity.
create function private.to_feed_post(p public.posts, viewer uuid)
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
    p.author_id = viewer
  )::public.feed_post
  from public.profiles pr
  where pr.id = p.author_id;
$$;

-- ---------------------------------------------------------------------------
-- Writing
-- ---------------------------------------------------------------------------

create function public.create_post(
  kind text,
  body text,
  anonymous boolean,
  to_corner boolean,
  to_everyone boolean
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  new_id uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;
  if anonymous and (to_corner or not to_everyone) then
    raise exception 'Anonymous posts can only be shared with everyone';
  end if;
  if not (to_corner or to_everyone) then
    raise exception 'Choose who can see this post';
  end if;

  -- Phase 4 adds screening for serious ill intent and crisis detection here.

  insert into public.posts (author_id, kind, body, is_anonymous, to_corner, to_everyone, published_at)
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
    end
  )
  returning id into new_id;

  return new_id;
end;
$$;

create function public.delete_post(post_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.posts where id = post_id and author_id = auth.uid();
  if not found then
    raise exception 'Post not found';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Feeds
-- ---------------------------------------------------------------------------

-- Corner tab: named posts shared with Corner by people in your Corner (and
-- your own), newest first. Pass the last post's published_at to page.
create function public.corner_feed(before timestamptz default null, page_size int default 20)
returns setof public.feed_post
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_feed_post(p, auth.uid())
  from public.posts p
  where p.to_corner
    and not p.is_anonymous
    and p.published_at <= now()
    and p.published_at < coalesce(before, 'infinity')
    and (p.author_id = auth.uid() or private.in_corner(auth.uid(), p.author_id))
  order by p.published_at desc
  limit least(page_size, 50);
$$;

-- Everyone tab: public named posts and anonymous posts, newest first, with no
-- popularity ranking. Blocked people (either direction) never appear.
-- Pages by offset rather than by time, because anonymous times are rounded;
-- the app drops any post it already has.
--
-- The Corner guarantee: on the first page, any anonymous post from someone in
-- your Corner that you haven't been shown yet (from the last 14 days) is
-- mixed in at a random position. To keep that from standing out, at least as
-- many unseen anonymous posts from outside your Corner are resurfaced the same
-- way. Anonymous posts are recorded as seen once they're delivered.
create function public.everyone_feed(page_offset int default 0, page_size int default 20)
returns setof public.feed_post
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  lim int := least(page_size, 50);
  base public.posts[];
  extra public.posts[];
  corner_count int;
  result public.feed_post[];
  p public.posts;
  pos int;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select coalesce(array_agg(x order by x.published_at desc), '{}') into base
  from (
    select * from public.posts
    where to_everyone
      and published_at <= now()
      and not private.is_blocked_between(me, author_id)
    order by published_at desc, id
    offset greatest(page_offset, 0)
    limit lim
  ) x;

  result := array(
    select private.to_feed_post(base[i], me) from generate_subscripts(base, 1) as i order by i
  );

  if page_offset = 0 then
    -- Unseen anonymous posts from my Corner that didn't make the first page.
    select coalesce(array_agg(x), '{}') into extra
    from (
      select * from public.posts a
      where a.is_anonymous
        and a.published_at <= now()
        and a.published_at > now() - interval '14 days'
        and a.author_id <> me
        and private.in_corner(me, a.author_id)
        and a.id <> all (select (b).id from unnest(base) b)
        and not exists (select 1 from public.anonymous_post_views v where v.viewer_id = me and v.post_id = a.id)
      order by a.published_at desc
      limit 5
    ) x;
    corner_count := cardinality(extra);

    if corner_count > 0 then
      -- Decoys: at least as many unseen anonymous posts from outside my Corner.
      extra := extra || array(
        select a from public.posts a
        where a.is_anonymous
          and a.published_at <= now()
          and a.published_at > now() - interval '14 days'
          and a.author_id <> me
          and not private.in_corner(me, a.author_id)
          and not private.is_blocked_between(me, a.author_id)
          and a.id <> all (select (b).id from unnest(base) b)
          and not exists (select 1 from public.anonymous_post_views v where v.viewer_id = me and v.post_id = a.id)
        order by random()
        limit greatest(corner_count, 2)
      );

      -- Mix them in at random positions, in random order.
      for p in select * from unnest(extra) order by random() loop
        pos := 1 + floor(random() * (cardinality(result) + 1))::int;
        result := result[1:pos - 1] || private.to_feed_post(p, me) || result[pos:];
      end loop;
    end if;
  end if;

  insert into public.anonymous_post_views (viewer_id, post_id)
  select me, r.id from unnest(result) r where r.is_anonymous and not r.is_mine
  on conflict do nothing;

  return query select * from unnest(result);
end;
$$;

-- A person's public named posts, for their profile page. On your own profile
-- you also see your Corner-only posts. Anonymous posts never appear here.
create function public.profile_posts(username text, before timestamptz default null, page_size int default 20)
returns setof public.feed_post
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_feed_post(p, auth.uid())
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where lower(pr.username) = lower(profile_posts.username)
    and not p.is_anonymous
    and (p.to_everyone or p.author_id = auth.uid())
    and p.published_at <= now()
    and p.published_at < coalesce(before, 'infinity')
    and not private.is_blocked_between(auth.uid(), p.author_id)
  order by p.published_at desc
  limit least(page_size, 50);
$$;

-- Everything I've posted, including anonymous posts and ones still waiting
-- out their delay.
create function public.my_posts(before timestamptz default null, page_size int default 20)
returns setof public.feed_post
language sql
stable
security definer
set search_path = ''
as $$
  select private.to_feed_post(p, auth.uid())
  from public.posts p
  where p.author_id = auth.uid()
    and p.published_at < coalesce(before, 'infinity')
  order by p.published_at desc
  limit least(page_size, 50);
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function
  public.create_post(text, text, boolean, boolean, boolean),
  public.delete_post(uuid),
  public.corner_feed(timestamptz, int),
  public.everyone_feed(int, int),
  public.profile_posts(text, timestamptz, int),
  public.my_posts(timestamptz, int),
  private.to_feed_post(public.posts, uuid)
from public, anon;

grant execute on function
  public.create_post(text, text, boolean, boolean, boolean),
  public.delete_post(uuid),
  public.corner_feed(timestamptz, int),
  public.everyone_feed(int, int),
  public.profile_posts(text, timestamptz, int),
  public.my_posts(timestamptz, int)
to authenticated;
