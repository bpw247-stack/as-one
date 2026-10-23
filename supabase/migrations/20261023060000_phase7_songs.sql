-- As One — Phase 7: song posts.
--
-- Share a song and what it means to you. Nothing plays in the app and no
-- lyrics are shown (they're licensed separately); the post shows the song's
-- title, artist and album art from Apple's catalog, with a link to listen.
-- The server looks the song up itself, so the app can't supply its own
-- "album art".

alter table public.posts drop constraint posts_kind_check;
alter table public.posts add constraint posts_kind_check
  check (kind in ('struggle', 'goal', 'milestone', 'life_event', 'song'));

alter table public.posts
  add column song_id text,
  add column song_title text,
  add column song_artist text,
  add column song_artwork_url text,
  add column song_url text,
  add constraint posts_song_check check ((kind = 'song') = (song_id is not null));

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
    when 'song' then array['song_hits', 'thanks_for_sharing', 'adding_it']
    when 'crisis' then array['not_alone', 'life_matters', 'here_for_you', 'strength']
    else array[]::text[]
  end;
$$;

alter type public.feed_post
  add attribute song_title text,
  add attribute song_artist text,
  add attribute song_artwork_url text,
  add attribute song_url text;

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
    p.is_crisis,
    case when private.can_see_photos(p, viewer)
      then coalesce((select array_agg(ph.path order by ph.position) from public.post_photos ph where ph.post_id = p.id), '{}')
      else '{}'
    end,
    p.song_title,
    p.song_artist,
    p.song_artwork_url,
    p.song_url
  )::public.feed_post
  from public.profiles pr
  where pr.id = p.author_id;
$$;

drop function public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean, boolean);

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
  notify_buddies boolean default false,
  song jsonb default null
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

  if (kind = 'song') <> (song is not null) then
    raise exception 'Song posts need a song';
  end if;

  if anonymous and (to_corner or not to_everyone) then
    raise exception 'Anonymous posts can only be shared with everyone';
  end if;
  if not (to_corner or to_everyone) then
    raise exception 'Choose who can see this post';
  end if;

  insert into public.posts (
    author_id, kind, body, is_anonymous, to_corner, to_everyone, published_at,
    comments_private, follow_up_of, is_crisis, notify_buddies,
    song_id, song_title, song_artist, song_artwork_url, song_url
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
    coalesce(notify_buddies, false) and not anonymous,
    song ->> 'id',
    song ->> 'title',
    song ->> 'artist',
    song ->> 'artwork_url',
    song ->> 'url'
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

revoke execute on function
  public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean, boolean, jsonb)
from public, anon, authenticated;
grant execute on function
  public.create_post(uuid, text, text, boolean, boolean, boolean, boolean, uuid, boolean, boolean, jsonb)
to service_role;
