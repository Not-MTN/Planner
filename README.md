# Planner

A calm, local-first planner for your day, your week, and the days ahead — tasks, habits, goals, and notes in one beautiful place.

Planner data stays in this browser (`localStorage`); there is no planner account or database. If you choose to use AI, the current prompt and the minimum schedule/check-in details needed for that request pass through the server-side proxy to xAI. Use **Settings → Export** for a backup file, and **Settings → Import** to bring one back.

```bash
npm install
npm run dev
```

Other scripts: `npm run typecheck`, `npm test`, `npm run build`.

## What's inside

**Eight simple places** — Today, Calendar (Week · Month · Upcoming), AI Coach, Tasks, Habits, Goals, Notes, Insights.

- **Today** — one quiet page for the day: timeline with a live "now" marker, tasks, habits, notes, a daily intention, and a progress ring that celebrates when the day is complete.
- **Daily essentials** — built-in must-do-every-day jobs (drink water, move 30 minutes, get outside, sleep by 11, tidy, vitamins) pinned to the top of Today with their own progress. First run offers them as a one-tap starter pack.
- **Habit library** — a shelf of classic habits and routines (body, mind, home, connection) you can add in one tap, with "Add all" per group.
- **Hand-painted illustrations** — warm gouache artwork on the Today panel, empty states, insights, and the habit library, drawn in the app's own palette.
- **Smart quick add** — type the way you think: `Call mom tomorrow 5pm #personal !high` becomes a task with the date, time, category, and priority filled in. A time range like `Deep work 9:30-11:30` becomes an event. Live chips show what will happen before you press Enter.
- **Command palette** (`⌘K` / `Ctrl+K` or `/`) — search everything, jump anywhere, add anything, toggle dark mode, start a focus session.
- **Undo & redo** — every change is undoable (`⌘Z` / `⌘⇧Z`), and removals show a toast with an Undo button. No more confirm dialogs for small mistakes.
- **Focus timer** — pick a task (or don't), choose 15–60 minutes, and get a full-screen breathing timer with a soft chime at the end.
- **Habits** — streaks (current & best), a week strip, and a 12-week heatmap you can tap to fill in any day.
- **Calendar** — drag events between days in Week view, see the month at a glance, and scroll the days ahead in Upcoming.
- **Insights** — day streak, weekly bars, a 7/30/90-day completion trend, a task/event/habit completion donut, habit consistency, and goal progress.
- **AI Coach (xAI / Grok)** — describe a day, week, month (30 days), or custom plan; get draft tasks, timed events, habits, and gentle wellbeing ideas. Upload a PNG/JPG of a written plan for image reading. Review the draft before adding it; one undo reverses the whole batch.
- **Protected weekly times** — add a repeating class, shift, or appointment (for example Tuesday 08:00–09:00). It appears on the calendar and the AI rejects overlapping events.
- **AI review** — ask for a daily, weekly, monthly, or custom reflection on completed tasks, events, and habit check-ins. Select unfinished tasks and dates to carry them forward; nothing is rescheduled without your action.
- **Themes** — light, dark, or follow your system, plus five accent colours. All in Settings.
- **Keyboard shortcuts** — `⌘K` search & add · `N` new task · `T` today · `⌘Z` undo · `esc` close.

## xAI (Grok) setup

1. Create an API key in the xAI Console.
2. Copy `.env.example` to `.env.local` and set `XAI_API_KEY=your_xai_api_key`.
3. Restart `npm run dev`; **AI Coach → AI settings** shows the server-side setup instructions and the AI page reports whether the key is configured.
4. Describe what you want, optionally attach a PNG/JPG plan image, choose the horizon, generate a draft, and review it before adding.
5. Add your repeating class/work times under **Weekly fixed times**. The planner displays those as protected calendar blocks and the AI will not schedule overlapping events.

The xAI API key is read by the Vite server from `XAI_API_KEY` and is never put in the browser bundle, session storage, or planner export. AI requests use xAI's OpenAI-compatible chat-completions endpoint with Grok 4.7 for text and image understanding. If you deploy the built static app elsewhere, configure an equivalent server-side `/api/xai` proxy and keep `XAI_API_KEY` in the server environment; do not expose it as a `VITE_` variable.

Old links keep working: `#/daily/…`, `#/weekly/…`, `#/month/…`, `#/future`, and `#/progress` all map to their new homes.

## Notes

- Data lives in this browser only. Export before switching devices or clearing site data.
- First time? The empty Today view offers a **sample day** so you can see how everything fits together.
