# Afriforce

A real, deployable Next.js app implementing the Afriforce V1 core loop
(onboarding → economic profile → skills assessment → opportunity radar →
next-best-action) plus Freelance, Business Builder + Copilot, an Employer
search, a lightweight talent marketplace, and an admin overview — backed
by Firebase (Auth + Firestore) and Gemini.

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
   region). No security rules to configure — the app never accesses
   Firestore from the browser, only server-side via the Admin SDK, so the
   default "locked" rules are fine and are never actually evaluated for
   this app's traffic.
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

**Known gaps, worth fixing before this handles real users:**
- **No organization-level employer accounts.** Employer is a role on an
  individual Firebase user, not a company with multiple seats/members.
- **Rate limiter isn't atomic.** It counts Firestore documents in a time
  window rather than using an atomic counter, so two concurrent requests
  near the boundary could both slip through. Fine for an MVP deploy;
  swap in a dedicated limiter before this is public.
- **No email verification or password reset UI.** Firebase Auth supports
  both (`sendEmailVerification`, `sendPasswordResetEmail`) — they're just
  not wired into the frontend yet.
- **No real opportunity sourcing.** Job/business/candidate listings are
  generated by the model, not pulled from real job boards or a vetted
  employer network — they're clearly labeled as such in the UI, and that
  labeling should stay even after you add real sources.
- **No multilingual/voice layer**, despite the architecture in the docs
  calling for one — English only.
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
