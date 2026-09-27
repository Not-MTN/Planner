import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatEdited, todayISO } from '../dates';
import { formatPercent, goalProgress, linkedTasks } from '../logic';
import { TickIcon } from '../icons';
import { Empty, Meter } from '../components/ui';
import type { Goal } from '../types';

const FILLS = ['sage', 'blue', 'peach', 'lav', 'pink'] as const;

export function GoalsView() {
  const { state, openComposer } = usePlanner();
  const short = state.goals.filter((goal) => goal.horizon === 'short');
  const long = state.goals.filter((goal) => goal.horizon === 'long');

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Goals</p>
          <h1>Goals</h1>
          <p className="lede">Direction, with steps you can finish.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon: 'short' })}>
          Add goal
        </button>
      </header>
      {state.goals.length === 0 ? (
        <section className="card">
          <Empty
            title="No goals yet."
            text="A short-term goal can be this month. A long-term goal can stay quieter."
            action={
              <div className="empty-actions">
                <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon: 'short' })}>
                  Short-term
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => openComposer({ mode: 'create', type: 'goal', horizon: 'long' })}>
                  Long-term
                </button>
              </div>
            }
          />
        </section>
      ) : (
        <div className="goal-grid">
          <GoalColumn title="Short-term" goals={short} horizon="short" />
          <GoalColumn title="Long-term" goals={long} horizon="long" />
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
          Add
        </button>
      </header>
      {goals.length === 0 ? <p className="empty-inline">Nothing here yet.</p> : goals.map((goal, index) => (
        <GoalCard key={goal.id} goal={goal} fill={FILLS[index % FILLS.length]} />
      ))}
    </section>
  );
}

function GoalCard({ goal, fill }: { goal: Goal; fill: (typeof FILLS)[number] }) {
  const { state, toggleMilestone, toggleTask, addMilestone, deleteMilestone, openComposer, requestConfirm, deleteGoal } = usePlanner();
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
          ? 'Add a step to track this.'
          : progress.ratio === 1
            ? 'Complete'
            : `${progress.done} of ${progress.total} steps`}
        {goal.deadline ? ` · ${late ? 'Deadline passed' : `Due ${formatEdited(goal.deadline + 'T12:00:00')}`}` : ''}
      </p>
      <ul className="steps">
        {goal.milestones.map((milestone) => (
          <li key={milestone.id} className={milestone.completed ? 'is-done' : undefined}>
            <button
              type="button"
              className={cx('check', milestone.completed && 'on')}
              aria-pressed={milestone.completed}
              aria-label={milestone.completed ? `Mark ${milestone.title} not done` : `Mark ${milestone.title} complete`}
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
              Remove
            </button>
          </li>
        ))}
        {linked.map((task) => (
          <li key={task.id} className={task.completed ? 'is-done' : undefined}>
            <button
              type="button"
              className={cx('check', task.completed && 'on')}
              aria-pressed={task.completed}
              aria-label={task.completed ? `Mark ${task.title} not done` : `Mark ${task.title} complete`}
              onClick={() => toggleTask(task.id)}
            >
              {task.completed ? <TickIcon size={14} /> : null}
            </button>
            <span>{task.title}</span>
            <small>Task</small>
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
          <span className="visually-hidden">Add a step to {goal.title}</span>
          <input value={step} onChange={(event) => setStep(event.target.value)} placeholder="Add a step" maxLength={140} />
        </label>
        <button type="submit" className="btn btn-tiny">Add</button>
      </form>
      <div className="row-actions">
        <button type="button" className="btn btn-tiny" onClick={() => openComposer({ mode: 'edit', type: 'goal', id: goal.id })}>
          Edit
        </button>
        <button
          type="button"
          className="btn btn-tiny danger"
          onClick={() =>
            requestConfirm({
              title: 'Remove this goal?',
              body: 'Steps go with it. Linked tasks stay in your task list.',
              onConfirm: () => deleteGoal(goal.id),
            })
          }
        >
          Remove
        </button>
      </div>
      </article>
  );
}
