/**
 * The student's standing weekly class times.
 *
 * The student is the only person who can write this timetable; guardians
 * receive it read-only over the link and plan around it. A standing class is
 * permanent by design: once it exists, guardians may already be planning study
 * around it, so entries can be added but never edited or removed — the list is
 * a record of truth, not a scratch timetable.
 */
import { useState } from 'react';
import { usePlanner } from '../context';
import { WEEKDAY_TOGGLES, displayTime } from '../dates';
import { t } from '../i18n';
import { newId } from '../panels';
import { PlusIcon, ClockIcon, LockIcon } from '../icons';
import {
  classesForWeekday,
  emptyFixedClassDraft,
  fixedClassDraftError,
  type FixedClassDraft,
} from '../fixedClasses';
import type { FixedClass } from '../types';
import { Field } from './ui';
import { TimeField } from './TimeField';

export function FixedClassesEditor() {
  const { panels, updatePanels, flash } = usePlanner();
  const classes = panels.student.fixedClasses ?? [];
  const [draft, setDraft] = useState<FixedClassDraft>(() => emptyFixedClassDraft());
  const [error, setError] = useState<string | null>(null);

  const patch = (change: Partial<FixedClassDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
    setError(null);
  };

  const save = () => {
    const issue = fixedClassDraftError(draft, classes);
    if (issue) {
      setError(issue);
      return;
    }
    const now = new Date().toISOString();
    const entry: FixedClass = {
      id: newId('fixed-class'),
      title: draft.title.trim(),
      weekday: draft.weekday,
      startTime: draft.startTime,
      endTime: draft.endTime,
      createdAt: now,
      updatedAt: now,
    };
    updatePanels((current) => ({
      ...current,
      student: { ...current.student, fixedClasses: [...(current.student.fixedClasses ?? []), entry] },
    }));
    flash(t('Class time added. Your guardians will plan around it.'));
    setDraft(emptyFixedClassDraft(draft.weekday));
    setError(null);
  };

  return (
    <div className="fixed-classes">
      <section className="card fixed-classes-form" aria-label={t('Add a standing class')}>
        <header className="card-head">
          <div>
            <p className="kicker">{t('Fixed class times')}</p>
            <h2 className="card-title">{t('Add a class time')}</h2>
          </div>
        </header>
        <p className="hint">
          {t('These are your permanent weekly classes, like school lessons. Once added they cannot be changed or removed, and guardians plan study around them.')}
        </p>
        <div className="fixed-class-fields">
          <Field label={t('Class name')}>
            <input
              className="input"
              value={draft.title}
              maxLength={120}
              placeholder={t('Maths class')}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </Field>
          <Field label={t('Day')}>
            <select className="input" value={draft.weekday} onChange={(event) => patch({ weekday: Number(event.target.value) })}>
              {WEEKDAY_TOGGLES.map((day) => (
                <option key={day.day} value={day.day}>{day.label}</option>
              ))}
            </select>
          </Field>
          <Field label={t('Starts')}>
            <TimeField value={draft.startTime} label={t('Class starts')} onChange={(value) => patch({ startTime: value })} />
          </Field>
          <Field label={t('Ends')}>
            <TimeField value={draft.endTime} label={t('Class ends')} onChange={(value) => patch({ endTime: value })} />
          </Field>
        </div>
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <div className="fixed-class-actions">
          <button type="button" className="btn btn-primary btn-small" onClick={save}>
            <PlusIcon size={14} />
            {t('Add class time')}
          </button>
        </div>
      </section>

      <section className="card" aria-label={t('Your weekly class timetable')}>
        <header className="card-head">
          <div>
            <p className="kicker">{t('Timetable')}</p>
            <h2 className="card-title">{t('Your weekly classes')}</h2>
          </div>
        </header>
        {classes.length === 0 ? (
          <p className="empty-note">{t('No standing classes yet. Add your school classes so guardians never plan over them.')}</p>
        ) : (
          <div className="fixed-class-days">
            {WEEKDAY_TOGGLES.map((day) => {
              const dayClasses = classesForWeekday(classes, day.day);
              if (dayClasses.length === 0) return null;
              return (
                <div key={day.day} className="fixed-class-day">
                  <p className="fixed-class-day-name">{day.label}</p>
                  <ul className="fixed-class-list">
                    {dayClasses.map((item) => (
                      <li key={item.id} className="fixed-class-item is-locked">
                        <span className="fixed-class-time">
                          <ClockIcon size={13} />
                          <span dir="ltr">{displayTime(item.startTime)} – {displayTime(item.endTime)}</span>
                        </span>
                        <span className="fixed-class-title">{item.title}</span>
                        <span
                          className="fixed-class-lock"
                          title={t('Fixed class — cannot be changed')}
                          aria-label={t('Fixed class — cannot be changed')}
                        >
                          <LockIcon size={13} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
