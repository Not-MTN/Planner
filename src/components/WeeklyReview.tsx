import { useMemo, useState } from 'react';
import { t } from '../i18n';
import type { PlannerState } from '../types';

export function WeeklyReview({ state, onClose }: { state: PlannerState; onClose?: () => void }) {
  const [reflection, setReflection] = useState('');
  const summary = useMemo(() => {
    const tasksDone = state.tasks.filter((t) => t.completed).length;
    const tasksTotal = state.tasks.length;
    const habitsDone = state.completions?.length ?? 0;
    const focusTotal = state.focusLog.reduce((s, sess) => s + sess.minutes, 0);
    return { tasksDone, tasksTotal, habitsDone, focusTotal };
  }, [state]);

  return (
    <div className="weekly-review">
      <div className="weekly-review-head">
        <h2>{t('Weekly Review')}</h2>
        <p className="meta">{t('Take a moment to reflect on your week.')}</p>
      </div>

      <div className="weekly-stats">
        <div className="weekly-stat">
          <span className="weekly-stat-num">{summary.tasksDone}/{summary.tasksTotal}</span>
          <span className="weekly-stat-label">{t('tasks completed')}</span>
        </div>
        <div className="weekly-stat">
          <span className="weekly-stat-num">{summary.habitsDone}</span>
          <span className="weekly-stat-label">{t('habit check-ins')}</span>
        </div>
        <div className="weekly-stat">
          <span className="weekly-stat-num">{summary.focusTotal}m</span>
          <span className="weekly-stat-label">{t('focused')}</span>
        </div>
      </div>

      <div className="weekly-questions">
        <h3>{t('Reflection')}</h3>
        <ul className="review-prompts">
          <li>{t('What went well this week?')}</li>
          <li>{t('What could be improved?')}</li>
          <li>{t('What are your top 3 priorities for next week?')}</li>
        </ul>
        <textarea
          className="field field-textarea review-textarea"
          placeholder={t('Write your reflection…')}
          value={reflection}
          onChange={(e) => setReflection(e.target.value)}
          rows={4}
        />
      </div>

      <div className="weekly-actions">
        <button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>
        <button className="btn btn-ghost" onClick={onClose}>{t('Skip for now')}</button>
      </div>
    </div>
  );
}
