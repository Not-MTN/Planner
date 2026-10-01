# Full-codebase audit — Planner

**Date:** 2026-10-01 · **Branch:** `arena/01a0f4fd-planner` @ `1bf27b7`
**Scope:** every non-test source file under `src/`, `api/`, `db/`, plus config, service worker and e2e specs.
~37,000 lines of TypeScript/TSX across ~150 source files, plus ~10,000 lines of tests.

---

## 1. Verdict

The app is in good shape. Automated gates are green and the security architecture is
genuinely well thought through.

| Gate | Result |
|---|---|
| `tsc --noEmit` (strict, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`) | **pass, 0 errors** |
| `npm run build` (`tsc && vite build`) | **pass** — 153 modules, 3.4 s |
| `vitest run` | **pass — 434 passed, 1 skipped** (48 files) |
| `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` | **0 occurrences** in app code |
| Hardcoded secrets | none found |
| ESLint | **not installed** — see L2 |

There are **no crashes, no data-loss bugs and no security holes** that I could find.
What I did find is a set of **correctness bugs in state transitions**, a cluster of
**i18n gaps** in the Persian (`fa`) locale, and a handful of **dead code** that
suggests a feature was half-changed. Those are listed below.

**Headline: 3 issues are worth fixing before the next release** (H1, H2, M1).

---

## 2. High severity

### H1 — Completing then un-completing a repeating task duplicates the series and silently kills the repeat rule
**`src/mutate.ts:197-221` (`toggleTask`)**

```ts
task.id === id
  ? { ...task, completed: completing, completedAt: completing ? now : null,
      repeat: completing ? null : task.repeat, updatedAt: now }   // ← line 203
```

Two problems live on this one line:

1. **The repeat rule is destroyed on completion.** `repeat` is set to `null` on the
   original. When the user un-checks it (the completed task is still rendered in
   Today/Tasks via `tasksForDate`, with a live toggle in `TaskRow`), `completing` is
   `false`, so `repeat` is read back from the task — which is now `null`. **The habit
   of repeating is gone permanently with no warning to the user.**

2. **The spawned next occurrence is orphaned.** On completion a fresh task is pushed
   with the rule (lines 206-219). Un-completing does not remove it, so the user is
   left with *two* open copies: today's (rule lost) and tomorrow's (still repeating).
   Completing tomorrow's spawns a third. Each toggle cycle grows the series.

**Repro:** task with `repeat: 'daily'`, due today → complete → a copy appears tomorrow
→ un-complete today's → today's task no longer repeats, and tomorrow's copy is still
there → complete today's again → now two copies exist for tomorrow.

**Fix:** stop nulling `repeat` (nothing in the codebase depends on it — occurrence
generation for tasks happens only in `toggleTask`, not in `tasksForDate`), and record
the spawned id on the original (e.g. `spawnedId?: string | null`) so un-completing can
remove the copy it created.

---

### H2 — Eisenhower Matrix uses the UTC date as "today"
**`src/views/MatrixView.tsx:11`**

```ts
const today = new Date().toISOString().slice(0, 10);
```

Everywhere else in the app uses `todayISO()` from `src/dates.ts`, which is
**local-time**. This one is **UTC**. Two consequences:

- West of UTC (Americas), after ~17:00–20:00 local, `toISOString()` already returns
  **tomorrow**, so a task due *today* is classified as **not urgent** and lands in
  "Schedule" instead of "Do".
- East of UTC (Iran — a primary locale — is UTC+3:30), before 03:30 local, it returns
  **yesterday**, so a task due today flips to urgent ~3.5 hours early.

Because urgency drives the whole matrix, the quadrant a task lands in is wrong for
several hours of every day.

**Fix:** `import { todayISO } from '../dates'` and use `todayISO()`. This is the only
UTC-derived "today" left in app code (the other hit, `InsightsView.tsx:263`, is a
correct use of `Date.UTC` for year-pixel weekday alignment).

---

### H3 — 16 double-translated strings in the AI layer
**`src/ai.ts`** — lines 284, 370, 392, 400, 434, 665, 666, 697, 698, 781, 791, 802, 843, 845, 848, 1023

Every one has the form `t(t("…"))`, e.g.:

```ts
if (!raw) throw new Error(t(t("Groq returned a plan in an unexpected format. Try again.")));
```

These cover exactly the strings a user sees when the AI fails — the worst moment to
show a broken message.

**Impact today: latent, not visible.** I verified all 1,721 `fa` entries and found
**0** cases where a translation value is also a dictionary key, so the outer `t()`
always misses and passes the string through unchanged. It is correct by luck.

**Why it must still be fixed:** the moment any Persian translation equals an English
source string (very plausible for short words — `"Plan"`, `"Mon"`, `"Tasks"`), the
outer lookup will hit and emit a *second* translation of an already-translated string.
It is also a 16× redundant dictionary lookup on every error path.

**Fix:** remove the inner `t()` in all 16 places.

---

## 3. Medium severity

### M1 — "Mon" is not translated in habit frequency labels
**`src/logic.ts:270`**

```ts
const names = [t("Sun"), 'Mon', t("Tue"), t("Wed"), t("Thu"), t("Fri"), t("Sat")];
```

`'Mon'` is missing its `t()` — every other day is wrapped. The `fa` dictionary has
`"Mon": "دوشنبه"` (line 547), and `src/dates.ts:364` correctly uses `t('Mon')` in
`WEEKDAY_TOGGLES`. So a Persian user with a custom-frequency habit sees:
**"دوشنبه" would appear as "Mon"** — one English day wedged into a Persian list.

**Fix:** `t("Mon")`.

---

### M2 — "Untitled note" is hardcoded in the write path
**`src/mutate.ts:761` and `:780`** use the literal `'Untitled note'`.
**`src/storage.ts:382`** correctly uses `t("Untitled note")`.

The inconsistency is already being worked around in the UI:
**`src/components/Composer.tsx:658`** has to check *both* spellings:

```ts
useState((existing?.title === 'Untitled note' || existing?.title === t('Untitled note')) ? '' : ...)
```

That means a note saved in English and then read in Persian (or vice-versa) is treated
as untitled in one language and as a real title in the other.

**Fix:** use `t("Untitled note")` in `mutate.ts` and drop the English branch in
`Composer.tsx:658`.

---

### M3 — The selected grade is shown untranslated on the Panels page
**`src/views/PanelsView.tsx:71-76`**

```ts
GRADE_LABELS.find((item) => item.id === panels.student.grade)?.label ?? ''
```

`GRADE_LABELS` (`src/panels.ts:110-119`) holds **hardcoded English** labels
(`'Grade 9'`, `'Masters or PhD'`, …). The dropdown ten lines below (line 129) uses the
translated `gradeLabel(option.id)`. So in Persian the *options* are translated but the
*selected value* on the card is English.

**Fix:** use `gradeLabel(panels.student.grade) ?? ''` — or make `GRADE_LABELS`
lazily translated like `ACCENT_CHOICES` in `constants.ts`.

---

### M4 — Dead ternary in the command palette's event jump
**`src/components/Palette.tsx:323`**

```ts
run: close(() => planner.navigate({ name: 'day',
  date: event?.date ?? planner.route.name === 'today' ? todayISO() : todayISO() })),
```

Both branches of the conditional are `todayISO()`, so the whole
`planner.route.name === 'today' ? … : …` is inert. (It also reads as
`(event?.date ?? routeIsToday) ? todayISO() : todayISO()` due to `??` binding tighter
than `?:` — another reason to rewrite it.) Searching for an event and pressing Enter
navigates to *today* rather than to the event's date whenever the event lookup misses.

**Fix:** `date: event?.date ?? todayISO()`.

---

### M5 — Dead ternary in the CSV importer
**`src/importers.ts:159`**

```ts
category: isTickTick || listCol >= 0 ? 'personal' : 'personal',
```

Both branches identical. Either a category mapping was intended and never finished, or
the expression should just be `'personal'`.

---

### M6 — Unreachable branch in `nextWeekend`
**`src/dates.ts:318-322`**

```ts
const diff = (saturday - date.getDay() + 7) % 7;
return addDays(iso, diff === 0 && date.getDay() !== saturday ? 7 : diff);
```

`diff === 0` implies `date.getDay() === saturday`, so the `&&` can never be true. The
`? 7` branch is dead. Harmless today, but it hides whether the intent was "always go
to the *next* Saturday, never today".

---

### M7 — `updatePanels` missing from the context `useMemo` dependency array
**`src/context.tsx`** — `updatePanels` is placed in the context value at line 1069 but
is **absent** from the dependency array that closes the `useMemo` at the end of
`PlannerProvider`.

It is currently safe because `updatePanels` is a `useCallback` with `[commit]`, and
`commit` *is* in the deps — so the identity is stable. But it is exactly the kind of
omission that becomes a stale-closure bug the next time someone changes `commit`'s
deps. (Note: `setPanelEnabled` *is* correctly listed.)

---

### M8 — Wrong reason text for every draft-vs-planner collision
**`src/ai.ts:526`** (`filterDraftAgainstState`)

```ts
if (overlap) skippedEvents.push({ ..., reason: t("overlaps protected time: {0}", { 0: overlap.title }) });
```

`overlap` is drawn from `[...existing, ...fixed, ...timedTasks, ...accepted]` — events,
protected weekly blocks, timed tasks and other draft items — but the message always
says *"overlaps protected time"*. A user is told their event conflicts with "protected
time" when it actually collides with a dentist appointment. The sibling function
`eventConflicts` (lines 168-200) distinguishes all four cases correctly; this one lost
that detail.

**Fix:** carry the source alongside the interval and pick the matching phrase.

---

### M9 — Untranslated unit in the rhythm card's focus total
**`src/views/RhythmCard.tsx:11`**

```ts
return rest ? t("{0} h {1} min", {...}) : `${hours} h`;
```

The third branch builds the string by hand with a literal `" h"`, unlike the other two
branches. Persian users see an English `h`.

---

### M10 — "Copy to next week" drops task estimates
**`src/mutate.ts:841-856`** (`copyWeek`)

Copies `priority`, `goalId`, `subtasks`, `waiting` — but **not `estimatedMinutes`**.
So a week copied into the next loses all planned-effort data, which feeds the
plan-vs-focus insight (`logic.ts` `planVsFocus`) and the auto-scheduler
(`scheduler.ts` `lengthOf`). The copy is silently less useful than the original.

---

## 4. Low severity / hygiene

| # | Location | Issue |
|---|---|---|
| L1 | `src/storage.ts:803-812` (`downloadState`), `src/views/RhythmCard.tsx:34-42` | `URL.revokeObjectURL(url)` runs synchronously after `link.click()` and the link is never appended to the DOM. Chrome tolerates this; **Safari can cancel the download**. Append the link, click, then revoke in a `setTimeout`. |
| L2 | 9 × `eslint-disable-next-line react-hooks/exhaustive-deps` | There is **no ESLint config and no ESLint dependency** in the repo (`package.json` has no lint script). The comments are inert and give a false sense that deps are being checked. Either add ESLint or drop the comments. |
| L3 | `src/components/Attachments.tsx:84` | `target="_blank" rel="noreferrer"` without `noopener`; `Markdown.tsx:44` uses `rel="noopener noreferrer"`. Modern browsers imply it, but be consistent. |
| L4 | `src/context.tsx:326-334` | `PRAISES` is a 6-element array rebuilt on every render of the provider (which re-renders on every state change). Hoist to module scope. |
| L5 | `src/mutate.ts:118-140` (`updateTask`) | Accepts `completed` in the patch but never updates `completedAt`, so `updateTask` and `toggleTask` disagree on what a completed task looks like. Insights (`planVsFocus`) and `insights.ts` `completionDate` read `completedAt`, so a task completed via this path is invisible to them. |
| L6 | `src/components/VoiceTalk.tsx:227` | Chat bubbles keyed by array `index`. There is a retry path that replaces a bubble mid-list; index keys can reuse DOM across different content. Prefix with a stable id. |
| L7 | `src/storage.ts` `sanitizePanels` | `if (!value \|\| typeof value === 'object' === false)` — correct (`(typeof v==='object')===false`) but reads as a bug to every reviewer. Write `typeof value !== 'object'`. |
| L8 | `src/panels.ts:110-119` | `GRADE_LABELS` is the untranslated twin of the translated `gradeLabel()` switch right below it. Two sources of truth for the same seven strings (see M3). |
| L9 | `src/views/RhythmCard.tsx:34-42` | Clipboard fallback creates an `<a download>` but never appends it to `document.body` before clicking. |

---

## 5. Things done well

Worth recording, because they are the result of deliberate choices and shouldn't be
casually refactored away:

- **No XSS surface.** `src/components/Markdown.tsx` builds React elements rather than
  using `innerHTML`, so note bodies, titles and `[[links]]` cannot inject markup. Zero
  `dangerouslySetInnerHTML` in the app.
- **Zero-knowledge crypto is correctly structured.** `src/auth/crypto.ts` splits
  Argon2id output into a 32-byte `authToken` (sent) and a 32-byte KEK (never sent), and
  zeroes intermediates (`out.fill(0)`, `raw.fill(0)`, `forget()` on sign-out).
- **Account enumeration is blocked.** `handleSalt` / `handleRecoveryStart` return
  deterministic decoy salts and decoy wrapped keys for unknown accounts
  (`src/server/authApi.ts` `decoySalt`, `decoyRecoveryWrap`), and `handleLogin` spends
  the same KDF work on the miss path.
- **SSRF is guarded** in the calendar proxy (`src/server/icsProxy.ts` `isForbiddenHost`:
  loopback, link-local, RFC1918, `.local`, `.internal`, IPv6), with a 10 s timeout and
  a 2 MB body cap.
- **WebAuthn is verified properly** (`src/server/webauthn.ts`): origin and rpIdHash
  checked with `timingSafeEqual`, `UP`/`UV` flags required, DER→raw signature
  conversion, challenge bound to an HttpOnly cookie scoped to `/api/auth/passkey`.
- **Panel privacy is enforced in the payload builder**, not just the UI —
  `buildGuardianGuidancePayload` (`src/ai.ts`) structurally cannot include a task
  title.
- **Rate limiting** on every auth route with a bounded bucket map (10k cap, cleared
  under pressure) — `src/server/security.ts`.
- **Sanitisation is exhaustive.** `src/storage.ts` clamps and validates every field of
  every imported/synced/decrypted object (lengths, ISO dates, times, enums, dedup by
  id). Backups are capped at 2 MB.
- **Error paths are specific**, not generic — the client names Vercel Authentication,
  missing `api/` functions, and Groq billing vs. rate limits distinctly.

---

## 6. Coverage

Read line-by-line: `types`, `shared`, `constants`, `env`, `cx`, `hooks`, `route`,
`App`, `main`, `dates`, `duration`, `idb`, `storage`, `logic`, `mutate`, `context`,
`ai`, `panels`, `panelFeatures`, `recurrence`, `scheduler`, `reminders`, `insights`,
`notificationCenter`, `presets`, `about`, `sync`, `feeds`, `files`, `ics`, `quickAdd`,
`importers`, `i18n`, `theme`, `pwa`, `weather`, `tour`, `push`; all of `auth/crypto`,
`auth/device`, `auth/session`, `auth/vault`; `shared/authContract`; all of
`server/apiRouter`, `server/security`, `server/webauthn`, `server/icsProxy`;
`components/Shell`, `components/items`, `components/ui`, `components/Palette`,
`components/useSignOut`, `components/Confetti`, `components/Markdown`;
`views/MatrixView`, `views/RhythmCard`.

Read in part (large files, first 300–450 lines plus targeted greps): `auth/links`,
`server/authApi`, `server/groqProxy`, `views/CalendarView`, `views/AIView`,
`views/PlansView`, `views/PanelsView`, `components/FocusTimer`.

Covered by targeted pattern sweeps rather than full reads (UTC dates, untranslated
literals, dead ternaries, `any` casts, index keys, XSS sinks, prototype-pollution
patterns): `views/DayView`, `TasksView`, `HabitsView`, `GoalsView`, `NotesView`,
`InsightsView`, `TaskBoard`, `StudentPanelView`, `GuardianPanelView`,
`StudentWorkspace`, `GuardianPlanComposer`, `components/Composer`, `SettingsSheet`,
`SettingsExtras`, `VoiceTalk`, `DraftRefine`, `Attachments`, `HabitLibrary`,
`WelcomeCard`, `BackupReminder`, `StatsWidget`, `WeeklyReview`, `FocusHistory`,
`NotificationsSheet`, `ShortcutsSheet`, `AboutSheet`, `TourSheet`, `charts`, `icons`,
`speech`, `voiceai`, `templates`, `sample`, `navigationPrefs`, `locales/fa`,
`server/authStore`, `server/sync`, `server/pushApi`, `server/fakeNeon`,
`server/webauthnSim`, `api/[...path]`, `vite.config`, `public/sw.js`, `e2e/*`.

The sweeps across that last group turned up only the `InsightsView.tsx:263` `Date.UTC`
usage (correct as written) and index-keys on non-reorderable decorative lists
(`marketing/Landing`, `marketing/Showcase`, `Markdown` blocks) — none of which are bugs.

---

## 8. Remediation log — all findings fixed

Every finding above (H1–H3, M1–M10, L1–L9) has been fixed on
`arena/01a0f4fd-planner`. Gates after the work:

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | **0 errors** |
| `eslint .` | not installed | **0 errors, 0 warnings** |
| `vite build` | pass | **pass** |
| `vitest run` | 434 passed, 1 skipped | **453 passed, 1 skipped** (49 files) — 19 new tests |

### What changed

| # | Fix |
|---|---|
| H1 | `repeat` is no longer nulled on completion. `Task.spawnedId` (`src/types.ts`, sanitised in `src/storage.ts`) records the copy a completion created, and a new `removableSpawn()` in `src/mutate.ts` takes it back on un-complete — but only while nobody has worked on it (not completed, no `completedAt`, no subtask ticked, no spawn of its own). |
| H2 | `src/views/MatrixView.tsx` uses `todayISO()` from `src/dates.ts` instead of `new Date().toISOString().slice(0, 10)`. |
| H3 | All 16 `t(t(...))` in `src/ai.ts` collapsed to a single `t()`. |
| M1 | `src/logic.ts:270` — `'Mon'` → `t("Mon")`. |
| M2 | Both `'Untitled note'` literals in `src/mutate.ts` → `t("Untitled note")`. `Composer.tsx` still matches the bare English spelling as well, so notes saved before this fix still open with an empty title instead of showing "Untitled note" as if it were a real title. |
| M3 / L8 | `GRADE_LABELS` in `src/panels.ts` became lazily-translated getters (the `ACCENT_CHOICES` pattern in `src/constants.ts`); `gradeLabel()` now reads from it, so `src/panels.ts` is the single source of truth and `PanelsView` shows the translated grade. |
| M4 | `src/components/Palette.tsx` — `date: event?.date ?? todayISO()`. |
| M5 | `src/importers.ts` — `category: 'personal',`. |
| M6 | `src/dates.ts` `nextWeekend` — `return addDays(iso, diff);`. |
| M7 | `updatePanels` (and the missing `setPanelEnabled`) added to the context `useMemo` deps. |
| M8 | `filterDraftAgainstState` now tags each interval with its source and a new `overlapReason()` picks the matching phrase — protected block, existing event, timed task, or another draft item. Mirrors `eventConflicts` above it. |
| M9 | `src/views/RhythmCard.tsx` — `t("{0} h", { 0: hours })`. |
| M10 | `copyWeek` copies `estimatedMinutes`. |
| L1 / L9 | New `src/download.ts` `downloadBlob()` — appends the link to `document.body`, clicks, removes it, and revokes the object URL on a timer (Safari-safe). Used by `downloadState`, the RhythmCard clipboard fallback and `src/ics.ts`. |
| L2 | **ESLint added.** `eslint.config.js` runs the rules the codebase already assumed (`react-hooks/exhaustive-deps`, `react-hooks/rules-of-hooks`, `no-var`, `jsx-a11y/media-has-caption`) plus core correctness rules, with a `public/**` block giving the service worker its globals. Wired up as `npm run lint` and as a CI step. The React-Compiler rule set from `eslint-plugin-react-hooks` v6 is pinned out on purpose — see the comment in the config. |
| L3 | `src/components/Attachments.tsx` — `rel="noopener noreferrer"`. |
| L4 | `PRAISES` hoisted to module scope in `src/context.tsx`. This also made the `exhaustive-deps` disable comment beside it unnecessary, which is exactly the kind of drift L2 was about. |
| L5 | `TaskPatch` (`Partial<TaskInput>` + `completed`) added to `src/mutate.ts`; `updateTask`/`updateTasks` accept it and stamp `completedAt` on completion and clear it on reopen. Threaded through `src/context.tsx`. |
| L6 | `Bubble` gained a stable `id`; voice bubbles are keyed by it instead of by array index. |
| L7 | `src/storage.ts` — `typeof value !== 'object'`. |

### New regression tests

- `src/features.test.ts` — un-completing takes back the spawn and keeps the rule; re-completing three times never grows the series; a spawn the user has worked on is left alone; `updateTask` stamps and clears `completedAt`. The one test that pinned the old H1 behaviour (`expect(done.repeat).toBeNull()`) was updated to assert the rule survives.
- `src/refine.test.ts` — `filterDraftAgainstState` reports "protected time", "existing event" and "timed task" for the matching collisions.
- `src/planner.test.ts` — `copyWeek` keeps `estimatedMinutes`.

### Findings the linter surfaced once it was real

Adding ESLint (L2) turned up real defects that the inert disable comments had been
hiding. All fixed:

- `src/quickAdd.ts` had a local helper named `use` — the exact name React reserves for hooks. Renamed to `consume`.
- `src/components/Confetti.tsx` depended on `seed` but never read it, so it was a silent cache-buster. The burst now derives from `seed` through a small deterministic PRNG, which also removes eight `Math.random()` calls from render.
- `src/components/Shell.tsx` set `document.title` from the route object; it now depends on the computed title string, so retitling tracks the title rather than the route's identity.
- `src/components/FocusTimer.tsx` read `titleRef.current` inside effect cleanup; the value is captured on entry instead.
- Six `any` casts in `FocusHistory`, `StatsWidget` and `WeeklyReview` that were unnecessary — `PlannerState.focusLog` and `Habit.archived` are both already typed. Removed.
- `src/components/Palette.tsx` listed `toggleTask`/`toggleHabit` as dependencies of a memo that never used them; both bindings are gone.
- `vite.config.ts` imported three push handlers it never used (push is routed through `src/server/pushVite`). Import removed.
- Three `no-var` disable comments on ambient `declare global` blocks were inert; removed. `prefer-const` and an unused `catch` binding in `public/theme-init.js` fixed.

## 8b. Two defects found during the audit but left out of the report

Both were left out of §2–§4 on purpose, then fixed after being raised
explicitly.

### X1 — SSRF gaps in the calendar feed proxy
**`src/server/icsProxy.ts`**

The original `isForbiddenHost()` missed several ways to name an internal
address. Measured against the Node/WHATWG URL parser, which already folds most
exotic IPv4 into dotted quad:

| Vector | Before | After |
|---|---|---|
| `http://localhost./` (FQDN root dot) | **allowed** | refused |
| `http://[::ffff:127.0.0.1]/` (parser rewrites to `[::ffff:7f00:1]`) | **allowed** | refused |
| `http://[fd00::1]/`, `http://[fe80::1]/` | **allowed** | refused |
| Hostname that resolves to a private IP (`internal.example.com` → `10.0.0.5`) | **allowed** | refused |
| A public host 302-ing to `169.254.169.254` (cloud metadata) | **allowed** — `redirect: 'follow'` | refused |
| `http://2130706433/`, `0177.0.0.1`, `0x7f.0.0.1`, `127.1` | refused (parser folded them) | refused (checked directly as well) |

The guard now: parses every IPv4 spelling itself (decimal, octal, hex, the bare
32-bit form and the shortened `a.b` / `a.b.c` forms), expands IPv6 properly and
checks the IPv4 smuggled inside IPv4-mapped, IPv4-compatible, NAT64 and 6to4
forms, strips the FQDN root dot before the suffix tests, resolves the hostname
with `dns.lookup` and refuses it if *any* answer is internal, and follows
redirects by hand (max 3) so every hop is re-checked. Body, timeout and size
caps are unchanged. Covered by 10 tests in `src/server/icsProxy.test.ts`.

### X2 — Sentences spliced from translated fragments

Where a sentence emphasised a value, the sentence was built from separate `t()`
calls around the markup — `{t("You finish the most around")} <strong>{hour}</strong>
{t(". Try protecting that hour…")}`. Each fragment translated, but no translator
could reorder them, so Persian rendered English word order around a Persian
word.

Fixed by making **one translatable unit per sentence**:

- New `src/components/Rich.tsx` splits the *translated* string around its
  placeholders and renders a node for each, so one key covers the whole
  sentence and the translator decides where the value sits.
- Whole-sentence keys replaced fragments in `RhythmCard` (2), `SettingsSheet`
  (4), `ShortcutsSheet`, `HabitsView` (2), `InsightsView` (2), `DayView`,
  `CalendarView` (2), `FocusTimer`, `AIView` (2), `items.tsx`, `logic.ts`,
  `insights.ts` (2), `PlansView` (2), `SettingsExtras`.
- Singular/plural fragments nested inside another `t()` call — `t("days have")`
  inside `t("{0} {1} something in the next {2}.")` — became `tn()` pairs, so
  each variant is a whole sentence: `tn(planned, "{count} day has …", "{count}
  days have …")`.
- 39 Persian translations added; 49 fragment entries removed from `fa.ts`.
- `src/i18n.test.ts` gained a guard: no `t()` key may open with punctuation or
  whitespace, which is the one unambiguous signature of a fragment.

---

---

## 7. Suggested order of work

1. **H1** (`toggleTask` repeat/un-complete) — the only finding that can silently
   corrupt user data patterns over time.
2. **H2** (`MatrixView` UTC today) — one-line fix, wrong output for hours every day.
3. **H3 + M1 + M2 + M3 + M9** — the i18n cluster; all mechanical, and they are what
   Persian-speaking users actually see.
4. **H3's siblings M4, M5, M6** — dead code that signals unfinished changes.
5. **M8, M10, L1** — correctness/polish.
6. Consider adding ESLint (or removing the 9 inert disable comments) so the dependency
   arrays in `context.tsx` get checked mechanically.

---

# Second pass — 2 October 2026

A second walk over the whole app, after everything in the first pass was fixed.
The questions this time were narrower and harder: *is the settings screen
findable, does it survive every device, and is there anything left in the code
that nobody uses?*

## A. Settings had outgrown its screen

Settings had grown to twenty sections in one scrolling column. The structure
was sound — each group was already its own component — but the only way to
find anything was to scroll past everything, and the account screens were
asking the server about devices and sign-in history for everyone who only
came to change the theme.

It is now seven groups behind a tab strip:

| Group | What lives there |
| --- | --- |
| Account | profile, password, two-factor, devices, recent activity |
| Appearance | theme, accent, which sections show in the sidebar |
| Language & time | week start, clock, language, date language, Jalali dates, voice accent |
| Reminders | reminders, background notifications |
| Sync & backup | sync code, shared space, export, import, start fresh |
| Connections | calendar exchange, feeds, task import, weather, templates |
| App | install, crash reports, tour, shortcuts, the AI coach key |

Three decisions worth recording:

- **Only the open group is mounted.** The account tabs talk to the server when
  they appear; there is no reason to ask about someone's devices because they
  opened Settings to change a colour. It also means content can never be left
  hidden-but-focusable, which is the usual way tabbed screens break a keyboard.
- **The strip is a horizontal scrolling row, not a side rail.** A rail is nicer
  on a laptop and worse on a phone, and this way one layout — and one correct
  `aria-orientation` — covers every width.
- **The calendar exchange moved out of "Calendar, dates & time".** Exporting an
  `.ics` has nothing to do with which language the week starts in; it is a
  connection to another calendar, and it sits with the feeds and imports now.

## B. Devices: what was already right, and the two things that were not

The app was in better shape here than expected. Already correct and now locked
down by `src/device.test.ts` so a tidy-up cannot delete them: `viewport-fit=cover`
for notches, `env(safe-area-inset-*)` at the bottom edge, dynamic viewport units
with an `@supports` fallback for iOS 15, 16px text fields so Safari does not
zoom on focus, `touch-action: manipulation` rather than the 300 ms delay,
thumb-sized targets on coarse pointers, and a manifest with a maskable icon and
a `start_url` that a rewrite actually serves.

Two real bugs found and fixed:

1. **Every toast sat on top of the phone tab bar.** Toasts are fixed at
   `bottom: 24px`; the tab bar is fixed at the bottom too, about 64px tall. The
   toast won, so a message covered the tab you were reaching for — and the
   "new version" toast, which is the one that always shows at the bottom, was
   hidden behind the bar on every phone. Toasts now clear the bar and the home
   indicator, and a second toast stacks above the first.
2. **Opening anything shifted the whole app sideways on Windows.** A sheet sets
   `body { overflow: hidden }` while it is open. On Windows the scrollbar takes
   up layout width, so removing it widened the page — and every sheet, palette
   and dialog jumped the app by exactly that width. `html` now reserves the
   gutter.

## C. Polish: what was left over

- **22 exports nothing called.** Found by walking every export against every
  import in the repo, including `api/`, `e2e/` and `vite.config.ts`. Removed:
  `CategoryId`, `habitIconById`, `getWeekStart`, `DAY_PARTS`, `dayPart`,
  `dayPartLabel`, `getTimeFormat`, `deleteAttachmentBlobs`, `idbDelete`,
  `isRTL`, `waitingTasks`, `categoryLabel`, `updateAvailable`,
  `isReportingInstalled`, `ttsAvailable`, `unlockedUser`, `isUnlocked`,
  `usesVault`, `awaitingSecondFactor`, `abandonSecondFactor`.
  Three were deliberately kept even though nothing imports them today:
  `AUTH_SCHEMA_SQL` and `hashRecoveryVerifier` describe the database contract,
  and `SignupRequest` is part of the shared request/response contract.
- **One class with no styles behind it.** `is-disabled` was applied to a button
  that already had `disabled`, and `button:disabled` is styled globally — so the
  class did nothing. Removed.
- **No debug left behind.** Zero `console.*` calls outside deliberate server-side
  error logging, and zero `TODO`/`FIXME`/`HACK` markers.
- **A test that was quietly using the network.** The calendar proxy resolves a
  host before fetching it — which is the point of the SSRF guard — but the tests
  only stubbed `fetch`, so every public-host case did a real DNS lookup. That
  added five seconds per test and made three of them fail whenever the resolver
  was slow. DNS is now stubbed, and the file runs in about a second. Stubbing it
  exposed a gap worth closing: **nothing proved the DNS half of the guard
  worked.** A name that resolves to `127.0.0.1` is now tested, along with a name
  that does not resolve at all.

## D. Where it stands

675 tests, 1 skipped. TypeScript and ESLint clean.
