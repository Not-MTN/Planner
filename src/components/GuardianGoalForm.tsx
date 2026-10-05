import { useState } from 'react';
import { usePlanner } from '../context';
import { sendGoal } from '../auth/links';
import { draftGuardianProposal, friendlyGroqError } from '../ai';
import { t } from '../i18n';
import { GOAL_STEPS_MAX } from '../types';
import type { GuardianLink } from '../types';
import { Field } from './ui';

/**
 * Guardian: suggest a goal.
 *
 * This writes no goals and moves no work. It asks a question and waits — the
 * student says yes or not now, and only a yes puts anything in their planner.
 * The "why" field is deliberately first-class: a goal with no reason behind it
 * reads as an instruction, and instructions are what teenagers stop reading.
 */
export function GuardianGoalForm({ link, onClose }: { link: GuardianLink; onClose: () => void }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [target, setTarget] = useState('');
  const [steps, setSteps] = useState<string[]>(['', '']);
  const [sending, setSending] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled = steps.filter((step) => step.trim());

  /**
   * Fill the form from a draft based on the shared weekly results.
   *
   * No target date is filled in: the AI is told not to invent deadlines, and a
   * date is the one field a student would read as a commitment. The guardian
   * adds one if they mean it.
   */
  const draftWithAi = async () => {
    if (drafting || sending || !link.results) return;
    setDrafting(true);
    setError(null);
    try {
      const result = await draftGuardianProposal({ results: link.results, history: link.history, kind: 'goal' });
      if (result.title) setTitle(result.title);
      if (result.note) setNote(result.note);
      if (result.steps.length) setSteps(result.steps.map((step) => step.title));
    } catch (caught) {
      setError(friendlyGroqError(caught));
    } finally {
      setDrafting(false);
    }
  };

  const patchStep = (index: number, value: string) => {
    setSteps((current) => current.map((step, at) => (at === index ? value : step)));
    setError(null);
  };

  const send = async () => {
    if (sending) return;
    if (!title.trim()) {
      setError(t('Give the goal a name.'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const next = await sendGoal(panels, link.linkId ?? '', {
        title: title.trim(),
        note: note.trim(),
        // An empty field is no date, not today — a target nobody chose would be
        // a deadline the student did not agree to.
        target: /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : null,
        steps: filled,
      });
      updatePanels(() => next);
      setTitle('');
      setNote('');
      setTarget('');
      setSteps(['', '']);
      flash(t('Goal suggested. They decide whether to take it on.'));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('That goal could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="ggoal-form" aria-label={t('Suggest a goal')}>
      <div className="ggoal-form-head">
        <div>
          <p className="chart-title">{t('Suggest a goal')}</p>
          <p className="chart-note">{t('They choose whether to take it on. Nothing is added to their planner until they agree.')}</p>
        </div>
        <div className="ggoal-form-actions">
          <button
            type="button"
            className="btn btn-ghost btn-tiny"
            disabled={drafting || sending || !link.results}
            onClick={() => void draftWithAi()}
          >
            {drafting ? t('Drafting…') : t('Draft with AI')}
          </button>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={onClose}>
            {t('Cancel')}
          </button>
        </div>
      </div>
      <p className="chart-note">
        {t('An AI draft reads the weekly results they shared — never their tasks or notes. Read it before you send it.')}
      </p>

      <Field label={t('The goal')}>
        <input
          className="input"
          value={title}
          maxLength={120}
          placeholder={t('Reach a B in maths by the summer')}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
        />
      </Field>

      <Field label={t('Why you are suggesting it')}>
        <textarea
          className="input"
          rows={2}
          maxLength={400}
          value={note}
          placeholder={t('You have been close on the last three tests. This is the one thing that would move it.')}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>

      <Field label={t('A date to aim at (optional)')}>
        <input
          className="input"
          type="date"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
        />
      </Field>

      <div className="ggoal-steps">
        <p className="field-label">{t('Steps (optional)')}</p>
        {steps.map((step, index) => (
          <div className="ggoal-step" key={index}>
            <input
              className="input"
              value={step}
              maxLength={140}
              placeholder={index === 0 ? t('Finish the past-paper booklet') : t('Another step')}
              onChange={(event) => patchStep(index, event.target.value)}
            />
          </div>
        ))}
        {steps.length < GOAL_STEPS_MAX ? (
          <button type="button" className="btn btn-ghost btn-tiny" onClick={() => setSteps((current) => [...current, ''])}>
            {t('Add a step')}
          </button>
        ) : null}
      </div>

      {error ? <p className="form-error">{error}</p> : null}

      <div className="panel-form-actions">
        <button type="button" className="btn btn-primary btn-small" disabled={sending} onClick={() => void send()}>
          {sending ? <span className="spinner" aria-hidden="true" /> : null}
          {t('Suggest this goal')}
        </button>
      </div>
    </section>
  );
}
