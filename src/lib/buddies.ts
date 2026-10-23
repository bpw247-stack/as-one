// Buddies: the closest people inside your Corner (mutual, at most 10).

import { supabase } from '@/lib/supabase';

export const MAX_BUDDIES = 10;

export type Buddy = { id: string; username: string; display_name: string };
export type BuddyRequest = Buddy & { incoming: boolean };
export type BuddyStatus = 'buddies' | 'request_sent' | 'request_received' | 'none';

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function myBuddies(): Promise<Buddy[]> {
  return check(await supabase.rpc('my_buddies')) ?? [];
}

export async function myBuddyRequests(): Promise<BuddyRequest[]> {
  return check(await supabase.rpc('my_buddy_requests')) ?? [];
}

export async function buddySuggestions(): Promise<Buddy[]> {
  return check(await supabase.rpc('buddy_suggestions')) ?? [];
}

export async function buddyStatus(other: string): Promise<BuddyStatus> {
  return check(await supabase.rpc('buddy_status', { other }));
}

export async function sendBuddyRequest(other: string): Promise<'sent' | 'connected' | 'already_buddies'> {
  return check(await supabase.rpc('send_buddy_request', { other }));
}

export async function respondToBuddyRequest(requester: string, accept: boolean) {
  check(await supabase.rpc('respond_buddy_request', { requester, accept }));
}

export async function cancelBuddyRequest(target: string) {
  check(await supabase.rpc('cancel_buddy_request', { target }));
}

export async function removeBuddy(other: string) {
  check(await supabase.rpc('remove_buddy', { other }));
}
