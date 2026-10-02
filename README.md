# Planner

A calm, local-first planner for your day, your week, and the days ahead — tasks, habits, goals, and notes in one beautiful place.

Planner data is saved in this browser (`localStorage`, mirrored to IndexedDB). Optional **end-to-end encrypted sync** keeps devices in step through your own Neon database — there are no accounts, and the server only stores ciphertext. If you choose to use AI, the current prompt, any AI memory you explicitly saved, and the minimum schedule/check-in details needed for that request pass through the server-side proxy to Groq. Planner notes are not sent. Use **Settings → Export** for a backup file, and **Settings → Import** to bring one back.

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

### Accounts use the same database

Sign-in (and guardian linking later) needs the **same `DATABASE_URL`** — there is nothing else to provision, because the API creates its tables on first use just like `planner_sync`. The schema is in `db/auth.sql` if you prefer to run it yourself.

Visit `https://<your-app>/api/auth/status` — it returns `{"configured": true, "storage": "database"}` when the server can see `DATABASE_URL`. Without one, development and preview answer `{"configured": false, "storage": "temporary"}`: accounts work in memory but a restart forgets them (production has no fallback — it reports `"none"` and every account endpoint answers 503).

**The database itself is never pushed to GitHub.** Only schema files (`db/*.sql`) live in the repository. Neon holds the data, and the connection string travels to Vercel as an environment variable: Vercel → Project → Settings → Environment Variables → `DATABASE_URL`, then redeploy. If you used Vercel's Neon integration, it added that variable for you. Locally it goes in `.env.local`, which is git-ignored. Paste the connection string plain — surrounding quotes, angle brackets and stray whitespace are cleaned up automatically, but anything else glued onto it breaks the parse.

### Sign-in fails: what the app now tells you

The sign-in screen checks `/api/auth/status` **before you type** and names the cause instead of retrying a form that cannot work. Three answers are possible, each with a fix on the hosting side:

| What you see | What answered | Fix |
| --- | --- | --- |
| “This deployment is behind a hosting sign-in page…” | Vercel Authentication / password protection (the request was redirected, or an HTML login page came back) | Vercel → Project → **Settings → Deployment Protection** → turn **Vercel Authentication** off (or set it to *Standard Protection* and use the production domain). `/api/*` must never be protected: the app cannot sign in to the hosting provider on the user's behalf. |
| “The accounts API did not answer at this address…” | A 404, an empty body, or the app's own HTML shell where JSON was expected | The deployment has no `api/` functions, or the domain/alias points at a deleted or older deployment. Redeploy, then re-point the domain (Vercel → Project → Domains). A `404 DEPLOYMENT_NOT_FOUND` page means the alias is dead. |
| “Accounts are not set up on this server yet.” | `{"configured":false, "storage":"none"}` from `/api/auth/status` | `DATABASE_URL` is missing for that production environment: add it and redeploy (environment variables apply only to new deployments). |
| “Accounts on this server are kept in memory only…” | `{"configured":false, "storage":"temporary"}` — development or preview with no database | Not a bug: sign-up works, but restarting the dev server signs everyone out. Set `DATABASE_URL` (locally in `.env.local`) to keep accounts. |
| “The accounts database could not be reached. Try again shortly.” (or `internal_error` after a 500) | The API answered JSON, but the database call failed — check the Vercel function logs for a `[planner] …` line naming the cause | Vercel → Project → **Logs**, filter the failed invocation. A `DATABASE_URL is not a valid database connection string` line means the variable's value has stray quotes or extra text around the connection string — re-paste it plain and redeploy. |

The last line under any error is the technical detail — for example `POST /api/auth/salt → 401 text/html — “Log in to Vercel”` — and is meant to be pasted into a bug report.

Two checks from a terminal settle it in seconds:

```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' https://<your-app>/api/auth/status
curl -s https://<your-app>/api/auth/status          # expect {"configured":true}
```

If the first line says `text/html`, protection is on; if the second prints a 404 page, the domain is not pointing at a live deployment. `/login` and `/signup` are static pages, so they can look healthy while every API call is being intercepted — that is exactly the case these messages exist for.

**Installed as an app?** The service worker keeps the shell offline, so a stale install can open the login page from cache and fail every API call with the same symptom. Uninstalling the PWA (or “Update” in Settings, or clearing site data) clears the cached shell.


## Student and guardian panels

Panels are optional additions to the personal planner. Open **Today → See the panels** (or **All panels** in the sidebar) to add a student panel, a guardian panel, or both. Each can be removed without deleting the personal planner.

### Student workspace

- **Study queue:** create subject-linked tasks, filter Today / This week / All open and by subject, complete work, or launch the focus timer. Overdue work stays visible; completed and waiting tasks stay out of the queue.
- **Upcoming exams:** upcoming dates sorted nearest first, with one-click revision-task drafts. Past exams stay in the subject tracker.
- **Editable subjects:** set exam dates and weekly study targets, see remaining focus time, and rename subjects without losing task completion or focus attribution. Matching task and event categories are renamed together, in one undoable change. Removing a tracker keeps its tasks and history.
- **Sharing preview:** see the exact weekly snapshot a guardian receives before sharing it. Totals cover the personal planner's whole week, not only tracked study tasks.

### Guardian workspace

- **Student circle:** linked/current/waiting counts, searchable names and usernames, result freshness filters, and name/latest-update sorting. Pending invitations and linked students awaiting their first share are separate states.
- **Compact roster:** expand one student to see weekly charts, focused-subject totals, AI-guided questions, shared notes, and sent-plan progress. A snapshot is current when its own seven-day period includes today, even when the student and guardian use different week starts.
- **Plan composer:** send an editable day/week/month suggestion, optionally starting with exam preparation or balanced study. Each step can have a subject, effort estimate, and date within the plan's period. Current-period starters begin today rather than assigning work to elapsed days. Steps and total effort are previewed before sending; a linked student can receive plans before their first results arrive.
- **Supportive messages:** turn an AI question into an editable note for the student and their guardian circle. Messages and plans use the existing encrypted links, not email.

**Privacy boundary:** weekly results contain planned/completed counts, focused minutes, up to four subject totals, and the student's latest chosen headline. Task details, private notes, exam dates, targets, and detailed reasons are not sent automatically. The sharing preview and UI copy follow that same boundary. Guardian suggestions never silently create or change personal tasks or calendar entries; students see them in their panel and tick off steps themselves.

Both workspaces support mobile layouts, light/dark themes, keyboard controls, and Persian/RTL. Existing backups need no new schema or migration. Automated coverage includes helper and UI tests (`src/panelFeatures*.test.*`), slow-sync regression tests, and desktop/mobile browser checks (`e2e/panels.spec.ts`).

## Languages (English / فارسی)

Settings → **Language** switches the whole interface to Persian with a right-to-left layout (Vazirmatn font, mirrored arrows, logical CSS). Choosing فارسی also sets Persian day/month names and a Saturday week start; the page reloads to apply. The AI coach replies in Persian while it is selected.

- Strings are wrapped in `t('English text')` (`src/i18n.ts`); English is the key and the fallback.
- Persian lives in `src/locales/fa.ts`. `src/i18n.test.ts` fails if any `t(...)` string lacks a translation or a placeholder like `{0}` goes missing.
- Dates stay on the Gregorian calendar with Latin digits so times and ISO dates line up everywhere.

## What's inside

**Nine simple places** — Today, Calendar (Week · Month · Upcoming), AI Coach, Plans, Tasks, Habits, Goals, Notes, Insights.

- **A calm first-run tour** — the very first visit opens a language choice (English / فارسی), then a short showcase walks the actual pages — one stop each for Today, AI coach, Plans, Tasks, Habits, Goals, Notes, Insights, Calendar, ⌘K search, and Settings — teaching the single most useful thing on every tab instead of every button. The app is paused while it teaches, so nothing can be mispressed; Escape skips it, and it never appears again on its own. Replay from the **?** button, the More sheet, or Settings → New here. The **Why Planner?** sheet (same places) answers what makes this app worth choosing.
- **Voice everywhere it counts** — dictate into the AI coach prompt (tap the mic and just describe your day, in English or فارسی) and into quick add. Uses the browser's built-in speech service, so nothing is recorded anywhere else.
- **Accents welcome** — pick the English accent that sounds most like you (Settings → Voice: US, UK, India, Australia, Nigeria, South Africa, or Persian). The recognizer listens in that accent, keeps the engine's most confident reading of what you said, and the AI is tuned to hear misheard words, homophones, and mixed English–Persian speech without ever asking you to repeat yourself.
- **Talk to your planner** — on the AI Coach screen, tap the big mic orb and just *say* it: “I'm wiped, make tonight easy” or «فردا روز سنگینیه.» Say how long to plan — “plan my next two weeks”, «ده روز آینده» — and it plans exactly that stretch. The AI understands tired, casual, accented, mixed English–Persian speech, answers out loud (when the browser has a voice for it), and builds the plan from the conversation for your review — no typing, no formal phrasing needed, one tap to mute.
- **The AI is front and center** — you don't dig through Settings to find it: Today has a highlighted AI coach card, phones get a glowing AI orb in the top bar, the nav shows a one-time attention dot until you've visited, and ⌘K has a "Go to AI coach" command.
- **Persian, however you say it** — the coach is built to hear real spoken فارسی: fast Tehrani colloquial («میخوام»، «خسته‌م»، «یه هفته سبک»), slang and half-finished sentences, Afghan/Dari phrasing, Persian typed in Latin letters (*farda miam*, *do hafte kar daram*), Arabic-letter keyboard typos (ي/ی, ك/ک), Persian digits, and Persian–English mixed mid-sentence. It replies in the language you spoke — warm conversational Persian, not textbook prose — and the spoken voice follows the reply's language, not the app's. It never asks you to repeat yourself.
- **A Plans page for every draft** — every plan the AI builds (typed or spoken, for however many days you asked) is saved automatically to **Plans**. Come back any time, open a draft, and add it to the planner when it feels right; adding marks it done and stays one undoable batch.
- **Revise drafts in place** — don't start over when a draft is close. Type a change ("make Tuesday lighter", "move the workout to evening") or just *say* it to the voice orb, and the AI edits the plan you're looking at — keeping everything you didn't ask to change — and updates the saved copy on the Plans page in the same step.
- **Plans that see your real week** — drafts are built around what's already true: protected weekly times, existing events, how full each day already is, overdue tasks, and recent mood check-ins. Locally, an instant check flags days that would land packed once added, items at unusual hours, and long ranges with whole days left empty — before you press Add.
- **Any file, any note** — attach anything to a note (music, photos, PDFs…). Files up to 20 MB live in local IndexedDB storage, play inline (audio player, image previews), download back out, and travel with backups. No uploads, no accounts — your bytes never leave the device unless you sync them yourself.
- **Today** — one quiet page for the day: timeline with a live "now" marker, tasks, habits, notes, a daily intention, and a progress ring that celebrates when the day is complete.
- **Daily essentials** — built-in must-do-every-day jobs (drink water, move 30 minutes, get outside, sleep by 11, tidy, vitamins) pinned to the top of Today with their own progress. First run offers them as a one-tap starter pack.
- **Habit library** — a shelf of classic habits and routines (body, mind, home, connection) you can add in one tap, with "Add all" per group.
- **Hand-painted illustrations** — warm gouache artwork on the Today panel, empty states, insights, and the habit library, drawn in the app's own palette.
- **Smart quick add** — type the way you think: `Call mom tomorrow 5pm #personal !high` becomes a task with the date, time, category, and priority filled in. A time range like `Deep work 9:30-11:30` becomes an event. Live chips show what will happen before you press Enter.
- **Rename in place** — click any task or event title (Today, Tasks list and board, Calendar week chips and day lists, study queues) and fix the wording right there: Enter saves, Esc cancels, clicking away saves. Only the title is written, so the date, time, priority, checklist and note stay as they were, and the rename is one undo away. The pencil on the row — or beside the box on a card or chip — still opens the full editor for everything else. Protected weekly time and an upcoming repeat's projection stay read-only and open the real item instead.
- **Command palette** (`⌘K` / `Ctrl+K` or `/`) — search everything, jump anywhere, add anything, toggle dark mode, start a focus session.
- **Undo & redo** — every change is undoable (`⌘Z` / `⌘⇧Z`), and removals show a toast with an Undo button. No more confirm dialogs for small mistakes.
- **Focus timer** — pick a task (or don't), choose 15–60 minutes, and get a full-screen breathing timer with a soft chime at the end.
- **Habits** — streaks (current & best), a week strip, and a 12-week heatmap you can tap to fill in any day.
- **Calendar** — drag events between days in Week view, see the month at a glance, and scroll the days ahead in Upcoming (7 / 14 / 30 / 90 days). A load strip shows quiet vs full days; undated tasks sit in **Someday** and can park on the quietest day.
- **Insights** — day streak, weekly bars, a 7/30/90-day completion trend, a task/event/habit completion donut, habit consistency, and goal progress.
- **AI Coach (Groq Cloud)** — describe a day, week, month (30 days), or any custom range up to 90 days (say it in the request — “plan the next 10 days” — and it offers to match the range); get draft tasks, timed events, habits, and gentle wellbeing ideas spread across the whole stretch. Upload a PNG/JPG (up to 3 MB) of a written plan for image reading. Review the draft before adding it; one undo reverses the whole batch, and the draft stays on the **Plans** page either way. **AI memory** lets you save the life context you choose — preferences, people, routines, boundaries, and other helpful facts — so future plans and reviews can fit you better. Memory is local-first, included in encrypted sync/backups, editable and forgettable at any time; it is sent to Groq only when you ask the coach to plan or review.
- **Protected weekly times** — add a repeating class, shift, or appointment (for example Tuesday 08:00–09:00). It appears on the calendar and the AI rejects overlapping events.
- **AI review** — ask for a daily, weekly, monthly, or custom reflection on completed tasks, events, and habit check-ins. Select unfinished tasks and dates to carry them forward; nothing is rescheduled without your action.
- **Themes & navigation** — light, dark, or follow your system, plus five accent colours. Settings → Navigation lets you hide sections from the desktop sidebar without removing them from search or the mobile More menu.
- **Repeating tasks** — daily, weekdays, weekly, monthly, or yearly. Finishing one schedules the next copy (overdue ones skip ahead to the next future date). Quick add understands `every day`, `weekdays`, `every monday`, `monthly`…
- **Repeating events** — birthdays, classes, and weekly meetings expand onto matching days (and export with an RRULE).
- **Waiting** — mark a task as waiting on a person or reply; it stays off Overdue until you clear it.
- **Week template & review** — copy this week onto the next, and carry unfinished work to the same weekday. A review card appears on Today and Calendar → Week.
- **Milestone dates** — goal steps can have a date and show up on Upcoming.
- **Busy calendar** — Settings can export an .ics of busy times only (titles stripped).
- **Checklists** — break a task into steps; the row shows a progress bar and you can tick steps inline.
- **Reminders & notification center** — optional notifications before events and timed tasks, plus a morning summary. Use the bell in the desktop sidebar or mobile top bar to reopen up to 50 recent reminders, mark them read, or clear them. Falls back to in-app toasts if notifications are blocked. (Settings → Reminders; scheduled checks run while Planner is open.)
- **Installable & offline** — a service worker caches the app shell, so Planner opens without a connection. Install it from Settings → App or your browser menu.
- **Calendar files (.ics)** — export events, protected weekly times (as repeating events), and dated tasks; import from Google, Outlook, or Apple Calendar. All-day events arrive as dated tasks. **Export busy times** shares only Busy blocks.
- **Task board** — switch Tasks between List and a Kanban Board grouped by When, Priority, or Category. Drag cards between columns to reschedule, re-prioritise, or complete. The list also has a dedicated **Inbox** for undated tasks and locally saved filter/search views.
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

## Background push reminders

Push delivery can work while Planner is closed, but it needs server configuration; the ordinary in-app reminder bell continues to work without it.

1. Generate a VAPID pair with `npx web-push generate-vapid-keys`.
2. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example `mailto:admin@example.com`), and a long random `CRON_SECRET` in `.env.local` and your deployment environment. Never expose the private key or cron secret in a `VITE_` variable.
3. The same `DATABASE_URL` stores browser push subscriptions and reminder times. Planner only uploads scheduled times and opaque reminder IDs; notification text is generic and task/event titles stay on the device.
4. Configure a trusted scheduler to call `GET https://<your-app>/api/push/dispatch` once per minute with `Authorization: Bearer <CRON_SECRET>`. Do not publish that secret in a URL. The endpoint rejects calls without it.
5. In Planner, enable **Settings → Background notifications**. Browser permission and an installed/registered service worker are required. Turning it off removes the server subscription and queued reminders.

Push uses the standard Web Push protocol. Some hosting plans do not permit minute-level scheduled functions, so use an external scheduler if needed; without scheduled calls the browser cannot be woken at reminder time.

## AI setup

The browser never talks to an AI provider directly. It calls two same-origin endpoints, and a server-side proxy adds the API key:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/ai/status` | GET | Returns `{"configured": true, "providers": [...]}` — names and capabilities only, never a key |
| `/api/ai/chat/completions` | POST | Forwards the request to an OpenAI-compatible chat-completions API |

`/api/groq/status` and `/api/groq/chat/completions` remain as aliases, so a PWA installed from an older deploy keeps working after you update.

### More than one provider

One provider is one single point of failure: when Groq is throttling, out of credit, or down, every AI feature in Planner stops at once. So the proxy takes a **list** of providers and falls through to the next when one is unreachable (network error or timeout), rate-limiting, out of credit, or rejecting its key.

Adding a fallback is additive — set a second key and redeploy:

| Provider | Variables | Vision |
| --- | --- | --- |
| Groq (default) | `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_VISION_MODEL` | yes |
| Cerebras | `CEREBRAS_API_KEY`, `CEREBRAS_MODEL` | no |
| OpenAI | `OPENAI_API_KEY`, `OPENAI_MODEL` | yes |
| Mistral | `MISTRAL_API_KEY`, `MISTRAL_MODEL` | yes |
| Together AI | `TOGETHER_API_KEY`, `TOGETHER_MODEL` | yes |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | yes |
| Ollama (local) | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | yes |
| Any OpenAI-compatible endpoint | `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_VISION_MODEL` | if it has one |

- **Order:** `AI_PROVIDERS=openai,groq` puts those first; every other configured provider follows in the table's order.
- **Images** go only to a provider with a vision model. Set a provider's `*_VISION_MODEL` to an empty string to turn images off for it.
- **Which one answered** comes back in the `X-AI-Provider` header, and every attempt in `X-AI-Attempts`.
- **Error messages name the provider they came from** and the variable to change, so "OpenAI rejected the API key. Re-copy it into `OPENAI_API_KEY`…" never sends you to the wrong console.
- **The browser also retries** — up to four attempts with backoff — because a rate limit is measured per minute and waiting is the only fix left once every provider has been tried. A bad request, a rejected key or an exhausted allowance is never retried.

Every provider above speaks the OpenAI chat-completions API; `OLLAMA_BASE_URL` and `AI_BASE_URL` accept any base URL that does too.

The same handler code (`src/server/groqProxy.ts`) serves both environments:

- **Vercel** — `api/[...path].ts` is a single catch-all Vercel Function that routes every `/api/*` request (`src/server/apiRouter.ts` is the route table). One function instead of eighteen keeps the Deployment inside Vercel's Hobby-plan limit of 12 Serverless Functions; the route URLs are unchanged.
- **Local** — `vite.config.ts` mounts the same router as middleware for `npm run dev` and `npm run preview`.

### Deploy on Vercel

1. Create an account at [console.groq.com](https://console.groq.com) (email or Google/GitHub — **no credit card needed**) and create a key under **API Keys**.
2. In Vercel open **Project → Settings → Environment Variables** and add:
   - **Key:** `GROQ_API_KEY`
   - **Value:** your Groq API key
   - **Environments:** Production (and Preview if you want AI on preview deployments)
3. Redeploy. Environment variable changes only apply to new deployments.
4. Visit `https://<your-app>/api/groq/status` — it should return `{"configured":true}`.

Never name the variable `VITE_GROQ_API_KEY` (or anything starting with `VITE_`): Vite would bake it into the public JavaScript bundle. `vercel.json` enables Fluid compute so long AI requests get the 300-second function duration.

### Run locally

1. Copy `.env.example` to `.env.local` and set `GROQ_API_KEY=your_groq_api_key`. `.env.local` is git-ignored.
2. Restart `npm run dev`; the AI page reports whether the key is configured, and **AI Coach → AI settings** repeats these instructions.

### Using the AI coach

1. Describe what you want, optionally attach a PNG/JPG plan image (up to 3 MB so the request fits within Vercel's 4.5 MB function body limit), choose the horizon, generate a draft, and review it before adding. You can also name the length in your words — “plan my next three weeks”, «دو هفته آینده» — and the coach offers that exact range (up to 90 days per draft).
2. Every draft is kept on the **Plans** page (`#/plans`) with the days it covers, the request that made it, and everything inside it. Add a draft to the planner whenever you like; it flips to “Added” and stays in your history.
3. Refine before adding: the draft card has a "Revise draft" line — ask for a change in your own words (typed or spoken) and the AI rewrites just what you asked to change, keeping the draft's range. The draft card also shows instant warnings (packed days, unusual hours, untouched days) so you can adjust before anything touches the planner.
4. Add your repeating class/work times under **Weekly fixed times**. The planner displays those as protected calendar blocks and the AI will not schedule overlapping events.
5. Talk instead of typing on the AI Coach screen. If the recognizer keeps mishearing you, set your accent under **Settings → Voice → Listening accent**.

The key is read only on the server from `GROQ_API_KEY`; it is never put in the browser bundle, session storage, or planner export, and the status endpoint reports only a boolean. AI requests use Groq's OpenAI-compatible endpoint (`https://api.groq.com/openai/v1/chat/completions`). Two models are configured, because Groq's text models reject image input outright:

| Use | Default model | Override |
| --- | --- | --- |
| Planning, reviews, voice, refine | `openai/gpt-oss-120b` | `GROQ_MODEL` |
| Reading a photo of a written plan | `qwen/qwen3.8-27b` | `GROQ_VISION_MODEL` |

Both must be listed in the current [model catalogue](https://console.groq.com/docs/models) — Groq retires models regularly, and a retired id comes back as a 404 the proxy reports as *"Groq does not recognise that model name"*. If you host the static build somewhere other than Vercel, provide equivalent server-side `/api/groq/*` endpoints (you can reuse `src/server/groqProxy.ts`).

**Changing a model needs no client change.** The browser always names the role it needs — the
text id or the vision id above — and the proxy resolves that onto whatever `GROQ_MODEL` /
`GROQ_VISION_MODEL` this deployment picked. Setting `GROQ_MODEL=openai/gpt-oss-20b` and redeploying
is enough; the bundle does not have to be rebuilt to match. Set `GROQ_VISION_MODEL` to an empty
string to turn image input off, and image requests are then refused with that stated plainly
rather than failing inside Groq.

Two more things the proxy settles on the way out, both because Groq's reasoning models behave
differently from a plain chat model:

- **Reasoning effort is pinned per model** (`low` for GPT-OSS, `none` for Qwen, so it reads a photo
  in instruct mode). Reasoning tokens come out of `max_completion_tokens` too, so leaving the
  effort at the model's default lets the thinking quietly eat the budget meant for the answer and
  the reply arrives as truncated JSON. Models that do not take the knob get no invented parameter.
- **The OpenAI-only `detail` hint is stripped from image parts.** Groq does not document it and
  charges a flat 2048 input tokens per image regardless, so forwarding it would buy nothing and
  risk a 400 from a provider that validates strictly.

### If the AI says the key was rejected

That message used to appear for every 401, including ones that had nothing to do with the key. The app now shows Groq's own error, and the proxy cleans up the three paste mistakes that cause a real 401: surrounding quotes, a `Bearer ` prefix, and invisible characters copied from a document.

If it still fails with the key message:

1. Re-copy the key from [console.groq.com](https://console.groq.com) and paste it into `GROQ_API_KEY` — do not include quotes or `Bearer `.
2. Check the model: set `GROQ_MODEL` (and `GROQ_VISION_MODEL` for image requests) to a model listed in your console (the defaults are `openai/gpt-oss-120b` and `qwen/qwen3.8-27b`).
3. If the error is *"The server returned an unexpected response (401) instead of JSON"*, something in front of the app answered — usually Vercel Authentication or deployment password protection. Turn it off, or exclude `/api/*` from it.
4. Environment variable changes only apply to **new** deployments, so redeploy after editing.

### If the AI says you are out of free allowance

```
Please add a payment method to continue using the API.
```

Groq returns this as a **429**, which reads like "slow down and retry" — but waiting will not
help, and neither will re-pasting a key that is fine. Groq's free tier is genuinely free and
needs no card, so this only appears once you have used up the per-day allowance on the model.

To fix it, do one of:

1. **Wait for the daily reset.** The free allowance refills every day; nothing to change.
2. **Add a payment method** at [console.groq.com/settings/billing](https://console.groq.com/settings/billing).
   Pay-as-you-go then applies, and GPT-OSS 120B costs $0.15 per million input tokens and $0.60
   per million output tokens.
3. **Switch model.** Set `GROQ_MODEL` to a model with a higher or separate limit — the caps are
   per model, not per account.

The proxy maps this to a distinct `billing` error code so the app explains the allowance instead
of telling you to re-paste a valid key or wait for a rate limit that is not the problem.

### If the AI is rate-limited

```
Rate limit reached for model openai/gpt-oss-120b. Limit 30, Used 30. Try again in 1s.
```

Groq caps requests **per minute and per day, per model** — the free tier is roughly 30 RPM with a
daily cap that varies by model. A 30-day plan draft is one request, so normal use stays well
inside it; the proxy also throttles to 20 requests a minute per visitor before your key is used
at all. If you hit it, wait a few seconds, or point `GROQ_MODEL` at a less contended model. Check
your exact caps under **Console → Limits**.

### If image reading fails but text works

Text and image requests go to **different models** on Groq. `openai/gpt-oss-120b` is text-only and
answers an image request with `messages[1].content must be a string`, so image requests are routed
to `qwen/qwen3.8-27b`, which is currently Groq's only multimodal chat model. If Groq retires or
renames it, set `GROQ_VISION_MODEL` to whatever the [vision guide](https://console.groq.com/docs/vision)
lists, or set it to an empty string to turn image input off.

Old links keep working: `#/daily/…`, `#/weekly/…`, `#/month/…`, `#/future`, and `#/progress` all map to their new homes.

## Crash reports

When something in the app breaks, Planner can tell us about it. Without this, a crash in somebody's browser is invisible: the vault is zero-knowledge, so there is no server-side data to inspect and no way to know a screen failed to render.

A report carries only what is needed to reproduce a crash:

- the error message and its stack (with paths shortened to the file that threw),
- the screen you were on (`/app#/calendar`) and which bundle (`app` or `site`),
- the last 30 things the app did — navigation, AI calls, sync — as breadcrumbs,
- a random per-page id, quoted on the crash screen so it can be pasted into a bug report.

Every string is passed through a redactor before it leaves the device: e-mail addresses, tokens, long opaque blobs, ids and URL query strings are replaced with placeholders. **No task, event, note, title or sync code is ever included** — the report could not contain planner content even by accident, because the server cannot decrypt the vault. The endpoint re-redacts on the way in rather than trusting the client.

Turn it off any time under **Settings → Crash reports**; the choice is remembered on that device. Anyone whose browser sends `Do-Not-Track` is opted out by default.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/report` | POST | Accepts one crash report, logs it, answers `204` with no body |

Logs are the sink that always exists: each report is one structured `[planner:report]` line, which Vercel (or any host) captures and forwards to log drains. To also get them somewhere you read, set `ERROR_REPORT_WEBHOOK` to a URL that accepts a JSON POST — on Vercel under **Project → Settings → Environment Variables**, locally in `.env.local`. A webhook that is down never fails report intake.

## Notes

- Data lives in this browser only. Export before switching devices or clearing site data.
- First time? The empty Today view offers a **sample day** so you can see how everything fits together.
