// Checks the Phase 1 privacy rules as real signed-in users would hit them.
//
//   npm run test:db

import assert from 'node:assert/strict';
import { before, describe, test } from 'node:test';

import { adult, as, db, setupDb, signUp } from './helpers.mjs';

before(setupDb);

describe('signup', () => {
  test('rejects anyone under 18', async () => {
    const seventeen = new Date();
    seventeen.setFullYear(seventeen.getFullYear() - 17);
    await assert.rejects(
      signUp({ ...adult('teen'), birth_date: seventeen.toISOString().slice(0, 10) }),
      /18 and older/,
    );
  });

  test('rejects a missing date of birth', async () => {
    await assert.rejects(signUp({ username: 'nodob', display_name: 'x' }), /date of birth/);
  });

  test('rejects bad and duplicate usernames', async () => {
    await assert.rejects(signUp(adult('no spaces')));
    await signUp(adult('Taken_Name'));
    await assert.rejects(signUp(adult('taken_name')), /unique|duplicate/);
  });

  test('keeps the birth date private to its owner', async () => {
    const a = await signUp(adult('dob_owner'));
    const b = await signUp(adult('dob_snoop'));
    assert.equal((await as(a, 'select * from account_details')).length, 1);
    assert.equal((await as(b, 'select * from account_details where user_id = $1', [a])).length, 0);
  });
});

describe('profiles', () => {
  test('owners can edit display name and bio, but not username or anyone else', async () => {
    const a = await signUp(adult('editor'));
    const b = await signUp(adult('bystander'));
    await as(a, `update profiles set display_name = 'New', bio = 'hi' where id = $1`, [a]);
    const [row] = await as(a, 'select display_name, bio from profiles where id = $1', [a]);
    assert.deepEqual(row, { display_name: 'New', bio: 'hi' });

    await assert.rejects(as(a, `update profiles set username = 'stolen' where id = $1`, [a]));
    await as(a, `update profiles set bio = 'hacked' where id = $1`, [b]);
    const [other] = await as(b, 'select bio from profiles where id = $1', [b]);
    assert.equal(other.bio, '');
  });
});

describe('corner', () => {
  test('a request becomes a mutual connection only when accepted', async () => {
    const a = await signUp(adult('alex'));
    const b = await signUp(adult('blair'));
    const c = await signUp(adult('casey'));

    const [{ send_corner_request: status }] = await as(a, 'select send_corner_request($1)', ['BLAIR']);
    assert.equal(status, 'sent');
    assert.equal((await as(b, 'select * from corner_requests where to_user = $1', [b])).length, 1);
    assert.equal((await as(a, 'select * from corners')).length, 0);

    await as(b, 'select respond_corner_request($1, true)', [a]);
    assert.equal((await as(a, 'select * from corners')).length, 1);
    assert.equal((await as(b, 'select * from corners')).length, 1);
    assert.equal((await as(c, 'select * from corners')).length, 0, 'outsiders cannot see a corner');
    assert.equal((await as(b, 'select * from corner_requests')).length, 0);
  });

  test('declining leaves no connection', async () => {
    const a = await signUp(adult('dana'));
    const b = await signUp(adult('eli'));
    await as(a, 'select send_corner_request($1)', ['eli']);
    await as(b, 'select respond_corner_request($1, false)', [a]);
    assert.equal((await as(a, 'select * from corners')).length, 0);
  });

  test('two people requesting each other connect immediately', async () => {
    const a = await signUp(adult('fran'));
    const b = await signUp(adult('gus'));
    await as(a, 'select send_corner_request($1)', ['gus']);
    const [{ send_corner_request: status }] = await as(b, 'select send_corner_request($1)', ['fran']);
    assert.equal(status, 'connected');
    assert.equal((await as(a, 'select * from corners')).length, 1);
  });

  test('removing someone ends the connection for both', async () => {
    const a = await signUp(adult('hal'));
    const b = await signUp(adult('ivy'));
    await as(a, 'select send_corner_request($1)', ['ivy']);
    await as(b, 'select respond_corner_request($1, true)', [a]);
    await as(b, 'select remove_from_corner($1)', [a]);
    assert.equal((await as(a, 'select * from corners')).length, 0);
  });

  test('nobody can write corners or requests directly', async () => {
    const a = await signUp(adult('jojo'));
    const b = await signUp(adult('kai'));
    await assert.rejects(as(a, 'insert into corners values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))', [a, b]));
    await assert.rejects(as(a, 'insert into corner_requests (from_user, to_user) values ($1, $2)', [b, a]));
  });

  test('you cannot add yourself', async () => {
    const a = await signUp(adult('lee'));
    await assert.rejects(as(a, 'select send_corner_request($1)', ['lee']), /yourself/);
  });
});

describe('block', () => {
  test('cuts off all contact and is invisible to the blocked person', async () => {
    const a = await signUp(adult('momo'));
    const b = await signUp(adult('nia'));
    await as(a, 'select send_corner_request($1)', ['nia']);
    await as(b, 'select respond_corner_request($1, true)', [a]);

    await as(b, 'select block_user($1)', [a]);

    assert.equal((await as(a, 'select * from corners')).length, 0, 'corner removed');
    assert.equal((await as(a, 'select * from profiles where id = $1', [b])).length, 0, 'blocked cannot see blocker');
    assert.equal((await as(b, 'select * from profiles where id = $1', [a])).length, 0, 'blocker cannot see blocked');
    assert.equal((await as(a, 'select * from blocks')).length, 0, 'blocked person cannot see the block');
    assert.equal((await as(b, 'select * from blocks')).length, 1);
    assert.deepEqual(
      (await as(b, 'select username from my_blocked()')).map((r) => r.username),
      ['momo'],
      'blocker can still see who they blocked, to unblock',
    );
    assert.equal((await as(a, 'select * from my_blocked()')).length, 0);

    // Looks exactly like a username that doesn't exist.
    await assert.rejects(as(a, 'select send_corner_request($1)', ['nia']), /No one with that username/);
    await assert.rejects(as(a, 'select send_corner_request($1)', ['nobody_here']), /No one with that username/);
  });

  test('clears pending requests and unblocking restores visibility', async () => {
    const a = await signUp(adult('ozzy'));
    const b = await signUp(adult('pat'));
    await as(a, 'select send_corner_request($1)', ['pat']);
    await as(b, 'select block_user($1)', [a]);
    assert.equal((await as(b, 'select * from corner_requests')).length, 0);

    await as(b, 'select unblock_user($1)', [a]);
    assert.equal((await as(a, 'select * from profiles where id = $1', [b])).length, 1);
  });
});

describe('account deletion', () => {
  test('removes the profile, details and connections', async () => {
    const a = await signUp(adult('quinn'));
    const b = await signUp(adult('rae'));
    await as(a, 'select send_corner_request($1)', ['rae']);
    await as(b, 'select respond_corner_request($1, true)', [a]);

    await as(a, 'select delete_account()');

    assert.equal((await db.query('select * from auth.users where id = $1', [a])).rows.length, 0);
    assert.equal((await db.query('select * from profiles where id = $1', [a])).rows.length, 0);
    assert.equal((await db.query('select * from account_details where user_id = $1', [a])).rows.length, 0);
    assert.equal((await as(b, 'select * from corners')).length, 0);
  });
});

describe('anonymous visitors', () => {
  test('cannot read anything', async () => {
    await db.query('begin');
    await db.query('set local role anon');
    await assert.rejects(db.query('select * from profiles'));
    await db.query('rollback');
  });
});
