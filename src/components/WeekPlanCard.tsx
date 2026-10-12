/**
 * A week plan as seven day rows, read the same on both sides.
 *
 * The student ticks lessons, rolls unfinished ones on, and reports finished
 * days from here; the guardian reads the ticks and the reports back, and
 * answers them. Plans from the older step composer render here too when they
 * cover a week — anything without a day in the week gathers under "any day"
 * instead of vanishing.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { cx } from '../cx';
import { displayTime, formatFullDate, formatWeekdayShort, todayISO } from '../dates';
import { faNum, t, tn } from '../i18n';
import { BellIcon, CheckIcon, GlobeIcon } from '../icons';
import { planEnd, planPeriodLabel, planProgress } from '../panels';
import { ACK_REACTIONS } from '../types';
import type { DayReport, GuardianPlan, PlanItem, ReportAck } from '../types';
import {
  ackFor,
  canApprovePlanPeriod,
  datelessItems,
  isRestDay,
  missingReportDays,
  itemsForDay,
  planWeekDays,
  reportFor,
  reportStats,
  rollTarget,
  weekReview,
} from '../weekPlans';
import { minutesLabel } from './charts';
import { DayReportForm } from './DayReportForm';
import { WeekTimetable } from './WeekTimetable';

function LessonMeta({ item }: { item: PlanItem }) {
  if (!item.subject && !item.minutes) return null;
  return (
    <span className="gplan-item-meta">
      {item.subject && item.subject !== item.title ? <span>{item.subject}</span> : null}
      {item.minutes ? <span>{minutesLabel(item.minutes)}</span> : null}
    </span>
  );
}

function AckLine({ ack }: { ack: ReportAck }) {
  return (
    <p className="week-ack">
      ✓ {t('Seen')}
      {ack.text ? ` — ${ack.text}` : ''}
      {ack.reactions.length > 0 ? ` ${ack.reactions.join('')}` : ''}
      {ack.approvedAt ? ` · ${t('Day approved')}` : ''}
    </p>
  );
}

/** Three taps beside a report: each toggles, and the row itself shows the state. */
function ReactionRow({ ack, onReact }: { ack?: ReportAck; onReact: (emoji: string) => Promise<void> }) {
  const [sending, setSending] = useState(false);
  const active = new Set(ack?.reactions ?? []);
  return (
    <div className="week-reactions">
      {ACK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className={cx('react-btn', active.has(emoji) && 'is-on')}
          disabled={sending || !!ack?.approvedAt}
          aria-pressed={active.has(emoji)}
          aria-label={t('React with {0}', { 0: emoji })}
          title={t('React with {0}', { 0: emoji })}
          onClick={() => {
            if (sending) return;
            setSending(true);
            void onReact(emoji).finally(() => setSending(false));
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Answering one report: seen at a tap, or seen with a line back. */
function AckRow({
  report,
  onAck,
  onApprove,
  approved = false,
}: {
  report: DayReport;
  onAck: (report: DayReport, text: string) => Promise<void>;
  onApprove?: (report: DayReport) => Promise<void>;
  approved?: boolean;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const send = async (value: string) => {
    if (sending) return;
    setSending(true);
    try {
      await onAck(report, value);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="week-ack-row">
      <button
        type="button"
        className="btn btn-ghost btn-tiny"
        disabled={sending || approved}
        onClick={() => void send('')}
      >
        {t('Seen')}
      </button>
      <input
        className="input"
        value={text}
        maxLength={140}
        disabled={sending || approved}
        placeholder={t('Write back…')}
        aria-label={t('Write back…')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && text.trim()) {
            event.preventDefault();
            void send(text);
          }
        }}
      />
      <button
        type="button"
        className="btn btn-ghost btn-tiny"
        disabled={sending || approved || !text.trim()}
        onClick={() => void send(text)}
      >
        {t('Reply')}
      </button>
      {onApprove ? (
        <button
          type="button"
          className="btn btn-primary btn-tiny"
          disabled={sending || approved}
          onClick={() => {
            if (sending || approved) return;
            setSending(true);
            void onApprove(report).finally(() => setSending(false));
          }}
        >
          {approved ? t('Approved') : t('Approve day')}
        </button>
      ) : null}
    </div>
  );
}

function ApproveDayButton({ report, onApprove }: { report: DayReport; onApprove: (report: DayReport) => Promise<void> }) {
  const [sending, setSending] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-primary btn-tiny"
      disabled={sending}
      onClick={() => {
        if (sending) return;
        setSending(true);
        void onApprove(report).catch(() => undefined).finally(() => setSending(false));
      }}
    >
      {sending ? <span className="spinner" aria-hidden="true" /> : null}
      {sending ? t('Approving…') : t('Approve day')}
    </button>
  );
}

export function WeekPlanCard({
  plan,
  reports,
  acks = [],
  variant,
  actions,
  onToggleItem,
  canToggleItem,
  reportingDate,
  onReportDay,
  canReportDay,
  onRollLesson,
  onAck,
  onApproveReport,
  onApprovePlanPeriod,
  onReact,
  focusMinutes,
  onNudge,
  nudgeSent = false,
  today = todayISO(),
}: {
  plan: GuardianPlan;
  reports: DayReport[];
  acks?: ReportAck[];
  variant: 'student' | 'guardian';
  /** Header buttons: print on both sides, taking back on the guardian's. */
  actions?: ReactNode;
  /** Student: ticking a lesson. Without it, ticks render read-only. */
  onToggleItem?: (planId: string, itemId: string) => void;
  /** Whether this particular item may be marked today. */
  canToggleItem?: (planId: string, itemId: string) => boolean;
  reportingDate?: string | null;
  /** Student: opening the report form for a day, or closing it with null. */
  onReportDay?: (date: string | null) => void;
  /** Whether this is the oldest reportable day and may be filed now. */
  canReportDay?: (planId: string, date: string) => boolean;
  /** Student: pushing an unfinished lesson to the next day. */
  onRollLesson?: (planId: string, itemId: string) => void;
  /** Guardian: answering a report. Without it, answers render read-only. */
  onAck?: (report: DayReport, text: string) => Promise<void>;
  /** Guardian: sealing a submitted daily report. */
  onApproveReport?: (report: DayReport) => Promise<void>;
  /** Guardian: closing a finished day, week, or month. */
  onApprovePlanPeriod?: (plan: GuardianPlan) => Promise<void>;
  /** Guardian: tapping a reaction on a report. Without it, no reactions are offered. */
  onReact?: (report: DayReport, ack: ReportAck | undefined, emoji: string) => Promise<void>;
  /** Student: focused minutes that belonged to this plan's lessons. Without it, the review stays quiet about focus. */
  focusMinutes?: number;
  /** Guardian: nudging about missing reports. Without it, no nudge is offered. */
  onNudge?: () => Promise<void>;
  /** Whether today's nudge already went out. */
  nudgeSent?: boolean;
  today?: string;
}) {
  const [nudging, setNudging] = useState(false);
  const progress = planProgress(plan);
  const days = planWeekDays(plan);
  const floating = datelessItems(plan);
  const { missing } = reportStats([plan], reports, today);
  const review = weekReview(plan, reports, today);
  const planReports = reports
    .filter((report) => report.planId === plan.id)
    .sort((a, b) => a.date.localeCompare(b.date));
  const periodEnded = planEnd(plan) < today;
  const periodClosed = !!plan.approvedAt || periodEnded;
  const periodApprovable = canApprovePlanPeriod(plan, reports, acks, today);
  const isWeeklyPlan = plan.cadence === 'week';

  const dayRow = (date: string | null, lessons: PlanItem[]) => {
    const report = date ? reportFor(reports, plan.id, date) : undefined;
    const ack = report ? ackFor(acks, report.id) : undefined;
    const finished = !!date && date < today;
    const rest = date ? isRestDay(plan, date) : false;
    const reportable =
      variant === 'student' &&
      !!date &&
      (finished || date === today) &&
      !rest &&
      lessons.length > 0 &&
      !report &&
      !!onReportDay &&
      (canReportDay ? canReportDay(plan.id, date) : true);
    return (
      <li
        key={date ?? 'any-day'}
        className={cx(
          'week-day-row',
          date === today && 'today',
          finished && !report && lessons.length > 0 && !rest && 'missing',
        )}
      >
        <div className="week-day-head">
          <span className="week-day-name">{date ? formatFullDate(date) : t('Any day')}</span>
          {date === today ? <span className="week-today">{t('Today')}</span> : null}
          {lessons.length > 0 ? (
            <span className="week-day-count">{t('{0} lessons', { 0: lessons.length })}</span>
          ) : null}
          {report ? (
            report.repair ? (
              <span className="week-pill kept">{t('Streak kept')}</span>
            ) : (
              <span className="week-pill reported">{t('Reported')}</span>
            )
          ) : rest && date ? (
            <span className="week-pill rest">{t('Rest day')}</span>
          ) : finished && lessons.length > 0 ? (
            <span className="week-pill missing">{t('Missing')}</span>
          ) : null}
        </div>
        {lessons.length > 0 ? !!date && date < today ? (
          <p className="week-day-performance" aria-label={t('{0} of {1} done', { 0: report?.doneIds.length ?? lessons.filter((item) => item.done).length, 1: lessons.length })}>
            {t('{0} of {1} done', { 0: faNum(report?.doneIds.length ?? lessons.filter((item) => item.done).length), 1: faNum(lessons.length) })}
          </p>
        ) : (
          <ul className="week-lessons">
            {lessons.map((item) => {
              const target =
                date && !item.done && date <= today && !report ? rollTarget(plan, item, reports, today) : null;
              return (
              <li key={item.id} className={cx('week-lesson', item.done && 'done')}>
                {onToggleItem ? (
                  <label>
                    <input
                      type="checkbox"
                      checked={item.done}
                      disabled={canToggleItem ? !canToggleItem(plan.id, item.id) : item.date !== today}
                      onChange={() => onToggleItem(plan.id, item.id)}
                    />
                    <span className="week-lesson-title">{item.title}</span>
                  </label>
                ) : (
                  <span className="week-lesson-read">
                    {item.done ? <CheckIcon size={14} /> : <i className="week-tick-open" aria-hidden="true" />}
                    <span className="week-lesson-title">{item.title}</span>
                  </span>
                )}
                {item.time ? <span className="week-time">{displayTime(item.time)}</span> : null}
                <LessonMeta item={item} />
                {item.url ? (
                  <a
                    className="week-lesson-link"
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <GlobeIcon size={14} />
                    {t('Open link')}
                  </a>
                ) : null}
                {onRollLesson && target ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-tiny week-roll"
                    onClick={() => onRollLesson(plan.id, item.id)}
                  >
                    {t('Move to {0}', { 0: formatWeekdayShort(target) })}
                  </button>
                ) : null}
              </li>
              );
            })}
          </ul>
        ) : (
          <p className="week-empty">{t('No lessons planned.')}</p>
        )}
        {variant === 'student' && report?.note ? <p className="week-report-note">{report.note}</p> : null}
        {variant === 'student' && report && ack ? <AckLine ack={ack} /> : null}
        {reportable ? (
          <button type="button" className="btn btn-ghost btn-small" onClick={() => onReportDay(date)}>
            {t('Report this day')}
          </button>
        ) : null}
        {date && reportingDate === date && onReportDay ? (
          <DayReportForm plan={plan} date={date} lessons={lessons} performanceOnly={date < today} onDone={() => onReportDay(null)} onCancel={() => onReportDay(null)} />
        ) : null}
      </li>
    );
  };

  if (periodClosed) {
    const missingDay = missingReportDays([plan], reports, today)[0];
    const awaitingDailyApprovals = planReports.filter((report) => !ackFor(acks, report.id)?.approvedAt).length;
    return (
      <li className={cx('gplan-card week-plan-card week-period-summary', plan.approvedAt ? 'is-complete' : 'is-incomplete')}>
        <div className="gplan-head">
          <div>
            <p className="gplan-kicker">
              <span className="gplan-cadence gplan-cadence-week">{t('Week plan')}</span>
              {planPeriodLabel(plan, today)}
            </p>
            <p className="gplan-title">{t('Period performance')}</p>
          </div>
        </div>
        <p className="week-period-state">
          {plan.approvedAt
            ? t('Approved by your guardian. This period is closed.')
            : variant === 'student'
              ? isWeeklyPlan
                ? t('This week has ended. It is not finished until your guardian approves it.')
                : t('This period has ended. It is not finished until your guardian approves it.')
              : isWeeklyPlan
                ? t('This week has ended. Review performance and approve it to finish the period.')
                : t('This period has ended. Review performance and approve it to finish.')}
        </p>
        <p className="week-review week-period-metrics">
          <span>{t('{0} of {1} tasks done', { 0: faNum(progress.done), 1: faNum(progress.total) })}</span>
          {review.lessonDays > 0 ? <span>{t('{0} of {1} days reported', { 0: faNum(review.reported), 1: faNum(review.lessonDays) })}</span> : null}
          {review.streak > 0 ? <span>{t('{0}-day streak', { 0: faNum(review.streak) })}</span> : null}
          {typeof focusMinutes === 'number' && focusMinutes > 0 ? <span>{t('{0} focused', { 0: minutesLabel(focusMinutes) })}</span> : null}
        </p>
        <div className="gplan-bar" aria-hidden="true">
          <i style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
        </div>
        {variant === 'student' && !plan.approvedAt && missingDay && onReportDay ? (
          <div className="week-late-report">
            <p>{t('A daily report is still missing. Send the oldest one before marking any other day.')}</p>
            <p>{formatFullDate(missingDay.date)}</p>
            {canReportDay && canReportDay(plan.id, missingDay.date) ? (
              <button type="button" className="btn btn-primary btn-small" onClick={() => onReportDay(missingDay.date)}>
                {t('Report this day')}
              </button>
            ) : null}
            {reportingDate === missingDay.date ? (
              <DayReportForm
                plan={plan}
                date={missingDay.date}
                lessons={itemsForDay(plan, missingDay.date)}
                performanceOnly={missingDay.date < today}
                onDone={() => onReportDay(null)}
                onCancel={() => onReportDay(null)}
              />
            ) : null}
          </div>
        ) : null}
        {variant === 'guardian' && !plan.approvedAt && planReports.length > 0 ? (
          <div className="week-digest week-period-reports">
            <p className="chart-title">{t('Daily report performance')}</p>
            <ul>
              {planReports.map((report) => {
                const total = itemsForDay(plan, report.date).length;
                const ack = ackFor(acks, report.id);
                const approved = !!ack?.approvedAt;
                return (
                  <li key={report.id}>
                    <p className="week-digest-head">
                      <span>{formatFullDate(report.date)}</span>
                      <span>{t('{0} of {1} tasks done', { 0: faNum(report.doneIds.length), 1: faNum(total) })}</span>
                    </p>
                    <p className={cx('week-report-status', approved ? 'is-complete' : 'is-incomplete')}>
                      {approved ? t('Day approved') : t('Awaiting guardian approval')}
                    </p>
                    {!approved && onApproveReport ? <ApproveDayButton report={report} onApprove={onApproveReport} /> : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {variant === 'guardian' && !plan.approvedAt && onApprovePlanPeriod ? (
          <div className="week-period-approval">
            {!periodApprovable ? (
              <p>{missing > 0
                ? t('Approve each daily report first. {0} daily reports are still missing.', { 0: faNum(missing) })
                : awaitingDailyApprovals > 0
                  ? t('Approve each submitted daily report before finishing this week.')
                  : t('This week is waiting for approval.')}</p>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-small"
              disabled={!periodApprovable}
              onClick={() => void onApprovePlanPeriod(plan)}
            >
              {t(isWeeklyPlan ? 'Approve and finish week' : 'Approve and close period')}
            </button>
          </div>
        ) : null}
        <p className="gplan-from">
          {plan.approvedAt ? t('Guardian approved') : t('Performance summary only')}
        </p>
      </li>
    );
  }

  return (
    <li className="gplan-card week-plan-card">
      <div className="gplan-head">
        <div>
          <p className="gplan-kicker">
            <span className="gplan-cadence gplan-cadence-week">{t('Week plan')}</span>
            {planPeriodLabel(plan, today)}
          </p>
          <p className="gplan-title">{plan.title}</p>
        </div>
        {variant === 'student' ? (
          <div className="gplan-progress" aria-label={t('{0} of {1} done', { 0: progress.done, 1: progress.total })}>
            <strong>{faNum(progress.done)}</strong>
            <span>/{faNum(progress.total)}</span>
          </div>
        ) : (
          actions ? <div className="week-card-actions">{actions}</div> : null
        )}
      </div>
      {variant === 'student' && actions ? <div className="week-card-actions week-card-actions-row">{actions}</div> : null}
      {plan.note ? <p className="gplan-note">{plan.note}</p> : null}
      <div className="gplan-bar" aria-hidden="true">
        <i style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
      </div>
      {review.lessonDays > 0 ? (
        <p className="week-review">
          <span>{t('{0} of {1} days reported', { 0: faNum(review.reported), 1: faNum(review.lessonDays) })}</span>
          {review.lessonsTotal > 0 ? (
            <span>{t('{0} of {1} done', { 0: faNum(review.lessonsDone), 1: faNum(review.lessonsTotal) })}</span>
          ) : null}
          {review.streak > 0 ? <span>{t('{0}-day streak', { 0: faNum(review.streak) })}</span> : null}
          {typeof focusMinutes === 'number' && focusMinutes > 0 ? (
            <span>{t('{0} focused', { 0: minutesLabel(focusMinutes) })}</span>
          ) : null}
        </p>
      ) : null}
      {variant === 'guardian' && missing > 0 ? (
        <p className="week-waiting">
          <BellIcon size={14} />
          {tn(missing, 'Waiting on {count} daily report', 'Waiting on {count} daily reports')}
        </p>
      ) : null}
      {variant === 'guardian' && missing > 0 && onNudge ? (
        nudgeSent ? (
          <p className="week-nudged">✓ {t('Nudge sent')}</p>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-small week-nudge-btn"
            disabled={nudging}
            onClick={() => {
              if (nudging) return;
              setNudging(true);
              void onNudge().finally(() => setNudging(false));
            }}
          >
            {t('Send a nudge')}
          </button>
        )
      ) : null}
      <ol className="week-day-list">
        {days.map((date) => dayRow(date, itemsForDay(plan, date)))}
        {floating.length > 0 ? dayRow(null, floating) : null}
      </ol>
      <WeekTimetable plan={plan} reports={reports} hidePast today={today} />
      {variant === 'guardian' && planReports.length > 0 ? (
        <div className="week-digest">
          <p className="chart-title">{t('Daily reports')}</p>
          <ul>
            {planReports.map((report) => {
              const total = itemsForDay(plan, report.date).length;
              const ack = ackFor(acks, report.id);
              const approved = !!ack?.approvedAt;
              return (
                <li key={report.id}>
                  <p className="week-digest-head">
                    <span>{formatFullDate(report.date)}</span>
                    <span>{t('{0} of {1} done', { 0: report.doneIds.length, 1: total })}</span>
                  </p>
                  {report.note ? <p className="week-report-note">{report.note}</p> : null}
                  {ack ? <AckLine ack={ack} /> : null}
                  {!approved && (onAck || onApproveReport) ? (
                    <AckRow
                      report={report}
                      onAck={onAck ?? (async () => undefined)}
                      onApprove={onApproveReport}
                      approved={approved}
                    />
                  ) : null}
                  {onReact ? <ReactionRow ack={ack} onReact={(emoji) => onReact(report, ack, emoji)} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <p className="gplan-from">
        {variant === 'student'
          ? t('From {0}', { 0: plan.author })
          : t('{0} of {1} done', { 0: progress.done, 1: progress.total })}
      </p>
    </li>
  );
}
