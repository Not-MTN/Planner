# Planner

A calm, local-first planner for your day, your week, and the days ahead — tasks, habits, goals, and notes in one beautiful place.

Everything stays in this browser (`localStorage`). No account, no server. Use **Settings → Export** for a backup file, and **Settings → Import** to bring one back.

```bash
npm install
npm run dev
```

Other scripts: `npm run typecheck`, `npm test`, `npm run build`.

## What's inside

**Seven simple places** — Today, Calendar (Week · Month · Upcoming), Tasks, Habits, Goals, Notes, Insights.

- **Today** — one quiet page for the day: timeline with a live "now" marker, tasks, habits, notes, a daily intention, and a progress ring that celebrates when the day is complete.
- **Smart quick add** — type the way you think: `Call mom tomorrow 5pm #personal !high` becomes a task with the date, time, category, and priority filled in. A time range like `Deep work 9:30-11:30` becomes an event. Live chips show what will happen before you press Enter.
- **Command palette** (`⌘K` / `Ctrl+K` or `/`) — search everything, jump anywhere, add anything, toggle dark mode, start a focus session.
- **Undo & redo** — every change is undoable (`⌘Z` / `⌘⇧Z`), and removals show a toast with an Undo button. No more confirm dialogs for small mistakes.
- **Focus timer** — pick a task (or don't), choose 15–60 minutes, and get a full-screen breathing timer with a soft chime at the end.
- **Habits** — streaks (current & best), a week strip, and a 12-week heatmap you can tap to fill in any day.
- **Calendar** — drag events between days in Week view, see the month at a glance, and scroll the days ahead in Upcoming.
- **Insights** — day streak, weekly bars with a trend line against last week, habit consistency, and goal progress.
- **Themes** — light, dark, or follow your system, plus five accent colours. All in Settings.
- **Keyboard shortcuts** — `⌘K` search & add · `N` new task · `T` today · `⌘Z` undo · `esc` close.

Old links keep working: `#/daily/…`, `#/weekly/…`, `#/month/…`, `#/future`, and `#/progress` all map to their new homes.

## Notes

- Data lives in this browser only. Export before switching devices or clearing site data.
- First time? The empty Today view offers a **sample day** so you can see how everything fits together.
