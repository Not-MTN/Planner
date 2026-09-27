import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatWeekdayShort, todayISO } from '../dates';
import {
  ArcIcon,
  BookIcon,
  CalendarIcon,
  CheckIcon,
  HorizonIcon,
  DownloadIcon,
  DotsIcon,
  FlagIcon,
  LeafIcon,
  NoteIcon,
  PlusIcon,
  SunIcon,
  UploadIcon,
  WeekIcon,
} from '../icons';
import { routeKey, routeTitle, type Route } from '../route';
import { Composer } from './Composer';
import { LoadingScreen, Modal } from './ui';
import { DailyView } from '../views/DailyView';
import { GoalsView } from '../views/GoalsView';
import { HabitsView } from '../views/HabitsView';
import { MonthlyView } from '../views/MonthlyView';
import { NotesView } from '../views/NotesView';
import { ProgressView } from '../views/ProgressView';
import { TasksView } from '../views/TasksView';
import { TodayView } from '../views/TodayView';
import { FutureView } from '../views/FutureView';
import { WeeklyView } from '../views/WeeklyView';

const PLAN = [
  { name: 'today', label: 'Today', icon: SunIcon },
  { name: 'daily', label: 'Daily', icon: BookIcon },
  { name: 'weekly', label: 'Week', icon: WeekIcon },
  { name: 'monthly', label: 'Month', icon: CalendarIcon },
  { name: 'future', label: 'Future', icon: HorizonIcon },
] as const;

const TRACK = [
  { name: 'tasks', label: 'Tasks', icon: CheckIcon },
  { name: 'habits', label: 'Habits', icon: DotsIcon },
  { name: 'goals', label: 'Goals', icon: FlagIcon },
  { name: 'notes', label: 'Notes', icon: NoteIcon },
  { name: 'progress', label: 'Progress', icon: ArcIcon },
] as const;

export function Shell() {
  const planner = usePlanner();
  const { ready, route, navigate, error, notice, saveBlocked, dismissError, startFresh, exportData, importText, composer, confirm, closeConfirm, openComposer, requestConfirm } = planner;
  const [moreOpen, setMoreOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  const key = routeKey(route);
  const today = todayISO();

  useEffect(() => {
    document.title = route.name === 'today' ? 'Personal Planner' : `${routeTitle(route)} · Personal Planner`;
    setMoreOpen(false);
  }, [key, route.name]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    const heading = document.querySelector('h1');
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [route.name]);

  const go = (name: string) => {
    const now = new Date();
    if (name === 'daily') navigate({ name: 'daily', date: route.name === 'daily' ? route.date : today });
    else if (name === 'weekly') navigate({ name: 'weekly', date: route.name === 'weekly' ? route.date : today });
    else if (name === 'monthly') {
      if (route.name === 'monthly') navigate(route);
      else navigate({ name: 'monthly', year: now.getFullYear(), month: now.getMonth() + 1 });
    } else navigate({ name: name as Route['name'] } as Route);
    setMoreOpen(false);
  };

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      importText(await file.text());
    } catch {
      importText('');
    }
  };

  const moreActive = ['daily', 'future', 'habits', 'goals', 'notes', 'progress'].includes(route.name);

  return (
    <div className="app-shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => navigate({ name: 'today' })}>
          <span className="brand-mark"><LeafIcon size={18} /></span>
          <span className="brand-text">
            <small>Personal</small>
            <strong>Planner</strong>
          </span>
        </button>
        <button type="button" className="side-add" aria-label="Quick add" onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}>
          <PlusIcon size={16} />
          <span>Quick add</span>
        </button>
        <nav className="side-nav" aria-label="Planner">
          <p className="nav-label">Plan</p>
          {PLAN.map((item) => (
            <NavButton key={item.name} item={item} active={route.name === item.name} onClick={() => go(item.name)} />
          ))}
          <p className="nav-label">Track</p>
          {TRACK.map((item) => (
            <NavButton key={item.name} item={item} active={route.name === item.name} onClick={() => go(item.name)} />
          ))}
        </nav>
        <div className="side-foot">
          <button type="button" className="side-tool" onClick={exportData} title="Export backup">
            <DownloadIcon size={16} />
            <span>Export</span>
          </button>
          <button type="button" className="side-tool" onClick={() => fileRef.current?.click()} title="Import backup">
            <UploadIcon size={16} />
            <span>Import</span>
          </button>
          <p className="side-note">Stored on this device</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="mobile-bar">
          <button type="button" className="brand" onClick={() => navigate({ name: 'today' })}>
            <span className="brand-mark"><LeafIcon size={16} /></span>
            <span className="brand-text"><strong>Planner</strong></span>
          </button>
          <span className="mobile-date">{formatWeekdayShort(today)} {today.slice(8)}</span>
        </header>
        <main id="content" className="content">
          {!ready ? <LoadingScreen /> : (
            <>
              {error ? (
                <div className="banner" role="alert">
                  <p>{error}</p>
                  <div className="banner-actions">
                    {saveBlocked ? (
                      <>
                        <button type="button" className="btn btn-tiny" onClick={() => fileRef.current?.click()}>Import</button>
                        <button
                          type="button"
                          className="btn btn-tiny danger"
                          onClick={() =>
                            requestConfirm({
                              title: 'Start fresh?',
                              body: 'This clears the planner in this browser. Export a backup first if you might want the old data.',
                              confirmLabel: 'Start fresh',
                              onConfirm: startFresh,
                            })
                          }
                        >
                          Start fresh
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-tiny" onClick={dismissError}>Dismiss</button>
                    )}
                  </div>
                </div>
              ) : null}
              <div key={route.name} className="view-enter">
                {route.name === 'today' ? <TodayView /> : null}
                {route.name === 'daily' ? <DailyView /> : null}
                {route.name === 'weekly' ? <WeeklyView /> : null}
                {route.name === 'monthly' ? <MonthlyView /> : null}
                {route.name === 'future' ? <FutureView /> : null}
                {route.name === 'tasks' ? <TasksView /> : null}
                {route.name === 'habits' ? <HabitsView /> : null}
                {route.name === 'goals' ? <GoalsView /> : null}
                {route.name === 'notes' ? <NotesView /> : null}
                {route.name === 'progress' ? <ProgressView /> : null}
              </div>
            </>
          )}
        </main>
      </div>

      <nav className="tabbar" aria-label="Primary">
        <Tab icon={SunIcon} label="Today" active={route.name === 'today'} onClick={() => go('today')} />
        <Tab icon={WeekIcon} label="Week" active={route.name === 'weekly'} onClick={() => go('weekly')} />
        <Tab icon={CalendarIcon} label="Month" active={route.name === 'monthly'} onClick={() => go('monthly')} />
        <Tab icon={CheckIcon} label="Tasks" active={route.name === 'tasks'} onClick={() => go('tasks')} />
        <Tab icon={DotsIcon} label="More" active={moreActive || moreOpen} onClick={() => setMoreOpen(true)} />
      </nav>

      <button
        type="button"
        className="fab"
        aria-label="Quick add"
        onClick={() => openComposer({ mode: 'create', type: 'task', date: today })}
      >
        <PlusIcon />
      </button>

      {moreOpen ? (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          <div className="more-list">
            <button type="button" className={cx(route.name === 'daily' && 'on')} onClick={() => go('daily')}>
              <BookIcon size={18} /> Daily planner
            </button>
            <button type="button" className={cx(route.name === 'future' && 'on')} onClick={() => go('future')}>
              <HorizonIcon size={18} /> Future
            </button>
            {TRACK.filter((item) => item.name !== 'tasks').map((item) => (
              <button key={item.name} type="button" onClick={() => go(item.name)}>
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
            <button type="button" onClick={exportData}><DownloadIcon size={18} /> Export backup</button>
            <button type="button" onClick={() => fileRef.current?.click()}><UploadIcon size={18} /> Import backup</button>
          </div>
        </Modal>
      ) : null}

      {composer ? <Composer /> : null}
      {confirm ? (
        <Modal title={confirm.title} onClose={closeConfirm} className="sheet-confirm">
          <div className="confirm-copy">
            <p>{confirm.body}</p>
            <div className="form-actions">
              <button type="button" className="btn btn-ghost" data-autofocus onClick={closeConfirm}>Cancel</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  confirm.onConfirm();
                  closeConfirm();
                }}
              >
                {confirm.confirmLabel ?? 'Remove'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      <input ref={fileRef} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="application/json,.json" onChange={onFile} />
    </div>
  );
}

function NavButton({
  item,
  active,
  onClick,
}: {
  item: { name: string; label: string; icon: typeof SunIcon };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button type="button" className={cx('nav-link', active && 'active')} aria-current={active ? 'page' : undefined} title={item.label} onClick={onClick}>
      <Icon size={18} />
      <span className="nav-text">{item.label}</span>
    </button>
  );
}

function Tab({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof SunIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className={cx('tab', active && 'active')} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <span className="tab-icon"><Icon size={20} /></span>
      {label}
    </button>
  );
}
