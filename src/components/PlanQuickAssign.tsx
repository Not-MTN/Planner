/**
 * Give homework or set a test without leaving the planning section.
 *
 * The assignment itself travels the normal way — it lands in the student's
 * homework or exams section exactly as if it had been written there — and the
 * caller mirrors it into the plan being built, so one action puts it in both
 * places the student looks. The composers own the plan step; this component
 * only creates the assignment and hands back what it made.
 */
import { useState, type FormEvent } from 'react';
import { usePlanner } from '../context';
import { sendExam, sendHomeworkAssignment } from '../auth/links';
import { emptyExamQuestion, examDraftError, type ExamQuestionDraft } from '../exams';
import { newId } from '../panels';
import { t } from '../i18n';
import { PlusIcon, TrashIcon } from '../icons';
import { Field } from './ui';
import { TimeField } from './TimeField';
import type { GuardianLink } from '../types';

export interface QuickAssignRef {
  kind: 'homework' | 'test';
  refId: string;
  title: string;
  subject: string;
}

type Mode = 'homework' | 'test';

function dueIso(date: string, time: string): string | null {
  if (!date) return null;
  const parsed = new Date(time ? `${date}T${time}:00` : `${date}T23:59:00`);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export function PlanQuickAssign({
  link,
  onCreated,
}: {
  link: GuardianLink;
  onCreated: (ref: QuickAssignRef) => void;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const [open, setOpen] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [homework, setHomework] = useState({ title: '', subject: '', instructions: '', date: '', time: '' });
  const [test, setTest] = useState({
    title: '',
    subject: '',
    note: '',
    minutes: '',
    date: '',
    time: '',
    questions: [emptyExamQuestion(newId('q'))] as ExamQuestionDraft[],
  });

  if (!link.linkId || link.status !== 'linked') {
    return <p className="hint">{t('This link needs to sync before you can assign homework or tests here.')}</p>;
  }
  const linkId = link.linkId;

  const patchQuestion = (id: string, patch: Partial<ExamQuestionDraft>) => {
    setTest((current) => ({
      ...current,
      questions: current.questions.map((question) => (question.id === id ? { ...question, ...patch } : question)),
    }));
  };

  const addQuestion = () => {
    setTest((current) => ({ ...current, questions: [...current.questions, emptyExamQuestion(newId('q'))] }));
  };

  const removeQuestion = (id: string) => {
    setTest((current) =>
      current.questions.length === 1
        ? current
        : { ...current, questions: current.questions.filter((question) => question.id !== id) },
    );
  };

  const sendHomework = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!homework.title.trim()) return setError(t('Add a homework title.'));
    setBusy(true);
    setError(null);
    try {
      const before = new Set((panels.guardian.links.find((item) => item.linkId === linkId)?.homework ?? []).map((item) => item.id));
      const next = await sendHomeworkAssignment(panels, linkId, {
        title: homework.title.trim(),
        subject: homework.subject.trim(),
        instructions: homework.instructions.trim(),
        dueAt: dueIso(homework.date, homework.time),
      });
      updatePanels(next);
      const created = next.guardian.links
        .find((item) => item.linkId === linkId)
        ?.homework?.find((item) => !before.has(item.id));
      if (created) {
        onCreated({ kind: 'homework', refId: created.id, title: created.title, subject: created.subject });
        flash(t('Homework created — it is now in their homework list and in this plan.'));
      }
      setHomework({ title: '', subject: '', instructions: '', date: '', time: '' });
      setOpen(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('The homework could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  const sendTest = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const draft = {
      title: test.title,
      subject: test.subject,
      note: test.note,
      minutes: test.minutes,
      dueAt: dueIso(test.date, test.time) ?? '',
      questions: test.questions,
    };
    const issue = examDraftError(draft);
    if (issue) {
      setError(issue);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const before = new Set((panels.guardian.links.find((item) => item.linkId === linkId)?.exams ?? []).map((item) => item.id));
      const next = await sendExam(panels, linkId, draft);
      updatePanels(next);
      const created = next.guardian.links
        .find((item) => item.linkId === linkId)
        ?.exams?.find((item) => !before.has(item.id));
      if (created) {
        onCreated({ kind: 'test', refId: created.id, title: created.title, subject: created.subject });
        flash(t('Test created — it is now in their exams list and in this plan.'));
      }
      setTest({ title: '', subject: '', note: '', minutes: '', date: '', time: '', questions: [emptyExamQuestion(newId('q'))] });
      setOpen(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('The test could not be created.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="plan-quick-assign">
      <div className="plan-quick-head">
        <p className="chart-title">{t('Give homework or a test')}</p>
        <div className="segmented" role="group" aria-label={t('Quick assignments')}>
          <button
            type="button"
            className={`segment ${open === 'homework' ? 'on' : ''}`}
            aria-pressed={open === 'homework'}
            onClick={() => { setOpen(open === 'homework' ? null : 'homework'); setError(null); }}
          >
            {t('Homework')}
          </button>
          <button
            type="button"
            className={`segment ${open === 'test' ? 'on' : ''}`}
            aria-pressed={open === 'test'}
            onClick={() => { setOpen(open === 'test' ? null : 'test'); setError(null); }}
          >
            {t('Test')}
          </button>
        </div>
      </div>
      {error ? <p className="field-error" role="alert">{error}</p> : null}
      {open === 'homework' ? (
        <form className="plan-quick-form" onSubmit={(event) => void sendHomework(event)}>
          <Field label={t('Homework title')}>
            <input className="input" maxLength={120} value={homework.title} disabled={busy} required
              onChange={(event) => setHomework({ ...homework, title: event.target.value })} />
          </Field>
          <div className="panel-form-grid">
            <Field label={t('Subject (optional)')}>
              <input className="input" maxLength={60} value={homework.subject} disabled={busy}
                onChange={(event) => setHomework({ ...homework, subject: event.target.value })} />
            </Field>
            <Field label={t('Due date (optional)')}>
              <input className="input" type="date" value={homework.date} disabled={busy}
                onChange={(event) => setHomework({ ...homework, date: event.target.value })} />
            </Field>
            <Field label={t('Due time (optional)')}>
              <TimeField value={homework.time} disabled={busy} label={t('Due time')}
                onChange={(value) => setHomework({ ...homework, time: value })} />
            </Field>
          </div>
          <Field label={t('Instructions (optional)')}>
            <textarea className="input" rows={2} maxLength={400} value={homework.instructions} disabled={busy}
              onChange={(event) => setHomework({ ...homework, instructions: event.target.value })} />
          </Field>
          <div className="plan-quick-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || !homework.title.trim()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <PlusIcon size={14} />}
              {t('Create homework and add to plan')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setOpen(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      ) : null}
      {open === 'test' ? (
        <form className="plan-quick-form" onSubmit={(event) => void sendTest(event)}>
          <Field label={t('Test name')}>
            <input className="input" maxLength={120} value={test.title} disabled={busy} required
              onChange={(event) => setTest({ ...test, title: event.target.value })} />
          </Field>
          <div className="panel-form-grid">
            <Field label={t('Subject (optional)')}>
              <input className="input" maxLength={60} value={test.subject} disabled={busy}
                onChange={(event) => setTest({ ...test, subject: event.target.value })} />
            </Field>
            <Field label={t('Minutes allowed (optional)')}>
              <input className="input" type="number" min={1} max={600} inputMode="numeric" value={test.minutes} disabled={busy}
                onChange={(event) => setTest({ ...test, minutes: event.target.value })} />
            </Field>
            <Field label={t('Due date (optional)')}>
              <input className="input" type="date" value={test.date} disabled={busy}
                onChange={(event) => setTest({ ...test, date: event.target.value })} />
            </Field>
            <Field label={t('Due time (optional)')}>
              <TimeField value={test.time} disabled={busy} label={t('Due time')}
                onChange={(value) => setTest({ ...test, time: value })} />
            </Field>
          </div>
          <div className="plan-quick-questions">
            {test.questions.map((question, qIndex) => (
              <fieldset key={question.id} className="plan-quick-question">
                <legend>
                  {t('Question {0}', { 0: qIndex + 1 })}
                  <button
                    type="button"
                    className="icon-btn round"
                    aria-label={t('Remove question {0}', { 0: qIndex + 1 })}
                    disabled={busy || test.questions.length === 1}
                    onClick={() => removeQuestion(question.id)}
                  >
                    <TrashIcon size={13} />
                  </button>
                </legend>
                <input
                  className="input"
                  maxLength={400}
                  placeholder={t('What should they answer?')}
                  value={question.prompt}
                  disabled={busy}
                  onChange={(event) => patchQuestion(question.id, { prompt: event.target.value })}
                />
                {question.choices.map((choice, index) => (
                  <label key={index} className="plan-quick-option">
                    <input
                      type="radio"
                      name={`${question.id}-answer`}
                      checked={question.answer === index}
                      disabled={busy}
                      onChange={() => patchQuestion(question.id, { answer: index })}
                    />
                    <input
                      className="input"
                      maxLength={200}
                      placeholder={t('Option {0}', { 0: index + 1 })}
                      value={choice}
                      disabled={busy}
                      onChange={(event) => {
                        const choices = question.choices.map((item, itemIndex) => (itemIndex === index ? event.target.value : item));
                        patchQuestion(question.id, { choices });
                      }}
                    />
                  </label>
                ))}
                <div className="plan-quick-option-actions">
                  {question.choices.length < 5 ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      disabled={busy}
                      onClick={() => patchQuestion(question.id, { choices: [...question.choices, ''] })}
                    >
                      <PlusIcon size={12} /> {t('Add option')}
                    </button>
                  ) : null}
                  {question.choices.length > 2 ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      disabled={busy}
                      onClick={() =>
                        patchQuestion(question.id, {
                          choices: question.choices.slice(0, -1),
                          answer: question.answer === question.choices.length - 1 ? null : question.answer,
                        })
                      }
                    >
                      <TrashIcon size={12} /> {t('Remove option')}
                    </button>
                  ) : null}
                </div>
              </fieldset>
            ))}
            <button type="button" className="btn btn-ghost btn-small" disabled={busy || test.questions.length >= 25} onClick={addQuestion}>
              <PlusIcon size={14} /> {t('Add question')}
            </button>
          </div>
          <div className="plan-quick-actions">
            <button type="submit" className="btn btn-primary btn-small" disabled={busy || !test.title.trim()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <PlusIcon size={14} />}
              {t('Create test and add to plan')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setOpen(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
