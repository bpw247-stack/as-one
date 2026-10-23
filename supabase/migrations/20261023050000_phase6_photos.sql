-- As One — Phase 6: photos.
--
-- Photos are for the people you trust: Corner posts only, up to 4, never on
-- anonymous posts and never shown in the Everyone feed (a post shared to both
-- shows its photos in the Corner and is text-only in Everyone). Every photo is
-- screened, and location and camera data are stripped on the server before
-- it's stored.
--
-- Storage layout in the private `post-photos` bucket:
--   pending/<user id>/<file>.jpg   uploaded by the app, read only by the server
--   posts/<post id>/<n>.jpg        published by the server after screening

insert into storage.buckets (id, name, public)
values ('post-photos', 'post-photos', false)
on conflict (id) do nothing;

create table public.post_photos (
  post_id uuid not null references public.posts (id) on delete cascade,
  position int not null check (position between 0 and 3),
  path text not null,
  primary key (post_id, position)
);
alter table public.post_photos enable row level security;
revoke all on public.post_photos from anon, authenticated;

-- Photos are visible to the author and to their Corner — nobody else, even on
-- a post that's also shared with everyone.
create function private.can_see_photos(p public.posts, viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p.author_id = viewer
    or (
      p.to_corner
      and not p.is_anonymous
      and not p.hidden_for_review
      and p.published_at <= now()
      and private.in_corner(viewer, p.author_id)
    );
$$;

create function private.can_see_photo_path(path text, viewer uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  parts text[] := string_to_array(path, '/');
  p public.posts;
begin
  if parts[1] <> 'posts' or array_length(parts, 1) <> 3 then
    return false;
  end if;
  begin
    select * into p from public.posts where id = parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return p.id is not null and private.can_see_photos(p, viewer);
end;
$$;

grant execute on function private.can_see_photos(public.posts, uuid), private.can_see_photo_path(text, uuid)
  to authenticated;

-- The app may only upload into its own pending folder…
create policy "upload pending photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'post-photos'
    and (storage.foldername(name))[1] = 'pending'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

-- …and only read published photos it's allowed to see.
create policy "read photos you can see"
  on storage.objects for select to authenticated
  using (bucket_id = 'post-photos' and private.can_see_photo_path(name, (select auth.uid())));

-- Server only: attach screened, stripped photos to a post.
create function public.attach_photos(actor uuid, post_id uuid, paths text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.posts;
begin
  select * into p from public.posts where id = post_id;
  if p.id is null or p.author_id <> actor then
    raise exception 'Post not found';
  end if;
  if p.is_anonymous or not p.to_corner then
    raise exception 'Photos are for Corner posts only';
  end if;
  if cardinality(paths) > 4 then
    raise exception 'Up to 4 photos per post';
  end if;
  insert into public.post_photos (post_id, position, path)
  select p.id, i - 1, paths[i] from generate_subscripts(paths, 1) i;
end;
$$;

revoke execute on function public.attach_photos(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.attach_photos(uuid, uuid, text[]) to service_role;

alter type public.feed_post add attribute photo_paths text[];

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
    end
  )::public.feed_post
  from public.profiles pr
  where pr.id = p.author_id;
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
  k int;
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

  -- The Everyone feed is text only: photos are for the Corner.
  for k in 1 .. coalesce(cardinality(result), 0) loop
    result[k].photo_paths := '{}';
  end loop;

  insert into public.anonymous_post_views (viewer_id, post_id)
  select me, r.id from unnest(result) r where r.is_anonymous and not r.is_mine
  on conflict do nothing;

  return query select * from unnest(result);
end;
$$;
