/**
 * The weeks that are over.
 *
 * A finished plan keeps its lessons for a month and then lets them go, keeping
 * this instead: the shape of the week in numbers. This is the whole point of
 * the trade — nobody re-opens a March plan lesson by lesson, but "she did 9 of
 * 10 and it was mostly chemistry" is worth keeping forever.
 *
 * One component, both panels, because a past week reads the same from either
 * chair.
 */
import { useState } from 'react';
import { cx } from '../cx';
import { formatMonthShort, formatWeekRange } from '../dates';
import { faNum, t } from '../i18n';
import { CheckIcon, TickIcon } from '../icons';
import { planReviewSummary } from '../planRetention';
import type { PlanReview } from '../types';

export function PlanReviews({ reviews, label }: { reviews: PlanReview[]; label?: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (reviews.length === 0) return null;

  return (
    <section className="card plan-reviews" aria-label={label ?? t('Former weeks')}>
      <div className="card-head">
        <h2 className="card-title">{label ?? t('Former weeks')}</h2>
        <p className="card-note">{t('A month of detail, then the week in numbers.')}</p>
      </div>
      <ul className="plan-review-list">
        {reviews.map((review) => {
          const open = openId === review.id;
          const allDone = review.done === review.lessons && review.lessons > 0;
          return (
            <li key={review.id} className={cx('plan-review-row', allDone && 'is-complete')}>
              <button
                type="button"
                className="plan-review-head"
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : review.id)}
              >
                <span className="plan-review-week">
                  {formatWeekRange(review.weekOf)}
                  <em>{formatMonthShort(review.weekOf)}</em>
                </span>
                <span className="plan-review-line">
                  {allDone ? <TickIcon size={13} /> : null}
                  {planReviewSummary(review)}
                </span>
                <span className="plan-review-title">{review.title}</span>
              </button>
              {open ? (
                <div className="plan-review-body">
                  <p className="plan-review-note">
                    {review.approvedAt ? (
                      <span className="plan-review-approved">
                        <CheckIcon size={12} />
                        {t('Signed off')}
                      </span>
                    ) : null}
                    {review.note || t('No note was left on this week.')}
                  </p>
                  {review.subjects.length > 0 ? (
                    <ul className="plan-review-subjects">
                      {review.subjects.map((subject) => (
                        <li key={subject.name || '—'}>
                          <span>{subject.name || t('No subject')}</span>
                          <span>
                            {t('{0} of {1}', { 0: faNum(subject.done), 1: faNum(subject.lessons) })}
                            {subject.minutes > 0 ? <em>{t('{0} minutes', { 0: faNum(subject.minutes) })}</em> : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="hint">{t('Written by {0}', { 0: review.author || t('your guardian') })}</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
