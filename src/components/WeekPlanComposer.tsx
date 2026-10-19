/**
 * Planning a week lesson by lesson.
 *
 * The guardian picks the week, the field, and the grade; built-in lessons for
 * that combination are one tap away, and anything else is typed once. Lessons
 * are stored per day as offsets from the start, so moving the start moves the
 * whole week without orphaning anything — absolute dates are computed on send.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { sendPlan } from '../auth/links';
import { usePlanner } from '../context';
import {
  CURRICULUM_FIELDS,
  CURRICULUM_GRADES,
  curriculumGradeLabel,
  curriculumSuggestions,
  isCurriculumLesson,
} from '../curriculum';
import { WEEKDAY_TOGGLES, addDays, formatFullDate, formatJalaliLong, isValidISODate, isValidTime, todayISO } from '../dates';
import { cx } from '../cx';
import { t } from '../i18n';
import { ClockIcon, GlobeIcon, PlusIcon, TrashIcon } from '../icons';
import { newId, planEnd, withLinkPlan, withQueuedPlan } from '../panels';
import { QUEUED_PLANS_KEPT } from '../types';
import type { GuardianLink, PlanDraft } from '../types';
import {
  emptyWeekPlanDraft,
  examWarningDates,
  lessonDurationLabel,
  lessonTimeLabel,
  normalizeLessonUrl,
  readLessonTimePair,
  WEEK_LESSON_LIMIT,
  weekPlanDraftError,
  weekPlanLessonCount,
  type WeekLessonDraft,
} from '../weekPlans';
import { LessonTimePicker, TimeSlots } from './LessonTime';
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
  const [endTime, setEndTime] = useState('');
  const [addDay, setAddDay] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkingValue, setLinkingValue] = useState('');
  const lessonListId = useId();

  const startOk = isValidISODate(draft.start);
  const end = startOk ? planEnd({ cadence: 'week', start: draft.start }) : '';
  const count = weekPlanLessonCount(draft);
  /** What the add bar's pair will become: the chips and the target line read it. */
  const addPair = readLessonTimePair(time, endTime);
  const addDuration = lessonDurationLabel(addPair);
  const full = count >= WEEK_LESSON_LIMIT;
  const suggestions = curriculumSuggestions(draft.field, draft.grade);
  const examWarns = examWarningDates(draft.days, draft.start, draft.examDate);
  const dayLabel = (offset: number) => {
    if (!startOk) return '—';
    const iso = addDays(draft.start, offset);
    const greg = formatFullDate(iso);
    const jalali = formatJalaliLong(iso);
    return jalali ? `${greg} · ${jalali}` : greg;
  };

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

  const addLesson = (lessonName: string, lessonTime: string, lessonEnd: string, offset: number) => {
    const clean = lessonName.trim();
    if (!clean || full) return;
    if (lessonTime && !isValidTime(lessonTime)) {
      setError(t('Choose a valid time.'));
      return;
    }
    // The pair is read the way it was typed: "to" on its own is the start, and
    // an end before the start is dropped. Either way the lesson is added — a
    // time the composer cannot use never costs the guardian the lesson itself.
    const pair = readLessonTimePair(lessonTime, lessonEnd);
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.offset === offset
          ? {
              ...day,
              lessons: [
                ...day.lessons,
                { id: newId('lesson'), name: clean, time: pair.time, end: pair.end, url: '' },
              ],
            }
          : day,
      ),
    }));
    setError(null);
  };

  /** Give a lesson that is already in the draft a time, or take the one it has. */
  const retime = (offset: number, id: string, next: { time: string; end: string }) => {
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) =>
        day.offset === offset
          ? {
              ...day,
              lessons: day.lessons.map((lesson) =>
                lesson.id === id ? { ...lesson, time: next.time, end: next.end } : lesson,
              ),
            }
          : day,
      ),
    }));
    setError(null);
  };

  const addCustom = () => {
    if (!name.trim()) return;
    addLesson(name, time, endTime, addDay);
    if (name.trim() && (!time || isValidTime(time))) {
      // The name is spent; the time is kept, so the next lesson can be tapped
      // straight into the same slot — "physics at four, then chemistry".
      setName('');
    }
  };

  // A refusal nobody sees is the same as no refusal: the form is long enough
  // that its foot can be off screen, so the message is brought into view.
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

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
    // A lesson still sitting in the add bar is one the guardian typed and never
    // tapped "add" for. Sending the week sends it, so nothing typed is lost —
    // the other reading of this is a week that quietly drops a lesson.
    const pending = name.trim()
      ? { ...readLessonTimePair(time, endTime), id: newId('lesson'), name: name.trim(), url: '' }
      : null;
    const days = pending && !full
      ? draft.days.map((day) => (day.offset === addDay ? { ...day, lessons: [...day.lessons, pending] } : day))
      : draft.days;
    const outgoing = { ...draft, days };
    const issue = weekPlanDraftError(outgoing);
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
      items: days.flatMap((day) =>
        day.lessons
          .filter((lesson) => lesson.name.trim())
          .map((lesson) => {
            const pair = readLessonTimePair(lesson.time, lesson.end);
            return {
              title: lesson.name.trim(),
              date: addDays(draft.start, day.offset),
              time: pair.time || null,
              end: pair.end || null,
              url: normalizeLessonUrl(lesson.url),
              minutes: null,
              subject: isCurriculumLesson(lesson.name, draft.field, draft.grade) ? lesson.name.trim() : null,
            };
          }),
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
    } catch {
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
        <p className="hint">{t('They can share daily reports when ready. A missing report never blocks their panel.')}</p>
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
                  {curriculumGradeLabel(grade)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {draft.grade === 'konkur' ? (
          <p className="hint" role="note">
            {t('The exam year holds the twelfth grade in full, plus this field’s own lessons from the tenth and eleventh.')}
          </p>
        ) : null}
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
            <p className="hint">
              {t('Tap a lesson to add it. It lands on the day and at the time picked below.')}
            </p>
            <p className="week-chip-target" aria-live="polite">
              <ClockIcon size={13} />
              {t('Adds to {0}', { 0: dayLabel(addDay) })}
              {addPair.time ? (
                <strong>
                  {lessonTimeLabel(addPair)}
                  {addDuration ? ` · ${addDuration}` : ''}
                </strong>
              ) : (
                <em>{t('No time yet — it will be an any-time lesson.')}</em>
              )}
            </p>
            <div className="week-chip-row" role="group" aria-label={t('Built-in lessons — tap one to add it.')}>
              {suggestions.map((lesson) => (
                <button
                  key={lesson}
                  type="button"
                  className="btn btn-ghost btn-tiny"
                  disabled={!startOk || full}
                  onClick={() => addLesson(lesson, time, endTime, addDay)}
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
          <LessonTimePicker
            time={time}
            end={endTime}
            subject={name.trim() || undefined}
            onChange={(next) => {
              setTime(next.time);
              setEndTime(next.end);
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
        <TimeSlots
          time={time}
          end={endTime}
          label={t('Common lesson times')}
          disabled={!startOk}
          onPick={(slot) => {
            setTime(slot?.time ?? '');
            setEndTime(slot?.end ?? '');
            setError(null);
          }}
        />
        <p className="hint">{t('Pick a time first, then tap the lessons that run in it.')}</p>
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
                  {[...day.lessons].sort(byTimeThenName).map((lesson) => {
                    const pair = readLessonTimePair(lesson.time, lesson.end);
                    const span = lessonDurationLabel(pair);
                    return (
                      <li key={lesson.id} className="week-lesson week-draft-lesson">
                        <span className="week-draft-main">
                          <span className="week-lesson-title">{lesson.name}</span>
                          {/* The time of a lesson already in the draft is a pair
                              of boxes, not a label: a lesson added from a chip
                              can still be given its four to six. */}
                          <LessonTimePicker
                            time={lesson.time}
                            end={lesson.end}
                            subject={lesson.name}
                            disabled={sending}
                            quiet
                            onChange={(next) => retime(day.offset, lesson.id, next)}
                          />
                          {pair.time ? (
                            <span className="week-time">
                              <ClockIcon size={13} />
                              {lessonTimeLabel(pair)}
                              {span ? <em>{span}</em> : null}
                            </span>
                          ) : (
                            <span className="week-time is-open">{t('Any time')}</span>
                          )}
                        </span>
                        <span className="week-draft-actions">
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
                        </span>
                      </li>
                    );
                  })}
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
          <p className="field-error" role="alert" ref={errorRef}>
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
