/**
 * The guardian panel, rebuilt around one student at a time.
 *
 * Guardians receive results, not a live view of a student's private planner.
 * The panel is therefore two pages and three tabs:
 *
 *   Students — the attention-first roster: search, filter, invite, and the
 *              shared updates from the whole circle.
 *   one student — a shared summary first, then This week (charts, sent plans),
 *              Plan (build a suggestion and send it), Support (a note, kind
 *              words, questions worth asking, and a goal to aim at).
 *
 * Planning used to be four buttons deep inside a roster card — a day, a week, a
 * month, or a lesson timetable. It is now one tab, with the period chosen inside
 * the plan itself, so the way to plan a student's time is the same path every
 * time.
 */
import { useEffect, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatEdited } from '../dates';
import {
  BellIcon,
  BookIcon,
  CalendarIcon,
  CheckIcon,
  EyeIcon,
  HeartIcon,
  HorizonIcon,
  PencilIcon,
  PlusIcon,
  PrinterIcon,
  SearchIcon,
  SlidersIcon,
  SparkIcon,
  TrashIcon,
  UserIcon,
  WeekIcon,
} from '../icons';
import { friendlyGroqError, generateGuardianGuidance, type GuardianGuidance } from '../ai';
import { advisingHtml, buildAdvisingAgenda } from '../advising';
import { timetableHtml, weekPlanHtml } from '../weekPlanPrint';
import { downloadBlob } from '../download';
import { printDocument } from '../printDocument';
import { todayISO } from '../dates';
import { faNum, t } from '../i18n';
import { Field, Empty } from '../components/ui';
import { PanelTabPanel, PanelTabs, type PanelTab } from '../components/PanelTabs';
import { CompletionRing, FocusTrend, SubjectSplit, SubjectTrend, WeekBars, minutesLabel } from '../components/charts';
import { GuardianGoalForm } from '../components/GuardianGoalForm';
import { InviteQr } from '../components/InviteQr';
import { PraiseComposer } from '../components/PraiseComposer';
import { GuardianPlanComposer } from '../components/GuardianPlanComposer';
import { WeekPlanCard } from '../components/WeekPlanCard';
import { WeekPlanComposer } from '../components/WeekPlanComposer';
import { WeekPlanEditor } from '../components/WeekPlanEditor';
import { PrintPreview, type PrintableDocument } from '../components/PrintPreview';
import { GuardianChangeRequests } from '../components/PlanChangeRequests';
import { GuardianAssignments } from '../components/GuardianAssignments';
import {
  dropGoal,
  dropPlan,
  approvePlanPeriod,
  inviteStudent,
  isInviteExpired,
  markNoticesRead,
  postNotice,
  postNudge,
  readNotices,
  refreshResults,
  removeLink,
  sendAck,
  sendPlan,
  syncLinks,
  type Invitation,
} from '../auth/links';
import {
  goalAnswerOnLink,
  planEnd,
  planPeriodLabel,
  planProgress,
  withLinkAck,
  withLinkPlan,
  withoutLinkPlan,
  withoutQueuedPlan,
} from '../panels';
import { ackFor, editablePlanDays, nudgedToday, toggleReaction } from '../weekPlans';
import {
  filterGuardianLinks,
  guardianNextAction,
  guardianResultStatus,
  guardianStatusLabel,
  type RosterFilter,
  type RosterSort,
} from '../panelFeatures';
import type { DayReport, GuardianLink, GuardianNotice, GuardianPlan, QueuedPlan, ReportAck } from '../types';
import '../panels.css';

type GuardianTab = 'week' | 'plan' | 'assignments' | 'support';
type PlanMode = 'steps' | 'lessons';

const TAB_ID = 'guardian-student';

/**
 * Plain words for when a code stops working. A date means nothing to someone
 * deciding whether to send it now or tonight, so count the days instead.
 */
function inviteExpiryNote(expiresAt: string | null, now = Date.now()): string {
  if (!expiresAt) return t('The code works until they use it.');
  const at = new Date(expiresAt).getTime();
  if (!Number.isFinite(at)) return t('The code works until they use it.');
  const daysLeft = Math.ceil((at - now) / 86_400_000);
  if (daysLeft <= 0) return t('This code has expired. It has to be sent again.');
  if (daysLeft === 1) return t('This code stops working tomorrow.');
  return t('This code stops working in {0} days.', { 0: daysLeft });
}

export function GuardianPanelView() {
  const { panels, updatePanels, flash, navigate, requestConfirm } = usePlanner();
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<GuardianTab>('week');
  const [planMode, setPlanMode] = useState<PlanMode>('steps');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastChecked, setLastChecked] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [draft, setDraft] = useState({ username: '', displayName: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [guidance, setGuidance] = useState<Record<string, GuardianGuidance>>({});
  const [guiding, setGuiding] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState(false);
  const [sendingQueue, setSendingQueue] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [sort, setSort] = useState<RosterSort>('attention');
  // Both hold ids, not the plan itself: a week that has just been changed must
  // be read again from the roster rather than shown from the copy that was open.
  const [preview, setPreview] = useState<{ linkId: string; planId: string } | null>(null);
  const [editingPlan, setEditingPlan] = useState<{ linkId: string; planId: string } | null>(null);
  const guardian = panels.guardian;
  const unread = guardian.notices.filter((notice) => !notice.read).length;
  const rows = filterGuardianLinks(guardian.links, search, filter, sort, todayISO(), guardian.notices);
  const linked = guardian.links.filter((link) => link.status === 'linked').length;
  const current = guardian.links.filter((link) => guardianResultStatus(link) === 'current').length;
  const waiting = guardian.links.filter((link) => ['pending', 'awaiting'].includes(guardianResultStatus(link))).length;
  const attention = guardian.links.filter((link) => ['request', 'unread', 'expired', 'expiring'].includes(guardianNextAction(link, guardian.notices))).length;
  const open = guardian.links.find((link) => link.id === openId) ?? null;

  // Opening a student is the move this panel is built around: the roster is the
  // list, and one student at a time is the page. The three tabs it offers are
  // the three things a guardian actually does — read the week, plan the next
  // one, and say something.
  const openStudent = (link: GuardianLink, nextTab: GuardianTab = 'week', mode: PlanMode = 'steps') => {
    setOpenId(link.id);
    setTab(nextTab);
    setPlanMode(mode);
    setGoalForm(false);
  };

  useEffect(() => {
    if (!panels.guardian.enabled) return;
    let cancelled = false;
    void (async () => {
      const sync = await syncLinks(panels);
      const refreshed = await refreshResults(sync.panels);
      const incoming = await readNotices(refreshed.panels);
      if (cancelled) return;
      if (JSON.stringify(incoming.panels) !== JSON.stringify(panels))
        updatePanels((latest) => (latest === panels ? incoming.panels : latest));
      setLastChecked(new Date().toISOString());
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Link syncing also runs in the provider; this immediate pull is just for opening the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A student who left the roster cannot stay open.
  useEffect(() => {
    if (openId && !guardian.links.some((link) => link.id === openId)) setOpenId(null);
  }, [guardian.links, openId]);

  const addLink = async (event: React.FormEvent) => {
    event.preventDefault();
    const username = draft.username.trim().replace(/^@/, '').toLowerCase();
    if (!username || busy) return;
    if (guardian.links.some((link) => link.username === username)) {
      flash(t('You already follow that student.'));
      return;
    }
    if (guardian.links.length >= 20) {
      flash(t('You can follow up to 20 students.'));
      return;
    }
    setBusy(true);
    try {
      const { invitation: made } = await inviteStudent(panels, username, draft.displayName);
      updatePanels((latest) => ({
        ...latest,
        guardian: { ...latest.guardian, links: [...latest.guardian.links, made.link] },
      }));
      setInvitation(made);
      setCopied(false);
      setShowQr(false);
      setDraft({ username: '', displayName: '' });
      setAdding(false);
      flash(t('Invitation ready. Give the code to your student.'));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That invitation could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  // A code that expired is not a code to re-show. Withdraw the dead one and
  // hand over a fresh one, so there is never a choice of which one to type.
  const resendInvitation = async (linkId: string) => {
    const link = guardian.links.find((item) => item.id === linkId);
    if (!link) return;
    setBusy(true);
    try {
      let latest = panels;
      if (link.linkId) latest = await removeLink(latest, link.linkId);
      latest = {
        ...latest,
        guardian: { ...latest.guardian, links: latest.guardian.links.filter((item) => item.id !== linkId) },
      };
      updatePanels(() => latest);
      const { invitation: made } = await inviteStudent(latest, link.username, link.displayName);
      updatePanels((current) => ({
        ...current,
        guardian: { ...current.guardian, links: [...current.guardian.links.filter((item) => item.id !== made.link.id), made.link] },
      }));
      setInvitation(made);
      setCopied(false);
      setShowQr(false);
      flash(t('A new code is ready for {0}.', { 0: made.link.displayName }));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That invitation could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.code);
      setCopied(true);
    } catch {
      setCopied(false);
      flash(t('Could not copy. Select the code and copy it manually.'));
    }
  };

  const refreshPanel = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const synced = await syncLinks(panels);
      const results = await refreshResults(synced.panels);
      const incoming = await readNotices(results.panels);
      updatePanels((latest) => (latest === panels ? incoming.panels : latest));
      setLastChecked(new Date().toISOString());
      flash(t('Student results refreshed.'));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('Could not refresh student results.'));
    } finally {
      setRefreshing(false);
    }
  };

  const ask = async (link: GuardianLink) => {
    if (!link.results || guiding) return;
    setGuiding(link.id);
    try {
      const result = await generateGuardianGuidance({ results: link.results, history: link.history });
      setGuidance((previous) => ({ ...previous, [link.id]: result }));
    } catch (error) {
      flash(friendlyGroqError(error));
    } finally {
      setGuiding(null);
    }
  };

  /**
   * The agenda for the next meeting, as a page of its own.
   *
   * Printed rather than shown in a modal: it is meant to be in front of two
   * people at a table, and a browser window is how that page gets paper (or a
   * PDF). When pop-ups are blocked the same document is downloaded instead, so
   * the button never looks like it worked while doing nothing.
   */
  const printAgenda = (link: GuardianLink) => {
    const agenda = buildAdvisingAgenda({ student: link.displayName, history: link.history, results: link.results });
    const html = advisingHtml(agenda, {
      madeOn: todayISO(),
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || 'en',
    });
    if (printDocument(html)) return;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `advising-${link.username || link.id}.html`);
  };

  /**
   * The two pages a week plan prints as, built here and shown in the app first.
   * Nothing is opened in a new window until the guardian has seen the page and
   * chosen to print or keep it.
   */
  const planDocuments = (link: GuardianLink, plan: GuardianPlan): PrintableDocument[] => [
    {
      id: 'week',
      label: t('Week plan'),
      filename: `week-plan-${plan.id}.html`,
      html: weekPlanHtml(plan, link.reports ?? [], link.acks ?? [], {
        student: link.displayName,
        madeOn: todayISO(),
        dir: document.documentElement.dir || 'ltr',
        lang: document.documentElement.lang || 'en',
      }),
    },
    {
      id: 'timetable',
      label: t('Timetable'),
      filename: `timetable-${plan.id}.html`,
      html: timetableHtml(plan, link.reports ?? [], {
        student: link.displayName,
        madeOn: todayISO(),
        dir: document.documentElement.dir || 'ltr',
        lang: document.documentElement.lang || 'en',
      }),
    },
  ];

  const ackReport = async (link: GuardianLink, report: DayReport, text: string, approve = false) => {
    if (!link.linkId) return;
    const existing = ackFor(link.acks ?? [], report.id);
    try {
      const next = await sendAck(panels, link.linkId, {
        reportId: report.id,
        planId: report.planId,
        date: report.date,
        text,
        // A reply lands on the reacted answer instead of orphaning its emoji.
        reactions: existing?.reactions ?? [],
        id: existing?.id,
        approve,
      });
      const ack = next.guardian.links.find((item) => item.linkId === link.linkId)?.acks?.find((item) => item.reportId === report.id);
      // Apply only the new answer: slow requests must not replace an edited roster.
      if (ack) updatePanels((current) => withLinkAck(current, link.linkId!, ack));
      if (approve) flash(t('Daily report approved. This day is locked.'));
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : approve ? t('That daily report could not be approved.') : t('That reply could not be sent.'));
    }
  };

  const approveReport = async (link: GuardianLink, report: DayReport) => ackReport(link, report, '', true);

  const approvePeriod = async (link: GuardianLink, plan: GuardianPlan) => {
    if (!link.linkId) return;
    try {
      const next = await approvePlanPeriod(panels, link.linkId, plan.id);
      const approved = next.guardian.links.find((item) => item.linkId === link.linkId)?.plans.find((item) => item.id === plan.id);
      if (approved) updatePanels((current) => withLinkPlan(current, link.linkId!, approved));
      flash(t('Week approved and closed.'));
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('The week could not be approved yet.'));
    }
  };

  const reactReport = async (link: GuardianLink, report: DayReport, ack: ReportAck | undefined, emoji: string) => {
    if (!link.linkId) return;
    try {
      const next = await sendAck(panels, link.linkId, {
        reportId: report.id,
        planId: report.planId,
        date: report.date,
        text: ack?.text ?? '',
        reactions: toggleReaction(ack?.reactions ?? [], emoji),
        id: ack?.id,
      });
      const updated = next.guardian.links.find((item) => item.linkId === link.linkId)?.acks?.[0];
      // Apply only the touched answer: slow requests must not replace an edited roster.
      if (updated) updatePanels((current) => withLinkAck(current, link.linkId!, updated));
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('That reply could not be sent.'));
    }
  };

  const sendQueuedPlan = async (link: GuardianLink, queued: QueuedPlan) => {
    if (!link.linkId || sendingQueue) return;
    setSendingQueue(true);
    try {
      const next = await sendPlan(panels, link.linkId, queued.draft);
      const previousIds = new Set(link.plans.map((plan) => plan.id));
      const sent = next.guardian.links
        .find((item) => item.linkId === link.linkId)
        ?.plans.find((plan) => !previousIds.has(plan.id));
      // Apply only the new plan onto the latest roster, and lift it from the queue.
      updatePanels((current) => {
        const lifted = withoutQueuedPlan(current, queued.id);
        return sent ? withLinkPlan(lifted, link.linkId!, sent) : lifted;
      });
      flash(t('The plan is on its way to {0}.', { 0: link.displayName }));
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('That plan could not be sent.'));
    } finally {
      setSendingQueue(false);
    }
  };

  const nudgeStudent = async (link: GuardianLink) => {
    if (!link.linkId || nudgedToday(guardian.notices, link.username)) return;
    try {
      const next = await postNudge(panels, link.linkId);
      // Adopt only the new notice: slow requests must not replace an edited roster.
      const previousIds = new Set(guardian.notices.map((notice) => notice.id));
      const added = next.guardian.notices.filter((notice) => !previousIds.has(notice.id));
      updatePanels((latest) => ({
        ...latest,
        guardian: {
          ...latest.guardian,
          notices: [
            ...added,
            ...latest.guardian.notices.filter((notice) => !added.some((item) => item.id === notice.id)),
          ].slice(0, 20),
        },
      }));
      flash(t('Nudge sent'));
    } catch (caught) {
      flash(caught instanceof Error ? caught.message : t('That nudge could not be sent.'));
    }
  };

  const send = async (link: GuardianLink, event: React.FormEvent) => {
    event.preventDefault();
    const text = (notes[link.id] ?? '').trim();
    if (!text || !link.linkId || sending) return;
    setSending(link.id);
    try {
      const next = await postNotice(panels, link.linkId, text);
      const previousIds = new Set(guardian.notices.map((notice) => notice.id));
      const added = next.guardian.notices.filter((notice) => !previousIds.has(notice.id));
      updatePanels((latest) => ({
        ...latest,
        guardian: {
          ...latest.guardian,
          notices: [
            ...added,
            ...latest.guardian.notices.filter((notice) => !added.some((item) => item.id === notice.id)),
          ].slice(0, 20),
        },
      }));
      setNotes((previous) => ({ ...previous, [link.id]: '' }));
      flash(t('Sent to {0}. The other guardians receive it after the student syncs.', { 0: link.displayName }));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That note could not be sent.'));
    } finally {
      setSending(null);
    }
  };

  const stopFollowing = (link: GuardianLink) =>
    requestConfirm({
      title: t('Stop following {0}?', { 0: link.displayName }),
      body: t('Their weekly results will no longer appear here. Nothing is deleted from their planner.'),
      confirmLabel: t('Stop following'),
      onConfirm: () => {
        void (async () => {
          if (link.linkId) await removeLink(panels, link.linkId);
          updatePanels((latest) => ({
            ...latest,
            guardian: { ...latest.guardian, links: latest.guardian.links.filter((item) => item.id !== link.id) },
          }));
          flash(t('Stopped following {0}.', { 0: link.displayName }));
        })().catch((error: unknown) =>
          flash(error instanceof Error ? error.message : t('That link could not be removed.')),
        );
      },
    });

  // Taking a suggestion back is not undoing a goal: if they already said yes,
  // the goal they made is theirs and stays. This only stops the asking.
  const withdrawGoal = async (link: GuardianLink, goalId: string) => {
    if (!link.linkId) return;
    try {
      const next = await dropGoal(panels, link.linkId, goalId);
      updatePanels(() => next);
      flash(t('Suggestion taken back.'));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That suggestion could not be taken back.'));
    }
  };

  const dropSentPlan = (link: GuardianLink, planId: string) =>
    requestConfirm({
      title: t('Take this plan back?'),
      body: t('It disappears from their panel the next time they sync. Anything they already ticked stays with them.'),
      confirmLabel: t('Take it back'),
      onConfirm: () => {
        void (async () => {
          if (!link.linkId) return;
          await dropPlan(panels, link.linkId, planId);
          updatePanels((latest) => withoutLinkPlan(latest, link.linkId!, planId));
          flash(t('Plan taken back.'));
        })().catch((error: unknown) =>
          flash(error instanceof Error ? error.message : t('That plan could not be taken back.')),
        );
      },
    });

  // A request notice names its student; the roster knows which link that is,
  // and answering one goes straight to the lesson planner for that student.
  const planAskButton = (notice: GuardianNotice) => {
    const target = guardian.links.find((item) => item.username === notice.student);
    if (!target) return null;
    return (
      <button type="button" className="btn btn-ghost btn-small" onClick={() => openStudent(target, 'plan', 'lessons')}>
        {t('Plan lessons')}
      </button>
    );
  };

  if (!guardian.enabled || !guardian.kind)
    return (
      <div className="view panels-view">
        <Empty
          title={t('The guardian panel is not added')}
          text={t('Your planner is untouched — the panel is simply not on. Add it whenever you want it.')}
          action={
            <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'panels' })}>
              {t('See the panels')}
            </button>
          }
        />
      </div>
    );

  const status = open ? guardianResultStatus(open) : null;
  const ready = !!open && open.status === 'linked' && !!open.linkId && !!open.wrappedShareKey;
  const queued = open ? (guardian.queuedPlans ?? []).filter((entry) => entry.linkId === open.linkId) : [];

  const studentTabs: Array<PanelTab<GuardianTab>> = [
    { id: 'week', label: t('This week'), icon: CalendarIcon },
    { id: 'plan', label: t('Plan'), icon: WeekIcon, dot: queued.length > 0 },
    { id: 'assignments', label: t('Classes'), icon: BookIcon },
    { id: 'support', label: t('Support'), icon: HeartIcon },
  ];

  return (
    <div className="view panels-view guardian-panel-view">
      <header className="view-head panel-page-head">
        <div>
          <p className="kicker panel-page-kicker">
            <HeartIcon size={16} />
            {guardian.kind === 'parent' ? t('Parent panel') : t('Advisor panel')}
          </p>
          <h1 className="view-title">{open ? open.displayName : t('Who needs your attention?')}</h1>
          <p className="view-sub">
            {t('Shared weekly results only. The student chooses what to share.')}
          </p>
        </div>
        <div className="panel-page-actions">
          {open ? (
            <button type="button" className="btn btn-outline btn-small" onClick={() => setOpenId(null)}>
              <UserIcon size={14} />
              {t('All students')}
            </button>
          ) : null}
          <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'home' })}>
            <HorizonIcon size={14} /> {t('Switch panel')}
          </button>
          <details className="guardian-tools">
            <summary className="btn btn-ghost btn-small">{t('More options')}</summary>
            <div className="guardian-tools-menu">
              <button type="button" className="btn btn-outline btn-small" disabled={refreshing} onClick={() => void refreshPanel()}>
                {refreshing ? t('Refreshing…') : t('Refresh results')}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'panels' })}>
                <SlidersIcon size={14} /> {t('Manage panels')}
              </button>
            </div>
          </details>
        </div>
      </header>
      <p className="panel-identity">
        <strong>{guardian.kind === 'parent' ? t('Parent') : t('Advisor')}</strong>
        {guardian.field ? <span>{guardian.field}</span> : null}
        {open ? <span>{guardianStatusLabel(status ?? 'awaiting')}</span> : null}
        {open?.results ? <span>{t('Week of {0}', { 0: open.results.weekOf })}</span> : null}
      </p>

      {!open ? (
        <>
          <section className="card guardian-roster" aria-label={t('Who you follow')}>
            <header className="card-head">
              <div>
                <p className="kicker">{t('Students')}</p>
                <h2 className="card-title">{t('Who you follow')}</h2>
                {attention > 0 ? <p className="guardian-attention-count">{t('{0} need your attention', { 0: faNum(attention) })}</p> : null}
              </div>
              <button
                type="button"
                className="btn btn-soft btn-small"
                aria-expanded={adding}
                onClick={() => setAdding(!adding)}
              >
                <PlusIcon size={14} />
                {t('Student')}
              </button>
            </header>
            {adding ? (
              <form className="panel-form panel-inline-form" onSubmit={(event) => void addLink(event)}>
                <div className="panel-form-grid">
                  <Field label={t('Their username')}>
                    <input
                      className="input"
                      value={draft.username}
                      autoFocus
                      required
                      maxLength={25}
                      placeholder={t('username')}
                      disabled={busy}
                      onChange={(event) => setDraft({ ...draft, username: event.target.value })}
                    />
                  </Field>
                  <Field label={t('Name you’ll see')}>
                    <input
                      className="input"
                      value={draft.displayName}
                      maxLength={60}
                      disabled={busy}
                      onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
                    />
                  </Field>
                </div>
                <div className="panel-form-actions">
                  <button type="submit" className="btn btn-primary btn-small" disabled={!draft.username.trim() || busy}>
                    {busy ? <span className="spinner" aria-hidden="true" /> : null}
                    {t('Add student')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    disabled={busy}
                    onClick={() => setAdding(false)}
                  >
                    {t('Cancel')}
                  </button>
                </div>
                <p className="hint">
                  {t('They choose whether to share. Until they accept, nothing of theirs is shown here.')}
                </p>
              </form>
            ) : null}
            {invitation ? (
              <div className="invite-card" role="status">
                <p className="invite-lead">{t('Give this code to {0}', { 0: invitation.link.displayName })}</p>
                <code className="invite-code" dir="ltr">
                  {invitation.code}
                </code>
                <div className="invite-actions">
                  <button type="button" className="btn btn-outline btn-small" onClick={() => void copyCode()}>
                    {copied ? t('Code copied') : t('Copy code')}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    aria-expanded={showQr}
                    onClick={() => setShowQr((value) => !value)}
                  >
                    {showQr ? t('Hide QR code') : t('Show a QR code')}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setInvitation(null)}>
                    {t('Done')}
                  </button>
                </div>
                {showQr ? <InviteQr code={invitation.code} /> : null}
                <p className="hint">
                  {t(
                    'They type it once in their own panel. After that their weekly results come to you on their own — the code is never stored on our servers.',
                  )}
                </p>
                <p className="hint">{inviteExpiryNote(invitation.expiresAt)}</p>
              </div>
            ) : null}
            {guardian.links.length > 0 ? (
              <>
                <div className="roster-toolbar">
                  <label className="roster-search">
                    <SearchIcon size={16} />
                    <input
                      className="input"
                      type="search"
                      aria-label={t('Search students')}
                      value={search}
                      placeholder={t('Search name or username')}
                      onChange={(event) => setSearch(event.target.value)}
                    />
                  </label>
                  <Field label={t('Results')}>
                    <select
                      className="input"
                      aria-label={t('Filter students')}
                      value={filter}
                      onChange={(event) => setFilter(event.target.value as RosterFilter)}
                    >
                      <option value="all">{t('All students')}</option>
                      <option value="current">{t('Updated this week')}</option>
                      <option value="waiting">{t('Waiting for results')}</option>
                      <option value="older">{t('Older results')}</option>
                    </select>
                  </Field>
                  <Field label={t('Sort')}>
                    <select
                      className="input"
                      aria-label={t('Sort students')}
                      value={sort}
                      onChange={(event) => setSort(event.target.value as RosterSort)}
                    >
                      <option value="attention">{t('Needs attention')}</option>
                      <option value="name">{t('Name')}</option>
                      <option value="updated">{t('Latest update')}</option>
                    </select>
                  </Field>
                </div>
                <div className="roster-summary">
                  <span aria-live="polite">{t('{0} of {1} students', { 0: rows.length, 1: guardian.links.length })}</span>
                  {lastChecked ? <span>{t('Last checked {0}', { 0: formatEdited(lastChecked) })}</span> : null}
                </div>
              </>
            ) : null}
            {guardian.links.length === 0 ? (
              <Empty title={t('No students yet')} text={t('Add one to start receiving their weekly results.')} />
            ) : rows.length === 0 ? (
              <Empty
                title={t('No matching students')}
                text={t('Try a different name or results filter.')}
                action={
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => {
                      setSearch('');
                      setFilter('all');
                    }}
                  >
                    {t('Clear filters')}
                  </button>
                }
              />
            ) : (
              <ul className="student-cards guardian-student-grid">
                {rows.map((link) => {
                  const rowStatus = guardianResultStatus(link);
                  const nextAction = guardianNextAction(link, guardian.notices);
                  const actionLabel = nextAction === 'request' ? t('Plan requested')
                    : nextAction === 'unread' ? t('New shared update')
                    : nextAction === 'expired' ? t('Invitation expired')
                    : nextAction === 'expiring' ? t('Invitation expiring soon')
                    : null;
                  const ticks = link.plans.reduce(
                    (sum, plan) => ({
                      done: sum.done + planProgress(plan).done,
                      total: sum.total + planProgress(plan).total,
                    }),
                    { done: 0, total: 0 },
                  );
                  return (
                    <li key={link.id} className={cx('student-card', rowStatus === 'pending' && 'is-pending')}>
                      <div className="student-card-head">
                        <span className="student-avatar" aria-hidden="true">
                          {link.displayName.trim().charAt(0).toUpperCase() || <HeartIcon size={15} />}
                        </span>
                        <div>
                          <h3 className="student-name">{link.displayName}</h3>
                          <p className="student-user">
                            <bdi>@{link.username}</bdi>
                          </p>
                        </div>
                        <button
                          type="button"
                          className="icon-btn round"
                          aria-label={t('Stop following {0}', { 0: link.displayName })}
                          onClick={() => stopFollowing(link)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      </div>
                      <div className="student-status-line">
                        <span className={cx('panel-status', `panel-status-${rowStatus}`)}>{guardianStatusLabel(rowStatus)}</span>
                        {actionLabel ? <span className="guardian-action-label">{actionLabel}</span> : null}
                        {link.results ? <span>{t('Week of {0}', { 0: link.results.weekOf })}</span> : null}
                      </div>
                      {link.results && link.status === 'linked' ? (
                        <>
                          <div className="student-summary-values">
                            <CompletionRing done={link.results.done} planned={link.results.planned} />
                            <div>
                              <p>{t('Done')}</p>
                              <strong>
                                {faNum(link.results.done)}
                                <small> / {faNum(link.results.planned)}</small>
                              </strong>
                            </div>
                            <div>
                              <p>{t('Focused')}</p>
                              <strong>{minutesLabel(link.results.focusMinutes)}</strong>
                            </div>
                          </div>
                          {link.results.headline ? (
                            <p className="student-headline">“{link.results.headline}”</p>
                          ) : (
                            <p className="student-headline muted">{t('No headline shared this week.')}</p>
                          )}
                          {formatEdited(link.results.updatedAt) ? (
                            <p className="student-week">{t('Updated {0}', { 0: formatEdited(link.results.updatedAt) })}</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="student-pending">
                          {rowStatus === 'pending'
                            ? isInviteExpired(link.expiresAt)
                              ? t('That code expired before they used it. Send a new invitation.')
                              : t('Waiting for them to accept — no results yet.')
                            : t('Linked. Their first results will appear after they share.')}
                        </p>
                      )}
                      {ticks.total > 0 ? (
                        <p className="sent-progress-note">
                          {t('Sent plan progress: {0} of {1} steps done', { 0: ticks.done, 1: ticks.total })}
                        </p>
                      ) : null}
                      <div className="student-card-actions">
                        {link.status === 'pending' ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={busy && (!link.code || nextAction === 'expired')}
                            onClick={() => {
                              if (nextAction === 'expired' || !link.code) void resendInvitation(link.id);
                              else {
                                setInvitation({ link, code: link.code, expiresAt: link.expiresAt ?? null });
                                setCopied(false);
                                setShowQr(false);
                              }
                            }}
                          >
                            {nextAction === 'expired' || !link.code ? t('Send a new code') : t('Show invitation')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            onClick={() => nextAction === 'request' ? openStudent(link, 'plan', 'lessons') : openStudent(link)}
                          >
                            {nextAction === 'request' ? t('Plan lessons') : t('View student')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel-overview" aria-label={t('Your student circle')}>
            <div className="panel-stat">
              <span className="panel-stat-icon">
                <UserIcon size={18} />
              </span>
              <p>{t('Linked students')}</p>
              <strong>{faNum(linked)}</strong>
              <span>{t('Connected with their consent')}</span>
            </div>
            <div className="panel-stat">
              <span className="panel-stat-icon">
                <CheckIcon size={18} />
              </span>
              <p>{t('Updated this week')}</p>
              <strong>{faNum(current)}</strong>
              <span>{t('Weekly results available')}</span>
            </div>
            <div className="panel-stat">
              <span className="panel-stat-icon">
                <BookIcon size={18} />
              </span>
              <p>{t('Waiting for results')}</p>
              <strong>{faNum(waiting)}</strong>
              <span>{t('Invitations or first shares')}</span>
            </div>
            <div className="panel-stat">
              <span className="panel-stat-icon">
                <BellIcon size={18} />
              </span>
              <p>{t('Unread notes')}</p>
              <strong>{faNum(unread)}</strong>
              <span>{t('From your shared circle')}</span>
            </div>
          </section>

          {guardian.notices.length > 0 ? (
            <section className="card notice-card" aria-label={t('Shared updates')}>
              <header className="card-head">
                <div>
                  <p className="kicker">{t('From your shared circle')}</p>
                  <h2 className="card-title">
                    {t('Shared updates')}
                    {unread > 0 ? <span className="badge-count"> {faNum(unread)}</span> : null}
                  </h2>
                </div>
                {unread > 0 ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-tiny"
                    onClick={() => updatePanels((latest) => markNoticesRead(latest))}
                  >
                    {t('Mark all read')}
                  </button>
                ) : null}
              </header>
              <ul className="notice-list">
                {guardian.notices.slice(0, 8).map((notice) => (
                  <li key={notice.id} className={cx('notice', !notice.read && 'unread')}>
                    <div className="notice-body">
                      <p className="notice-text">{notice.summary}</p>
                      <p className="notice-meta">
                        {notice.author} · <bdi>@{notice.student}</bdi>
                        {notice.weekOf ? ` · ${notice.weekOf}` : ''}
                      </p>
                    </div>
                    {notice.kind === 'request' ? planAskButton(notice) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : (
        <>
          <section className="card guardian-student-brief" aria-label={t('Shared weekly summary')}>
            <div className="guardian-brief-top">
              <div>
                <p className="kicker">{t('Shared weekly summary')}</p>
                <h2 className="card-title">{open.displayName}</h2>
                <span className={cx('panel-status', `panel-status-${status}`)}>{guardianStatusLabel(status ?? 'awaiting')}</span>
                {open.results ? (
                  <p className="hint">
                    {t('Week of {0}', { 0: open.results.weekOf })}
                    {formatEdited(open.results.updatedAt) ? ` · ${t('Updated {0}', { 0: formatEdited(open.results.updatedAt) })}` : null}
                  </p>
                ) : <p className="hint">{status === 'pending' ? t('Waiting for them to accept — no results yet.') : t('Linked. Their first results will appear after they share.')}</p>}
              </div>
              <div className="guardian-brief-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={() => setTab('plan')}>{t('Suggest a plan')}</button>
                <button type="button" className="btn btn-outline btn-small" onClick={() => setTab('support')}>{t('Offer support')}</button>
              </div>
            </div>
            {guardian.notices.filter((notice) => notice.student === open.username && !notice.read && notice.kind === 'request').slice(0, 1).map((notice) => (
              <p className="guardian-brief-headline" key={notice.id}>{t('Plan requested')}: {notice.summary}</p>
            ))}
            {open.results && open.status === 'linked' ? (
              <>
                <p className="guardian-brief-headline">{open.results.headline ? `“${open.results.headline}”` : t('No headline shared this week.')}</p>
                <div className="student-summary-values">
                  <CompletionRing done={open.results.done} planned={open.results.planned} />
                  <div><p>{t('Done')}</p><strong>{faNum(open.results.done)}<small> / {faNum(open.results.planned)}</small></strong></div>
                  <div><p>{t('Focused')}</p><strong>{minutesLabel(open.results.focusMinutes)}</strong></div>
                </div>
              </>
            ) : null}
            <p className="hint">{t('Only the results they shared are shown here. Their personal details stay private.')}</p>
          </section>
          <PanelTabs id={TAB_ID} label={open.displayName} tabs={studentTabs} active={tab} onChange={setTab} />

          <PanelTabPanel id={TAB_ID} tab={tab}>
            {/* ------------------------------------------------------ This week */}
            {tab === 'week' ? (
              <>
                {status === 'older' ? (
                  <p className="panel-context-note">
                    {t(
                      'These are older results, not a live view. The student can share a fresh snapshot from their panel.',
                    )}
                  </p>
                ) : null}
                <section className="card student-week-card" aria-label={t('Weekly results')}>
                  <header className="card-head">
                    <div>
                      <p className="kicker">{t('Weekly results')}</p>
                      <h2 className="card-title">
                        {open.results ? t('Week of {0}', { 0: open.results.weekOf }) : t('Awaiting results')}
                      </h2>
                    </div>
                    {open.results && open.status === 'linked' && formatEdited(open.results.updatedAt) ? (
                      <span className="hint">{t('Updated {0}', { 0: formatEdited(open.results.updatedAt) })}</span>
                    ) : null}
                  </header>
                  {open.results && open.status === 'linked' ? (
                    <>
                      <div className="student-charts">
                        {open.history.length > 1 ? (
                          <>
                            <section className="chart-block">
                              <p className="chart-title">{t('Planned against done')}</p>
                              <p className="chart-note">{t('The last {0} weeks.', { 0: open.history.length })}</p>
                              <WeekBars weeks={open.history} />
                              <div className="chart-keys">
                                <span>
                                  <i className="swatch swatch-planned" aria-hidden="true" />
                                  {t('Planned')}
                                </span>
                                <span>
                                  <i className="swatch swatch-done" aria-hidden="true" />
                                  {t('Done')}
                                </span>
                              </div>
                            </section>
                            <section className="chart-block">
                              <p className="chart-title">{t('Focused time')}</p>
                              <FocusTrend weeks={open.history} />
                            </section>
                          </>
                        ) : (
                          <p className="chart-empty">
                            {t('Charts appear once there is more than one week to compare.')}
                          </p>
                        )}
                        {open.results.subjects.length > 0 ? (
                          <section className="chart-block">
                            <p className="chart-title">{t('Where the time went')}</p>
                            <SubjectSplit subjects={open.results.subjects} />
                          </section>
                        ) : null}
                        {open.history.some((entry) => entry.subjects.length > 0) ? (
                          <section className="chart-block">
                            <p className="chart-title">{t('Subject by subject')}</p>
                            <p className="chart-note">{t('Which subjects are being looked after, and which have gone quiet.')}</p>
                            <SubjectTrend weeks={open.history} />
                          </section>
                        ) : null}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="student-pending">
                        {status === 'pending'
                          ? isInviteExpired(open.expiresAt)
                            ? t('That code expired before they used it. Send a new invitation.')
                            : t('Waiting for them to accept — no results yet.')
                          : t('Linked. Their first results will appear after they share.')}
                      </p>
                      <p className="hint">
                        {t('You can send a supportive note or a suggested plan before their first results arrive.')}
                      </p>
                    </>
                  )}
                </section>

                {queued.length > 0 ? (
                  <section className="gplan-sent" aria-label={t('Waiting to send')}>
                    <p className="chart-title">
                      {t('Waiting to send')} ({faNum(queued.length)})
                    </p>
                    <ul className="gplan-list">
                      {queued.map((entry) => (
                        <li key={entry.id} className="gplan-card">
                          <div className="gplan-head">
                            <div>
                              <p className="gplan-kicker">{t('{0} lessons', { 0: entry.draft.items.length })}</p>
                              <p className="gplan-title">{entry.draft.title || t('Plan')}</p>
                            </div>
                          </div>
                          <div className="gplan-picks">
                            <button
                              type="button"
                              className="btn btn-outline btn-small"
                              disabled={sendingQueue}
                              onClick={() => void sendQueuedPlan(open, entry)}
                            >
                              {t('Send now')}
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              onClick={() => updatePanels((current) => withoutQueuedPlan(current, entry.id))}
                            >
                              {t('Cancel')}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {/* An ask from the student comes first: it is waiting on this
                    guardian, and the week beside it may be about to change. */}
                <GuardianChangeRequests link={open} />

                {open.plans.length > 0 ? (
                  <section className="gplan-sent" aria-label={t('Plans you sent')}>
                    <p className="chart-title">{t('Plans you sent')}</p>
                    <ul className="gplan-list">
                      {open.plans.map((plan) => {
                        const progress = planProgress(plan);
                        const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
                        if (plan.cadence === 'week') {
                          return (
                            <WeekPlanCard
                              key={plan.id}
                              plan={plan}
                              reports={open.reports ?? []}
                              variant="guardian"
                              acks={open.acks ?? []}
                              onAck={(report, text) => ackReport(open, report, text)}
                              onApproveReport={(report) => approveReport(open, report)}
                              onApprovePlanPeriod={(plan) => approvePeriod(open, plan)}
                              onReact={(report, ack, emoji) => reactReport(open, report, ack, emoji)}
                              onNudge={() => nudgeStudent(open)}
                              nudgeSent={nudgedToday(guardian.notices, open.username)}
                              actions={
                                <>
                                  {!plan.approvedAt && editablePlanDays(plan).length > 0 ? (
                                    <button
                                      type="button"
                                      className="btn btn-ghost btn-tiny"
                                      onClick={() => setEditingPlan({ linkId: open.id, planId: plan.id })}
                                    >
                                      <PencilIcon size={14} />
                                      {t('Change plan')}
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className="icon-btn round"
                                    aria-label={`${t('Preview and print')} · ${plan.title}`}
                                    title={t('Preview and print')}
                                    onClick={() => setPreview({ linkId: open.id, planId: plan.id })}
                                  >
                                    <EyeIcon size={14} />
                                  </button>
                                  <button
                                    type="button"
                                    className="icon-btn round"
                                    aria-label={t('Take back {0}', { 0: plan.title })}
                                    onClick={() => dropSentPlan(open, plan.id)}
                                  >
                                    <TrashIcon size={14} />
                                  </button>
                                </>
                              }
                            />
                          );
                        }
                        const periodClosed = !!plan.approvedAt || planEnd(plan) < todayISO();
                        if (periodClosed) {
                          return (
                            <li key={plan.id} className={cx('gplan-card week-period-summary', progress.done === progress.total && progress.total > 0 ? 'is-complete' : 'is-incomplete')}>
                              <div className="gplan-head">
                                <div>
                                  <p className="gplan-kicker">{planPeriodLabel(plan)}</p>
                                  <p className="gplan-title">{t('Period performance')}</p>
                                </div>
                                <div className="gplan-progress" aria-label={t('{0} of {1} done', { 0: progress.done, 1: progress.total })}>
                                  <strong>{faNum(progress.done)}</strong>
                                  <span>/{faNum(progress.total)}</span>
                                </div>
                              </div>
                              <p className="week-period-state">{plan.approvedAt ? t('Approved by your guardian. This period is closed.') : t('This period has ended. Performance summary only.')}</p>
                              <div className="gplan-bar" aria-hidden="true"><i style={{ width: `${percent}%` }} /></div>
                            </li>
                          );
                        }
                        return (
                          <li key={plan.id} className="gplan-card">
                            <div className="gplan-head">
                              <div>
                                <p className="gplan-kicker">{planPeriodLabel(plan)}</p>
                                <p className="gplan-title">{plan.title}</p>
                              </div>
                              <button
                                type="button"
                                className="icon-btn round"
                                aria-label={t('Take back {0}', { 0: plan.title })}
                                onClick={() => dropSentPlan(open, plan.id)}
                              >
                                <TrashIcon size={14} />
                              </button>
                            </div>
                            {plan.note ? <p className="gplan-note">{plan.note}</p> : null}
                            <div
                              className="gplan-bar"
                              role="progressbar"
                              aria-label={t('Progress for {0}', { 0: plan.title })}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={percent}
                            >
                              <i style={{ width: `${percent}%` }} />
                            </div>
                            <p className="gplan-from">
                              {t('{0} of {1} done', { 0: progress.done, 1: progress.total })}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
              </>
            ) : null}

            {/* ----------------------------------------------------------- Plan */}
            {tab === 'plan' ? (
              <section className="card plan-tab-card" aria-label={t('Plan for {0}', { 0: open.displayName })}>
                <header className="card-head">
                  <div>
                    <p className="kicker">{t('Plan')}</p>
                    <h2 className="card-title">{t('Plan their time')}</h2>
                  </div>
                  <div className="segmented plan-mode-switch" role="group" aria-label={t('Plan')}>
                    <button
                      type="button"
                      className={cx('segment', planMode === 'steps' && 'on')}
                      aria-pressed={planMode === 'steps'}
                      onClick={() => setPlanMode('steps')}
                    >
                      {t('Steps')}
                    </button>
                    <button
                      type="button"
                      className={cx('segment', planMode === 'lessons' && 'on')}
                      aria-pressed={planMode === 'lessons'}
                      onClick={() => setPlanMode('lessons')}
                    >
                      {t('Plan lessons')}
                    </button>
                  </div>
                </header>
                <p className="view-sub">
                  {planMode === 'lessons'
                    ? t('They can share daily reports when ready. A missing report never blocks their panel.')
                    : t('Sent as a suggestion in their panel. It does not change their personal tasks or calendar.')}
                </p>
                {!ready ? (
                  <p className="hint">{t('This link needs to sync before you can send notes or plans.')}</p>
                ) : planMode === 'lessons' ? (
                  <WeekPlanComposer key={`${open.id}-lessons`} link={open} onClose={() => setTab('week')} />
                ) : (
                  <GuardianPlanComposer key={`${open.id}-steps`} link={open} cadence="week" onClose={() => setTab('week')} />
                )}
              </section>
            ) : null}

            {tab === 'assignments' ? <GuardianAssignments key={`${open.id}-assignments`} link={open} /> : null}

            {/* -------------------------------------------------------- Support */}
            {tab === 'support' ? (
              <>
                <section className="card support-card" aria-label={t('Support this student')}>
                  <header className="card-head">
                    <div>
                      <p className="kicker">{t('Support this student')}</p>
                      <h2 className="card-title">{t('A note, and words that help')}</h2>
                    </div>
                  </header>

                  {open.results ? (
                    <div className="guidance">
                      <div className="guidance-head">
                        <p className="chart-title">{t('What should I ask?')}</p>
                        <button
                          type="button"
                          className="btn btn-ghost btn-tiny"
                          disabled={guiding !== null}
                          onClick={() => void ask(open)}
                        >
                          {guiding === open.id ? <span className="spinner" aria-hidden="true" /> : <SparkIcon size={13} />}
                          {guidance[open.id] ? t('Ask again') : t('Ask')}
                        </button>
                        <button type="button" className="btn btn-ghost btn-tiny" onClick={() => printAgenda(open)}>
                          <PrinterIcon size={13} /> {t('Meeting one-pager')}
                        </button>
                      </div>
                      {guidance[open.id] ? (
                        <div className="advice">
                          <p className="advice-summary">{guidance[open.id].summary}</p>
                          <ul className="guidance-questions">
                            {guidance[open.id].questions.map((question, index) => (
                              <li key={index}>
                                <p>{question}</p>
                                <button
                                  type="button"
                                  className="text-btn"
                                  onClick={() => setNotes((previous) => ({ ...previous, [open.id]: question.slice(0, 160) }))}
                                >
                                  {t('Use this question')}
                                </button>
                              </li>
                            ))}
                          </ul>
                          {guidance[open.id].encouragement ? (
                            <p className="advice-watchout">{guidance[open.id].encouragement}</p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="chart-note">
                          {t('Questions come from these results only — never from their tasks or notes.')}
                        </p>
                      )}
                    </div>
                  ) : null}

                  <form className="notice-form" onSubmit={(event) => void send(open, event)}>
                    <Field label={t('A note for your student and their guardians')}>
                      <textarea
                        className="input"
                        rows={2}
                        maxLength={160}
                        value={notes[open.id] ?? ''}
                        placeholder={t('What would make this week feel more manageable?')}
                        disabled={!ready || sending === open.id}
                        onChange={(event) =>
                          setNotes((previous) => ({ ...previous, [open.id]: event.target.value }))
                        }
                      />
                    </Field>
                    <div className="panel-form-actions">
                      <button
                        type="submit"
                        className="btn btn-primary btn-small"
                        disabled={!ready || sending !== null || !(notes[open.id] ?? '').trim()}
                      >
                        {sending === open.id ? <span className="spinner" aria-hidden="true" /> : null}
                        {t('Send note')}
                      </button>
                      <span className="note-character-count">{faNum((notes[open.id] ?? '').length)}/160</span>
                    </div>
                  </form>

                  {open.status === 'linked' ? (
                    <div className="praise-block">
                      <PraiseComposer link={open} />
                    </div>
                  ) : null}

                  <div className="support-goals">
                    <p className="chart-title">{t('Goals')}</p>
                    <p className="chart-note">
                      {t('Something bigger than this week. They say yes or not now — only a yes reaches their planner.')}
                    </p>
                    {goalForm ? null : (
                      <div className="gplan-picks">
                        <button
                          type="button"
                          className="btn btn-soft btn-small"
                          disabled={!ready}
                          onClick={() => setGoalForm(true)}
                        >
                          {t('Suggest a goal')}
                        </button>
                      </div>
                    )}
                    {goalForm ? <GuardianGoalForm link={open} onClose={() => setGoalForm(false)} /> : null}
                    {(open.goals ?? []).length > 0 ? (
                      <ul className="gplan-list">
                        {(open.goals ?? []).map((goal) => {
                          const answer = goalAnswerOnLink(open, goal.id);
                          const percent = answer && answer.total > 0 ? Math.round((answer.done / answer.total) * 100) : 0;
                          return (
                            <li key={goal.id} className="gplan-card">
                              <div className="gplan-head">
                                <div>
                                  <p className="gplan-kicker">
                                    {goal.target ? t('Aiming for {0}', { 0: goal.target }) : t('Suggested goal')}
                                  </p>
                                  <p className="gplan-title">{goal.title}</p>
                                </div>
                                <button
                                  type="button"
                                  className="icon-btn round"
                                  aria-label={t('Take back {0}', { 0: goal.title })}
                                  onClick={() => void withdrawGoal(open, goal.id)}
                                >
                                  <TrashIcon size={14} />
                                </button>
                              </div>
                              {goal.note ? <p className="gplan-note">{goal.note}</p> : null}
                              {goal.steps.length > 0 ? (
                                <ol className="ggoal-step-list">
                                  {goal.steps.map((step, index) => (
                                    <li key={index}>{step}</li>
                                  ))}
                                </ol>
                              ) : null}
                              {answer?.state === 'accepted' ? (
                                <>
                                  <div
                                    className="gplan-bar"
                                    role="progressbar"
                                    aria-label={t('Progress for {0}', { 0: goal.title })}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={percent}
                                  >
                                    <i style={{ width: `${percent}%` }} />
                                  </div>
                                  <p className="gplan-from">
                                    {answer.total > 0
                                      ? t('They took it on. {0} of {1} steps done.', { 0: answer.done, 1: answer.total })
                                      : t('They took it on.')}
                                  </p>
                                </>
                              ) : answer?.state === 'declined' ? (
                                <p className="gplan-from">{t('They said not now.')}</p>
                              ) : (
                                <p className="gplan-from">{t('Waiting for their answer.')}</p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                </section>
              </>
            ) : null}
          </PanelTabPanel>
        </>
      )}

      <p className="panel-trust-line">
        <HeartIcon size={15} />
        {t('Support, not surveillance. Weekly results stay separate from their private planner.')}
      </p>

      {(() => {
        const link = guardian.links.find((item) => item.id === preview?.linkId) ?? null;
        const plan = link?.plans.find((item) => item.id === preview?.planId) ?? null;
        if (!link || !plan) return null;
        return (
          <PrintPreview
            title={plan.title}
            documents={planDocuments(link, plan)}
            onClose={() => setPreview(null)}
          />
        );
      })()}

      {(() => {
        const link = guardian.links.find((item) => item.id === editingPlan?.linkId) ?? null;
        const plan = link?.plans.find((item) => item.id === editingPlan?.planId) ?? null;
        if (!link || !plan) return null;
        return <WeekPlanEditor link={link} plan={plan} onClose={() => setEditingPlan(null)} />;
      })()}
    </div>
  );
}
