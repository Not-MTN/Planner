import { useMemo } from 'react';
import { faNum, t, tn } from '../i18n';
import { habitStreaks } from '../logic';
import { formatEstimate } from '../quickAdd';
import { todayISO } from '../dates';
import type { PlannerState } from '../types';

export function getGlanceStats(state: PlannerState, today: string) {
  const tasksDueToday = state.tasks.filter((task) => !task.completed && task.dueDate === today).length;
  const completedTasks = state.tasks.filter((task) => task.completed).length;
  const totalTasks = state.tasks.length;
  const activeHabits = state.habits.filter((habit) => !habit.archived);
  const focusMinutesToday = state.focusLog
    .filter((session) => session.date === today)
    .reduce((sum, session) => sum + session.minutes, 0);
  const longestHabitStreak = activeHabits.reduce(
    (longest, habit) => Math.max(longest, habitStreaks(state, habit, today).current),
    0,
  );

  return {
    tasksDueToday,
    completedTasks,
    totalTasks,
    activeHabits: activeHabits.length,
    focusMinutesToday,
    longestHabitStreak,
  };
}

export function StatsWidget({ state, date = todayISO() }: { state: PlannerState; date?: string }) {
  const stats = useMemo(() => getGlanceStats(state, date), [state, date]);

  return (
    <details className="stats-widget">
      <summary className="stats-widget-head">
        <span className="stats-widget-title">{t('At a glance')}</span>
        <span className="stats-widget-preview">{faNum(stats.tasksDueToday)} {t('due today')}</span>
        <span className="stats-widget-badge">{t('Live')}</span>
      </summary>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-num">{faNum(stats.tasksDueToday)}</span>
          <span className="stat-label">{t('due today')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{faNum(stats.completedTasks)}/{faNum(stats.totalTasks)}</span>
          <span className="stat-label">{t('all-time completed')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{faNum(stats.activeHabits)}</span>
          <span className="stat-label">{t('habits')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{formatEstimate(stats.focusMinutesToday)}</span>
          <span className="stat-label">{t('focus today')}</span>
        </div>
      </div>
      {stats.longestHabitStreak > 0 ? (
        <div className="stats-streak">
          <span className="streak-icon" aria-hidden="true">🔥</span>
          <span>
            {t('Longest habit streak')}: {tn(stats.longestHabitStreak, '{count} day', '{count} days')}
          </span>
        </div>
      ) : null}
    </details>
  );
}
