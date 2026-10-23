-- As One — Phase 5: buddies and push notifications.
--
-- Buddies are the closest people inside your Corner: mutual, opt-in, at most
-- 10. They can be pinged when you post (your choice per post), and they're the
-- ones told when you might need extra support.
--
-- Push notifications go out only for: a buddy posting (when they chose to
-- notify), a buddy who might need support, a goal you supported being
-- accomplished, and the private next-day check-in after a crisis post.
-- Everything else stays in the Activity tab. Notifications are queued here and
-- sent by the send-notifications edge function.

-- ---------------------------------------------------------------------------
-- Buddies
-- ---------------------------------------------------------------------------

create table public.buddies (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index buddies_user_b_idx on public.buddies (user_b);

create table public.buddy_requests (
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);

alter table public.buddies enable row level security;
alter table public.buddy_requests enable row level security;
revoke all on public.buddies, public.buddy_requests from anon, authenticated;

create function private.are_buddies(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.buddies where user_a = least(a, b) and user_b = greatest(a, b)
  );
$$;

create function private.buddy_ids(who uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when user_a = who then user_b else user_a end
  from public.buddies where who in (user_a, user_b);
$$;

-- Leaving someone's Corner (or blocking them) ends being buddies too.
create function private.end_buddies_with_corner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.buddies where user_a = old.user_a and user_b = old.user_b;
  delete from public.buddy_requests
  where (from_user = old.user_a and to_user = old.user_b)
     or (from_user = old.user_b and to_user = old.user_a);
  return old;
end;
$$;

create trigger corners_end_buddies
  after delete on public.corners
  for each row execute function private.end_buddies_with_corner();

create function public.send_buddy_request(other uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  perform private.assert_active(me);
  if not private.in_corner(me, other) then
    raise exception 'Buddies have to be in each other''s Corner first';
  end if;
  if private.are_buddies(me, other) then
    return 'already_buddies';
  end if;
  if (select count(*) from private.buddy_ids(me)) >= 10 then
    raise exception 'You already have 10 buddies';
  end if;

  if exists (select 1 from public.buddy_requests where from_user = other and to_user = me) then
    if (select count(*) from private.buddy_ids(other)) >= 10 then
      raise exception 'They can''t add more buddies right now';
    end if;
    delete from public.buddy_requests where from_user = other and to_user = me;
    insert into public.buddies (user_a, user_b) values (least(me, other), greatest(me, other));
    return 'connected';
  end if;

  insert into public.buddy_requests (from_user, to_user) values (me, other) on conflict do nothing;
  return 'sent';
end;
$$;

create function public.respond_buddy_request(requester uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  delete from public.buddy_requests where from_user = requester and to_user = me;
  if not found then
    raise exception 'That request no longer exists';
  end if;
  if not accept then
    return;
  end if;
  if not private.in_corner(me, requester) then
    raise exception 'Buddies have to be in each other''s Corner first';
  end if;
  if (select count(*) from private.buddy_ids(me)) >= 10 then
    raise exception 'You already have 10 buddies';
  end if;
  if (select count(*) from private.buddy_ids(requester)) >= 10 then
    raise exception 'They can''t add more buddies right now';
  end if;
  insert into public.buddies (user_a, user_b)
  values (least(me, requester), greatest(me, requester))
  on conflict do nothing;
end;
$$;

create function public.cancel_buddy_request(target uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.buddy_requests where from_user = auth.uid() and to_user = target;
$$;

create function public.remove_buddy(other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.buddies
  where user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other);
$$;

create function public.my_buddies()
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name
  from private.buddy_ids(auth.uid()) b(id)
  join public.profiles p on p.id = b.id
  order by p.display_name;
$$;

create function public.my_buddy_requests()
returns table (id uuid, username text, display_name text, incoming boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name, r.to_user = auth.uid()
  from public.buddy_requests r
  join public.profiles p on p.id = case when r.to_user = auth.uid() then r.from_user else r.to_user end
  where auth.uid() in (r.from_user, r.to_user)
  order by r.created_at desc;
$$;

-- 'buddies' | 'request_sent' | 'request_received' | 'none'
create function public.buddy_status(other uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.are_buddies(auth.uid(), other) then 'buddies'
    when exists (select 1 from public.buddy_requests where from_user = auth.uid() and to_user = other) then 'request_sent'
    when exists (select 1 from public.buddy_requests where from_user = other and to_user = auth.uid()) then 'request_received'
    else 'none'
  end;
$$;

-- People in my Corner I support a lot, and who support me, in the last 30
-- days — suggested as buddies. Named interactions only; anonymous posts and
-- reactions where someone hid their name never count.
create function public.buddy_suggestions()
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select auth.uid() as id),
  corner as (
    select case when c.user_a = (select id from me) then c.user_b else c.user_a end as other
    from public.corners c where (select id from me) in (c.user_a, c.user_b)
  ),
  interactions as (
    select r.reactor_id as other, p.author_id as target from public.reactions r
    join public.posts p on p.id = r.post_id
    where r.created_at > now() - interval '30 days' and r.show_name and not p.is_anonymous
    union all
    select c.author_id, p.author_id from public.comments c
    join public.posts p on p.id = c.post_id
    where c.created_at > now() - interval '30 days'
  ),
  scores as (
    select corner.other, count(*) as score
    from corner
    join interactions i
      on (i.other = corner.other and i.target = (select id from me))
      or (i.other = (select id from me) and i.target = corner.other)
    group by corner.other
    -- Both directions: they support me and I support them.
    having bool_or(i.other = corner.other) and bool_or(i.other = (select id from me))
  )
  select p.id, p.username, p.display_name
  from scores s
  join public.profiles p on p.id = s.other
  where s.score >= 3
    and not private.are_buddies((select id from me), s.other)
    and not exists (
      select 1 from public.buddy_requests r
      where (r.from_user = (select id from me) and r.to_user = s.other)
         or (r.from_user = s.other and r.to_user = (select id from me))
    )
  order by s.score desc
  limit 3;
$$;

-- ---------------------------------------------------------------------------
-- Push tokens and the notification queue
-- ---------------------------------------------------------------------------

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index push_tokens_user_idx on public.push_tokens (user_id);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('buddy_post', 'buddy_support', 'goal_accomplished', 'checkin')),
  title text not null,
  body text not null,
  data jsonb not null default '{}',
  -- Anonymous posts go live after a delay; their notifications wait too.
  send_after timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_due_idx on public.notifications (send_after) where sent_at is null;

alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;
revoke all on public.push_tokens, public.notifications from anon, authenticated;

alter table public.posts add column notify_buddies boolean not null default false;
alter table public.account_details add column crisis_checkin_at timestamptz;

create function public.register_push_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.push_tokens (token, user_id) values (token, auth.uid())
  on conflict on constraint push_tokens_pkey do update set user_id = excluded.user_id;
$$;

create function public.unregister_push_token(token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t where t.token = unregister_push_token.token and t.user_id = auth.uid();
$$;

-- Queues the pushes a new post calls for.
create function private.queue_post_notifications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  author_name text;
  original public.posts;
  excerpt text := left(new.body, 120);
begin
  select display_name into author_name from public.profiles where id = new.author_id;

  if not new.is_anonymous and new.is_crisis then
    -- Never for anonymous posts: it would point buddies at the author.
    insert into public.notifications (user_id, kind, title, body, data, send_after)
    select b, 'buddy_support',
      author_name || ' might need extra support today',
      'Reaching out — even a short message — can mean a lot.',
      jsonb_build_object('post_id', new.id),
      new.published_at
    from private.buddy_ids(new.author_id) b
    where private.in_corner(b, new.author_id);
  elsif not new.is_anonymous and new.notify_buddies then
    insert into public.notifications (user_id, kind, title, body, data, send_after)
    select b, 'buddy_post',
      author_name || ' shared something with you',
      excerpt,
      jsonb_build_object('post_id', new.id),
      new.published_at
    from private.buddy_ids(new.author_id) b
    where private.in_corner(b, new.author_id) or new.to_everyone;
  end if;

  if new.follow_up_of is not null and new.kind = 'milestone' then
    select * into original from public.posts where id = new.follow_up_of;
    insert into public.notifications (user_id, kind, title, body, data, send_after)
    select s.supporter, 'goal_accomplished',
      case when new.is_anonymous then 'A goal you supported was accomplished'
        else author_name || ' did it!' end,
      excerpt,
      jsonb_build_object('post_id', new.id),
      new.published_at
    from (
      select reactor_id as supporter from public.reactions where post_id = original.id
      union
      select author_id from public.comments where post_id = original.id
    ) s
    where s.supporter <> new.author_id
      and not private.is_blocked_between(s.supporter, new.author_id);
  end if;

  return new;
end;
$$;

create trigger posts_queue_notifications
  after insert on public.posts
  for each row execute function private.queue_post_notifications();

-- Server only: queue the private next-day check-ins that are due.
create function public.queue_due_checkins()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  queued int;
begin
  with due as (
    update public.account_details
    set crisis_checkin_at = null
    where crisis_checkin_at <= now()
    returning user_id
  )
  insert into public.notifications (user_id, kind, title, body, data)
  select user_id, 'checkin', 'Thinking of you today',
    'Support is always here — free and confidential. Tap to reach someone.',
    jsonb_build_object('screen', 'support')
  from due;
  get diagnostics queued = row_count;
  return queued;
end;
$$;

-- Server only: claims a batch of due notifications (marking them sent) and
-- returns each with the recipient's devices.
create function public.claim_notifications(batch int default 100)
returns table (id bigint, title text, body text, data jsonb, tokens text[])
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.notifications n
    set sent_at = now()
    where n.id in (
      select id from public.notifications
      where sent_at is null and send_after <= now()
      order by send_after
      limit least(batch, 500)
      for update skip locked
    )
    returning n.id, n.user_id, n.title, n.body, n.data
  )
  select c.id, c.title, c.body, c.data,
    coalesce((select array_agg(t.token) from public.push_tokens t where t.user_id = c.user_id), '{}')
  from claimed c;
$$;

-- Server only: forget devices Expo says are gone.
create function public.forget_push_tokens(tokens text[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens where token = any (tokens);
$$;

-- ---------------------------------------------------------------------------
-- Posting gains "notify my buddies" (replaces the Phase 4 version)
-- ---------------------------------------------------------------------------

drop function public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean);

create function public.create_post(
  actor uuid,
  kind text,
  body text,
  anonymous boolean,
  to_corner boolean,
  to_everyone boolean,
  comments_private boolean default false,
  follow_up_of uuid default null,
  crisis boolean default false,
  notify_buddies boolean default false
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
    comments_private, follow_up_of, is_crisis, notify_buddies
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
    coalesce(crisis, false),
    coalesce(notify_buddies, false) and not anonymous
  )
  returning id into new_id;

  if crisis then
    -- Keep the helpline in front of them for 48 hours.
    update public.account_details
    set crisis_support_until = now() + interval '48 hours',
        crisis_checkin_at = now() + interval '24 hours'
    where user_id = me;
  end if;

  return new_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke execute on function
  public.send_buddy_request(uuid),
  public.respond_buddy_request(uuid, boolean),
  public.cancel_buddy_request(uuid),
  public.remove_buddy(uuid),
  public.my_buddies(),
  public.my_buddy_requests(),
  public.buddy_status(uuid),
  public.buddy_suggestions(),
  public.register_push_token(text),
  public.unregister_push_token(text),
  public.queue_due_checkins(),
  public.claim_notifications(int),
  public.forget_push_tokens(text[]),
  public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean, boolean),
  private.are_buddies(uuid, uuid),
  private.buddy_ids(uuid)
from public, anon, authenticated;

grant execute on function
  public.send_buddy_request(uuid),
  public.respond_buddy_request(uuid, boolean),
  public.cancel_buddy_request(uuid),
  public.remove_buddy(uuid),
  public.my_buddies(),
  public.my_buddy_requests(),
  public.buddy_status(uuid),
  public.buddy_suggestions(),
  public.register_push_token(text),
  public.unregister_push_token(text)
to authenticated;

grant execute on function
  public.queue_due_checkins(),
  public.claim_notifications(int),
  public.forget_push_tokens(text[]),
  public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean, boolean)
to service_role;
