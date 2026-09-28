# Planner

A calm, local-first planner for your day, your week, and the days ahead — tasks, habits, goals, and notes in one beautiful place.

Planner data is saved in this browser (`localStorage`, mirrored to IndexedDB). Optional **end-to-end encrypted sync** keeps devices in step through your own Neon database — there are no accounts, and the server only stores ciphertext. If you choose to use AI, the current prompt, any AI memory you explicitly saved, and the minimum schedule/check-in details needed for that request pass through the server-side proxy to xAI. Planner notes are not sent. Use **Settings → Export** for a backup file, and **Settings → Import** to bring one back.

```bash
npm install
npm run dev
```

Other scripts: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` (browser tests — run `npx playwright install chromium` once first).

See [SECURITY.md](SECURITY.md) for the threat model, deployment hardening, privacy boundaries, and vulnerability reporting process. No app can be guaranteed unhackable; protect the device, browser profile, sync code, and server secrets too.

## Sync across devices (Neon)

1. Create a project at [neon.tech](https://neon.tech) and copy the connection string (Dashboard → **Connect**).
2. Set it as `DATABASE_URL`:
   - **Vercel:** Project Settings → Environment Variables → `DATABASE_URL`, then redeploy. (Or use Vercel's Neon integration, which adds it for you.)
   - **Locally:** add `DATABASE_URL=...` to `.env.local` and restart `npm run dev`.
3. In Planner: **Settings → Sync across devices → Turn on sync**. Copy the 20-character code, then on your other device choose **I have a code**.

The table is created automatically on first use (`db/schema.sql` has the same SQL if you'd rather run it yourself).

How it works: the sync code never leaves your devices. The browser derives an AES-GCM-256 key from it (PBKDF2, 150k rounds) and encrypts the whole planner before upload; the database row is keyed by a SHA-256 hash of the code. Uploads use version numbers, so two devices can't silently overwrite each other — if both changed, items are merged by id and the most recently edited copy wins. Anyone with the code can read your planner, so keep it private; **Delete cloud copy** removes the row.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/sync/status` | GET | `{ configured: boolean }` |
| `/api/sync` | GET / PUT / DELETE | Read, compare-and-swap write, or delete the encrypted blob (`X-Sync-Id` header) |


## Languages (English / فارسی)

Settings → **Language** switches the whole interface to Persian with a right-to-left layout (Vazirmatn font, mirrored arrows, logical CSS). Choosing فارسی also sets Persian day/month names and a Saturday week start; the page reloads to apply. The AI coach replies in Persian while it is selected.

- Strings are wrapped in `t('English text')` (`src/i18n.ts`); English is the key and the fallback.
- Persian lives in `src/locales/fa.ts`. `src/i18n.test.ts` fails if any `t(...)` string lacks a translation or a placeholder like `{0}` goes missing.
- Dates stay on the Gregorian calendar with Latin digits so times and ISO dates line up everywhere.

## What's inside

**Nine simple places** — Today, Calendar (Week · Month · Upcoming), AI Coach, Plans, Tasks, Habits, Goals, Notes, Insights.

- **A calm first-run tour** — the very first visit opens a language choice (English / فارسی), then a step-by-step showcase (13 short stops) teaches Today, quick add, day planning, timeline, habits, mood, journal, ⌘K search, Tasks views, Calendar, Insights and Settings. The app is paused while it teaches, so nothing can be mispressed; Escape skips it, and it never appears again on its own. Replay from the **?** button, the More sheet, or Settings → New here. The **Why Planner?** sheet (same places) answers what makes this app worth choosing.
- **Voice everywhere it counts** — dictate into the AI coach prompt (tap the mic and just describe your day, in English or فارسی) and into quick add. Uses the browser's built-in speech service, so nothing is recorded anywhere else.
- **Accents welcome** — pick the English accent that sounds most like you (Settings → Voice: US, UK, India, Australia, Nigeria, South Africa, or Persian). The recognizer listens in that accent, keeps the engine's most confident reading of what you said, and the AI is tuned to hear misheard words, homophones, and mixed English–Persian speech without ever asking you to repeat yourself.
- **Talk to your planner** — on the AI Coach screen, tap the big mic orb and just *say* it: “I'm wiped, make tonight easy” or «فردا روز سنگینیه.» Say how long to plan — “plan my next two weeks”, «ده روز آینده» — and it plans exactly that stretch. The AI understands tired, casual, accented, mixed English–Persian speech, answers out loud (when the browser has a voice for it), and builds the plan from the conversation for your review — no typing, no formal phrasing needed, one tap to mute.
- **A Plans page for every draft** — every plan the AI builds (typed or spoken, for however many days you asked) is saved automatically to **Plans**. Come back any time, open a draft, and add it to the planner when it feels right; adding marks it done and stays one undoable batch.
- **Revise drafts in place** — don't start over when a draft is close. Type a change ("make Tuesday lighter", "move the workout to evening") or just *say* it to the voice orb, and the AI edits the plan you're looking at — keeping everything you didn't ask to change — and updates the saved copy on the Plans page in the same step.
- **Plans that see your real week** — drafts are built around what's already true: protected weekly times, existing events, how full each day already is, overdue tasks, and recent mood check-ins. Locally, an instant check flags days that would land packed once added, items at unusual hours, and long ranges with whole days left empty — before you press Add.
- **Any file, any note** — attach anything to a note (music, photos, PDFs…). Files up to 20 MB live in local IndexedDB storage, play inline (audio player, image previews), download back out, and travel with backups. No uploads, no accounts — your bytes never leave the device unless you sync them yourself.
- **Today** — one quiet page for the day: timeline with a live "now" marker, tasks, habits, notes, a daily intention, and a progress ring that celebrates when the day is complete.
- **Daily essentials** — built-in must-do-every-day jobs (drink water, move 30 minutes, get outside, sleep by 11, tidy, vitamins) pinned to the top of Today with their own progress. First run offers them as a one-tap starter pack.
- **Habit library** — a shelf of classic habits and routines (body, mind, home, connection) you can add in one tap, with "Add all" per group.
- **Hand-painted illustrations** — warm gouache artwork on the Today panel, empty states, insights, and the habit library, drawn in the app's own palette.
- **Smart quick add** — type the way you think: `Call mom tomorrow 5pm #personal !high` becomes a task with the date, time, category, and priority filled in. A time range like `Deep work 9:30-11:30` becomes an event. Live chips show what will happen before you press Enter.
- **Command palette** (`⌘K` / `Ctrl+K` or `/`) — search everything, jump anywhere, add anything, toggle dark mode, start a focus session.
- **Undo & redo** — every change is undoable (`⌘Z` / `⌘⇧Z`), and removals show a toast with an Undo button. No more confirm dialogs for small mistakes.
- **Focus timer** — pick a task (or don't), choose 15–60 minutes, and get a full-screen breathing timer with a soft chime at the end.
- **Habits** — streaks (current & best), a week strip, and a 12-week heatmap you can tap to fill in any day.
- **Calendar** — drag events between days in Week view, see the month at a glance, and scroll the days ahead in Upcoming (7 / 14 / 30 / 90 days). A load strip shows quiet vs full days; undated tasks sit in **Someday** and can park on the quietest day.
- **Insights** — day streak, weekly bars, a 7/30/90-day completion trend, a task/event/habit completion donut, habit consistency, and goal progress.
- **AI Coach (xAI / Grok)** — describe a day, week, month (30 days), or any custom range up to 90 days (say it in the request — “plan the next 10 days” — and it offers to match the range); get draft tasks, timed events, habits, and gentle wellbeing ideas spread across the whole stretch. Upload a PNG/JPG (up to 3 MB) of a written plan for image reading. Review the draft before adding it; one undo reverses the whole batch, and the draft stays on the **Plans** page either way. **AI memory** lets you save the life context you choose — preferences, people, routines, boundaries, and other helpful facts — so future plans and reviews can fit you better. Memory is local-first, included in encrypted sync/backups, editable and forgettable at any time; it is sent to xAI only when you ask the coach to plan or review.
- **Protected weekly times** — add a repeating class, shift, or appointment (for example Tuesday 08:00–09:00). It appears on the calendar and the AI rejects overlapping events.
- **AI review** — ask for a daily, weekly, monthly, or custom reflection on completed tasks, events, and habit check-ins. Select unfinished tasks and dates to carry them forward; nothing is rescheduled without your action.
- **Themes** — light, dark, or follow your system, plus five accent colours. All in Settings.
- **Repeating tasks** — daily, weekdays, weekly, monthly, or yearly. Finishing one schedules the next copy (overdue ones skip ahead to the next future date). Quick add understands `every day`, `weekdays`, `every monday`, `monthly`…
- **Repeating events** — birthdays, classes, and weekly meetings expand onto matching days (and export with an RRULE).
- **Waiting** — mark a task as waiting on a person or reply; it stays off Overdue until you clear it.
- **Week template & review** — copy this week onto the next, and carry unfinished work to the same weekday. A review card appears on Today and Calendar → Week.
- **Milestone dates** — goal steps can have a date and show up on Upcoming.
- **Busy calendar** — Settings can export an .ics of busy times only (titles stripped).
- **Checklists** — break a task into steps; the row shows a progress bar and you can tick steps inline.
- **Reminders** — optional notifications before events and timed tasks, plus a morning summary. Falls back to in-app toasts if notifications are blocked. (Settings → Reminders; works while Planner is open or installed.)
- **Installable & offline** — a service worker caches the app shell, so Planner opens without a connection. Install it from Settings → App or your browser menu.
- **Calendar files (.ics)** — export events, protected weekly times (as repeating events), and dated tasks; import from Google, Outlook, or Apple Calendar. All-day events arrive as dated tasks. **Export busy times** shares only Busy blocks.
- **Task board** — switch Tasks between List and a Kanban Board grouped by When, Priority, or Category. Drag cards between columns to reschedule, re-prioritise, or complete.
- **Calendar editing** — in Week view, drag an event's bottom edge (or focus it and use ↑/↓) to change its length in 15-minute steps; drag tasks to other days too.
- **Plan my day** — one tap fits today's untimed, overdue, and urgent tasks into your free time around events and protected hours. One undo reverses it.
- **Pomodoro focus** — short and long breaks between rounds; every focused minute (even when you end early) is logged.
- **Rhythm insights** — focus time for the last 7 days, the hour you usually get things done, habit links ("on days you run you finish 40% more tasks"), and a copyable Markdown weekly report.
- **Markdown notes** — headings, bold/italic, lists, checkboxes, links, and `#tags` (tap a tag to filter). Pin important notes to the top. Rendered safely without raw HTML.
- **Week start, clock & date language** — Monday/Sunday/Saturday weeks, 24-hour or 12-hour times, and day/month names in English, your device language, Finnish, Swedish, German, French, Spanish, or Persian (Settings → Calendar, dates & time).
- **Larger storage** — every save is mirrored to IndexedDB; if `localStorage` fills up, Planner keeps saving there and loads the newest copy on start.
- **Keyboard-friendly board** — focus a card and press ←/→ to move it between columns.
- **Keyboard shortcuts** — `⌘K` search & add · `N` new task · `T` today · `⌘Z` undo · `?` shortcuts · `esc` close.
- **Snooze & duplicate** — overdue tasks offer Today / Tomorrow / This weekend / Next week / a picked date; duplicate any task in one tap. Tasks has an Overdue filter.
- **Bulk actions** — Select mode on the Tasks list: complete, reopen, redate, re-categorise, re-prioritise, or delete many tasks in one stroke (fully undoable).
- **Time estimates** — an optional "estimate (minutes)" on tasks feeds smarter "Plan my day" packing and the Insights **Plan vs focus** chart, which compares estimated time with logged focus minutes over 30 days.
- **Templates** — save any task (with its checklist) or note as a template from its form; stamp it into a new item from the picker at the top of the form. Manage them in Settings → Templates.
- **Unit habits & rest days** — a habit can count an amount (8 glasses, 20 km) with a +1 button on Today, and any habit supports a rest day (the moon or Shift-click) that pauses the day without breaking the streak.
- **Shared space** — a second, independently coded end-to-end encrypted sync room for whatever sits in the Shared category (groceries, household plans). Settings → Shared space: create a room, copy the code, join from other devices; deletions travel via tombstones.
- **Calendar feeds** — subscribe to any iCalendar (.ics) URL (Google's secret address, Outlook published calendars). Events mirror read-only and refresh automatically; your own categories and notes on them survive refreshes. Settings → Calendar feeds.
- **Task import (CSV)** — import a Todoist or TickTick CSV (or any CSV with a title column); done items are skipped, dates and priorities come along. Settings → Move your tasks in.
- **Voice quick add** — a microphone button on the quick add bar (Web Speech API) dictates straight into the parser; hidden where the browser doesn't support speech.
- **Weather on Today** — a quiet forecast line for a place you pick once (Open-Meteo, no key, no account); never in the way, off by default. Settings → Weather on Today.
- **[[Note links]] & backlinks** — link notes together with `[[Note title]]` (optional `[[Note title|alias]]`); clicking creates a missing note, and each note lists the notes that link to it.
- **Today journal** — a few saved lines right on the Today page; kept as the day's journal note in Notes.
- **Year in pixels** — Insights shows the whole year as a completion heatmap, GitHub-style.
- **App badge** — installed app icons show the count of open tasks due today (Badging API).
- **Persistent undo** — the last 8 states of the undo stack survive a reload (mirrored into IndexedDB).
- **Update toast** — when a new version is deployed, a quiet "Update now" bar appears instead of a silent reload.
- **PWA shortcuts** — long-press the app icon for Today, Quick add (`#/today?qa=1` drops the caret into quick add), Calendar, and Tasks.
- **Faster first paint** — Calendar, Insights, and the AI coach load their code on first visit instead of in the main bundle.
- **Daily mood check-in** — five big, warm faces on Today (drained → glowing). One tap, no judgment; the card glows to invite you each evening, and logging a glowing day fires the confetti. Tapping a finished task also drops a small rotating "well done" toast — the reward is the point. Insights shows your last 7 days of feelings with a running average.
- **Jalali dates** — optionally shows the Persian (Jalali) date alongside Gregorian dates (Settings → Calendar, dates & time).

## xAI (Grok) setup

The browser never talks to xAI directly. It calls two same-origin endpoints, and a server-side proxy adds the API key:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/xai/status` | GET | Returns `{"configured": true}` or `{"configured": false}` — never the key |
| `/api/xai/chat/completions` | POST | Forwards the request to xAI's chat-completions API |

The same handler code (`src/server/xaiProxy.ts`) serves both environments:

- **Vercel** — `api/xai/status.ts` and `api/xai/chat/completions.ts` are Vercel Functions, discovered automatically from the `api/` directory (file path = route).
- **Local** — `vite.config.ts` mounts the same handlers as middleware for `npm run dev` and `npm run preview`.

### Deploy on Vercel

1. Create an API key in the xAI Console.
2. In Vercel open **Project → Settings → Environment Variables** and add:
   - **Key:** `XAI_API_KEY`
   - **Value:** your xAI API key
   - **Environments:** Production (and Preview if you want AI on preview deployments)
3. Redeploy. Environment variable changes only apply to new deployments.
4. Visit `https://<your-app>/api/xai/status` — it should return `{"configured":true}`.

Never name the variable `VITE_XAI_API_KEY` (or anything starting with `VITE_`): Vite would bake it into the public JavaScript bundle. `vercel.json` enables Fluid compute so long AI requests get the 300-second function duration.

### Run locally

1. Copy `.env.example` to `.env.local` and set `XAI_API_KEY=your_xai_api_key`. `.env.local` is git-ignored.
2. Restart `npm run dev`; the AI page reports whether the key is configured, and **AI Coach → AI settings** repeats these instructions.

### Using the AI coach

1. Describe what you want, optionally attach a PNG/JPG plan image (up to 3 MB so the request fits within Vercel's 4.5 MB function body limit), choose the horizon, generate a draft, and review it before adding. You can also name the length in your words — “plan my next three weeks”, «دو هفته آینده» — and the coach offers that exact range (up to 90 days per draft).
2. Every draft is kept on the **Plans** page (`#/plans`) with the days it covers, the request that made it, and everything inside it. Add a draft to the planner whenever you like; it flips to “Added” and stays in your history.
3. Refine before adding: the draft card has a "Revise draft" line — ask for a change in your own words (typed or spoken) and the AI rewrites just what you asked to change, keeping the draft's range. The draft card also shows instant warnings (packed days, unusual hours, untouched days) so you can adjust before anything touches the planner.
4. Add your repeating class/work times under **Weekly fixed times**. The planner displays those as protected calendar blocks and the AI will not schedule overlapping events.
5. Talk instead of typing on the AI Coach screen. If the recognizer keeps mishearing you, set your accent under **Settings → Voice → Listening accent**.

The key is read only on the server from `XAI_API_KEY`; it is never put in the browser bundle, session storage, or planner export, and the status endpoint reports only a boolean. AI requests use xAI's OpenAI-compatible chat-completions endpoint with Grok 4.7 for text and image understanding. If you host the static build somewhere other than Vercel, provide equivalent server-side `/api/xai/*` endpoints (you can reuse `src/server/xaiProxy.ts`).

Old links keep working: `#/daily/…`, `#/weekly/…`, `#/month/…`, `#/future`, and `#/progress` all map to their new homes.

## Notes

- Data lives in this browser only. Export before switching devices or clearing site data.
- First time? The empty Today view offers a **sample day** so you can see how everything fits together.
