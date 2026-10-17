/**
 * A student asking for one change to a plan.
 *
 * The plan is the guardian's, so this is an ask and not an edit: nothing about
 * the week moves until a guardian approves it. The form only offers what can
 * still be asked for — a day that has gone by is not on the list, because the
 * answer would arrive after the lesson did.
 */
import { useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { syncStudentInbox } from '../auth/links';
import { formatFullDate, isValidTime, todayISO } from '../dates';
import { cx } from '../cx';
import { t } from '../i18n';
import { ClockIcon } from '../icons';
import type { GuardianPlan, PlanChangeKind } from '../types';
import {
  buildChangeRequest,
  canRequestPlanChange,
  editablePlanDays,
  itemsForDay,
  lessonTimeLabel,
  normalizeLessonEnd,
  planDays,
  withStudentChangeRequest,
} from '../weekPlans';
import { Modal } from './ui';

export function PlanChangeForm({
  plan,
  defaultDate,
  defaultItemId,
  onClose,
  today = todayISO(),
}: {
  plan: GuardianPlan;
  /** Opens on the day the student tapped, when they tapped one. */
  defaultDate?: string | null;
  /** Opens as a removal of the lesson they tapped. */
  defaultItemId?: string | null;
  onClose: () => void;
  today?: string;
}) {
  const { state, panels, updatePanels, flash } = usePlanner();
  const startingItem = defaultItemId ? plan.items.find((item) => item.id === defaultItemId) : undefined;
  const [kind, setKind] = useState<PlanChangeKind>(startingItem ? 'remove' : 'add');
  const [date, setDate] = useState<string>(
    startingItem?.date && canRequestPlanChange(plan, startingItem.date, today)
      ? startingItem.date
      : defaultDate && canRequestPlanChange(plan, defaultDate, today)
        ? defaultDate
        : editablePlanDays(plan, today)[0] ?? today,
  );
  const [itemId, setItemId] = useState<string>(startingItem?.id ?? '');
  const [title, setTitle] = useState(startingItem?.title ?? '');
  const [time, setTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openDays = useMemo(() => editablePlanDays(plan, today), [plan, today]);
  const removable = useMemo(
    () =>
      planDays(plan)
        .flatMap((day) => itemsForDay(plan, day).map((item) => ({ item, day })))
        .filter(({ item, day }) => !item.done && canRequestPlanChange(plan, day, today)),
    [plan, today],
  );
  const chosen = removable.find((entry) => entry.item.id === itemId);
  const askable = kind === 'remove' ? removable.length > 0 : openDays.length > 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending) return;
    if (time && !isValidTime(time)) {
      setError(t('Choose a valid time.'));
      return;
    }
    if (endTime && !normalizeLessonEnd(time, endTime)) {
      setError(t('A lesson has to end after it starts.'));
      return;
    }
    const request = buildChangeRequest(
      plan,
      plan.linkId,
      kind === 'remove'
        ? {
            kind,
            title: chosen?.item.title ?? title,
            itemId: chosen?.item.id ?? null,
            date: chosen?.item.date ?? null,
            note,
          }
        : { kind, title, date: date || null, time: time || null, end: endTime || null, note },
      today,
    );
    if (!request) {
      setError(t('That change cannot be asked for any more — the day has gone by.'));
      return;
    }
    const next = withStudentChangeRequest(panels, request);
    updatePanels(() => next);
    setSending(true);
    setError(null);
    try {
      const synced = await syncStudentInbox(next, state.goals);
      updatePanels((latest) => (latest === next ? synced.panels : latest));
      flash(t('Asked — waiting for your guardian to answer.'));
      onClose();
    } catch {
      // The ask is saved either way; the next sync carries it.
      flash(t('Saved — it will send on the next sync.'));
      onClose();
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title={t('Ask for a change')} onClose={onClose} className="sheet-plan-change">
      <form className="week-change-form" onSubmit={(event) => void submit(event)}>
        <p className="hint">
          {t('Your guardian sees the ask and decides. The plan stays as it is until they approve it.')}
        </p>
        <div className="week-change-kind" role="group" aria-label={t('What would you like?')}>
          <button
            type="button"
            className={cx('btn btn-ghost btn-tiny', kind === 'add' && 'is-on')}
            aria-pressed={kind === 'add'}
            onClick={() => setKind('add')}
          >
            {t('Add a lesson')}
          </button>
          <button
            type="button"
            className={cx('btn btn-ghost btn-tiny', kind === 'remove' && 'is-on')}
            aria-pressed={kind === 'remove'}
            onClick={() => setKind('remove')}
          >
            {t('Take a lesson off')}
          </button>
        </div>

        {kind === 'remove' ? (
          removable.length > 0 ? (
            <ul className="week-change-pick" role="radiogroup" aria-label={t('Which lesson?')}>
              {removable.map(({ item, day }) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={itemId === item.id}
                    className={cx('week-change-option', itemId === item.id && 'is-on')}
                    onClick={() => {
                      setItemId(item.id);
                      setTitle(item.title);
                      setError(null);
                    }}
                  >
                    <span className="week-change-day">{formatFullDate(day)}</span>
                    <span className="week-change-title">{item.title}</span>
                    {item.time ? (
                      <span className="week-change-time">
                        <ClockIcon size={13} />
                        {lessonTimeLabel(item)}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="week-empty">{t('Every lesson left in this plan is already ticked off or behind you.')}</p>
          )
        ) : (
          <>
            <label className="field">
              <span>{t('Lesson name')}</span>
              <input
                className="input"
                value={title}
                maxLength={120}
                data-autofocus
                placeholder={t('Mathematics')}
                onChange={(event) => {
                  setTitle(event.target.value);
                  setError(null);
                }}
              />
            </label>
            <div className="panel-form-grid">
              <label className="field">
                <span>{t('Day')}</span>
                <select
                  className="input"
                  value={date}
                  onChange={(event) => {
                    setDate(event.target.value);
                    setError(null);
                  }}
                >
                  <option value="">{t('Any day')}</option>
                  {openDays.map((day) => (
                    <option key={day} value={day}>
                      {formatFullDate(day)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>{t('From')}</span>
                <input
                  className="input"
                  type="time"
                  value={time}
                  onChange={(event) => {
                    setTime(event.target.value);
                    setError(null);
                  }}
                />
              </label>
              <label className="field">
                <span>{t('To')}</span>
                <input
                  className="input"
                  type="time"
                  min={time || undefined}
                  value={endTime}
                  onChange={(event) => {
                    setEndTime(event.target.value);
                    setError(null);
                  }}
                />
              </label>
            </div>
            {time ? (
              <p className="hint">
                <ClockIcon size={13} />
                {lessonTimeLabel({ time, end: endTime })}
              </p>
            ) : null}
          </>
        )}

        <label className="field">
          <span>{t('Why? (optional)')}</span>
          <textarea
            className="input"
            rows={2}
            maxLength={140}
            value={note}
            placeholder={t('We have a test that morning.')}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        {!askable ? (
          <p className="field-error" role="alert">
            {t('There is nothing left in this plan to change.')}
          </p>
        ) : null}
        {error ? (
          <p className="field-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="panel-form-actions">
          <button
            type="submit"
            className="btn btn-primary btn-small"
            disabled={sending || !askable || (kind === 'add' ? !title.trim() : !itemId)}
          >
            {sending ? <span className="spinner" aria-hidden="true" /> : null}
            {sending ? t('Sending…') : t('Send the ask')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
