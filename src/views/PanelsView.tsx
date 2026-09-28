/**
 * Where panels are chosen. Nothing here is required: the personal planner keeps
 * working with no panel at all, a panel can be added later, and removing one
 * never touches tasks, events, habits or notes.
 *
 * A panel does ask for two things before it opens — what you study (or guide)
 * and where you are in it — because everything inside it is built around that.
 */
import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { Field } from '../components/ui';
import { HeartIcon, StudyIcon } from '../icons';
import { t } from '../i18n';
import { GRADE_LABELS } from '../panels';
import type { GuardianKind, Panels } from '../types';

export function PanelsView() {
  const { panels, updatePanels, flash, navigate } = usePlanner();
  const [form, setForm] = useState<'student' | 'guardian' | null>(null);
  const [draft, setDraft] = useState({ field: '', grade: '', kind: 'advisor' as GuardianKind });

  const openStudentForm = () => {
    setDraft({ ...draft, field: panels.student.field ?? '', grade: panels.student.grade ?? '' });
    setForm('student');
  };

  const openGuardianForm = () => {
    setDraft({ ...draft, field: panels.guardian.field ?? '', kind: panels.guardian.kind ?? draft.kind });
    setForm('guardian');
  };

  const addStudent = () => {
    const field = draft.field.trim();
    if (!field || !draft.grade) {
      flash(t("Add what you study and where you are in it."));
      return;
    }
    const next: Panels = {
      ...panels,
      student: { ...panels.student, enabled: true, field: field.slice(0, 60), grade: draft.grade },
    };
    updatePanels(next);
    setForm(null);
    flash(t("Student panel added. Your planner is unchanged."));
  };

  const addGuardian = () => {
    const field = draft.field.trim();
    if (!field) {
      flash(t("Add what you guide them in."));
      return;
    }
    updatePanels({
      ...panels,
      guardian: { ...panels.guardian, enabled: true, kind: draft.kind, field: field.slice(0, 60) },
    });
    setForm(null);
    flash(draft.kind === 'parent' ? t("Parent panel added.") : t("Advisor panel added."));
  };

  const removeStudent = () => {
    updatePanels({ ...panels, student: { ...panels.student, enabled: false } });
    flash(t("Student panel removed. Your planner is unchanged."));
  };

  const removeGuardian = () => {
    updatePanels({ ...panels, guardian: { ...panels.guardian, enabled: false } });
    flash(t("Guardian panel removed. Your planner is unchanged."));
  };

  const studentTag = panels.student.enabled
    ? `${panels.student.field ?? ''}${panels.student.field && panels.student.grade ? ' · ' : ''}${
        GRADE_LABELS.find((item) => item.id === panels.student.grade)?.label ?? ''
      }`
    : t("Not added");

  const guardianTag = panels.guardian.enabled
    ? `${panels.guardian.kind === 'parent' ? t("Parent") : t("Advisor")}${
        panels.guardian.field ? ` · ${panels.guardian.field}` : ''
      }`
    : t("Not added");

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
              <p className="panel-choice-tag">{studentTag}</p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t("Subjects with exam dates and a weekly focus target.")}</li>
            <li>{t("Your week as results: what was planned, what got done, how long you focused.")}</li>
            <li>{t("A place to explain a significant change, so a guardian sees what changed and why.")}</li>
          </ul>

          {form === 'student' ? (
            <div className="panel-form">
              <Field label={t("What do you study?")}>
                <input
                  className="input"
                  value={draft.field}
                  autoFocus
                  placeholder={t("Physics")}
                  onChange={(event) => setDraft({ ...draft, field: event.target.value })}
                />
              </Field>
              <Field label={t("Where are you in it?")}>
                <select className="input" value={draft.grade} onChange={(event) => setDraft({ ...draft, grade: event.target.value })}>
                  <option value="">—</option>
                  {GRADE_LABELS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="panel-form-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={addStudent}>
                  {t("Add student panel")}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setForm(null)}>
                  {t("Cancel")}
                </button>
              </div>
            </div>
          ) : panels.student.enabled ? (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'student' })}>
                {t("Open student panel")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={openStudentForm}>
                {t("Change details")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={removeStudent}>
                {t("Remove panel")}
              </button>
            </div>
          ) : (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={openStudentForm}>
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
              <p className="panel-choice-tag">{guardianTag}</p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t("Watch one or more students, as a parent or as an advisor.")}</li>
            <li>{t("Weekly results only — never the detail of someone’s day.")}</li>
            <li>{t("Every significant change arrives with the student’s own reason for it.")}</li>
          </ul>

          {form === 'guardian' ? (
            <div className="panel-form">
              <p className="panel-kind-question">{t("Which kind of guardian are you?")}</p>
              <div className="segmented" role="group" aria-label={t("Which kind of guardian are you?")}>
                <button
                  type="button"
                  className={cx('segment', draft.kind === 'parent' && 'on')}
                  aria-pressed={draft.kind === 'parent'}
                  onClick={() => setDraft({ ...draft, kind: 'parent' })}
                >
                  {t("Parent")}
                </button>
                <button
                  type="button"
                  className={cx('segment', draft.kind === 'advisor' && 'on')}
                  aria-pressed={draft.kind === 'advisor'}
                  onClick={() => setDraft({ ...draft, kind: 'advisor' })}
                >
                  {t("Advisor")}
                </button>
              </div>
              <Field label={t("What do you guide them in?")}>
                <input
                  className="input"
                  value={draft.field}
                  autoFocus
                  placeholder={t("Physics")}
                  onChange={(event) => setDraft({ ...draft, field: event.target.value })}
                />
              </Field>
              <div className="panel-form-actions">
                <button type="button" className="btn btn-primary btn-small" onClick={addGuardian}>
                  {t("Add guardian panel")}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setForm(null)}>
                  {t("Cancel")}
                </button>
              </div>
              <p className="hint">
                {t("A parent and an advisor are two different roles. Both can follow several students, and both are told when the other changes something.")}
              </p>
            </div>
          ) : panels.guardian.enabled ? (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={() => navigate({ name: 'guardian' })}>
                {t("Open guardian panel")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={openGuardianForm}>
                {t("Change details")}
              </button>
              <button type="button" className="btn btn-ghost btn-small" onClick={removeGuardian}>
                {t("Remove panel")}
              </button>
            </div>
          ) : (
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary btn-small" onClick={openGuardianForm}>
                {t("Add guardian panel")}
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
