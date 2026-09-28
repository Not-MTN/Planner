import { useState } from 'react';
import { usePlanner } from '../context';
import { addDays, formatFullDate, displayTime } from '../dates';
import { analyzeDraft, checkXAIConfiguration, filterDraftAgainstState, friendlyXAIError, habitFrequencyLabel, refineAIPlan, XAI_KEY_MISSING_MESSAGE, type AIDraft, type DraftWarning } from '../ai';
import { cx } from '../cx';
import { DraftRefine } from '../components/DraftRefine';
import { CalendarIcon, CheckIcon, CloseIcon, LeafIcon, MicIcon, SparklesIcon } from '../icons';
import { t } from '../i18n';
import type { SavedAIPlan } from '../types';

/** A saved plan back into the AIDraft shape the AI works with. */
function draftOfPlan(plan: SavedAIPlan): AIDraft {
  return {
    summary: plan.summary,
    tasks: plan.tasks,
    events: plan.events,
    habits: plan.habits,
    suggestions: plan.suggestions,
    skippedEvents: [],
  };
}

/**
 * The Plans page: every draft the AI builds — typed or spoken — lands here
 * automatically. Review any of them, add it to the planner, or delete it.
 * Nothing from this page changes the planner until you press "Add".
 */
export function PlansView() {
  const { state, applyAIPlan, deleteAIPlan, updateAIPlan, requestConfirm, flash, navigate, openSettings } = usePlanner();
  const [openId, setOpenId] = useState<string | null>(null);
  const [refiningId, setRefiningId] = useState<string | null>(null);
  const plans = [...state.aiPlans].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const drafts = plans.filter((plan) => plan.status === 'draft').length;

  const addPlan = (plan: SavedAIPlan) => {
    const safe = filterDraftAgainstState(draftOfPlan(plan), state);
    const taskCount = safe.tasks.length;
    const eventCount = safe.events.length;
    const habitCount = safe.habits.length;
    if (taskCount + eventCount + habitCount === 0) {
      flash(t("Everything in this plan is already in your planner, or its times now overlap protected slots."));
      return;
    }
    applyAIPlan({ tasks: safe.tasks, events: safe.events, habits: safe.habits }, plan.id);
    flash(t("Added {0} {1}, {2} {3} and {4} {5}. Undo is available.", {
      0: taskCount, 1: taskCount === 1 ? t("task") : t("tasks"),
      2: eventCount, 3: eventCount === 1 ? t("event") : t("events"),
      4: habitCount, 5: habitCount === 1 ? t("habit") : t("habits"),
    }));
  };

  const removePlan = (plan: SavedAIPlan) => {
    requestConfirm({
      title: t("Delete this plan?"),
      body: t("The draft “{0}” will be removed from your Plans page. Anything already added to your planner stays.", { 0: plan.title }),
      confirmLabel: t("Delete plan"),
      onConfirm: () => {
        deleteAIPlan(plan.id);
        flash(t("Plan deleted."));
      },
    });
  };

  /** Ask the AI to change a saved draft, keeping its range intact. */
  const refinePlan = async (plan: SavedAIPlan, request: string) => {
    const configured = await checkXAIConfiguration();
    if (!configured) {
      flash(XAI_KEY_MISSING_MESSAGE);
      openSettings();
      return;
    }
    setRefiningId(plan.id);
    try {
      const result = await refineAIPlan({
        draft: draftOfPlan(plan),
        request,
        range: { startDate: plan.startDate, days: plan.days },
        state,
      });
      updateAIPlan(plan.id, {
        summary: result.summary,
        tasks: result.tasks,
        events: result.events,
        habits: result.habits,
        suggestions: result.suggestions,
      });
      flash(t("Draft updated — review the changes before adding."));
    } catch (reason) {
      flash(friendlyXAIError(reason));
    } finally {
      setRefiningId(null);
    }
  };

  return (
    <div className="view plans-view">
      <header className="page-head plans-head" data-tour="plans-page">
        <div>
          <p className="kicker">{t("Made with your AI coach")}</p>
          <h1>{t("Plans")}</h1>
          <p className="lede">{t("Every draft the AI builds is kept here — for as many days as you asked it to plan. Add one when it feels right, or let it wait.")}</p>
        </div>
        <div className="plans-head-actions">
          {plans.length > 0 ? (
            <span className="chip">{drafts} {drafts === 1 ? t("draft waiting") : t("drafts waiting")}</span>
          ) : null}
          <button type="button" className="btn btn-soft btn-small" onClick={() => navigate({ name: 'ai', tab: 'plan' })}>
            <SparklesIcon size={15} /> {t("Make a new plan")}
          </button>
        </div>
      </header>

      {plans.length === 0 ? (
        <section className="card plans-empty">
          <span className="plans-empty-mark" aria-hidden="true"><LeafIcon size={22} /></span>
          <h2 className="card-title">{t("No plans yet")}</h2>
          <p className="meta">{t("Ask the AI coach — by typing or talking — and the draft appears here automatically. Say how long you want it to plan for: a day, a week, a month, or more.")}</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'ai', tab: 'plan' })}>
            <SparklesIcon size={16} /> {t("Open the AI coach")}
          </button>
        </section>
      ) : (
        <ul className="plans-list">
          {plans.map((plan) => {
            const open = openId === plan.id;
            const total = plan.tasks.length + plan.events.length + plan.habits.length;
            const end = addDays(plan.startDate, plan.days - 1);
            return (
              <li key={plan.id} className={cx('card plan-card', plan.status, open && 'open')}>
                <header className="plan-card-head">
                  <div className="plan-card-copy">
                    <p className="plan-card-meta">
                      <span className={cx('chip plan-status', plan.status)}>
                        {plan.status === 'added' ? t("Added to planner") : t("Draft")}
                      </span>
                      {plan.source === 'voice' ? (
                        <span className="chip plan-source"><MicIcon size={12} /> {t("Voice")}</span>
                      ) : null}
                      <span className="chip plan-range">
                        <CalendarIcon size={12} /> {plan.days} {plan.days === 1 ? t("day") : t("days")}
                      </span>
                    </p>
                    <h2 className="plan-card-title" dir="auto">{plan.title}</h2>
                    <p className="plan-card-dates">{formatFullDate(plan.startDate)} — {formatFullDate(end)}</p>
                  </div>
                  <div className="plan-card-actions">
                    {plan.status === 'draft' && total > 0 ? (
                      <button type="button" className="btn btn-primary btn-small" onClick={() => addPlan(plan)}>
                        <CheckIcon size={14} /> {t("Add to planner")}
                      </button>
                    ) : null}
                    <button type="button" className="icon-btn" aria-label={t("Delete {0}", { 0: plan.title })} onClick={() => removePlan(plan)}>
                      <CloseIcon size={15} />
                    </button>
                  </div>
                </header>
                {plan.prompt ? <p className="plan-card-prompt" dir="auto"><strong>{t("You asked:")}</strong> {plan.prompt}</p> : null}
                {plan.summary ? <p className="plan-card-summary" dir="auto">{plan.summary}</p> : null}
                <div className="plan-card-foot">
                  <button type="button" className="text-btn" aria-expanded={open} onClick={() => setOpenId(open ? null : plan.id)}>
                    {open ? t("Hide details") : t("Show {0} {1}", { 0: total, 1: total === 1 ? t("item") : t("items") })}
                  </button>
                  {plan.suggestions.length > 0 && !open ? (
                    <span className="plan-card-wellbeing"><LeafIcon size={13} /> {plan.suggestions[0]}</span>
                  ) : null}
                </div>
                {open ? (
                  <PlanDetails
                    plan={plan}
                    warnings={plan.status === 'draft' ? analyzeDraft(draftOfPlan(plan), state, { startDate: plan.startDate, days: plan.days }) : []}
                    working={refiningId === plan.id}
                    onRefine={plan.status === 'draft' ? (request) => refinePlan(plan, request) : null}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PlanDetails({ plan, warnings, working, onRefine }: {
  plan: SavedAIPlan;
  warnings: DraftWarning[];
  working: boolean;
  onRefine: ((request: string) => void) | null;
}) {
  return (
    <div className="plan-details">
      {onRefine ? <DraftRefine working={working} onRefine={onRefine} /> : null}
      {warnings.length > 0 ? (
        <div className="draft-warnings" role="status">
          <strong>{t("A few things to double-check")}</strong>
          <ul>{warnings.map((warning, index) => <li key={`${warning.kind}-${index}`}>{warning.message}</li>)}</ul>
        </div>
      ) : null}
      {plan.events.length > 0 ? (
        <div className="plan-details-group">
          <strong>{t("Timed plans")} · {plan.events.length}</strong>
          <ul>
            {[...plan.events].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime)).map((item, index) => (
              <li key={`e-${index}`}>
                <span>{item.title}</span>
                <small>{formatFullDate(item.date)} · {displayTime(item.startTime)}{item.endTime ? `–${displayTime(item.endTime)}` : ''}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.tasks.length > 0 ? (
        <div className="plan-details-group">
          <strong>{t("Tasks")} · {plan.tasks.length}</strong>
          <ul>
            {[...plan.tasks].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')).map((item, index) => (
              <li key={`t-${index}`}>
                <span>{item.title}</span>
                <small>{item.dueDate ? formatFullDate(item.dueDate) : t("Anytime")}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.habits.length > 0 ? (
        <div className="plan-details-group">
          <strong>{t("Habits")} · {plan.habits.length}</strong>
          <ul>
            {plan.habits.map((item, index) => (
              <li key={`h-${index}`}>
                <span>{item.name}</span>
                <small>{habitFrequencyLabel(item.frequency)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {plan.suggestions.length > 0 ? (
        <div className="plan-details-group plan-details-wellbeing">
          <strong><LeafIcon size={13} /> {t("Gentle wellbeing ideas")}</strong>
          <ul>{plan.suggestions.map((item, index) => <li key={index}><span>{item}</span></li>)}</ul>
        </div>
      ) : null}
      {plan.tasks.length + plan.events.length + plan.habits.length === 0 ? (
        <p className="empty-inline">{t("This draft has no addable items — its ideas may already be in your planner.")}</p>
      ) : null}
    </div>
  );
}
