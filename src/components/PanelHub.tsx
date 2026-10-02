/**
 * The dashboard's way into the optional panels. Panels are extras: someone may
 * run the personal planner alone, add the student panel, the guardian panel, or
 * both, and nothing here ever replaces the planner underneath.
 */
import { usePlanner } from '../context';
import { HeartIcon, PlusIcon, SlidersIcon, StudyIcon } from '../icons';
import { faNum, t } from '../i18n';

export function PanelHub() {
  const { panels, navigate } = usePlanner();
  const count = (panels.student.enabled ? 1 : 0) + (panels.guardian.enabled ? 1 : 0);
  const unread = panels.guardian.notices.filter((notice) => !notice.read).length;
  if (count === 0) return null;

  return (
    <section className="card panel-hub" aria-label={t("Panels")}>
      <header className="card-head">
        <div>
          <p className="kicker">{t("Panels")}</p>
          <h2 className="card-title">{t("Your panels")}</h2>
        </div>
        <button type="button" className="btn btn-tiny" onClick={() => navigate({ name: 'panels' })}>
          <SlidersIcon size={14} /> {t("Manage panels")}
        </button>
      </header>
      <div className="panel-hub-row">
        {panels.student.enabled ? (
          <button type="button" className="hub-tile accent-blue" onClick={() => navigate({ name: 'student' })}>
            <span className="hub-icon">
              <StudyIcon size={17} />
            </span>
            <span className="hub-label">{t("Student panel")}</span>
            <span className="hub-note">{t("Subjects, exams and this week’s focus")}</span>
          </button>
        ) : null}
        {panels.guardian.enabled ? (
          <button type="button" className="hub-tile accent-peach" onClick={() => navigate({ name: 'guardian' })}>
            <span className="hub-icon">
              <HeartIcon size={17} />
            </span>
            <span className="hub-label">
              {t("Guardian panel")}
              {unread > 0 ? <span className="hub-badge">{faNum(unread)}</span> : null}
            </span>
            <span className="hub-note">
              {unread > 0
                ? t("{0} new from the other guardians", { 0: unread })
                : panels.guardian.kind === 'parent'
                  ? t("Parent — weekly results")
                  : t("Advisor — weekly results")}
            </span>
          </button>
        ) : null}
        {count === 1 ? (
          <button type="button" className="hub-tile hub-add" onClick={() => navigate({ name: 'panels' })}>
            <span className="hub-icon">
              <PlusIcon size={15} />
            </span>
            <span className="hub-label">{t("Add another panel")}</span>
            <span className="hub-note">{t("Student or guardian — your planner stays as it is")}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** The same tiles, offered once, on the day someone first opens the planner. */
export function PanelInvite() {
  const { panels, navigate } = usePlanner();
  const any = panels.student.enabled || panels.guardian.enabled;
  if (any) return null;
  return (
    <section className="card panel-invite" aria-label={t("Panels")}>
      <header className="card-head">
        <div>
          <p className="kicker">{t("Optional")}</p>
          <h2 className="card-title">{t("Add a panel when you want one")}</h2>
        </div>
      </header>
      <p className="panel-invite-copy">
        {t("Your planner is complete on its own. A panel only adds a view — subjects and exams if you study, or weekly results if you guide someone. Pick one, pick both, or stay with the personal panel.")}
      </p>
      <button type="button" className="btn btn-soft btn-small" onClick={() => navigate({ name: 'panels' })}>
        {t("See the panels")}
      </button>
    </section>
  );
}
