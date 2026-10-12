/**
 * The front door: personal, student, guardian — pick one and it opens.
 *
 * This is what every open and every login lands on. The personal panel is the
 * planner itself and is always ready; the student and guardian panels open
 * when they are added, and otherwise lead to where they are added (#/panels).
 * Nothing here configures anything — choosing is the whole job of this page,
 * so it stays three cards and one press each.
 */
import { usePlanner } from '../context';
import { cx } from '../cx';
import { todayISO } from '../dates';
import { faNum, t } from '../i18n';
import { HeartIcon, SlidersIcon, StudyIcon, SunIcon } from '../icons';
import { eventsForDate } from '../logic';
import { gradeLabel } from '../panels';

export function HomeView() {
  const { state, panels, navigate } = usePlanner();

  const openTasks = state.tasks.filter((task) => !task.completed).length;
  const todayEvents = eventsForDate(state, todayISO()).length;
  const personalTag = `${faNum(openTasks)} ${openTasks === 1 ? t('task') : t('tasks')} · ${faNum(todayEvents)} ${
    todayEvents === 1 ? t('event') : t('events')
  }`;

  const studentTag = panels.student.enabled
    ? `${panels.student.field ?? ''}${panels.student.field && panels.student.grade ? ' · ' : ''}${
        gradeLabel(panels.student.grade) ?? ''
      }`
    : t('Not added');

  const guardianTag = panels.guardian.enabled
    ? `${panels.guardian.kind === 'parent' ? t('Parent') : t('Advisor')}${
        panels.guardian.field ? ` · ${panels.guardian.field}` : ''
      }`
    : t('Not added');

  return (
    <div className="view panels-view home-view">
      <header className="view-head">
        <div>
          <p className="kicker">{t('Panels')}</p>
          <h1 className="view-title">{t('Choose your panel')}</h1>
          <p className="view-sub">{t('Pick a panel to open it. You can switch panels any time.')}</p>
        </div>
        <div className="panel-head-actions">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => navigate({ name: 'panels' })}>
            <SlidersIcon size={14} />
            {t('Manage panels')}
          </button>
        </div>
      </header>

      <div className="panel-choices">
        <section className="card panel-choice is-on" aria-labelledby="home-personal">
          <div className="panel-choice-head">
            <span className="panel-choice-icon accent-sage">
              <SunIcon size={19} />
            </span>
            <div>
              <h2 className="card-title" id="home-personal">
                {t('Personal panel')}
              </h2>
              <p className="panel-choice-tag">{personalTag}</p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t('Your day, at a glance')}</li>
            <li>{t('All your tasks, your way')}</li>
            <li>{t('Small steps, kept kindly')}</li>
          </ul>
          <div className="panel-choice-actions">
            <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'today' })}>
              {t('Open personal panel')}
            </button>
          </div>
        </section>

        <section className={cx('card', 'panel-choice', panels.student.enabled && 'is-on')} aria-labelledby="home-student">
          <div className="panel-choice-head">
            <span className="panel-choice-icon accent-blue">
              <StudyIcon size={19} />
            </span>
            <div>
              <h2 className="card-title" id="home-student">
                {t('Student panel')}
              </h2>
              <p className="panel-choice-tag">{studentTag}</p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t('Subjects with exam dates and a weekly focus target.')}</li>
            <li>{t('Your week as results: what was planned, what got done, how long you focused.')}</li>
            <li>{t('Share a weekly headline with guardians while keeping your reasons private.')}</li>
          </ul>
          <div className="panel-choice-actions">
            {panels.student.enabled ? (
              <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'student' })}>
                {t('Open student panel')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'panels' })}>
                {t('Add student panel')}
              </button>
            )}
          </div>
        </section>

        <section className={cx('card', 'panel-choice', panels.guardian.enabled && 'is-on')} aria-labelledby="home-guardian">
          <div className="panel-choice-head">
            <span className="panel-choice-icon accent-peach">
              <HeartIcon size={19} />
            </span>
            <div>
              <h2 className="card-title" id="home-guardian">
                {t('Guardian panel')}
              </h2>
              <p className="panel-choice-tag">{guardianTag}</p>
            </div>
          </div>
          <ul className="panel-points">
            <li>{t('Watch one or more students, as a parent or as an advisor.')}</li>
            <li>{t('Weekly results only — never the detail of someone’s day.')}</li>
            <li>{t('See the student’s latest shared headline alongside their weekly totals.')}</li>
          </ul>
          <div className="panel-choice-actions">
            {panels.guardian.enabled ? (
              <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'guardian' })}>
                {t('Open guardian panel')}
              </button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'panels' })}>
                {t('Add guardian panel')}
              </button>
            )}
          </div>
        </section>
      </div>

      <p className="panel-footnote">
        {t('Removing a panel does not delete anything from your planner. It only hides that panel’s own pages.')}
      </p>
    </div>
  );
}
