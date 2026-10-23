// Phase 4: crisis mode, blocked attempts, reports, penalties and appeals.
//
//   npm run test:db

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import {
  adult,
  as,
  asServer,
  connect,
  db,
  publishComment,
  publishPost,
  setupDb,
  signUp,
} from './helpers.mjs';

before(setupDb);

let n = 0;
async function people(roles) {
  n += 1;
  const ids = {};
  for (const [role, name] of Object.entries(roles)) ids[role] = await signUp(adult(`${name}${n}`));
  return ids;
}
const uname = (name) => `${name}${n}`;

async function makeModerator(userId) {
  await db.query('insert into moderators (user_id) values ($1)', [userId]);
}
const getPost = (u, id) => as(u, 'select * from get_post($1)', [id]).then(([r]) => r);
const report = (u, type, id, reason) =>
  as(u, 'select report_content($1, $2, $3)', [type, id, reason]);
const status = (u) => as(u, 'select * from my_status()').then(([r]) => r);

describe('crisis mode', () => {
  test('the post goes up, but nobody can write comments and only crisis reactions work', async () => {
    const { poster, friend } = await people({ poster: 'kp', friend: 'kf' });
    await connect(poster, friend, uname('kf'));
    const id = await publishPost(poster, { corner: true, everyone: true, crisis: true });

    const seen = await getPost(friend, id);
    assert.ok(seen, 'still visible');
    assert.equal(seen.can_comment, false);
    await assert.rejects(publishComment(friend, id, 'hi'), /Only people in their Corner/);

    await as(friend, 'select react($1, $2, true)', [id, 'life_matters']);
    await assert.rejects(as(friend, 'select react($1, $2, true)', [id, 'support']), /isn't available/);
  });

  test('keeps the helpline in front of the author for 48 hours', async () => {
    const { poster } = await people({ poster: 'kh' });
    assert.equal((await status(poster)).crisis_support_until, null);
    await publishPost(poster, { crisis: true });
    const until = new Date((await status(poster)).crisis_support_until);
    const hours = (until - Date.now()) / 3600e3;
    assert.ok(hours > 47 && hours <= 48, `${hours}h`);
  });
});

describe('blocked attempts', () => {
  test('three in a day pause commenting until a moderator reviews it', async () => {
    const { angry, poster, mod } = await people({ angry: 'ba', poster: 'bp', mod: 'bm' });
    await connect(poster, angry, uname('ba'));
    const id = await publishPost(poster);
    await makeModerator(mod);

    for (let i = 0; i < 2; i++) {
      const [{ record_blocked_attempt: paused }] = await asServer(
        'select record_blocked_attempt($1, $2, $3, $4)',
        [angry, 'comment', 'harassment', `attempt ${i}`],
      );
      assert.equal(paused, false);
    }
    await publishComment(angry, id, 'still allowed after two');
    const [{ record_blocked_attempt: paused }] = await asServer(
      'select record_blocked_attempt($1, $2, $3, $4)',
      [angry, 'comment', 'harassment', 'attempt 3'],
    );
    assert.equal(paused, true);
    assert.equal((await status(angry)).comment_paused, true);
    await assert.rejects(publishComment(angry, id, 'nope'), /paused/);
    await publishPost(angry, { body: 'can still post and use the app' });

    const queue = await as(mod, 'select * from pause_queue()');
    assert.equal(queue.find((q) => q.username === uname('ba')).attempts.length, 3);
    await as(mod, 'select decide_pause($1, $2)', [uname('ba'), 'restore']);
    await publishComment(angry, id, 'back again');
  });

  test('only the server can record them', async () => {
    const { a } = await people({ a: 'bs' });
    await assert.rejects(as(a, 'select record_blocked_attempt($1, $2, $3, $4)', [a, 'post', 'hate', 'x']));
  });
});

describe('reports', () => {
  test('are confidential and leave the reported account working', async () => {
    const { author, reporter } = await people({ author: 'ra', reporter: 'rr' });
    const id = await publishPost(author, { corner: false, everyone: true });
    await report(reporter, 'post', id, 'harassment');

    assert.ok(await getPost(reporter, id), 'non-severe reports leave content up');
    assert.equal((await status(author)).suspended_until, null);
    await publishPost(author, { body: 'account still works' });
    await assert.rejects(as(author, 'select * from reports'), 'nobody reads reports directly');
  });

  test('threats, self-harm encouragement and doxxing are hidden while reviewed, except from their author', async () => {
    const { author, reporter, other } = await people({ author: 'rh', reporter: 'rx', other: 'ro' });
    const id = await publishPost(author, { corner: false, everyone: true });
    await report(reporter, 'post', id, 'threat');
    assert.equal(await getPost(other, id), undefined);
    assert.ok(await getPost(author, id), 'the author is not tipped off');
    const feed = await as(other, 'select id from everyone_feed(0, 50)');
    assert.ok(!feed.some((r) => r.id === id));
  });

  test('you can only report what you can see, and not yourself', async () => {
    const { author, stranger } = await people({ author: 'rc', stranger: 'rs' });
    const cornerOnly = await publishPost(author, { corner: true, everyone: false });
    await assert.rejects(report(stranger, 'post', cornerOnly, 'hate'), /Not found/);
    const pub = await publishPost(author, { corner: false, everyone: true });
    await assert.rejects(report(author, 'post', pub, 'hate'), /yourself/);
  });

  test('moderators only', async () => {
    const { a } = await people({ a: 'rq' });
    await assert.rejects(as(a, 'select * from review_queue()'), /Moderators only/);
  });
});

describe('penalties', () => {
  async function reportedPost(reason = 'harassment') {
    const { author, reporter, mod, mod2 } = await people({ author: 'pa', reporter: 'pr', mod: 'pm', mod2: 'pn' });
    await makeModerator(mod);
    await makeModerator(mod2);
    const id = await publishPost(author, { corner: false, everyone: true, body: 'reported text' });
    await report(reporter, 'post', id, reason);
    const [item] = (await as(mod, 'select * from review_queue()')).filter((r) => r.target_id === id);
    return { author, reporter, mod, mod2, id, reportId: item.report_id, item };
  }

  test('the queue shows the content and author, even for anonymous posts', async () => {
    const { author, reporter, mod } = await people({ author: 'qa', reporter: 'qr', mod: 'qm' });
    await makeModerator(mod);
    const id = await publishPost(author, { anonymous: true, corner: false, everyone: true, body: 'anon text' });
    await db.query('update posts set published_at = now() where id = $1', [id]);
    await report(reporter, 'post', id, 'hate');
    const [item] = (await as(mod, 'select * from review_queue()')).filter((r) => r.target_id === id);
    assert.equal(item.content, 'anon text');
    assert.equal(item.author_username, uname('qa'));
  });

  test('dismissing brings hidden content back', async () => {
    const { mod, reportId, id, reporter } = await reportedPost('doxxing');
    assert.equal(await getPost(reporter, id), undefined);
    await as(mod, 'select decide_report($1, $2)', [reportId, 'dismiss']);
    assert.ok(await getPost(reporter, id));
  });

  test('a suspension removes the content and blocks posting, commenting and reacting', async () => {
    const { mod, reportId, id, author, reporter } = await reportedPost();
    await as(mod, 'select decide_report($1, $2)', [reportId, 'suspend_7']);
    assert.equal(await getPost(reporter, id), undefined);
    await assert.rejects(publishPost(author), /suspended/);
    const other = await publishPost(reporter, { corner: false, everyone: true });
    await assert.rejects(as(author, 'select react($1, $2, true)', [other, 'support']), /suspended/);
    const days = (new Date((await status(author)).suspended_until) - Date.now()) / 86400e3;
    assert.ok(days > 6.9 && days <= 7);
  });

  test('a ban blocks signing up again with the same email', async () => {
    const { mod, reportId, author } = await reportedPost('threat');
    await as(mod, 'select decide_report($1, $2)', [reportId, 'ban']);
    assert.equal((await status(author)).banned, true);
    await as(author, 'select delete_account()');
    await assert.rejects(signUp(adult('fresh_start'), `${uname('pa')}@example.com`), /can't be created/);
  });

  test('one appeal, decided by a different moderator', async () => {
    const { mod, mod2, reportId, author } = await reportedPost();
    await as(mod, 'select decide_report($1, $2)', [reportId, 'suspend_30']);
    const [decision] = await as(author, 'select * from my_decisions()');
    assert.equal(decision.decision, 'suspend_30');

    await as(author, 'select appeal($1, $2)', [reportId, 'That was taken out of context']);
    await assert.rejects(as(author, 'select appeal($1, $2)', [reportId, 'again']), /already appealed/);

    assert.equal((await as(mod, 'select * from appeal_queue()')).length, 0, 'not shown to the original moderator');
    const [appeal] = await as(mod2, 'select * from appeal_queue()');
    await assert.rejects(as(mod, 'select decide_appeal($1, true)', [appeal.appeal_id]), /different moderator/);
    await as(mod2, 'select decide_appeal($1, true)', [appeal.appeal_id]);
    assert.equal((await status(author)).suspended_until, null);
    await publishPost(author, { body: 'back' });
  });

  test('bad-faith reporters get a warning', async () => {
    const { mod, reportId, reporter } = await reportedPost();
    await as(mod, 'select decide_report($1, $2, true)', [reportId, 'dismiss']);
    const { rows } = await db.query('select warnings from account_restrictions where user_id = $1', [reporter]);
    assert.equal(rows[0].warnings, 1);
  });
});
