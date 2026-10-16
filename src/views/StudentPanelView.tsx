/**
 * The student panel: four tabs, one job each.
 *
 *   Today    — the streak, what is left to do, and the button that starts the
 *              next session. Everything motivational lives here.
 *   This week— how the week actually went: results, charts, notes, and the
 *              headline that gets shared.
 *   Subjects — the tracked subjects with their exam dates and weekly targets.
 *   Sharing  — who receives the weekly results, and exactly what they receive.
 *
 * Guardians receive totals and the student's chosen headline. Reasons and older
 * explanations stay private in this planner, and nothing here changes anything
 * the personal planner keeps.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import {
  BookIcon,
  CalendarIcon,
  CheckIcon,
  FlagIcon,
  FlameIcon,
  HeartIcon,
  HorizonIcon,
  PrinterIcon,
  SlidersIcon,
  SparkIcon,
  StopwatchIcon,
  StudyIcon,
  SunIcon,
  TrashIcon,
} from '../icons';
import { faNum, t, tn } from '../i18n';
import {
  GRADE_LABELS,
  focusMinutesOn,
  gradeLabel,
  markInboxRead,
  newId,
  openGoalSuggestions,
  planEnd,
  planPeriodLabel,
  planProgress,
  previousWeekFocus,
  splitExplanations,
  studyStreak,
  subjectMinutes,
  weeklyHistory,
  weeklyTargetMinutes,
  weekOf,
  weekResults,
  withExplanation,
  withPlanItemToggled,
  withoutExplanation,
  studentCanDeletePlan,
  withoutStudentPlan,
} from '../panels';
import { completionDate } from '../insights';
import { CompletionRing, FocusTrend, SubjectSplit, SubjectTrend, WeekBars, minutesLabel } from '../components/charts';
import { normalizeLinkCode } from '../auth/crypto';
import { friendlyGroqError, generateStudentAdvice, type StudentAdvice } from '../ai';
import { acceptInvitation, answerGoalSuggestion, forgetPraise, removeLink, shareWeeklyResults, syncLinks, syncStudentInbox } from '../auth/links';
import { AuthError } from '../auth/session';
import { PLAN_REQUESTS_KEPT } from '../types';
import type { ChangeNote, DayReport, GoalSuggestion, GuardianPlan, StudentSubject } from '../types';
import { Field, Empty } from '../components/ui';
import { PanelTabPanel, PanelTabs, type PanelTab } from '../components/PanelTabs';
import { StudentWorkspace, SubjectTracker } from '../components/StudentWorkspace';
import { StudentLearningHub } from '../components/StudentLearningHub';
import { upcomingExams } from '../panelFeatures';
import {
  canSubmitDayReport,
  missingReportDays,
  openRequests,
  planFocusMinutes,
  repairUsed,
  rollTarget,
  studentCanTogglePlanItem,
  withDayReport,
  withLessonRolled,
} from '../weekPlans';
import { timetableHtml, weekPlanHtml } from '../weekPlanPrint';
import { downloadBlob } from '../download';
import { printDocument } from '../printDocument';
import { formatFullDate, formatWeekRange, todayISO } from '../dates';
import { DayReportForm } from '../components/DayReportForm';
import { StreakRepairForm } from '../components/StreakRepairForm';
import { WeekPlanCard } from '../components/WeekPlanCard';
import '../panels.css';

type StudentTab = 'today' | 'week' | 'subjects' | 'classes' | 'sharing';

const TAB_ID = 'student-panel';

export function StudentPanelView() {
  const { state, panels, updatePanels, addGoal, flash, navigate, setPanelEnabled, requestConfirm, route, startFocus } = usePlanner();
  const [tab, setTab] = useState<StudentTab>('today');
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ field: panels.student.field ?? '', grade: panels.student.grade ?? '' });
  const [code, setCode] = useState('');
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<StudentAdvice | null>(null);
  const [asking, setAsking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const [reporting, setReporting] = useState<{ planId: string; date: string } | null>(null);
  const [askNote, setAskNote] = useState('');
  const [askSending, setAskSending] = useState(false);
  const [repairingLock, setRepairingLock] = useState<string | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [studyPrefill, setStudyPrefill] = useState<StudentSubject | null>(null);
  const openAsks = useMemo(() => openRequests(panels.student.requests ?? [], todayISO()), [panels.student.requests]);

  // Keep in step with the server: a guardian may have ended the link, or sent
  // something new. Notes left by one guardian are passed to the others here —
  // only this planner holds every link's key, so it is the only one that can.
  useEffect(() => {
    let cancelled = false;
    void syncLinks(panels)
      .then((result) => (cancelled ? null : syncStudentInbox(result.panels, state.goals)))
      .then((inbox) => {
        if (cancelled || !inbox) return;
        if (JSON.stringify(inbox.panels) !== JSON.stringify(panels)) updatePanels((current) => current === panels ? inbox.panels : current);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async () => {
    if (asking) return;
    setAsking(true);
    try {
      setAdvice(await generateStudentAdvice({ state }));
    } catch (error) {
      flash(friendlyGroqError(error));
    } finally {
      setAsking(false);
    }
  };

  /**
   * Someone who scanned a QR code has already said, by scanning, that they
   * want this link. So their code is filled in rather than typed, and the panel
   * opens on the tab where accepting it happens. Saying yes still takes a
   * press: linking hands a guardian their weekly results for as long as the
   * link lasts, and that is not something to do on arrival.
   */
  useEffect(() => {
    if (route.name !== 'panels' || !route.invite) return;
    setCode(route.invite);
    setScanned(true);
    setTab('sharing');
    // The address stays as it arrived until there is an answer, and that is
    // deliberate: it is the only place the code lives. A route change remounts
    // this view by design (Shell's `view-enter` key), so a copy kept here would
    // be lost the moment the panel is switched on — and a reload in the middle
    // of deciding, which is exactly when someone would reload, would lose it
    // too. Accepting rewrites the address to a plain #/student from here.
  }, [route]);

  const accept = async () => {
    if (busy) return;
    if (!normalizeLinkCode(code)) {
      flash(t("That code is not right. It looks like plnr-XXXX-XXXX-XXXX."));
      return;
    }
    setBusy(true);
    try {
      const next = await acceptInvitation(panels, code);
      const added = next.student.guardians.filter((guardian) => !panels.student.guardians.some((previous) => previous.linkId === guardian.linkId));
      updatePanels((latest) => ({ ...latest, student: { ...latest.student, guardians: [...latest.student.guardians, ...added.filter((guardian) => !latest.student.guardians.some((previous) => previous.linkId === guardian.linkId))] } }));
      setCode('');
      setScanned(false);
      // Send this week straight away so their panel is not empty.
      const shared = await shareWeeklyResults(state, next, true);
      updatePanels((latest) => ({ ...latest, student: { ...latest.student, guardians: latest.student.guardians.map((guardian) => {
        const sent = shared.panels.student.guardians.find((item) => item.linkId === guardian.linkId);
        return sent ? { ...guardian, sharedWeek: sent.sharedWeek } : guardian;
      }) } }));
      flash(t("Linked. Your weekly results now reach {0}.", { 0: added[0]?.guardianDisplayName ?? next.student.guardians.at(-1)?.guardianDisplayName ?? '' }));
      // The code has been used, so it comes out of the address with it: the
      // panel page is the same panel, addressed plainly.
      navigate({ name: 'student' });
    } catch (error) {
      flash(error instanceof AuthError || error instanceof Error ? error.message : t("That code could not be used."));
    } finally {
      setBusy(false);
    }
  };

  // Saying yes makes an ordinary goal out of the suggestion — same code path as
  // any goal they type themselves, so it can be edited, ticked and undone the
  // same way. The suggestion's id becomes the goal's id, so a double tap on a
  // slow panel cannot make two.
  const takeOnGoal = async (suggestion: GoalSuggestion) => {
    if (answering) return;
    setAnswering(suggestion.id);
    try {
      if (!state.goals.some((goal) => goal.id === suggestion.id)) {
        addGoal(
          {
            title: suggestion.title,
            description: suggestion.note,
            horizon: 'long',
            deadline: suggestion.target,
            milestones: suggestion.steps.map((title) => ({ title, dueDate: null })),
            fromSuggestion: { linkId: suggestion.linkId, suggestionId: suggestion.id },
          },
          suggestion.id,
        );
      }
      updatePanels((latest) => answerGoalSuggestion(latest, suggestion, 'accepted'));
      flash(t("Added to your goals."));
    } catch (error) {
      flash(error instanceof Error ? error.message : t("That goal could not be added."));
    } finally {
      setAnswering(null);
    }
  };

  // Not now is an answer, not a silence: it goes back, so the question stops
  // being asked.
  const refuseGoal = async (suggestion: GoalSuggestion) => {
    if (answering) return;
    setAnswering(suggestion.id);
    try {
      updatePanels((latest) => answerGoalSuggestion(latest, suggestion, 'declined'));
      flash(t("They will see that this is not the right time."));
    } finally {
      setAnswering(null);
    }
  };

  const shareNow = async () => {
    if (sharing || panels.student.guardians.length === 0) return;
    setSharing(true);
    try {
      const shared = await shareWeeklyResults(state, panels, true);
      updatePanels((latest) => ({ ...latest, student: { ...latest.student, guardians: latest.student.guardians.map((guardian) => {
        const sent = shared.panels.student.guardians.find((item) => item.linkId === guardian.linkId);
        return sent ? { ...guardian, sharedWeek: sent.sharedWeek } : guardian;
      }) } }));
      flash(shared.sent > 0 ? t("This week’s results were shared with your guardians.") : t("No linked guardians were available to receive the results."));
    } catch (error) {
      flash(error instanceof Error ? error.message : t("This week’s results could not be shared."));
    } finally {
      setSharing(false);
    }
  };

  const stopSharing = (guardian: { linkId: string; guardianDisplayName: string }) => {
    requestConfirm({
      title: t("Stop sharing with {0}?", { 0: guardian.guardianDisplayName }),
      body: t("They keep the results they already have; nothing new is sent, and nothing is deleted from your planner."),
      confirmLabel: t("Stop sharing"),
      onConfirm: () => {
        void removeLink(panels, guardian.linkId).then(() => {
          updatePanels((latest) => ({ ...latest, student: { ...latest.student, guardians: latest.student.guardians.filter((item) => item.linkId !== guardian.linkId) } }));
          flash(t("Stopped sharing with {0}.", { 0: guardian.guardianDisplayName }));
        });
      },
    });
  };
  const week = weekOf(todayISO());
  const results = useMemo(() => weekResults(state, week), [state, week]);
  const { current, past } = useMemo(() => splitExplanations(panels.student.explanations, week), [panels.student.explanations, week]);
  const history = useMemo(() => weeklyHistory(state, 6, week), [state, week]);
  const inbox = panels.student.inbox;
  const openGoals = openGoalSuggestions(panels);
  const unreadInbox = inbox.notices.filter((notice) => !notice.read).length;
  // A report is a request, never a condition for using the student panel.
  const missingDays = useMemo(
    () => missingReportDays(inbox.plans, panels.student.reports ?? [], todayISO()),
    [inbox.plans, panels.student.reports],
  );

  const printTimetable = (plan: GuardianPlan) => {
    const html = timetableHtml(plan, panels.student.reports ?? [], {
      student: plan.author,
      side: 'student',
      madeOn: todayISO(),
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || 'en',
    });
    if (printDocument(html)) return;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `timetable-${plan.id}.html`);
  };

  const printWeekPlan = (plan: GuardianPlan) => {
    const html = weekPlanHtml(plan, panels.student.reports ?? [], panels.student.acks ?? [], {
      student: plan.author,
      madeOn: todayISO(),
      dir: document.documentElement.dir || 'ltr',
      lang: document.documentElement.lang || 'en',
      side: 'student',
    });
    if (printDocument(html)) return;
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `week-plan-${plan.id}.html`);
  };

  const askForPlan = async (changeNote?: string, linkId?: string) => {
    if (askSending) return;
    const targets = panels.student.guardians.filter((guardian) => guardian.linkId && (!linkId || guardian.linkId === linkId));
    if (targets.length === 0) return;
    setAskSending(true);
    const now = new Date().toISOString();
    const note = (changeNote ?? askNote).trim().slice(0, 140);
    const next = {
      ...panels,
      student: {
        ...panels.student,
        requests: [
          ...targets.map((guardian) => ({ id: newId('request'), linkId: guardian.linkId, note, createdAt: now })),
          ...(panels.student.requests ?? []),
        ].slice(0, PLAN_REQUESTS_KEPT),
      },
    };
    updatePanels(() => next);
    setAskNote('');
    try {
      const synced = await syncStudentInbox(next, state.goals);
      updatePanels((latest) => (latest === next ? synced.panels : latest));
      flash(t('Plan requested — waiting for your guardian.'));
    } catch {
      flash(t('Saved — it will send on the next sync.'));
    } finally {
      setAskSending(false);
    }
  };

  const cancelAsk = () => {
    updatePanels((latest) => ({ ...latest, student: { ...latest.student, requests: [] } }));
  };

  const rollLessonOn = (planId: string, itemId: string) => {
    const plan = panels.student.inbox.plans.find((item) => item.id === planId);
    if (!plan) return;
    const rolled = plan.items.find((item) => item.id === itemId);
    if (!rolled || !rollTarget(plan, rolled, panels.student.reports ?? [], todayISO())) return;
    updatePanels((latest) => withLessonRolled(latest, planId, itemId, todayISO()));
  };

  const repairDay = async (planId: string, date: string, reason: string) => {
    const plan = panels.student.inbox.plans.find((item) => item.id === planId);
    if (!plan || repairUsed(panels.student.reports ?? [], planId)) return;
    const now = new Date().toISOString();
    const report: DayReport = {
      id: newId('report'),
      planId,
      linkId: plan.linkId,
      date,
      doneIds: [],
      note: reason.trim().slice(0, 140),
      repair: true,
      createdAt: now,
      updatedAt: now,
    };
    const wasMissing = missingReportDays(panels.student.inbox.plans, panels.student.reports ?? [], todayISO()).length;
    const next = withDayReport(panels, report);
    const cleared =
      wasMissing > 0 &&
      missingReportDays(next.student.inbox.plans, next.student.reports ?? [], todayISO()).length === 0;
    updatePanels(() => next);
    // Filed the moment it is saved; the sync only carries the reason over.
    try {
      const synced = await syncStudentInbox(next, state.goals);
      updatePanels((latest) => (latest === next ? synced.panels : latest));
      flash(cleared ? t('All caught up — thanks for checking in.') : t('Streak kept.'));
    } catch {
      flash(cleared ? t('All caught up — thanks for checking in.') : t('Saved — it will send on the next sync.'));
    }
  };

  const [noteDraft, setNoteDraft] = useState({ summary: '', reason: '' });
  const subjects = panels.student.subjects;
  const exams = upcomingExams(subjects);
  const targets = subjects.filter((subject) => (subject.targetMinutes ?? 0) > 0);
  const targetsReached = targets.filter((subject) => subjectMinutes(state, subject, week) >= subject.targetMinutes!).length;

  /* ---------------------------------------------------------- momentum */

  const today = todayISO();
  const streak = useMemo(() => studyStreak(state, today), [state, today]);
  const doneToday = useMemo(
    () => state.tasks.filter((task) => task.completed && completionDate(task) === today).length,
    [state.tasks, today],
  );
  const lastWeekFocus = useMemo(() => previousWeekFocus(state, week), [state, week]);
  const weekTarget = weeklyTargetMinutes(panels);
  const targetPercent = weekTarget > 0 ? Math.min(100, Math.round((results.focusMinutes / weekTarget) * 100)) : 0;
  const focusToday = focusMinutesOn(state, today);
  const encouragement =
    streak >= 7
      ? t('Seven days of showing up. That is the hard part done.')
      : streak >= 3
        ? t('You have kept this going. One session at a time.')
        : results.focusMinutes > 0
          ? t('Short sessions add up. Start another when you are ready.')
          : t('Every streak starts with one session. Yours can start today.');
  const nextExam = exams[0];

  const addNote = () => {
    const summary = noteDraft.summary.trim();
    if (!summary) return;
    const note: ChangeNote = {
      id: newId('why'),
      createdAt: new Date().toISOString(),
      weekOf: week,
      summary: summary.slice(0, 140),
      reason: noteDraft.reason.trim().slice(0, 400),
    };
    updatePanels((latest) => withExplanation(latest, note));
    setNoteDraft({ summary: '', reason: '' });
    flash(t("Saved. Only the headline is included in shared results."));
  };

  const tabs: Array<PanelTab<StudentTab>> = [
    { id: 'today', label: t('Today'), icon: SunIcon },
    {
      id: 'week',
      label: t('This week'),
      icon: CalendarIcon,
      count: unreadInbox + openGoals.length,
    },
    { id: 'subjects', label: t('Subjects'), icon: BookIcon },
    { id: 'classes', label: t('Classes'), icon: StudyIcon, count: (panels.student.inbox.classes ?? []).length + (panels.student.inbox.homework ?? []).length },
    { id: 'sharing', label: t('Sharing'), icon: HeartIcon },
  ];

  // Someone bookmarked the panel, or turned it off on another device.
  if (!panels.student.enabled) {
    return (
      <div className="view panels-view student-panel-view">
        <Empty
          title={t("The student panel is not added")}
          // Someone arriving from a scanned invite has already chosen this
          // panel; the code is held while they switch it on, so say so instead
          // of offering the same blank welcome as a stray bookmark.
          text={
            scanned
              ? t("Add the student panel, then press Link to accept the code you scanned.")
              : t("Your planner is untouched — the panel is simply not on. Add it whenever you want it.")
          }
          action={
            <button type="button" className="btn btn-primary btn-small" onClick={() => setPanelEnabled('student', true)}>
              {t("Add student panel")}
            </button>
          }
        />
      </div>
    );
  }

  const weekPlans = inbox.plans.filter((plan) => plan.cadence === 'week');
  const shortPlans = inbox.plans.filter((plan) => plan.cadence !== 'week');
  const currentGuardianLinkIds = panels.student.guardians.map((guardian) => guardian.linkId);
  const canDeletePlan = (plan: GuardianPlan) => studentCanDeletePlan(plan, currentGuardianLinkIds);
  const deletePlan = (plan: GuardianPlan) => {
    if (!canDeletePlan(plan)) return;
    updatePanels((latest) => withoutStudentPlan(latest, plan.id));
    flash(t('Plan deleted.'));
  };

  return (
    <div className="view panels-view student-panel-view">
      <header className="view-head panel-page-head">
        <div>
          <p className="kicker panel-page-kicker"><StudyIcon size={16} />{t("Student panel")}<span>{formatWeekRange(week)}</span></p>
          <h1 className="view-title">{t("This week, and what’s coming")}</h1>
          <p className="view-sub">
            {t("Subjects, exams and this week’s focus")}
          </p>
        </div>
        <div className="panel-page-actions">
          <button type="button" className="btn btn-outline btn-small" aria-expanded={editing} onClick={() => {
            setDetails({ field: panels.student.field ?? '', grade: panels.student.grade ?? '' });
            setEditing((value) => !value);
          }}>{editing ? t("Cancel") : t("Change details")}</button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'home' })}><HorizonIcon size={14} />{t("Switch panel")}</button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'panels' })}><SlidersIcon size={14} />{t("Manage panels")}</button>
        </div>
      </header>

      {editing ? (
        <section className="card">
          <header className="card-head">
            <div>
              <p className="kicker">{t("Your details")}</p>
              <h2 className="card-title">{t("What do you study?")}</h2>
            </div>
          </header>
          <div className="panel-form">
            <Field label={t("What do you study?")}>
              <input
                className="input"
                value={details.field}
                onChange={(event) => setDetails({ ...details, field: event.target.value })}
              />
            </Field>
            <Field label={t("Where are you in it?")}>
              <select className="input" value={details.grade} onChange={(event) => setDetails({ ...details, grade: event.target.value })}>
                <option value="">—</option>
                {GRADE_LABELS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {gradeLabel(option.id)}
                  </option>
                ))}
              </select>
            </Field>
            <div className="panel-form-actions">
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={!details.field.trim() || !details.grade}
                onClick={() => {
                  updatePanels((latest) => ({
                    ...latest,
                    student: { ...latest.student, field: details.field.trim(), grade: details.grade },
                  }));
                  setEditing(false);
                  flash(t("Details saved."));
                }}
              >
                {t("Save details")}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <p className="panel-identity">
          <strong>{panels.student.field || t("No field set")}</strong>
          {panels.student.grade ? <span>{gradeLabel(panels.student.grade)}</span> : null}
        </p>
      )}

      {missingDays.length > 0 ? (
        <section className="card week-report-reminder" aria-label={t('Daily reports to send')}>
          <div className="week-report-reminder-head">
            <div>
              <h2 className="card-title">{t('Daily reports to send')} · {faNum(missingDays.length)}</h2>
              <p className="view-sub">{t('You can keep using your panel. Share these days when you are ready.')}</p>
            </div>
            <button type="button" className="btn btn-outline btn-small" aria-expanded={reportsOpen} onClick={() => setReportsOpen((open) => !open)}>
              {reportsOpen ? t('Hide reports') : t('Review reports')}
            </button>
          </div>
          {reportsOpen ? (
            <div className="week-report-reminder-days">
              {missingDays.map((day) => (
                <section key={`${day.plan.id}-${day.date}`} className="card" aria-label={`${day.plan.title} · ${formatFullDate(day.date)}`}>
                  <header className="card-head">
                    <div>
                      <p className="kicker">{day.plan.title}</p>
                      <h2 className="card-title">{formatFullDate(day.date)}</h2>
                    </div>
                  </header>
                  <DayReportForm plan={day.plan} date={day.date} lessons={day.lessons} performanceOnly={day.date < todayISO()} onDone={() => undefined} />
                  {!repairUsed(panels.student.reports ?? [], day.plan.id) && repairingLock !== `${day.plan.id}-${day.date}` ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={() => setRepairingLock(`${day.plan.id}-${day.date}`)}
                    >
                      {t('Keep my streak')}
                    </button>
                  ) : null}
                  {repairingLock === `${day.plan.id}-${day.date}` ? (
                    <StreakRepairForm
                      onSave={(reason) => repairDay(day.plan.id, day.date, reason).then(() => setRepairingLock(null))}
                      onCancel={() => setRepairingLock(null)}
                    />
                  ) : null}
                </section>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <PanelTabs id={TAB_ID} label={t('Student panel')} tabs={tabs} active={tab} onChange={setTab} />

      <PanelTabPanel id={TAB_ID} tab={tab}>
        {/* ------------------------------------------------------------ Today */}
        {tab === 'today' ? (
          <>
            <section className="card momentum-card" aria-label={t('Your momentum')}>
              <div className="momentum-head">
                <span className="momentum-flame" aria-hidden="true">
                  <FlameIcon size={20} />
                </span>
                <div className="momentum-copy">
                  <p className="kicker">{t('Your momentum')}</p>
                  <p className="momentum-streak">
                    {streak > 0
                      ? tn(streak, '{count} day in a row', '{count} days in a row')
                      : t('Today is a fresh start')}
                  </p>
                  <p className="momentum-note">{encouragement}</p>
                </div>
                <button
                  type="button"
                  className="btn btn-primary btn-small momentum-start"
                  onClick={() => startFocus({ taskId: null, title: t('Focus session'), minutes: 25 })}
                >
                  <StopwatchIcon size={15} />
                  {t('Start a focus session')}
                </button>
              </div>
              <div className="momentum-stats">
                <div className="momentum-stat">
                  <span>{t('Focused this week')}</span>
                  <strong>{minutesLabel(results.focusMinutes)}</strong>
                  {lastWeekFocus > 0 ? (
                    <em className={cx('momentum-delta', results.focusMinutes >= lastWeekFocus && 'up')}>
                      {results.focusMinutes >= lastWeekFocus ? t('More than last week') : t('Less than last week')}
                    </em>
                  ) : null}
                </div>
                <div className="momentum-stat">
                  <span>{t('Done today')}</span>
                  <strong>{faNum(doneToday)}</strong>
                  <em className="momentum-delta">{focusToday > 0 ? t('Focused {0} today', { 0: minutesLabel(focusToday) }) : t('Nothing focused yet')}</em>
                </div>
                <div className="momentum-stat">
                  <span>{t('Next exam')}</span>
                  <strong>
                    {nextExam
                      ? nextExam.days === 0
                        ? t('Today')
                        : t('{0} days', { 0: faNum(nextExam.days) })
                      : '—'}
                  </strong>
                  <em className="momentum-delta">{nextExam ? nextExam.subject.name : t('No upcoming exams')}</em>
                </div>
              </div>
              {weekTarget > 0 ? (
                <div
                  className="momentum-bar"
                  role="progressbar"
                  aria-label={t('Weekly focus target')}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={targetPercent}
                >
                  <span style={{ width: `${targetPercent}%` }} />
                </div>
              ) : null}
            </section>

            {panels.student.guardians.length > 0 && (panels.student.praise ?? []).length > 0 ? (
              <section className="card praise-card" aria-label={t("Kind words")}>
                <header className="card-head">
                  <div>
                    <p className="kicker">{t("Kind words")}</p>
                    <h2 className="card-title">{t("What they said to you")}</h2>
                  </div>
                </header>
                <p className="praise-lead">{t("Kept here until you let them go. Not tasks — just what someone noticed.")}</p>
                <ul className="praise-list">
                  {(panels.student.praise ?? []).slice(0, 4).map((praise) => (
                    <li key={praise.id} className="praise-item">
                      <p className="praise-text">“{praise.summary}”</p>
                      <p className="praise-meta">
                        {praise.author}
                        {praise.weekOf ? ` · ${t("Week of {0}", { 0: praise.weekOf })}` : ''}
                      </p>
                      <button
                        type="button"
                        className="icon-btn round"
                        aria-label={t("Let go of these words")}
                        onClick={() => updatePanels((latest) => forgetPraise(latest, praise.id))}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section className="panel-overview" aria-label={t("This week")}>
              <div className="panel-stat"><span className="panel-stat-icon"><CheckIcon size={18} /></span><p>{t("Done")}</p><strong>{faNum(results.done)}<small> / {faNum(results.planned)}</small></strong><span>{t("Whole planner this week")}</span></div>
              <div className="panel-stat"><span className="panel-stat-icon"><StopwatchIcon size={18} /></span><p>{t("Focused")}</p><strong>{minutesLabel(results.focusMinutes)}</strong><span>{t("Every focus session counts")}</span></div>
              <div className="panel-stat"><span className="panel-stat-icon"><StudyIcon size={18} /></span><p>{t("Study targets")}</p><strong>{targets.length ? <>{faNum(targetsReached)}<small> / {faNum(targets.length)}</small></> : '—'}</strong><span>{targets.length ? t("Weekly targets reached") : t("Set a weekly target below")}</span></div>
              <div className="panel-stat"><span className="panel-stat-icon"><FlagIcon size={18} /></span><p>{t("Next exam")}</p><strong>{exams[0] ? exams[0].days === 0 ? t("Today") : t("{0} days", { 0: exams[0].days }) : '—'}</strong><span>{exams[0]?.subject.name ?? t("No upcoming exams")}</span></div>
            </section>

            {panels.student.guardians.length > 0 ? (
              <section className="card student-plans-card" aria-label={t('From your guardians')}>
                <header className="card-head">
                  <div>
                    <p className="kicker">{t('From your guardians')}</p>
                    <h2 className="card-title">{t('Your plan, day by day')}</h2>
                  </div>
                </header>
                <div className="week-ask-row">
                  {openAsks.length > 0 ? (
                    <>
                      <p className="hint">{t('Plan requested — waiting for your guardian.')}</p>
                      <button type="button" className="btn btn-ghost btn-tiny" onClick={cancelAsk}>
                        {t('Cancel')}
                      </button>
                    </>
                  ) : (
                    <>
                      <input
                        className="input"
                        value={askNote}
                        maxLength={140}
                        placeholder={t('A note to go with it')}
                        aria-label={t('A note to go with it')}
                        onChange={(event) => setAskNote(event.target.value)}
                      />
                      <button
                        type="button"
                        className="btn btn-ghost btn-small"
                        disabled={askSending}
                        onClick={() => void askForPlan()}
                      >
                        {t('Ask for a plan')}
                      </button>
                    </>
                  )}
                </div>

                {weekPlans.length === 0 && shortPlans.length === 0 ? (
                  <p className="empty-note">
                    {t("Nothing yet. When a parent or advisor plans your week, suggests a goal, or leaves a note, it shows up here.")}
                  </p>
                ) : null}

                {weekPlans.length > 0 ? <p className="hint">{t('A suggested plan. You can move unfinished lessons or ask for changes.')}</p> : null}
                {missingDays.length > 0 ? (
                  <p className="week-missing-alert" role="status">
                    {t('Daily report missed for {0}. Send the oldest report first; other days stay locked until you catch up.', { 0: formatFullDate(missingDays[0]!.date) })}
                  </p>
                ) : null}
                {weekPlans.map((plan) => (
                  <WeekPlanCard
                    key={plan.id}
                    plan={plan}
                    reports={panels.student.reports ?? []}
                    acks={panels.student.acks ?? []}
                    variant="student"
                    focusMinutes={planFocusMinutes(plan, state.focusLog, state.tasks)}
                    onToggleItem={(planId, itemId) => updatePanels((latest) => withPlanItemToggled(latest, planId, itemId))}
                    canToggleItem={(planId, itemId) => studentCanTogglePlanItem(panels, planId, itemId)}
                    onRollLesson={missingDays.length === 0 ? rollLessonOn : undefined}
                    canReportDay={(planId, date) => canSubmitDayReport(panels, planId, date)}
                    reportingDate={reporting?.planId === plan.id ? reporting.date : null}
                    onReportDay={(date) => setReporting(date ? { planId: plan.id, date } : null)}
                    actions={
                      <>
                        {openAsks.length === 0 && panels.student.guardians.some((guardian) => guardian.linkId === plan.linkId) ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={askSending}
                            onClick={() => void askForPlan(t('Could we adjust the plan for {0}?', { 0: plan.title }), plan.linkId)}
                          >
                            {t('Request a change')}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="icon-btn round"
                          aria-label={`${t('Print')} · ${plan.title}`}
                          onClick={() => printWeekPlan(plan)}
                        >
                          <PrinterIcon size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn round"
                          aria-label={`${t('Print timetable')} · ${plan.title}`}
                          onClick={() => printTimetable(plan)}
                        >
                          <CalendarIcon size={14} />
                        </button>
                        {canDeletePlan(plan) ? (
                          <button type="button" className="icon-btn round" aria-label={`${t('Delete plan')} · ${plan.title}`} onClick={() => deletePlan(plan)}>
                            <TrashIcon size={14} />
                          </button>
                        ) : null}
                      </>
                    }
                  />
                ))}

                {shortPlans.length > 0 ? (
                  <ul className="gplan-list">
                    {shortPlans.map((plan) => {
                      const progress = planProgress(plan);
                      const periodClosed = !!plan.approvedAt || planEnd(plan) < todayISO();
                      if (periodClosed) {
                        return (
                          <li key={plan.id} className={cx('gplan-card week-period-summary', plan.approvedAt || (progress.total > 0 && progress.done === progress.total) ? 'is-complete' : 'is-incomplete')}>
                            <div className="gplan-head">
                              <div>
                                <p className="gplan-kicker">
                                  <span className={cx('gplan-cadence', `gplan-cadence-${plan.cadence}`)}>
                                    {plan.cadence === 'day' ? t('Day plan') : t('Month plan')}
                                  </span>
                                  {planPeriodLabel(plan)}
                                </p>
                                <p className="gplan-title">{t('Period performance')}</p>
                              </div>
                              <div className="gplan-progress" aria-label={t('{0} of {1} done', { 0: progress.done, 1: progress.total })}>
                                <strong>{faNum(progress.done)}</strong>
                                <span>/{faNum(progress.total)}</span>
                              </div>
                            </div>
                            <p className="week-period-state">{plan.approvedAt ? t('Approved by your guardian. This period is closed.') : t('This period has ended. Performance summary only.')}</p>
                            {canDeletePlan(plan) ? <button type="button" className="btn btn-ghost btn-small" onClick={() => deletePlan(plan)}><TrashIcon size={14} />{t('Delete plan')}</button> : null}
                            <div className="gplan-bar" aria-hidden="true">
                              <i style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                            </div>
                          </li>
                        );
                      }
                      return (
                        <li key={plan.id} className="gplan-card">
                          <div className="gplan-head">
                            <div>
                              <p className="gplan-kicker">
                                <span className={cx('gplan-cadence', `gplan-cadence-${plan.cadence}`)}>
                                  {plan.cadence === 'day' ? t("Day plan") : t("Month plan")}
                                </span>
                                {planPeriodLabel(plan)}
                              </p>
                              <p className="gplan-title">{plan.title}</p>
                            </div>
                            <div className="gplan-progress" aria-label={t("{0} of {1} done", { 0: progress.done, 1: progress.total })}>
                              <strong>{faNum(progress.done)}</strong>
                              <span>/{faNum(progress.total)}</span>
                            </div>
                          </div>
                          {plan.note ? <p className="gplan-note">{plan.note}</p> : null}
                          <div className="gplan-bar" aria-hidden="true">
                            <i style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} />
                          </div>
                          {plan.items.length > 0 ? (
                            <ul className="gplan-items">
                              {plan.items.map((item) => (
                                <li key={item.id} className={cx('gplan-item', item.done && 'done')}>
                                  <label>
                                    <input
                                      type="checkbox"
                                      checked={item.done}
                                      disabled={!studentCanTogglePlanItem(panels, plan.id, item.id)}
                                      onChange={() => updatePanels((latest) => withPlanItemToggled(latest, plan.id, item.id))}
                                    />
                                    <span className="gplan-item-title">{item.title}</span>
                                  </label>
                                  <span className="gplan-item-meta">
                                    {item.subject ? <span>{item.subject}</span> : null}
                                    {item.minutes ? <span>{minutesLabel(item.minutes)}</span> : null}
                                    {item.date ? <span>{item.date.slice(5)}</span> : null}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                          <p className="gplan-from">{t("From {0}", { 0: plan.author })}</p>
                          {canDeletePlan(plan) ? <button type="button" className="btn btn-ghost btn-small" onClick={() => deletePlan(plan)}><TrashIcon size={14} />{t('Delete plan')}</button> : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </section>
            ) : null}

            <StudentWorkspace prefillSubject={studyPrefill} onPrefillHandled={() => setStudyPrefill(null)} />
          </>
        ) : null}

        {/* -------------------------------------------------------- This week */}
        {tab === 'week' ? (
          <>
            <section className="card" aria-label={t("Tracking")}>
              <header className="card-head">
                <div>
                  <p className="kicker">{t("Tracking")}</p>
                  <h2 className="card-title">{t("The last weeks")}</h2>
                </div>
              </header>
              <div className="student-charts">
                <section className="chart-block">
                  <p className="chart-title">{t("This week at a glance")}</p>
                  <div className="result-row">
                    <CompletionRing done={results.done} planned={results.planned} />
                    <div className="result-stack">
                      <div className="result">
                        <p className="kicker">{t("Focused")}</p>
                        <p className="result-num">{minutesLabel(results.focusMinutes)}</p>
                      </div>
                      <div className="result">
                        <p className="kicker">{t("Peak week")}</p>
                        <p className="result-num">{minutesLabel(Math.max(0, ...history.map((entry) => entry.focusMinutes)))}</p>
                      </div>
                    </div>
                  </div>
                </section>
                {history.length > 1 ? (
                  <>
                    <section className="chart-block">
                      <p className="chart-title">{t("Planned against done")}</p>
                      <p className="chart-note">{t("The last {0} weeks.", { 0: history.length })}</p>
                      <WeekBars weeks={history} />
                      <div className="chart-keys">
                        <span>
                          <i className="swatch swatch-planned" aria-hidden="true" />
                          {t("Planned")}
                        </span>
                        <span>
                          <i className="swatch swatch-done" aria-hidden="true" />
                          {t("Done")}
                        </span>
                      </div>
                    </section>
                    <section className="chart-block">
                      <p className="chart-title">{t("Focused time")}</p>
                      <FocusTrend weeks={history} />
                    </section>
                  </>
                ) : (
                  <p className="chart-empty">{t("Charts appear once there is more than one week to compare.")}</p>
                )}
                {results.subjects.length > 0 ? (
                  <section className="chart-block">
                    <p className="chart-title">{t("Where the time went")}</p>
                    <SubjectSplit subjects={results.subjects} />
                  </section>
                ) : null}
                {history.some((entry) => entry.subjects.length > 0) ? (
                  <section className="chart-block">
                    <p className="chart-title">{t("Subject by subject")}</p>
                    <p className="chart-note">{t("Which subjects are being looked after, and which have gone quiet.")}</p>
                    <SubjectTrend weeks={history} />
                  </section>
                ) : null}
              </div>
            </section>

            {panels.student.guardians.length > 0 ? (
              <section className="card inbox-card" aria-label={t("From your guardians")}>
                <header className="card-head">
                  <div>
                    <p className="kicker">{t("From your guardians")}</p>
                    <h2 className="card-title">
                      {t("Notes for you")}
                      {unreadInbox > 0 ? <span className="badge-count"> {faNum(unreadInbox)}</span> : null}
                    </h2>
                  </div>
                  {unreadInbox > 0 ? (
                    <button type="button" className="btn btn-ghost btn-tiny" onClick={() => updatePanels((latest) => markInboxRead(latest))}>
                      {t("Mark all read")}
                    </button>
                  ) : null}
                </header>

                {openGoals.length > 0 ? (
                  <ul className="gplan-list">
                    {openGoals.map((goal) => (
                      <li key={goal.id} className="gplan-card ggoal-card">
                        <div className="gplan-head">
                          <div>
                            <p className="gplan-kicker">
                              {goal.target ? t("Suggested goal · aiming for {0}", { 0: goal.target }) : t("Suggested goal")}
                            </p>
                            <p className="gplan-title">{goal.title}</p>
                          </div>
                        </div>
                        {goal.note ? <p className="gplan-note">{goal.note}</p> : null}
                        {goal.steps.length > 0 ? (
                          <ol className="ggoal-step-list">
                            {goal.steps.map((step, index) => (
                              <li key={index}>{step}</li>
                            ))}
                          </ol>
                        ) : null}
                        <p className="gplan-from">{t("From {0}", { 0: goal.author })}</p>
                        <div className="ggoal-answers">
                          <button
                            type="button"
                            className="btn btn-primary btn-small"
                            disabled={answering === goal.id}
                            onClick={() => void takeOnGoal(goal)}
                          >
                            {answering === goal.id ? <span className="spinner" aria-hidden="true" /> : null}
                            {t("Take it on")}
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost btn-small"
                            disabled={answering === goal.id}
                            onClick={() => void refuseGoal(goal)}
                          >
                            {t("Not now")}
                          </button>
                        </div>
                        <p className="hint">{t("Taking it on adds it to your goals. You can change it or drop it afterwards like any other.")}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {inbox.notices.length > 0 ? (
                  <ul className="inbox-notices">
                    {inbox.notices.slice(0, 6).map((notice) => (
                      <li key={notice.id} className={cx('inbox-notice', !notice.read && 'unread')}>
                        <p className="inbox-notice-text">{notice.summary}</p>
                        <p className="inbox-notice-meta">
                          {notice.author}
                          {notice.weekOf ? ` · ${t("Week of {0}", { 0: notice.weekOf })}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {inbox.notices.length === 0 && openGoals.length === 0 ? (
                  <p className="empty-note">
                    {t("Nothing yet. When a parent or advisor plans your week, suggests a goal, or leaves a note, it shows up here.")}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section className="card" aria-label={t("AI")}>
              <header className="card-head">
                <div>
                  <p className="kicker">{t("AI")}</p>
                  <h2 className="card-title">{t("What should I do this week?")}</h2>
                </div>
                <button type="button" className="btn btn-outline btn-small" disabled={asking} onClick={() => void ask()}>
                  {asking ? <span className="spinner" aria-hidden="true" /> : <SparkIcon size={14} />}
                  {asking ? t("Thinking…") : advice ? t("Ask again") : t("Ask")}
                </button>
              </header>
              <p className="view-sub">
                {t("It reads this week's plan and what you have already finished — nothing else in your planner.")}
              </p>

              {advice ? (
                <div className="advice">
                  {advice.summary ? <p className="advice-summary">{advice.summary}</p> : null}
                  {advice.focus.length > 0 ? (
                    <ol className="advice-list">
                      {advice.focus.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ol>
                  ) : null}
                  {advice.watchOut ? <p className="advice-watchout">{advice.watchOut}</p> : null}
                </div>
              ) : (
                <p className="empty-note">{t("Nothing yet. Ask, and it answers from this week alone.")}</p>
              )}
            </section>

            <section className="card">
              <header className="card-head">
                <div>
                  <p className="kicker">{t("This week")}</p>
                  <h2 className="card-title">{t("Explain a significant change")}</h2>
                </div>
              </header>
              <p className="view-sub">
                {t("Write a headline about what changed. The latest headline is included with your weekly results; your reason stays private in this planner.")}
              </p>

              <div className="panel-form">
                <Field label={t("What changed")}>
                  <input
                    className="input"
                    value={noteDraft.summary}
                    placeholder={t("Moved the history essay to Thursday")}
                    onChange={(event) => setNoteDraft({ ...noteDraft, summary: event.target.value })}
                  />
                </Field>
                <Field label={t("Why")} hint={t("Private to you; only the headline above is shared.")}>
                  <textarea
                    className="input"
                    rows={2}
                    value={noteDraft.reason}
                    placeholder={t("Two deadlines landed on the same day.")}
                    onChange={(event) => setNoteDraft({ ...noteDraft, reason: event.target.value })}
                  />
                </Field>
                <div className="panel-form-actions">
                  <button type="button" className="btn btn-primary btn-small" disabled={!noteDraft.summary.trim()} onClick={addNote}>
                    {t("Note this change")}
                  </button>
                </div>
              </div>

              {current.length > 0 ? (
                <ul className="explain-list">
                  {current.map((note) => (
                    <li key={note.id}>
                      <div>
                        <p className="explain-summary">{note.summary}</p>
                        {note.reason ? <p className="explain-reason">{note.reason}</p> : null}
                      </div>
                      <button
                        type="button"
                        className="icon-btn round"
                        aria-label={t("Delete")}
                        onClick={() => updatePanels((latest) => withoutExplanation(latest, note.id))}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty-note">{t("Nothing noted this week.")}</p>
              )}

              {past.length > 0 ? (
                <details className="past-weeks">
                  <summary>{t("Earlier weeks")}</summary>
                  <ul>
                    {past.slice(0, 8).map((entry) => (
                      <li key={entry.week}>
                        <span className="past-week">{formatWeekRange(entry.week)}</span>
                        <span className="past-count">{t("{0} changes explained", { 0: entry.count })}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="hint">{t("Earlier explanations stay in your planner. Guardians only receive results and the latest headline.")}</p>
                </details>
              ) : null}
            </section>
          </>
        ) : null}

        {/* -------------------------------------------------------- Subjects */}
        {tab === 'subjects' ? (
          <SubjectTracker
            onStudy={(subject) => {
              setStudyPrefill(subject);
              setTab('today');
            }}
          />
        ) : null}

        {/* --------------------------------------------------------- Sharing */}
        {tab === 'sharing' ? (
          <section className="card">
            <header className="card-head">
              <div>
                <p className="kicker">{t("Guardians")}</p>
                <h2 className="card-title">{t("Who sees your week")}</h2>
              </div>
              {panels.student.guardians.length > 0 ? (
                <button type="button" className="btn btn-ghost btn-tiny" disabled={sharing} onClick={() => void shareNow()}>
                  {sharing ? <span className="spinner" aria-hidden="true" /> : null}
                  {sharing ? t("Sharing…") : t("Share this week now")}
                </button>
              ) : null}
            </header>
            <p className="view-sub">
              {t("They receive your weekly results — how much was planned, how much got done, how long you focused, and the headline you write. Nothing else leaves this planner.")}
            </p>

            <details className="panel-sharing-preview">
              <summary>{t("Preview shared results")}</summary>
              <div className="sharing-preview-body">
                <p className="hint">{t("This is the weekly snapshot guardians receive. Task details, exam dates, targets, reasons, and personal notes are not sent automatically.")}</p>
                <p className="student-week">{t("Week of {0}", { 0: results.weekOf })}</p>
                <dl className="sharing-preview-values">
                  <div><dt>{t("Planned")}</dt><dd>{faNum(results.planned)}</dd></div>
                  <div><dt>{t("Done")}</dt><dd>{faNum(results.done)}</dd></div>
                  <div><dt>{t("Focused")}</dt><dd>{minutesLabel(results.focusMinutes)}</dd></div>
                </dl>
                {results.subjects.length > 0 ? <SubjectSplit subjects={results.subjects} /> : null}
                <p className="student-headline">{results.headline || t("No headline shared this week.")}</p>
              </div>
            </details>

            {panels.student.guardians.length === 0 ? (
              <p className="empty-note">{t("Nobody yet. Add a code from a parent or advisor to start sharing results.")}</p>
            ) : (
              <ul className="guardian-list">
                {panels.student.guardians.map((guardian) => (
                  <li key={guardian.linkId}>
                    <div>
                      <p className="guardian-name">{guardian.guardianDisplayName}</p>
                      <p className="guardian-state">
                        {guardian.sharedWeek ? t("Shared for the week of {0}", { 0: guardian.sharedWeek }) : t("Not shared yet")}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      onClick={() => stopSharing(guardian)}
                    >
                      {t("Stop sharing")}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="panel-form">
              <Field label={t("Have a code from a parent or advisor?")}>
                <input
                  className="input"
                  value={code}
                  autoComplete="off"
                  placeholder="plnr-XXXX-XXXX-XXXX"
                  onChange={(event) => {
                    setCode(event.target.value);
                    setScanned(false);
                  }}
                />
              </Field>
              <div className="panel-form-actions">
                <button type="button" className="btn btn-primary btn-small" disabled={busy || !code.trim()} onClick={() => void accept()}>
                  {busy ? <span className="spinner" aria-hidden="true" /> : null}
                  {busy ? t("Linking…") : t("Link")}
                </button>
              </div>
              {scanned ? (
                <p className="hint" role="status">
                  {t("That code came from a QR code. Press Link to accept it.")}
                </p>
              ) : null}
            </div>

            <p className="panel-private-note">
              <HeartIcon size={13} />
              {t("You decide what is shared. Stopping at any time stops it for good — the results they already have are theirs.")}
            </p>
          </section>
        ) : null}

        {tab === 'classes' ? <StudentLearningHub /> : null}
      </PanelTabPanel>

      <p className="panel-footnote">
        <button type="button" className="text-btn" onClick={() => navigate({ name: 'panels' })}>
          {t("Manage panels")}
        </button>
      </p>
    </div>
  );
}
