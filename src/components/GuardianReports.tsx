/**
 * A student's daily reports, gathered in one place rather than repeated inside
 * every plan card. Newest weeks come first; each week can be opened when needed.
 */
import { useState } from 'react';
import { cx } from '../cx';
import { formatFullDate, formatWeekRange, startOfWeek } from '../dates';
import { faNum, t, tn } from '../i18n';
import { ACK_REACTIONS } from '../types';
import type { DayReport, GuardianLink, GuardianPlan, ReportAck } from '../types';
import { ackFor, itemsForDay, lessonTimeLabel } from '../weekPlans';
import { Empty } from './ui';

interface ReportEntry {
  report: DayReport;
  plan?: GuardianPlan;
  ack?: ReportAck;
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

function ReportContents({ report, plan }: { report: DayReport; plan?: GuardianPlan }) {
  const lessons = plan ? itemsForDay(plan, report.date) : [];
  const done = new Set(report.doneIds);

  return (
    <div className="week-report-contents">
      {report.repair ? <p className="week-report-repair">↺ {t('Streak repair — this day is kept, not marked done.')}</p> : null}
      {plan ? (
        lessons.length > 0 ? (
          <ul className="week-report-lessons">
            {lessons.map((lesson) => {
              const finished = done.has(lesson.id);
              return (
                <li key={lesson.id} className={finished ? 'is-done' : 'is-open'}>
                  <span aria-hidden="true">{finished ? '✓' : '○'}</span>
                  <span className="week-lesson-title">{lesson.title}</span>
                  {lesson.time ? <span className="week-report-time">{lessonTimeLabel(lesson)}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="hint">{t('No planned lessons that day.')}</p>
        )
      ) : (
        <p className="hint">{t('Plan details for this report are no longer available.')}</p>
      )}
      {report.note ? <blockquote className="week-report-quote">“{report.note}”</blockquote> : null}
    </div>
  );
}

function AckRow({
  report,
  onAck,
  onApprove,
}: {
  report: DayReport;
  onAck: (report: DayReport, text: string) => Promise<void>;
  onApprove: (report: DayReport) => Promise<void>;
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
      <button type="button" className="btn btn-ghost btn-tiny" disabled={sending} onClick={() => void send('')}>
        {t('Seen')}
      </button>
      <input
        className="input"
        value={text}
        maxLength={140}
        disabled={sending}
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
      <button type="button" className="btn btn-ghost btn-tiny" disabled={sending || !text.trim()} onClick={() => void send(text)}>
        {t('Reply')}
      </button>
      <button
        type="button"
        className="btn btn-primary btn-tiny"
        disabled={sending}
        onClick={() => {
          if (sending) return;
          setSending(true);
          void onApprove(report).finally(() => setSending(false));
        }}
      >
        {sending ? <span className="spinner" aria-hidden="true" /> : null}
        {sending ? t('Approving…') : t('Approve day')}
      </button>
    </div>
  );
}

function ReactionRow({
  report,
  ack,
  onReact,
}: {
  report: DayReport;
  ack?: ReportAck;
  onReact: (report: DayReport, ack: ReportAck | undefined, emoji: string) => Promise<void>;
}) {
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
            void onReact(report, ack, emoji).finally(() => setSending(false));
          }}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReportCard({
  entry,
  canRespond,
  onAck,
  onApprove,
  onReact,
}: {
  entry: ReportEntry;
  canRespond: boolean;
  onAck: (report: DayReport, text: string) => Promise<void>;
  onApprove: (report: DayReport) => Promise<void>;
  onReact: (report: DayReport, ack: ReportAck | undefined, emoji: string) => Promise<void>;
}) {
  const { report, plan, ack } = entry;
  const approved = !!ack?.approvedAt;
  const lessons = plan ? itemsForDay(plan, report.date) : [];
  const doneIds = new Set(report.doneIds);
  const doneCount = plan ? lessons.filter((lesson) => doneIds.has(lesson.id)).length : report.doneIds.length;

  return (
    <li className="guardian-report-card">
      <header className="guardian-report-card-head">
        <div className="guardian-report-heading">
          <p className="guardian-report-date">{formatFullDate(report.date)}</p>
          {plan ? <p className="guardian-report-plan">{plan.title}</p> : null}
        </div>
        <span className={cx('week-report-status', approved ? 'is-complete' : 'is-incomplete')}>
          {approved ? t('Day approved') : t('Awaiting guardian approval')}
        </span>
      </header>
      {plan ? (
        <p className="week-digest-head">
          <span>{t('{0} of {1} tasks done', { 0: faNum(doneCount), 1: faNum(lessons.length) })}</span>
        </p>
      ) : null}
      <ReportContents report={report} plan={plan} />
      {ack ? <AckLine ack={ack} /> : null}
      {canRespond && !approved ? <AckRow report={report} onAck={onAck} onApprove={onApprove} /> : null}
      {canRespond ? <ReactionRow report={report} ack={ack} onReact={onReact} /> : null}
    </li>
  );
}

function ReportWeek({
  week,
  entries,
  initiallyOpen,
  canRespond,
  onAck,
  onApprove,
  onReact,
}: {
  week: string;
  entries: ReportEntry[];
  initiallyOpen: boolean;
  canRespond: boolean;
  onAck: (report: DayReport, text: string) => Promise<void>;
  onApprove: (report: DayReport) => Promise<void>;
  onReact: (report: DayReport, ack: ReportAck | undefined, emoji: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);

  return (
    <section className="guardian-report-week">
      <button
        type="button"
        className="guardian-report-week-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="guardian-report-week-title">{formatWeekRange(week)}</span>
        <span className="guardian-report-week-count">{tn(entries.length, '{count} report', '{count} reports')}</span>
        <span className="guardian-report-week-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
      </button>
      {expanded ? (
        <ul className="guardian-report-list">
          {entries.map((entry) => (
            <ReportCard
              key={entry.report.id}
              entry={entry}
              canRespond={canRespond}
              onAck={onAck}
              onApprove={onApprove}
              onReact={onReact}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type ReportFilter = 'all' | 'needs-review' | 'approved';

export function GuardianReports({
  link,
  canRespond,
  onAck,
  onApprove,
  onReact,
}: {
  link: GuardianLink;
  canRespond: boolean;
  onAck: (report: DayReport, text: string) => Promise<void>;
  onApprove: (report: DayReport) => Promise<void>;
  onReact: (report: DayReport, ack: ReportAck | undefined, emoji: string) => Promise<void>;
}) {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const plans = new Map(link.plans.map((plan) => [plan.id, plan]));
  const entries: ReportEntry[] = (link.reports ?? [])
    .map((report) => ({
      report,
      plan: plans.get(report.planId),
      ack: ackFor(link.acks ?? [], report.id),
    }))
    .sort((a, b) => b.report.date.localeCompare(a.report.date) || b.report.createdAt.localeCompare(a.report.createdAt));
  const approvedCount = entries.filter((entry) => !!entry.ack?.approvedAt).length;
  const needsReviewCount = entries.length - approvedCount;
  const visible = entries.filter((entry) =>
    filter === 'all' ? true : filter === 'approved' ? !!entry.ack?.approvedAt : !entry.ack?.approvedAt,
  );
  const groups = new Map<string, ReportEntry[]>();
  for (const entry of visible) {
    const week = startOfWeek(entry.report.date);
    groups.set(week, [...(groups.get(week) ?? []), entry]);
  }
  const filters = [
    { id: 'all', label: t('All'), count: entries.length },
    { id: 'needs-review', label: t('Needs review'), count: needsReviewCount },
    { id: 'approved', label: t('Approved'), count: approvedCount },
  ] as const;

  return (
    <section className="card guardian-reports" aria-label={t('Daily reports')}>
      <header className="card-head">
        <div>
          <p className="kicker">{t('Reports')}</p>
          <h2 className="card-title">{t('Daily reports')}</h2>
        </div>
        <span className="guardian-reports-total" aria-label={t('Daily reports')}>
          {faNum(entries.length)}
        </span>
      </header>
      <p className="view-sub guardian-reports-intro">
        {t('Daily reports are grouped by week. Read, reply to, or approve each report here.')}
      </p>
      <div className="segmented guardian-reports-filter" role="group" aria-label={t('Filter reports')}>
        {filters.map(({ id, label, count }) => (
          <button
            key={id}
            type="button"
            className={cx('segment', filter === id && 'on')}
            aria-label={t(label)}
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
          >
            {t(label)} <span className="guardian-reports-filter-count" aria-hidden="true">{faNum(count)}</span>
          </button>
        ))}
      </div>
      {entries.length === 0 ? (
        <Empty
          title={t('No daily reports yet')}
          text={t('When {0} shares a daily report, it will appear here.', { 0: link.displayName })}
        />
      ) : visible.length === 0 ? (
        <Empty
          title={t('No reports match this filter')}
          text={t('Choose another filter to see this student’s reports.')}
        />
      ) : (
        <div className="guardian-report-weeks">
          {[...groups.entries()].map(([week, groupedEntries], index) => (
            <ReportWeek
              key={week}
              week={week}
              entries={groupedEntries}
              initiallyOpen={index === 0}
              canRespond={canRespond}
              onAck={onAck}
              onApprove={onApprove}
              onReact={onReact}
            />
          ))}
        </div>
      )}
    </section>
  );
}
