# Planner — Accounts, Roles & Guardian Panels

Design spec for adding accounts, three roles, and shared student ↔ guardian planning
on top of today's local-first, end-to-end encrypted planner.

Status: **partly shipped — the plan and the product have to agree again.**

This document is still the reference for the account, vault and panel model, but
phases 0–5 have now been built, some of them differently than written here.
§15 records what actually shipped and what did not; §16 keeps only the questions
that are still open. Where this spec and the code disagree, **the code is what
users have** — read §15 before treating any phase below as a to-do list.

---

## 1. Principles

1. **Personal first.** The personal planner is the product. Roles are additive; they
   never degrade the personal experience.
2. **Trust, not surveillance.** Students who feel watched keep a second, invisible
   planner. Every visibility decision is made with that in mind.
3. **The server is a librarian, not a reader.** It knows who you are and who you are
   linked to. It cannot read a task, a note, a mood, or a reason.
4. **Planners are about now and next.** Detail is kept while it is useful and folded
   into results afterwards. Nothing grows without bound.
5. **Every automated action is reversible and attributable.**

---

## 2. Locked decisions

| Area | Decision |
|---|---|
| Accounts | **Required** of any build with a server address: sign in or sign up first, no anonymous mode. A build compiled without one (`local_only_build`) opens the planner offline with no account at all and says so — see §14. |
| Sign-in | Username **or** email + password. **Passkey** (phone PIN, fingerprint, face, or desktop biometric) — offered at sign-up, strongly encouraged. |
| Recovery | Three tiers, all built: **password → approved device that still holds the key → recovery key**. A trusted device sets a new password from Settings without the old one (it re-wraps the key it already holds) and rotates the recovery keys at the same time; the recovery key is shown once at sign-up, re-viewable and downloadable from the panel. |
| Encryption | End-to-end. Server stores ciphertext only. |
| Notifications | **In-app everywhere.** Installed apps (PWA / desktop) may opt into **content-free push**. Never email. |
| Student privacy | **Guaranteed private zone.** Items marked private are invisible to every guardian, with no override. |
| Explaining changes | Required only for **significant** changes; one-tap reason chips plus an optional sentence. |
| Guardian types | **Parent** and **Academic advisor** — one panel, different default scopes. |
| Retention | Full detail inside the hot window; **weekly rollup to results** afterwards. |
| AI | Assists both sides. AI and guardian changes land as **reviewable proposals**, never silent writes. |
| Local-first | Still true. Editing works offline; signing in and signing up need a connection. |
| Panel details | **A panel asks for two things before it opens.** Student: **field** and **grade**. Guardian: **type** (Parent / Advisor) and **field**. Skip stays personal. |
| Panels | **Optional and additive.** Someone may pick the student panel, the guardian panel, both, or **none** and simply use the personal panel. Choosing one never removes the personal planner; the dashboard is the hub that opens each panel. A panel can be added or removed at any time, and removing one deletes nothing. |

---

## 3. Roles

> **Status: partly.** Roles and the optional panels shipped as written here — role at
> sign-up, panel switched on, both panels can run at once, all of it toggled from
> Panels. **Scope presets did not ship**, and the preset table below is not the
> product: a link is a single relationship with a per-link results key, not a set of
> per-scope toggles (see §7 and §15, phase 3).

**Panels are optional.** The account role picked at sign-up only decides which
panel is switched on first — it is never a mode the planner is locked into:

- Pick nothing (or **Skip**) → the personal planner, exactly as it is today.
- **Student panel** → adds subjects, exams and a weekly summary.
- **Guardian panel** → adds the roster and weekly results (Parent or Advisor).
- Any combination can be turned on or off later from **Panels**, reachable from
  the dashboard. The dashboard shows a tile per enabled panel.

Roles are **capabilities attached to an account**, not mutually exclusive boxes.

- **Personal** — the default. A vault with no links. This is today's app, unchanged.
- **Student** — a vault plus outgoing links to guardians. Means: *"I'm open to being
  linked; here are my scopes."* Without a link it behaves exactly like Personal.
- **Guardian** — incoming links to one or many students. Parent and Advisor are scope
  presets over the same code path. A guardian keeps their own personal planner too.

An account can hold several roles at once (a PhD student is both a student of their
advisor and a mentor to undergrads).

### Scope presets

| Scope | Parent | Advisor |
|---|---|---|
| Plan, tasks, events | ✅ | ✅ |
| Completions and misses | ✅ | ✅ |
| Habits, sleep, daily essentials | ✅ | ⬜ unless study-relevant |
| Mood check-ins | ✅ | ⬜ opt-in |
| Focus and study time | ✅ | ✅ |
| Subjects, deadlines, exams | ⬜ | ✅ |
| Notes and journal | ⬜ (student shares explicitly) | ⬜ |
| Edit the plan | ✅ | ✅ |
| Set goals and milestones | ✅ | ✅ |

Every scope is a per-link toggle, so a parent can switch mood off for a 17-year-old
and an advisor can be granted it. A fourth preset (**Tutor** — one subject) can be
added later without new machinery.

---

## 4. Architecture

> **Status: one line of this diagram is wrong.** The guardian's browser does **not**
> hold the student's vault key and never decrypts the vault; it holds a per-link
> results key that opens the weekly snapshot the student chose to share
> (`src/auth/links.ts`). The rest — the server as a librarian that only ever stores
> ciphertext, no server-side event table, charts and "why" computed in the browser —
> is what shipped.

```
┌─ Server (Neon + Vercel Functions) ───────────────┐
│  accounts, usernames, password verifiers,        │
│  sessions, devices, wrapped vault keys,          │
│  links (guardian ↔ student), invites,            │
│  vault rows: { id, version, ciphertext }         │
│  → cannot read any planner content               │
└──────────────────────────────────────────────────┘
┌─ Browser ────────────────────────────────────────┐
│  decrypt vault → planner state                   │
│  decrypt linked students' vaults → their state   │
│  compute charts, change feed and "why" locally   │
└──────────────────────────────────────────────────┘
```

Because the guardian's browser holds the student's decryption key, it can derive the
entire notification feed by diffing the student's vault against its own
`lastSeenAt`. **No server-side event table exists**, and none is needed.

---

## 5. Data model

> **Status: approximate.** The shipped schema is `db/auth.sql` and `db/schema.sql`:
> `planner_users`, `planner_credentials`, `planner_vaults`, `planner_sessions`,
> `planner_passkeys`, `planner_auth_events`, `planner_links` (whose `code_hash` /
> `code_expires_at` columns absorbed the `invites` table), `planner_sync`,
> `planner_push_subscriptions` and `planner_push_jobs`. `Attribution`,
> `ChangeRecord`, `Tombstone` and `GuardianView` were never added; the panels carry
> their own types in `src/types.ts`.

### Server tables

| Table | Contents |
|---|---|
| `users` | id, username, email (optional), role flags, created_at |
| `credentials` | user_id, password verifier (Argon2id), salts |
| `passkeys` | user_id, credential id, public key, label |
| `sessions` | id, user_id, device label, ip/agent, expires_at, last_seen |
| `vaults` | owner_id, version, ciphertext, wrapped keys, updated_at |
| `links` | guardian_id, student_id, preset, scopes[], status, created_at |
| `invites` | code hash, from_user, to_email/username, preset, expires_at |
| `recovery_codes` | user_id, hash, used_at |

The existing `planner_sync` table folds into `vaults`.

### Encrypted vault payload

`PlannerState` today:

```
tasks · events · fixedCommitments · aiMemory · aiPlans · habits
completions · goals · notes · moods · intentions · focusLog
```

Additions:

```ts
interface Attribution {            // on every mutable item
  updatedBy: string;               // userId, or 'ai:<model>'
  updatedAt: string;
  createdBy?: string;
}

interface ChangeRecord {           // kept only inside the hot window
  id: string;
  at: string;
  actorId: string;
  kind: 'added' | 'completed' | 'edited' | 'moved' | 'removed' | 'declined';
  targetType: 'task' | 'event' | 'habit' | 'goal' | 'plan' | 'note';
  targetId: string;
  title: string;                   // snapshot, so it survives deletion
  before?: string;                 // short human diff, e.g. "Tue 4pm → Thu 6pm"
  after?: string;
  reason?: string;                 // student's one-tap reason + optional note
  private?: boolean;
}

interface Tombstone {              // deletions must stay visible for a while
  id: string; title: string; deletedAt: string; deletedBy: string;
}

interface GuardianView {           // inside the *guardian's* vault
  studentId: string; lastSeenAt: string; readIds: string[];
}
```

Storing `lastSeenAt` in the guardian's own vault means unread counts follow them
across their devices for free.

---

## 6. Keys, passwords and sessions

> **Status: shipped.** One addition to the hierarchy below: the DEK can also be
> wrapped by a **passkey**, so a platform authenticator can open the vault without a
> password (`src/auth/passkey.ts`), and the packaged apps can keep that key in the OS
> keychain behind biometrics.

### Key hierarchy

```
password ──Argon2id(salt)──┬──> authToken   (sent to server, hashed again there)
                           └──> KEK         (never leaves the browser)

DEK (random, per user)  ── encrypts the vault
  ├── wrapped by KEK            → stored on server, unlocked by password
  ├── wrapped by recovery key   → printed once at sign-up, downloadable
  └── wrapped by a device key   → cached on each trusted device (offline open)
```

Because the DEK is random and merely *wrapped* by the password, changing or
resetting the password never touches the data.

### Terminology

A **passkey** is a WebAuthn credential backed by the device's PIN, fingerprint,
face, or hardware key — it *is* the "log in with your phone" flow. A **recovery
key** is a printable string that can unwrap the vault when everything else is
lost. Both live in the product; they are not the same thing, and the UI must never
call a recovery key a passkey.

### Flows

- **Sign up** — name, username (or email) + password → server returns salts →
  client derives authToken + KEK → generates DEK → uploads wrapped DEK.
- **Recovery key** — generated once, shown once with **Copy** and **Download**
  buttons, and must be confirmed before continuing. Re-viewable later from
  Settings → Security, but only after re-entering the password (and a second
  factor for guardians), because anyone holding it owns the vault forever. Never
  emailed, never included in an export file.
- **Sign in** — fetch salts → derive authToken → verify → download wrapped DEK →
  unwrap locally → decrypt vault.
- **Change password** — needs the current password only. The DEK is simply
  re-wrapped; nothing is re-encrypted. (The recovery key is *not* needed for this.)
- **Forgot password** — three ways back in, in the order they are worth trying:
  1. **An approved device that still opens the vault.** Settings → Account →
     *Set a new password*: the device already holds the vault key, so it
     re-wraps that key for a password the person will remember. No old password
     and no code are asked for; the old password stops working, the recovery
     keys are replaced in the same step and shown once, and other approved
     devices keep working because the vault key itself never changes
     (`changePasswordFromDevice`, `src/auth/session.ts`).
  2. **A passkey**, where one was registered.
  3. **The recovery key** — the last resort. Unwraps the DEK, then set a new
     password and a new recovery key.

  (The device-to-device *approval* relay described in this spec's earlier draft
  — a new device asking a signed-in one for help — was never built and is not
  needed: a device that cannot open the vault has nothing to prove with, and the
  recovery key covers the fresh-device case. What ships is the tier that does
  not need a second device.)

  There is no email reset link, because no email can decrypt a vault. This is
  stated plainly in the UI rather than hidden.

### Passkeys

- Offered immediately after sign-up, on any device with a fingerprint sensor,
  face unlock, PIN, or hardware key — phones most of all, since the phone is the
  device people always have.
- *Level 1 (all browsers):* passwordless sign-in. The vault opens because this
  device is trusted; a fresh device still needs the password.
- *Level 2 (Chrome/Edge and other PRF-capable browsers):* the passkey derives a
  wrapping key, so the vault opens on any device with a touch and no typing.
- Guardians are encouraged to keep both a passkey and a password, since their
  account can edit someone else's planner.

### Trusted devices and offline

- After a successful sign-in the device caches the session and the DEK wrapped by
  a **device key** (non-extractable where the platform offers it). The app then
  opens, reads, and edits **fully offline** — no email, no push, no re-login.
- Device trust lasts until the user revokes it, with a long online check-in
  window (30 days) and an optional local PIN or biometric re-unlock after
  inactivity. A user who disappears offline for months still comes back to their
  planner.
- Revoking a device takes effect the moment that device reconnects — honest
  messaging here beats a false promise of instant remote wipe.
- Sign-up and sign-in always need a connection. The first-run screen says so
  ("you'll need to be online the first time"), and the offline promise covers
  everything after that.

### Sessions

HttpOnly + Secure + SameSite cookies; rotation on login and on any privilege change;
a device list with remote revoke; a short "recent activity" list. Rate limits on
every auth endpoint, reusing `src/server/security.ts`.

### Offline

A signed-in device caches the wrapped DEK and session, so **opening and editing the
planner works offline** — a planner you cannot open on a plane is broken. Only
sign-up, sign-in, and linking need a connection.

---

## 7. Linking and consent

> **Status: the pairing paragraph is shipped; the numbered list below is not, on
> purpose.** The shipped model has no scopes, no per-guardian public key and no DEK
> rotation on unlink: a link carries a per-link results key, the student re-seals it
> inside their own vault, and unlinking stops future shares — the guardian keeps what
> was already shared (`src/auth/links.ts`, `src/panels.ts`). Items 2–5, "preview as
> guardian", the guardian activity log and mutual watching were never built, and
> `SPEC.md` §15 records the change.

**How the pairing works (built).** The guardian generates a one-time invite code
and a per-link results key. The server keeps only a hash of the code and the key
sealed *by* the code; the code itself is never stored. The student enters it once,
derives the same key, opens the sealed results key and re-seals it inside their own
vault. From then on the student encrypts each week's results with that key and the
guardian decrypts them — the server moves ciphertext it can never open.

1. Guardian invites the student by username or email, or hands over an invite link
   or QR code. Pending invites expire on their own (`INVITE_TTL_DAYS = 7`), and either side can
   unlink at any time.
2. The student accepts — or simply does not, and the invite expires. Nothing is
   visible before acceptance.
3. On acceptance the student's client seals the per-link results key for that
   guardian and the server stores the wrapped blob. The server cannot unwrap it.
4. Unlinking stops future shares; what was already shared stays with the guardian
   (see `SECURITY.md`).
5. There is no per-scope revocation — sharing is all-or-nothing per link.

---

## 8. Panels and routes

> **Status: the routes shipped differently.** The panels live under the app's own
> hash routes, not `/students`/`my-guardians`, and there is no per-student URL — the
> guardian picks a student inside the panel. Actual routes: `#/panels` (chooser),
> `#/student`, `#/guardian`.

```
/                       Landing page (marketing)
/login  /signup  /recover
/app#/today             Personal panel — identical for everyone
/app#/panels            Either role: the chooser that turns the optional panels on
/app#/student           Student panel — plans, shared results, inbox
/app#/guardian          Guardian panel — roster, one student at a time, composer
```

The role is set at sign-up and pre-enables the matching panel; it is not a router.
Access is gated server-side by link status, never by a role flag from the client.

### Guardian — roster

Cards per student: one-glance state (**on track / slipping / quiet for 5 days**),
this week's score with a sparkline, unread change count, sorted by needs-attention.

### Guardian — student dashboard

Charts (below), this week's plan, the change feed, and a composer for a note or a
proposed change.

### Guardian — plan editor

Bulk actions, not a task-by-task form: *lighten Thursday*, *shift everything after
6pm*, *apply exam-prep week*, *add a milestone*. Every action is undoable, logged,
and (optionally) queued for the student's approval.

### Student — panel

Daily / weekly / monthly plans, a "shared with" card (who sees what, one tap to
change), a proposals inbox with accept / decline / comment, the private toggle, and
a **"this is too much today"** button that asks the AI to rebalance and notifies the
guardian.

---

## 9. Charts

**What each AI may see (built).** The student's own AI reads one week of their
planner — tasks due that week, subjects, focused minutes, and what they wrote.
The guardian's AI reads weekly results and nothing else: counts, minutes, subject
names, the student's headline, and at most eleven earlier weeks. Both prompts are
built by one function each, and both are covered by tests that fail if a task
title or a note ever reaches the wrong one.
 — simple, but telling everything

**Hero:** one **week score** (completion vs. the student's own 4-week baseline) with
a sparkline, plus 2–3 AI-written sentences:

> Sara finished 78% of her plan, up 12% on last month. Her mood dropped on the three
> days she studied past 10pm. Thursday looks overloaded — consider moving one session.

**Six supporting charts** — reusing the existing maths in `src/insights.ts`:

1. **Completion trend** (7 / 30 / 90 days) against their own baseline.
2. **Mood × load overlay** — planned items vs. mood. Spots burnout before grades do.
3. **Week rhythm heatmap** — weekday × hour of completions: when they *actually* work.
4. **Habit grid** — GitHub-style, with rest days marked so a break isn't a failure.
5. **Plan vs. actual** — estimated vs. focus-timer minutes. Reveals chronic over-planning.
6. **Balance donut** — study / rest / chores / social.

Two rules: **every chart carries one plain-language "so what?" line**, and no
red failure badges. Framing is supportive, or students will game the data.

---

## 10. Change feed and "why"

> **Status: not built.** There is no change feed or tombstone list in the shipped
> panels — the guardian sees shared weekly results instead (§15, phase 4). Kept as
> the design for a live view, if one is ever wanted.

The feed is computed in the guardian's browser: items whose `updatedAt` is newer
than the guardian's `lastSeenAt`, plus tombstones for removals.

### When the student is asked for a reason

| Change | Behaviour |
|---|---|
| Completing a task, adding tasks, minor edits, notes | **Silent** — logged, no prompt |
| Deleting a guardian-created task | **Reason required** |
| Pushing a deadline back | **Reason required** |
| Clearing a day, or marking something "won't do" | **Reason required** |
| Declining a guardian proposal | **Reason required** |

Reasons are **chips** — *Too much today · Already done · Wrong date · Need help ·
Other* — with an optional sentence. Prompts read *"Let your parent know"*, never
*"Explain yourself."*

### The reverse direction

A guardian can tap any change and **ask a question** ("Was Thursday's homework too
heavy?"). It lands in the student's inbox as a question, not an accusation. Async,
one tap to answer, and far more useful than a mandatory justification field.

### Guardian-to-guardian

Both adults see each other's changes on a **shared per-student timeline** visible to
parents, advisors and the student, with filters. Immediate for student changes;
batched into the weekly view for co-guardian edits, so two adults don't ping-pong.

### Conflicts

Per-item last-write-wins with a visible "changed by" marker. The losing edit shows
*"this was moved while you were editing"* instead of silently vanishing.

### How a notification reaches you

The feed is always computed locally, whatever the platform. Only the *nudge* differs:

| Platform | Delivery |
|---|---|
| Website in a browser tab | **In-app only** — a badge in the panel. No OS permission prompt, ever. |
| Installed app (PWA / desktop) | **Optional push** — the user opts in; the OS delivers it. Falls back to the in-app badge if declined. |
| Web without a service worker | In-app only. |

Push payloads are **content-free**: they carry *"something changed in Sara's plan"*
and nothing else — no titles, no names, no reasons. The real text is decrypted on
the device when the app opens. That matters because push payloads pass through
Apple's and Google's servers, and we never hand them a student's data.

Two further safeguards:

- The **student's device** sends the ping, not the server — the server cannot read
  the vault, so it cannot know a change occurred on its own.
- Pings are **batched and rate-limited** (at most one per student per hour), so
  neither the server nor the push provider can reconstruct someone's daily rhythm
  from notification timing.

The app already ships a service worker (`src/pwa.ts`), so web push is an addition
rather than a rebuild. iOS supports it only for home-screen-installed apps, which
matches the "installed apps may notify" rule exactly.

---

## 11. Retention and the weekly rollup

> **Status: client-side only.** The weekly rollup shipped (shared results, AI weekly
> review); the configurable hot window and server-side folding did not — everything
> lives on the device and nothing expires by itself.

Planners are about now and next, so **detail is temporary, results are permanent.**

### Hot window

Current week **plus the previous week** (configurable: 1 / 2 / 4 / 12 weeks / keep
everything). Inside it, everything is kept at full fidelity: items, change records
with reasons, tombstones, AI drafts, note revisions, focus sessions.

### After the window: roll up

```ts
interface WeekArchive {
  weekStart: string;
  days: { date: string; ratio: number | null; mood: number | null;
          plannedMinutes: number; focusMinutes: number }[];
  tasksDone: number;   tasksTotal: number;
  eventsDone: number;  eventsTotal: number;
  habits: { habitId: string; name: string; done: number; target: number;
            streakEnd: number }[];
  focusMinutes: number; focusSessions: number;
  moodAverage: number | null;
  goals: { goalId: string; title: string; milestoneDone: number;
           milestoneTotal: number }[];
  categories: Record<string, { done: number; total: number }>;
  // accountability, as counts only — no content
  changes: { byStudent: number; byGuardian: Record<string, number>;
             byAI: number; removed: number; deferred: number };
  guardianItems: { assigned: number; completed: number };
  narrative?: string;      // optional AI paragraph, written at week close
}
```

Roughly a few hundred bytes per week — **~25 KB per year.** Kept forever.

**Dropped at rollup:** change records and reasons, tombstones, superseded plan
versions, note revision history (current text is kept), individual focus sessions
(day totals are kept), AI draft bodies (title, date and summary are kept).

**Never archived:** anything unfinished, undated, or in the future. Habits, goals,
notes and the private zone are unaffected. Attachment bytes are only released when
no surviving note references them.

### Properties this buys us

- The encrypted vault stops growing: **the 3 MB sync cap is no longer a risk**, even
  after years of use and with a guardian watching many students.
- Old charts read archives, never raw history — so **the archive *is* the digest.**
  The 30/90-day trends and year-in-pixels come from ~7 numbers per week.
- A breach of a dormant account reveals summaries, not a journal.
- Guardian dashboards stay fast regardless of history length.

### Mechanics

- The rollup runs **client-side** (the server cannot read the data).
- It is **deterministic and idempotent**: any client computing it for the same week
  produces identical output, so a race between the student's and a guardian's client
  is harmless under last-write-wins.
- It runs when the app is opened on or after the following Monday, with a **2-day
  grace period** so a Sunday-night check-in still counts.
- **Export before rollup**: a "Download this week in full" option, and a
  "keep everything" setting for users who want it (with an honest size warning).
- Schools that need records can set a longer window; nothing is deleted without the
  owner having had the chance to export it.

---

## 12. AI on both sides

> **Status: partial.** The student side shipped as the AI coach — rebalancing,
> breaking work down, weekly review, saved memory, voice and Persian — but the two
> advisor-facing rows in the table did not: nothing drafts an "explain this plan"
> note, and an exam-date back-plan is only whatever the general planner produces,
> with no dedicated flow. On the guardian side, `generateGuardianGuidance` returns a
> narrative, one focus and one `watchOut` risk line computed from weekly totals;
> drafting a plan or a message for a guardian was not built.

| Student | Guardian |
|---|---|
| "I can't do today — make it lighter" (rebalances and notifies) | "Why is Amir slipping?" → narrative from the data |
| Back-plan from an exam date → a term study plan | "Draft next week for Amir" → a proposal |
| Break a scary assignment into subtasks | "Compare this month to last" |
| "Explain this plan to my advisor" | Draft a note to the student or their parents, tone-checked |
| Voice-first, including Persian (already built) | Risk flags: overdue clusters, avoidance patterns, mood dips |
| | Auto-generated agenda for the next advising meeting |

**Boundaries**

- AI and guardian changes land as **reviewable drafts** on the Plans page, reusing
  the existing `SavedAIPlan` flow with `proposedBy` plus an approval state. Nothing
  is written silently.
- AI memory is **private by default**, with an explicit share flag per item.
- Prompts are scoped to one student; asking about Sara never pulls in Amir's data.
- Every suggestion states **why** ("move this to Friday — Thursday already has 6
  hours").
- A visible "what will be sent" line before any request leaves the device.

---

## 13. Security

> **Status: shipped, with one correction.** The stored-credential scheme is Argon2id
> in the browser and **scrypt** on the server, not Argon2id twice; the rest of this
> list is in the code. Deep links, passkeys, TOTP, biometric unlock and push have
> since been added and are described in `SECURITY.md`.

- Argon2id client-side for the KEK. The auth token that reaches the server is stored
  only as a salted scrypt verifier (`N=16384`), never as a usable proof.
- Server stores no plaintext password, no DEK, no vault content.
- Every read is authorised server-side against `links`; roles from the client are
  never trusted.
- Rate limiting and lockout on auth, invites, and link endpoints (reuse
  `src/server/security.ts`).
- Guardians: passkey or 2FA is offered like anyone else's account. Their only write
  path is the panel's shared plan and goal suggestions, which arrive in the student's
  inbox to tick, accept or decline (`answerGoalSuggestion`); the student's personal
  planner items are never touched by a guardian.
- Alerts are in-app, never email: the account activity list records new devices,
  new networks and recovery, and sessions can be revoked from Settings.
- Full export and full account deletion, including the encrypted vault rows
  (`src/auth/session.ts`).
- CSP stays `script-src 'self'` — no third-party auth SDK is possible, so every
  piece is ours (which the encryption model wants anyway).
- The threat model update in `SECURITY.md` is written and now covers the account,
  biometric and deep-link surfaces (reviewed 2026-10-05).

---

## 14. Migration — what happened

- **Existing local data:** shipped. Whatever the device already had travels with the
  sign-up request (`localState` on `SignupRequest`, `src/auth/session.ts`) and becomes
  the new account's vault, so signing in does not discard a planner.
- **Existing sync codes:** still shipped, and still account-free. The code-derived key
  remains the only secret on that path (`src/sync.ts`); accounts and sync codes are two
  independent systems and a planner can use either or both.
- **"No accounts" in the docs:** rewritten where it mattered, but the README's opening
  paragraph and its attachments bullet still said "no accounts" long after accounts
  shipped. Both are corrected.
- **The zero-login path:** removed for connected builds. With a server address,
  sign-in is unavoidable and `DATABASE_URL` is a hard production requirement —
  `/api/auth/status` answers `storage: "none"` and every account endpoint 503s without
  it. The one exception is a **build compiled with no server address**
  (`local_only_build`): it opens the offline planner and tells the user there is
  nothing to sign in to (`src/auth/AccountGate.tsx`). Accounts are required of
  deployments, not of the source.

---

## 15. Phases — what actually shipped

| Phase | Scope | Status |
|---|---|---|
| **0** | Landing page, `SPEC.md` sign-off, threat model update | **Done.** Landing ships with hero, roles and an FAQ section (`src/marketing/Landing.tsx`); `SECURITY.md` holds the threat model. There is no pricing page, because there is no paid tier. |
| **1** | Auth: name + username or email + password, recovery key, passkey enrolment, sessions, trusted devices, device revoke, claim local data | **Done**, plus TOTP second factor and biometric unlock for packaged apps, both added after this spec. Recovery is an approved device, a saved recovery key, or a passkey. |
| **2** | Vaults: encrypted vault per account, multi-device, offline open, approved-device password recovery | **Done.** Vault, multi-device and offline / trusted-device open ship (`src/auth/vault.ts`), and an approved device can now set a new password without the old one, re-wrapping the key it already holds. The device-to-device approval relay for a device that *cannot* open the vault was not built (see §12): it has nothing to prove with, and the recovery key covers that case. |
| **3** | Roles and linking: invites, student acceptance, scopes, presets, revocation | **Done, minus scopes and presets.** Role at sign-up, guardian invites by link or QR, student acceptance, link status and revocation all ship. Sharing is not per-scope; it is the weekly snapshot in phase 4. |
| **4** | Guardian read-only: roster, dashboards from archives, change feed, tombstones, attribution | **Changed on purpose.** The guardian gets a roster and **weekly results the student chooses to share** (`src/views/GuardianPanelView.tsx`) — not a live scoped dashboard. There is no change feed and no tombstone list, and a compare-two-students view was not built (§16). |
| **5** | Write access: plan editor, proposals, reasons, undo, audit log, shared timeline | **Partly, and lighter than this spec.** A guardian composes a plan or suggests a goal; both land in the student's inbox, where the student ticks items off and accepts or declines (`StudentPanelView.tsx`, `src/panels.ts`). The student's own planner items are never written to. Proposals as a separate review object, undo, the audit log and a shared timeline were not built. |
| **6** | AI on both sides: proposals, weekly narrative, risk flags | **Partly.** The personal AI coach ships in full (plan, weekly review, saved memory). Guardians get `generateGuardianGuidance` — a summary, a focus, and one `watchOut` risk line (`src/ai.ts`). AI-authored proposals were not built. |
| **7** | Extras: templates, syllabus → term plan, optional push for installed apps, meeting one-pager | **Mostly.** Templates, ICS/CSV/JSON import and opt-in content-free push for installed apps all ship. No syllabus → term-plan importer; no meeting one-pager. |

**Not built, in one list:** the device-to-device approval relay, guardian scopes
and presets, live scoped dashboards / change feed / tombstones, proposals, undo,
the shared audit log, AI proposals, syllabus import, meeting one-pager, and
guardian compare view. Everything else in this document exists in some form.

---

## 16. Open questions

Answered questions are recorded here rather than deleted, so nobody re-opens them.

**Answered during the build**

1. *Static marketing or pricing/FAQ?* — **Static marketing with an FAQ.** Four
   questions ship in `src/marketing/Landing.tsx` and `copy.ts`; no pricing page,
   because there is no paid tier.
2. *Is a display name required at sign-up?* — **Yes.** The form collects a name and
   it is what a guardian sees in the roster (`src/marketing/Auth.tsx`).
3. *Should push ship in phase 7, or earlier?* — **It already shipped**, as an opt-in,
   content-free push for installed apps only (`src/push.ts`, `src/server/pushApi.ts`).
4. *Usernames are enumerable — acceptable, or invite-only?* — **Handled in the API.**
   The salt and recovery-start endpoints answer with a deterministic decoy for
   unknown accounts, and sign-up is rate-limited; `username_taken` on sign-up is the
   one remaining signal, and it is inherent to letting people pick a name.

**Still open**

5. **A guardian compare-two-students view.** Not built (phase 4). Needs a decision
   about what is fair to compare across two different students before it needs code.
6. **Minimum age, and an under-13 parent-managed mode.** Nothing in the code or the
   data model records age or consent. This is a product and legal decision before a
   school rollout, not an engineering one.
7. **Anything that must outlive the retention window for school records.** Weekly
   results are snapshots the student shares and everything else stays on the device;
   a records-retention story would be new scope.
8. **Whether `FocusHistory`, `StatsWidget`, `WeeklyReview` and `MatrixView` are
   provisional** — nothing in the code marks them either way
   (`PERSONAL_PANEL_AUDIT.md` §15).
9. ~~**Approved-device password recovery**~~ — built on 2026-10-05: an approved
   device whose vault key is in hand sets a new password from Settings → Account
   and rotates the recovery keys in the same step. What remains unbuilt is the
   *relay* for a device that cannot open the vault at all, which the recovery key
   already covers.

---

*Reconciled with the shipped build on 2026-10-05. The audits
(`CODE_AUDIT.md`, `UI_AUDIT_REPORT.md`, `PERSONAL_PANEL_AUDIT.md`, `REPORT.md`)
carry matching status notes.*

---

## 17. Roadmap (short, and honest about size)

Nothing here is committed. It is the work the spec and the audits leave behind,
roughly in the order it would pay off.

**Engineering — small**

1. ~~Commit the visual baselines.~~ Done: the workflow generated them, committed
   them to this branch and the next run compared against them green
   (`e2e/visual.spec.ts-snapshots/`, `docs/VISUAL_TESTS.md`).
2. ~~**A touch-target check in the visual suite**~~ Done:
   `e2e/touch-targets.spec.ts` grades the thumb and dense-control floors in the
   phone project.
3. **Persist the Weekly Review reflection** as a note if people ask for it; today it
   exists only inside the exported report (`REPORT.md` §7).

**Engineering — larger**

4. ~~**Approved-device password recovery**~~ Done (phase 2 above): Settings →
   Account → *Set a new password* re-wraps the key the device already holds.
5. **Guardian AI proposals** — draft a plan or a note from the same weekly totals
   `generateGuardianGuidance` already reads, with the student accepting or declining.
6. **Guardian compare-two-students view**, once the fairness question in §16 is
   answered.

**Product / legal — decide before building**

7. **Minimum age, consent, and an under-13 parent-managed mode.** Nothing records age
   or consent today; this has to land before any school rollout.
8. **School-records retention** beyond the weekly snapshots a student shares.

**Deliberately not planned**

A live scoped guardian dashboard with a change feed, tombstones and an audit log — the
shipped model is snapshot-based and the audits show it is the safer product (SPEC §15,
phase 4) — and a paid tier, which is why the landing page has no pricing page.
