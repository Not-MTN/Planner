import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatEdited, todayISO } from '../dates';
import { formatPercent, goalProgress, linkedTasks } from '../logic';
import { TickIcon } from '../icons';
import { Empty, Meter } from '../components/ui';
import type { Goal } from '../types';
import { t } from '../i18n';

const FILLS = ['sage', 'blue', 'peach', 'lav', 'pink'] as const;

export function GoalsView() {
  const { state, openComposer } = usePlanner();
  const short = state.goals.filter((goal) => goal.horizon === 'short');
  const long = state.goals.filter((goal) => goal.horizon === 'long');

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">{t("Goals")}</p>
          <h1>{t("Goals")}</h1>
          <p className="lede">{t("Direction, with steps you can finish.")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon: 'short' })}>
          {t("Add goal")}
        </button>
      </header>
      {state.goals.length === 0 ? (
        <section className="card">
          <Empty
            image="/img/spot-goals.jpg"
            title={t("No goals yet.")}
            text={t("A short-term goal can be this month. A long-term goal can stay quieter.")}
            action={
              <div className="empty-actions">
                <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon: 'short' })}>
                  {t("Short-term")}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon: 'long' })}>
                  {t("Long-term")}
                </button>
              </div>
            }
          />
        </section>
      ) : (
        <div className="goal-grid">
          <GoalColumn title={t("Short-term")} goals={short} horizon="short" />
          <GoalColumn title={t("Long-term")} goals={long} horizon="long" />
        </div>
      )}
    </div>
  );
}

function GoalColumn({ title, goals, horizon }: { title: string; goals: Goal[]; horizon: 'short' | 'long' }) {
  const { openComposer } = usePlanner();
  return (
    <section className="goal-column">
      <header className="card-head">
        <h2 className="kicker">{title}</h2>
        <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon })}>
          {t("Add")}
        </button>
      </header>
      {goals.length === 0 ? <p className="empty-inline">{t("Nothing here yet.")}</p> : goals.map((goal, index) => (
        <GoalCard key={goal.id} goal={goal} fill={FILLS[index % FILLS.length]} />
      ))}
    </section>
  );
}

function GoalCard({ goal, fill }: { goal: Goal; fill: (typeof FILLS)[number] }) {
  const { state, toggleMilestone, toggleTask, addMilestone, deleteMilestone, openComposer, deleteGoal, flash, undo } = usePlanner();
  const [step, setStep] = useState('');
  const progress = goalProgress(goal, state.tasks);
  const linked = linkedTasks(state, goal.id);
  const late = goal.deadline && progress.ratio < 1 && goal.deadline < todayISO();

  return (
    <article className={cx('card goal-card', `accent-${fill}`)}>
      <header className="goal-head">
        <h3>{goal.title}</h3>
        <span className="habit-percent">{formatPercent(progress.ratio)}</span>
      </header>
      {goal.description ? <p className="goal-copy">{goal.description}</p> : null}
      <Meter value={progress.ratio} label={`${goal.title} progress`} />
      <p className={cx('meta', late && 'is-late')}>
        {progress.total === 0
          ? t("Add a step to track this.")
          : progress.ratio === 1
            ? t("Complete")
            : t("{0} of {1} steps", { 0: progress.done, 1: progress.total })}
        {goal.deadline ? ` · ${late ? 'Deadline passed' : `Due ${formatEdited(goal.deadline + 'T12:00:00')}`}` : ''}
      </p>
      <ul className="steps">
        {goal.milestones.map((milestone) => (
          <li key={milestone.id} className={milestone.completed ? 'is-done' : undefined}>
            <button
              type="button"
              className={cx('check', milestone.completed && 'on')}
              aria-pressed={milestone.completed}
              aria-label={milestone.completed ? t("Mark {0} not done", { 0: milestone.title }) : t("Mark {0} complete", { 0: milestone.title })}
              onClick={() => toggleMilestone(goal.id, milestone.id)}
            >
              {milestone.completed ? <TickIcon size={14} /> : null}
            </button>
            <span>{milestone.title}</span>
            <button
              type="button"
              className="text-btn"
              onClick={() => deleteMilestone(goal.id, milestone.id)}
            >
              {t("Remove")}
            </button>
          </li>
        ))}
        {linked.map((task) => (
          <li key={task.id} className={task.completed ? 'is-done' : undefined}>
            <button
              type="button"
              className={cx('check', task.completed && 'on')}
              aria-pressed={task.completed}
              aria-label={task.completed ? t("Mark {0} not done", { 0: task.title }) : t("Mark {0} complete", { 0: task.title })}
              onClick={() => toggleTask(task.id)}
            >
              {task.completed ? <TickIcon size={14} /> : null}
            </button>
            <span>{task.title}</span>
            <small>{t("Task")}</small>
          </li>
        ))}
      </ul>
      <form
        className="step-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!step.trim()) return;
          addMilestone(goal.id, step);
          setStep('');
        }}
      >
        <label>
          <span className="visually-hidden">{t("Add a step to")} {goal.title}</span>
          <input value={step} onChange={(event) => setStep(event.target.value)} placeholder={t("Add a step")} maxLength={140} />
        </label>
        <button type="submit" className="btn btn-tiny">{t("Add")}</button>
      </form>
      <div className="row-actions">
        <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'edit', type: 'goal', id: goal.id })}>
          {t("Edit")}
        </button>
        <button
          type="button"
          className="btn btn-tiny danger"
          onClick={() => {
            deleteGoal(goal.id);
            flash(t("Goal “{0}” removed.", { 0: goal.title }), { label: t("Undo"), run: undo });
          }}
        >
          {t("Remove")}
        </button>
      </div>
      </article>
  );
}
