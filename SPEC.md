# Planner — Accounts, Roles & Guardian Panels

Design spec for adding accounts, three roles, and shared student ↔ guardian planning
on top of today's local-first, end-to-end encrypted planner.

Status: **draft for review — no code written yet.**

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
| Accounts | **Required.** Sign in or sign up before using the planner. No anonymous mode. |
| Sign-in | Username **or** email + password. **Passkey** (phone PIN, fingerprint, face, or desktop biometric) — offered at sign-up, strongly encouraged. |
| Recovery | Three tiers: **password → approved trusted device → recovery key**. The recovery key is shown once at sign-up, re-viewable and downloadable from the panel. |
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
- **Forgot password** — three ways back in, tried in order:
  1. **A trusted device that is already signed in.** The new device asks for
     help; the phone/tablet shows *"Someone is signing in to your planner"*,
     unlocks with PIN/face/fingerprint, and approves. The wrapped DEK travels to
     the new device encrypted to that device's own key — the server relays bytes
     it cannot read. The user then sets a new password.
  2. **A passkey**, where one was registered.
  3. **The recovery key** — the last resort. Unwraps the DEK, then set a new
     password and a new recovery key.

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

1. Guardian enters the student's username (or email) or generates an **invite code**
   (short, expires in 24–72h).
2. The student sees the request with the proposed preset and scopes, and either
   **accepts, edits the scopes, or declines.** Nothing is visible before acceptance.
3. On acceptance the student's client wraps the vault DEK for the guardian's public
   key and the server stores the wrapped blob. The server cannot unwrap it.
4. Either side can unlink at any time. Unlinking by the student **rotates the DEK**,
   re-encrypts, and re-wraps for remaining guardians — old ciphertext becomes
   unreadable to the removed guardian.
5. The student can revoke a single scope without unlinking entirely.

### Transparency

- **Preview as guardian** — the student sees exactly what a given guardian sees.
- **Guardian activity log** — the student can read every action a guardian took.
- **Mutual watching** is the point: visibility runs both ways.

---

## 8. Panels and routes

```
/                       Landing page (marketing)
/login  /signup  /recover
/app#/today             Personal panel — identical for everyone
/app#/students          Guardian: roster
/app#/students/:id      Guardian: one student dashboard + plan editor
/app#/my-guardians      Student: links, scopes, proposals inbox
```

Settings gains a **My role** section that appears only when a role is active.
Routes are gated server-side by link status, never by a role flag from the client.

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

## 9. Charts — simple, but telling everything

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

- Argon2id client-side for the KEK; Argon2id again server-side on the auth token.
- Server stores no plaintext password, no DEK, no vault content.
- Every read is authorised server-side against `links`; roles from the client are
  never trusted.
- Rate limiting and lockout on auth, invites, and link endpoints (reuse
  `src/server/security.ts`).
- Guardians: passkey or 2FA strongly encouraged; they can edit someone else's data.
- Security alerts for new devices and new links.
- Full export and full account deletion, including the encrypted vault rows.
- CSP stays `script-src 'self'` — no third-party auth SDK is possible, so every
  piece is ours (which the encryption model wants anyway).
- A written threat model update in `SECURITY.md` before launch.

---

## 14. Migration

- **Existing local data:** on first sign-in the app finds local data and offers
  *"Keep this planner and attach it to your account"*. It is then uploaded as the
  user's vault. Nobody loses data.
- **Existing sync codes:** the code-derived key wraps the DEK during migration, so
  current sync keeps working and the code stays valid until the user turns it off.
- `README.md` and `SECURITY.md` currently promise "no accounts" — both are rewritten
  as part of this work.
- The zero-login path is removed, so `DATABASE_URL` becomes a hard requirement for
  auth. The app still works fully offline once signed in.

---

## 15. Phases

| Phase | Scope |
|---|---|
| **0** | Landing page, `SPEC.md` sign-off, threat model update |
| **1** | Auth: name + username or email + password, recovery key (copy/download), passkey enrolment, sessions, trusted devices, device revoke, claim local data |
| **2** | Vaults: encrypted vault per account, multi-device, offline open, approved-device password recovery |
| **3** | Roles and linking: invites, student acceptance, scopes, presets, revocation |
| **4** | Guardian read-only: roster, dashboards from archives, change feed, tombstones, attribution |
| **5** | Write access: plan editor, proposals, reasons, undo, audit log, shared timeline |
| **6** | AI on both sides: proposals, weekly narrative, risk flags |
| **7** | Extras: templates, syllabus → term plan, optional push for installed apps, meeting one-pager |

---

## 16. Open questions

1. Is the landing page static marketing, or does it also handle pricing/FAQ?
2. Should a guardian be able to see two students side by side (compare view)?
3. Minimum age, and does the app need a parent-managed mode for under-13s?
4. Does anything need to survive for school record-keeping beyond the configurable
   retention window?
5. Usernames are public-ish and can be enumerated — acceptable, or make them
   non-discoverable and invite-only?
6. Is a **display name** required at sign-up? Guardians need something human to see
   in their roster, but a real name is more identifying than a nickname.
7. Should push ship in phase 7, or earlier alongside the installed-app build?
