// Song search and lookup through Apple's iTunes Search API (free, no key).
// Only metadata: no audio is played and no lyrics are shown in As One.

export type Song = {
  id: string;
  title: string;
  artist: string;
  artwork_url: string | null;
  /** Opens the song in Apple Music. */
  url: string;
};

const BASE = 'https://itunes.apple.com';

export function searchUrl(query: string, country = 'US'): string {
  const params = new URLSearchParams({ term: query, media: 'music', entity: 'song', limit: '15', country });
  return `${BASE}/search?${params}`;
}

export function lookupUrl(id: string, country = 'US'): string {
  return `${BASE}/lookup?${new URLSearchParams({ id, country })}`;
}

/** Larger album art: the API returns 100px thumbnails with the size in the URL. */
export function largeArtwork(url: string | undefined): string | null {
  if (!url || !/^https:\/\/[a-z0-9-]+\.mzstatic\.com\//.test(url)) return null;
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/600x600bb.$1');
}

/** Picks the songs out of an API response, dropping anything incomplete. */
export function parseSongs(response: unknown): Song[] {
  const results = (response as { results?: unknown[] })?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((r) => {
    const t = r as Record<string, unknown>;
    if (t.wrapperType !== 'track' || t.kind !== 'song') return [];
    if (typeof t.trackId !== 'number' || typeof t.trackName !== 'string' || typeof t.artistName !== 'string') {
      return [];
    }
    if (typeof t.trackViewUrl !== 'string' || !t.trackViewUrl.startsWith('https://music.apple.com/')) return [];
    return [
      {
        id: String(t.trackId),
        title: t.trackName,
        artist: t.artistName,
        artwork_url: largeArtwork(t.artworkUrl100 as string | undefined),
        url: t.trackViewUrl,
      },
    ];
  });
}

export async function searchSongs(query: string): Promise<Song[]> {
  const res = await fetch(searchUrl(query));
  if (!res.ok) throw new Error(`Song search failed (${res.status})`);
  return parseSongs(await res.json());
}

export async function lookupSong(id: string): Promise<Song | null> {
  if (!/^\d{1,15}$/.test(id)) return null;
  const res = await fetch(lookupUrl(id));
  if (!res.ok) throw new Error(`Song lookup failed (${res.status})`);
  return parseSongs(await res.json())[0] ?? null;
}
