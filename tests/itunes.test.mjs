import assert from 'node:assert/strict';
import { test } from 'node:test';

import { largeArtwork, lookupUrl, parseSongs, searchUrl } from '../supabase/functions/_shared/itunes.ts';

const track = {
  wrapperType: 'track',
  kind: 'song',
  trackId: 1440818839,
  trackName: 'Lean on Me',
  artistName: 'Bill Withers',
  artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/source/100x100bb.jpg',
  trackViewUrl: 'https://music.apple.com/us/album/lean-on-me/1440818584?i=1440818839&uo=4',
};

test('parses songs and upsizes album art', () => {
  assert.deepEqual(parseSongs({ resultCount: 1, results: [track] }), [
    {
      id: '1440818839',
      title: 'Lean on Me',
      artist: 'Bill Withers',
      artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/Music/v4/ab/cd/source/600x600bb.jpg',
      url: track.trackViewUrl,
    },
  ]);
});

test('drops non-songs, incomplete results and links that are not Apple Music', () => {
  const results = [
    { ...track, kind: 'music-video' },
    { ...track, wrapperType: 'collection' },
    { ...track, trackName: undefined },
    { ...track, trackViewUrl: 'https://evil.example/song' },
  ];
  assert.deepEqual(parseSongs({ results }), []);
  assert.deepEqual(parseSongs(null), []);
  assert.deepEqual(parseSongs({ results: 'nope' }), []);
});

test('album art only from Apple’s image host', () => {
  assert.equal(largeArtwork('https://evil.example/100x100bb.jpg'), null);
  assert.equal(largeArtwork(undefined), null);
});

test('builds search and lookup URLs', () => {
  const search = new URL(searchUrl('lean on me'));
  assert.equal(search.searchParams.get('term'), 'lean on me');
  assert.equal(search.searchParams.get('entity'), 'song');
  assert.equal(new URL(lookupUrl('123')).searchParams.get('id'), '123');
});
