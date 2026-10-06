/**
 * The student panel: subjects and exams, this week as results, and the place to
 * explain a significant change.
 *
 * Guardians receive totals and the student's chosen headline. Reasons and
 * older explanations stay private in this planner.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { CheckIcon, FlagIcon, SlidersIcon, StopwatchIcon, StudyIcon, TrashIcon } from '../icons';
import { faNum, t } from '../i18n';
import { GRADE_LABELS, gradeLabel, markInboxRead, newId, openGoalSuggestions, planPeriodLabel, planProgress, splitExplanations, subjectMinutes, weeklyHistory, weekOf, weekResults, withExplanation, withPlanItemToggled, withoutExplanation } from '../panels';
import { CompletionRing, FocusTrend, SubjectSplit, SubjectTrend, WeekBars, minutesLabel } from '../components/charts';
import { normalizeLinkCode } from '../auth/crypto';
import { friendlyGroqError, generateStudentAdvice, type StudentAdvice } from '../ai';
import { SparkIcon } from '../icons';
import { acceptInvitation, answerGoalSuggestion, forgetPraise, removeLink, shareWeeklyResults, syncLinks, syncStudentInbox } from '../auth/links';
import { AuthError } from '../auth/session';
import type { ChangeNote, GoalSuggestion } from '../types';
import { Field, Empty } from '../components/ui';
import { StudentWorkspace } from '../components/StudentWorkspace';
import { upcomingExams } from '../panelFeatures';
import { formatWeekRange, todayISO } from '../dates';
import '../panels.css';

export function StudentPanelView() {
  const { state, panels, updatePanels, addGoal, flash, navigate, setPanelEnabled, requestConfirm, route } = usePlanner();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ field: panels.student.field ?? '', grade: panels.student.grade ?? '' });
  const [code, setCode] = useState('');
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<StudentAdvice | null>(null);
  const [asking, setAsking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);

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
   * want this link. So their code is filled in rather than typed. Saying yes
   * still takes a press: linking hands a guardian their weekly results for as
   * long as the link lasts, and that is not something to do on arrival.
   */
  useEffect(() => {
    if (route.name !== 'panels' || !route.invite) return;
    setCode(route.invite);
    setScanned(true);
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

  const [noteDraft, setNoteDraft] = useState({ summary: '', reason: '' });
  const subjects = panels.student.subjects;
  const exams = upcomingExams(subjects);
  const targets = subjects.filter((subject) => (subject.targetMinutes ?? 0) > 0);
  const targetsReached = targets.filter((subject) => subjectMinutes(state, subject, week) >= subject.targetMinutes!).length;

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

  return (
    <div className="view panels-view student-panel-view">
      <header className="view-head panel-page-head">
        <div>
          <p className="kicker panel-page-kicker"><StudyIcon size={16} />{t("Student panel")}<span>{formatWeekRange(week)}</span></p>
          <h1 className="view-title">{t("This week, and what’s coming")}</h1>
          <p className="view-sub">
            {t("Your planner is underneath all of this — the panel only adds a study view.")}
          </p>
        </div>
        <div className="panel-page-actions">
          <button type="button" className="btn btn-outline btn-small" aria-expanded={editing} onClick={() => {
            setDetails({ field: panels.student.field ?? '', grade: panels.student.grade ?? '' });
            setEditing((value) => !value);
          }}>{editing ? t("Cancel") : t("Change details")}</button>
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

      <section className="panel-overview" aria-label={t("This week")}>
        <div className="panel-stat"><span className="panel-stat-icon"><CheckIcon size={18} /></span><p>{t("Done")}</p><strong>{faNum(results.done)}<small> / {faNum(results.planned)}</small></strong><span>{t("Whole planner this week")}</span></div>
        <div className="panel-stat"><span className="panel-stat-icon"><StopwatchIcon size={18} /></span><p>{t("Focused")}</p><strong>{minutesLabel(results.focusMinutes)}</strong><span>{t("Every focus session counts")}</span></div>
        <div className="panel-stat"><span className="panel-stat-icon"><StudyIcon size={18} /></span><p>{t("Study targets")}</p><strong>{targets.length ? <>{faNum(targetsReached)}<small> / {faNum(targets.length)}</small></> : '—'}</strong><span>{targets.length ? t("Weekly targets reached") : t("Set a weekly target below")}</span></div>
        <div className="panel-stat"><span className="panel-stat-icon"><FlagIcon size={18} /></span><p>{t("Next exam")}</p><strong>{exams[0] ? exams[0].days === 0 ? t("Today") : t("{0} days", { 0: exams[0].days }) : '—'}</strong><span>{exams[0]?.subject.name ?? t("No upcoming exams")}</span></div>
      </section>

      <StudentWorkspace />

      {panels.student.guardians.length > 0 ? (
        <>
        {(panels.student.praise ?? []).length > 0 ? (
          <section className="card praise-card" aria-label={t("Kind words")}>
            <header className="card-head">
              <div>
                <p className="kicker">{t("Kind words")}</p>
                <h2 className="card-title">{t("What they said to you")}</h2>
              </div>
            </header>
            <p className="praise-lead">{t("Kept here until you let them go. Not tasks — just what someone noticed.")}</p>
            <ul className="praise-list">
              {(panels.student.praise ?? []).slice(0, 8).map((praise) => (
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

        <section className="card inbox-card" aria-label={t("From your guardians")}>
          <header className="card-head">
            <div>
              <p className="kicker">{t("From your guardians")}</p>
              <h2 className="card-title">
                {t("Plans and notes for you")}
                {unreadInbox > 0 ? <span className="badge-count"> {faNum(unreadInbox)}</span> : null}
              </h2>
            </div>
            {unreadInbox > 0 ? (
              <button type="button" className="btn btn-ghost btn-tiny" onClick={() => updatePanels((latest) => markInboxRead(latest))}>
                {t("Mark all read")}
              </button>
            ) : null}
          </header>

          {inbox.notices.length === 0 && inbox.plans.length === 0 && openGoals.length === 0 ? (
            <p className="empty-note">
              {t("Nothing yet. When a parent or advisor plans your week, suggests a goal, or leaves a note, it shows up here.")}
            </p>
          ) : null}

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

          {inbox.plans.length > 0 ? (
            <ul className="gplan-list">
              {inbox.plans.map((plan) => {
                const progress = planProgress(plan);
                return (
                  <li key={plan.id} className="gplan-card">
                    <div className="gplan-head">
                      <div>
                        <p className="gplan-kicker">
                          <span className={cx('gplan-cadence', `gplan-cadence-${plan.cadence}`)}>
                            {plan.cadence === 'day' ? t("Day plan") : plan.cadence === 'week' ? t("Week plan") : t("Month plan")}
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
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>
        </>
      ) : null}

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
          {history.some((week) => week.subjects.length > 0) ? (
            <section className="chart-block">
              <p className="chart-title">{t("Subject by subject")}</p>
              <p className="chart-note">{t("Which subjects are being looked after, and which have gone quiet.")}</p>
              <SubjectTrend weeks={history} />
            </section>
          ) : null}
        </div>
      </section>

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
      </section>

      <section className="card">
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

      <p className="panel-footnote">
        <button type="button" className="text-btn" onClick={() => navigate({ name: 'panels' })}>
          {t("Manage panels")}
        </button>
      </p>
    </div>
  );
}
