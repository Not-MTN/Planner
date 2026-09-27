import { useEffect, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatWeekdayShort, todayISO } from '../dates';
import {
  ArcIcon,
  CalendarIcon,
  CheckIcon,
  DotsIcon,
  DownloadIcon,
  FlagIcon,
  LeafIcon,
  MoonIcon,
  NoteIcon,
  PlusIcon,
  SearchIcon,
  SlidersIcon,
  SunIcon,
  UndoIcon,
  RedoIcon,
  UploadIcon,
} from '../icons';
import { useImportFile } from '../hooks';
import { routeKey, routeTitle, type Route } from '../route';
import { Composer } from './Composer';
import { Confetti } from './Confetti';
import { FocusTimer } from './FocusTimer';
import { Palette } from './Palette';
import { SettingsSheet } from './SettingsSheet';
import { LoadingScreen, Modal } from './ui';
import { CalendarView } from '../views/CalendarView';
import { DayView } from '../views/DayView';
import { GoalsView } from '../views/GoalsView';
import { HabitsView } from '../views/HabitsView';
import { InsightsView } from '../views/InsightsView';
import { NotesView } from '../views/NotesView';
import { TasksView } from '../views/TasksView';

const NAV = [
  { name: 'today', label: 'Today', icon: SunIcon },
  { name: 'calendar', label: 'Calendar', icon: CalendarIcon },
  { name: 'tasks', label: 'Tasks', icon: CheckIcon },
  { name: 'habits', label: 'Habits', icon: DotsIcon },
  { name: 'goals', label: 'Goals', icon: FlagIcon },
  { name: 'notes', label: 'Notes', icon: NoteIcon },
  { name: 'insights', label: 'Insights', icon: ArcIcon },
] as const;

export function Shell() {
  const planner = usePlanner();
  const {
    ready,
    route,
    navigate,
    error,
    notice,
    saveBlocked,
    dismissError,
    startFresh,
    exportData,
    importText,
    composer,
    confirm,
    closeConfirm,
    openComposer,
    requestConfirm,
    paletteOpen,
    openPalette,
    closePalette,
    settingsOpen,
    openSettings,
    undo,
    redo,
    canUndo,
    canRedo,
    setThemeMode,
    isDark,
    confettiSeed,
  } = planner;
  const [moreOpen, setMoreOpen] = useState(false);
  const importFile = useImportFile(importText);
  const key = routeKey(route);
  const today = todayISO();

  useEffect(() => {
    document.title = route.name === 'today' ? 'Planner — today' : `${routeTitle(route)} · Planner`;
    setMoreOpen(false);
  }, [key, route.name]);

  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [route.name]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (paletteOpen) closePalette();
        else openPalette();
        return;
      }
      if (modifier && event.key.toLowerCase() === 'z' && !typing) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || composer || confirm || settingsOpen || moreOpen) return;
      if (event.key === '/') {
        event.preventDefault();
        openPalette();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openComposer({ mode: 'create', type: 'task', date: today });
      } else if (event.key.toLowerCase() === 't') {
        navigate({ name: 'today' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, composer, confirm, settingsOpen, moreOpen, openPalette, closePalette, openComposer, navigate, undo, redo, today]);

  const go = (name: string) => {
    if (name === 'calendar') navigate({ name: 'calendar', tab: 'week', date: today });
    else navigate({ name: name as Route['name'] } as Route);
    setMoreOpen(false);
  };

  const moreActive = ['goals', 'notes', 'insights'].includes(route.name);

  return (
    <div className="app-shell">
      <a className="skip" href="#content">Skip to content</a>
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => navigate({ name: 'today' })}>
          <span className="brand-mark"><LeafIcon size={18} /></span>
          <span className="brand-text">
            <strong>Planner</strong>
            <span>Calm daily planning</span>
          </span>
        </button>
        <button type="button" className="side-search" onClick={openPalette}>
          <SearchIcon size={16} />
          <span>Search or add…</span>
          <kbd className="kbd">⌘K</kbd>
        </button>
        <nav className="side-nav" aria-label="Planner">
          <p className="nav-label">Plan</p>
          {NAV.slice(0, 2).map((item) => (
            <NavButton key={item.name} item={item} active={route.name === item.name || (item.name === 'calendar' && route.name === 'calendar')} onClick={() => go(item.name)} />
          ))}
          <p className="nav-label">Track</p>
          {NAV.slice(2).map((item) => (
            <NavButton key={item.name} item={item} active={route.name === item.name} onClick={() => go(item.name)} />
          ))}
        </nav>
        <div className="side-foot">
          <div className="side-history">
            <button
              type="button"
              className="icon-btn round"
              aria-label="Undo last change"
              title="Undo (⌘Z)"
              disabled={!canUndo}
              onClick={undo}
            >
              <UndoIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-btn round"
              aria-label="Redo"
              title="Redo (⌘⇧Z)"
              disabled={!canRedo}
              onClick={redo}
            >
              <RedoIcon size={16} />
            </button>
          </div>
          <button
            type="button"
            className="side-tool"
            onClick={() => setThemeMode(isDark ? 'light' : 'dark')}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button type="button" className="side-tool" onClick={openSettings} title="Settings">
            <SlidersIcon size={16} />
            <span>Settings</span>
          </button>
          <p className="side-note">Saved on this device</p>
        </div>
      </aside>

      <div className="workspace">
        <header className="mobile-bar">
          <button type="button" className="brand" onClick={() => navigate({ name: 'today' })}>
            <span className="brand-mark"><LeafIcon size={16} /></span>
            <span className="brand-text"><strong>Planner</strong></span>
          </button>
          <div className="mobile-bar-actions">
            <button type="button" className="icon-btn round" aria-label="Search" onClick={openPalette}>
              <SearchIcon size={18} />
            </button>
            <button
              type="button"
              className="icon-btn round"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setThemeMode(isDark ? 'light' : 'dark')}
            >
              {isDark ? <SunIcon size={18} /> : <MoonIcon size={18} />}
            </button>
          </div>
        </header>
        <span className="mobile-date">{formatWeekdayShort(today)} {today.slice(8)}</span>
        <main id="content" className="content">
          {!ready ? <LoadingScreen /> : (
            <>
              {error ? (
                <div className="banner" role="alert">
                  <p>{error}</p>
                  <div className="banner-actions">
                    {saveBlocked ? (
                      <>
                        <button type="button" className="btn btn-tiny" onClick={importFile.open}>Import</button>
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
              <div key={key} className="view-enter">
                {route.name === 'today' ? <DayView date={today} /> : null}
                {route.name === 'day' ? <DayView date={route.date} /> : null}
                {route.name === 'calendar' ? <CalendarView /> : null}
                {route.name === 'tasks' ? <TasksView /> : null}
                {route.name === 'habits' ? <HabitsView /> : null}
                {route.name === 'goals' ? <GoalsView /> : null}
                {route.name === 'notes' ? <NotesView /> : null}
                {route.name === 'insights' ? <InsightsView /> : null}
              </div>
            </>
          )}
        </main>
      </div>

      <nav className="tabbar" aria-label="Primary">
        <Tab icon={SunIcon} label="Today" active={route.name === 'today'} onClick={() => go('today')} />
        <Tab icon={CalendarIcon} label="Calendar" active={route.name === 'calendar'} onClick={() => go('calendar')} />
        <Tab icon={CheckIcon} label="Tasks" active={route.name === 'tasks'} onClick={() => go('tasks')} />
        <Tab icon={DotsIcon} label="Habits" active={route.name === 'habits'} onClick={() => go('habits')} />
        <Tab icon={SlidersIcon} label="More" active={moreActive || moreOpen} onClick={() => setMoreOpen(true)} />
      </nav>

      <button
        type="button"
        className="fab"
        aria-label="Quick add"
        onClick={openPalette}
      >
        <PlusIcon />
      </button>

      {moreOpen ? (
        <Modal title="More" onClose={() => setMoreOpen(false)}>
          <div className="more-list">
            <button type="button" className={cx(route.name === 'goals' && 'on')} onClick={() => go('goals')}>
              <FlagIcon size={18} /> Goals
            </button>
            <button type="button" className={cx(route.name === 'notes' && 'on')} onClick={() => go('notes')}>
              <NoteIcon size={18} /> Notes
            </button>
            <button type="button" className={cx(route.name === 'insights' && 'on')} onClick={() => go('insights')}>
              <ArcIcon size={18} /> Insights
            </button>
            <button type="button" onClick={openPalette}><SearchIcon size={18} /> Search &amp; quick add</button>
            <button type="button" onClick={openSettings}><SlidersIcon size={18} /> Settings</button>
            <button type="button" onClick={exportData}><DownloadIcon size={18} /> Export backup</button>
            <button type="button" onClick={importFile.open}><UploadIcon size={18} /> Import backup</button>
          </div>
        </Modal>
      ) : null}

      {composer ? <Composer /> : null}
      {settingsOpen ? <SettingsSheet /> : null}
      {paletteOpen ? <Palette /> : null}
      <FocusTimer />
      <Confetti seed={confettiSeed} />
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
      {notice ? (
        <div className="toast" role="status">
          <span>{notice.message}</span>
          {notice.action ? (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                notice.action?.run();
                planner.dismissNotice();
              }}
            >
              {notice.action.label}
            </button>
          ) : null}
        </div>
      ) : null}
      <input ref={importFile.ref} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="application/json,.json" onChange={importFile.onChange} />
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
