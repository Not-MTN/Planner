/**
 * The front door: the panels you actually have.
 *
 * This is what every open and every login lands on. The personal panel is the
 * planner itself and is always ready; the student and guardian panels appear
 * once they have been added, because a panel is a page of its own rather than a
 * mode to switch between. Somebody who has not added one yet sees a single Add
 * panel tile instead of two cards announcing what they are missing.
 *
 * Nothing here configures anything — choosing is the whole job of this page, so
 * it stays a row of cards and one press each.
 */
import { usePlanner } from '../context';
import { todayISO } from '../dates';
import { faNum, t } from '../i18n';
import { HeartIcon, PlusIcon, SlidersIcon, StudyIcon, SunIcon } from '../icons';
import { eventsForDate } from '../logic';
import { gradeLabel } from '../panels';

export function HomeView() {
  const { state, panels, navigate } = usePlanner();

  const openTasks = state.tasks.filter((task) => !task.completed).length;
  const todayEvents = eventsForDate(state, todayISO()).length;
  const personalTag = `${faNum(openTasks)} ${openTasks === 1 ? t('task') : t('tasks')} · ${faNum(todayEvents)} ${
    todayEvents === 1 ? t('event') : t('events')
  }`;

  const studentTag = `${panels.student.field ?? ''}${panels.student.field && panels.student.grade ? ' · ' : ''}${
    gradeLabel(panels.student.grade) ?? ''
  }`;

  const guardianTag = `${panels.guardian.kind === 'parent' ? t('Parent') : t('Advisor')}${
    panels.guardian.field ? ` · ${panels.guardian.field}` : ''
  }`;

  const extras = (panels.student.enabled ? 1 : 0) + (panels.guardian.enabled ? 1 : 0);
  const missing = !panels.student.enabled || !panels.guardian.enabled;

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

        {panels.student.enabled ? (
          <section className="card panel-choice is-on" aria-labelledby="home-student">
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
              <li>{t('Today, with a streak worth keeping.')}</li>
              <li>{t('Subjects with exam dates and a weekly focus target.')}</li>
              <li>{t('Share a weekly headline with guardians while keeping your reasons private.')}</li>
            </ul>
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'student' })}>
                {t('Open student panel')}
              </button>
            </div>
          </section>
        ) : null}

        {panels.guardian.enabled ? (
          <section className="card panel-choice is-on" aria-labelledby="home-guardian">
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
              <li>{t('Plan their week, send a note, and see how it went.')}</li>
            </ul>
            <div className="panel-choice-actions">
              <button type="button" className="btn btn-primary" onClick={() => navigate({ name: 'guardian' })}>
                {t('Open guardian panel')}
              </button>
            </div>
          </section>
        ) : null}

        {missing ? (
          <button type="button" className="panel-choice panel-choice-add" onClick={() => navigate({ name: 'panels' })}>
            <span className="panel-choice-icon">
              <PlusIcon size={19} />
            </span>
            <span className="panel-choice-add-copy">
              <strong>{extras === 0 ? t('Add a panel') : t('Add another panel')}</strong>
              <span>{t('Student or guardian — your planner stays as it is')}</span>
            </span>
          </button>
        ) : null}
      </div>

      <p className="panel-footnote">
        {t('Removing a panel does not delete anything from your planner. It only hides that panel’s own pages.')}
      </p>
    </div>
  );
}
