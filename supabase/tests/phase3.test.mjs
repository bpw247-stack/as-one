// Phase 3: reactions, comments, goal follow-ups and Activity.
//
//   npm run test:db

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { adult, as, connect, db, publishComment, publishPost, setupDb, signUp } from './helpers.mjs';

before(setupDb);

async function post(userId, { kind = 'struggle', body = 'hello', anonymous = false, corner = true, everyone = false, commentsPrivate = false, followUpOf = null } = {}) {
  const id = await publishPost(userId, { kind, body, anonymous, corner, everyone, commentsPrivate, followUpOf });
  if (anonymous || followUpOf) await db.query('update posts set published_at = now() where id = $1', [id]);
  return id;
}

const react = (u, postId, reaction, showName = true) =>
  as(u, 'select react($1, $2, $3)', [postId, reaction, showName]);
const comment = publishComment;
const comments = (u, postId) => as(u, 'select * from post_comments($1)', [postId]);
const getPost = (u, postId) => as(u, 'select * from get_post($1)', [postId]).then(([r]) => r);

let n = 0;
// Signs up a fresh set of users for one test, e.g. people({ poster: 'rp' }).
async function people(roles) {
  n += 1;
  const ids = {};
  for (const [role, name] of Object.entries(roles)) ids[role] = await signUp(adult(`${name}${n}`));
  return ids;
}
const uname = (name) => `${name}${n}`;

describe('reactions', () => {
  test('only the preset reactions for that kind of post', async () => {
    const { poster, friend } = await people({ poster: 'rp', friend: 'rf' });
    const goal = await post(poster, { kind: 'goal', everyone: true });
    await react(friend, goal, 'believe');
    await assert.rejects(react(friend, goal, 'support'), /isn't available/);
    await assert.rejects(react(friend, goal, 'lol'), /isn't available/);
  });

  test('strangers can react to public and anonymous posts, but not Corner-only ones', async () => {
    const { poster, stranger } = await people({ poster: 'rs', stranger: 'rx' });
    const pub = await post(poster, { corner: false, everyone: true });
    const anon = await post(poster, { anonymous: true, corner: false, everyone: true });
    const cornerOnly = await post(poster, { corner: true, everyone: false });
    await react(stranger, pub, 'support');
    await react(stranger, anon, 'not_alone');
    await assert.rejects(react(stranger, cornerOnly, 'support'), /not found/);
  });

  test('you can’t react to your own post; blocked people can’t react at all', async () => {
    const { poster, blocked } = await people({ poster: 'ro', blocked: 'rb' });
    const id = await post(poster, { corner: false, everyone: true });
    await assert.rejects(react(poster, id, 'support'), /your own/);
    await as(poster, 'select block_user($1)', [blocked]);
    await assert.rejects(react(blocked, id, 'support'), /not found/);
  });

  test('counts are only for the poster, and names only where the reactor chose to share', async () => {
    const { poster, named, quiet, viewer } = await people({ poster: 'rc', named: 'rn', quiet: 'rq', viewer: 'rv' });
    const id = await post(poster, { corner: false, everyone: true });
    await react(named, id, 'support', true);
    await react(quiet, id, 'strength', false);

    assert.equal((await getPost(poster, id)).reaction_count, 2);
    assert.equal((await getPost(viewer, id)).reaction_count, null, 'no public counts');
    assert.deepEqual((await getPost(named, id)).my_reactions, ['support']);

    const list = await as(poster, 'select * from post_reactions($1)', [id]);
    const byReaction = Object.fromEntries(list.map((r) => [r.reaction, r]));
    assert.equal(byReaction.support.username, uname('rn'));
    assert.equal(byReaction.strength.username, null, 'stays "Someone"');
    assert.equal((await as(viewer, 'select * from post_reactions($1)', [id])).length, 0, 'others get nothing');
  });

  test('unreacting removes it', async () => {
    const { poster, friend } = await people({ poster: 'ru', friend: 'rw' });
    const id = await post(poster, { corner: false, everyone: true });
    await react(friend, id, 'support');
    await as(friend, 'select unreact($1, $2)', [id, 'support']);
    assert.equal((await getPost(poster, id)).reaction_count, 0);
  });
});

describe('comments', () => {
  test('only people in the poster’s Corner can comment', async () => {
    const { poster, friend, stranger } = await people({ poster: 'cp', friend: 'cf', stranger: 'cs' });
    await connect(poster, friend, uname('cf'));
    const id = await post(poster, { corner: true, everyone: true });

    assert.equal((await getPost(friend, id)).can_comment, true);
    assert.equal((await getPost(stranger, id)).can_comment, false);
    await comment(friend, id, 'Proud of you');
    await assert.rejects(comment(stranger, id, 'hey'), /Only people in their Corner/);
  });

  test('anonymous posts take no comments from anyone', async () => {
    const { poster, friend } = await people({ poster: 'ca', friend: 'cb' });
    await connect(poster, friend, uname('cb'));
    const id = await post(poster, { anonymous: true, corner: false, everyone: true });
    assert.equal((await getPost(friend, id)).can_comment, false);
    await assert.rejects(comment(friend, id, 'hi'), /Only people in their Corner/);
  });

  test('flat: only the poster can reply, and only to a top-level comment', async () => {
    const { poster, a, b } = await people({ poster: 'fp', a: 'fa', b: 'fb' });
    await connect(poster, a, uname('fa'));
    await connect(poster, b, uname('fb'));
    const id = await post(poster);
    const c1 = await comment(a, id, 'You got this');
    await assert.rejects(comment(b, id, 'replying to a', c1), /Only the poster can reply/);
    const reply = await comment(poster, id, 'Thank you!', c1);
    await assert.rejects(comment(poster, id, 'nested', reply), /Comment not found/);
  });

  test('public comments are visible to anyone who can see the post', async () => {
    const { poster, friend, stranger } = await people({ poster: 'vp', friend: 'vf', stranger: 'vs' });
    await connect(poster, friend, uname('vf'));
    const id = await post(poster, { corner: false, everyone: true });
    await comment(friend, id, 'So proud');
    assert.equal((await comments(stranger, id)).length, 1);
    assert.equal((await getPost(stranger, id)).comment_count, 1);
  });

  test('"Only I see comments": each commenter sees only their own thread', async () => {
    const { poster, a, b, stranger } = await people({ poster: 'pp', a: 'pa', b: 'pb', stranger: 'ps' });
    await connect(poster, a, uname('pa'));
    await connect(poster, b, uname('pb'));
    const id = await post(poster, { corner: true, everyone: true, commentsPrivate: true });
    const ca = await comment(a, id, 'from a');
    await comment(b, id, 'from b');
    await comment(poster, id, 'reply to a', ca);

    assert.deepEqual((await comments(poster, id)).map((c) => c.body), ['from a', 'from b', 'reply to a']);
    assert.deepEqual((await comments(a, id)).map((c) => c.body), ['from a', 'reply to a']);
    assert.deepEqual((await comments(b, id)).map((c) => c.body), ['from b']);
    assert.equal((await comments(stranger, id)).length, 0);
  });

  test('switching to public later doesn’t expose comments written in private', async () => {
    const { poster, a, b } = await people({ poster: 'sp', a: 'sa', b: 'sb' });
    await connect(poster, a, uname('sa'));
    await connect(poster, b, uname('sb'));
    const id = await post(poster, { commentsPrivate: true });
    await comment(a, id, 'said in private');
    await as(poster, 'select set_comments_private($1, false)', [id]);
    await comment(a, id, 'said in public');
    assert.deepEqual((await comments(b, id)).map((c) => c.body), ['said in public']);
  });

  test('the commenter or the poster can delete a comment; nobody else', async () => {
    const { poster, a, b } = await people({ poster: 'dp', a: 'da', b: 'db' });
    await connect(poster, a, uname('da'));
    await connect(poster, b, uname('db'));
    const id = await post(poster);
    const c1 = await comment(a, id, 'one');
    const c2 = await comment(a, id, 'two');
    await assert.rejects(as(b, 'select delete_comment($1)', [c1]), /not found/);
    await as(a, 'select delete_comment($1)', [c1]);
    await as(poster, 'select delete_comment($1)', [c2]);
    assert.equal((await comments(poster, id)).length, 0);
  });

  test('blocked people’s comments disappear for each other', async () => {
    const { poster, a, b } = await people({ poster: 'bp', a: 'ba', b: 'bb' });
    await connect(poster, a, uname('ba'));
    const id = await post(poster, { corner: false, everyone: true });
    await comment(a, id, 'hello');
    await as(b, 'select block_user($1)', [a]);
    assert.equal((await comments(b, id)).length, 0);
  });
});

describe('goal follow-ups', () => {
  test('inherit the goal’s audience, including anonymity', async () => {
    const { poster } = await people({ poster: 'gp' });
    const goal = await post(poster, { kind: 'goal', anonymous: true, corner: false, everyone: true, body: 'Run a 5k by January' });
    const done = await post(poster, { kind: 'milestone', body: 'I did it!', corner: true, everyone: false, followUpOf: goal });
    const [row] = await db.query('select * from posts where id = $1', [done]).then((r) => r.rows);
    assert.equal(row.is_anonymous, true);
    assert.equal(row.to_corner, false);
    const view = await getPost(poster, done);
    assert.equal(view.follow_up_of, goal);
    assert.equal(view.follow_up_excerpt, 'Run a 5k by January');
  });

  test('only on your own goals', async () => {
    const { poster, other } = await people({ poster: 'go', other: 'gx' });
    const goal = await post(poster, { kind: 'goal', everyone: true });
    const struggle = await post(poster, { kind: 'struggle' });
    await assert.rejects(post(other, { kind: 'milestone', followUpOf: goal }), /your own posts/);
    await assert.rejects(post(poster, { kind: 'milestone', followUpOf: struggle }), /for goals/);
  });

  test('reach everyone who supported the goal through Activity, without unmasking anonymous goals', async () => {
    const { poster, supporter, bystander } = await people({ poster: 'ap', supporter: 'as', bystander: 'ab' });
    const goal = await post(poster, { kind: 'goal', anonymous: true, corner: false, everyone: true });
    await react(supporter, goal, 'believe', false);
    await post(poster, { kind: 'milestone', body: 'Did it', followUpOf: goal });

    const activity = await as(supporter, 'select * from my_activity()');
    const followUp = activity.find((a) => a.kind === 'follow_up');
    assert.ok(followUp, 'supporter is told');
    assert.equal(followUp.actor_username, null, 'still anonymous');
    assert.equal(JSON.stringify(activity).includes(uname('ap')), false);
    assert.equal((await as(bystander, 'select * from my_activity()')).length, 0);
  });
});

describe('activity', () => {
  test('shows reactions and comments on my posts, with "Someone" for quiet reactors', async () => {
    const { poster, friend, quiet } = await people({ poster: 'yp', friend: 'yf', quiet: 'yq' });
    await connect(poster, friend, uname('yf'));
    const id = await post(poster, { corner: true, everyone: true });
    await react(quiet, id, 'support', false);
    const c = await comment(friend, id, 'Here for you');
    await comment(poster, id, 'Means a lot', c);

    const mine = await as(poster, 'select * from my_activity()');
    assert.deepEqual(mine.map((a) => a.kind).sort(), ['comment', 'reaction']);
    assert.equal(mine.find((a) => a.kind === 'reaction').actor_username, null);

    const theirs = await as(friend, 'select * from my_activity()');
    assert.equal(theirs[0].kind, 'reply');
    assert.equal(theirs[0].body, 'Means a lot');
  });
});
