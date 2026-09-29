import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  addDays,
  dayNumber,
  dayRelation,
  formatClock,
  formatJalaliLong,
  formatMonthLong,
  formatWeekdayLong,
  motivationFor,
  timeToMinutes,
  todayISO, displayTime } from '../dates';
import { useNow } from '../hooks';
import {
  dayScore,
  essentialHabits,
  eventsForDate,
  habitsDueOn,
  isEmptyState,
  journalForDate,
  overdueTasks,
  progressPhrase,
  tasksForDate,
  upcomingFocus,
  weekLeftovers,
} from '../logic';
import { fetchWeather, weatherInfo, type WeatherNow } from '../weather';
import { QuickAddBar } from '../components/QuickAddBar';
import { WelcomeCard } from '../components/WelcomeCard';
import { PanelHub, PanelInvite } from '../components/PanelHub';
import { StatsWidget } from '../components/StatsWidget';
import { BackupReminder } from '../components/BackupReminder';
import { EventRow, FixedEventRow, HabitRow, IntentionField, NowMark, TaskRow } from '../components/items';
import { Empty, Meter, Ring } from '../components/ui';
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SparklesIcon, StopwatchIcon } from '../icons';
import type { Habit, MoodValue } from '../types';
import { autoSchedule } from '../scheduler';
import { t } from '../i18n';

export function DayView({ date }: { date: string }) {
  const planner = usePlanner();
  const { state, display, openComposer, navigate, swapEventTimes, swapTasks, moveTask, flash, celebrate, startFocus, carryWeekLeftovers, undo } = planner;
  const now = useNow(20000);
  const today = todayISO(now);
  const isToday = date === today;
  const events = eventsForDate(state, date);
  const tasks = tasksForDate(state, date);
  const openTasks = tasks.filter((task) => !task.completed);
  const doneTasks = tasks.filter((task) => task.completed);
  const habits = habitsDueOn(state, date).filter((habit) => !habit.essential);
  const essentials = essentialHabits(state, date);
  const carried = overdueTasks(state, date);
  const score = dayScore(state, date, true);
  const upcoming = isToday ? upcomingFocus(state, today) : [];
  const clock = formatClock(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const fresh = isEmptyState(state);

  const celebrateRef = useRef(false);
  useEffect(() => {
    const complete = score.total > 0 && score.done === score.total;
    if (complete && !celebrateRef.current) {
      celebrate();
      flash(t("Day complete. Beautifully done."), {
        label: t("How did it feel?"),
        run: () => document.querySelector('[data-mood-card]')?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      });
    }
    celebrateRef.current = complete;
  }, [score.total, score.done, celebrate, flash]);

  const timeline: ReactNode[] = [];
  let placedNow = false;
  for (const event of events) {
    if (isToday && !placedNow && nowMin <= timeToMinutes(event.startTime)) {
      placedNow = true;
      timeline.push(
        <li key="now" className="timeline-slot">
          <NowMark time={clock} />
        </li>,
      );
    }
    timeline.push(
      event.fixedCommitmentId ? (
        <FixedEventRow key={event.id} event={event} />
      ) : (
        <EventRow
          key={event.id}
          event={event}
          onDropSwap={(sourceId) => {
            if (sourceId !== event.id) swapEventTimes(sourceId, event.id);
          }}
        />
      ),
    );
  }
  if (isToday && !placedNow) {
    timeline.push(
      <li key="now" className="timeline-slot">
        <NowMark time={clock} />
      </li>,
    );
  }

  return (
    <div className="view">
      <header className={cx('hero', !isToday && 'hero-plain')}>
        <div className="hero-copy">
          <p className="kicker">{isToday ? t("Personal Planner") : t("Day planner")}</p>
          <h1 className="hero-title">{formatWeekdayLong(date)}</h1>
          <p className="hero-date">
            <span className="hero-date-num">{dayNumber(date)}</span> {formatMonthLong(date)}
            {isToday ? <span className="clock">{displayTime(clock)}</span> : null}
          </p>
          {display.jalali ? <p className="jalali-line">{formatJalaliLong(date)}</p> : null}
          {isToday ? <p className="quote">{motivationFor(date)}</p> : null}
          <QuickAddBar defaultDate={date} />
          {upcoming.length > 0 ? (
            <ul className="coming-up">
              {upcoming.map((item) => (
                <li key={`${item.kind}-${item.date}-${item.title}`}>
                  <span>{formatWeekdayLong(item.date).slice(0, 3)} {dayNumber(item.date)}</span>
                  {item.title}
                </li>
              ))}
            </ul>
          ) : null}
          {isToday ? (
            <div className="hero-links">
              <button type="button" className="text-btn" onClick={() => navigate({ name: 'calendar', tab: 'agenda', date: today })}>
                {dayRelation(addDays(today, 1), today)} {t("and beyond")}
              </button>
            </div>
          ) : null}
          {/* The glance strip fills the headline column beside the progress
              card, so the numbers are above the fold instead of six cards down. */}
          {isToday ? <StatsWidget state={state} /> : null}
          {!isToday ? (
            <div className="pager hero-pager">
              <button type="button" className="icon-btn round" aria-label={t("Previous day")} onClick={() => navigate({ name: 'day', date: addDays(date, -1) })}>
                <ChevronLeftIcon />
              </button>
              <button type="button" className="btn btn-ghost" disabled={date === today} onClick={() => navigate({ name: 'day', date: today })}>
                {t("Today")}
              </button>
              <button type="button" className="icon-btn round" aria-label={t("Next day")} onClick={() => navigate({ name: 'day', date: addDays(date, 1) })}>
                <ChevronRightIcon />
              </button>
            </div>
          ) : null}
        </div>

        <aside className="card hero-panel">
          {!fresh ? <img className="postcard" src="/img/hero-day.jpg" alt="" loading="lazy" /> : null}
          <p className="kicker">{t("Progress")}</p>
          <Ring value={score.ratio ?? 0} label={score.total ? `${score.done}/${score.total}` : t("Open")} caption={t("done today")} />
          <p className="progress-phrase">{progressPhrase(score.ratio)}</p>
          <p className="meta">
            {score.eventsDone}/{score.eventsTotal} {t("events ·")} {score.tasksDone}/{score.tasksTotal} {t("tasks ·")} {score.habitsDone}/{score.habitsTotal} {t('habits')}
          </p>
          <div className="qa-row">
            <button type="button" className="qa-tile accent-peach" onClick={() => openComposer({ mode: 'create', type: 'task', date })}>
              <span className="qa-icon"><PlusIcon size={15} /></span>
              {t("Task")}
            </button>
            <button type="button" className="qa-tile accent-sage" onClick={() => openComposer({ mode: 'create', type: 'event', date })}>
              <span className="qa-icon"><PlusIcon size={15} /></span>
              {t("Event")}
            </button>
            <button
              type="button"
              className="qa-tile accent-lav"
              onClick={() => startFocus({ taskId: null, title: t("Focus session"), minutes: 25 })}
            >
              <span className="qa-icon"><StopwatchIcon size={15} /></span>
              {t("Focus")}
            </button>
          </div>
          <div className="plan-row">
            <button
              type="button"
              className="btn btn-soft btn-small"
              title={t("Fit untimed, overdue, and urgent tasks into today’s free time")}
              disabled={date < today}
              onClick={() => {
                const plan = autoSchedule(state, date, { from: isToday ? nowMin + 10 : 9 * 60 });
                if (plan.length === 0) {
                  flash(t("Nothing to fit in — no untimed tasks, or no free time left."));
                  return;
                }
                planner.applySchedule(plan);
                flash(t("Planned {0} {1}: {2}{3}", { 0: plan.length, 1: plan.length === 1 ? t("task") : t("tasks"), 2: plan.slice(0, 3).map((item) => t("{0} {1}", { 0: item.time, 1: item.title })).join(', '), 3: plan.length > 3 ? '…' : '' }), { label: t("Undo"), run: planner.undo });
              }}
            >
              <StopwatchIcon size={15} /> {t("Plan my day")}
            </button>
            <button type="button" className="btn btn-soft btn-small" onClick={() => navigate({ name: 'ai', tab: 'plan' })}>
              <SparklesIcon size={15} /> {t("Plan with AI")}
            </button>
          </div>
        </aside>
      </header>

      {/* The day's working area comes first: intention, then the schedule and
          its checklists. Promos and check-ins follow, never ahead of the plan. */}
      {isToday ? <IntentionField key={date} date={date} /> : null}

      <div className="today-grid">
        <section className="card timeline-card">
          <header className="card-head">
            <div>
              <p className="kicker">{t("Schedule")}</p>
              <h2 className="card-title">{t("Timeline")}</h2>
            </div>
            <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'event', date })}>
              {t("Add event")}
            </button>
          </header>
          {events.length === 0 ? (
            <div className="timeline timeline-empty">
              {isToday ? <NowMark time={clock} /> : null}
              <Empty
                image="/img/spot-calendar.jpg"
                title={t("Nothing timed yet.")}
                text={t("Add a time only for what you want to protect.")}
                action={
                  <button type="button" className="btn btn-soft" onClick={() => openComposer({ mode: 'create', type: 'event', date })}>
                    {t("Add event")}
                  </button>
                }
              />
            </div>
          ) : (
            <ol className="timeline">{timeline}</ol>
          )}
        </section>

        <div className="stack">
          {isToday && weekLeftovers(state, today).length > 0 ? (
            <section className="card">
              <header className="card-head">
                <div>
                  <p className="kicker">{t("Review this week")}</p>
                  <h2 className="card-title">{t("{0} still open", { 0: weekLeftovers(state, today).length })}</h2>
                </div>
                <button
                  type="button"
                  className="btn btn-tiny"
                  onClick={() => {
                    carryWeekLeftovers();
                    flash(t("Moved unfinished work to next week."), { label: t("Undo"), run: undo });
                  }}
                >
                  {t("Carry to next week")}
                </button>
              </header>
              <p className="meta">{t("Shift leftovers to the same weekday next week.")}</p>
            </section>
          ) : null}
          <section className="card">
            <header className="card-head">
              <div>
                <p className="kicker">{t("Checklist")}</p>
                <h2 className="card-title">{t("Tasks")}</h2>
              </div>
              <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'tasks' })}>
                {t("All tasks")}
              </button>
            </header>
            {carried.length > 0 ? (
              <div className="carried">
                <p>{t("Carried over")}</p>
                <ul className="item-list">
                  {carried.slice(0, 4).map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      showDate
                      onReschedule={() => moveTask(task.id, addDays(date, 1))}
                      rescheduleLabel={t("Move to tomorrow")}
                      onDropSwap={(sourceId) => sourceId !== task.id && swapTasks(sourceId, task.id)}
                    />
                  ))}
                </ul>
                {carried.length > 4 ? (
                  <button type="button" className="text-btn" onClick={() => navigate({ name: 'tasks' })}>
                    {carried.length - 4} {t('more')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {openTasks.length === 0 && doneTasks.length === 0 ? (
              <Empty
                image="/img/spot-tasks.jpg"
                title={t("No tasks for this day.")}
                text={t("A short list is easier to finish.")}
                action={
                  <button type="button" className="btn btn-soft" onClick={() => openComposer({ mode: 'create', type: 'task', date })}>
                    {t("Add task")}
                  </button>
                }
              />
            ) : (
              <ul className="item-list">
                {[...openTasks, ...doneTasks].map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onDropSwap={(sourceId) => {
                      if (sourceId !== task.id) swapTasks(sourceId, task.id);
                    }}
                  />
                ))}
              </ul>
            )}
          </section>

          <section className="card wash-lav">
            <header className="card-head">
              <div>
                <p className="kicker">{t("Repeat")}</p>
                <h2 className="card-title">{t("Habits")}</h2>
              </div>
              <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'habits' })}>
                {t("Tracker")}
              </button>
            </header>
            {habits.length === 0 ? (
              <Empty
                image="/img/spot-library.jpg"
                title={t("No habits for this day.")}
                text={t("Start with one thing you want to repeat.")}
                action={
                  <button type="button" className="btn btn-soft" onClick={() => openComposer({ mode: 'create', type: 'habit' })}>
                    {t("Add habit")}
                  </button>
                }
              />
            ) : (
              <ul className="item-list">
                {habits.map((habit) => (
                  <HabitRow key={habit.id} habit={habit} date={date} />
                ))}
              </ul>
            )}
          </section>

          <JournalCard key={`journal-${date}`} date={date} />

          <DayNotes date={date} />
        </div>
      </div>

      {isToday ? <AICoachCard onOpen={() => navigate({ name: 'ai', tab: 'plan' })} /> : null}
      {fresh && isToday ? <WelcomeCard /> : null}
      {isToday ? <BackupReminder onExport={planner.exportData} /> : null}
      {isToday ? <PanelHub /> : null}
      {isToday ? <PanelInvite /> : null}
      {isToday ? <WeatherCard /> : null}
      {isToday ? <MoodCard date={today} /> : null}
      {essentials.length > 0 ? <EssentialsCard date={date} habits={essentials} /> : null}
    </div>
  );
}

/**
 * The AI coach is the planner's most powerful feature — give it a home on
 * Today so nobody has to hunt through Settings to discover it.
 */
function AICoachCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="card ai-coach-card" onClick={onOpen}>
      <span className="ai-coach-orb" aria-hidden="true"><SparklesIcon size={22} /></span>
      <span className="ai-coach-copy">
        <span className="ai-coach-kicker">{t("AI coach")}</span>
        <strong className="ai-coach-title">{t("Let the AI coach plan with you")}</strong>
        <span className="ai-coach-body">{t("Speak or type — English or فارسی, however casual. It drafts the day around your real schedule; you approve everything.")}</span>
      </span>
      <span className="btn btn-primary btn-small ai-coach-btn" aria-hidden="true">
        <SparklesIcon size={15} /> {t("Open")}
      </span>
    </button>
  );
}

/** One quiet line (or more) a day: the dated journal note, edited inline. */
function JournalCard({ date }: { date: string }) {
  const { state, addNote, updateNote, openComposer } = usePlanner();
  const note = journalForDate(state.notes, date);
  const [body, setBody] = useState(note?.body ?? '');
  const [saved, setSaved] = useState(false);
  const timer = useRef<number | null>(null);

  const save = (value: string) => {
    if (!value.trim() && !note) return;
    if (note) {
      if (value !== note.body) updateNote(note.id, { body: value });
    } else {
      addNote({ title: formatWeekdayLong(date), body: value, kind: 'journal', date });
    }
    setSaved(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaved(false), 1600);
  };

  return (
    <section className="card journal-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Journal")}</p>
          <h2 className="card-title">{t("A few lines for this day")}</h2>
        </div>
        <div className="journal-side">
          {saved ? <span className="journal-saved" role="status">{t("Saved")}</span> : null}
          {note ? (
            <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'edit', type: 'note', id: note.id })}>
              {t("Open")}
            </button>
          ) : null}
        </div>
      </header>
      <textarea
        className={cx('journal-entry', 'journal-inline')}
        dir="auto"
        value={body}
        rows={4}
        maxLength={20000}
        placeholder={t("What do you want to remember about this day?")}
        aria-label={t("Journal entry for this day")}
        onChange={(event) => setBody(event.target.value)}
        onBlur={() => save(body)}
      />
    </section>
  );
}

const MOODS: Array<{ value: MoodValue; emoji: string; label: string; line: string }> = [
  { value: 1, emoji: '😩', label: t("Drained"), line: t("Rough days count too. Be gentle with yourself tonight.") },
  { value: 2, emoji: '😕', label: t("Down"), line: t("Feeling down still counts as showing up. Noted with care.") },
  { value: 3, emoji: '🙂', label: t("Steady"), line: t("Steady is a quiet win. Nicely held.") },
  { value: 4, emoji: '😄', label: t("Bright"), line: t("Bright! Notice what made it work — do more of that.") },
  { value: 5, emoji: '🤩', label: t("Glowing"), line: t("Glowing! Bottle this feeling. You earned it.") },
];

/**
 * The daily mood check-in — one honest tap about how the day felt. Big, warm,
 * and a little playful on purpose: this is where the reward for showing up
 * lives. Logging a top mood fires the confetti.
 */
function MoodCard({ date }: { date: string }) {
  const { state, logMood, celebrate } = usePlanner();
  const mood = state.moods.find((entry) => entry.date === date);
  const invited = !mood && new Date().getHours() >= 16;
  const meta = mood ? MOODS.find((item) => item.value === mood.value) : null;

  const pick = (value: MoodValue) => {
    if (mood?.value === value) {
      logMood(date, null);
      return;
    }
    logMood(date, value);
    if (value === 5) celebrate();
  };

  return (
    <section className={cx('card', 'mood-card', invited && 'invited', mood && `mood-${mood.value} has-mood`)} data-mood-card>
      <header className="card-head">
        <div>
          <p className="kicker">{t("Daily check-in")}</p>
          <h2 className="card-title">{mood ? t("Today felt {0}", { 0: meta?.label.toLowerCase() ?? '' }) : t("How did today feel?")}</h2>
        </div>
        {mood ? <span className="mood-current" aria-hidden="true">{meta?.emoji}</span> : null}
      </header>
      <div className="mood-row" role="group" aria-label={t("How today felt, 1 to 5")}>
        {MOODS.map((item) => (
          <button
            key={item.value}
            type="button"
            className={cx('mood-btn', mood?.value === item.value && 'on')}
            aria-label={t("Log today as {0}", { 0: item.label })}
            aria-pressed={mood?.value === item.value}
            title={mood?.value === item.value ? t("Tap again to clear") : item.label}
            onClick={() => pick(item.value)}
          >
            <span className="mood-emoji" aria-hidden="true">{item.emoji}</span>
            <span className="mood-label">{item.label}</span>
          </button>
        ))}
      </div>
      {meta ? (
        <p className="mood-line" role="status">{meta.line}</p>
      ) : (
        <p className="mood-line dim">{t("One tap, no judgment — tomorrow you can see the pattern.")}</p>
      )}
    </section>
  );
}

/** Weather for today, only when enabled in Settings (Open-Meteo, no key). */
function WeatherCard() {
  const { weather } = usePlanner();
  const [data, setData] = useState<WeatherNow | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!weather.enabled || weather.lat === null || weather.lon === null) return;
    let cancelled = false;
    void fetchWeather(weather.lat, weather.lon)
      .then((now) => {
        if (!cancelled) setData(now);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [weather.enabled, weather.lat, weather.lon]);

  if (!weather.enabled || weather.lat === null || weather.lon === null) return null;
  if (failed) return null;
  if (!data) {
    return (
      <section className="card weather-card is-loading" aria-hidden="true">
        <span className="weather-icon">☁️</span>
      </section>
    );
  }
  const info = weatherInfo(data.code);
  return (
    <section className="card weather-card" aria-label={t("Weather for today")}>
      <span className="weather-icon" aria-hidden="true">{info.icon}</span>
      <div className="weather-body">
        <strong>{data.temp}°</strong>
        <span className="weather-label">{info.label}</span>
      </div>
      <p className="meta weather-meta">
        {t("Feels like {0}°", { 0: data.feels })} · {t("High {0}° · Low {1}°", { 0: data.hi, 1: data.lo })}
        {weather.place ? ` · ${weather.place}` : ''}
      </p>
    </section>
  );
}

function DayNotes({ date }: { date: string }) {
  const { state, openComposer } = usePlanner();
  const notes = state.notes.filter((note) => note.date === date);
  return (
    <section className="card">
      <header className="card-head">
        <h2 className="kicker">{t("Notes for this day")}</h2>
        <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'note', date })}>
          {t("Add note")}
        </button>
      </header>
      {notes.length === 0 ? (
        <p className="empty-inline">{t("Nothing tied to this day yet.")}</p>
      ) : (
        <ul className="mini-notes">
          {notes.map((note) => (
            <li key={note.id}>
              <button type="button" onClick={() => openComposer({ mode: 'edit', type: 'note', id: note.id })}>
                <strong>{note.title}</strong>
                <span>{note.body || t("Empty note")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function EssentialsCard({ date, habits }: { date: string; habits: Habit[] }) {
  const { state } = usePlanner();
  const done = habits.filter((habit) =>
    state.completions.some((item) => item.habitId === habit.id && item.date === date),
  ).length;
  const complete = habits.length > 0 && done === habits.length;
  return (
    <section className="card essentials-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Must-dos for every day")}</p>
          <h2 className="card-title">{t("Daily essentials")}</h2>
        </div>
        {complete ? (
          <span className="chip essentials-done">{t("All done ✓")}</span>
        ) : (
          <div className="essentials-progress">
            <span className="essentials-count">{done}/{habits.length}</span>
            <Meter value={habits.length === 0 ? 0 : done / habits.length} label={t("Daily essentials progress")} />
          </div>
        )}
      </header>
      <ul className="item-list essentials-list">
        {habits.map((habit) => (
          <HabitRow key={habit.id} habit={habit} date={date} />
        ))}
      </ul>
    </section>
  );
}
