import { useState } from 'react';
import { todayISO } from '../dates';
import { downloadBlob } from '../download';
import { printDocument } from '../printDocument';
import { faNum, t } from '../i18n';
import { formatEstimate } from '../quickAdd';
import { PrinterIcon } from '../icons';
import { buildWeeklyReport, weeklyReportHtml } from '../weeklyReport';
import type { PlannerState } from '../types';

/**
 * Looking back over the week.
 *
 * The three numbers are the week's, not the planner's whole history — a review
 * that answers "how was your week?" with a running total is answering a
 * different question. What is written in the box is not stored anywhere, so the
 * way to keep it is to print it: the reflection goes onto the same page as the
 * figures it was written against.
 */
export function WeeklyReview({ state, onClose }: { state: PlannerState; onClose?: () => void }) {
  const [reflection, setReflection] = useState('');
  const today = todayISO();
  const report = buildWeeklyReport(state, today);
  const checkIns = report.habits.reduce((sum, habit) => sum + habit.count, 0);

  const print = () => {
    const html = weeklyReportHtml(report, {
      madeOn: today,
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || 'en',
      note: reflection,
    });
    if (printDocument(html)) return;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `week-${today}.html`);
  };

  return (
    <div className="weekly-review">
      <div className="weekly-review-head">
        <h2>{t('Weekly Review')}</h2>
        <p className="meta">{t('Take a moment to reflect on your week.')}</p>
      </div>

      <div className="weekly-stats">
        <div className="weekly-stat">
          <span className="weekly-stat-num">
            {faNum(report.done)}/{faNum(report.planned)}
          </span>
          <span className="weekly-stat-label">{t('planned items done')}</span>
        </div>
        <div className="weekly-stat">
          <span className="weekly-stat-num">{faNum(checkIns)}</span>
          <span className="weekly-stat-label">{t('habit check-ins')}</span>
        </div>
        <div className="weekly-stat">
          <span className="weekly-stat-num">{formatEstimate(report.focusMinutes)}</span>
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
          onChange={(event) => setReflection(event.target.value)}
          rows={4}
        />
      </div>

      <div className="weekly-actions">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('Done')}
        </button>
        <button type="button" className="btn btn-outline" onClick={print}>
          <PrinterIcon size={15} /> {t('Print this week')}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          {t('Skip for now')}
        </button>
      </div>
    </div>
  );
}
