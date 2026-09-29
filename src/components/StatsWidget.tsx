import { useMemo } from 'react';
import { t } from '../i18n';
import type { PlannerState } from '../types';
import { todayISO } from '../dates';

export function StatsWidget({ state }: { state: PlannerState }) {
  const stats = useMemo(() => {
    const today = todayISO();
    const tasksToday = state.tasks.filter((t) => !t.completed && t.dueDate === today).length;
    const tasksDone = state.tasks.filter((t) => t.completed).length;
    const total = state.tasks.length;
    const habitsActive = state.habits.filter((h) => !(h as any).archived).length;
    const streakSum = state.habits.length; // simple proxy
    const focusToday = (state.focusLog ?? []).filter((s) => s.date === today).reduce((sum: number, s: any) => sum + s.minutes, 0);
    return { tasksToday, tasksDone, total, habitsActive, streakSum, focusToday };
  }, [state]);

  return (
    <div className="stats-widget">
      <div className="stats-widget-head">
        <h3 className="stats-widget-title">{t('At a glance')}</h3>
        <span className="stats-widget-badge">{t('Live')}</span>
      </div>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-num">{stats.tasksToday}</span>
          <span className="stat-label">{t('due today')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.tasksDone}/{stats.total}</span>
          <span className="stat-label">{t('completed')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.habitsActive}</span>
          <span className="stat-label">{t('habits')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-num">{stats.focusToday}m</span>
          <span className="stat-label">{t('focus today')}</span>
        </div>
      </div>
      {stats.streakSum > 0 && (
        <div className="stats-streak">
          <span className="streak-icon">🔥</span>
          <span>{t('{{n}} day streak across all habits', { n: String(stats.streakSum) })}</span>
        </div>
      )}
    </div>
  );
}
