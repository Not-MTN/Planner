/**
 * Where panels are chosen. Nothing here is required: the personal planner keeps
 * working with no panel at all, a panel can be added later, and removing one
 * never touches tasks, events, habits or notes.
 */
import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { HeartIcon, StudyIcon } from '../icons';
import { t } from '../i18n';
import type { GuardianKind } from '../types';

export function PanelsView() {
  const { panels, setPanelEnabled, updatePanels, flash, navigate } = usePlanner();
  const [choosing, setChoosing] = useState<GuardianKind | null>(null);

  const addStudent = () => {
    setPanelEnabled('student', true);
    flash(t("Student panel added. Your planner is unchanged."));
  };

  const addGuardian = (kind: GuardianKind) => {
    setPanelEnabled('guardian', true);
    updatePanels({ ...panels, guardian: { ...panels.guardian, enabled: true, kind } });
    setChoosing(null);
    flash(kind === 'parent' ? t("Parent panel added.") : t("Advisor panel added."));
  };

  const removeStudent = () => {
    setPanelEnabled('student', false);
    flash(t("Student panel removed. Your planner is unchanged."));
  };

  const removeGuardian = () => {
    setPanelEnabled('guardian', false);
    flash(t("Guardian panel removed. Your planner is unchanged."));
  };

  return (
    <div className="view panels-view">
      <header className="view-head">
        <div>
          <p className="kicker">{t("Optional")}</p>
          <h1 className="view-title">{t("Panels")}</h1>
          <p className="view-sub">
            {t("Panels are additions to your planner, not a choice between them. Add one, add both, or keep the personal panel on its own — you can change it whenever you like.")}
          </p>
        </div>
      </header>

      <div className="panel-choices">
        <section className={cx('card', 'panel-choice', panels.student.enabled && 'is-on')}>
          <div className="panel-choice-head">
            <span className="panel-choice-icon accent-blue">
              <StudyIcon size={19} />
            </span>
            <div>
              <h2 className="card-title">{t("Student panel")}</h2>
              <p className="panel-choice-tag">{panels.student.enabled ? t("Added") : t("Not added")}</p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t("Subjects with exam dates and a weekly focus target.")}</li>
            <li>{t("Your week as results: what was planned, what got done, how long you focused.")}</li>
            <li>{t("A place to explain a significant change, so a guardian sees what changed and why.")}</li>
          </ul>
          {panels.student.enabled ? (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'student' })}>
                {t("Open student panel")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={removeStudent}>
                {t("Remove panel")}
              </button>
            </div>
          ) : (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={addStudent}>
                {t("Add student panel")}
              </button>
            </div>
          )}
        </section>

        <section className={cx('card', 'panel-choice', panels.guardian.enabled && 'is-on')}>
          <div className="panel-choice-head">
            <span className="panel-choice-icon accent-peach">
              <HeartIcon size={19} />
            </span>
            <div>
              <h2 className="card-title">{t("Guardian panel")}</h2>
              <p className="panel-choice-tag">
                {panels.guardian.enabled
                  ? panels.guardian.kind === 'parent'
                    ? t("Added — Parent")
                    : t("Added — Advisor")
                  : t("Not added")}
              </p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t("Watch one or more students, as a parent or as an advisor.")}</li>
            <li>{t("Weekly results only — never the detail of someone’s day.")}</li>
            <li>{t("Every significant change arrives with the student’s own reason for it.")}</li>
          </ul>

          {choosing ? (
            <div className="panel-kind-pick">
              <p className="panel-kind-question">{t("Which kind of guardian are you?")}</p>
              <div className="panel-choice-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={() => addGuardian('parent')}>
                  {t("Parent")}
                </button>
                <button type="button" className="btn btn-soft btn-small" onClick={() => addGuardian('advisor')}>
                  {t("Advisor")}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setChoosing(null)}>
                  {t("Cancel")}
                </button>
              </div>
              <p className="panel-kind-note">
                {t("A parent and an advisor are two different roles. Both can follow several students, and both are told when the other changes something.")}
              </p>
            </div>
          ) : !panels.guardian.enabled ? (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => setChoosing('advisor')}>
                {t("Add guardian panel")}
              </button>
            </div>
          ) : (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'guardian' })}>
                {t("Open guardian panel")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setChoosing(panels.guardian.kind ?? 'advisor')}>
                {t("Change type")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={removeGuardian}>
                {t("Remove panel")}
              </button>
            </div>
          )}
        </section>
      </div>

      <p className="panel-footnote">
        {t("Removing a panel does not delete anything from your planner. It only hides that panel’s own pages.")}
      </p>
    </div>
  );
}
