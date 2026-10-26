/**
 * The subject-by-subject review a guardian actually plans from.
 *
 * One table answers the whole question at once: how much of each lesson got
 * studied, how many tests were sat and how they went, and where the homework
 * stands. It folds the plans, shared weekly results, exams and homework on the
 * link — all counts the link already carries, never the student's private
 * tasks or notes. On a phone the table stands up as stacked subject cards.
 */
import { useMemo, useState } from 'react';
import { cx } from '../cx';
import { faNum, t } from '../i18n';
import type { GuardianLink } from '../types';
import { buildGuardianReview, type ReviewWindow, type SubjectReview } from '../guardianReview';
import { minutesLabel } from './charts';

const WINDOWS: Array<{ id: ReviewWindow; label: string }> = [
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'Last 4 weeks' },
  { id: 'all', label: 'All time' },
];

function StatTile({ value, label, tone }: { value: string; label: string; tone?: 'good' | 'warn' }) {
  return (
    <div className={cx('review-tile', tone === 'good' && 'is-good', tone === 'warn' && 'is-warn')}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function SubjectRow({ subject }: { subject: SubjectReview }) {
  const ratio = subject.lessonsPlanned > 0 ? subject.lessonsDone / subject.lessonsPlanned : null;
  return (
    <li className="review-subject">
      <div className="review-subject-head">
        <strong className="review-subject-name">{subject.name}</strong>
        <span className="review-subject-score">
          {ratio === null ? '—' : t('{0} of {1} lessons', { 0: faNum(subject.lessonsDone), 1: faNum(subject.lessonsPlanned) })}
        </span>
      </div>
      {ratio !== null ? (
        <div className="review-bar" aria-hidden="true">
          <i style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
      ) : null}
      <dl className="review-facts">
        <div>
          <dt>{t('Planned study')}</dt>
          <dd>{minutesLabel(subject.plannedMinutes)}</dd>
        </div>
        <div>
          <dt>{t('Focused')}</dt>
          <dd>{minutesLabel(subject.focusMinutes)}</dd>
        </div>
        <div>
          <dt>{t('Tests')}</dt>
          <dd>
            {t('{0} of {1} sat', { 0: faNum(subject.testsTaken), 1: faNum(subject.testsSet) })}
            {subject.averageScore !== null ? <em className="review-average"> · {faNum(subject.averageScore)}%</em> : null}
          </dd>
        </div>
        <div>
          <dt>{t('Homework')}</dt>
          <dd>
            {t('{0} pending · {1} done of {2}', {
              0: faNum(subject.homeworkPending),
              1: faNum(subject.homeworkApproved),
              2: faNum(subject.homeworkSet),
            })}
          </dd>
        </div>
      </dl>
    </li>
  );
}

export function GuardianReview({ link }: { link: GuardianLink }) {
  const [window, setWindow] = useState<ReviewWindow>('month');
  const summary = useMemo(() => buildGuardianReview(link, window), [link, window]);

  return (
    <section className="card guardian-review" aria-label={t('Student review')}>
      <header className="card-head">
        <div>
          <p className="kicker">{t('Review')}</p>
          <h2 className="card-title">{t('How the studying is going')}</h2>
        </div>
        <div className="segmented review-window" role="group" aria-label={t('Review period')}>
          {WINDOWS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={cx('segment', window === entry.id && 'on')}
              aria-pressed={window === entry.id}
              onClick={() => setWindow(entry.id)}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
      </header>
      <div className="review-tiles">
        <StatTile
          value={`${faNum(summary.lessonsDone)}/${faNum(summary.lessonsPlanned)}`}
          label={t('Lessons done')}
          tone={summary.completion !== null && summary.completion >= 0.8 ? 'good' : undefined}
        />
        <StatTile value={minutesLabel(summary.focusMinutes)} label={t('Focused time')} />
        <StatTile
          value={`${faNum(summary.testsTaken)}/${faNum(summary.testsSet)}`}
          label={t('Tests sat')}
        />
        <StatTile
          value={`${faNum(summary.homeworkPending)}`}
          label={t('Homework waiting')}
          tone={summary.homeworkPending > 0 ? 'warn' : 'good'}
        />
      </div>
      {summary.subjects.length > 0 ? (
        <ul className="review-subject-list">
          {summary.subjects.map((subject) => (
            <SubjectRow key={subject.name} subject={subject} />
          ))}
        </ul>
      ) : (
        <p className="empty-note">{t('No study, tests or homework to review in this period yet.')}</p>
      )}
    </section>
  );
}
