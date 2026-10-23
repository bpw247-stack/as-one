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
2. In the dashboard, open **SQL Editor**, paste in everything from
   [`supabase/migrations/20261023000000_phase1_accounts_corner.sql`](supabase/migrations/20261023000000_phase1_accounts_corner.sql),
   and click **Run**.
3. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Connect the app

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
node --test tests/*.test.mjs      # input validation
```

## Build progress

- [x] **Phase 1** — accounts (18+), profiles, Corner requests, block, account deletion
- [ ] Phase 2 — posting & feeds
- [ ] Phase 3 — reactions, comments, goal follow-ups
- [ ] Phase 4 — safety: screening, crisis mode, reports
- [ ] Phase 5 — buddies & notifications
- [ ] Phase 6 — photos
- [ ] Phase 7 — song posts
- [ ] Phase 8 — beta → App Store
