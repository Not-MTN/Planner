# Planner — Full Polish & Bug Fix Report

**Date:** 2026-09-29  
**Branch:** `arena/01a0ee3a-planner`  
**Base:** `ee1d304` (main)

---

## 1. Critical Bug Fixed: "Always goes to landing, requires login again"

### Root Cause
- `ActiveSession` lived only in memory (`let active`). Page reload cleared it.
- `bootAccount()` required a valid `/api/auth/session` cookie; if cookie expired or dev server restarted (memory store), it returned `signed-out` → redirect to `/login`.
- Landing `/` always rendered `Site`, even for authenticated users, with no fast-path to app.
- Trusted-device cache (`planner-auth` IndexedDB) existed but was only checked *after* a valid session, so it couldn't save a user whose cookie expired.
- No `localStorage` persistence for auth state.

### Fix Implemented (Recommended Approach: Cookie + localStorage + IndexedDB Trusted Device)

#### `src/auth/session.ts`
- Added constants:
  - `LAST_USER_KEY = 'planner-last-user-id'`
  - `AUTH_FLAG_KEY = 'planner-auth-flag'`
  - `REDIRECT_KEY = 'planner-should-redirect'`
- Added helpers:
  - `persistAuth(userId)` — sets flag, last-user, and redirect flag
  - `clearPersistedAuth()` — clears all three
  - `getLastUserId()`, `isAuthFlagSet()`, `shouldAutoRedirect()`, `markRedirectDone()`
- `signUp` and `signIn` now call `persistAuth()`, handle `forgetDevice` cleanup for old accounts.
- `signOut` now clears persisted keys AND calls `forgetDevice(userId)`.
- `fetchSession()` now persists on success, and only clears redirect flag (not auth flag) on 401, allowing offline unlock.

#### `src/auth/device.ts`
- Added `LAST_USER_HANDLE = 'last-user-id'` in same IndexedDB.
- `rememberOnDevice()` now stores last-user in both IndexedDB and `localStorage`.
- Added `listTrustedUserIds()` and `getLastTrustedUserId()` to enumerate trusted accounts.
- `forgetDevice()` now also clears last-user pointer if it matches.

#### `src/auth/vault.ts`
- Added `LAST_USER_INFO_KEY` to cache public user JSON.
- `storeLastUserInfo()` / `loadLastUserInfo()` helpers.
- `signOut()` now also clears user-info cache.
- `bootAccount()` completely rewritten:
  - Tries `fetchSession()`; if success, stores user info.
  - If `fetchSession()` returns null BUT trusted device exists (`getLastTrustedUserId()` or `getLastUserId()`), attempts `recallFromDevice(lastId)` → `pullVault()`. If vault decrypts, returns `ready`.
  - If `pullVault()` fails (unauthenticated) but device trusted, returns new status `offline-trusted` instead of `signed-out` → app opens with local copy.
  - If no trusted device, returns `signed-out` as before.
- New boot status `offline-trusted` added.

#### `src/auth/AccountGate.tsx`
- Handles `offline-trusted` same as `offline`: renders `<App />` with local copy.
- Listens for `online` event in both offline modes to reload and re-sync.

#### `src/main.tsx`
- `bootTarget()` now checks `planner-should-redirect`, `planner-auth-flag`, `planner-last-user-id` in `localStorage`.
- If path is `/` and redirect flag set (set on sign-in), it rewrites history to `/app` and boots app directly — avoids landing flash.
- Landing still accessible via `/?stay=1`.

#### `src/marketing/Site.tsx`
- Added auth check on mount: `fetchSession()` + `getLastTrustedUserId()`.
- State `authed`, `authChecked`.
- If `/` and `shouldAutoRedirect()` → `markRedirectDone()` + `location.assign('/app')`.
- If `/login` or `/signup` while authed → redirect to `/app`.
- Header now shows **"Open Planner / Go to app"** when authed, instead of Sign in / Get started.
- Passes `authed` prop to `Landing`.

#### `src/marketing/Landing.tsx`
- Prop `authed?` added.
- Hero CTA: shows "Open your planner" when authed.
- Bottom CTA: shows "Welcome back / Your planner is waiting" when authed.

#### `src/marketing/Auth.tsx`
- `SignIn` and `SignUp` now have `useEffect` that checks `fetchSession()` on mount; if already signed in, navigates to `/app`.

**Result:** Returning users land in app instantly (or see "Open Planner"), don't have to type password again if they checked "Keep this device signed in". Offline still works.

---

## 2. Full Feature Audit — All Features Checked

| Feature | File | Status | Notes |
|---------|------|--------|-------|
| **Today / DayView** | `DayView.tsx` | ✅ Working | Timeline, tasks, habits, journal, mood, weather, quick-add, plan my day, AI coach card, carry-over, essentials |
| **Calendar** | `CalendarView.tsx` | ✅ Working | Week/month/agenda tabs, date navigation |
| **Tasks** | `TasksView.tsx` | ✅ Working | List/board, filters (open/overdue/waiting/today/upcoming/done), search via `matchesQuery`, bulk actions (complete/reopen/date/category/priority/delete), drag-drop, TaskBoard grouping |
| **Habits** | `HabitsView.tsx` | ✅ Working | Tracker, streaks, archived handling |
| **Goals** | `GoalsView.tsx` | ✅ Working | Progress via `goalProgress`, linked tasks |
| **Notes** | `NotesView.tsx` | ✅ Working | Journal notes, dated notes, search |
| **Insights** | `InsightsView.tsx` | ✅ Working | Stats, RhythmCard, TrendChart, CompletionDonut, Habit/Goal progress, MoodStrip, PlanVsFocus, YearPixels + **new FocusHistory** |
| **Plans** | `PlansView.tsx` | ✅ Working | Weekly planning |
| **AI Coach** | `AIView.tsx` | ✅ Working | Plan & review tabs, voice chat, draft refine |
| **Panels** | `PanelsView.tsx`, `StudentPanelView.tsx`, `GuardianPanelView.tsx` | ✅ Working | Optional panels, lazy-loaded |
| **Composer** | `Composer.tsx` | ✅ Working | Create/edit tasks/events/habits/goals/notes |
| **Command Palette** | `Palette.tsx` | ✅ Working | ⌘K, search, quick-add |
| **Settings** | `SettingsSheet.tsx` | ✅ Working | Theme, accent, language, export/import, panels, tour |
| **Focus Timer** | `FocusTimer.tsx` | ✅ Working | 25m default, task-linked, logs to `focusLog` |
| **PWA** | `pwa.ts` | ✅ Working | Offline cache, update toast |
| **Auth** | `session.ts`, `vault.ts`, `AccountGate.tsx` | ✅ Fixed | Persistent login, trusted device, offline-trusted |
| **Passkeys** | `passkey.ts` | ✅ Working | PRF-based vault unlock |
| **Marketing Site** | `Site.tsx`, `Landing.tsx`, `Auth.tsx` | ✅ Working + Improved | Auto-redirect, open-planner CTA, server notice |

All existing tests pass: `app.test.tsx (26)`, `planner.test.ts (38)`, `features.test.ts (22)`, `newfeatures.test.ts (24)`, `voiceai.test.ts (15)` etc.

---

## 3. New Features Added

### A. Eisenhower Matrix View
- **File:** `src/views/MatrixView.tsx`
- **Route:** `#/matrix`
- **Logic:** Quadrant by `dueDate <= today` (urgent) and `priority === 'high'` (important)
  - Q1 Do (Urgent+Important) 🔥
  - Q2 Schedule (Not urgent+Important) 🎯
  - Q3 Delegate (Urgent+Not important) ⚡
  - Q4 Eliminate (Not urgent+Not important) 🍃
- Integrated in shell nav under "Focus" label, keyboard shortcut `M`.

### B. Weekly Review
- **File:** `src/components/WeeklyReview.tsx`
- **Route:** `#/review` + modal via `R` key
- Shows tasks done/total, habit check-ins, focus minutes, reflection prompts, textarea.
- Accessible from More menu.

### C. Stats Widget (At a Glance)
- **File:** `src/components/StatsWidget.tsx`
- Shown on Today view when not fresh.
- Cards: due today, completed, habits, focus today + streak badge.
- Live badge, responsive 4→2 columns.

### D. Keyboard Shortcuts Sheet
- **File:** `src/components/ShortcutsSheet.tsx`
- Modal listing all shortcuts: ⌘K, /, N, T, M, R, ?, ⌘Z, ⌘⇧Z, Esc.
- Triggered via `?` or More → Keyboard shortcuts.

### E. Focus History (Week Chart)
- **File:** `src/components/FocusHistory.tsx`
- 7-day bar chart of focus minutes from `focusLog`.
- Added to Insights view.

### F. Backup Reminder
- **File:** `src/components/BackupReminder.tsx`
- Shows if no backup in 7 days or no backup ever but data exists.
- Yellow banner with Export / Later, stores timestamp in `planner-last-backup`.

### G. Enhanced Navigation
- Nav groups: **Plan** (Today, Calendar, Tasks, Matrix), **Focus** (Habits, Goals), **Track** (Notes, Plans, Insights, AI coach).
- More menu now includes Matrix, Weekly Review, Shortcuts.

---

## 4. UI Polish — "A Million Times Better"

### Design System
- **New file `src/styles-polish.css`** (imported in `main.tsx`):
  - Global rhythm vars: `--content: 1180px`, `--gap`, `--card-pad`, `--radius`.
  - Content width `min(100% - 32px, 1180px)` with 48px on large screens.
  - View gap 28px, card padding 22px, consistent box-sizing.
  - Sidebar: blurred translucent, border + soft shadow, brand 56px, search 44px with hover lift.
  - Nav links: 40px, 10px radius, hover translateX(2px), active accent-soft.
  - Cards: 20px radius, 22px pad, soft shadow, hover lift + border-strong.
  - Buttons: 40px min-height, 12px radius, hover translateY(-1px), active reset, primary shadow.
  - Fields: 44px, 12px radius, focus ring 3px accent-soft.
  - Timeline, today-grid (1.4fr/0.9fr), responsive.
  - Tabbar: fixed bottom, blurred, 18px radius, shadow-lift, hidden on desktop.
  - FAB: 56px, 18px radius, shadow, hover scale.
  - Empty states centered, 28px pad.
  - Modal: 20px radius, shadow-lift, 92vw max.
  - View enter animation: 0.35s translateY(8px)→0.
  - Matrix, stats, weekly review, shortcuts, backup, focus history styles.

- **New file `src/marketing/marketing-polish.css`** (imported in `Site.tsx`):
  - Nav: sticky, blurred, 64px height, scrolled state with border + shadow.
  - Brand: 32px mark, serif bold.
  - Nav links: pill 999px, hover surface-2.
  - Buttons: 40px, 12px radius, primary dark bg, ghost surface-2, quiet transparent, sm 36px, lg 48px.
  - Hero: 72px top pad, clamp title 36→64px, 0.92 line-height, sub 16→19px, actions gap 12px, trust 13px.
  - Pill: dot 8px green with glow.
  - Sections: 80px pad (56px mobile), head clamp 28→42px.
  - Feature/card hover lift.
  - Split: 1fr/1fr grid, 48px gap, 1fr on mobile.
  - Auth card: 440px max, 24px radius, 32px pad, shadow.
  - Footer: surface-2 bg, 4-col grid → 2 → 1.
  - Reveal: 0.6s fade+translate.
  - CTA: dark bg, centered, 80px inner.

### Box Sizes & Margins Fixed
- All cards now `box-sizing: border-box`.
- Consistent padding: 22px default, 28px large, 14-16px small.
- Gaps: 24px view, 20px grid, 12-16px inside cards, 8px lists.
- Margins: hero 18px gap, view-head 20px, card-head 18px bottom, kicker 6px bottom.
- Buttons: min-height 40px (32px tiny, 36px small, 48px large) ensures touch target.
- Marketing wrap: 28px pad (20px mobile), max 1180px, narrow 760px.

### Motion & Accessibility
- `prefers-reduced-motion` respected for scroll and reveals.
- All interactive elements have hover, active, focus states.
- Kbd styling with border-bottom 2px for depth.
- Skip link, aria labels preserved.

---

## 5. Bug Sweep — Additional Fixes

- Fixed import error `../components/TaskRow` → `../components/items` in MatrixView.
- Fixed `focusSessions` → `focusLog` (actual type in `PlannerState`).
- Fixed Task props: `done`→`completed`, `when`→`dueDate`, priority check `urgent`→`high`.
- Fixed unused imports causing tsc errors.
- Ensured `StatsWidget` and `BackupReminder` use correct types.
- Marketing: ensured buttons have consistent height regardless of `<a>` vs `<button>` (via `:where(.mkt button)` reset fix).
- PWA update toast still works.
- Offline: `offline-trusted` path ensures local data shown even if session expired.

---

## 6. How to Test the Fix

1. **Sign up** with "Keep this device signed in" checked.
2. Close tab, reopen `/` → should auto-redirect to `/app` (or show "Open Planner").
3. Click "Open Planner" → app opens instantly, no password.
4. Sign out → clears device cache + localStorage flags → landing shows Sign in again.
5. With trusted device, kill network → app still opens with local copy (offline-trusted).
6. `/login` while authed → redirects to `/app`.
7. New routes: `#/matrix`, `#/review`, `?` for shortcuts, `M`/`R` keys.

---

## 7. Remaining & Future

*Reconciled with the shipped build on 2026-10-05. Two of these four shipped; two are
still the honest answer.*

- **Server `authStore.ts` is memory-only in dev — still true, and now intentional.**
  `/api/auth/status` reports `storage: "temporary"` for it, dev and preview accounts
  are forgotten on restart, and production has no fallback at all (`storage: "none"`,
  every account endpoint 503s). Redis is not planned; the status endpoint is how a
  developer finds out.
- **Passkey auto-login from the landing/sign-in page — shipped.** The sign-in form
  offers one-touch passkey sign-in (`withPasskey` in `src/marketing/Auth.tsx`) which
  opens the vault directly when the passkey carries the wrapped key.
- **Weekly Review reflection → notes — still open.** The reflection is written into
  the *printed/exported* weekly report and is never saved back to the planner
  (`src/components/WeeklyReview.tsx`).
- **Focus History streaks — shipped.** Per-habit current/longest streaks, and a
  "Day streak" tile on Insights (`src/views/InsightsView.tsx`).

---

## 8. Files Changed / Added

**Modified:**
- `src/auth/session.ts` — persistence
- `src/auth/device.ts` — last-user, list, getLastTrusted
- `src/auth/vault.ts` — offline-trusted, user-info cache
- `src/auth/AccountGate.tsx` — handle offline-trusted
- `src/main.tsx` — bootTarget redirect + polish CSS import
- `src/marketing/Site.tsx` — auth check, redirect, open-planner UI
- `src/marketing/Landing.tsx` — authed CTA
- `src/marketing/Auth.tsx` — redirect if already authed
- `src/marketing/marketing.css` — wrap pad fix
- `src/route.ts` — matrix, review routes
- `src/components/Shell.tsx` — new nav, views, shortcuts, review modal
- `src/views/DayView.tsx` — stats + backup + AI coach
- `src/views/InsightsView.tsx` — focus history
- `src/views/MatrixView.tsx` — new
- `src/tokens.css` — (unchanged, but used)

**Added:**
- `src/styles-polish.css` — massive UI polish
- `src/marketing/marketing-polish.css` — marketing polish
- `src/components/ShortcutsSheet.tsx`
- `src/components/StatsWidget.tsx`
- `src/components/WeeklyReview.tsx`
- `src/components/BackupReminder.tsx`
- `src/components/FocusHistory.tsx`
- `src/views/MatrixView.tsx`
- `REPORT.md` — this file

**Build:** `vite build` succeeds, 143 modules, ~83kB gzipped app.

**Tests:** 124 passed (app, planner, features, newfeatures, voiceai) + 1 skipped.

---

**Summary:** The login persistence bug is fixed via cookie + localStorage + IndexedDB triple layer. UI is polished with consistent box sizes, margins, shadows, motion. New features (Matrix, Review, Stats, Shortcuts, Focus History, Backup Reminder) add real value without breaking existing flows. All features audited and working.
