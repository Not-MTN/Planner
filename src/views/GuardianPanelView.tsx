/** Guardians receive results, not a live view of a student's private planner. */
import { useEffect, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatEdited } from '../dates';
import {
  BellIcon,
  BookIcon,
  CheckIcon,
  HeartIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
  SparkIcon,
  TrashIcon,
  UserIcon,
} from '../icons';
import { friendlyGroqError, generateGuardianGuidance, type GuardianGuidance } from '../ai';
import { faNum, t } from '../i18n';
import { Field, Empty } from '../components/ui';
import { CompletionRing, FocusTrend, SubjectSplit, SubjectTrend, WeekBars, minutesLabel } from '../components/charts';
import { GuardianGoalForm } from '../components/GuardianGoalForm';
import { InviteQr } from '../components/InviteQr';
import { PraiseComposer } from '../components/PraiseComposer';
import { GuardianPlanComposer } from '../components/GuardianPlanComposer';
import {
  dropGoal,
  dropPlan,
  inviteStudent,
  isInviteExpired,
  markNoticesRead,
  postNotice,
  readNotices,
  refreshResults,
  removeLink,
  syncLinks,
  type Invitation,
} from '../auth/links';
import { goalAnswerOnLink, planPeriodLabel, planProgress, withoutLinkPlan } from '../panels';
import {
  filterGuardianLinks,
  guardianResultStatus,
  guardianStatusLabel,
  type RosterFilter,
  type RosterSort,
} from '../panelFeatures';
import type { GuardianLink, PlanCadence } from '../types';
import '../panels.css';

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
  const [planning, setPlanning] = useState<{ id: string; cadence: PlanCadence } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [goalForm, setGoalForm] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RosterFilter>('all');
  const [sort, setSort] = useState<RosterSort>('name');
  const guardian = panels.guardian;
  const unread = guardian.notices.filter((notice) => !notice.read).length;
  const links = filterGuardianLinks(guardian.links, search, filter, sort);
  const linked = guardian.links.filter((link) => link.status === 'linked').length;
  const current = guardian.links.filter((link) => guardianResultStatus(link) === 'current').length;
  const waiting = guardian.links.filter((link) => ['pending', 'awaiting'].includes(guardianResultStatus(link))).length;

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
          if (expanded === link.id) setExpanded(null);
          if (planning?.id === link.id) setPlanning(null);
          flash(t('Stopped following {0}.', { 0: link.displayName }));
        })().catch((error: unknown) =>
          flash(error instanceof Error ? error.message : t('That link could not be removed.')),
        );
      },
    });

  const openPlanner = (link: GuardianLink, cadence: PlanCadence) => {
    setExpanded(link.id);
    setPlanning({ id: link.id, cadence });
  };
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

  return (
    <div className="view panels-view guardian-panel-view">
      <header className="view-head panel-page-head">
        <div>
          <p className="kicker panel-page-kicker">
            <HeartIcon size={16} />
            {guardian.kind === 'parent' ? t('Parent panel') : t('Advisor panel')}
          </p>
          <h1 className="view-title">{t('The week, as results')}</h1>
          <p className="view-sub">
            {t('You see how the week went, not what was in it. Anything personal to the student stays with them.')}
          </p>
        </div>
        <div className="panel-page-actions">
          <button
            type="button"
            className="btn btn-outline btn-small"
            disabled={refreshing}
            onClick={() => void refreshPanel()}
          >
            {refreshing ? <span className="spinner" aria-hidden="true" /> : null}
            {refreshing ? t('Refreshing…') : t('Refresh results')}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'panels' })}>
            <SlidersIcon size={14} />
            {t('Manage panels')}
          </button>
        </div>
      </header>
      <p className="panel-identity">
        <strong>{guardian.kind === 'parent' ? t('Parent') : t('Advisor')}</strong>
        {guardian.field ? <span>{guardian.field}</span> : null}
      </p>
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

      <section className="card guardian-roster" aria-label={t('Who you follow')}>
        <header className="card-head">
          <div>
            <p className="kicker">{t('Students')}</p>
            <h2 className="card-title">{t('Who you follow')}</h2>
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
                onClick={() => setShowQr((open) => !open)}
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
                  <option value="name">{t('Name')}</option>
                  <option value="updated">{t('Latest update')}</option>
                </select>
              </Field>
            </div>
            <div className="roster-summary">
              <span aria-live="polite">{t('{0} of {1} students', { 0: links.length, 1: guardian.links.length })}</span>
              {lastChecked ? <span>{t('Last checked {0}', { 0: formatEdited(lastChecked) })}</span> : null}
            </div>
          </>
        ) : null}
        {guardian.links.length === 0 ? (
          <Empty title={t('No students yet')} text={t('Add one to start receiving their weekly results.')} />
        ) : links.length === 0 ? (
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
            {links.map((link) => {
              const status = guardianResultStatus(link);
              const isExpanded = expanded === link.id;
              const ready = link.status === 'linked' && !!link.linkId && !!link.wrappedShareKey;
              const ticks = link.plans.reduce(
                (sum, plan) => ({
                  done: sum.done + planProgress(plan).done,
                  total: sum.total + planProgress(plan).total,
                }),
                { done: 0, total: 0 },
              );
              return (
                <li
                  key={link.id}
                  className={cx('student-card', status === 'pending' && 'is-pending', isExpanded && 'is-expanded')}
                >
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
                    <span className={cx('panel-status', `panel-status-${status}`)}>{guardianStatusLabel(status)}</span>
                    {link.results ? <span>{t('Week of {0}', { 0: link.results.weekOf })}</span> : null}
                  </div>
                  {link.results && link.status === 'linked' ? (
                    <>
                      <div className="student-summary-values">
                        <CompletionRing done={link.results.done} planned={link.results.planned} />
                        <div>
                          <p>{t('Done')}</p>
                          <strong>
                            {link.results.done}
                            <small> / {link.results.planned}</small>
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
                      {status === 'pending'
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
                    {link.status === 'pending' && link.code && !isInviteExpired(link.expiresAt) ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-small"
                        onClick={() => {
                          setInvitation({ link, code: link.code!, expiresAt: link.expiresAt ?? null });
                          setCopied(false);
                        }}
                      >
                        {t('Show the code again')}
                      </button>
                    ) : null}
                    {link.status === 'pending' && link.username ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-small"
                        disabled={busy}
                        onClick={() => void resendInvitation(link.id)}
                      >
                        {t('Send a new code')}
                      </button>
                    ) : null}
                    {link.status === 'linked' ? (
                      <button
                        type="button"
                        className="btn btn-outline btn-small"
                        aria-expanded={isExpanded}
                        aria-controls={`student-details-${link.id}`}
                        onClick={() => {
                          setExpanded(isExpanded ? null : link.id);
                          if (isExpanded) setPlanning(null);
                        }}
                      >
                        {isExpanded ? t('Close details') : t('View student')}
                      </button>
                    ) : null}
                  </div>
                  {isExpanded && link.status === 'linked' ? (
                    <div className="student-detail" id={`student-details-${link.id}`}>
                      {status === 'older' ? (
                        <p className="panel-context-note">
                          {t(
                            'These are older results, not a live view. The student can share a fresh snapshot from their panel.',
                          )}
                        </p>
                      ) : null}
                      <div className="student-detail-grid">
                        <section className="student-detail-results" aria-label={t('Weekly results')}>
                          <p className="chart-title">{t('The last weeks')}</p>
                          {link.history.length > 1 ? (
                            <div className="student-charts">
                              <section className="chart-block">
                                <p className="chart-title">{t('Planned against done')}</p>
                                <p className="chart-note">{t('The last {0} weeks.', { 0: link.history.length })}</p>
                                <WeekBars weeks={link.history} />
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
                                <FocusTrend weeks={link.history} />
                              </section>
                            </div>
                          ) : (
                            <p className="chart-empty">
                              {t('Charts appear once there is more than one week to compare.')}
                            </p>
                          )}
                          {link.results?.subjects.length ? (
                            <section className="chart-block">
                              <p className="chart-title">{t('Where the time went')}</p>
                              <SubjectSplit subjects={link.results.subjects} />
                            </section>
                          ) : null}
                          {link.history.some((week) => week.subjects.length > 0) ? (
                            <section className="chart-block">
                              <p className="chart-title">{t('Subject by subject')}</p>
                              <p className="chart-note">{t('Which subjects are being looked after, and which have gone quiet.')}</p>
                              <SubjectTrend weeks={link.history} />
                            </section>
                          ) : null}
                          {!link.results ? (
                            <p className="hint">
                              {t(
                                'You can send a supportive note or a suggested plan before their first results arrive.',
                              )}
                            </p>
                          ) : null}
                        </section>
                        <section className="student-detail-support" aria-label={t('Support this student')}>
                          {link.results ? (
                            <div className="guidance">
                              <div className="guidance-head">
                                <p className="chart-title">{t('What should I ask?')}</p>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-tiny"
                                  disabled={guiding !== null}
                                  onClick={() => void ask(link)}
                                >
                                  {guiding === link.id ? (
                                    <span className="spinner" aria-hidden="true" />
                                  ) : (
                                    <SparkIcon size={13} />
                                  )}
                                  {guidance[link.id] ? t('Ask again') : t('Ask')}
                                </button>
                              </div>
                              {guidance[link.id] ? (
                                <div className="advice">
                                  <p className="advice-summary">{guidance[link.id].summary}</p>
                                  <ul className="guidance-questions">
                                    {guidance[link.id].questions.map((question, index) => (
                                      <li key={index}>
                                        <p>{question}</p>
                                        <button
                                          type="button"
                                          className="text-btn"
                                          onClick={() =>
                                            setNotes((previous) => ({ ...previous, [link.id]: question.slice(0, 160) }))
                                          }
                                        >
                                          {t('Use this question')}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                  {guidance[link.id].encouragement ? (
                                    <p className="advice-watchout">{guidance[link.id].encouragement}</p>
                                  ) : null}
                                </div>
                              ) : (
                                <p className="chart-note">
                                  {t('Questions come from these results only — never from their tasks or notes.')}
                                </p>
                              )}
                            </div>
                          ) : null}
                          <form className="notice-form" onSubmit={(event) => void send(link, event)}>
                            <Field label={t('A note for your student and their guardians')}>
                              <textarea
                                className="input"
                                rows={2}
                                maxLength={160}
                                value={notes[link.id] ?? ''}
                                placeholder={t('What would make this week feel more manageable?')}
                                disabled={!ready || sending === link.id}
                                onChange={(event) =>
                                  setNotes((previous) => ({ ...previous, [link.id]: event.target.value }))
                                }
                              />
                            </Field>
                            <div className="panel-form-actions">
                              <button
                                type="submit"
                                className="btn btn-outline btn-small"
                                disabled={!ready || sending !== null || !(notes[link.id] ?? '').trim()}
                              >
                                {sending === link.id ? <span className="spinner" aria-hidden="true" /> : null}
                                {t('Send note')}
                              </button>
                              <span className="note-character-count">{(notes[link.id] ?? '').length}/160</span>
                            </div>
                          </form>
                          {link.status === 'linked' ? (
                            <div className="praise-block">
                              <PraiseComposer link={link} />
                            </div>
                          ) : null}
                        </section>
                      </div>
                      <section className="gplan-actions">
                        <p className="chart-title">{t('Plan their time')}</p>
                        <p className="chart-note">{t('A day, a week, or a month — it lands in their panel.')}</p>
                        <div className="gplan-picks">
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={!ready}
                            onClick={() => openPlanner(link, 'day')}
                          >
                            {t('A day')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={!ready}
                            onClick={() => openPlanner(link, 'week')}
                          >
                            {t('A week')}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={!ready}
                            onClick={() => openPlanner(link, 'month')}
                          >
                            {t('A month')}
                          </button>
                        </div>
                        {!ready ? (
                          <p className="hint">{t('This link needs to sync before you can send notes or plans.')}</p>
                        ) : null}
                      </section>
                      {planning?.id === link.id ? (
                        <GuardianPlanComposer
                          key={`${link.id}-${planning.cadence}`}
                          link={link}
                          cadence={planning.cadence}
                          onClose={() => setPlanning(null)}
                        />
                      ) : null}
                      <section className="gplan-actions">
                        <p className="chart-title">{t('Goals')}</p>
                        <p className="chart-note">
                          {t('Something bigger than this week. They say yes or not now — only a yes reaches their planner.')}
                        </p>
                        {goalForm === link.id ? null : (
                          <div className="gplan-picks">
                            <button
                              type="button"
                              className="btn btn-ghost btn-small"
                              disabled={!ready}
                              onClick={() => setGoalForm(link.id)}
                            >
                              {t('Suggest a goal')}
                            </button>
                          </div>
                        )}
                        {goalForm === link.id ? (
                          <GuardianGoalForm link={link} onClose={() => setGoalForm(null)} />
                        ) : null}
                        {(link.goals ?? []).length > 0 ? (
                          <ul className="gplan-list">
                            {(link.goals ?? []).map((goal) => {
                              const answer = goalAnswerOnLink(link, goal.id);
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
                                      onClick={() => void withdrawGoal(link, goal.id)}
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
                      </section>
                      {link.plans.length > 0 ? (
                        <section className="gplan-sent">
                          <p className="chart-title">{t('Plans you sent')}</p>
                          <ul className="gplan-list">
                            {link.plans.map((plan) => {
                              const progress = planProgress(plan);
                              const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
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
                                      onClick={() => dropSentPlan(link, plan.id)}
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
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
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
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="panel-trust-line">
        <HeartIcon size={15} />
        {t('Support, not surveillance. Weekly results stay separate from their private planner.')}
      </p>
    </div>
  );
}
