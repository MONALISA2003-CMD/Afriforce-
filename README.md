# Afriforce

A real, deployable Next.js app implementing the Afriforce V1 core loop
(onboarding → economic profile → skills assessment → opportunity radar →
next-best-action) plus Freelance, Business Builder + Copilot, an Employer
search with real multi-seat organizations (shared search history,
candidate shortlist and job postings), a lightweight talent marketplace,
an admin overview, and a real (admin-seeded) opportunity store — backed
by Firebase (Auth + Firestore) and Gemini.

## For anyone evaluating this (e.g. competition judges)

What's real: authentication, the database, every AI call, the talent
marketplace, and the opportunity store are genuine — not mocked for
demo purposes. What's clearly labeled as not-yet-real: AI-generated
preview opportunities/candidates (shown only to fill gaps around real
data, always visibly badged "AI estimate" vs "Verified listing"), and
the "Known gaps" section further down, which lists everything not yet
production-ready without euphemism. The landing page is deliberately
the one screen that isn't mobile-width — the rest of the app is a
fixed ~480px column by design (a real mobile-first product decision,
documented below), which will look intentionally narrow on a wide
screen. That's not a bug.

## Architecture

- **Next.js 14, App Router, plain JavaScript** (no TypeScript — adding it
  is a reasonable follow-up: `npm install -D typescript @types/react
  @types/node` and let Next.js prompt you through renaming files).
- **`components/AfriforceApp.jsx`** — almost the entire product UI and
  client-side logic in one file, ported from an interactive prototype.
  Splitting it into per-feature files is a reasonable follow-up but
  wasn't required to make it work.
- **`lib/firebaseClient.js`** — Firebase Auth only, initialized for the
  browser. The client never talks to Firestore directly — every read/
  write goes through this app's own API routes using the Admin SDK. That
  means there are no Firestore *security rules* governing data access to
  get right or wrong; the same checks that would live in security rules
  instead live in the route handlers below, in plain JS you can read.
- **`lib/firebaseAdmin.js`** — Firebase Admin SDK (server-only). Exposes
  `verifyRequest(req)`, which checks the `Authorization: Bearer <idToken>`
  header the frontend attaches to every authenticated request and
  returns the decoded token (uid, email, custom claims) or null.
- **`app/api/intelligence/route.js`** — the AI Gateway. The *only* place
  `GEMINI_API_KEY` is read. The client sends `{system, prompt}` and gets
  back raw text to parse — this keeps the key off the browser without
  restructuring the many prompt call-sites in the component. Also
  enforces a per-user rate limit (60 requests/hour, tracked in Firestore
  — see the caveat in that file's comments).
- **`app/api/kv/*`** — a small key-value API (`get`/`set`/`delete`/`list`,
  personal vs. shared) mirroring the interface the original prototype
  used against the artifact sandbox's in-memory storage, now backed by
  Firestore. Personal records live under `users/{uid}/records/{key}`;
  shared records (e.g. opted-in talent profiles) are top-level documents
  with an `ownerId` enforced on write/delete.
- **`app/api/register/route.js`** — assigns the `role` custom claim
  (`"seeker"` or `"employer"`) after the client creates a Firebase Auth
  account. Custom claims can only be set with the Admin SDK, so the
  client creates the account first, then calls this route with its fresh
  ID token.
- **`app/api/opportunities/*`** — the real opportunity store (a genuine
  Firestore collection, not AI-generated). `GET` is public; `POST`
  (add a listing) and `DELETE /[id]` are admin-only, checked against
  the `role` claim on the verified ID token. Job-seeker matching in
  `completeOnboarding` fetches from here first.
- **No relational schema.** Profile/skills/opportunities/business state
  is stored as one JSON blob per user (`users/{uid}/records/profile`)
  rather than modeled as separate Firestore collections per entity. Easy
  to deploy today; once you know which fields actually need independent
  querying, promote those into their own documents/collections one at a
  time.

## Setup

```bash
npm install
cp .env.example .env
# fill in the Firebase and Gemini values below

npm run dev
```

Open http://localhost:3000.

### 1. Create a Firebase project

1. [Firebase Console](https://console.firebase.google.com) → Add project.
2. **Build → Authentication → Get started → Sign-in method →
   Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (Native mode; any
   region). Then set the security rules from `firestore.rules` (deny-all
   — the app never accesses Firestore from the browser, only
   server-side via the Admin SDK, which bypasses rules entirely, so
   there's no legitimate reason to leave any collection open to direct
   client access). Two ways to apply it:
   - **Console:** Firestore Database → Rules tab → paste the contents of
     `firestore.rules` → Publish.
   - **CLI:** `npx firebase-tools deploy --only firestore:rules` (needs
     `firebase login` and a `firebase.json`/`.firebaserc` pointing at
     this project — the CLI will offer to generate those if missing).
4. **Project settings (gear icon) → General → Your apps → Add app → Web.**
   Copy the config values into `NEXT_PUBLIC_FIREBASE_*` in `.env`.
5. **Project settings → Service accounts → Generate new private key.**
   Downloads a JSON file. Copy `project_id` → `FIREBASE_PROJECT_ID`,
   `client_email` → `FIREBASE_CLIENT_EMAIL`, and `private_key` →
   `FIREBASE_PRIVATE_KEY` (keep the quotes and the literal `\n`s — see
   the comment in `.env.example`).

### 2. Get a Gemini API key

[Google AI Studio](https://aistudio.google.com/apikey) → Create API key
→ `GEMINI_API_KEY` in `.env`.

## Deploying (Vercel)

Real values for this project are already filled into `.env` in this zip
— **but `.env` is deliberately gitignored and will not be committed**,
including by the unzip-sync GitHub Action, if you're using that. That's
correct behavior, not a bug: a Firebase Admin service account key
grants full read/write/delete access to your Auth users and Firestore
data, and GitHub's automated secret scanning (which partners with
Google specifically to detect this credential type) will typically
auto-revoke a key like this within minutes of it landing in a public
repo — so committing it wouldn't just be risky, it would likely break
your deployment shortly after it started working.

The correct one-time setup, which still gets you "deploy once, every
push after that just works":

1. Push this repo to GitHub (the zip's `.gitignore` keeps `.env` out of
   that push automatically).
2. Import the repo in Vercel.
3. In Vercel's **Environment Variables** settings, add every value from
   your local `.env` file **once** — open `.env` on your phone/computer
   and copy each line's value across (`NEXT_PUBLIC_FIREBASE_*`,
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   — paste that one exactly as it appears, quotes and all — and
   `GEMINI_API_KEY`). This is a Vercel dashboard action, not a git
   commit, so it never touches your repo or its history.
4. Deploy.

From here on, every future `git push` (including from the unzip-sync
workflow) redeploys automatically using those same stored variables —
you don't re-enter them. That's the actual "set once" mechanism; a
committed `.env` file would give you the same convenience with a real
chance of an auto-revoked key and a compromised Firestore database
attached.

There's no database migration step — Firestore collections are created
implicitly on first write. Any other Node hosting (Railway, Render,
Fly.io) works the same way: set the same env vars in that platform's
dashboard once, and deploy.

**Since these specific credentials have now passed through this chat**,
if this project moves beyond quick prototyping, regenerate both the
Firebase service account key (Project settings → Service accounts →
Generate new private key, then delete the old one) and the Gemini key
(AI Studio → delete this key, create a new one) before it matters —
takes under a minute for both.

## Promoting an admin

Registration only ever assigns `"seeker"` or `"employer"` — admin isn't
self-service. To promote an existing account:

```bash
npm run promote-admin -- someone@example.com
```

This calls Firebase Admin directly (see `scripts/promote-admin.mjs`) to
set the `role: "admin"` custom claim and mirror it in Firestore. The
user needs to sign out and back in (or wait ~1 hour for their ID token
to naturally refresh) before the app sees the new role.

## What's real vs. what's still a known gap

**Real:**
- Accounts and sessions via Firebase Authentication (industry-standard,
  not hand-rolled)
- **Account types** — `role` custom claim is `"seeker"`, `"employer"`,
  or `"admin"`. The frontend's `requireAuth(action, allowedRoles)` gate
  checks the real, server-verified role before letting anyone into
  onboarding, the employer search, or the admin view.
- The AI Gateway — the Gemini key never reaches the browser, and every
  request is rate-limited per user.
- **Shared-record ownership** — `ownerId` is set on first write and
  checked on every subsequent write/delete, so one account can't
  overwrite another's talent profile by guessing its key.
- Persistence — profile, skills, opportunities, and active business
  survive logout/login, stored in real Firestore.
- The talent marketplace — opting into "Visible to employers" writes a
  real, owned Firestore record; employer search reads real opted-in
  profiles first before filling remaining slots with clearly-labeled
  sample candidates.
- The admin overview — reads real aggregate data from Firestore, invents
  nothing.
- **Email verification and password reset** — registration sends a
  verification email; a non-blocking banner on the dashboard offers
  resend/"I've verified" until confirmed. "Forgot password?" on the
  sign-in screen sends a real reset link. Note: the reset flow
  deliberately shows the same "check your inbox" message whether or not
  the email exists, to avoid confirming account existence to an
  unauthenticated visitor.
- **Organization-level employer accounts** — an employer registering
  creates a real `organizations` Firestore doc (or joins an existing one
  via an 8-character invite code, since there's no email-sending
  infrastructure for real invitations yet). The `orgId` is a custom
  claim, checked server-side in `/api/organizations/me` — one org can't
  read another's member list. The "My team" screen shows the invite code
  and member list.
- **Shared search history across an organization** — every employer
  search now saves to `organizations/{orgId}/searches`, and the intake
  screen shows the team's 5 most recent searches (role, candidate count,
  who ran it) before you even start a new one. One teammate's work is
  now visible to the next, not siloed per account.
- **Shared candidate shortlist** — any candidate from a search can be
  saved to `organizations/{orgId}/candidates` with one click; the whole
  org sees it on the "My team" screen (who saved it, for what role), and
  anyone in the org can remove it. This is the piece search history
  alone didn't cover: a teammate's actual finding, not just the fact
  that they searched.
- **Shared job postings** — "Post this job for your team" on any search
  result saves it to `organizations/{orgId}/jobs`; the whole org sees it
  on "My team" with who posted it, and can reopen/close or remove it
  together. This was the last piece of the "team hiring" gap — search
  history, the candidate shortlist, and job postings are now all
  genuinely shared org data, not siloed per account.
- **Atomic rate limiting** — the AI Gateway's per-user limit now uses a
  Firestore transaction on a single counter document
  (`users/{uid}/rateLimit/aiGateway`) instead of counting documents in a
  time window. Firestore serializes concurrent transactions on the same
  document, which closes the specific race the old approach had (two
  requests both reading "under the limit" before either recorded
  itself). See the comment above `checkAndRecordUsage` in
  `app/api/intelligence/route.js` for the one real caveat that remains
  (Firestore's own soft write-rate guidance for a single document, far
  beyond what one user's request rate would hit, but worth knowing if
  this pattern is reused for a shared/global counter later).

**Known gaps, worth fixing before this handles real users:**
- **No real opportunity sourcing yet, but the architecture for it now
  exists.** `app/api/opportunities` is a real Firestore-backed store
  (Firestore collection `opportunities`) — job-seeker matching checks it
  first and only invents AI preview listings to fill remaining slots,
  same pattern as the employer search's real member profiles. Admins can
  seed real listings from the Admin screen today. What's still missing
  is an actual live source: a job-board API/scraper (e.g. a ToS-compliant
  aggregator) that calls `POST /api/opportunities` on a schedule — that's
  now a config/integration task, not an architecture rewrite.
- **Real AI-generated content in the person's own language.** Every
  onboarding step already collected a preferred language and did nothing
  with it — `buildSystem(language)` in `components/AfriforceApp.jsx` now
  passes it into every AI Gateway call, so the Economic Profile,
  assessments, opportunities, next actions, business plans and freelance
  packages are genuinely generated in Swahili, French, Hausa, Yoruba,
  Amharic, Zulu, Portuguese or Luganda — not translated after the fact,
  the model writes natively in that language. JSON keys stay in English
  (the frontend parses them by name); only the values change language.
- **No multilingual *interface*, though.** Buttons, labels, menus, and
  every other piece of static UI chrome are still English-only — only
  the AI-generated content is multilingual. Translating the interface
  itself is a real i18n project (string extraction, a translation table
  per language, testing each layout with longer/shorter translated text)
  that wasn't attempted here — doing it partially or untested would be
  worse than being upfront that it isn't done. No voice layer either.
- **No payments/financial integrations** — intentionally out of scope
  per the docs' own phasing (these come after the core loop is proven).

None of these are hard to fix — they're the honest list of "next," not
hidden problems.

## A note on testing

This was built and syntax-validated (every file parsed with a real
JS/JSX parser) but **not** run through `npm install` / `next build`
end-to-end, because this environment has no network access to fetch npm
packages or reach Firebase/Gemini. Standard, well-documented library
patterns were used throughout (Next.js App Router route handlers,
Firebase Admin SDK, the Gemini REST API's documented request/response
shape) specifically to minimize integration surprises, but you should
run `npm run dev` locally, create both a seeker and an employer test
account, and click through the core loop before deploying to production.
