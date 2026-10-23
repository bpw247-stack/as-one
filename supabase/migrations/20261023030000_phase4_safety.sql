-- As One — Phase 4: safety.
--
-- * Screening: posts, comments and profile text are checked by AI for serious
--   ill intent before they go live. To make that impossible to skip, those
--   writes now only accept calls from the server (the `screen` edge function,
--   using the service role), never straight from the app.
-- * Crisis mode: a post flagged as a possible crisis still goes up, but takes
--   no written comments from anyone, gets its own reactions, and keeps the
--   helpline in front of its author for 48 hours.
-- * Repeated blocked attempts pause commenting until a person reviews them.
-- * Reports are confidential. The reported person's account keeps working;
--   only the most dangerous content is hidden while it's reviewed. A human
--   decides every penalty, scaled by severity, with one appeal.

-- ---------------------------------------------------------------------------
-- New columns and tables
-- ---------------------------------------------------------------------------

alter table public.posts
  add column is_crisis boolean not null default false,
  add column hidden_for_review boolean not null default false;

alter table public.comments
  add column hidden_for_review boolean not null default false;

alter table public.account_details
  add column crisis_support_until timestamptz,
  add column email text;

-- Moderators. Added by hand in the SQL editor (see README).
create table public.moderators (
  user_id uuid primary key references public.profiles (id) on delete cascade
);

create table public.account_restrictions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  comment_paused boolean not null default false,
  suspended_until timestamptz,
  banned boolean not null default false,
  warnings int not null default 0
);

-- Kept after an account is deleted so a banned person can't simply sign up
-- again. Nothing else about them is kept.
create table public.banned_emails (
  email text primary key,
  banned_at timestamptz not null default now()
);

-- Text the screening stopped before anyone saw it.
create table public.blocked_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  target text not null check (target in ('post', 'comment', 'profile')),
  category text not null,
  excerpt text not null,
  created_at timestamptz not null default now()
);
create index blocked_attempts_user_idx on public.blocked_attempts (user_id, created_at desc);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('post', 'comment', 'profile')),
  target_id uuid not null,
  -- Whose content it is; filled in when the report is filed.
  target_user_id uuid references public.profiles (id) on delete cascade,
  reason text not null check (reason in (
    'hate', 'threat', 'self_harm_encouragement', 'harassment', 'sexual', 'doxxing', 'other'
  )),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  decision text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);
create index reports_open_idx on public.reports (created_at) where status = 'open';

-- Commenting paused after repeated blocked attempts, waiting on a person.
create table public.pause_reviews (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.appeals (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null unique references public.reports (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'upheld', 'overturned')),
  decided_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.moderators enable row level security;
alter table public.account_restrictions enable row level security;
alter table public.banned_emails enable row level security;
alter table public.blocked_attempts enable row level security;
alter table public.reports enable row level security;
alter table public.pause_reviews enable row level security;
alter table public.appeals enable row level security;
revoke all on public.moderators, public.account_restrictions, public.banned_emails,
  public.blocked_attempts, public.reports, public.pause_reviews, public.appeals
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.assert_active(who uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if who is null then
    raise exception 'Not signed in';
  end if;
  if exists (
    select 1 from public.account_restrictions
    where user_id = who and (banned or suspended_until > now())
  ) then
    raise exception 'Your account is suspended';
  end if;
end;
$$;

create function private.is_moderator(who uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.moderators where user_id = who);
$$;

create or replace function private.allowed_reactions(kind text)
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
    when 'crisis' then array['not_alone', 'life_matters', 'here_for_you', 'strength']
    else array[]::text[]
  end;
$$;

-- ---------------------------------------------------------------------------
-- Signup: remember the email (for bans) and refuse banned emails
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  dob date;
begin
  if new.email is not null
    and exists (select 1 from public.banned_emails where email = lower(new.email)) then
    raise exception 'This account can''t be created';
  end if;

  begin
    dob := (meta ->> 'birth_date')::date;
  exception when others then
    raise exception 'A valid date of birth is required';
  end;

  if dob is null then
    raise exception 'A valid date of birth is required';
  end if;
  if dob > (current_date - interval '18 years')::date then
    raise exception 'As One is for people 18 and older';
  end if;

  insert into public.profiles (id, username, display_name)
  values (new.id, meta ->> 'username', coalesce(meta ->> 'display_name', meta ->> 'username'));

  insert into public.account_details (user_id, birth_date, email)
  values (new.id, dob, lower(new.email));

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Visibility: hidden-for-review content and crisis posts
-- ---------------------------------------------------------------------------

create or replace function private.can_view(p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.author_id = viewer
    or (
      p.published_at <= now()
      and not p.hidden_for_review
      and not private.is_blocked_between(viewer, p.author_id)
      and (p.to_everyone or (p.to_corner and private.in_corner(viewer, p.author_id)))
    );
$$;

create or replace function private.can_comment(p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not p.is_anonymous
    and not p.is_crisis
    and p.author_id <> viewer
    and p.published_at <= now()
    and private.in_corner(viewer, p.author_id);
$$;

create or replace function private.can_read_comment(c public.comments, p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not private.is_blocked_between(viewer, c.author_id)
    and (not c.hidden_for_review or viewer = c.author_id)
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

create or replace function public.corner_feed(before timestamptz default null, page_size int default 20)
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
    and (not p.hidden_for_review or p.author_id = auth.uid())
    and p.published_at < coalesce(before, 'infinity')
    and (p.author_id = auth.uid() or private.in_corner(auth.uid(), p.author_id))
  order by p.published_at desc
  limit least(page_size, 50);
$$;

create or replace function public.profile_posts(username text, before timestamptz default null, page_size int default 20)
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
    and (not p.hidden_for_review or p.author_id = auth.uid())
    and p.published_at < coalesce(before, 'infinity')
    and not private.is_blocked_between(auth.uid(), p.author_id)
  order by p.published_at desc
  limit least(page_size, 50);
$$;

create or replace function public.everyone_feed(page_offset int default 0, page_size int default 20)
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
      and (not hidden_for_review or author_id = me)
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
        and not a.hidden_for_review
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
        and not a.hidden_for_review
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

alter type public.feed_post add attribute is_crisis boolean;

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
    (select left(o.body, 120) from public.posts o where o.id = p.follow_up_of),
    p.is_crisis
  )::public.feed_post
  from public.profiles pr
  where pr.id = p.author_id;
$$;

-- ---------------------------------------------------------------------------
-- Writes that must be screened first: server only
-- ---------------------------------------------------------------------------

drop function public.create_post(text, text, boolean, boolean, boolean, boolean, uuid);
drop function public.add_comment(uuid, text, uuid);

create function public.create_post(
  actor uuid,
  kind text,
  body text,
  anonymous boolean,
  to_corner boolean,
  to_everyone boolean,
  comments_private boolean default false,
  follow_up_of uuid default null,
  crisis boolean default false
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := actor;
  original public.posts;
  new_id uuid;
begin
  perform private.assert_active(me);

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

  insert into public.posts (
    author_id, kind, body, is_anonymous, to_corner, to_everyone, published_at,
    comments_private, follow_up_of, is_crisis
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
    create_post.follow_up_of,
    coalesce(crisis, false)
  )
  returning id into new_id;

  if crisis then
    -- Keep the helpline in front of them for 48 hours.
    update public.account_details
    set crisis_support_until = now() + interval '48 hours'
    where user_id = me;
  end if;

  return new_id;
end;
$$;

create function public.add_comment(actor uuid, post_id uuid, body text, reply_to uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := actor;
  p public.posts;
  parent public.comments;
  new_id uuid;
begin
  perform private.assert_active(me);
  if exists (select 1 from public.account_restrictions where user_id = me and comment_paused) then
    raise exception 'Your ability to comment is paused while we review recent activity';
  end if;

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

create or replace function public.react(post_id uuid, reaction text, show_name boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  p public.posts;
begin
  perform private.assert_active(me);
  select * into p from public.posts where id = post_id;
  if p.id is null or not private.can_view(p, me) then
    raise exception 'Post not found';
  end if;
  if p.author_id = me then
    raise exception 'You can''t react to your own post';
  end if;
  if not (reaction = any (private.allowed_reactions(case when p.is_crisis then 'crisis' else p.kind end))) then
    raise exception 'That reaction isn''t available for this post';
  end if;

  insert into public.reactions (post_id, reactor_id, reaction, show_name)
  values (post_id, me, reaction, show_name)
  on conflict on constraint reactions_pkey do update set show_name = excluded.show_name;
end;
$$;

create function public.update_profile(actor uuid, display_name text, bio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_active(actor);
  update public.profiles
  set display_name = btrim(update_profile.display_name), bio = btrim(update_profile.bio)
  where id = actor;
end;
$$;

-- Profile edits now go through screening too.
revoke update on public.profiles from authenticated;
drop policy "edit own profile" on public.profiles;

-- Records text the screening stopped. Three serious attempts within a day
-- pause commenting until a person reviews them. The person they were aimed at
-- never sees any of it.
create function public.record_blocked_attempt(actor uuid, target text, category text, excerpt text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent int;
begin
  insert into public.blocked_attempts (user_id, target, category, excerpt)
  values (actor, target, category, left(excerpt, 500));

  select count(*) into recent from public.blocked_attempts
  where user_id = actor and created_at > now() - interval '24 hours';

  if recent >= 3 then
    insert into public.account_restrictions (user_id, comment_paused) values (actor, true)
    on conflict (user_id) do update set comment_paused = true;
    insert into public.pause_reviews (user_id) values (actor) on conflict do nothing;
    return true;
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- What a person can know about their own standing
-- ---------------------------------------------------------------------------

create function public.my_status()
returns table (
  crisis_support_until timestamptz,
  comment_paused boolean,
  suspended_until timestamptz,
  banned boolean,
  is_moderator boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.crisis_support_until,
    coalesce(r.comment_paused, false),
    r.suspended_until,
    coalesce(r.banned, false),
    private.is_moderator(auth.uid())
  from public.account_details d
  left join public.account_restrictions r on r.user_id = d.user_id
  where d.user_id = auth.uid();
$$;

-- Decisions made about my content, so I can appeal once.
create function public.my_decisions()
returns table (report_id uuid, target_type text, reason text, decision text, decided_at timestamptz, appeal_status text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.target_type, r.reason, r.decision, r.decided_at, a.status
  from public.reports r
  left join public.appeals a on a.report_id = r.id
  where r.target_user_id = auth.uid() and r.status = 'actioned'
  order by r.decided_at desc;
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Anyone can report anything they can see. The reported person is never told.
-- Threats, encouraging self-harm and doxxing are hidden right away while a
-- person reviews them; the author still sees their own content as normal.
create function public.report_content(target_type text, target_id uuid, reason text, details text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  owner uuid;
  p public.posts;
  c public.comments;
  severe boolean := reason in ('threat', 'self_harm_encouragement', 'doxxing');
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if target_type = 'post' then
    select * into p from public.posts where id = target_id;
    if p.id is null or not private.can_view(p, me) then
      raise exception 'Not found';
    end if;
    owner := p.author_id;
    if severe then update public.posts set hidden_for_review = true where id = p.id; end if;
  elsif target_type = 'comment' then
    select * into c from public.comments where id = target_id;
    select * into p from public.posts where id = c.post_id;
    if c.id is null or not private.can_read_comment(c, p, me) then
      raise exception 'Not found';
    end if;
    owner := c.author_id;
    if severe then update public.comments set hidden_for_review = true where id = c.id; end if;
  elsif target_type = 'profile' then
    select id into owner from public.profiles where id = target_id;
    if owner is null or private.is_blocked_between(me, owner) then
      raise exception 'Not found';
    end if;
  else
    raise exception 'Unknown report type';
  end if;

  if owner = me then
    raise exception 'You can''t report yourself';
  end if;

  insert into public.reports (reporter_id, target_type, target_id, target_user_id, reason, details)
  values (me, target_type, target_id, owner, reason, left(coalesce(details, ''), 1000))
  on conflict on constraint reports_reporter_id_target_type_target_id_key do nothing;
end;
$$;

-- ---------------------------------------------------------------------------
-- Moderation (moderators only)
-- ---------------------------------------------------------------------------

-- Open reports with the reported content. Moderators see who wrote it, even
-- for anonymous posts, because they have to be able to act on it.
create function public.review_queue()
returns table (
  report_id uuid,
  target_type text,
  target_id uuid,
  reason text,
  details text,
  content text,
  author_username text,
  author_prior_actions int,
  report_count int,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator(auth.uid()) then
    raise exception 'Moderators only';
  end if;
  return query
  select
    r.id,
    r.target_type,
    r.target_id,
    r.reason,
    r.details,
    case r.target_type
      when 'post' then (select body from public.posts where id = r.target_id)
      when 'comment' then (select body from public.comments where id = r.target_id)
      else (select display_name || ' — ' || bio from public.profiles where id = r.target_id)
    end,
    pr.username,
    (select count(*)::int from public.reports x where x.target_user_id = r.target_user_id and x.status = 'actioned'),
    (select count(*)::int from public.reports x where x.target_type = r.target_type and x.target_id = r.target_id and x.status = 'open'),
    r.created_at
  from public.reports r
  left join public.profiles pr on pr.id = r.target_user_id
  where r.status = 'open'
  order by
    (r.reason in ('threat', 'self_harm_encouragement', 'doxxing')) desc,
    r.created_at;
end;
$$;

-- Penalties by severity:
--   dismiss     — nothing wrong; hidden content comes back
--   warn        — content removed + private warning            (low)
--   suspend_7   — content removed + 7-day suspension           (medium)
--   suspend_30  — content removed + 30-day suspension          (high)
--   ban         — content removed + permanent ban              (severe)
-- Pass bad_faith on a dismissal to warn a reporter who filed in bad faith.
create function public.decide_report(report_id uuid, decision text, bad_faith boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r public.reports;
begin
  if not private.is_moderator(me) then
    raise exception 'Moderators only';
  end if;
  select * into r from public.reports where id = report_id and status = 'open';
  if r.id is null then
    raise exception 'Report not found';
  end if;
  if decision not in ('dismiss', 'warn', 'suspend_7', 'suspend_30', 'ban') then
    raise exception 'Unknown decision';
  end if;

  if decision = 'dismiss' then
    if r.target_type = 'post' then
      update public.posts set hidden_for_review = false where id = r.target_id;
    elsif r.target_type = 'comment' then
      update public.comments set hidden_for_review = false where id = r.target_id;
    end if;
    update public.reports set status = 'dismissed', decision = 'dismiss', decided_by = me, decided_at = now()
    where target_type = r.target_type and target_id = r.target_id and status = 'open';
    if bad_faith and r.reporter_id is not null then
      insert into public.account_restrictions (user_id, warnings) values (r.reporter_id, 1)
      on conflict (user_id) do update set warnings = public.account_restrictions.warnings + 1;
    end if;
    return;
  end if;

  -- Remove the content (profiles: clear the bio and reset the name).
  if r.target_type = 'post' then
    delete from public.posts where id = r.target_id;
  elsif r.target_type = 'comment' then
    delete from public.comments where id = r.target_id;
  else
    update public.profiles p set bio = '', display_name = p.username where p.id = r.target_id;
  end if;

  perform private.apply_penalty(r.target_user_id, decision);

  update public.reports set status = 'actioned', decision = decide_report.decision, decided_by = me, decided_at = now()
  where id = r.id;
  -- Other open reports about the same content are settled by this decision.
  update public.reports set status = 'actioned', decision = 'covered', decided_by = me, decided_at = now()
  where target_type = r.target_type and target_id = r.target_id and status = 'open';
end;
$$;

create function private.apply_penalty(who uuid, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  email text;
begin
  insert into public.account_restrictions (user_id) values (who) on conflict do nothing;
  if decision = 'warn' then
    update public.account_restrictions set warnings = warnings + 1 where user_id = who;
  elsif decision = 'suspend_7' then
    update public.account_restrictions
    set suspended_until = greatest(coalesce(suspended_until, now()), now() + interval '7 days')
    where user_id = who;
  elsif decision = 'suspend_30' then
    update public.account_restrictions
    set suspended_until = greatest(coalesce(suspended_until, now()), now() + interval '30 days')
    where user_id = who;
  elsif decision = 'ban' then
    update public.account_restrictions set banned = true where user_id = who;
    select d.email into email from public.account_details d where d.user_id = who;
    if email is not null then
      insert into public.banned_emails (email) values (email) on conflict do nothing;
    end if;
  end if;
end;
$$;

-- People whose commenting was paused by repeated blocked attempts.
create function public.pause_queue()
returns table (username text, attempts jsonb, paused_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator(auth.uid()) then
    raise exception 'Moderators only';
  end if;
  return query
  select pr.username,
    (select jsonb_agg(jsonb_build_object('category', a.category, 'excerpt', a.excerpt, 'at', a.created_at) order by a.created_at desc)
     from public.blocked_attempts a where a.user_id = q.user_id and a.created_at > q.created_at - interval '1 day'),
    q.created_at
  from public.pause_reviews q
  join public.profiles pr on pr.id = q.user_id
  order by q.created_at;
end;
$$;

-- restore: commenting comes back · restrict: stays off · escalate to a penalty.
create function public.decide_pause(username text, decision text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
begin
  if not private.is_moderator(auth.uid()) then
    raise exception 'Moderators only';
  end if;
  select id into who from public.profiles p where lower(p.username) = lower(decide_pause.username);
  if who is null or not exists (select 1 from public.pause_reviews where user_id = who) then
    raise exception 'Nothing to review';
  end if;

  if decision = 'restore' then
    update public.account_restrictions set comment_paused = false where user_id = who;
  elsif decision in ('suspend_7', 'suspend_30', 'ban') then
    perform private.apply_penalty(who, decision);
  elsif decision <> 'restrict' then
    raise exception 'Unknown decision';
  end if;
  delete from public.pause_reviews where user_id = who;
end;
$$;

-- ---------------------------------------------------------------------------
-- Appeals: one per decision, decided by a different moderator
-- ---------------------------------------------------------------------------

create function public.appeal(report_id uuid, message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.reports r
    where r.id = appeal.report_id and r.target_user_id = auth.uid() and r.status = 'actioned'
  ) then
    raise exception 'Nothing to appeal';
  end if;
  insert into public.appeals (report_id, user_id, message)
  values (appeal.report_id, auth.uid(), btrim(message));
exception when unique_violation then
  raise exception 'You have already appealed this decision';
end;
$$;

create function public.appeal_queue()
returns table (appeal_id uuid, reason text, decision text, message text, author_username text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator(auth.uid()) then
    raise exception 'Moderators only';
  end if;
  return query
  select a.id, r.reason, r.decision, a.message, pr.username, a.created_at
  from public.appeals a
  join public.reports r on r.id = a.report_id
  join public.profiles pr on pr.id = a.user_id
  where a.status = 'open' and r.decided_by is distinct from auth.uid()
  order by a.created_at;
end;
$$;

-- Overturning lifts the suspension or ban (removed content isn't restored).
create function public.decide_appeal(appeal_id uuid, overturn boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.appeals;
  r public.reports;
  email text;
begin
  if not private.is_moderator(auth.uid()) then
    raise exception 'Moderators only';
  end if;
  select * into a from public.appeals where id = appeal_id and status = 'open';
  select * into r from public.reports where id = a.report_id;
  if a.id is null then
    raise exception 'Appeal not found';
  end if;
  if r.decided_by = auth.uid() then
    raise exception 'A different moderator has to review this appeal';
  end if;

  if overturn then
    update public.account_restrictions
    set suspended_until = null,
        banned = false,
        warnings = greatest(warnings - case when r.decision = 'warn' then 1 else 0 end, 0)
    where user_id = a.user_id;
    if r.decision = 'ban' then
      select d.email into email from public.account_details d where d.user_id = a.user_id;
      delete from public.banned_emails where banned_emails.email = email;
    end if;
  end if;
  update public.appeals set status = case when overturn then 'overturned' else 'upheld' end, decided_by = auth.uid()
  where id = a.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function
  public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean),
  public.add_comment(uuid, uuid, text, uuid),
  public.update_profile(uuid, text, text),
  public.record_blocked_attempt(uuid, text, text, text),
  public.my_status(),
  public.my_decisions(),
  public.report_content(text, uuid, text, text),
  public.review_queue(),
  public.decide_report(uuid, text, boolean),
  public.pause_queue(),
  public.decide_pause(text, text),
  public.appeal(uuid, text),
  public.appeal_queue(),
  public.decide_appeal(uuid, boolean),
  private.assert_active(uuid),
  private.is_moderator(uuid),
  private.apply_penalty(uuid, text)
from public, anon, authenticated;

-- Only the screening function (service role) can publish text.
grant execute on function
  public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean),
  public.add_comment(uuid, uuid, text, uuid),
  public.update_profile(uuid, text, text),
  public.record_blocked_attempt(uuid, text, text, text)
to service_role;

grant execute on function
  public.my_status(),
  public.my_decisions(),
  public.report_content(text, uuid, text, text),
  public.review_queue(),
  public.decide_report(uuid, text, boolean),
  public.pause_queue(),
  public.decide_pause(text, text),
  public.appeal(uuid, text),
  public.appeal_queue(),
  public.decide_appeal(uuid, boolean)
to authenticated;

grant execute on function private.assert_active(uuid), private.is_moderator(uuid) to authenticated;
