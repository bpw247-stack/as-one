// Phase 5: buddies and push notifications.
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

async function buddyUp(a, b) {
  await as(a, 'select send_buddy_request($1)', [b]);
  await as(b, 'select respond_buddy_request($1, true)', [a]);
}
const queued = async (userId) =>
  (await db.query('select kind, title, body, data, send_after from notifications where user_id = $1 order by id', [userId])).rows;

describe('buddies', () => {
  test('must be in each other’s Corner, and both must accept', async () => {
    const { a, b, stranger } = await people({ a: 'ya', b: 'yb', stranger: 'ys' });
    await assert.rejects(as(a, 'select send_buddy_request($1)', [b]), /Corner first/);
    await connect(a, b, uname('yb'));
    const [{ send_buddy_request: s }] = await as(a, 'select send_buddy_request($1)', [b]);
    assert.equal(s, 'sent');
    assert.equal((await as(a, 'select * from my_buddies()')).length, 0);
    await as(b, 'select respond_buddy_request($1, true)', [a]);
    assert.deepEqual((await as(a, 'select username from my_buddies()')).map((r) => r.username), [uname('yb')]);
    assert.equal((await as(stranger, 'select buddy_status($1)', [a]))[0].buddy_status, 'none');
  });

  test('at most 10', async () => {
    const roles = { hub: 'hub' };
    for (let i = 0; i < 11; i++) roles[`f${i}`] = `f${i}x`;
    const ids = await people(roles);
    for (let i = 0; i < 11; i++) await connect(ids.hub, ids[`f${i}`], uname(`f${i}x`));
    for (let i = 0; i < 10; i++) await buddyUp(ids.hub, ids[`f${i}`]);
    await assert.rejects(as(ids.hub, 'select send_buddy_request($1)', [ids.f10]), /10 buddies/);
    await as(ids.f10, 'select send_buddy_request($1)', [ids.hub]);
    await assert.rejects(as(ids.hub, 'select respond_buddy_request($1, true)', [ids.f10]), /10 buddies/);
  });

  test('leaving the Corner or blocking ends being buddies', async () => {
    const { a, b, c } = await people({ a: 'za', b: 'zb', c: 'zc' });
    await connect(a, b, uname('zb'));
    await connect(a, c, uname('zc'));
    await buddyUp(a, b);
    await buddyUp(a, c);
    await as(b, 'select remove_from_corner($1)', [a]);
    await as(c, 'select block_user($1)', [a]);
    assert.equal((await as(a, 'select * from my_buddies()')).length, 0);
  });

  test('suggests people you support back and forth', async () => {
    const { me, close, quiet } = await people({ me: 'sm', close: 'sc', quiet: 'sq' });
    await connect(me, close, uname('sc'));
    await connect(me, quiet, uname('sq'));
    const mine = await publishPost(me, { kind: 'goal' });
    const theirs = await publishPost(close, { kind: 'goal' });
    const theirs2 = await publishPost(close, { kind: 'struggle' });
    await as(close, 'select react($1, $2, true)', [mine, 'believe']);
    await as(close, 'select react($1, $2, true)', [mine, 'got_this']);
    await as(me, 'select react($1, $2, true)', [theirs, 'believe']);
    await as(me, 'select react($1, $2, true)', [theirs2, 'support']);
    await as(quiet, 'select react($1, $2, true)', [mine, 'believe']);

    const suggested = (await as(me, 'select username from buddy_suggestions()')).map((r) => r.username);
    assert.deepEqual(suggested, [uname('sc')]);
  });
});

describe('notifications', () => {
  test('buddies are pinged only when the poster chooses', async () => {
    const { poster, buddy, cornerOnly } = await people({ poster: 'np', buddy: 'nb', cornerOnly: 'nc' });
    await connect(poster, buddy, uname('nb'));
    await connect(poster, cornerOnly, uname('nc'));
    await buddyUp(poster, buddy);

    await publishPost(poster, { body: 'quiet post' });
    assert.equal((await queued(buddy)).length, 0);
    await publishPost(poster, { body: 'ping my buddies', notifyBuddies: true });
    const [note] = await queued(buddy);
    assert.equal(note.kind, 'buddy_post');
    assert.match(note.title, new RegExp(uname('np')));
    assert.equal((await queued(cornerOnly)).length, 0, 'Corner members who are not buddies are not pinged');
  });

  test('anonymous posts never ping buddies, even if asked to', async () => {
    const { poster, buddy } = await people({ poster: 'ap', buddy: 'ab' });
    await connect(poster, buddy, uname('ab'));
    await buddyUp(poster, buddy);
    await publishPost(poster, { anonymous: true, corner: false, everyone: true, notifyBuddies: true });
    await publishPost(poster, { anonymous: true, corner: false, everyone: true, crisis: true });
    assert.equal((await queued(buddy)).length, 0);
  });

  test('buddies are told when a named crisis post goes up', async () => {
    const { poster, buddy } = await people({ poster: 'cp', buddy: 'cb' });
    await connect(poster, buddy, uname('cb'));
    await buddyUp(poster, buddy);
    await publishPost(poster, { crisis: true });
    const [note] = await queued(buddy);
    assert.equal(note.kind, 'buddy_support');
    assert.match(note.title, /might need extra support today/);
  });

  test('a next-day check-in is queued after a crisis post', async () => {
    const { poster } = await people({ poster: 'kp' });
    await publishPost(poster, { crisis: true });
    assert.equal((await asServer('select queue_due_checkins()'))[0].queue_due_checkins, 0, 'not due yet');
    await db.query(`update account_details set crisis_checkin_at = now() - interval '1 minute' where user_id = $1`, [poster]);
    await asServer('select queue_due_checkins()');
    const [note] = await queued(poster);
    assert.equal(note.kind, 'checkin');
    assert.deepEqual(note.data, { screen: 'support' });
  });

  test('supporters hear when a goal is accomplished; anonymous goals stay anonymous', async () => {
    const { poster, reactor, commenter } = await people({ poster: 'gp', reactor: 'gr', commenter: 'gc' });
    await connect(poster, commenter, uname('gc'));
    const goal = await publishPost(poster, { kind: 'goal', corner: true, everyone: true });
    await as(reactor, 'select react($1, $2, false)', [goal, 'believe']);
    await asServer('select add_comment($1, $2, $3, null)', [commenter, goal, 'You got this']);
    await publishPost(poster, { kind: 'goal', body: 'halfway there', followUpOf: goal });
    assert.equal((await queued(reactor)).length, 0, 'progress updates are Activity only');
    await publishPost(poster, { kind: 'milestone', body: 'I did it!', followUpOf: goal });
    assert.equal((await queued(reactor))[0].kind, 'goal_accomplished');
    assert.equal((await queued(commenter))[0].kind, 'goal_accomplished');

    const anonGoal = await publishPost(poster, { kind: 'goal', anonymous: true, corner: false, everyone: true });
    await db.query('update posts set published_at = now() where id = $1', [anonGoal]);
    await as(reactor, 'select react($1, $2, true)', [anonGoal, 'got_this']);
    await publishPost(poster, { kind: 'milestone', followUpOf: anonGoal });
    const last = (await queued(reactor)).at(-1);
    assert.equal(last.title, 'A goal you supported was accomplished');
    assert.ok(new Date(last.send_after) > new Date(), 'waits out the anonymous delay');
  });

  test('the sender claims due notifications once, with each device', async () => {
    const { poster, buddy } = await people({ poster: 'sp', buddy: 'sb' });
    await connect(poster, buddy, uname('sb'));
    await buddyUp(poster, buddy);
    await as(buddy, 'select register_push_token($1)', ['ExponentPushToken[abc]']);
    await publishPost(poster, { notifyBuddies: true });

    const claimed = (await asServer('select * from claim_notifications(500)')).filter((c) => c.tokens.length);
    assert.ok(claimed.some((c) => c.tokens.includes('ExponentPushToken[abc]')));
    const again = await asServer('select * from claim_notifications(500)');
    assert.ok(!again.some((c) => c.tokens.includes('ExponentPushToken[abc]')), 'never sent twice');

    await asServer('select forget_push_tokens($1)', [['ExponentPushToken[abc]']]);
    assert.equal((await db.query('select * from push_tokens where user_id = $1', [buddy])).rows.length, 0);
  });

  test('the queue and sending are server only', async () => {
    const { a } = await people({ a: 'qa' });
    await assert.rejects(as(a, 'select * from claim_notifications(10)'));
    await assert.rejects(as(a, 'select * from notifications'));
    await assert.rejects(as(a, 'select queue_due_checkins()'));
  });
});
