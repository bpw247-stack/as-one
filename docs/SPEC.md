# As One — Product Spec (v1)

> *"As One"* — named for a high school football coach's motto. Nobody supports alone.

As One is a social app for sharing struggles, goals, milestones and life events in a space where hate cannot reach you. Strangers can only respond with preset supportive reactions; only the people you mutually trust can write to you.

---

## 1. Core principles

1. **Support, not engagement.** No popularity ranking, no public counts, no features designed to keep people scrolling.
2. **Strangers can't type to you.** Free text only comes from people in your Corner.
3. **You choose who's close.** The app trusts your judgment of your Corner and only removes content with serious ill intent.
4. **Anonymity is airtight.** An anonymous post can never be traced back to its author by anyone, by any means.
5. **Positivity is not a competition.** Counts are private to the person they belong to.
6. **Safety first on crisis.** Someone in crisis is heard, and pointed to real help, every time.

---

## 2. Accounts

- **18+ only.** Date of birth at signup; under-18 is blocked. App Store rating 17+.
- Profile: username, display name, optional avatar, optional bio. All screened.
- **Account deletion removes everything**: named posts, anonymous posts, comments, reactions, Corner and buddy connections.
  - Exception: a **banned** user's minimal identifier (email/phone) is kept to prevent re-signup. No content is kept.

---

## 3. Relationships

### Corner
- **Mutual.** One person sends a request, the other accepts; then each is in the other's Corner.
- Removing someone ends it for both.
- Found by **username search** only.
- **Corner requests carry no message** (no free text from strangers).
- **No limit** on Corner size.
- **Only you** see your Corner count.

### Buddies (inner tier of Corner)
- Your closest people inside your Corner.
- The app **suggests** buddies when two people support each other a lot; either person can also send a buddy request. **Both must accept.**
- **Limit: 10 buddies.**
- Buddies can be notified when you post (your choice per post) and receive the **support alert** on crisis posts.

### Block
- Cuts off **all** contact both ways: search, requests, every post (named *and* anonymous), reactions, comments.
- Removes them from your Corner/buddies.
- They are not told.

---

## 4. Posts

### Types
| Type | Example | Notes |
|---|---|---|
| **Struggle** | "Hard week, could use support" | |
| **Goal** | "I want to run a 5k in 3 months" | Can receive follow-ups |
| **Milestone** | "I'm 3 months sober" | |
| **Life event** | "Started a new job" | |
| **Song** | A song + the user's interpretation | See §8 |

### Audience
| Mode | Corner tab | Main tab |
|---|---|---|
| Named → Corner | ✅ | |
| Named → Everyone | | ✅ |
| Named → Both | ✅ | ✅ |
| Anonymous | | ✅ (only) |

### Photos
- **Corner posts only**, up to 4 per post.
- A post shared to **both** shows photos in Corner, **text only** in the main tab.
- Main tab and anonymous posts are always text-only (song album art excepted).
- Every photo is screened; **location and device metadata is stripped** on upload.

### Goal follow-ups
- Posted **from the original goal** as a new, linked post (e.g., "I did it!").
- Everyone who supported the original goal gets a **push notification**.
- A follow-up inherits the original's anonymity.

### Notify buddies
- When posting a named post, the poster can toggle **"Notify my buddies."**

---

## 5. Feeds

### Corner tab
- Named posts shared to Corner by people in your Corner. Newest first.

### Main tab
- Named public posts + all anonymous posts. **Newest first, no popularity ranking, no filters.**
- **Corner anonymity rule:** anyone in your Corner is **guaranteed** to see your anonymous posts in their main tab — at a **random position**, mixed among others, **never labeled**, and not instantly on posting.

---

## 6. Interaction

### Who can respond how
| Post | People in poster's Corner | Everyone else |
|---|---|---|
| Named | Comment + reactions | Reactions only |
| Anonymous | Reactions only | Reactions only |
| Crisis (any) | Reactions only | Reactions only |

### Reactions
- Preset, **different per post type**. Starting sets:
  - **Struggle:** I support you · You're not alone · Sending strength
  - **Goal:** I believe in you · You've got this
  - **Milestone:** So proud of you · Congratulations
  - **Life event:** Happy for you · Thinking of you
  - **Song:** This song hits · Thank you for sharing
  - **Crisis:** You are not alone · Your life matters · We're here for you · Sending you strength
- The **reactor** chooses whether to show their username. Otherwise the poster sees "Someone."
- **Counts visible to the poster only.**

### Comments
- **Flat.** Commenters cannot reply to each other.
- **Poster can reply** to any comment.
- Poster can **delete** any comment on their post.
- **"Only I see comments"** option per post (default set in Settings):
  - Each commenter sees only their own comment + the poster's reply.
  - Comment box shows "Only [poster] will see your comment."
  - Switching private → public applies to new comments only.

---

## 7. Safety

### Screening (before anything goes live)
Applies to posts, comments, usernames, bios, photos.

**Removed — serious ill intent only:**
- Hate (race, religion, gender, sexuality, disability, etc.)
- Threats of violence or harm
- Encouraging self-harm or suicide
- Harassment / degradation meant to wound
- Sexual content directed at someone
- Doxxing, including revealing who wrote an anonymous post

Everything else passes. Users are trusted to judge their own Corner.

**Repeated blocked attempts:** a single blocked attempt has no penalty. A pattern (e.g., 3 serious attempts in 24h) **pauses commenting immediately**; the user is told it's paused for review. A human then restores, restricts (temporary or permanent), or escalates.

### Crisis posts
Detected by AI (leaning toward flagging when unsure). The post **still goes up**.

1. **Before posting:** full-screen message — *"You matter, and you don't have to carry this alone."* Large **Call 988** / **Text 988** buttons + Crisis Text Line (text HOME to 741741). Must be tapped past deliberately.
2. **After posting:** pinned helpline banner for **48 hours**.
3. **Next day:** private check-in with the helpline.
4. **Their own post** always shows a helpline button to them.
5. **Comments off for everyone**; crisis reaction set only.
6. **Named crisis posts only:** buddies get a push — *"[Name] might need extra support today."* (Never for anonymous posts.)
7. Helplines are **localized by country**; immediate danger → emergency services.
8. A **"Get support"** button is always reachable in the app, independent of detection.

No one else sees that a post was flagged.

### Reports
- Available on any post, comment or profile, with a reason.
- **The reported person is never told.** Their account works normally during review (innocent until proven guilty).
- AI gathers context; **a human decides** any penalty.
- Reporter is told it was reviewed (no details).
- One appeal, reviewed by a different reviewer.
- Repeat bad-faith reporters are warned.

### Penalties by severity
| Severity | Examples | Penalty |
|---|---|---|
| Low | Rude, first minor offense | Content removed + warning |
| Medium | Harassment, degrading insults, repeat lows | Removed + 7-day suspension |
| High | Hate speech, sexual harassment, unmasking anonymous authors | 30-day suspension / ban on repeat |
| Severe | Threats, encouraging suicide/self-harm, doxxing | Immediate permanent ban |

---

## 8. Song posts
- Search a song (Apple Music / Spotify catalog); the post shows **title, artist, album art**.
- The user writes their **interpretation** of the song or specific lines.
- **No audio plays in-app.** "Listen on Spotify / Apple Music" button opens their music app.
- **No app-displayed lyrics** (licensing). Users may quote a short line (≈2 lines max) in their interpretation.
- Same audience options and screening (incl. crisis detection) as other posts.

---

## 9. Notifications
**Push only for:**
- A buddy posts (when they chose "Notify my buddies")
- A buddy might need support (crisis alert)
- A goal you supported was accomplished

**Everything else → in-app Activity tab, no ping:** reactions, comments, Corner and buddy requests.

---

## 10. Profiles
- Strangers see only your **public named posts**.
- Your Corner count, buddy list and reaction counts are visible **only to you**.
- Anonymous posts never link to any profile.

---

## 11. Anonymity — technical guarantees
- The author's identity is **never sent to any device** with an anonymous post (not even hidden in API data).
- No username, avatar or profile link on anonymous posts.
- Anonymous posts are published after a **small random delay**.
- Corner members see them at random positions, unlabeled. Concretely: on the first page of
  the main tab, any unseen anonymous post from your Corner (last 14 days) is mixed in at a
  random spot, alongside at least as many unseen anonymous posts from outside your Corner
  ("decoys"), so a resurfaced post never points to your Corner. Each is delivered once.
- Times on other people's anonymous posts are rounded to the hour.
- Blocked users never see them; this doesn't leak authorship because the main feed is large and unordered by author.
- The author privately sees reactions (and usernames of reactors who opted in).

---

## 12. Money & ethics
**Revenue (choice-based):**
- Optional premium subscription (extras like goal-tracking tools, progress charts, themes, exports)
- Supporter tier / donations
- Later: privacy-strict partnerships (recovery programs, wellness programs)

**Promises — never:**
- Sell user data or show targeted ads
- Paywall crisis resources, posting, reactions, Corner or buddies
- Let anyone pay to boost posts
- Design features to maximize time-in-app

Consider incorporating as a **Public Benefit Corporation**.

---

## 13. Tech stack (proposed)
| Layer | Choice | Why |
|---|---|---|
| App | **React Native + Expo** (TypeScript) | One codebase → iOS, Android, web; test on your phone via Expo Go |
| Backend | **Supabase** (Postgres, Auth, Storage, Edge Functions) | Row-level security enforces privacy rules (anonymity, Corner-only, blocks) at the database |
| Moderation | AI screening via an LLM API (e.g., Anthropic's Claude) + image moderation | Context-aware "serious ill intent" judgment, crisis detection |
| Push | Expo Notifications | Works on both platforms |
| Music | Apple Music / Spotify search APIs | Song metadata + deep links |

---

## 14. Build phases
1. **Foundation:** accounts (18+), profiles, Corner requests, block.
2. **Posting & feeds:** post types, audiences, Corner tab, main tab with anonymous mixing.
3. **Interaction:** reactions (per type, opt-in names), flat comments, private comments, goal follow-ups.
4. **Safety:** screening, crisis mode, reports + admin review tool, penalties.
5. **Buddies & notifications.**
6. **Photos** (Corner only, metadata stripping, image screening).
7. **Song posts.**
8. **Polish → TestFlight / Play beta → App Store.**
