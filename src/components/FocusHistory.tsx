import { useMemo } from 'react';
import { t } from '../i18n';
import type { PlannerState } from '../types';
import { todayISO } from '../dates';

export function FocusHistory({ state }: { state: PlannerState }) {
  const history = useMemo(() => {
    const sessions = state.focusLog ?? [];
    // Last 7 days
    const days: { date: string; minutes: number }[] = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000);
      const iso = todayISO(d);
      const mins = sessions.filter((s) => s.date === iso).reduce((sum, s) => sum + s.minutes, 0);
      days.push({ date: iso, minutes: mins });
    }
    return days;
  }, [state]);

  const max = Math.max(1, ...history.map((d) => d.minutes));

  return (
    <div className="focus-history">
      <h3 className="focus-history-title">{t('Focus this week')}</h3>
      <div className="focus-bars">
        {history.map((day) => (
          <div key={day.date} className="focus-bar-wrap">
            <div className="focus-bar" style={{ height: `${(day.minutes / max) * 100}%` }} title={`${day.date}: ${day.minutes}m`} />
            <span className="focus-bar-label">{day.date.slice(5)}</span>
          </div>
        ))}
      </div>
      <p className="meta focus-total">{t('{{m}} minutes total', { m: String(history.reduce((s, d) => s + d.minutes, 0)) })}</p>
    </div>
  );
}
