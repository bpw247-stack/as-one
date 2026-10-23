# Launching As One

Everything in the app is built. What's left needs your accounts, your money, your decisions, or real people — this is the path from here to the App Store and Google Play, in order.

## 1. Run it for real (free)

Follow the README's **Running it** section: Supabase project → run the migrations → deploy the three edge functions → set `ANTHROPIC_API_KEY` and `CRON_SECRET` → create the notifications cron job → `.env` → `npx expo start`.

Then try every flow with two or three test accounts on real phones (Expo Go):

- [ ] Sign up (try an under-18 birth date — it must be refused)
- [ ] Corner requests, accept, remove, block
- [ ] Post to Corner, Everyone, both, and anonymously; confirm a friend can't tell an anonymous post is yours
- [ ] Reactions (with and without your name), comments, "Only I see comments", replies
- [ ] A goal and its "I did it!" follow-up
- [ ] Something harsh but fine (should post) and something hateful (should be blocked)
- [ ] A post that sounds like a crisis: the helpline screen, reactions only, the 48-hour banner
- [ ] Report something, review it as a moderator, appeal it from the other account (needs a second moderator)
- [ ] Buddies, "Notify my buddies", push notifications (needs a development build on Android — see below)
- [ ] Photos on a Corner post; confirm they don't appear in the Everyone tab
- [ ] A song post
- [ ] Delete an account

## 2. Decide

- [ ] **App ID.** `app.json` uses `app.asone.mobile` for iOS and Android. It's permanent once published — change it now if you want something else (it must be unique on each store).
- [ ] **Support email** — fill in `[CONTACT EMAIL]` in `docs/PRIVACY.md` and `docs/TERMS.md`. Apple requires a working contact.
- [ ] **Company.** Publishing as an individual shows your legal name on the store. Many people form an LLC first (and you discussed a Public Benefit Corporation).
- [ ] **Legal review** of the privacy policy, terms and guidelines (they're drafts).
- [ ] **Moderators.** You need at least two (appeals go to a different moderator), and someone checking the queue daily. Threat, self-harm and doxxing reports are hidden immediately but still need a fast decision.

## 3. Accounts and costs

| What | Cost | Needed for |
|---|---|---|
| [Apple Developer Program](https://developer.apple.com/programs/) | $99/year | TestFlight and the App Store |
| [Google Play Console](https://play.google.com/console) | $25 once | Google Play |
| [Expo / EAS](https://expo.dev) | Free tier to start | Cloud builds and push |
| [Anthropic API](https://console.anthropic.com) | Per use | Screening every post, comment, profile edit and photo |
| [Supabase](https://supabase.com) | Free tier to start | Database, auth, storage, functions |

Screening uses Claude Opus 5.5 ($4 per million input tokens, $20 per million output); one post costs a fraction of a cent, photos more. Set a monthly spend limit in the Anthropic console.

## 4. Builds

```bash
npx eas-cli@latest login
npx eas-cli@latest init                                  # links the project, adds the project id push needs
```

Your `.env` file isn't uploaded with builds. On [expo.dev](https://expo.dev), open the project →
**Environment variables** and add `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` for
all environments. Then:

```bash
npx eas-cli@latest build --profile development --platform android   # for testing push on Android
npx eas-cli@latest build --profile production --platform all
```

## 5. Beta test

- [ ] **iOS:** `npx eas-cli@latest submit --platform ios`, then invite testers in TestFlight.
- [ ] **Android:** upload to an internal testing track in Play Console.
- [ ] Get 10–20 people who'd actually use it — ideally a few from recovery or support communities — and watch the moderation queue closely.

## 6. Store listings

**Both stores**
- Screenshots (iPhone 6.9", Android phone), a short description, and the icon (already in `assets/images/icon.png`).
- Privacy policy URL: `https://github.com/bpw247-stack/as-one/blob/main/docs/PRIVACY.md` (or host it on your own site).
- **Review notes:** give reviewers a demo account, explain that strangers can only send preset reactions, that everything is screened, and where report, block and account deletion are (Apple checks all of these for social apps).

**App Store Connect**
- Age rating: answer the questionnaire honestly (user-generated content, mature themes such as substance use and mental health) and set the minimum age to 18+.
- App Privacy ("nutrition labels"): Contact info (email), Identifiers (user ID), User content (posts, photos), Other (date of birth) — all **linked to the user, not used for tracking**.
- Export compliance: already answered in `app.json` (no non-exempt encryption).

**Google Play**
- Content rating questionnaire (user interaction, mature themes) and target audience 18+.
- Data safety form: same data as above; data is encrypted in transit; users can request deletion (in-app).

## Known follow-ups

- Photos uploaded but never posted (closing the composer after a crisis hold, for example) stay in the private `pending/` folder. Clear it periodically in the Supabase Storage dashboard, or add a cleanup job.
- Song search is built against Apple's documented iTunes Search API but hasn't been exercised against the live service yet — check it in step 1.
