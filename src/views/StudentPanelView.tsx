/**
 * The student panel: subjects and exams, this week as results, and the place to
 * explain a significant change.
 *
 * Detail stays inside the active week. When the week rolls over, only the
 * results remain — that is the rule that keeps a planner light.
 */
import { useEffect, useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { BookIcon, FlagIcon, PlusIcon, StopwatchIcon, TrashIcon } from '../icons';
import { t } from '../i18n';
import { daysUntil, GRADE_LABELS, gradeLabel, markInboxRead, newId, planPeriodLabel, planProgress, splitExplanations, subjectMinutes, subjectProgress, weeklyHistory, weekOf, weekResults, withExplanation, withPlanItemToggled, withSubject, withoutExplanation, withoutSubject } from '../panels';
import { CompletionRing, FocusTrend, SubjectSplit, WeekBars, minutesLabel } from '../components/charts';
import { normalizeLinkCode } from '../auth/crypto';
import { friendlyGroqError, generateStudentAdvice, type StudentAdvice } from '../ai';
import { SparkIcon } from '../icons';
import { acceptInvitation, removeLink, shareWeeklyResults, syncLinks, syncStudentInbox } from '../auth/links';
import { AuthError } from '../auth/session';
import type { ChangeNote, StudentSubject } from '../types';
import { Field, Empty } from '../components/ui';
import { ACCENTS } from '../constants';

export function StudentPanelView() {
  const { state, panels, updatePanels, flash, navigate, setPanelEnabled, requestConfirm } = usePlanner();
  const [editing, setEditing] = useState(false);
  const [details, setDetails] = useState({ field: panels.student.field ?? '', grade: panels.student.grade ?? '' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [advice, setAdvice] = useState<StudentAdvice | null>(null);
  const [asking, setAsking] = useState(false);
  const [sharing, setSharing] = useState(false);

  // Keep in step with the server: a guardian may have ended the link, or sent
  // something new. Notes left by one guardian are passed to the others here —
  // only this planner holds every link's key, so it is the only one that can.
  useEffect(() => {
    let cancelled = false;
    void syncLinks(panels)
      .then((result) => (cancelled ? null : syncStudentInbox(result.panels)))
      .then((inbox) => {
        if (cancelled || !inbox) return;
        if (inbox.changed) updatePanels(inbox.panels);
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

  const accept = async () => {
    if (busy) return;
    if (!normalizeLinkCode(code)) {
      flash(t("That code is not right. It looks like plnr-XXXX-XXXX-XXXX."));
      return;
    }
    setBusy(true);
    try {
      const next = await acceptInvitation(panels, code);
      updatePanels(next);
      setCode('');
      // Send this week straight away so their panel is not empty.
      const shared = await shareWeeklyResults(state, next, true);
      if (shared.panels !== next) updatePanels(shared.panels);
      flash(t("Linked. Your weekly results now reach {0}.", { 0: next.student.guardians[0]?.guardianDisplayName ?? '' }));
    } catch (error) {
      flash(error instanceof AuthError || error instanceof Error ? error.message : t("That code could not be used."));
    } finally {
      setBusy(false);
    }
  };

  const shareNow = async () => {
    if (sharing || panels.student.guardians.length === 0) return;
    setSharing(true);
    try {
      const shared = await shareWeeklyResults(state, panels, true);
      updatePanels(shared.panels);
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
        void removeLink(panels, guardian.linkId).then((next) => {
          updatePanels(next);
          flash(t("Stopped sharing with {0}.", { 0: guardian.guardianDisplayName }));
        });
      },
    });
  };
  const week = useMemo(() => weekOf(), []);
  const results = useMemo(() => weekResults(state, week), [state, week]);
  const { current, past } = useMemo(() => splitExplanations(panels.student.explanations, week), [panels.student.explanations, week]);
  const history = useMemo(() => weeklyHistory(state, 6, week), [state, week]);
  const inbox = panels.student.inbox;
  const unreadInbox = inbox.notices.filter((notice) => !notice.read).length;

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', examDate: '', targetHours: '' });
  const [noteDraft, setNoteDraft] = useState({ summary: '', reason: '' });

  const subjects = panels.student.subjects;
  const nextAccent = ACCENTS[subjects.length % ACCENTS.length] ?? 'sage';

  const addSubject = () => {
    const name = draft.name.trim();
    if (!name) return;
    const subject: StudentSubject = {
      id: newId('sub'),
      name: name.slice(0, 60),
      accent: nextAccent,
      examDate: draft.examDate || null,
      targetMinutes: draft.targetHours ? Math.round(Number(draft.targetHours) * 60) : null,
    };
    updatePanels(withSubject(panels, subject));
    setDraft({ name: '', examDate: '', targetHours: '' });
    setAdding(false);
    flash(t("Subject added."));
  };

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
    updatePanels(withExplanation(panels, note));
    setNoteDraft({ summary: '', reason: '' });
    flash(t("Noted. Your guardian sees this with your reason attached."));
  };

  const hours = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);

  // Someone bookmarked the panel, or turned it off on another device.
  if (!panels.student.enabled) {
    return (
      <div className="view panels-view">
        <Empty
          title={t("The student panel is not added")}
          text={t("Your planner is untouched — the panel is simply not on. Add it whenever you want it.")}
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
    <div className="view panels-view">
      <header className="view-head">
        <div>
          <p className="kicker">{t("Student panel")}</p>
          <h1 className="view-title">{t("This week, and what’s coming")}</h1>
          <p className="view-sub">
            {t("Your planner is underneath all of this — the panel only adds a study view.")}
          </p>
        </div>
        <button type="button" className="btn btn-tiny" onClick={() => setEditing((value) => !value)}>
          {editing ? t("Cancel") : t("Change details")}
        </button>
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
                    {option.label}
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
                  updatePanels({
                    ...panels,
                    student: { ...panels.student, field: details.field.trim(), grade: details.grade },
                  });
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

      <section className="card week-results" aria-label={t("This week")}>
        <div className="result-row">
          <div className="result">
            <p className="kicker">{t("Done")}</p>
            <p className="result-num">
              {results.done}<span className="result-of">/{results.planned}</span>
            </p>
          </div>
          <div className="result">
            <p className="kicker">{t("Focused")}</p>
            <p className="result-num">{hours(results.focusMinutes)}</p>
          </div>
          <div className="result">
            <p className="kicker">{t("Explained")}</p>
            <p className="result-num">{current.length}</p>
          </div>
        </div>
        <p className="result-note">
          {t("These are results, not detail. Next week this row is all that stays of this week.")}
        </p>
      </section>

      {panels.student.guardians.length > 0 ? (
        <section className="card inbox-card" aria-label={t("From your guardians")}>
          <header className="card-head">
            <div>
              <p className="kicker">{t("From your guardians")}</p>
              <h2 className="card-title">
                {t("Plans and notes for you")}
                {unreadInbox > 0 ? <span className="badge-count"> {unreadInbox}</span> : null}
              </h2>
            </div>
            {unreadInbox > 0 ? (
              <button type="button" className="btn btn-ghost btn-tiny" onClick={() => updatePanels(markInboxRead(panels))}>
                {t("Mark all read")}
              </button>
            ) : null}
          </header>

          {inbox.notices.length === 0 && inbox.plans.length === 0 ? (
            <p className="empty-note">
              {t("Nothing yet. When a parent or advisor plans your week or leaves a note, it shows up here.")}
            </p>
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
                        <strong>{progress.done}</strong>
                        <span>/{progress.total}</span>
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
                                onChange={() => updatePanels(withPlanItemToggled(panels, plan.id, item.id))}
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
                  <p className="result-num">{hours(results.focusMinutes)}</p>
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
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <div>
            <p className="kicker">{t("Subjects")}</p>
            <h2 className="card-title">{t("What you’re working towards")}</h2>
          </div>
          <button type="button" className="btn btn-tiny" onClick={() => setAdding((value) => !value)}>
            <PlusIcon size={14} /> {t("Subject")}
          </button>
        </header>

        {adding ? (
          <div className="panel-form">
            <Field label={t("Subject")}>
              <input
                className="input"
                value={draft.name}
                autoFocus
                placeholder={t("Mathematics")}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </Field>
            <Field label={t("Exam date")}>
              <input
                className="input"
                type="date"
                value={draft.examDate}
                onChange={(event) => setDraft({ ...draft, examDate: event.target.value })}
              />
            </Field>
            <Field label={t("Target hours per week")}>
              <input
                className="input"
                type="number"
                min="0"
                step="0.5"
                value={draft.targetHours}
                onChange={(event) => setDraft({ ...draft, targetHours: event.target.value })}
              />
            </Field>
            <div className="panel-form-actions">
              <button type="button" className="btn btn-primary btn-small" disabled={!draft.name.trim()} onClick={addSubject}>
                {t("Add subject")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setAdding(false)}>
                {t("Cancel")}
              </button>
            </div>
            <p className="hint">{t("Study time is counted from focus sessions on tasks in a category with the same name.")}</p>
          </div>
        ) : null}

        {subjects.length === 0 ? (
          <Empty title={t("No subjects yet")} text={t("Add one to watch an exam date and weekly focus.")} />
        ) : (
          <ul className="subject-list">
            {subjects.map((subject) => {
              const minutes = subjectMinutes(state, subject, week);
              const progress = subjectProgress(state, subject, week);
              const days = daysUntil(subject.examDate);
              const target = subject.targetMinutes ?? 0;
              const ratio = target > 0 ? Math.min(1, minutes / target) : progress.total ? progress.done / progress.total : 0;
              return (
                <li key={subject.id} className={cx('subject-row', `accent-${subject.accent}`)}>
                  <span className="subject-dot" aria-hidden="true" />
                  <span className="subject-name">{subject.name}</span>
                  <span className="subject-meta">
                    {days !== null ? (
                      <span className={cx('subject-exam', days <= 7 && 'soon')}>
                        <FlagIcon size={12} /> {days < 0 ? t("Exam passed") : days === 0 ? t("Exam today") : t("{0} days to exam", { 0: days })}
                      </span>
                    ) : (
                      <span className="subject-exam muted">{t("No exam date")}</span>
                    )}
                    <span className="subject-time">
                      <StopwatchIcon size={12} /> {hours(minutes)}
                      {target > 0 ? ` / ${hours(target)}` : ''}
                    </span>
                    <span className="subject-tasks">
                      <BookIcon size={12} /> {progress.done}/{progress.total}
                    </span>
                  </span>
                  <span className="subject-bar" aria-hidden="true">
                    <i style={{ width: `${Math.round(ratio * 100)}%` }} />
                  </span>
                  <button
                    type="button"
                    className="icon-btn round"
                    aria-label={t("Delete")}
                    onClick={() => {
                      updatePanels(withoutSubject(panels, subject.id));
                      flash(t("Subject removed."));
                    }}
                  >
                    <TrashIcon size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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
              onChange={(event) => setCode(event.target.value)}
            />
          </Field>
          <div className="panel-form-actions">
            <button type="button" className="btn btn-primary btn-small" disabled={busy || !code.trim()} onClick={() => void accept()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {busy ? t("Linking…") : t("Link")}
            </button>
          </div>
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
          {t("Moved an exam, dropped a subject, changed your plan? Say what changed and why. Your guardian sees the change with your reason next to it — and nothing else about your week.")}
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
          <Field label={t("Why")}>
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
                  onClick={() => updatePanels(withoutExplanation(panels, note.id))}
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
                  <span className="past-week">{entry.week}</span>
                  <span className="past-count">{t("{0} changes explained", { 0: entry.count })}</span>
                </li>
              ))}
            </ul>
            <p className="hint">{t("The detail of those weeks is gone; only the results were kept.")}</p>
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
