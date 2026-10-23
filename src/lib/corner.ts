// Data access for profiles, Corner and blocking. Every write is a database
// function, so the privacy rules in the migration always apply.

import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  username: string;
  display_name: string;
  bio: string;
};

export type Relationship = 'self' | 'corner' | 'request_sent' | 'request_received' | 'none';

const PROFILE_COLUMNS = 'id, username, display_name, bio';

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T | null {
  if (error) throw new Error(error.message);
  return data;
}

function list<T>(result: { data: T[] | null; error: { message: string } | null }): T[] {
  return check(result) ?? [];
}

export async function getProfile(id: string): Promise<Profile | null> {
  return check(
    await supabase.from('profiles').select(PROFILE_COLUMNS).eq('id', id).maybeSingle<Profile>(),
  );
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  return check(
    await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .ilike('username', escapeLike(username))
      .maybeSingle<Profile>(),
  );
}

export async function searchProfiles(query: string, myId: string): Promise<Profile[]> {
  const q = query.trim().replace(/^@/, '');
  if (!q) return [];
  return list(
    await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .ilike('username', `${escapeLike(q)}%`)
      .neq('id', myId)
      .order('username')
      .limit(20)
      .returns<Profile[]>(),
  );
}

export async function getRelationship(myId: string, otherId: string): Promise<Relationship> {
  if (myId === otherId) return 'self';
  const [a, b] = [myId, otherId].sort();
  const corner = list(
    await supabase.from('corners').select('user_a').eq('user_a', a).eq('user_b', b),
  );
  if (corner.length) return 'corner';

  const requests = list(
    await supabase
      .from('corner_requests')
      .select('from_user')
      .or(
        `and(from_user.eq.${myId},to_user.eq.${otherId}),and(from_user.eq.${otherId},to_user.eq.${myId})`,
      ),
  );
  if (requests.some((r) => r.from_user === myId)) return 'request_sent';
  if (requests.length) return 'request_received';
  return 'none';
}

/** Everyone in my Corner. Only I can see this list (and its size). */
export async function getCorner(myId: string): Promise<Profile[]> {
  const rows = list(await supabase.from('corners').select('user_a, user_b'));
  const ids = rows.map((r) => (r.user_a === myId ? r.user_b : r.user_a));
  return profilesById(ids);
}

export async function getRequests(myId: string) {
  const rows = list(
    await supabase
      .from('corner_requests')
      .select('from_user, to_user, created_at')
      .order('created_at', { ascending: false }),
  );
  const incomingIds = rows.filter((r) => r.to_user === myId).map((r) => r.from_user);
  const outgoingIds = rows.filter((r) => r.from_user === myId).map((r) => r.to_user);
  const [incoming, outgoing] = await Promise.all([
    profilesById(incomingIds),
    profilesById(outgoingIds),
  ]);
  return { incoming, outgoing };
}

export async function getBlocked(): Promise<Pick<Profile, 'id' | 'username' | 'display_name'>[]> {
  return list(await supabase.rpc('my_blocked'));
}

export async function sendRequest(username: string): Promise<'sent' | 'connected' | 'already_connected'> {
  return check(await supabase.rpc('send_corner_request', { target_username: username }))!;
}

export async function respondToRequest(requester: string, accept: boolean) {
  check(await supabase.rpc('respond_corner_request', { requester, accept }));
}

export async function cancelRequest(target: string) {
  check(await supabase.rpc('cancel_corner_request', { target }));
}

export async function removeFromCorner(other: string) {
  check(await supabase.rpc('remove_from_corner', { other }));
}

export async function blockUser(other: string) {
  check(await supabase.rpc('block_user', { other }));
}

export async function unblockUser(other: string) {
  check(await supabase.rpc('unblock_user', { other }));
}

export async function deleteAccount() {
  check(await supabase.rpc('delete_account'));
  await supabase.auth.signOut();
}

async function profilesById(ids: string[]): Promise<Profile[]> {
  if (!ids.length) return [];
  const rows = list(
    await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', ids).returns<Profile[]>(),
  );
  const order = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

function escapeLike(text: string) {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}
