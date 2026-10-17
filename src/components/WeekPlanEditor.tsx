/**
 * Changing a plan that is already running.
 *
 * A week is not carved in stone the moment it is sent: a lesson overruns, an
 * exam moves, a Thursday turns out to be impossible. This is the guardian's way
 * back into the middle of it — every day from today onwards can be rewritten,
 * lesson by lesson, times included.
 *
 * The days behind today are read-only on purpose. They hold the ticks the
 * student gave and the report that answered them, so rewriting one would quietly
 * undo a filing that has already been made. They stay visible, with a lock, so
 * the week still reads as a whole week rather than as whatever is left of it.
 */
import { useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { updatePlanDays } from '../auth/links';
import { formatFullDate, formatJalaliShort, formatWeekdayShort, isValidTime, todayISO } from '../dates';
import { cx } from '../cx';
import { faNum, t, tn } from '../i18n';
import { ClockIcon, LockIcon, PlusIcon, TrashIcon } from '../icons';
import { withLinkPlan } from '../panels';
import type { GuardianLink, GuardianPlan } from '../types';
import {
  canEditPlanDay,
  itemsForDay,
  lessonDurationLabel,
  lessonTimeLabel,
  normalizeLessonEnd,
  planDays,
  WEEK_LESSON_LIMIT,
  type PlanLessonInput,
} from '../weekPlans';
import { Modal } from './ui';

function toInput(item: { id: string; title: string; time?: string | null; end?: string | null; minutes: number | null; subject: string | null; url?: string | null; done: boolean }): PlanLessonInput {
  return {
    id: item.id,
    title: item.title,
    time: item.time ?? null,
    end: item.end ?? null,
    minutes: item.minutes,
    subject: item.subject,
    url: item.url ?? null,
    done: item.done,
  };
}

/** Are these two lesson lists the same lessons, at the same times? */
function sameDay(a: PlanLessonInput[], b: PlanLessonInput[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((item, index) => {
    const other = b[index];
    return (
      !!other &&
      item.id === other.id &&
      item.title.trim() === other.title.trim() &&
      (item.time ?? null) === (other.time ?? null) &&
      (item.end ?? null) === (other.end ?? null)
    );
  });
}

export function WeekPlanEditor({
  link,
  plan,
  onClose,
  today = todayISO(),
}: {
  link: GuardianLink;
  plan: GuardianPlan;
  onClose: () => void;
  today?: string;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const days = useMemo(() => planDays(plan), [plan]);
  const open = useMemo(() => days.filter((date) => canEditPlanDay(plan, date, today)), [days, plan, today]);
  const [drafts, setDrafts] = useState<Record<string, PlanLessonInput[]>>(() =>
    Object.fromEntries(open.map((date) => [date, itemsForDay(plan, date).map(toInput)])),
  );
  const [day, setDay] = useState<string>(open.find((date) => date >= today) ?? open[0] ?? '');
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lessons = drafts[day] ?? [];
  const closed = !!plan.approvedAt || open.length === 0;
  const total = days.reduce((sum, date) => sum + (drafts[date] ?? itemsForDay(plan, date)).length, 0);
  const changedDays = open.filter((date) => !sameDay(drafts[date] ?? [], itemsForDay(plan, date).map(toInput)));

  const patch = (next: PlanLessonInput[]) => {
    setDrafts((current) => ({ ...current, [day]: next }));
    setError(null);
  };

  const addLesson = () => {
    const clean = name.trim();
    if (!clean) return;
    if (time && !isValidTime(time)) {
      setError(t('Choose a valid time.'));
      return;
    }
    if (endTime && !normalizeLessonEnd(time, endTime)) {
      setError(t('A lesson has to end after it starts.'));
      return;
    }
    if (total + 1 > WEEK_LESSON_LIMIT) {
      setError(t('A week plan can hold up to 60 lessons.'));
      return;
    }
    patch([
      ...lessons,
      { title: clean, time: time || null, end: normalizeLessonEnd(time, endTime), minutes: null, subject: null, url: null },
    ]);
    setName('');
    setTime('');
    setEndTime('');
  };

  const save = async () => {
    if (saving || changedDays.length === 0 || !link.linkId) return;
    setSaving(true);
    setError(null);
    try {
      const next = await updatePlanDays(
        panels,
        link.linkId,
        plan.id,
        changedDays.map((date) => ({ date, lessons: drafts[date] ?? [] })),
        today,
      );
      const updated = next.guardian.links.find((item) => item.linkId === link.linkId)?.plans.find((item) => item.id === plan.id);
      // Apply only what this edit touched: a slow request must not replace a
      // roster another tab has been changing in the meantime.
      if (updated) {
        updatePanels((current) => {
          const withPlan = withLinkPlan(current, link.linkId!, updated);
          const added = next.guardian.notices.filter(
            (notice) => !current.guardian.notices.some((item) => item.id === notice.id),
          );
          return added.length === 0
            ? withPlan
            : {
                ...withPlan,
                guardian: {
                  ...withPlan.guardian,
                  notices: [...added, ...withPlan.guardian.notices].slice(0, 20),
                },
              };
        });
      }
      flash(t('The plan is updated. {0} will see the change on their next sync.', { 0: link.displayName }));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('That change could not be saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('Change the plan')} onClose={onClose} className="sheet-plan-editor">
      <div className="week-editor">
        <p className="hint">
          {closed
            ? t('This period is closed. Nothing in it can change any more.')
            : t('Today and the days after it can still change. Days that have gone by keep the ticks and reports already filed.')}
        </p>
        <div className="week-editor-days" role="group" aria-label={t('Days of the plan')}>
          {days.map((date) => {
            const editable = canEditPlanDay(plan, date, today);
            const count = (drafts[date] ?? itemsForDay(plan, date)).length;
            const jalali = formatJalaliShort(date);
            return (
              <button
                key={date}
                type="button"
                className={cx('week-editor-day', date === day && 'is-on', !editable && 'is-locked')}
                disabled={!editable}
                aria-pressed={date === day}
                onClick={() => setDay(date)}
                title={editable ? formatFullDate(date) : t('This day has gone by.')}
              >
                <span className="week-editor-weekday">{formatWeekdayShort(date)}</span>
                <span className="week-editor-date">
                  {faNum(Number(date.slice(8, 10)))}
                  {jalali ? <em dir="rtl">{jalali}</em> : null}
                </span>
                {editable ? (
                  <span className="week-editor-count">{t('{0} lessons', { 0: count })}</span>
                ) : (
                  <span className="week-editor-lock">
                    <LockIcon size={13} />
                    {t('Locked')}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {day ? (
          <section className="week-editor-panel" aria-label={formatFullDate(day)}>
            <p className="chart-title">{formatFullDate(day)}</p>
            {lessons.length > 0 ? (
              <ul className="week-editor-lessons">
                {lessons.map((lesson, index) => {
                  // The span in words beside the two fields: "9 – 11 · 2 h" is
                  // what the guardian is actually promising for the day.
                  const span = lessonDurationLabel({ time: lesson.time ?? null, end: lesson.end });
                  return (
                    <li key={lesson.id ?? `${day}-${index}`} className="week-editor-lesson">
                      <input
                        className="input"
                        value={lesson.title}
                        maxLength={120}
                        aria-label={t('Lesson name')}
                        disabled={saving}
                        onChange={(event) =>
                          patch(lessons.map((item, at) => (at === index ? { ...item, title: event.target.value } : item)))
                        }
                      />
                      <span className="week-time-pair">
                        <input
                          className="input week-time-input"
                          type="time"
                          aria-label={t('From')}
                          value={lesson.time ?? ''}
                          disabled={saving}
                          onChange={(event) =>
                            patch(
                              lessons.map((item, at) =>
                                at === index ? { ...item, time: event.target.value || null } : item,
                              ),
                            )
                          }
                        />
                        <span aria-hidden="true">–</span>
                        <input
                          className="input week-time-input"
                          type="time"
                          aria-label={t('To')}
                          min={lesson.time ?? undefined}
                          value={lesson.end ?? ''}
                          disabled={saving}
                          onChange={(event) =>
                            patch(lessons.map((item, at) => (at === index ? { ...item, end: event.target.value || null } : item)))
                          }
                        />
                      </span>
                      {lesson.time ? (
                        <span className="week-editor-span">
                          <ClockIcon size={13} />
                          {lessonTimeLabel({ time: lesson.time, end: lesson.end })}
                          {span ? <em>{span}</em> : null}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="icon-btn round"
                        aria-label={t('Remove lesson {0}', { 0: lesson.title })}
                        disabled={saving}
                        onClick={() => patch(lessons.filter((_item, at) => at !== index))}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="week-empty">{t('No lessons planned.')}</p>
            )}
            <div className="week-editor-add">
              <input
                className="input"
                value={name}
                maxLength={120}
                placeholder={t('Lesson name')}
                aria-label={t('Lesson name')}
                disabled={saving}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addLesson();
                  }
                }}
              />
              <span className="week-time-pair">
                <input
                  className="input week-time-input"
                  type="time"
                  aria-label={t('From')}
                  value={time}
                  disabled={saving}
                  onChange={(event) => setTime(event.target.value)}
                />
                <span aria-hidden="true">–</span>
                <input
                  className="input week-time-input"
                  type="time"
                  aria-label={t('To')}
                  min={time || undefined}
                  value={endTime}
                  disabled={saving}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                disabled={saving || !name.trim()}
                onClick={addLesson}
              >
                <PlusIcon size={14} />
                {t('Add a lesson')}
              </button>
            </div>
          </section>
        ) : null}

        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel-form-actions">
          <button
            type="button"
            className="btn btn-primary btn-small"
            disabled={saving || closed || changedDays.length === 0}
            onClick={() => void save()}
          >
            {saving ? <span className="spinner" aria-hidden="true" /> : null}
            {saving
              ? t('Saving…')
              : changedDays.length > 0
                ? tn(changedDays.length, 'Save {count} changed day', 'Save {count} changed days')
                : t('Save changes')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
