// Song search for song posts, through the `songs` edge function (Apple's
// catalog). Only metadata: nothing plays in As One and no lyrics are shown.

import { Linking } from 'react-native';

import { supabase } from '@/lib/supabase';

export type Song = {
  id: string;
  title: string;
  artist: string;
  artwork_url: string | null;
  url: string;
};

export async function searchSongs(query: string): Promise<Song[]> {
  if (!query.trim()) return [];
  const { data, error } = await supabase.functions.invoke('songs', { body: { query } });
  if (error) throw new Error('Song search is unavailable right now');
  return (data?.songs ?? []) as Song[];
}

export function listenOnAppleMusic(url: string) {
  Linking.openURL(url).catch(() => {});
}

export function findOnSpotify(title: string, artist: string) {
  Linking.openURL(`https://open.spotify.com/search/${encodeURIComponent(`${title} ${artist}`)}`).catch(
    () => {},
  );
}
