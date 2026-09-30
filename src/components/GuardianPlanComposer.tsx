import { useId, useState } from 'react';
import { usePlanner } from '../context';
import { sendPlan } from '../auth/links';
import { isValidISODate } from '../dates';
import { PlusIcon, TrashIcon } from '../icons';
import { t } from '../i18n';
import {
  emptyPlanStep,
  PLAN_STEP_LIMIT,
  planDraftError,
  studyPlanTemplate,
  type PanelPlanDraft,
  type PlanStepDraft,
} from '../panelFeatures';
import { planEnd, planStartFor, withLinkPlan } from '../panels';
import type { GuardianLink, PlanCadence } from '../types';
import { Field } from './ui';
import { minutesLabel } from './charts';

export function GuardianPlanComposer({
  link,
  cadence,
  onClose,
}: {
  link: GuardianLink;
  cadence: PlanCadence;
  onClose: () => void;
}) {
  const { panels, updatePanels, flash, requestConfirm } = usePlanner();
  const [draft, setDraft] = useState<PanelPlanDraft>(() => ({
    cadence,
    start: planStartFor(cadence),
    title: '',
    note: '',
    items: [emptyPlanStep()],
  }));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subjectListId = useId();
  const end = isValidISODate(draft.start) ? planEnd(draft) : '';
  const count = draft.items.filter((item) => item.title.trim()).length;
  const totalMinutes = draft.items.reduce(
    (sum, item) =>
      sum + (item.title.trim() && Number.isFinite(Number(item.minutes)) ? Math.max(0, Number(item.minutes)) : 0),
    0,
  );

  const patchStep = (id: string, patch: Partial<PlanStepDraft>) => {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    }));
    setError(null);
  };

  const template = (kind: 'revision' | 'balanced') => {
    const apply = () => {
      const start = isValidISODate(draft.start) ? draft.start : planStartFor(draft.cadence);
      setDraft(studyPlanTemplate(kind, draft.cadence, start, link.results?.subjects[0]?.name ?? ''));
      setError(null);
    };
    if (
      draft.title.trim() ||
      draft.note.trim() ||
      draft.items.some((item) => item.title.trim() || item.subject.trim() || item.minutes || item.date)
    ) {
      requestConfirm({
        title: t('Replace this draft?'),
        body: t('The starter replaces the unsent title, note, and steps. You can edit everything before sending.'),
        confirmLabel: t('Use starter'),
        onConfirm: apply,
      });
    } else apply();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sending || !link.linkId) return;
    const issue = planDraftError(draft);
    if (issue) {
      setError(issue);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const next = await sendPlan(panels, link.linkId, {
        cadence: draft.cadence,
        start: draft.start,
        title: draft.title,
        note: draft.note,
        items: draft.items
          .filter((item) => item.title.trim())
          .map((item) => ({
            title: item.title.trim(),
            subject: item.subject.trim() || null,
            date: item.date || null,
            minutes: item.minutes ? Math.round(Number(item.minutes)) : null,
          })),
      });
      const previousIds = new Set(link.plans.map((plan) => plan.id));
      const sent = next.guardian.links
        .find((item) => item.linkId === link.linkId)
        ?.plans.find((plan) => !previousIds.has(plan.id));
      // Apply only the new plan: slow requests must not replace an edited roster.
      if (sent) updatePanels((current) => withLinkPlan(current, link.linkId!, sent));
      flash(t('The plan is on its way to {0}.', { 0: link.displayName }));
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('That plan could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="guardian-plan-composer panel-inline-form"
      onSubmit={(event) => void submit(event)}
      aria-label={t('Plan for {0}', { 0: link.displayName })}
    >
      <fieldset disabled={sending}>
        <legend className="chart-title">{t('Build a plan together')}</legend>
        <p className="hint">
          {t('Sent as a suggestion in their panel. It does not change their personal tasks or calendar.')}
        </p>
        <div className="plan-starters" role="group" aria-label={t('Plan starters')}>
          <span>{t('Start with')}</span>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={() => template('revision')}>
            {t('Exam preparation')}
          </button>
          <button type="button" className="btn btn-ghost btn-tiny" onClick={() => template('balanced')}>
            {t('Balanced study')}
          </button>
        </div>
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
          <Field label={t('Covers')}>
            <select
              className="input"
              value={draft.cadence}
              onChange={(event) => {
                const next = event.target.value as PlanCadence;
                setDraft({ ...draft, cadence: next, start: planStartFor(next) });
                setError(null);
              }}
            >
              <option value="day">{t('A day')}</option>
              <option value="week">{t('A week')}</option>
              <option value="month">{t('A month')}</option>
            </select>
          </Field>
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
        <datalist id={subjectListId}>
          {link.results?.subjects.map((subject) => (
            <option key={subject.name} value={subject.name} />
          ))}
        </datalist>
        <ol className="plan-step-list">
          {draft.items.map((item, index) => (
            <li key={item.id} className="plan-step-row">
              <div className="plan-step-top">
                <span>{t('Step {0}', { 0: index + 1 })}</span>
                <button
                  type="button"
                  className="icon-btn round"
                  aria-label={t('Remove step {0}', { 0: index + 1 })}
                  disabled={draft.items.length === 1}
                  onClick={() => {
                    setDraft({ ...draft, items: draft.items.filter((step) => step.id !== item.id) });
                    setError(null);
                  }}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
              <input
                className="input"
                aria-label={t('Step {0} title', { 0: index + 1 })}
                value={item.title}
                maxLength={120}
                placeholder={t('What should they do?')}
                onChange={(event) => patchStep(item.id, { title: event.target.value })}
              />
              <div className="panel-form-grid">
                <Field label={t('Subject')}>
                  <input
                    className="input"
                    aria-label={t('Step {0} subject', { 0: index + 1 })}
                    value={item.subject}
                    maxLength={60}
                    list={subjectListId}
                    placeholder={t('Optional')}
                    onChange={(event) => patchStep(item.id, { subject: event.target.value })}
                  />
                </Field>
                <Field label={t('Minutes')}>
                  <input
                    className="input"
                    type="number"
                    aria-label={t('Step {0} minutes', { 0: index + 1 })}
                    min={1}
                    max={1440}
                    step={1}
                    value={item.minutes}
                    placeholder={t('Optional')}
                    onChange={(event) => patchStep(item.id, { minutes: event.target.value })}
                  />
                </Field>
                <Field label={t('Date')}>
                  <input
                    className="input"
                    type="date"
                    aria-label={t('Step {0} date', { 0: index + 1 })}
                    min={draft.start || undefined}
                    max={end || undefined}
                    value={item.date}
                    onChange={(event) => patchStep(item.id, { date: event.target.value })}
                  />
                </Field>
              </div>
            </li>
          ))}
        </ol>
        <div className="plan-composer-summary">
          <span>{t('{0} steps · {1} planned', { 0: count, 1: minutesLabel(totalMinutes) })}</span>
          <button
            type="button"
            className="btn btn-ghost btn-small"
            disabled={draft.items.length >= PLAN_STEP_LIMIT}
            onClick={() => setDraft({ ...draft, items: [...draft.items, emptyPlanStep()] })}
          >
            <PlusIcon size={14} />
            {t('Add step')}
          </button>
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
