/**
 * Planning a week lesson by lesson.
 *
 * The guardian picks the week, the field, and the grade; built-in lessons for
 * that combination are one tap away, and anything else is typed once. Lessons
 * are stored per day as offsets from the start, so moving the start moves the
 * whole week without orphaning anything — absolute dates are computed on send.
 */
import { useId, useState } from 'react';
import { sendPlan } from '../auth/links';
import { usePlanner } from '../context';
import { CURRICULUM_FIELDS, CURRICULUM_GRADES, curriculumSuggestions, isCurriculumLesson } from '../curriculum';
import { WEEKDAY_TOGGLES, addDays, formatFullDate, isValidISODate, isValidTime, todayISO } from '../dates';
import { cx } from '../cx';
import { t } from '../i18n';
import { GlobeIcon, PlusIcon, TrashIcon } from '../icons';
import { gradeLabel, newId, planEnd, withLinkPlan, withQueuedPlan } from '../panels';
import { QUEUED_PLANS_KEPT } from '../types';
import type { GuardianLink, PlanDraft } from '../types';
import {
  emptyWeekPlanDraft,
  examWarningDates,
  normalizeLessonUrl,
  WEEK_LESSON_LIMIT,
  weekPlanDraftError,
  weekPlanLessonCount,
  type WeekLessonDraft,
} from '../weekPlans';
import { Field } from './ui';

const PREFS_KEY = 'planner-weekplan-prefs';

function loadPrefs(linkId: string): { field: string; grade: string; examDate: string } {
  try {
    if (typeof localStorage === 'undefined') return { field: '', grade: '', examDate: '' };
    const saved = (
      JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<
        string,
        { field?: unknown; grade?: unknown; examDate?: unknown }
      >
    )[linkId];
    return {
      field: typeof saved?.field === 'string' ? saved.field : '',
      grade: typeof saved?.grade === 'string' ? saved.grade : '',
      examDate: typeof saved?.examDate === 'string' ? saved.examDate : '',
    };
  } catch {
    return { field: '', grade: '', examDate: '' };
  }
}

function savePrefs(linkId: string, field: string, grade: string, examDate: string) {
  try {
    if (typeof localStorage === 'undefined') return;
    const all = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...all, [linkId]: { field, grade, examDate } }));
  } catch {
    /* remembering is a favour, not a promise */
  }
}

function byTimeThenName(a: WeekLessonDraft, b: WeekLessonDraft): number {
  const timeOf = (lesson: WeekLessonDraft) => (lesson.time && isValidTime(lesson.time) ? lesson.time : '99:99');
  return timeOf(a).localeCompare(timeOf(b)) || a.name.localeCompare(b.name);
}

export function WeekPlanComposer({ link, onClose }: { link: GuardianLink; onClose: () => void }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [draft, setDraft] = useState(() => ({ ...emptyWeekPlanDraft(todayISO()), ...loadPrefs(link.id) }));
  const [name, setName] = useState('');
  const [time, setTime] = useState('');
  const [addDay, setAddDay] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkingValue, setLinkingValue] = useState('');
  const lessonListId = useId();

  const startOk = isValidISODate(draft.start);
  const end = startOk ? planEnd({ cadence: 'week', start: draft.start }) : '';
  const count = weekPlanLessonCount(draft);
  const full = count >= WEEK_LESSON_LIMIT;
  const suggestions = curriculumSuggestions(draft.field, draft.grade);
  const examWarns = examWarningDates(draft.days, draft.start, draft.examDate);
  const dayLabel = (offset: number) => (startOk ? formatFullDate(addDays(draft.start, offset)) : '—');

  const remember = (field: string, grade: string) => {
    setDraft((current) => ({ ...current, field, grade }));
    savePrefs(link.id, field, grade, draft.examDate);
  };

  const toggleRest = (day: number) => {
    setDraft((current) => ({
      ...current,
      restDays: current.restDays.includes(day)
        ? current.restDays.filter((item) => item !== day)
        : [...current.restDays, day],
    }));
  };

  const addLesson = (lessonName: string, lessonTime: string, offset: number) => {
    const clean = lessonName.trim();
    if (!clean || full) return;
    if (lessonTime && !isValidTime(lessonTime)) {
      setError(t('Choose a valid time.'));
      return;
    }
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.offset === offset
          ? { ...day, lessons: [...day.lessons, { id: newId('lesson'), name: clean, time: lessonTime, url: '' }] }
          : day,
      ),
    }));
    setError(null);
  };

  const addCustom = () => {
    if (!name.trim()) return;
    addLesson(name, time, addDay);
    if (name.trim() && (!time || isValidTime(time))) {
      setName('');
      setTime('');
    }
  };

  const startLinking = (lesson: WeekLessonDraft) => {
    setLinkingId(lesson.id);
    setLinkingValue(lesson.url);
    setError(null);
  };

  const saveLink = (offset: number, id: string) => {
    const clean = linkingValue.trim();
    if (clean && !normalizeLessonUrl(clean)) {
      setError(t('One of the links is not a valid web address.'));
      return;
    }
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.offset === offset
          ? { ...day, lessons: day.lessons.map((lesson) => (lesson.id === id ? { ...lesson, url: clean } : lesson)) }
          : day,
      ),
    }));
    setLinkingId(null);
    setLinkingValue('');
    setError(null);
  };

  const removeLesson = (offset: number, id: string) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.offset === offset ? { ...day, lessons: day.lessons.filter((lesson) => lesson.id !== id) } : day,
      ),
    }));
    setError(null);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !link.linkId) return;
    const issue = weekPlanDraftError(draft);
    if (issue) {
      setError(issue);
      return;
    }
    setSending(true);
    setError(null);
    const plan: PlanDraft = {
      cadence: 'week',
      start: draft.start,
      title: draft.title,
      note: draft.note,
      field: draft.field || null,
      grade: draft.grade || null,
      restDays: draft.restDays,
      items: draft.days.flatMap((day) =>
        day.lessons
          .filter((lesson) => lesson.name.trim())
          .map((lesson) => ({
            title: lesson.name.trim(),
            date: addDays(draft.start, day.offset),
            time: lesson.time || null,
            url: normalizeLessonUrl(lesson.url),
            minutes: null,
            subject: isCurriculumLesson(lesson.name, draft.field, draft.grade) ? lesson.name.trim() : null,
          })),
      ),
    };
    try {
      const next = await sendPlan(panels, link.linkId, plan);
      const previousIds = new Set(link.plans.map((plan) => plan.id));
      const sent = next.guardian.links
        .find((item) => item.linkId === link.linkId)
        ?.plans.find((plan) => !previousIds.has(plan.id));
      // Apply only the new plan: slow requests must not replace an edited roster.
      if (sent) updatePanels((current) => withLinkPlan(current, link.linkId!, sent));
      flash(t('The plan is on its way to {0}.', { 0: link.displayName }));
      onClose();
    } catch (caught) {
      // No signal, no loss: the week waits in the queue and sends itself later.
      if ((panels.guardian.queuedPlans ?? []).length >= QUEUED_PLANS_KEPT) {
        setError(t('The send queue is full — reconnect to send what is waiting.'));
      } else {
        updatePanels((current) =>
          withQueuedPlan(current, { id: newId('queue'), linkId: link.linkId!, draft: plan, createdAt: new Date().toISOString() }),
        );
        flash(t("Saved — it will send when you're back online."));
        onClose();
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="week-plan-composer panel-inline-form"
      onSubmit={(event) => void submit(event)}
      aria-label={t('Plan for {0}', { 0: link.displayName })}
    >
      <fieldset disabled={sending}>
        <legend className="chart-title">{t('Plan lessons')}</legend>
        <p className="hint">{t('They report each planned day back. A missing report pauses their panel until it arrives.')}</p>
        <Field label={t('What is this plan?')}>
          <input
            className="input"
            value={draft.title}
            autoFocus
            required
            maxLength={120}
            placeholder={t('Chemistry week')}
            onChange={(event) => {
              setDraft({ ...draft, title: event.target.value });
              setError(null);
            }}
          />
        </Field>
        <div className="panel-form-grid plan-period-fields">
          <Field label={t('First day it covers')}>
            <input
              className="input"
              type="date"
              value={draft.start}
              required
              onChange={(event) => {
                setDraft({ ...draft, start: event.target.value });
                setError(null);
              }}
            />
          </Field>
          <div className="plan-end-label">
            <span>{t('Through')}</span>
            <strong>{end || '—'}</strong>
          </div>
        </div>
        <Field label={t('A note to go with it')}>
          <textarea
            className="input"
            rows={2}
            maxLength={400}
            value={draft.note}
            placeholder={t("Keep the evenings light before Thursday's exam.")}
            onChange={(event) => setDraft({ ...draft, note: event.target.value })}
          />
        </Field>
        <div className="panel-form-grid">
          <Field label={t('Field of study')}>
            <select
              className="input"
              value={draft.field}
              onChange={(event) => remember(event.target.value, draft.grade)}
            >
              <option value="">{t('Optional')}</option>
              {CURRICULUM_FIELDS.map((field) => (
                <option key={field.id} value={field.id}>
                  {field.nameFa} · {field.nameEn}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('Grade')}>
            <select
              className="input"
              value={draft.grade}
              onChange={(event) => remember(draft.field, event.target.value)}
            >
              <option value="">{t('Optional')}</option>
              {CURRICULUM_GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {gradeLabel(grade) ?? grade}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="week-rest-block">
          <p className="week-rest-label">{t('Rest days')}</p>
          <div className="week-chip-row" role="group" aria-label={t('Rest days')}>
            {WEEKDAY_TOGGLES.map((day) => (
              <button
                key={day.day}
                type="button"
                className={cx('btn btn-ghost btn-tiny', draft.restDays.includes(day.day) && 'week-rest-on')}
                aria-pressed={draft.restDays.includes(day.day)}
                onClick={() => toggleRest(day.day)}
              >
                {day.label}
              </button>
            ))}
          </div>
          <p className="hint">{t('No report is asked for rest days.')}</p>
        </div>
        <Field label={t('Exam date')}>
          <input
            className="input"
            type="date"
            value={draft.examDate}
            onChange={(event) => {
              const examDate = event.target.value;
              setDraft({ ...draft, examDate });
              savePrefs(link.id, draft.field, draft.grade, examDate);
            }}
          />
        </Field>
        {examWarns.length > 0 ? (
          <p className="week-exam-warn" role="status">
            {t('Heavy load just before the exam on {0}. Consider moving lessons earlier.', {
              0: formatFullDate(draft.examDate),
            })}
          </p>
        ) : null}
        <datalist id={lessonListId}>
          {suggestions.map((lesson) => (
            <option key={lesson} value={lesson} />
          ))}
        </datalist>
        {suggestions.length > 0 ? (
          <div className="week-chip-block">
            <p className="hint">{t('Built-in lessons — tap one to add it.')}</p>
            <div className="week-chip-row" role="group" aria-label={t('Built-in lessons — tap one to add it.')}>
              {suggestions.map((lesson) => (
                <button
                  key={lesson}
                  type="button"
                  className="btn btn-ghost btn-tiny"
                  disabled={!startOk || full}
                  onClick={() => addLesson(lesson, '', addDay)}
                >
                  {lesson}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="week-add-bar">
          <input
            className="input"
            aria-label={t('Lesson name')}
            value={name}
            maxLength={120}
            list={lessonListId}
            placeholder={t('Lesson name')}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              // Enter adds the lesson; sending the week stays on its own button.
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustom();
              }
            }}
          />
          <input
            className="input week-time-input"
            type="time"
            aria-label={t('Time')}
            value={time}
            onChange={(event) => setTime(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCustom();
              }
            }}
          />
          <select
            className="input"
            aria-label={t('Date')}
            value={addDay}
            onChange={(event) => setAddDay(Number(event.target.value))}
          >
            {draft.days.map((day) => (
              <option key={day.offset} value={day.offset}>
                {dayLabel(day.offset)}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={!startOk || full || !name.trim()}
            onClick={addCustom}
          >
            <PlusIcon size={14} />
            {t('Add a lesson')}
          </button>
        </div>
        <ol className="week-draft-list">
          {draft.days.map((day) => {
            const dayCount = day.lessons.filter((lesson) => lesson.name.trim()).length;
            return (
            <li key={day.offset} className="week-draft-day">
              <div className="week-day-head">
                <span className="week-day-name">{dayLabel(day.offset)}</span>
                {dayCount > 0 ? (
                  <span className="week-day-count">
                    {t('{0} lessons', { 0: dayCount })}
                  </span>
                ) : null}
              </div>
              {day.lessons.length > 0 ? (
                <ul className="week-lessons">
                  {[...day.lessons].sort(byTimeThenName).map((lesson) => (
                    <li key={lesson.id} className="week-lesson">
                      {lesson.time ? <span className="week-time">{lesson.time}</span> : null}
                      <span className="week-lesson-title">{lesson.name}</span>
                      <button
                        type="button"
                        className={cx('icon-btn round', lesson.url && 'has-link')}
                        aria-label={
                          lesson.url
                            ? t('Change the link for {0}', { 0: lesson.name })
                            : t('Add a link to {0}', { 0: lesson.name })
                        }
                        onClick={() => (linkingId === lesson.id ? setLinkingId(null) : startLinking(lesson))}
                      >
                        <GlobeIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn round"
                        aria-label={t('Remove lesson {0}', { 0: lesson.name })}
                        onClick={() => removeLesson(day.offset, lesson.id)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  ))}
                  {(() => {
                    const linking = day.lessons.find((lesson) => lesson.id === linkingId);
                    if (!linking) return null;
                    return (
                      <li className="week-link-edit">
                        <input
                          className="input"
                          value={linkingValue}
                          placeholder={t('Link (optional)')}
                          aria-label={t('Link (optional)')}
                          inputMode="url"
                          onChange={(event) => setLinkingValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              saveLink(day.offset, linking.id);
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-tiny"
                          onClick={() => saveLink(day.offset, linking.id)}
                        >
                          {t('Save')}
                        </button>
                        {linking.url ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-tiny"
                            onClick={() => {
                              setLinkingValue('');
                              setDraft((current) => ({
                                ...current,
                                days: current.days.map((entry) =>
                                  entry.offset === day.offset
                                    ? {
                                        ...entry,
                                        lessons: entry.lessons.map((item) =>
                                          item.id === linking.id ? { ...item, url: '' } : item,
                                        ),
                                      }
                                    : entry,
                                ),
                              }));
                              setLinkingId(null);
                            }}
                          >
                            {t('Remove')}
                          </button>
                        ) : null}
                      </li>
                    );
                  })()}
                </ul>
              ) : null}
            </li>
            );
          })}
        </ol>
        <div className="plan-composer-summary">
          <span>{t('{0} lessons', { 0: count })}</span>
        </div>
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel-form-actions">
          <button type="submit" className="btn btn-primary btn-small">
            {sending ? <span className="spinner" aria-hidden="true" /> : null}
            {sending ? t('Sending…') : t('Send the plan')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
