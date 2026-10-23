# As One

A social app for sharing struggles, goals, milestones and life events in a space where hate can't reach you.

- **Your Corner** — people you mutually trust. Only they can write to you.
- **Everyone else** — can only respond with preset supportive reactions.
- **Anonymous posts** — share without anyone knowing it's you.
- **Crisis support** — anyone who may be in crisis is heard and pointed to real help.

*"As One" — nobody supports alone.*

See [docs/SPEC.md](docs/SPEC.md) for the full product spec.

## Running it

### 1. Set up the database (one time)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the dashboard, open **SQL Editor** and run each file in
   [`supabase/migrations/`](supabase/migrations) **in order** (paste it in, click **Run**, then the next one).
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Turn on screening (one time)

Posts, comments and profile edits are checked for serious ill intent by Claude before they go
live. The check runs in a Supabase Edge Function, and the database only accepts those writes from
it, so **nothing can be posted until this step is done.**

1. Get an API key at [console.anthropic.com](https://console.anthropic.com).
2. Deploy the function and give it the key:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy screen
   npx supabase secrets set ANTHROPIC_API_KEY=<your-key>
   ```

3. Make yourself a moderator so you can review reports (SQL Editor, after you've signed up in
   the app):

   ```sql
   insert into moderators (user_id)
   select id from profiles where username = '<your-username>';
   ```

   Appeals have to be decided by a different moderator than the one who made the decision, so
   you'll want a second moderator before launch.

### 3. Connect the app

```bash
cp .env.example .env   # then paste your URL and key into .env
npm install
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone (or press `w` to open it in a browser).

## Checks

```bash
npm run typecheck                 # TypeScript
npx eslint .                      # lint
npm run test:db                   # database privacy rules, against an in-memory Postgres
node --test tests/*.test.mjs      # app logic and the screening module
```

## Build progress

- [x] **Phase 1** — accounts (18+), profiles, Corner requests, block, account deletion
- [x] **Phase 2** — posting & feeds (Corner tab, Everyone tab, anonymous posts)
- [x] **Phase 3** — reactions, comments, goal follow-ups, Activity
- [x] **Phase 4** — safety: AI screening, crisis mode, reports, penalties, appeals
- [ ] Phase 5 — buddies & notifications
- [ ] Phase 6 — photos
- [ ] Phase 7 — song posts
- [ ] Phase 8 — beta → App Store
