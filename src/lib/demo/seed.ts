// Sample people and posts for the demo build. Everyone here is fictional.

import type { DemoBackend, Post } from '@/lib/demo/backend';

export const DEMO_USER_ID = 'demo-me';
export const DEMO_EMAIL = 'alex@example.com';

const MIN = 60e3;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A soft illustrated "photo" so the demo has images without loading any from the web. */
function scene(sky: [string, string], ground: string, sun: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
    <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${sky[0]}"/><stop offset="1" stop-color="${sky[1]}"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#s)"/>
    <circle cx="290" cy="120" r="46" fill="${sun}"/>
    <path d="M0 210 Q100 170 200 205 T400 195 V300 H0 Z" fill="${ground}"/>
    <path d="M150 300 Q190 250 200 205 Q210 250 250 300 Z" fill="#00000022"/>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function seed(db: DemoBackend) {
  const now = Date.now();
  const people: [string, string, string, string][] = [
    [DEMO_USER_ID, 'alex', 'Alex', 'Trying to be 1% better every day.'],
    ['demo-jo', 'jo_sober', 'Jo', 'One day at a time. 112 days.'],
    ['demo-sam', 'sam_runs', 'Sam', 'Couch to 5k, week 6.'],
    ['demo-maya', 'maya_writes', 'Maya', 'Missing my dad. Writing my way through it.'],
    ['demo-theo', 'theo_builds', 'Theo', 'Apprentice electrician.'],
    ['demo-priya', 'priya_p', 'Priya', 'Learning to be gentler with myself.'],
    ['demo-dev', 'dev_nights', 'Dev', 'Night-shift nurse.'],
  ];
  for (const [id, username, display_name, bio] of people) {
    db.profiles.set(id, { id, username, display_name, bio, birth_date: '1994-05-12' });
  }
  db.emails.set(DEMO_EMAIL, DEMO_USER_ID);
  db.moderators.add(DEMO_USER_ID);

  const corner = (a: string, b: string) => db.corners.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  corner(DEMO_USER_ID, 'demo-jo');
  corner(DEMO_USER_ID, 'demo-sam');
  corner(DEMO_USER_ID, 'demo-maya');
  corner('demo-jo', 'demo-sam');
  db.buddies.add(`${DEMO_USER_ID}|demo-sam`);
  db.cornerRequests.push({ from: 'demo-theo', to: DEMO_USER_ID, created_at: now - 2 * HOUR });

  const post = (p: Partial<Post> & Pick<Post, 'id' | 'author_id' | 'kind' | 'body'>, ago: number) => {
    db.posts.push({
      is_anonymous: false,
      to_corner: true,
      to_everyone: false,
      comments_private: false,
      follow_up_of: null,
      is_crisis: false,
      hidden_for_review: false,
      notify_buddies: false,
      photos: [],
      song: null,
      ...p,
      published_at: now - ago,
    });
  };
  const react = (post_id: string, reactor_id: string, reaction: string, show_name: boolean, ago: number) =>
    db.reactions.push({ post_id, reactor_id, reaction, show_name, created_at: now - ago });
  const comment = (id: string, post_id: string, author_id: string, body: string, ago: number, reply_to: string | null = null) =>
    db.comments.push({ id, post_id, author_id, body, reply_to, is_private: false, hidden_for_review: false, created_at: now - ago });

  post(
    {
      id: 'p-jo-112',
      author_id: 'demo-jo',
      kind: 'milestone',
      body: "112 days sober today. A year ago I couldn't make it to Friday. Thank you for being in my corner.",
      to_everyone: true,
    },
    40 * MIN,
  );
  react('p-jo-112', 'demo-sam', 'proud', true, 30 * MIN);
  comment('c-sam-jo', 'p-jo-112', 'demo-sam', 'So proud of you. One day at a time, every day.', 28 * MIN);
  comment('c-jo-sam', 'p-jo-112', 'demo-jo', 'Means more than you know, Sam.', 20 * MIN, 'c-sam-jo');

  const photos = ['posts/p-sam-week6/0.jpg', 'posts/p-sam-week6/1.jpg'];
  db.storage.set(photos[0], scene(['#F7B267', '#F4845F'], '#5B8E7D', '#FFF1D0'));
  db.storage.set(photos[1], scene(['#9DC5E8', '#D7E9F7'], '#7A9E7E', '#FFFFFF'));
  post(
    {
      id: 'p-sam-week6',
      author_id: 'demo-sam',
      kind: 'milestone',
      body: 'Finished week 6 of couch to 5k! Ran 25 minutes without stopping for the first time ever.',
      photos,
    },
    2 * HOUR,
  );

  post(
    {
      id: 'p-sam-goal',
      author_id: 'demo-sam',
      kind: 'goal',
      body: 'Running my first 5k on Saturday. Nervous, but I signed up so there is no backing out now.',
      to_everyone: true,
    },
    3 * HOUR,
  );
  react('p-sam-goal', DEMO_USER_ID, 'believe', true, 2.5 * HOUR);
  comment('c-me-sam', 'p-sam-goal', DEMO_USER_ID, "You've trained for this. Save me a spot at the finish line.", 2.4 * HOUR);

  post(
    {
      id: 'p-maya',
      author_id: 'demo-maya',
      kind: 'struggle',
      body: 'First birthday without my dad. I keep picking up my phone to call him.',
      comments_private: true,
    },
    5 * HOUR,
  );

  post(
    {
      id: 'p-theo',
      author_id: 'demo-theo',
      kind: 'life_event',
      body: 'Started my apprenticeship today. Forty-two and starting over, and it feels right.',
      to_corner: false,
      to_everyone: true,
    },
    6 * HOUR,
  );

  post(
    {
      id: 'p-sam-song',
      author_id: 'demo-sam',
      kind: 'song',
      body: 'This played on the radio the morning I decided to start running. Still gets me every time.',
      to_corner: false,
      to_everyone: true,
      song: { id: '1', title: 'Lean on Me', artist: 'Bill Withers', artwork_url: null, url: 'https://music.apple.com/' },
    },
    8 * HOUR,
  );

  post(
    {
      id: 'p-priya',
      author_id: 'demo-priya',
      kind: 'milestone',
      body: 'Went to my first therapy appointment. Sat in the car for ten minutes first, but I went in.',
      to_corner: false,
      to_everyone: true,
    },
    9 * HOUR,
  );

  // Anonymous posts. Maya's is from the demo user's Corner: the Everyone feed
  // guarantees it reaches them, mixed in with the others.
  post(
    {
      id: 'p-anon-dev',
      author_id: 'demo-dev',
      kind: 'struggle',
      body: "Night shifts are wearing me down and I haven't told anyone at home how bad it's gotten.",
      is_anonymous: true,
      to_corner: false,
      to_everyone: true,
    },
    3.5 * HOUR,
  );
  post(
    {
      id: 'p-anon-priya',
      author_id: 'demo-priya',
      kind: 'struggle',
      body: 'Panic attack in the grocery store today. Made it home. Counting that as a win.',
      is_anonymous: true,
      to_corner: false,
      to_everyone: true,
    },
    30 * HOUR,
  );
  post(
    {
      id: 'p-anon-maya',
      author_id: 'demo-maya',
      kind: 'struggle',
      body: 'Some mornings I still make two cups of coffee out of habit.',
      is_anonymous: true,
      to_corner: false,
      to_everyone: true,
    },
    2 * DAY,
  );

  post(
    {
      id: 'p-me-goal',
      author_id: DEMO_USER_ID,
      kind: 'goal',
      body: 'Read 12 books this year, one a month. Starting with something short.',
      to_everyone: true,
    },
    1 * DAY,
  );
  react('p-me-goal', 'demo-sam', 'believe', true, 20 * HOUR);
  react('p-me-goal', 'demo-jo', 'got_this', true, 19 * HOUR);
  react('p-me-goal', 'demo-priya', 'believe', false, 10 * HOUR);
  comment('c-jo-me', 'p-me-goal', 'demo-jo', "Start with Of Mice and Men. Short and it'll wreck you in the best way.", 18 * HOUR);

  // Jo and the demo user support each other a lot, so Jo shows up as a buddy suggestion.
  post({ id: 'p-jo-goal', author_id: 'demo-jo', kind: 'goal', body: 'Going to my first meeting as a speaker next week.' }, 2 * DAY);
  react('p-jo-goal', DEMO_USER_ID, 'believe', true, 47 * HOUR);
  react('p-jo-goal', DEMO_USER_ID, 'got_this', true, 47 * HOUR);

  // Something reported for review (hidden while it's reviewed).
  post(
    {
      id: 'p-reported',
      author_id: 'demo-dev',
      kind: 'life_event',
      body: 'Keep posting about me and see what happens.',
      to_corner: false,
      to_everyone: true,
      hidden_for_review: true,
    },
    4 * HOUR,
  );
  db.reports.push({
    id: 'r-1',
    reporter_id: 'demo-priya',
    target_type: 'post',
    target_id: 'p-reported',
    target_user_id: 'demo-dev',
    reason: 'threat',
    details: 'Posted right after I shared something about my anxiety.',
    status: 'open',
    decision: null,
    decided_by: null,
    decided_at: null,
    created_at: now - 3 * HOUR,
  });
}

/** The songs the demo's song search knows about. */
export const DEMO_SONGS = [
  ['1', 'Lean on Me', 'Bill Withers'],
  ['2', 'Here Comes the Sun', 'The Beatles'],
  ['3', 'Fix You', 'Coldplay'],
  ['4', 'Rise Up', 'Andra Day'],
  ['5', 'Stronger', 'Kelly Clarkson'],
  ['6', 'Three Little Birds', 'Bob Marley & The Wailers'],
  ['7', 'Unwritten', 'Natasha Bedingfield'],
  ['8', 'Lose Yourself', 'Eminem'],
  ['9', 'The Climb', 'Miley Cyrus'],
  ['10', "Don't Stop Believin'", 'Journey'],
  ['11', 'Breathin', 'Ariana Grande'],
  ['12', 'Keep Your Head Up', 'Andy Grammer'],
].map(([id, title, artist]) => ({ id, title, artist, artwork_url: null, url: 'https://music.apple.com/' }));
