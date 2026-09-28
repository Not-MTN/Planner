/**
 * The guardian panel: who you follow, and their week as results.
 *
 * A guardian never sees the detail of a student's day — only weekly counts and
 * the student's own reason for a significant change. Parent and advisor are two
 * separate roles; either can follow several students.
 */
import { useEffect, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { HeartIcon, PlusIcon, TrashIcon } from '../icons';
import { t } from '../i18n';
import { Field, Empty } from '../components/ui';
import { inviteStudent, refreshResults, removeLink, syncLinks, type Invitation } from '../auth/links';
import { AuthError } from '../auth/session';
import type { GuardianLink } from '../types';

export function GuardianPanelView() {
  const { panels, updatePanels, flash, navigate, requestConfirm } = usePlanner();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState({ username: '', displayName: '' });
  const guardian = panels.guardian;

  // Once signed in, results arrive on their own: check when the panel opens and
  // whenever the planner is saved again.
  useEffect(() => {
    let cancelled = false;
    void syncLinks(panels)
      .then((sync) => (cancelled ? null : refreshResults(sync.panels)))
      .then((refreshed) => {
        if (cancelled || !refreshed) return;
        if (refreshed.changed) updatePanels(refreshed.panels);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addLink = async () => {
    const username = draft.username.trim().replace(/^@/, '').toLowerCase();
    if (!username || busy) return;
    if (guardian.links.some((link) => link.username === username)) {
      flash(t("You already follow that student."));
      return;
    }
    setBusy(true);
    try {
      const { panels: next, invitation: made } = await inviteStudent(panels, username, draft.displayName);
      updatePanels(next);
      setInvitation(made);
      setDraft({ username: '', displayName: '' });
      setAdding(false);
      flash(t("Invitation ready. Give the code to your student."));
    } catch (error) {
      flash(error instanceof AuthError || error instanceof Error ? error.message : t("That invitation could not be sent."));
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!invitation) return;
    try {
      await navigator.clipboard.writeText(invitation.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  const stopFollowing = (link: GuardianLink) => {
    const end = async () => {
      const next = link.linkId ? await removeLink(panels, link.linkId) : {
        ...panels,
        guardian: { ...guardian, links: guardian.links.filter((item) => item.id !== link.id) },
      };
      updatePanels(next);
      flash(t("Stopped following {0}.", { 0: link.displayName }));
    };
    requestConfirm({
      title: t("Stop following {0}?", { 0: link.displayName }),
      body: t("Their weekly results will no longer appear here. Nothing is deleted from their planner."),
      confirmLabel: t("Stop following"),
      onConfirm: () => void end(),
    });
  };

  const hours = (minutes: number) => (minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`);

  if (!guardian.enabled || !guardian.kind) {
    return (
      <div className="view panels-view">
        <Empty
          title={t("The guardian panel is not added")}
          text={t("Your planner is untouched — the panel is simply not on. Add it whenever you want it.")}
          action={
            <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'panels' })}>
              {t("See the panels")}
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
          <p className="kicker">{guardian.kind === 'parent' ? t("Parent panel") : t("Advisor panel")}</p>
          <h1 className="view-title">{t("The week, as results")}</h1>
          <p className="view-sub">
            {t("You see how the week went, not what was in it. Anything personal to the student stays with them.")}
          </p>
        </div>
      </header>

      <p className="panel-identity">
        <strong>{guardian.kind === 'parent' ? t("Parent") : t("Advisor")}</strong>
        {guardian.field ? <span>{guardian.field}</span> : null}
      </p>

      <section className="card">
        <header className="card-head">
          <div>
            <p className="kicker">{t("Students")}</p>
            <h2 className="card-title">{t("Who you follow")}</h2>
          </div>
          <button type="button" className="btn btn-tiny" onClick={() => setAdding((value) => !value)}>
            <PlusIcon size={14} /> {t("Student")}
          </button>
        </header>

        {adding ? (
          <div className="panel-form">
            <Field label={t("Their username")}>
              <input
                className="input"
                value={draft.username}
                autoFocus
                placeholder={t("username")}
                onChange={(event) => setDraft({ ...draft, username: event.target.value })}
              />
            </Field>
            <Field label={t("Name you’ll see")}>
              <input
                className="input"
                value={draft.displayName}
                onChange={(event) => setDraft({ ...draft, displayName: event.target.value })}
              />
            </Field>
            <div className="panel-form-actions">
              <button type="button" className="btn btn-primary btn-small" disabled={!draft.username.trim() || busy} onClick={() => void addLink()}>
                {busy ? <span className="spinner" aria-hidden="true" /> : null}
                {t("Add student")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setAdding(false)}>
                {t("Cancel")}
              </button>
            </div>
            <p className="hint">{t("They choose whether to share. Until they accept, nothing of theirs is shown here.")}</p>
          </div>
        ) : null}

        {invitation ? (
          <div className="invite-card">
            <p className="invite-lead">{t("Give this code to {0}", { 0: invitation.link.displayName })}</p>
            <code className="invite-code">{invitation.code}</code>
            <div className="invite-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={copyCode}>
                {copied ? t("Code copied") : t("Copy code")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setInvitation(null)}>
                {t("Done")}
              </button>
            </div>
            <p className="hint">
              {t("They type it once in their own panel. After that their weekly results come to you on their own — the code is never stored on our servers.")}
            </p>
          </div>
        ) : null}

        {guardian.links.length === 0 ? (
          <Empty title={t("No students yet")} text={t("Add one to start receiving their weekly results.")} />
        ) : (
          <ul className="student-cards">
            {guardian.links.map((link) => (
              <li key={link.id} className={cx('student-card', link.status === 'pending' && 'is-pending')}>
                <div className="student-card-head">
                  <span className="student-avatar" aria-hidden="true">
                    <HeartIcon size={15} />
                  </span>
                  <div>
                    <p className="student-name">{link.displayName}</p>
                    <p className="student-user">@{link.username}</p>
                  </div>
                  <button type="button" className="icon-btn round" aria-label={t("Delete")} onClick={() => stopFollowing(link)}>
                    <TrashIcon size={14} />
                  </button>
                </div>

                {link.status === 'pending' || !link.results ? (
                  <p className="student-pending">
                    {t("Waiting for them to accept — no results yet.")}
                    {link.code ? (
                      <>
                        {' '}
                        <button type="button" className="text-btn" onClick={() => setInvitation({ link, code: link.code! })}>
                          {t("Show the code again")}
                        </button>
                      </>
                    ) : null}
                  </p>
                ) : (
                  <>
                    <div className="result-row">
                      <div className="result">
                        <p className="kicker">{t("Done")}</p>
                        <p className="result-num">
                          {link.results.done}
                          <span className="result-of">/{link.results.planned}</span>
                        </p>
                      </div>
                      <div className="result">
                        <p className="kicker">{t("Focused")}</p>
                        <p className="result-num">{hours(link.results.focusMinutes)}</p>
                      </div>
                    </div>
                    {link.results.headline ? (
                      <p className="student-headline">“{link.results.headline}”</p>
                    ) : (
                      <p className="student-headline muted">{t("No change explained this week.")}</p>
                    )}
                    <p className="student-week">{t("Week of {0}", { 0: link.results.weekOf })}</p>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="panel-footnote">
        {t("A parent and an advisor are different roles, and both can follow several students. When one of you changes something for a student, the other is told.")}
      </p>

      <p className="panel-footnote">
        <button type="button" className="text-btn" onClick={() => navigate({ name: 'panels' })}>
          {t("Manage panels")}
        </button>
      </p>
    </div>
  );
}
