// Phase 2: posting and feeds, with anonymity as the thing that must never break.
//
//   npm run test:db

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { adult, as, connect, db, publishPost, setupDb, signUp } from './helpers.mjs';

before(setupDb);

const post = publishPost;

// Anonymous posts wait out a random delay; tests skip it.
async function publishNow(postId, minutesAgo = 0) {
  await db.query(
    `update posts set published_at = now() - make_interval(mins => $2) where id = $1`,
    [postId, minutesAgo],
  );
}

const cornerFeed = (u) => as(u, 'select * from corner_feed()');
const everyoneFeed = (u, offset = 0, size = 20) =>
  as(u, 'select * from everyone_feed($1, $2)', [offset, size]);
const ids = (rows) => rows.map((r) => r.id);

describe('creating posts', () => {
  test('anonymous posts can only go to everyone', async () => {
    const a = await signUp(adult('anon_rules'));
    await assert.rejects(post(a, { anonymous: true, corner: true, everyone: true }), /only be shared with everyone/);
    await assert.rejects(post(a, { anonymous: true, corner: true, everyone: false }), /only be shared with everyone/);
    await post(a, { anonymous: true, corner: false, everyone: true });
  });

  test('a post needs an audience, a known kind and some text', async () => {
    const a = await signUp(adult('post_rules'));
    await assert.rejects(post(a, { corner: false, everyone: false }), /Choose who can see/);
    await assert.rejects(post(a, { kind: 'rant' }));
    await assert.rejects(post(a, { body: '   ' }));
    await assert.rejects(post(a, { body: 'x'.repeat(2001) }));
  });

  test('nobody can read or write the posts table directly, or skip screening', async () => {
    const a = await signUp(adult('direct_access'));
    await post(a);
    await assert.rejects(as(a, 'select * from posts'));
    await assert.rejects(as(a, `select create_post($1, 'goal', 'x', false, true, false)`, [a]));
    await assert.rejects(
      as(a, `insert into posts (author_id, kind, body, to_corner, to_everyone) values ($1, 'goal', 'x', true, false)`, [a]),
    );
  });

  test('anonymous posts go live after a 1–10 minute delay', async () => {
    const a = await signUp(adult('delayed'));
    const b = await signUp(adult('delay_viewer'));
    const id = await post(a, { anonymous: true, corner: false, everyone: true });
    const {
      rows: [{ delay }],
    } = await db.query(`select extract(epoch from published_at - created_at) as delay from posts where id = $1`, [id]);
    assert.ok(delay >= 60 && delay <= 600, `delay was ${delay}s`);
    assert.ok(!ids(await everyoneFeed(b)).includes(id), 'not visible before the delay');
    assert.ok(ids(await as(a, 'select * from my_posts()')).includes(id), 'author sees it in their own posts');
  });

  test('authors can delete their own posts only', async () => {
    const a = await signUp(adult('deleter'));
    const b = await signUp(adult('not_deleter'));
    const id = await post(a);
    await assert.rejects(as(b, 'select delete_post($1)', [id]), /not found/);
    await as(a, 'select delete_post($1)', [id]);
    assert.equal((await as(a, 'select * from my_posts()')).length, 0);
  });
});

describe('corner feed', () => {
  test('shows Corner posts from people in your Corner and nobody else', async () => {
    const a = await signUp(adult('cf_author'));
    const friend = await signUp(adult('cf_friend'));
    const stranger = await signUp(adult('cf_stranger'));
    await connect(a, friend, 'cf_friend');

    const cornerPost = await post(a, { corner: true, everyone: false });
    const publicPost = await post(a, { corner: false, everyone: true });

    const friendFeed = ids(await cornerFeed(friend));
    assert.ok(friendFeed.includes(cornerPost));
    assert.ok(!friendFeed.includes(publicPost), 'public-only posts are not in the Corner tab');
    assert.equal((await cornerFeed(stranger)).length, 0);
    assert.ok(ids(await cornerFeed(a)).includes(cornerPost), 'you see your own Corner posts');
  });

  test('anonymous posts never appear in the Corner tab', async () => {
    const a = await signUp(adult('cf_anon'));
    const friend = await signUp(adult('cf_anon_friend'));
    await connect(a, friend, 'cf_anon_friend');
    const id = await post(a, { anonymous: true, corner: false, everyone: true });
    await publishNow(id);
    assert.ok(!ids(await cornerFeed(friend)).includes(id));
  });

  test('removing someone from your Corner removes their posts from your feed', async () => {
    const a = await signUp(adult('cf_removed'));
    const b = await signUp(adult('cf_remover'));
    await connect(a, b, 'cf_remover');
    const id = await post(a);
    await as(b, 'select remove_from_corner($1)', [a]);
    assert.ok(!ids(await cornerFeed(b)).includes(id));
  });
});

describe('everyone feed', () => {
  test('shows public named posts with their author; Corner-only posts stay out', async () => {
    const a = await signUp(adult('ef_author'));
    const b = await signUp(adult('ef_viewer'));
    const pub = await post(a, { corner: false, everyone: true, body: 'public' });
    const both = await post(a, { corner: true, everyone: true, body: 'both' });
    const cornerOnly = await post(a, { corner: true, everyone: false, body: 'corner only' });

    const feed = await everyoneFeed(b, 0, 50);
    const byId = Object.fromEntries(feed.map((r) => [r.id, r]));
    assert.equal(byId[pub].author_username, 'ef_author');
    assert.ok(byId[both]);
    assert.ok(!byId[cornerOnly]);
  });

  test('blocked people never see each other’s posts, named or anonymous', async () => {
    const a = await signUp(adult('ef_blocker'));
    const b = await signUp(adult('ef_blocked'));
    const named = await post(a, { corner: false, everyone: true });
    const anonymous = await post(a, { anonymous: true, corner: false, everyone: true });
    await publishNow(anonymous);
    await as(a, 'select block_user($1)', [b]);

    const feed = ids(await everyoneFeed(b, 0, 50));
    assert.ok(!feed.includes(named));
    assert.ok(!feed.includes(anonymous));
    assert.equal((await as(b, 'select * from profile_posts($1)', ['ef_blocker'])).length, 0);
  });

  test('pages by offset without repeating posts', async () => {
    const a = await signUp(adult('ef_pager'));
    const b = await signUp(adult('ef_pager_viewer'));
    for (let i = 0; i < 5; i++) await post(a, { corner: false, everyone: true, body: `p${i}` });
    const first = ids(await everyoneFeed(b, 0, 3));
    const second = ids(await everyoneFeed(b, 3, 3));
    assert.equal(first.length, 3);
    assert.equal(new Set([...first, ...second]).size, first.length + second.length);
  });
});

describe('anonymity', () => {
  const PRIVATE_FIELDS = ['author_username', 'author_display_name'];

  test('no feed ever reveals who wrote an anonymous post', async () => {
    const author = await signUp(adult('secret_author'));
    const friend = await signUp(adult('secret_friend'));
    const stranger = await signUp(adult('secret_stranger'));
    await connect(author, friend, 'secret_friend');
    const id = await post(author, { anonymous: true, corner: false, everyone: true, body: 'it was me' });
    await publishNow(id, 7);

    for (const viewer of [friend, stranger]) {
      const rows = [
        ...(await everyoneFeed(viewer, 0, 50)),
        ...(await as(viewer, 'select * from corner_feed()')),
        ...(await as(viewer, 'select * from profile_posts($1)', ['secret_author'])),
      ].filter((r) => r.id === id);
      assert.ok(rows.length >= 1, 'the anonymous post is visible');
      for (const row of rows) {
        for (const field of PRIVATE_FIELDS) assert.equal(row[field], null, `${field} leaked`);
        assert.equal(row.is_mine, false);
        assert.equal(JSON.stringify(row).includes(author), false, 'author id leaked');
        assert.equal(JSON.stringify(row).includes('secret_author'), false, 'username leaked');
        assert.equal(new Date(row.published_at).getUTCMinutes(), 0, 'time is rounded to the hour');
      }
    }
  });

  test('the author recognizes their own anonymous post', async () => {
    const author = await signUp(adult('own_anon'));
    const id = await post(author, { anonymous: true, corner: false, everyone: true });
    await publishNow(id);
    const [row] = (await everyoneFeed(author, 0, 50)).filter((r) => r.id === id);
    assert.equal(row.is_mine, true);
    assert.equal(row.author_username, null);
  });

  test('anonymous posts never show on the author’s profile', async () => {
    const author = await signUp(adult('anon_profile'));
    const viewer = await signUp(adult('anon_profile_viewer'));
    const id = await post(author, { anonymous: true, corner: false, everyone: true });
    await publishNow(id);
    assert.ok(!ids(await as(viewer, 'select * from profile_posts($1)', ['anon_profile'])).includes(id));
    assert.ok(!ids(await as(author, 'select * from profile_posts($1)', ['anon_profile'])).includes(id));
  });
});

describe('corner guarantee for anonymous posts', () => {
  test('a buried anonymous post from your Corner still reaches you, once', async () => {
    const author = await signUp(adult('buried_author'));
    const friend = await signUp(adult('buried_friend'));
    const crowd = await signUp(adult('buried_crowd'));
    await connect(author, friend, 'buried_friend');

    const secret = await post(author, { anonymous: true, corner: false, everyone: true, body: 'from your corner' });
    await publishNow(secret, 120);
    // Decoys available, plus enough newer posts to push the secret off page one.
    for (let i = 0; i < 3; i++) {
      await publishNow(await post(crowd, { anonymous: true, corner: false, everyone: true, body: `decoy ${i}` }), 200 + i);
    }
    for (let i = 0; i < 25; i++) await post(crowd, { corner: false, everyone: true, body: `newer ${i}` });

    const firstPage = await everyoneFeed(friend, 0, 20);
    assert.ok(ids(firstPage).includes(secret), 'guaranteed to appear on the first page');

    const resurfacedAnon = firstPage.filter((r) => r.is_anonymous);
    assert.ok(resurfacedAnon.length >= 3, 'mixed in with at least two decoys');
    const row = firstPage.find((r) => r.id === secret);
    assert.equal(row.author_username, null);

    const again = await everyoneFeed(friend, 0, 20);
    assert.ok(!ids(again).includes(secret), 'not forced in a second time');
  });

  test('people outside the Corner get no special treatment', async () => {
    const author = await signUp(adult('noguar_author'));
    const stranger = await signUp(adult('noguar_stranger'));
    const crowd = await signUp(adult('noguar_crowd'));
    const secret = await post(author, { anonymous: true, corner: false, everyone: true });
    await publishNow(secret, 180);
    for (let i = 0; i < 25; i++) await post(crowd, { corner: false, everyone: true });
    // With no Corner posts to deliver, there's nothing to resurface.
    const firstPage = await everyoneFeed(stranger, 0, 20);
    assert.ok(firstPage.every((r) => !r.is_anonymous || r.is_mine === false));
    assert.equal(firstPage.length, 20);
  });
});
