// Test harness: runs every migration against an in-memory Postgres (PGlite)
// with a minimal stand-in for Supabase's auth schema and roles.

import { PGlite } from '@electric-sql/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  -- Just enough of Supabase Storage for the photo policies.
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean);
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets (id),
    name text,
    owner uuid default nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  );
  create function storage.foldername(name text) returns text[] language sql immutable as $$
    select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
  $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, service_role;
  grant all on storage.objects to authenticated, service_role;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated;
  -- Supabase grants table access broadly and relies on RLS; mirror that.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
`;

export let db;

export async function setupDb() {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(MIGRATIONS, file), 'utf8'));
  }
}

export async function signUp(meta, email = `${meta.username}@example.com`) {
  const { rows } = await db.query(
    'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
    [email, meta],
  );
  return rows[0].id;
}

export function adult(username) {
  return { username, display_name: username, birth_date: '1990-01-01' };
}

// Runs a query as a signed-in user, with RLS and grants applied.
export async function as(userId, sql, params = []) {
  await db.query('begin');
  try {
    await db.query('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    const result = await db.query(sql, params);
    await db.query('commit');
    return result.rows;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

/** Makes two users mutual Corner members. */
export async function connect(a, b, bUsername) {
  await as(a, 'select send_corner_request($1)', [bUsername]);
  await as(b, 'select respond_corner_request($1, true)', [a]);
}

// Runs a query as the server (the screening edge function's service role).
export async function asServer(sql, params = []) {
  await db.query('begin');
  try {
    await db.query('set local role service_role');
    const result = await db.query(sql, params);
    await db.query('commit');
    return result.rows;
  } catch (err) {
    await db.query('rollback');
    throw err;
  }
}

/** Publishes a post the way the screening function does, after it passes. */
export async function publishPost(
  author,
  { kind = 'struggle', body = 'hello', anonymous = false, corner = true, everyone = false, commentsPrivate = false, followUpOf = null, crisis = false, notifyBuddies = false } = {},
) {
  const [{ create_post: id }] = await asServer(
    'select create_post($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)',
    [author, kind, body, anonymous, corner, everyone, commentsPrivate, followUpOf, crisis, notifyBuddies],
  );
  return id;
}

/** Adds a comment the way the screening function does, after it passes. */
export async function publishComment(author, postId, body, replyTo = null) {
  const [{ add_comment: id }] = await asServer('select add_comment($1, $2, $3, $4)', [author, postId, body, replyTo]);
  return id;
}
