// Phase 7: song posts.
//
//   npm run test:db

import assert from 'node:assert/strict';
import { before, test } from 'node:test';

import { adult, as, publishPost, setupDb, signUp } from './helpers.mjs';

before(setupDb);

const SONG = {
  id: '1440818839',
  title: 'Lean on Me',
  artist: 'Bill Withers',
  artwork_url: 'https://is1-ssl.mzstatic.com/image/thumb/x/600x600bb.jpg',
  url: 'https://music.apple.com/us/album/lean-on-me/1440818584?i=1440818839',
};

test('a song post carries the song, and gets song reactions', async () => {
  const a = await signUp(adult('songwriter'));
  const b = await signUp(adult('listener'));
  const id = await publishPost(a, { kind: 'song', body: 'This got me through my first month sober.', corner: false, everyone: true, song: SONG });
  const [row] = await as(b, 'select * from get_post($1)', [id]);
  assert.equal(row.song_title, 'Lean on Me');
  assert.equal(row.song_artist, 'Bill Withers');
  assert.equal(row.song_url, SONG.url);
  const feed = await as(b, 'select song_artwork_url from everyone_feed(0, 50) where id = $1', [id]);
  assert.equal(feed[0].song_artwork_url, SONG.artwork_url, 'album art is allowed in the Everyone feed');

  await as(b, 'select react($1, $2, true)', [id, 'song_hits']);
  await assert.rejects(as(b, 'select react($1, $2, true)', [id, 'support']), /isn't available/);
});

test('song posts need a song, and only song posts have one', async () => {
  const a = await signUp(adult('songless'));
  await assert.rejects(publishPost(a, { kind: 'song' }), /need a song/);
  await assert.rejects(publishPost(a, { kind: 'struggle', song: SONG }), /need a song/);
});
