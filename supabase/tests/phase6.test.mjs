// Phase 6: photos on Corner posts.
//
//   npm run test:db

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { adult, as, asServer, connect, db, publishPost, setupDb, signUp } from './helpers.mjs';

before(setupDb);

let n = 0;
async function people(roles) {
  n += 1;
  const ids = {};
  for (const [role, name] of Object.entries(roles)) ids[role] = await signUp(adult(`${name}${n}`));
  return ids;
}
const uname = (name) => `${name}${n}`;

async function withPhotos(author, options) {
  const id = await publishPost(author, options);
  const paths = [`posts/${id}/0.jpg`, `posts/${id}/1.jpg`];
  await asServer('select attach_photos($1, $2, $3)', [author, id, paths]);
  for (const name of paths) {
    await db.query(`insert into storage.objects (bucket_id, name) values ('post-photos', $1)`, [name]);
  }
  return { id, paths };
}
const photosIn = (rows, id) => rows.find((r) => r.id === id)?.photo_paths;
const visibleObjects = (u, paths) =>
  as(u, 'select name from storage.objects where name = any($1)', [paths]).then((r) => r.map((o) => o.name));

describe('photos', () => {
  test('the Corner sees them; strangers and the Everyone feed never do', async () => {
    const { author, friend, stranger } = await people({ author: 'pa', friend: 'pf', stranger: 'ps' });
    await connect(author, friend, uname('pf'));
    const { id, paths } = await withPhotos(author, { corner: true, everyone: true });

    assert.deepEqual(photosIn(await as(friend, 'select * from corner_feed()'), id), paths);
    assert.deepEqual(photosIn(await as(friend, 'select * from get_post($1)', [id]), id), paths);
    assert.deepEqual(photosIn(await as(friend, 'select * from everyone_feed(0, 50)'), id), [], 'Everyone tab is text only');
    assert.deepEqual(photosIn(await as(stranger, 'select * from everyone_feed(0, 50)'), id), []);
    assert.deepEqual(photosIn(await as(stranger, 'select * from get_post($1)', [id]), id), []);

    assert.deepEqual(await visibleObjects(friend, paths), paths);
    assert.deepEqual(await visibleObjects(stranger, paths), [], 'storage refuses the files too');
    assert.deepEqual(await visibleObjects(author, paths), paths);
  });

  test('removing someone from the Corner takes their access away', async () => {
    const { author, friend } = await people({ author: 'ra', friend: 'rf' });
    await connect(author, friend, uname('rf'));
    const { paths } = await withPhotos(author, { corner: true });
    await as(author, 'select remove_from_corner($1)', [friend]);
    assert.deepEqual(await visibleObjects(friend, paths), []);
  });

  test('only on named Corner posts, at most 4, and only by the server', async () => {
    const { author } = await people({ author: 'oa' });
    const publicOnly = await publishPost(author, { corner: false, everyone: true });
    const anon = await publishPost(author, { anonymous: true, corner: false, everyone: true });
    const corner = await publishPost(author, { corner: true });
    await assert.rejects(asServer('select attach_photos($1, $2, $3)', [author, publicOnly, ['x']]), /Corner posts only/);
    await assert.rejects(asServer('select attach_photos($1, $2, $3)', [author, anon, ['x']]), /Corner posts only/);
    await assert.rejects(
      asServer('select attach_photos($1, $2, $3)', [author, corner, ['a', 'b', 'c', 'd', 'e']]),
      /Up to 4/,
    );
    await assert.rejects(as(author, 'select attach_photos($1, $2, $3)', [author, corner, ['a']]));
  });

  test('the app can only upload into its own pending folder', async () => {
    const { a, b } = await people({ a: 'ua', b: 'ub' });
    await as(a, `insert into storage.objects (bucket_id, name) values ('post-photos', $1)`, [`pending/${a}/x.jpg`]);
    await assert.rejects(
      as(a, `insert into storage.objects (bucket_id, name) values ('post-photos', $1)`, [`pending/${b}/x.jpg`]),
    );
    await assert.rejects(
      as(a, `insert into storage.objects (bucket_id, name) values ('post-photos', $1)`, [`posts/whatever/0.jpg`]),
    );
    assert.deepEqual(await visibleObjects(b, [`pending/${a}/x.jpg`]), [], 'pending uploads are private');
  });
});
