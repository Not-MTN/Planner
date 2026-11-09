import type { ReactNode } from 'react';
import {
  buildGuardianProgress,
  type AcceptedGoalProgress,
  type ClassSubjectProgress,
  type MarkedTestResult,
  type WeeklyCompletionPoint,
} from '../guardianProgress';
import { faDigits, faNum, t } from '../i18n';
import type { GuardianLink } from '../types';

function dateLabel(value: string): string {
  const day = value.slice(0, 10);
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day || value || '—';
  return faDigits(date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }));
}

function ChartBlock({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="chart-block" aria-label={title}>
      <p className="chart-title">{title}</p>
      {note ? <p className="chart-note">{note}</p> : null}
      {children}
    </section>
  );
}

function CompletionTrend({ weeks }: { weeks: WeeklyCompletionPoint[] }) {
  if (!weeks.some((week) => week.percent !== null)) return null;

  const width = 320;
  const height = 126;
  const left = 28;
  const right = 314;
  const top = 10;
  const bottom = 96;
  const x = (index: number) => (weeks.length === 1 ? (left + right) / 2 : left + (index / (weeks.length - 1)) * (right - left));
  const y = (percent: number) => bottom - (percent / 100) * (bottom - top);

  return (
    <div className="guardian-progress-trend">
      <svg
        className="guardian-progress-svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t('Weekly completion rate')}
        preserveAspectRatio="none"
      >
        <g className="guardian-progress-gridline" aria-hidden="true">
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line x1={left} x2={right} y1={y(tick)} y2={y(tick)} />
              <text x={left - 5} y={y(tick) + 3} textAnchor="end">{faNum(tick)}%</text>
            </g>
          ))}
        </g>
        {weeks.slice(1).map((to, index) => {
          const from = weeks[index];
          if (from?.percent === null || from?.percent === undefined || to.percent === null) return null;
          return (
            <line
              key={`${from.weekOf}-${to.weekOf}`}
              className="guardian-progress-line"
              x1={x(index)}
              y1={y(from.percent)}
              x2={x(index + 1)}
              y2={y(to.percent)}
            />
          );
        })}
        {weeks.map((week, index) => week.percent === null ? null : (
          <circle key={week.weekOf} className="guardian-progress-point" cx={x(index)} cy={y(week.percent)} r={3.5}>
            <title>{t('{0}: {1}%', { 0: dateLabel(week.weekOf), 1: faNum(week.percent) })}</title>
          </circle>
        ))}
      </svg>
      <div className="chart-axis">
        {weeks.map((week) => <span key={week.weekOf}>{dateLabel(week.weekOf)}</span>)}
      </div>
    </div>
  );
}

function TestScores({ tests }: { tests: MarkedTestResult[] }) {
  if (tests.length === 0) return null;

  return (
    <ChartBlock title={t('Marked test scores')} note={t('Scores appear only after a marked submission, in date order.')}>
      <ol className="guardian-progress-test-list">
        {tests.map((test, index) => {
          const label = test.subject || test.title || t('Test {0}', { 0: faNum(index + 1) });
          const detail = [test.subject && test.title ? test.title : '', dateLabel(test.submittedAt)].filter(Boolean).join(' · ');
          return (
            <li className="guardian-progress-test" key={test.id}>
              <div className="guardian-progress-test-head">
                <span className="guardian-progress-row-label">{label}</span>
                <strong className="guardian-progress-row-value" dir="ltr">{faNum(test.percent)}%</strong>
              </div>
              <div className="guardian-progress-track" aria-hidden="true">
                <i className="guardian-progress-fill" style={{ width: `${test.percent}%` }} />
              </div>
              <span className="guardian-progress-test-detail">{detail}</span>
            </li>
          );
        })}
      </ol>
    </ChartBlock>
  );
}

const HOMEWORK_STATES = [
  { key: 'notSubmitted', label: () => t('Not submitted'), className: 'is-not-submitted' },
  { key: 'awaitingReview', label: () => t('Awaiting review'), className: 'is-awaiting-review' },
  { key: 'approved', label: () => t('Approved'), className: 'is-approved' },
] as const;

function HomeworkStatus({ progress }: { progress: ReturnType<typeof buildGuardianProgress>['homework'] }) {
  if (progress.assigned === 0) return null;
  const counts = {
    notSubmitted: progress.notSubmitted,
    awaitingReview: progress.awaitingReview,
    approved: progress.approved,
  };

  return (
    <ChartBlock title={t('Homework status')}>
      <div
        className="guardian-progress-stacked"
        role="img"
        aria-label={t('{0} assigned, {1} not submitted, {2} awaiting review, {3} approved', {
          0: faNum(progress.assigned),
          1: faNum(progress.notSubmitted),
          2: faNum(progress.awaitingReview),
          3: faNum(progress.approved),
        })}
      >
        {HOMEWORK_STATES.map((state) => counts[state.key] > 0 ? (
          <span
            key={state.key}
            className={`guardian-progress-segment ${state.className}`}
            style={{ width: `${(counts[state.key] / progress.assigned) * 100}%` }}
          />
        ) : null)}
      </div>
      <ul className="guardian-progress-legend">
        {HOMEWORK_STATES.map((state) => (
          <li key={state.key}>
            <span className={`guardian-progress-key ${state.className}`} aria-hidden="true" />
            <span>{state.label()}</span>
            <strong dir="ltr">{faNum(counts[state.key])}</strong>
          </li>
        ))}
      </ul>
    </ChartBlock>
  );
}

function ProgressMeter({ value, total, label }: { value: number; total: number; label: string }) {
  const done = Math.max(0, Math.min(total, value));
  return (
    <div
      className="guardian-progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={t('{0} of {1}', { 0: faNum(done), 1: faNum(total) })}
    >
      <i className="guardian-progress-fill" style={{ width: `${(done / total) * 100}%` }} />
    </div>
  );
}

function ClassProgress({ classes }: { classes: ClassSubjectProgress[] }) {
  if (classes.length === 0) return null;

  return (
    <ChartBlock title={t('Class progress')}>
      <ul className="guardian-progress-rows">
        {classes.map((entry) => {
          const subject = entry.subject || t('No subject');
          return (
            <li className="guardian-progress-row" key={entry.subject}>
              <div className="guardian-progress-row-head">
                <span className="guardian-progress-row-label">{subject}</span>
                <span className="guardian-progress-row-value" dir="ltr">{faNum(entry.completed)}/{faNum(entry.assigned)}</span>
              </div>
              <ProgressMeter value={entry.completed} total={entry.assigned} label={subject} />
            </li>
          );
        })}
      </ul>
    </ChartBlock>
  );
}

function AcceptedGoals({ goals }: { goals: AcceptedGoalProgress[] }) {
  if (goals.length === 0) return null;

  return (
    <ChartBlock title={t('Accepted goals')}>
      <ul className="guardian-progress-rows">
        {goals.map((goal) => (
          <li className="guardian-progress-row" key={goal.id}>
            <div className="guardian-progress-row-head">
              <span className="guardian-progress-row-label">{goal.title || t('Goal')}</span>
              <span className="guardian-progress-row-value" dir="ltr">{faNum(goal.done)}/{faNum(goal.total)}</span>
            </div>
            <ProgressMeter value={goal.done} total={goal.total} label={goal.title || t('Goal')} />
          </li>
        ))}
      </ul>
    </ChartBlock>
  );
}

/**
 * Additional guardian charts, assembled only from the fields already shared
 * over a guardian link. The student's private planner is never queried here.
 */
export function GuardianProgressCharts({ link }: { link: GuardianLink }) {
  if (link.status !== 'linked') return null;
  const progress = buildGuardianProgress(link);
  const hasWeeklyTrend = progress.weeks.some((week) => week.percent !== null);
  const hasAnyChart = hasWeeklyTrend || progress.tests.length > 0 || progress.homework.assigned > 0 || progress.classes.length > 0 || progress.goals.length > 0;
  if (!hasAnyChart) return null;

  return (
    <section className="card guardian-progress-trends" aria-label={t('Progress trends')}>
      <header className="card-head">
        <div>
          <p className="kicker">{t('Shared progress')}</p>
          <h2 className="card-title">{t('Progress over time')}</h2>
          <p className="guardian-progress-intro">
            {t('These charts use only progress already shared with you. Private planner details stay private.')}
          </p>
        </div>
      </header>
      <div className="student-charts guardian-progress-grid">
        {hasWeeklyTrend ? (
          <ChartBlock title={t('Weekly completion rate')}>
            <CompletionTrend weeks={progress.weeks} />
          </ChartBlock>
        ) : null}
        <TestScores tests={progress.tests} />
        <HomeworkStatus progress={progress.homework} />
        <ClassProgress classes={progress.classes} />
        <AcceptedGoals goals={progress.goals} />
      </div>
    </section>
  );
}
