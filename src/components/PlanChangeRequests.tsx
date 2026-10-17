/**
 * The two sides of one ask.
 *
 * A student asks for a lesson to be added or taken off; a guardian approves it
 * — which makes the change on both panels at once — or declines it with a line
 * back. `GuardianChangeRequests` is the decision, `StudentChangeRequests` is
 * the waiting: what was asked, and what came of it.
 */
import { useState } from 'react';
import { usePlanner } from '../context';
import { answerChangeRequest } from '../auth/links';
import { formatFullDate, todayISO } from '../dates';
import { cx } from '../cx';
import { faNum, t } from '../i18n';
import { CheckIcon, ClockIcon, CloseIcon } from '../icons';
import { withLinkChangeRequests, withLinkPlan } from '../panels';
import type { GuardianLink, PlanChangeRequest } from '../types';
import {
  canAnswerChangeRequest,
  lessonTimeLabel,
  openChangeRequests,
  withoutStudentChangeRequest,
} from '../weekPlans';

function AskLine({ request }: { request: PlanChangeRequest }) {
  return (
    <>
      <span className={cx('week-ask-kind', request.kind)}>{request.kind === 'add' ? t('Add') : t('Remove')}</span>
      <span className="week-ask-title">{request.title}</span>
      {request.date ? <span className="week-ask-day">{formatFullDate(request.date)}</span> : null}
      {request.time ? (
        <span className="week-ask-time">
          <ClockIcon size={13} />
          {lessonTimeLabel({ time: request.time, end: request.end })}
        </span>
      ) : null}
    </>
  );
}

/** Guardian: the asks waiting for a yes or a no, oldest first. */
export function GuardianChangeRequests({
  link,
  today = todayISO(),
}: {
  link: GuardianLink;
  today?: string;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const requests = openChangeRequests(link.changeRequests ?? [], today);
  if (requests.length === 0) return null;
  // An ask about a plan that is gone has nothing left to change; it ages out of
  // the wire window on its own rather than sitting here undecided for ever.
  const live = requests.filter((request) => link.plans.some((plan) => plan.id === request.planId));
  const pending = live.filter((request) => request.state === 'open');
  const answered = live.filter((request) => request.state !== 'open');
  if (live.length === 0) return null;

  const answer = async (request: PlanChangeRequest, decision: 'approved' | 'declined') => {
    if (!link.linkId || busy) return;
    setBusy(request.id);
    try {
      const next = await answerChangeRequest(panels, link.linkId, request.id, decision, reply[request.id] ?? '', today);
      const updatedLink = next.guardian.links.find((item) => item.linkId === link.linkId);
      const plan = updatedLink?.plans.find((item) => item.id === request.planId);
      const answeredRequest = updatedLink?.changeRequests?.find((item) => item.id === request.id);
      // Adopt only what this answer touched: a slow request must not replace a
      // roster that has been changing elsewhere.
      updatePanels((current) => {
        let nextPanels = current;
        if (plan) nextPanels = withLinkPlan(nextPanels, link.linkId!, plan);
        if (answeredRequest) {
          nextPanels = withLinkChangeRequests(nextPanels, link.linkId!, [answeredRequest]);
        }
        return nextPanels;
      });
      setReply((current) => ({ ...current, [request.id]: '' }));
      flash(
        decision === 'approved'
          ? t('Approved — the plan is updated for {0}.', { 0: link.displayName })
          : t('Declined — {0} will see your answer.', { 0: link.displayName }),
      );
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('That answer could not be sent.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="week-asks" aria-label={t('Change requests')}>
      <p className="chart-title">
        {t('Change requests')}
        {pending.length > 0 ? <span className="week-asks-count">{faNum(pending.length)}</span> : null}
      </p>
      {pending.length === 0 ? (
        <p className="hint">{t('Nothing waiting — every ask has an answer.')}</p>
      ) : null}
      <ul className="week-ask-list">
        {pending.map((request) => {
          const plan = link.plans.find((item) => item.id === request.planId);
          const answerable = canAnswerChangeRequest(plan, request, today);
          return (
            <li key={request.id} className="week-ask is-open">
              <p className="week-ask-head">
                <AskLine request={request} />
              </p>
              {request.note ? <p className="week-ask-note">“{request.note}”</p> : null}
              {plan ? <p className="week-ask-plan">{plan.title}</p> : null}
              {!answerable ? (
                <p className="week-ask-late" role="status">
                  {t('That day has gone by. You can still decline it with a line back.')}
                </p>
              ) : null}
              <div className="week-ask-actions">
                <input
                  className="input"
                  value={reply[request.id] ?? ''}
                  maxLength={140}
                  placeholder={t('Write back…')}
                  aria-label={t('Write back…')}
                  disabled={busy === request.id}
                  onChange={(event) => setReply((current) => ({ ...current, [request.id]: event.target.value }))}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-tiny"
                  disabled={busy === request.id || !answerable}
                  onClick={() => void answer(request, 'approved')}
                >
                  <CheckIcon size={14} />
                  {t('Approve')}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-tiny"
                  disabled={busy === request.id}
                  onClick={() => void answer(request, 'declined')}
                >
                  <CloseIcon size={14} />
                  {t('Decline')}
                </button>
              </div>
            </li>
          );
        })}
        {answered.map((request) => (
          <li key={request.id} className={cx('week-ask', 'is-answered', request.state)}>
            <p className="week-ask-head">
              <AskLine request={request} />
              <span className={cx('week-pill', request.state === 'approved' ? 'reported' : 'missing')}>
                {request.state === 'approved' ? t('Approved') : t('Declined')}
              </span>
            </p>
            {request.reply ? <p className="week-ask-note">“{request.reply}”</p> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Student: what was asked, and what came of it. */
export function StudentChangeRequests({
  planId,
  today = todayISO(),
}: {
  planId?: string | null;
  today?: string;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const all = openChangeRequests(panels.student.changeRequests ?? [], today);
  const requests = planId ? all.filter((request) => request.planId === planId) : all;
  if (requests.length === 0) return null;

  return (
    <section className="week-asks week-asks-mine" aria-label={t('Your change requests')}>
      <p className="chart-title">{t('Your change requests')}</p>
      <ul className="week-ask-list">
        {requests.map((request) => (
          <li
            key={request.id}
            className={cx('week-ask', request.state === 'open' ? 'is-open' : `is-answered ${request.state}`)}
          >
            <p className="week-ask-head">
              <AskLine request={request} />
              <span
                className={cx(
                  'week-pill',
                  request.state === 'approved' ? 'reported' : request.state === 'declined' ? 'missing' : 'rest',
                )}
              >
                {request.state === 'approved'
                  ? t('Approved')
                  : request.state === 'declined'
                    ? t('Declined')
                    : t('Waiting')}
              </span>
            </p>
            {request.note ? <p className="week-ask-note">“{request.note}”</p> : null}
            {request.reply ? <p className="week-ask-reply">{t('Your guardian wrote')}: “{request.reply}”</p> : null}
            {request.state === 'open' ? (
              <button
                type="button"
                className="btn btn-ghost btn-tiny"
                onClick={() => {
                  updatePanels((current) => withoutStudentChangeRequest(current, request.id));
                  flash(t('Ask taken back.'));
                }}
              >
                {t('Take it back')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
