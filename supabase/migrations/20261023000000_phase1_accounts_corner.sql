-- As One — Phase 1: accounts, profiles, Corner, block.
--
-- Privacy rules live here, not in the app: row-level security decides what each
-- user can read, and every relationship change goes through a security-definer
-- function so the rules can't be skipped by calling the API directly.

-- Helpers used by policies live in a schema the API doesn't expose, so nobody
-- can call them directly to probe who blocked whom.
create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- Public profile. Anything here can be read by any signed-in user who hasn't
-- blocked (or been blocked by) the owner, so nothing private belongs here.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null
    check (username ~ '^[A-Za-z0-9_]{3,20}$'),
  display_name text not null
    check (char_length(btrim(display_name)) between 1 and 40),
  bio text not null default ''
    check (char_length(bio) <= 160),
  created_at timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

-- Private account details, readable only by the owner.
create table public.account_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  birth_date date not null
);

-- A pending Corner request. Requests carry no message: strangers never get a
-- free-text box.
create table public.corner_requests (
  from_user uuid not null references public.profiles (id) on delete cascade,
  to_user uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user),
  check (from_user <> to_user)
);

-- A mutual Corner connection, stored once per pair (user_a < user_b).
create table public.corners (
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index corners_user_b_idx on public.corners (user_b);

create table public.blocks (
  blocker uuid not null references public.profiles (id) on delete cascade,
  blocked uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index blocks_blocked_idx on public.blocks (blocked);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function private.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker = a and blocked = b) or (blocker = b and blocked = a)
  );
$$;

create function private.in_corner(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.corners
    where user_a = least(a, b) and user_b = greatest(a, b)
  );
$$;

-- ---------------------------------------------------------------------------
-- Signup: create the profile and enforce 18+
-- ---------------------------------------------------------------------------

-- Runs inside the signup transaction, so raising here rejects the signup.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  dob date;
begin
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

  insert into public.account_details (user_id, birth_date)
  values (new.id, dob);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.account_details enable row level security;
alter table public.corner_requests enable row level security;
alter table public.corners enable row level security;
alter table public.blocks enable row level security;

-- Blocked in either direction means the profile doesn't exist to you.
create policy "profiles visible unless blocked"
  on public.profiles for select to authenticated
  using (not private.is_blocked_between((select auth.uid()), id));

create policy "edit own profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "read own account details"
  on public.account_details for select to authenticated
  using (user_id = (select auth.uid()));

create policy "see requests you sent or received"
  on public.corner_requests for select to authenticated
  using ((select auth.uid()) in (from_user, to_user));

-- Only the two people in a Corner can see it, so Corner size stays private.
create policy "see your own corner"
  on public.corners for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));

-- You can see who you blocked, never who blocked you.
create policy "see who you blocked"
  on public.blocks for select to authenticated
  using (blocker = (select auth.uid()));

-- All writes besides profile edits go through the functions below.
revoke all on public.profiles, public.account_details, public.corner_requests,
  public.corners, public.blocks from anon;
revoke insert, update, delete on public.account_details, public.corner_requests,
  public.corners, public.blocks from authenticated;
revoke insert, delete on public.profiles from authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name, bio) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- Corner actions
-- ---------------------------------------------------------------------------

-- Returns 'sent', 'connected' (they had already asked you) or 'already_connected'.
-- A blocked user looks exactly like a username that doesn't exist.
create function public.send_corner_request(target_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  target uuid;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  select id into target from public.profiles
  where lower(username) = lower(btrim(target_username));

  if target is null or private.is_blocked_between(me, target) then
    raise exception 'No one with that username';
  end if;
  if target = me then
    raise exception 'You can''t add yourself';
  end if;
  if private.in_corner(me, target) then
    return 'already_connected';
  end if;

  if exists (select 1 from public.corner_requests where from_user = target and to_user = me) then
    delete from public.corner_requests where from_user = target and to_user = me;
    insert into public.corners (user_a, user_b) values (least(me, target), greatest(me, target));
    return 'connected';
  end if;

  insert into public.corner_requests (from_user, to_user) values (me, target)
  on conflict do nothing;
  return 'sent';
end;
$$;

create function public.respond_corner_request(requester uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  delete from public.corner_requests where from_user = requester and to_user = me;
  if not found then
    raise exception 'That request no longer exists';
  end if;

  if accept and not private.is_blocked_between(me, requester) then
    insert into public.corners (user_a, user_b)
    values (least(me, requester), greatest(me, requester))
    on conflict do nothing;
  end if;
end;
$$;

create function public.cancel_corner_request(target uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.corner_requests where from_user = auth.uid() and to_user = target;
$$;

-- Ends the connection for both people.
create function public.remove_from_corner(other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.corners
  where user_a = least(auth.uid(), other) and user_b = greatest(auth.uid(), other);
$$;

-- Cuts off all contact: removes the Corner connection and any pending requests.
-- The blocked person is never told.
create function public.block_user(other uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if other = me then
    raise exception 'You can''t block yourself';
  end if;

  insert into public.blocks (blocker, blocked) values (me, other) on conflict do nothing;
  delete from public.corners where user_a = least(me, other) and user_b = greatest(me, other);
  delete from public.corner_requests
  where (from_user = me and to_user = other) or (from_user = other and to_user = me);
end;
$$;

create function public.unblock_user(other uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.blocks where blocker = auth.uid() and blocked = other;
$$;

-- The people you blocked, with names, so you know who you're unblocking.
-- (Profiles are otherwise hidden in both directions once blocked.)
create function public.my_blocked()
returns table (id uuid, username text, display_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username, p.display_name
  from public.blocks b
  join public.profiles p on p.id = b.blocked
  where b.blocker = auth.uid()
  order by b.created_at desc;
$$;

-- Deletes the account and, through cascades, everything that belongs to it.
create function public.delete_account()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from auth.users where id = auth.uid();
$$;

revoke execute on function
  public.send_corner_request(text),
  public.respond_corner_request(uuid, boolean),
  public.cancel_corner_request(uuid),
  public.remove_from_corner(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.my_blocked(),
  public.delete_account(),
  public.handle_new_user()
from public, anon;

revoke execute on function
  private.is_blocked_between(uuid, uuid),
  private.in_corner(uuid, uuid)
from public, anon;
grant execute on function
  private.is_blocked_between(uuid, uuid),
  private.in_corner(uuid, uuid)
to authenticated;

grant execute on function
  public.send_corner_request(text),
  public.respond_corner_request(uuid, boolean),
  public.cancel_corner_request(uuid),
  public.remove_from_corner(uuid),
  public.block_user(uuid),
  public.unblock_user(uuid),
  public.my_blocked(),
  public.delete_account()
to authenticated;
