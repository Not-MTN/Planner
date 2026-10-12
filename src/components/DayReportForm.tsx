/**
 * Reporting a planned day back to the guardian.
 *
 * The checkboxes start where the day's ticks left off, so reporting is
 * confirming — not retyping — the day. Filing saves locally first, so a day
 * can always be reported from a bus with no signal; the sync that carries it
 * to the guardian is a bonus, and the panel unlocks either way.
 */
import { useState } from 'react';
import { syncStudentInbox } from '../auth/links';
import { usePlanner } from '../context';
import { displayTime, formatFullDate, todayISO } from '../dates';
import { t } from '../i18n';
import { newId } from '../panels';
import { DAY_REPORT_NOTE_MAX } from '../types';
import type { DayReport, GuardianPlan, PlanItem } from '../types';
import { missingReportDays, withDayReport } from '../weekPlans';
import { Field } from './ui';

export function DayReportForm({
  plan,
  date,
  lessons,
  onDone,
  onCancel,
}: {
  plan: GuardianPlan;
  date: string;
  lessons: PlanItem[];
  onDone: () => void;
  /** Without it there is nothing to go back to — the lock screen's forms have none. */
  onCancel?: () => void;
}) {
  const { state, panels, updatePanels, flash } = usePlanner();
  const [doneIds, setDoneIds] = useState<string[]>(() =>
    lessons.filter((lesson) => lesson.done).map((lesson) => lesson.id),
  );
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const toggle = (id: string) =>
    setDoneIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  // One-tap honesty: templates append, so a tap plus a typed detail reads whole.
  const templates = [
    t('Finished everything.'),
    t('Stuck on one lesson.'),
    t('Ran out of time.'),
    t('Need help with this.'),
  ];
  const applyTemplate = (text: string) =>
    setNote((current) => (current.trim() ? `${current.trimEnd()} ${text}` : text).slice(0, DAY_REPORT_NOTE_MAX));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    const now = new Date().toISOString();
    const report: DayReport = {
      id: newId('report'),
      planId: plan.id,
      linkId: plan.linkId,
      date,
      doneIds,
      note: note.trim(),
      createdAt: now,
      updatedAt: now,
    };
    const wasMissing = missingReportDays(panels.student.inbox.plans, panels.student.reports ?? [], todayISO()).length;
    const next = withDayReport(panels, report);
    const cleared =
      wasMissing > 0 &&
      missingReportDays(next.student.inbox.plans, next.student.reports ?? [], todayISO()).length === 0;
    updatePanels(() => next);
    // The report is filed the moment it is saved; the sync only carries it.
    // When nothing else moved meanwhile, the synced copy is adopted wholesale.
    try {
      const synced = await syncStudentInbox(next, state.goals);
      updatePanels((latest) => (latest === next ? synced.panels : latest));
      flash(cleared ? t('All caught up — your student panel is open again.') : t('Daily report sent.'));
    } catch {
      flash(cleared ? t('All caught up — your student panel is open again.') : t('Saved — it will send on the next sync.'));
    } finally {
      setSending(false);
      onDone();
    }
  };

  return (
    <form
      className="day-report-form panel-inline-form"
      onSubmit={(event) => void submit(event)}
      aria-label={`${t('Report this day')} · ${formatFullDate(date)}`}
    >
      <fieldset disabled={sending}>
        <legend className="chart-title">{t('Report this day')}</legend>
        <p className="hint">{formatFullDate(date)}</p>
        <ul className="day-report-lessons">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <label>
                <input type="checkbox" checked={doneIds.includes(lesson.id)} onChange={() => toggle(lesson.id)} />
                <span>{lesson.title}</span>
              </label>
              {lesson.time ? <span className="week-time">{displayTime(lesson.time)}</span> : null}
            </li>
          ))}
        </ul>
        <div className="week-chip-row" role="group" aria-label={t('A note to go with it')}>
          {templates.map((text) => (
            <button key={text} type="button" className="btn btn-ghost btn-tiny" onClick={() => applyTemplate(text)}>
              {text}
            </button>
          ))}
        </div>
        <Field label={t('A note to go with it')}>
          <textarea
            className="input"
            rows={2}
            maxLength={280}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        <div className="panel-form-actions">
          <button type="submit" className="btn btn-primary btn-small">
            {sending ? <span className="spinner" aria-hidden="true" /> : null}
            {sending ? t('Sending…') : t('Send report')}
          </button>
          {onCancel ? (
            <button type="button" className="btn btn-ghost btn-small" onClick={onCancel}>
              {t('Cancel')}
            </button>
          ) : null}
        </div>
      </fieldset>
    </form>
  );
}
