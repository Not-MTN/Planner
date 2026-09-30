# Personal Panel Architecture Audit

**Repository:** `Not-MTN/Planner` · branch `arena/01a0f378-planner` · base commit `606765e4cd0ff35e2fd9429105f13515c55f4dcf`
**Date of audit:** 2026-09-30
**Scope:** the authenticated Personal Panel — architecture, navigation, features, roles, settings, implementation status, overlaps, orphans.
**Method:** source-code reading only. No files were modified, renamed, moved, deleted or redesigned.
**Confidence tags used throughout:** `[CONFIRMED]` (read directly in code), `[PARTIALLY CONFIRMED]` (code read but scope/behaviour inferred), `[UNCLEAR]`, `[NOT FOUND]`.

> Note on this document: it is a new, additive markdown file created for this audit. Nothing in `src/`, `api/`, `db/` or config was touched.

---

## 1. Application Architecture Overview

### 1.1 Two bundles, one repository

`[CONFIRMED]` `src/main.tsx` boots **one of two independent React trees**, decided by `bootTarget()` (`src/main.tsx:24-50`):

| Bundle | Entry | URL space | Loaded when |
|---|---|---|---|
| Marketing site | `src/marketing/Site.tsx` (lazy) | `/`, `/login`, `/signup`, `/recover` | any path that is not `/app` |
| Planner app (the authenticated app) | `src/auth/AccountGate.tsx` (lazy) → `src/App.tsx` → `src/context.tsx` → `src/components/Shell.tsx` | `/app` (+ `#/…` hash router) | path `/app` or `/app/…`, or legacy `/#/today` redirect |

`vercel.json:7-14` rewrites `/app`, `/login`, `/signup`, `/recover` to `index.html`. The marketing bundle never downloads the planner bundle and vice-versa (`src/main.tsx:14-18`, comment at the top of `main.tsx`).

`[CONFIRMED]` The marketing site is *not* the authenticated area and is out of scope for this audit, except as the entry point to it. Its router is `src/marketing/Site.tsx:28-33` (`readPath()`), rendering `Landing` or `Auth` in `signin` / `signup` / `recover` mode.

### 1.2 The authenticated app

```
/app
  └─ src/main.tsx  →  AccountGate                       (src/auth/AccountGate.tsx)
        ├─ no session        → window.location.assign('/login')
        ├─ session, no key   → "Unlock your planner" (password) screen
        ├─ trusted device    → ready / offline-trusted (works without network)
        ├─ network down      → offline boot, local copy
        └─ key in memory     → <App initialState>
              └─ PlannerProvider (src/context.tsx — all state, undo/redo, theme,
                 sync, panels, reminders, feeds, focus timer, palette, settings)
                    └─ Shell (src/components/Shell.tsx — layout, nav, sheets,
                       route → view switch)
```

`[CONFIRMED]` There is **no URL router library**. Navigation is a hand-written hash router in `src/route.ts`:

- `Route` union: `src/route.ts:4-27` — `today | day | calendar | tasks | habits | goals | notes | insights | plans | matrix | review | panels | student | guardian | quickadd | ai`.
- `parseHash()`: `src/route.ts:37-58` (unknown hash → `today`).
- `toHash()`: `src/route.ts:63-77`.
- `routeTitle()`: `src/route.ts:84-113`.
- Shell's route→view switch: `src/components/Shell.tsx:425-444`.

`[CONFIRMED]` Backend is one catch-all Vercel function (`api/[...path].ts`) plus a router with **28 API paths** (`src/server/apiRouter.ts:63-137`), mounted identically in dev/preview by Vite middleware (`vite.config.ts:95-258`):

`/api/auth/{status,salt,signup,login,logout,session,vault,account,recovery/start,recovery/complete,passkey/register/options,passkey/register/verify,passkey/login/options,passkey/login/verify,passkey/delete,passkey/list,links,link-accept,share,note}`, `/api/sync`, `/api/sync/status`, `/api/ics`, `/api/groq/status`, `/api/groq/chat/completions`, `/api/push/config`, `/api/push/subscription`, `/api/push/dispatch`.

`[CONFIRMED]` Data lives **local-first**:
`localStorage` key `personal-planner.v1` (`src/storage.ts:9`), IndexedDB db `planner`, store `kv` for large state, device key cache and note attachments (`src/idb.ts:6-7`, `src/auth/device.ts:21`, `src/files.ts:14`). With an account, the same state is pushed **encrypted** to `/api/auth/vault` (`src/auth/vault.ts`, `src/context.tsx:4`); by sync code, to `/api/sync` (`src/sync.ts`); a second optional "shared space" sync exists (`src/context.tsx:704-745`, `src/components/SettingsExtras.tsx:21`).

`[CONFIRMED]` UI is bilingual English/Persian (`src/i18n.ts`, `src/locales/fa.ts` — 1 722 lines), RTL-aware, theme (`light|dark|system`) + 5 accent colours (`src/theme.ts`, `src/constants.ts:2-11`).

### 1.3 The app-level map

```
Landing (/)  ──►  Login / Signup / Recover (/login, /signup, /recover)
                        │  signup asks a "role" (personal | student | guardian)
                        ▼
                   /app  →  AccountGate (session + vault unlock)
                        ▼
            ╔═════════════════════════════════════════════════════════╗
            ║  PERSONAL PANEL  (the Shell; always present, always on) ║
            ║  today · day/:date · calendar/{week|month|agenda} ·     ║
            ║  tasks · matrix · habits · goals · notes · plans ·      ║
            ║  insights · review · ai[/review] · quickadd             ║
            ╚═════════════════════════════════════════════════════════╝
                 │                                       │
        (optional, user can switch on)          #/panels  ← the chooser
                 ├── Student panel   (#/student)  — subjects, exams, weekly results,
                 │                                   guardian inbox, own AI advice
                 └── Guardian panel  (#/guardian) — roster of students, weekly results,
                                                     notes, plans, own AI questions
```

`[CONFIRMED]` "Personal Panel" is **not** a route or a component name. It is the name the product uses for the base app in `PanelsView` copy (`src/views/PanelsView.tsx:67-71`) and in the Settings footer (`src/components/SettingsSheet.tsx:693`, `"Personal Planner · local-first · made for calm days"`). The Today page kicker says `Personal Planner` on today and `Day planner` on other dates (`src/views/DayView.tsx:110`).

---

## 2. All Application Panels

### 2.1 Personal Panel — `[CONFIRMED]` exists, is the default, and is never optional

| Item | Value |
|---|---|
| Code name | none — it is `Shell` + `PlannerProvider` (there is no `PersonalPanelView`) |
| Frontend entry | `/app` → `src/main.tsx` → `AccountGate` → `src/App.tsx` → `src/components/Shell.tsx` |
| Routes | every route in `src/route.ts:4-27` except `panels`/`student`/`guardian`; see §13 |
| Main layout | `src/components/Shell.tsx`: fixed left `aside.sidebar` (desktop) + `header.mobile-bar` + bottom `nav.tabbar` (mobile) + `main#content`; `Modal`/sheet layer (`src/components/ui.tsx:6`) |
| Navigation | `NAV` const `src/components/Shell.tsx:75-86`; grouping `:140-142`; sidebar markup `:266-288`; footer tools `:287-360`; mobile tabs `:452-462`; More sheet `:464-550` |
| Who can access | any authenticated session that can unlock the vault; also offline/trusted-device boots (`AccountGate.tsx:113-119`) |
| Access control | **frontend + session + vault only.** `bootAccount()` decides; there is no role check, no middleware, no permission table |
| Major features | Today, day view, calendar (week/month/agenda), tasks (list/board/bulk), matrix, habits, goals, notes, plans (AI drafts), insights, weekly review, AI coach, focus timer, notifications, command palette, settings, sync, shared space, calendar feeds, templates, imports/exports, PWA install |

### 2.2 Student panel — `[CONFIRMED]` optional, off by default

| Item | Value |
|---|---|
| Code name | `StudentPanel` in `PlannerState.panels.student` (`src/types.ts:196-270`), view `StudentPanelView` |
| Frontend entry | `src/views/StudentPanelView.tsx:27` (lazy-loaded in `Shell.tsx:53`) |
| Route | `#/student` (`src/route.ts:25,30`) |
| Layout | a normal `.view` inside the same Shell/sidebar; cards: identity, week overview, `StudentWorkspace`, guardian inbox, tracking charts, guardians/sharing, AI advice, "explain a change" |
| Navigation | sidebar `Panels › Student`, mobile More sheet, Today `PanelHub` tile, `PanelsView` "Open student panel" |
| Who can access | anyone who switches the panel on — **not** restricted by account role |
| Access control | frontend flag `panels.student.enabled` (+ friendly empty state at `StudentPanelView.tsx:154-166`); data sharing gated server-side by guardian link status (`src/auth/links.ts`, `db/auth.sql:planner_links`) |
| Features | subjects + exam dates + weekly targets (`src/components/StudentWorkspace.tsx`), study queue, upcoming exams, weekly results/charts (`src/components/charts.tsx`, `src/panels.ts:weekResults`), change explanations with weekly roll-off (`src/panels.ts:splitExplanations`), guardian linking by code (`src/auth/links.ts:inviteStudent` inverse `acceptInvitation`), inbox of guardian notes/plans, per-student AI advice (`generateStudentAdvice`, `src/ai.ts`), share-now, sharing preview |

### 2.3 Guardian panel — `[CONFIRMED]` optional, off by default, two sub-kinds

| Item | Value |
|---|---|
| Code name | `GuardianPanel` in `PlannerState.panels.guardian` (`src/types.ts:272-286`), `kind: 'advisor' \| 'parent'` |
| Frontend entry | `src/views/GuardianPanelView.tsx:45` (lazy, `Shell.tsx:54`) |
| Route | `#/guardian` |
| Layout | normal `.view`; overview stats, roster, expandable per-student detail, shared-updates card |
| Navigation | sidebar `Panels › Guardian`, mobile More sheet, Today `PanelHub` tile, `PanelsView` "Open guardian panel" |
| Who can access | anyone who switches the panel on |
| Access control | frontend flag `panels.guardian.enabled` (+ empty state `GuardianPanelView.tsx:233-243`); server checks link ownership on every link/share read (`src/server/authApi.ts`, `src/server/authStore.ts`) |
| Features | invite a student by username, one-time pairing code, roster with search/filter/sort (`src/panelFeatures.ts:filterGuardianLinks`), result freshness states, weekly charts, "What should I ask?" AI questions (`generateGuardianGuidance`), notes to student (`postNotice`), day/week/month plans (`src/components/GuardianPlanComposer.tsx`), plan progress from student ticks, take-back plan, stop following, shared-circle notices |

### 2.4 Panels chooser — `[CONFIRMED]`

`src/views/PanelsView.tsx:18`, route `#/panels` (`src/route.ts:24`). It is the *only* place that turns a panel on/off (`updatePanels`), asks for field + grade (student) or kind + field (guardian), and offers open/change/remove. Copy explicitly states panels "are additions to your planner, not a choice between them" (`PanelsView.tsx:67`).

### 2.5 Panels that do **not** exist — `[NOT FOUND]`

Searched the whole `src/` tree for `admin`, `teacher`, `staff`, `organization`, `institution`, `classroom`: no admin panel, no teacher/staff panel, no organization/institution panel, no supervisor/manager dashboard. The only hits are unrelated (`weather.ts` `admin1`, `copy.ts` "School advisor", `school-9…12` grade ids). Marketing copy mentions pricing in the footer label only; there is no billing/subscription/tier system in code.

---

## 3. Roles and Permissions

### 3.1 What exists — `[CONFIRMED]`

| Layer | Definition | Where |
|---|---|---|
| Account role (server) | `AccountRole = 'personal' \| 'student' \| 'guardian'` | `src/shared/authContract.ts:22-25`; DB `CHECK (role IN …)` `db/auth.sql:15`, `src/server/authStore.ts:30` |
| Signup requires a role | `cleanRole(body.role)`, 400 if missing | `src/server/authApi.ts:164-175` |
| Client sends it | `SignUpInput.role` | `src/auth/session.ts:300,320` |
| Marketing UI | 3-option role picker + optional student/guardian detail step + "Skip" | `src/marketing/Auth.tsx:10, 395-402, 683-790` |
| Runtime effect of the role | **only** pre-enabling a panel at account creation | `src/marketing/Auth.tsx:456-503` |
| Panel enablement (the real switch) | `panels.student.enabled`, `panels.guardian.enabled`, stored *inside the encrypted planner state* | `src/types.ts:196-286`; toggled in `src/views/PanelsView.tsx:37-64`; `src/context.tsx:setPanelEnabled` |

`[CONFIRMED]` **The client never reads `role` for navigation, routing or rendering.** A repository-wide search for `.role` finds it only in the server store/API, the signup payload, the voice-chat message shape and tests. `accountUser()` (`src/auth/vault.ts:63`) returns `PublicUser` (which *includes* `role`) but the Shell only uses `displayName`, `username` and `email` (`Shell.tsx:70-73, 341-360`).

### 3.2 Permissions / gates — `[CONFIRMED]`

- **Session gate:** `AccountGate` + `getActiveSession()`; `requireSession()` in `src/auth/links.ts:36-40` throws for link/share/plan calls.
- **Vault gate:** planner data cannot be read without the vault key.
- **Link-status gate (server):** reading/sending weekly results is authorised against `planner_links` rows (`db/auth.sql:66-89`), keyed by guardian id; the server only ever moves ciphertext.
- **No other gates:** no per-route guard, no permission matrix, no scope toggles per link, no role middleware, no feature flags, no subscription/account-level restrictions. `grep` for `featureFlag`/`VITE_` finds only env docs and test helpers.

### 3.3 Spec vs code — `[PARTIALLY CONFIRMED]` (documented as gap, not a defect claim)

`SPEC.md` (design document, not implementation) promises more than the code has:

| Spec (`SPEC.md`) | Code |
|---|---|
| Three roles as *capabilities* attached to an account, several at once (`SPEC.md:44-64`) | One role column, used once at signup |
| Per-link scope presets ("Parent"/"Advisor" matrix, `SPEC.md:66-84`) | Only `kind` + `field`; no per-scope toggles |
| Settings section **"My role"** that appears when a role is active (`SPEC.md:305`) | `[NOT FOUND]` — no such section in `SettingsSheet`/`SettingsExtras` |
| Routes `/app#/students`, `/app#/students/:id`, `/app#/my-guardians` (`SPEC.md:294-299`) | `[NOT FOUND]` — actual routes are `#/panels`, `#/student`, `#/guardian`; the spec paths fall through to `today` in `parseHash` |
| Student panel: proposals inbox with accept/decline, private toggle, "this is too much today" button (`SPEC.md:326-330`) | `[NOT FOUND]` — student inbox is a read/tick list |
| Guardian plan editor with bulk actions ("lighten Thursday", "shift everything after 6pm") (`SPEC.md:320-324`) | `[NOT FOUND]` — plans are composed step-by-step (`GuardianPlanComposer.tsx`) |
| Change feed with per-item "changed by" markers (`SPEC.md:394-398`) | `[PARTIALLY CONFIRMED]` — `ChangeNote` ("why") exists and rolls off weekly; no per-item change feed/merge markers |

---

## 4. Personal Panel Navigation

### 4.1 Desktop sidebar — exact current structure `[CONFIRMED]`

Source: `src/components/Shell.tsx:75-86` (`NAV`), `:136-142` (grouping), `:266-288` (markup), `:287-360` (footer).

```
Personal Panel (desktop, /app)
│
├── Brand "Planner — Calm daily planning"        → Today          (button, Shell.tsx:254)
├── Search or add…  ⌘K                           → command palette (Shell.tsx:261)   [utility]
│
├── «Plan»  (group label, Shell.tsx:269)
│   ├── Today        SunIcon       #/today
│   ├── Calendar     CalendarIcon  #/calendar/week/<today>
│   ├── Tasks        CheckIcon     #/tasks
│   └── Matrix       FlagIcon      #/matrix
│
├── «Focus» (group label, Shell.tsx:271)
│   ├── Habits       DotsIcon      #/habits
│   └── Goals        HorizonIcon   #/goals
│
├── «Track» (group label, Shell.tsx:273)
│   ├── Notes        NoteIcon      #/notes
│   ├── Plans        WeekIcon      #/plans
│   ├── Insights     ArcIcon       #/insights
│   └── AI coach     SparklesIcon  #/ai            (attention dot until first visit, Shell.tsx:275)
│
├── «Panels» (group label — ONLY when a panel is enabled, Shell.tsx:276-286)
│   ├── Student      StudyIcon     #/student       (only if panels.student.enabled)
│   ├── Guardian     HeartIcon     #/guardian      (only if panels.guardian.enabled)
│   └── All panels   HorizonIcon   #/panels        (shown whenever the group is shown)
│
└── side-foot (Shell.tsx:287-360)  — utilities, not destinations of the "Plan/Focus/Track" kind
    ├── Undo / Redo icon buttons (disabled when unavailable)
    ├── Notifications (bell + unread badge)        → modal sheet (Shell.tsx:309)
    ├── Light mode / Dark mode (single toggle)     → theme                 (Shell.tsx:316)
    ├── How it works (HelpIcon)                    → first-run tour        (Shell.tsx:324)
    ├── Settings (SlidersIcon, data-tour="settings") → settings modal      (Shell.tsx:328)
    ├── Sync status line ("Synced" / "Saved on this device" / "Offline…")
    └── Account chip (avatar initial, display name, email or @username) + Sign out
```

**Two items in your screenshot list are group labels, not destinations** `[CONFIRMED]`:
`«Plan»` = fa `"Plan": "برنامه"` (`fa.ts:686`), `«Focus»` = `"Focus": "تمرکز"` (`fa.ts:390`), `«Track»` = `"Track": "پیگیری"` (`fa.ts:987`), `«Panels»` = `"Panels": "پنل‌ها"` (`fa.ts:1254`). So "برنامه / تمرکز / پیگیری" in the screenshot are the three section headers (and `پیگیری` is *also* the fa string for the Student panel's "Tracking" card, `fa.ts:1560` — two different things share one Persian word).

### 4.2 Visibility rules

| Rule | Evidence |
|---|---|
| Today can never be hidden; every other `Plan/Focus/Track` item can | `src/navigationPrefs.ts:1,15-17`; `NavigationSection` `SettingsSheet.tsx:28-48`; stored in `localStorage` key `planner-sidebar-pages` (`navigationPrefs.ts:4`) |
| Settings copy: hidden sections "remain available from search and the mobile More menu" | `SettingsSheet.tsx:31` — `[CONFIRMED]` true for the mobile More sheet; **not** true for the command palette, which lists only a fixed subset (§6) |
| Student/Guardian sidebar entries appear only when that panel is enabled | `Shell.tsx:136-139` |
| "All panels" appears only inside the Panels group (so: only when ≥1 panel is enabled) | `Shell.tsx:276-286` |
| Panel entries are **not** user-hideable in Settings (not part of `NAVIGATION_PAGES`) | `navigationPrefs.ts:1` |

### 4.3 Mobile navigation — `[CONFIRMED]`

- Bottom `nav.tabbar` (`Shell.tsx:452-462`): **Today · Calendar · [+ Quick add → palette] · Tasks · Habits · More**. Hard-coded; the Settings visibility prefs do **not** affect the tab bar.
- `More` modal (`Shell.tsx:464-550`): account header → tile grid → `Tools & settings` `<details>`.
  Tiles, in order: **Goals, Notes, Insights, Matrix, Notifications, Weekly Review, AI coach, Plans, [Student], [Guardian], Panels**.
  Tools: **Keyboard shortcuts, Settings, How Planner works, Why Planner?, Export backup, Import backup**, then **Sign out**.
- Mobile top bar (`Shell.tsx:364-395`): brand → Today; AI coach orb; Notifications; Search; theme toggle.

### 4.4 Navigation classification (as it exists today, not a proposal)

- **Primary destinations (sidebar, user-hideable):** Today, Calendar, Tasks, Matrix, Habits, Goals, Notes, Plans, Insights, AI coach.
- **Panel destinations (sidebar, conditional, not hideable):** Student, Guardian; plus All panels.
- **Secondary / overflow destinations:** mobile More tiles (Weekly Review, Notifications, Panels, Goals/Notes/Insights/Matrix/AI/Plans duplicates), route-only pages (`#/day/:date`, `#/review`).
- **Utilities:** search/palette, undo/redo, theme toggle, sync status, notifications, help/tour, About, shortcuts.
- **Settings:** Settings modal (one sheet; no dedicated `/settings` route).
- **Account-related:** account chip in sidebar footer + More sheet header; Sign out in three places; Delete account inside Settings → Account; Passkeys inside Settings.
- **Contextual actions, not destinations:** focus timer overlay, composer (create/edit task/event/habit/goal/note), confirm dialogs, toasts, quick-add bar, PanelHub/PanelInvite cards, weekly-review modal (`R` key), AI draft review card, guardian plan composer, share-now.

---

## 5. Complete Personal Panel Feature Inventory

Legend for *Visible in sidebar*: **Y** = present in `NAV`; **Y\*** = hideable via Settings → Navigation; **Panel** = conditional Panels group; **N** = not a sidebar destination.

### 5.1 Core destinations

| Feature | Panel | Route | Primary/Secondary | Visible in Sidebar | Role Restrictions | Implementation Status | Current Access |
|---|---|---|---|---|---|---|---|
| Today | Personal | `#/today` | Primary | Y (cannot hide) | none | Implemented | sidebar / tabbar / brand / `t` key |
| Day view | Personal | `#/day/:iso` | Secondary | N | none | Implemented | Calendar day headers, prev/next buttons, agenda rows, palette search hit |
| Calendar — Week | Personal | `#/calendar/week/:iso` | Primary | Y\* | none | Implemented | sidebar / tabbar; `#/weekly/:iso` legacy |
| Calendar — Month | Personal | `#/calendar/month/:iso` | Secondary (tab) | via Calendar | none | Implemented | in-view segmented control; `#/month/:y/:m` legacy |
| Calendar — Upcoming/Agenda | Personal | `#/calendar/agenda/:iso` | Secondary (tab) | via Calendar | none | Implemented | in-view tab; Today "and beyond"; `#/future` legacy |
| Tasks — list | Personal | `#/tasks` | Primary | Y\* | none | Implemented | sidebar / tabbar |
| Tasks — board (group by when/priority/category) | Personal | `#/tasks` (in-view) | Secondary | via Tasks | none | Implemented | in-view layout toggle (persisted `planner-task-layout`) |
| Tasks — saved views, filters (open/overdue/waiting/inbox/today/upcoming/done), multi-select bulk actions | Personal | `#/tasks` (in-view) | Secondary | via Tasks | none | Implemented | in-view controls (persisted `planner-task-saved-views`) |
| Matrix (Eisenhower) | Personal | `#/matrix` | Primary | Y\* | none | Implemented (read-only categorisation; quadrants derived from due date + priority, no manual drag) | sidebar, `M` key, More tile |
| Habits (+ monthly grid, streaks, rest days, unit habits) | Personal | `#/habits` | Primary | Y\* | none | Implemented | sidebar / tabbar |
| Habit library (presets, "add all essentials") | Personal | `#/habits` (modal) | Secondary | N | none | Implemented | Habits → Library (`HabitsView.tsx:31,53`) |
| Goals (short/long columns, milestones, linked tasks) | Personal | `#/goals` | Primary | Y\* | none | Implemented | sidebar, More tile |
| Notes (kinds: quick/idea/reminder/journal; tags; backlinks; pin; search) | Personal | `#/notes` | Primary | Y\* | none | Implemented | sidebar |
| Note attachments (IndexedDB blobs; add via note composer, list in notes) | Personal | composer + `#/notes` | Secondary | N | none | Implemented (bytes are device-local, not synced) | Composer → Note → Add files; Notes card list |
| Plans (saved AI drafts; add/refine/delete) | Personal | `#/plans` | Primary | Y\* | none | Implemented | sidebar, palette, AI draft "Saved" |
| Insights (stats, narrative, week bars, rhythm, trend/donut, habits/goals) | Personal | `#/insights` | Primary | Y\* | none | Implemented | sidebar; `#/progress` legacy |
| Weekly review | Personal | `#/review` **and** modal | Secondary | N | none | Partially implemented — the reflection textarea is local component state and is **not persisted** (`WeeklyReview.tsx:5-8,56-62`) | `R` key, More tile, palette "Go to Weekly Review" |
| AI coach — Plan tab | Personal | `#/ai` | Primary | Y\* | none | Implemented (needs `GROQ_API_KEY`) | sidebar, Today "Plan with AI", palette |
| AI coach — Review tab | Personal | `#/ai/review` | Secondary (tab) | via AI | none | Implemented | AI tabs, Insights "Get an AI review" |
| AI memory (user-written preferences/people/routines/boundaries/context) | Personal | `#/ai` (card) | Secondary | N | none | Implemented | AI coach → Memory card |
| Weekly fixed times (protected schedule) | Personal | `#/ai` (card) | Secondary | N | none | Implemented; also consumed as busy slots in AI plans and shown as read-only calendar events (`plannerEvent.fixedCommitmentId`) | AI coach |
| Voice planning (`VoiceTalk` + Web Speech dictation) | Personal | `#/ai` (card) | Secondary | N | none | Implemented; browser support dependent (`speechAvailable()`) | AI coach → Talk card; dictation button on the prompt |
| Image → plan (PNG/JPG ≤ 3 MB) | Personal | `#/ai` (card) | Secondary | N | none | Implemented (Groq vision model) | AI coach → "Add a plan picture" |
| Reschedule slipped tasks (from AI review) | Personal | `#/ai/review` | Secondary | N | none | Implemented | AI review → carry tasks |
| Focus timer (pomodoro-style overlay, chiming, log) | Personal | overlay (no route) | Contextual action | N | none | Implemented | TaskRow ▶, palette "Start a focus session", RhythmCard "Start a session", `startFocus()` |
| Notifications centre (reminder history, unread badge, clear) | Personal | modal | Utility | N (bell in sidebar footer) | none | Implemented (localStorage `planner-notification-center`) | bell in sidebar/top bar/More; fed by reminders + guardian inbox (`context.tsx:527-537, 983`) |
| Command palette (search + quick add + commands) | Personal | modal (`⌘K`, `/`) | Utility | N | none | Implemented | sidebar search button, mobile [+], keyboard |
| Quick add bar ("Call mom tomorrow 5pm #work !high") | Personal | `#/today?qa=1` deep link + Today hero | Secondary | N | none | Implemented | Today hero, PWA shortcut "Quick add" |
| Composer (create/edit task, event, habit, goal, note) | Personal | modal | Contextual action | N | none | Implemented | every "Add"/item click, `N` key, palette |
| Panels chooser | Personal (hub) | `#/panels` | Secondary/Panel | Panel group / More tile | none | Implemented | sidebar "All panels", More tile, Today PanelHub/PanelInvite, panel pages |
| Sync across devices (sync code, E2E) | Personal | Settings section | Settings | N | none | Implemented (needs `DATABASE_URL`) | Settings → Sync across devices |
| Shared space (second sync room for the `Shared` category) | Personal | Settings section | Settings | N | none | Implemented | Settings → Shared space |
| Calendar feeds (.ics subscriptions, read-only mirror) | Personal | Settings section | Settings | N | none | Implemented (fetch through `/api/ics`) | Settings → Calendar feeds |
| Weather on Today (Open-Meteo, geocoding) | Personal | Settings section + Today card | Settings/Contextual | N | none | Implemented | Settings → Weather on Today |
| Templates (task/note blueprints) | Personal | Settings section + composer rows | Settings | N | none | Implemented (localStorage; seeded once) | Settings → Templates; composer "Use a template…" |
| Passkeys (WebAuthn add/remove/enable, PRF unlock) | Personal | Settings → Security | Settings | N | none | Implemented (hidden when unsupported) | Settings → Passkeys; signup prompt |
| Reminders (in-app + OS notifications, lead time, morning digest) | Personal | Settings section | Settings | N | none | Implemented | Settings → Reminders |
| Background push (service worker + VAPID + `/api/push/*`) | Personal | Settings section | Settings | N | none | Implemented but requires server keys, DB **and an external scheduled caller** — `vercel.json` defines no `crons` entry `[CONFIRMED]` | Settings → Background notifications |
| Themes (light/dark/system) | Personal | Settings + toggles | Utility | N (sidebar toggle) | none | Implemented | sidebar toggle, top bar, palette, Settings → Appearance |
| Accent colour (sage/ocean/rose/lilac/amber) | Personal | Settings → Appearance | Settings | N | none | Implemented | Settings |
| Language (English/Persian) + RTL | Personal | Settings → Calendar, dates & time | Settings | N | none | Implemented (`i18n.test.ts` enforces full fa coverage) | Settings (reloads page) |
| Date preferences (week start, 12/24 h clock, date language, Jalali dates) | Personal | Settings → Calendar, dates & time | Settings | N | none | Implemented | Settings |
| Import / export: JSON backup, `.ics` (export, export-busy, import), Todoist/TickTick CSV | Personal | Settings → Your data / Move your tasks in | Settings | N | none | Implemented | Settings; error banner "Import"; More → Export/Import backup |
| ICS from ICS proxy | Personal | `/api/ics` | Backend | N | none | Implemented | used by feeds |
| Sample day | Personal | Contextual buttons | Utility | N | none | Implemented (`src/sample.ts`, `buildSampleState`) | Settings → Your data, WelcomeCard, Tasks empty state |
| Start fresh / Delete account | Personal | Settings | Settings/Danger | N | account deletion requires password + typing DELETE | Implemented | Settings → Your data / Account |
| First-run tour (14 stops incl. language step; replayable) | Personal | overlay; walks real routes | Utility | N (`?` side tool "How it works") | none | Implemented (`src/tour.ts`, `src/components/TourSheet.tsx`) | sidebar, More, Settings "Show me around", auto on first boot |
| "Why Planner?" About sheet | Personal | modal | Utility | N | none | Implemented (copy is out of date, §11) | More → Why Planner?, Settings, last tour step |
| Shortcuts sheet | Personal | modal | Utility | N | none | Implemented (its list is out of date, §11) | `?`, More → Keyboard shortcuts |
| Install as app (PWA) | Personal | Settings → App | Settings | N | none | Implemented | Settings; manifest `public/manifest.webmanifest` |
| Undo / redo (global history) | Personal | `⌘Z` / `⌘⇧Z`, sidebar buttons | Utility | sidebar footer | none | Implemented | sidebar, keyboard |
| Sign out (flush vault → end session → `/`) | Personal | 3 entry points | Account | sidebar footer + More | none | Implemented (`src/components/useSignOut.ts`) | sidebar, More, Settings → Account |
| Sync status indicator | Personal | sidebar footer | Utility | sidebar footer | none | Implemented | sidebar |

### 5.2 Student panel features

| Feature | Route | Status | Access |
|---|---|---|---|
| Panel identity (field + grade; edit inline) | `#/student` | Implemented | `StudentPanelView.tsx:181-240` |
| Week overview stats (done/planned, focused, targets reached, next exam) | `#/student` | Implemented | `StudentPanelView.tsx:242-247` |
| Study queue (today/week/all, subject filter) + add study task | `#/student` | Implemented | `src/components/StudentWorkspace.tsx:84-290` |
| Subjects CRUD (name, exam date, weekly target, ≤40; rename cascades to task/event categories) | `#/student` | Implemented | `StudentWorkspace.tsx:359-560`, `src/panelFeatures.ts:saveStudentSubject` |
| Upcoming exams agenda | `#/student` | Implemented | `StudentWorkspace.tsx:292-357` |
| Guardian inbox (notes + day/week/month plans with tick-off) | `#/student` | Implemented | `StudentPanelView.tsx:253-350`, `src/panels.ts:withPlanItemToggled` |
| Mark inbox read | `#/student` | Implemented | `src/panels.ts:markInboxRead` |
| Tracking charts (completion ring, planned vs done, focus trend, subject split) | `#/student` | Implemented | `src/components/charts.tsx`, `src/panels.ts:weeklyHistory` |
| Guardians & sharing (link by `plnr-XXXX-XXXX-XXXX`, share now, stop sharing, preview of shared snapshot) | `#/student` | Implemented | `StudentPanelView.tsx:352-520` |
| Change explanations ("what changed" / private "why"), current week + earlier-week counts | `#/student` | Implemented | `src/panels.ts:splitExplanations` |
| AI advice for the week | `#/student` | Implemented (Groq) | `generateStudentAdvice` in `src/ai.ts` |
| Panel off → friendly empty state + "Add student panel" | `#/student` | Implemented | `StudentPanelView.tsx:154-166` |

### 5.3 Guardian panel features

| Feature | Route | Status | Access |
|---|---|---|---|
| Panel identity (Parent/Advisor + field) | `#/guardian` | Implemented | `GuardianPanelView.tsx:247-277` |
| Circle overview stats (linked / updated this week / waiting / unread notes) | `#/guardian` | Implemented | `:279-312` |
| Invite student (username + display name, 20-link cap, one-time code, copy) | `#/guardian` | Implemented | `:86-130, 320-390` |
| Roster: search, filter (all/current/waiting/older), sort (name/latest), counts, last-checked | `#/guardian` | Implemented | `:392-460`, `src/panelFeatures.ts:filterGuardianLinks` |
| Per-student expand: weekly numbers, headline, charts, sent-plan progress | `#/guardian` | Implemented | `:462-620` |
| "What should I ask?" AI questions from weekly results only | `#/guardian` | Implemented (Groq) | `generateGuardianGuidance` |
| Note to student + shared circle | `#/guardian` | Implemented | `postNotice`, `src/auth/links.ts` |
| Plan composer (day/week/month, steps with subject/minutes/date, templates, error validation) | `#/guardian` | Implemented | `src/components/GuardianPlanComposer.tsx`, `src/panelFeatures.ts:planDraftError` |
| Take back plan / stop following / refresh results / mark notices read | `#/guardian` | Implemented | `src/auth/links.ts:dropPlan,removeLink,refreshResults,markNoticesRead` |
| Shared-circle notices card | `#/guardian` | Implemented | `:789-825` |
| Panel off → friendly empty state | `#/guardian` | Implemented | `:233-243` |

### 5.4 Today-page cards that are only reachable from Today `[CONFIRMED]`

`WelcomeCard` (first run only), `StatsWidget` (today only), `BackupReminder` (every 7 days), `PanelHub` (only if ≥1 panel enabled), `PanelInvite` (only if 0 panels), `MoodCard`, `JournalCard`, `DayNotes`, `EssentialsCard`, `WeatherCard`, `IntentionField`, `NowMark`, `UpcomingFocus` — all in `src/views/DayView.tsx:119-380`.

---

## 6. Features Not Visible in the Main Sidebar

**"Implemented but not represented in primary navigation"**

| Feature | Route / entry | How the user reaches it today | Evidence |
|---|---|---|---|
| Day view | `#/day/:iso` | Calendar day header, prev/next, agenda rows, palette search hit | `CalendarView.tsx:190,528,631,657`; `DayView.tsx:142-148` |
| Weekly Review | `#/review` and a modal | `R` key, More tile, palette item | `Shell.tsx:234-236, 506-508, 617-622`; `Palette.tsx:153` |
| Focus timer | overlay, no route | TaskRow ▶, palette command, Insights "Start a session" | `items.tsx:327-331`, `Palette.tsx:154`, `RhythmCard.tsx:47` |
| Quick add | `#/today?qa=1` | Today hero bar, PWA shortcut, palette | `route.ts:21,44`; `Shell.tsx:204-210` |
| Command palette | modal | sidebar search, `⌘K`, `/`, mobile [+] | `Shell.tsx:261, 214-232` |
| Notifications centre | modal | sidebar bell, top bar bell, More tile | `Shell.tsx:309-314, 497-503` |
| Panels chooser | `#/panels` | only when a panel is on (sidebar "All panels"), always in More, Today cards, panel headers | `Shell.tsx:276-286, 524-526`; `PanelsView` |
| Student panel | `#/student` | only when enabled | `Shell.tsx:136-139` |
| Guardian panel | `#/guardian` | only when enabled | `Shell.tsx:136-139` |
| Account / sign in identity | sidebar footer + More header | scroll the sidebar footer; open More | `Shell.tsx:341-360, 468-483` |
| Sign out | 3 places | sidebar footer, More, Settings → Account | `useSignOut.ts` |
| Delete account | Settings → Account | requires password + typed DELETE | `SettingsSheet.tsx:454-544` |
| Passkeys | Settings → Security | hidden entirely without WebAuthn | `SettingsExtras.tsx:480-577` |
| Sync code / link a device / delete cloud copy | Settings → Sync across devices | — | `SettingsSheet.tsx:52-164` |
| Shared space | Settings → Shared space | — | `SettingsExtras.tsx:21-167` |
| Calendar feeds | Settings → Calendar feeds | — | `SettingsExtras.tsx:169-264` |
| Weather | Settings → Weather on Today | — | `SettingsExtras.tsx:266-359` |
| CSV task import | Settings → Move your tasks in | — | `SettingsExtras.tsx:361-414` |
| Templates | Settings → Templates + composer | — | `SettingsExtras.tsx:416-461` |
| ICS export / export busy / ICS import | Settings → Calendar, dates & time | — | `SettingsSheet.tsx:400-420` |
| JSON export / import / sample / start fresh | Settings → Your data; More tools; error banner | — | `SettingsSheet.tsx:650-678` |
| PWA install | Settings → App | — | `SettingsSheet.tsx:422-452` |
| Reminders & background notifications | Settings sections | — | `SettingsSheet.tsx:166-283` |
| Voice listening accent | Settings → Voice | — | `SettingsSheet.tsx:284-316` |
| Navigation visibility preferences | Settings → Navigation | — | `SettingsSheet.tsx:28-48` |
| Tour / About / Shortcuts sheets | overlays | sidebar, More, Settings, `?` | `tour.ts`, `AboutSheet.tsx`, `ShortcutsSheet.tsx` |
| Note attachments | Composer (note) + Notes cards | — | `Composer.tsx:655+`, `NotesView.tsx:141` |
| Undo/redo | sidebar icon buttons + keys | — | `Shell.tsx:288-306` |
| AI memory, protected weekly times, AI voice/image, reschedule | inside `#/ai` | in-page cards only | `AIView.tsx:446-640, 596-640` |
| Student: subject CRUD, study queue, exams, inbox, sharing | inside `#/student` | in-page cards only | §5.2 |
| Guardian: roster tools, plan composer, AI questions | inside `#/guardian` | in-page cards only | §5.3 |

**Also note `[CONFIRMED]`:** the command palette's destination list is fixed and **does not include** Panels, Student, Guardian, Day view, Notifications, Settings, or Sign out (`Palette.tsx:143-166`); and its item labelled "Open shortcuts" (`Palette.tsx:163`) actually calls `openSettings()`.

---

## 7. Settings Architecture

`[CONFIRMED]` Settings is **one modal** (`SettingsSheet`, `src/components/SettingsSheet.tsx:546`), opened from the sidebar (`data-tour="settings"`), the More sheet, the palette and the AI coach's "AI settings" button. There is **no settings route** (`#/settings` is not a route; it would parse to `today`).

Section order rendered (in `SettingsSheet.tsx:565-693`), with implementation location:

| # | Section heading | What it contains | Location | Category | Sidebar? |
|---|---|---|---|---|---|
| 1 | **Account** | signed-in identity, sign out, delete account (password + `DELETE`) | `:454-544` | Account | No |
| 2 | **Appearance** | Theme (system/light/dark), Accent (5 colours) | `:567-608` | Appearance/Theme | No |
| 3 | **Navigation** | per-page sidebar visibility (Today locked on) | `:28-48` | Preferences | No (it *is* nav config) |
| 4 | **Sync across devices** | sync code show/copy/link, sync now, turn off, delete cloud copy, status | `:52-164` | Data/sync | No |
| 5 | **Shared space** | second sync room code, join/create/leave | `SettingsExtras.tsx:21-167` | Data/sync | No |
| 6 | **Reminders** | on/off, lead time, morning digest + time | `:166-240` | Notifications | No |
| 7 | **Background notifications** | web push opt-in (needs server keys) | `:242-282` | Notifications | No |
| 8 | **Voice** | speech-recognition accent/locale | `:284-316` | Preferences/Accessibility-adjacent | No |
| 9 | **Calendar, dates & time** | week start, 12/24 h clock, **Language**, date language, Jalali dates, `.ics` export/export-busy/import | `:318-420` | Preferences/Language/Data | No |
| 10 | **Calendar feeds** | subscribe/refresh/remove `.ics` URLs | `SettingsExtras.tsx:169-264` | Integrations | No |
| 11 | **Move your tasks in** | CSV import (Todoist/TickTick/any) | `SettingsExtras.tsx:361-414` | Data import | No |
| 12 | **Weather on Today** | place search, on/off, clear | `SettingsExtras.tsx:266-359` | Integrations | No |
| 13 | **Templates** | list + remove task/note templates | `SettingsExtras.tsx:416-461` | Productivity | No |
| 14 | **App** | install as PWA | `:422-452` | Devices/PWA | No |
| 15 | **Passkeys** | list/add/remove passkeys | `SettingsExtras.tsx:480-577` | Security | No |
| 16 | **New here?** | Why Planner?, Show me around (tour) | `:623-639` | Help | No |
| 17 | **AI coach · Groq** | server env instructions + privacy note (developer-facing copy) | `:641-648` | AI (docs only) | No |
| 18 | **Your data** | export backup, import backup, load sample day, start fresh | `:650-678` | Data/storage | No |
| 19 | **Shortcuts** | static list of 6 shortcuts | `:681-691` | Help | No |
| — | Footer | "Personal Planner · local-first · made for calm days" | `:693` | — | — |

**Categories with NO settings surface today** `[NOT FOUND]`:

| Category | Status |
|---|---|
| Privacy (beyond the AI copy + sharing preview) | no dedicated section |
| Accessibility | none (only reduced-motion is respected inline in `Shell.tsx:157-162`, no setting) |
| AI preferences | none in Settings — AI memory lives on the AI coach page; model/key are server env vars |
| Productivity preferences | only Navigation visibility + Templates; no default views, no day-capacity setting (the AI copy in `AIView.tsx:718-724` lists "gentle capacity setting" as a *future* idea) |
| Devices / sessions | no session list; only the Passkeys list and the sync/shared codes |
| Integrations | Calendar feeds + Weather only (no Google/Outlook OAuth) |
| Notifications (granular, per-type) | only on/off + lead + digest; no per-category control |
| Language selection | exists, but nested inside "Calendar, dates & time" rather than its own Language section |

---

## 8. Role-Specific Personal Panel Differences

`[CONFIRMED]` **The Personal Panel navigation is universal. It never changes by account role.** Evidence:

1. `NAV` and the group split are static constants (`Shell.tsx:75-86, 140-142`).
2. Sidebar rendering consults only `visiblePages` (localStorage prefs) and `panels.*.enabled` — never `account.role` (`Shell.tsx:136-142, 266-286`).
3. The only `accountUser()` usages are the avatar/name/email chip and the presence of the Sign-out button (`Shell.tsx:70-73, 133, 341-360, 468-483`).

What *does* differ between users:

| Variation | Driven by | Effect |
|---|---|---|
| Sidebar contents | `localStorage planner-sidebar-pages` | any of the 9 hideable pages can be absent |
| Panels group | `panels.student.enabled` / `panels.guardian.enabled` | adds Student and/or Guardian entries + "All panels" |
| Today cards | `panels.*.enabled` | `PanelHub` vs `PanelInvite` |
| Mobile More tiles | same flags | Student/Guardian/Panels tiles appear/disappear |
| Student panel internals | `panels.student.guardians.length`, `subjects.length` | inbox card, guardian list, AI card always render but show empty states |
| Guardian panel internals | `panels.guardian.links`, `kind` | roster, "Parent panel"/"Advisor panel" kicker |
| Account role | server `planner_users.role` | **pre-sets the panel flags once at signup**; no later effect, no route gate, no UI branch |

`[PARTIALLY CONFIRMED]` Consequently there is no "role-specific Personal Panel": a guardian-only account and a personal-only account see exactly the same 10 planned destinations, unless one of them has hidden pages or switched a panel on.

---

## 9. Feature Implementation Status

| Feature | Status | Evidence / caveat |
|---|---|---|
| Today, Day, Calendar (week/month/agenda), Tasks (list/board/bulk), Habits, Goals, Notes, Matrix, Insights | **Fully implemented, local state, tested** | `src/views/*`, unit tests `app.test.tsx`, `planner.test.ts`, `features.test.ts`, e2e `e2e/*.spec.ts` |
| AI coach (plan, review, memory, voice, image, protected times, reschedule) | **Fully implemented behind a server key** | `src/ai.ts` (1024 lines), `src/server/groqProxy.ts`; degrades with `GROQ_KEY_MISSING_MESSAGE` |
| Plans (saved AI drafts) | **Fully implemented** | `src/views/PlansView.tsx`, `SavedAIPlan` `types.ts:161-186`, cap `AI_PLAN_LIMIT = 30` |
| Focus timer + focus log | **Fully implemented**, log feeds Insights/Rhythm/student weekly results | `src/components/FocusTimer.tsx`, `src/logic.ts` |
| Notifications centre | **Fully implemented, device-local** | `src/notificationCenter.ts` (localStorage, max 50) |
| Weekly review | **Partially implemented** — reflection not saved, plain `h2` (not the app's design system), duplicate render paths (route and modal) | `WeeklyReview.tsx:5-8,23-31,56-62`; `Shell.tsx:435,617` |
| FocusHistory widget | **Partially implemented / legacy style** — `(state as any).focusLog`, inline markup, its own heading, placeholder bug `t('{{m}} minutes total')` renders stray braces because `interpolate` matches `{m}` inside `{{m}}` (`i18n.ts:64-72`) | `FocusHistory.tsx:8,29,31`; `fa.ts:1437` |
| StatsWidget | **Partially implemented / legacy** — "streakSum = state.habits.length" is a placeholder proxy (`StatsWidget.tsx:15`) | `StatsWidget.tsx` |
| MatrixView | **Implemented but derivational** — quadrants computed from `dueDate <= today` and `priority === 'high'`; no stored quadrant, no drag between quadrants | `MatrixView.tsx:10-17` |
| Student panel | **Fully implemented**, synchronised over encrypted links | `StudentPanelView`, `StudentWorkspace`, `src/auth/links.ts`, e2e `e2e/panels.spec.ts` |
| Guardian panel | **Fully implemented**, with roster filters, plan composer, AI guidance | `GuardianPanelView`, `GuardianPlanComposer`, `panelFeatures.ts` |
| Guardian/student link transport | **Fully implemented, server-gated by link status** | `db/auth.sql:planner_links`, `src/server/authApi.ts` |
| Sync (by code) | **Fully implemented**, needs `DATABASE_URL` | `src/sync.ts`, `/api/sync`; UI shows a setup hint when unavailable |
| Shared space | **Fully implemented** | `src/context.tsx:704-745`, `SettingsExtras.tsx:21` |
| Account auth (signup/login/logout/session/vault/recovery/passkeys) | **Fully implemented** | `db/auth.sql`, `src/server/authStore.ts` (1134 lines) |
| Guardian in-app notifications | **Fully implemented** | `context.tsx:520-537` |
| Web push | **Implemented, operationally incomplete**: client + API + service worker exist, but delivery needs an external scheduler; `vercel.json` has no `crons` | `src/push.ts`, `src/server/pushApi.ts`, `vercel.json` |
| Reminders | **Fully implemented (in-app)**; OS notifications only while the app/PWA runs | `src/reminders.ts`, `SettingsSheet.tsx:166-240` |
| Feeds / weather / templates / CSV import / ICS | **Fully implemented** | `feeds.ts`, `weather.ts`, `templates.ts`, `importers.ts`, `ics.ts` |
| Attachments | **Fully implemented but device-local** (bytes in IndexedDB; referenced by `notes[].attachments` and encrypted state carries only refs) | `files.ts:11-18`, `idb.ts:79-104` |
| Spec-only items (£) | **Not implemented** | see §3.3 — role capabilities/scope presets, "My role" settings, `/app#/students`, `/app#/my-guardians`, proposals inbox, bulk plan editor, change feed "changed by" |
| Dead code / unused exports | none found for major modules; `seedTemplates` is used indirectly by `loadTemplates` (`templates.ts:107`) | repo-wide export-usage pass |

---

## 10. Overlapping / Related Features

Facts only — what each feature does, per the code:

| Pair | What each actually does | Overlap |
|---|---|---|
| **Plans vs Tasks** | `#/plans` is a *staging area* for AI drafts (`SavedAIPlan`, statuses `draft|added`); nothing reaches the planner until "Add to planner" (`PlansView.tsx:34-56`). `#/tasks` is the real task store (filters, board, bulk, repeat, subtasks, estimates, waiting). | Plans produces tasks/events/habits; tasks does not know about plans beyond `planId` marking |
| **Plans vs Goals** | Goals (`#/goals`) hold milestones and long/short horizons; tasks can link to a goal via `task.goalId`. AI plans never attach a `goalId`. | Both express "intended future work"; no code path links them |
| **Guardian plans vs Plans page vs Tasks** | `GuardianPlan` is a *message* over an encrypted link (`types.ts:305-330`); the student ticks items in place; items never become tasks (`withPlanItemToggled` only flips `done`) | Three different "plan" concepts share a name |
| **Habits vs Tracking (Student panel "Tracking" card)** | Habits are check-ins in the personal panel; the student panel's Tracking card shows weekly results (planned/done/focus/subject split) computed from the same planner (`panels.ts:weekResults`) | Same source data, two dashboards |
| **Insights vs Weekly Review vs AI review vs Student/Guardian charts** | Insights = in-app statistics/narrative/charts (`InsightsView.tsx` + `insights.ts`). Weekly Review = a reflection form with 3 hard numbers (tasks, check-ins, focus). AI review = Groq-generated review + carry-over rescheduling. Student/Guardian panels = weekly aggregates shared across accounts. | Four "how did it go" surfaces; Weekly Review's numbers duplicate Insights |
| **Focus timer vs Insights/Rhythm vs Students' "Focused" minutes** | One `focusLog` entry per finished session (`FocusTimer.tsx` → `logFocus`), read by Insights, RhythmCard, FocusHistory, weekly results and student/guardian results | Single data source, five consumers |
| **Matrix vs Tasks priority** | Matrix derives quadrant from `priority === 'high'` + due date; Tasks owns priority/editing | Matrix is a read-only projection of Tasks |
| **Notes vs Journal vs Day notes** | `NotesView` shows all notes; `NoteKind` includes `journal`; Today's `JournalCard` and `DayNotes` create/edit notes of those kinds inline (`DayView.tsx:389-575`) | Three editing paths into `state.notes` |
| **Notifications centre vs Guardian notices vs Reminders** | The bell shows reminder firings + guardian inbox events (`notificationCenter.ts`); guardian notices are `GuardianNotice` objects inside `panels.guardian.notices` kept separate | One bell, two very different feeds |
| **Exam/subject handling: Subjects vs Categories** | Student subjects are matched to tasks **by category name** (case-insensitive) (`panelFeatures.ts:studyQueue`, `panels.subjectMinutes`), and renaming a subject rewrites task/event categories | Subject list and the fixed 6 `CATEGORIES` are two taxonomies sharing one field |
| **Panels chooser vs Today PanelHub** | `#/panels` configures; `PanelHub`/`PanelInvite` are shortcuts on Today only | Same job, two surfaces |
| **Guardian kinds: Parent vs Advisor** | One code path, `kind` only changes labels and default `field` collection | No behavioural difference in code |
| **Theme toggle vs Settings → Appearance** | Same state; two entry points (sidebar/top bar toggles vs 3-way segmented control incl. System) | Overlapping control |

---

## 11. Orphaned / Hidden / Unused Features

| Finding | Evidence | Confidence |
|---|---|---|
| **Route with no primary nav entry:** `#/review` (Weekly Review). Reachable via `R`, More tile, palette. | `route.ts:19`; `Shell.tsx:234-236`; no `review` in `NAV` (`Shell.tsx:75-86`) | `[CONFIRMED]` |
| **Route with no nav entry at all:** `#/day/:iso` (only contextual links). | `route.ts:82`; `CalendarView.tsx:190`; `DayView.tsx:142-148` | `[CONFIRMED]` |
| **Route reachable only through a conditional chain:** `#/panels` — sidebar entry exists only when a panel is enabled; otherwise Today's `PanelInvite` or the More tile. | `Shell.tsx:276-286`; `PanelHub.tsx:70-90` | `[CONFIRMED]` |
| **Legacy route aliases kept:** `daily`, `weekly`, `month`, `monthly`, `future`, `progress`, `quickadd`. | `route.ts:44-53` | `[CONFIRMED]` (intentional back-compat, comment at `route.ts:43`) |
| **Legacy redirect list is incomplete:** `/` + `#/matrix`, `#/review`, `#/panels`, `#/student`, `#/guardian` are *not* rewritten to `/app…`, so such an old bookmark renders the marketing site. | `main.tsx:27-28` regex lists only `today|calendar|tasks|habits|goals|notes|insights|plans|ai|day|quickadd` | `[CONFIRMED]` |
| **Shortcuts sheet is out of date:** it lists `?` as "Open settings" (it opens the shortcuts sheet) and omits `M` (matrix), `R` (weekly review), `T` (today) semantics used by `Shell.tsx:214-240`; Settings → Shortcuts repeats the same stale list. | `ShortcutsSheet.tsx:5-15`; `SettingsSheet.tsx:683-690`; handler `Shell.tsx:210-240` | `[CONFIRMED]` |
| **Palette label/action mismatch:** the item with id `shortcuts`, label "Open shortcuts", sub "Keyboard cheat sheet" calls `openSettings()`. | `Palette.tsx:163` | `[CONFIRMED]` |
| **Palette has no entries** for Panels, Student, Guardian, Day, Notifications or Settings — which contradicts the Settings hint that hidden sections "remain available from search". | `Palette.tsx:143-166`; hint `SettingsSheet.tsx:31` | `[CONFIRMED]` |
| **Settings visibility prefs do not affect the mobile tab bar** (only the sidebar). | `Shell.tsx:452-462` vs `:140-142` | `[CONFIRMED]` |
| **Dead expression in Shell:** the Plan-group `NavButton`s pass `attention={item.name === 'ai' && !aiSeen}`, but `ai` is never in `planNav` (`NAV.slice(0,4)`). | `Shell.tsx:269-270, 140` | `[CONFIRMED]` |
| **Out-of-date About copy:** "Private by design … with no accounts ever" — accounts, vaults, sessions and guardian links now exist. | `AboutSheet.tsx:21-24` | `[CONFIRMED]` |
| **Two render paths for one feature:** Weekly Review as route `#/review` *and* as a modal from the `R` shortcut — same component, different chrome, and `route.name === 'review'` is included in `moreActive`. | `Shell.tsx:435, 248, 617-622` | `[CONFIRMED]` |
| **Legacy-style widgets coexisting with newer views:** `FocusHistory` (`as any`, inline styles, `{{m}}` placeholder bug), `StatsWidget` ("streakSum" proxy), `WeeklyReview` (raw `h2`, no design-system classes), `MatrixView` (uses `.view-head` instead of `page-head`, raw emoji icons). | files cited | `[CONFIRMED]` |
| **Spec-only routes/components** never built: `/app#/students`, `/app#/students/:id`, `/app#/my-guardians`, "My role" settings section, proposals inbox, bulk plan editor. | `SPEC.md:294-330, 305`; nothing in `src/route.ts` or views | `[CONFIRMED]` |
| **No route target is missing:** every sidebar/tile destination resolves to a real view in `Shell.tsx:425-444`. | — | `[CONFIRMED]` |
| **No unused major component:** exported components (`charts`, `ui`, `items`, `Attachments`, `Markdown`, `Confetti`, `DraftRefine`, `VoiceTalk`, `GuardianPlanComposer`, `HabitLibrary`, `PanelHub`, `WelcomeCard`, `BackupReminder`, `StatsWidget`, `FocusHistory`, `RhythmCard`, `SettingsExtras`) all have at least one live call site. | repo-wide usage pass | `[CONFIRMED]` |

---

## 12. What the Screenshot Does NOT Tell Us

Everything below exists in the codebase but cannot be inferred from a sidebar screenshot:

1. **There is a whole second layer of application inside each panel.** The student and guardian panels are not "more sidebar links" — they are full multi-card workspaces with their own data models, encrypted link transport, AI features and chart sets (`StudentPanelView.tsx` 589 lines, `GuardianPanelView.tsx` 829 lines, `StudentWorkspace.tsx` 570 lines, `GuardianPlanComposer.tsx` 293 lines).
2. **A third panel-ish surface: `#/panels`**, the on/off chooser, with conditional sidebar visibility and copy that frames panels as additive extras.
3. **Panels are switchable, not roles.** Two accounts with the same role can see different sidebars, and two accounts with different roles can see identical sidebars. Panel flags live inside the encrypted planner state, not in the account.
4. **The account role exists but is nearly inert.** `personal|student|guardian` is stored server-side and only pre-enables a panel at signup; no navigation, route or feature in the authenticated app reads it (`shared/authContract.ts:22-25`; `marketing/Auth.tsx:456-503`).
5. **Two of the items in the screenshot are section labels** (`Plan/برنامه`, `Focus/تمرکز`, `Track/پیگیری`) rather than destinations — and three of them appear to be one group each, i.e. the screenshot mixes group headers with items.
6. **"Focus" is not a page.** There is no `#/focus` route; focus exists as a timer overlay + `focusLog` + charts in Insights (and as a *group label* in Persian `تمرکز`).
7. **"Tracking" is not a page either** in the sidebar sense; `پیگیری` is the Track group label *and* the title of a card inside the student panel (`fa.ts:987,1560`).
8. **Settings is one giant modal with ~19 sections** — including sync, shared space, feeds, weather, CSV import, templates, PWA install, passkeys, background push, voice, language/date options, backup/import/start-fresh and account deletion. None of it has a route.
9. **Weekly Review exists twice** (route and modal) and is absent from the sidebar.
10. **The command palette (⌘K), the `R`/`M`/`T`/`N`/`?` shortcuts, the quick-add bar and its PWA deep link (`#/today?qa=1`) are navigation surfaces** that a screenshot cannot show; the palette has a *different* destination list from the sidebar.
11. **Mobile navigation is a different structure** (tab bar + More sheet) and does not honour the sidebar visibility preferences.
12. **Huge amounts of functionality live inside pages, not in nav**: AI memory, protected weekly times, voice + image planning, task rescheduling, note attachments, task templates, saved task views, bulk task selection, study queue/subjects/exams, sharing preview, plan composer, AI Q&A for guardians.
13. **The system is account-backed and encrypted**: signup/login/recovery/passkeys/sessions, an encrypted vault, an optional sync-code sync, a *second* "shared space" sync, and guardian links with one-hop notice passing. Data may be local-only, vault-backed, or synced — the sidebar shows none of this beyond a small sync-status line.
14. **Everything is bilingual with enforced Persian coverage** (`i18n.test.ts` fails if any `t('…')` string lacks a fa translation) and the app is fully RTL, so any navigation label in the screenshot has a matching English key in code.
15. **Several nav decisions are user-configurable** (Settings → Navigation) and stored per device in `localStorage`.
16. **The two legacy specs in the repo (`SPEC.md`) describe routes and role machinery that do not exist** (`/app#/students`, `/app#/my-guardians`, "My role", scope presets) — useful context, but not current architecture.

---

## 13. Complete Route Map

Hash routes handled by `parseHash` (`src/route.ts:37-58`). All live under `/app`.

| Hash | Route name | View | Reached from | Status |
|---|---|---|---|---|
| `#/today`, `#/` , unknown hash | `today` | `DayView(today)` | sidebar, tabbar, brand, `T`, palette, notifications sheet | current |
| `#/today?qa=1` | `quickadd` | `DayView(today)` + focus quick-add input | PWA shortcut, deep link | current |
| `#/day/:YYYY-MM-DD` | `day` | `DayView(date)` | calendar headers/agenda, prev/next, palette hit | current |
| `#/calendar/week/:date` (default) | `calendar` | `CalendarView` week board | sidebar, tabbar | current |
| `#/calendar/month/:date` | `calendar` | `CalendarView` month board | in-view tab | current |
| `#/calendar/agenda/:date` | `calendar` | `CalendarView` upcoming | in-view tab, Today link | current |
| `#/tasks` | `tasks` | `TasksView` (+`TaskBoard`) | sidebar, tabbar | current |
| `#/matrix` | `matrix` | `MatrixView` | sidebar, `M`, More tile | current |
| `#/habits` | `habits` | `HabitsView` (+`HabitLibrary` modal) | sidebar, tabbar | current |
| `#/goals` | `goals` | `GoalsView` | sidebar, More tile | current |
| `#/notes` | `notes` | `NotesView` | sidebar | current |
| `#/plans` | `plans` | `PlansView` | sidebar, palette | current |
| `#/insights` | `insights` | `InsightsView` | sidebar, `#/progress` | current |
| `#/review` | `review` | `WeeklyReview` (full view; also a modal via `R`) | `R`, More tile, palette | current (hidden) |
| `#/ai`, `#/ai/plan` | `ai`, tab `plan` | `AIView` | sidebar, Today, palette, mobile orb | current |
| `#/ai/review` | `ai`, tab `review` | `AIView` review tab | AI tabs, Insights | current |
| `#/panels` | `panels` | `PanelsView` | conditional sidebar, More tile, Today cards, panel headers | current |
| `#/student` | `student` | `StudentPanelView` | conditional sidebar, More, PanelHub, PanelsView; direct URL shows empty-state if off | current |
| `#/guardian` | `guardian` | `GuardianPanelView` | same as above | current |
| `#/daily/:date` | `day` (legacy) | `DayView` | legacy links | alias |
| `#/weekly/:date` | `calendar/week` (legacy) | — | legacy links | alias |
| `#/month/:y/:m`, `#/monthly/…` | `calendar/month` (legacy) | — | legacy links | alias |
| `#/future` | `calendar/agenda` (legacy) | — | legacy links | alias |
| `#/progress` | `insights` (legacy) | — | legacy links | alias |
| `#/quickadd` | `quickadd` | — | legacy links | alias |
| `#/students`, `#/students/:id`, `#/my-guardians` | — | — | SPEC only | `[NOT FOUND]` in code (falls through to `today`) |

Non-hash, public: `/` (landing), `/login`, `/signup`, `/recover` → marketing bundle (`Site.tsx:38-40`); `/app` → planner (`main.tsx:25-26`).

API surface: §1.2 list; route table `src/server/apiRouter.ts:63-137`.

---

## 14. Relevant Code Locations

| Concern | Files |
|---|---|
| Boot / bundle split / legacy redirect | `src/main.tsx`; `vercel.json` |
| Auth gate, unlock, offline boot | `src/auth/AccountGate.tsx`; `src/auth/vault.ts`; `src/auth/session.ts`; `src/auth/device.ts`; `src/auth/passkey.ts` |
| App state, all mutations, undo/redo, sync, panels sync, reminders, feeds, theme | `src/context.tsx` (1288 lines) |
| Routing | `src/route.ts` |
| Shell: sidebar, grouping, tabbar, More, sheets, route switch | `src/components/Shell.tsx` (675 lines) |
| Sidebar visibility prefs | `src/navigationPrefs.ts`; `src/components/SettingsSheet.tsx:28-48` |
| Personal panel views | `src/views/{DayView,CalendarView,TasksView,TaskBoard,MatrixView,HabitsView,GoalsView,NotesView,PlansView,InsightsView,AIView,RhythmCard}.tsx` |
| Panels | `src/views/{PanelsView,StudentPanelView,GuardianPanelView}.tsx`; `src/components/{StudentWorkspace,GuardianPlanComposer,charts}.tsx`; `src/panels.ts`; `src/panelFeatures.ts`; `src/auth/links.ts`; `panels.css` |
| Modals / sheets | `src/components/{ui,Composer,Palette,NotificationsSheet,SettingsSheet,SettingsExtras,ShortcutsSheet,TourSheet,AboutSheet,FocusTimer,Confirm(via ui)}.tsx`; `src/tour.ts`; `src/about.ts` |
| Settings data/logic | `src/reminders.ts`; `src/push.ts`; `src/speech.ts`; `src/feeds.ts`; `src/weather.ts`; `src/templates.ts`; `src/importers.ts`; `src/ics.ts`; `src/files.ts`; `src/pwa.ts`; `src/theme.ts`; `src/i18n.ts` |
| Storage / sync | `src/storage.ts`; `src/idb.ts`; `src/sync.ts`; `src/mutate.ts` |
| AI | `src/ai.ts`; `src/voiceai.ts`; `src/duration.ts`; `src/scheduler.ts`; `src/server/groqProxy.ts` |
| Server | `api/[...path].ts`; `src/server/{apiRouter,authApi,authStore,sync,pushApi,icsProxy,groqProxy,webauthn,security}.ts`; `db/{auth,schema}.sql` |
| Marketing (context only) | `src/marketing/{Site,Landing,Auth,Showcase,copy}.tsx` |
| Tests (behaviour evidence) | `src/app.test.tsx`; `src/panels.test.ts`; `src/panelFeatures*.test.ts*`; `src/panelsAi.test.ts`; `src/sync.test.ts`; `src/i18n.test.ts`; `e2e/{planner,features,panels,ai,tour}.spec.ts` |
| Docs already in repo | `README.md` (67-85 panels), `SPEC.md` (roles/panels/routes), `REPORT.md`, `UI_AUDIT_REPORT.md` |

---

## 15. Uncertainties / Open Questions

| # | Question | Why unclear |
|---|---|---|
| 1 | Which exact sidebar item does the screenshot label **برنامه** refer to — the `Plan` group header (`fa.ts:686`) or `Plans/برنامه‌ها` (`fa.ts:701`)? | Both exist; without the pixels this cannot be resolved. The same applies to **تمرکز** (`Focus` group) and **پیگیری** (`Track` group vs the Student panel's "Tracking" card). |
| 2 | Screenshot has both "اعلان‌ها" and "حالت روشن/تاریک" as list items; in code these are footer tools, not nav items. | Layout ordering cannot be verified from the description alone. `[UNCLEAR]` |
| 3 | Whether the sidebar in the screenshot included the Panels group. | Depends on the account's panel flags, which are per-user data. |
| 4 | Whether any deployment currently has `GROQ_API_KEY`, `DATABASE_URL`, VAPID keys and a scheduler configured. | Deployment env, not code. Every AI/sync/push feature states its own degradation. |
| 5 | Whether `WeeklyReview`'s reflection field is *intended* to be ephemeral. | No comment states intent; it is simply never read (`WeeklyReview.tsx:5-8`). `[UNCLEAR]` |
| 6 | Whether the legacy `/`+hash redirect gap (§11) has real users. | Depends on bookmarks/history; the PWA shortcuts all point at `/app#/…`, so it is probably rare. `[PARTIALLY CONFIRMED]` |
| 7 | Whether `SPEC.md` remains the intended direction (it describes features the code does not have). | Only README/SPEC wording; no issue tracker in this checkout. `[UNCLEAR]` |
| 8 | Whether the `FocusHistory`/`StatsWidget`/`WeeklyReview`/`MatrixView` widgets are provisional. | Their style and `as any` usage suggest an earlier iteration; nothing in code marks them deprecated. `[UNCLEAR]` |
| 9 | Stated role→panel mapping for users who signed up *before* the role picker existed. | `vault.ts:136` hard-codes `role: 'personal'` for one offline path; other legacy paths are not auditable from code alone. `[UNCLEAR]` |

---

## 16. Executive Summary

**What is actually inside the Personal Panel.** The Personal Panel is the entire authenticated `/app` application: a single-page, hash-routed, local-first planner with **ten primary destinations** (Today, Calendar, Tasks, Matrix, Habits, Goals, Notes, Plans, Insights, AI coach) grouped in the sidebar under the three labels **Plan / Focus / Track**, plus **two route-only pages** (Day view, Weekly Review), a **focus-timer overlay**, a **command palette**, a **notifications centre**, a **quick-add bar**, one very large **Settings modal with ~19 sections**, and a full inline feature set inside each page (AI memory, protected weekly times, voice and image planning, task estimates/subtasks/repeats/saved views/bulk actions, habit units and rest days, goal milestones, note kinds/tags/backlinks/attachments, charts, ICS/CSV/JSON import-export, feeds, weather, templates, PWA install, reminders, passkeys, sync, shared space).

**How it relates to the other panels.** The application has **three real panel surfaces**, not the one implied by the screenshot:

1. the **Personal Panel** (the Shell — always on, includes everything above);
2. the optional **Student panel** (`#/student`);
3. the optional **Guardian panel** (`#/guardian`, kind = Parent or Advisor);

with a fourth, small surface — the **Panels chooser** (`#/panels`) — that switches the optional two on and off. Panels are *additive*: they never replace the personal planner, they can both be on at once, and removing one deletes nothing. The only true hard gate in the whole product is authentication/vault unlock; everything else is a client-side flag or a server-side link-status check on guardian/student data.

**Roles.** Accounts carry `personal | student | guardian`, stored server-side and required at signup, but the role has exactly one runtime effect: it pre-enables a panel inside the newly created encrypted state. Nothing in the authenticated UI reads it. The Personal Panel's navigation is therefore **universal** — it varies only by (a) the per-device sidebar visibility preferences and (b) whether the student/guardian panels are switched on, which adds the conditional `Panels` group (Student / Guardian / All panels) to the sidebar, tiles to the mobile More sheet, and cards to Today.

**What must be accounted for before redesigning the navigation.** Any navigation decision has to cover: 10 primary pages (9 hideable, Today pinned); 3 group labels (Plan / Focus / Track); a conditional 3-item panel group; at least 15 non-sidebar destinations and utilities (Day view, Weekly Review in two forms, focus overlay, palette, notifications, quick add, Settings with ~19 sub-areas, Panels chooser, account/sign-out); a *different* mobile structure (tab bar + More) that deliberately ignores the sidebar prefs; a keyboard surface (⌘K, /, N, T, M, R, ?) that partially disagrees with the on-screen shortcut sheets; a fixed palette destination list that omits Panels/Student/Guardian/Day/Notifications; and a live AI/panel/sharing layer whose features are only ever reachable *inside* pages. The Personal Panel is a 10-destination navigation attached to a product with roughly 60 reachable features, 28 backend endpoints, 16 route targets plus 7 legacy hash aliases, 2 optional sub-panels with their own navigation surfaces, 1 account system, 2 sync systems and 1 encrypted guardian-sharing system — so the sidebar is a *partial* index of the product rather than a map of it.
