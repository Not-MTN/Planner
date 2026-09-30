import { useEffect, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatWeekdayShort, todayISO } from '../dates';
import {
  ArcIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  DotsIcon,
  DownloadIcon,
  ExitIcon,
  FlagIcon,
  LeafIcon,
  MoonIcon,
  NoteIcon,
  PlusIcon,
  SearchIcon,
  HelpIcon,
  HeartIcon,
  HorizonIcon,
  SlidersIcon,
  SparklesIcon,
  StudyIcon,
  SunIcon,
  UndoIcon,
  RedoIcon,
  UploadIcon,
  WeekIcon,
} from '../icons';
import { useImportFile } from '../hooks';
import { routeKey, routeTitle, type Route } from '../route';
import { Composer } from './Composer';
import { Confetti } from './Confetti';
import { FocusTimer } from './FocusTimer';
import { Palette } from './Palette';
import { SettingsSheet } from './SettingsSheet';
import { LoadingScreen, Modal } from './ui';
import { lazy, Suspense } from 'react';
import { DayView } from '../views/DayView';
import { GoalsView } from '../views/GoalsView';
import { HabitsView } from '../views/HabitsView';
import { NotesView } from '../views/NotesView';
import { TasksView } from '../views/TasksView';
import { MatrixView } from '../views/MatrixView';
import { ShortcutsSheet } from './ShortcutsSheet';
import { WeeklyReview } from './WeeklyReview';
import { NotificationsSheet } from './NotificationsSheet';
import { clearNotifications, loadNotifications, markNotificationsRead, subscribeNotifications } from '../notificationCenter';
import { loadNavigationPages, subscribeNavigationPages } from '../navigationPrefs';

const CalendarView = lazy(() => import('../views/CalendarView').then((m) => ({ default: m.CalendarView })));
const InsightsView = lazy(() => import('../views/InsightsView').then((m) => ({ default: m.InsightsView })));
const AIView = lazy(() => import('../views/AIView').then((m) => ({ default: m.AIView })));
const PlansView = lazy(() => import('../views/PlansView').then((m) => ({ default: m.PlansView })));
// Optional panels: only downloaded once someone actually adds one.
const PanelsView = lazy(() => import('../views/PanelsView').then((m) => ({ default: m.PanelsView })));
const StudentPanelView = lazy(() => import('../views/StudentPanelView').then((m) => ({ default: m.StudentPanelView })));
const GuardianPanelView = lazy(() => import('../views/GuardianPanelView').then((m) => ({ default: m.GuardianPanelView })));
import { applyUpdate, onUpdateAvailable } from '../pwa';
import { isAIVisited, onTourRequest, requestTour, TOUR_STOPS, tourRouteFor, tourStartIndex } from '../tour';
import { onAboutRequest, requestAbout } from '../about';
import { TourSheet } from './TourSheet';
import { AboutSheet } from './AboutSheet';
import { useSignOut } from './useSignOut';
import { accountUser } from '../auth/vault';
import { t } from '../i18n';

/** The signed-in account in one glance — name initial for the avatar. */
function accountInitial(name: string): string {
  const first = name.trim().charAt(0);
  return first ? first.toUpperCase() : '·';
}

const NAV = [
  { name: 'today', label: t("Today"), icon: SunIcon },
  { name: 'calendar', label: t("Calendar"), icon: CalendarIcon },
  { name: 'tasks', label: t("Tasks"), icon: CheckIcon },
  { name: 'matrix', label: t("Matrix"), icon: FlagIcon },
  { name: 'habits', label: t("Habits"), icon: DotsIcon },
  { name: 'goals', label: t("Goals"), icon: HorizonIcon },
  { name: 'notes', label: t("Notes"), icon: NoteIcon },
  { name: 'plans', label: t("Plans"), icon: WeekIcon },
  { name: 'insights', label: t("Insights"), icon: ArcIcon },
  { name: 'ai', label: t("AI coach"), icon: SparklesIcon },
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
    syncStatus,
    undo,
    redo,
    canUndo,
    canRedo,
    setThemeMode,
    isDark,
    confettiSeed,
  } = planner;
  const [moreOpen, setMoreOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationItems, setNotificationItems] = useState(loadNotifications);
  const [visiblePages, setVisiblePages] = useState(loadNavigationPages);
  const unreadNotifications = notificationItems.filter((item) => !item.read).length;
  useEffect(() => subscribeNotifications(() => setNotificationItems(loadNotifications())), []);
  useEffect(() => subscribeNavigationPages(() => setVisiblePages(loadNavigationPages())), []);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Sign-out only appears for an account this device knows: the live vault
  // session, or the last signed-in user when the vault opened from the
  // trusted-device cache (offline boots). A local-only planner has nobody to
  // sign out, so the button would be a dead end.
  const account = accountUser();
  const requestSignOut = useSignOut();
  // Panels only show up once they are added — they are extras, never a mode.
  const panelNav = [
    ...(planner.panels.student.enabled ? [{ name: 'student' as const, label: t("Student"), icon: StudyIcon }] : []),
    ...(planner.panels.guardian.enabled ? [{ name: 'guardian' as const, label: t("Guardian"), icon: HeartIcon }] : []),
  ];
  const planNav = NAV.slice(0, 4).filter((item) => visiblePages.includes(item.name));
  const focusNav = NAV.slice(4, 6).filter((item) => visiblePages.includes(item.name));
  const trackNav = NAV.slice(6).filter((item) => visiblePages.includes(item.name));
  const importFile = useImportFile(importText);
  const key = routeKey(route);
  const today = todayISO();

  useEffect(() => {
    document.title = route.name === 'today' ? t("Planner — today") : t("{0} · Planner", { 0: routeTitle(route) });
    setMoreOpen(false);
  }, [key, route.name]);

  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [route.name]);

  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => onUpdateAvailable(() => setUpdateReady(true)), []);

  // First-run tour: opens by itself on the very first boot (and resumes after
  // a language-switch reload); replayable from the (?) side tool or Settings.
  const [tourStep, setTourStep] = useState<number | null>(null);
  useEffect(() => {
    if (!ready) return;
    const start = tourStartIndex();
    if (start !== null) setTourStep(start);
  }, [ready]);
  useEffect(() => onTourRequest(() => setTourStep(0)), []);
  // The tour walks the real pages: each stop navigates to the tab it teaches.
  useEffect(() => {
    if (tourStep === null || !ready) return;
    const dest = tourRouteFor(TOUR_STOPS[tourStep], today);
    if (dest) navigate(dest);
  }, [tourStep, ready, navigate, today]);
  const closeTour = () => {
    setTourStep(null);
    navigate({ name: 'today' });
  };
  // One-time attention dot on the AI coach until it has been opened.
  const [aiSeen, setAiSeen] = useState(isAIVisited);
  useEffect(() => {
    setAiSeen(isAIVisited());
  }, [route.name]);
  const [aboutOpen, setAboutOpen] = useState(false);
  useEffect(() => onAboutRequest(() => setAboutOpen(true)), []);

  // The PWA shortcut / #/today?qa=1 deep link: drop the caret straight into quick add.
  useEffect(() => {
    if (route.name !== 'quickadd') return;
    const id = window.setTimeout(() => {
      (document.querySelector<HTMLInputElement>('.quick-add input') ?? document.querySelector<HTMLInputElement>('input[aria-autocomplete]'))?.focus();
    }, 120);
    return () => window.clearTimeout(id);
  }, [route.name, key]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (event.isComposing || event.keyCode === 229) return;
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
      if (typing || composer || confirm || settingsOpen || moreOpen || tourStep !== null || aboutOpen || shortcutsOpen || reviewOpen) return;
      if (event.key === '/') {
        event.preventDefault();
        openPalette();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        openComposer({ mode: 'create', type: 'task', date: today });
      } else if (event.key.toLowerCase() === 't') {
        navigate({ name: 'today' });
      } else if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        navigate({ name: 'matrix' } as Route);
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        setReviewOpen(true);
      } else if (event.key === '?' || (event.shiftKey && event.key === '/')) {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, composer, confirm, settingsOpen, moreOpen, tourStep, aboutOpen, shortcutsOpen, reviewOpen, openPalette, closePalette, openComposer, openSettings, navigate, undo, redo, today]);

  const go = (name: string) => {
    if (name === 'calendar') navigate({ name: 'calendar', tab: 'week', date: today });
    else navigate({ name: name as Route['name'] } as Route);
    setMoreOpen(false);
  };

  const moreActive = ['goals', 'notes', 'insights', 'ai', 'plans', 'matrix', 'review'].includes(route.name);

  return (
    <div className="app-shell">
      <a className="skip" href="#content">{t("Skip to content")}</a>
      <aside className="sidebar">
        <button type="button" className="brand" onClick={() => navigate({ name: 'today' })}>
          <span className="brand-mark"><LeafIcon size={18} /></span>
          <span className="brand-text">
            <strong>{t("Planner")}</strong>
            <span>{t("Calm daily planning")}</span>
          </span>
        </button>
        <button type="button" className="side-search" data-tour="search" onClick={openPalette}>
          <SearchIcon size={16} />
          <span>{t("Search or add…")}</span>
          <kbd className="kbd">{t("⌘K")}</kbd>
        </button>
        <nav className="side-nav" aria-label={t("Planner")}>
          {planNav.length > 0 ? <><p className="nav-label">{t("Plan")}</p>
            {planNav.map((item) => <NavButton key={item.name} item={item} active={route.name === item.name || (item.name === 'calendar' && route.name === 'calendar')} attention={item.name === 'ai' && !aiSeen} onClick={() => go(item.name)} />)}</> : null}
          {focusNav.length > 0 ? <><p className="nav-label">{t("Focus")}</p>
            {focusNav.map((item) => <NavButton key={item.name} item={item} active={route.name === item.name} onClick={() => go(item.name)} />)}</> : null}
          {trackNav.length > 0 ? <><p className="nav-label">{t("Track")}</p>
            {trackNav.map((item) => <NavButton key={item.name} item={item} active={route.name === item.name} attention={item.name === 'ai' && !aiSeen} onClick={() => go(item.name)} />)}</> : null}
          {panelNav.length > 0 ? (
            <>
              <p className="nav-label">{t("Panels")}</p>
              {panelNav.map((item) => (
                <NavButton key={item.name} item={item} active={route.name === item.name} onClick={() => go(item.name)} />
              ))}
              <NavButton
                item={{ name: 'panels', label: t("All panels"), icon: HorizonIcon }}
                active={route.name === 'panels'}
                onClick={() => go('panels')}
              />
            </>
          ) : null}
        </nav>
        <div className="side-foot">
          <div className="side-history">
            <button
              type="button"
              className="icon-btn round"
              aria-label={t("Undo last change")}
              title={t("Undo (⌘Z)")}
              disabled={!canUndo}
              onClick={undo}
            >
              <UndoIcon size={16} />
            </button>
            <button
              type="button"
              className="icon-btn round"
              aria-label={t("Redo")}
              title={t("Redo (⌘⇧Z)")}
              disabled={!canRedo}
              onClick={redo}
            >
              <RedoIcon size={16} />
            </button>
          </div>
          <button type="button" className="side-tool notification-trigger" onClick={() => setNotificationsOpen(true)}>
            <BellIcon size={16} />
            <span>{t("Notifications")}</span>
            {unreadNotifications > 0 ? <span className="notification-badge">{unreadNotifications > 9 ? '9+' : unreadNotifications}</span> : null}
          </button>
          <button
            type="button"
            className="side-tool"
            onClick={() => setThemeMode(isDark ? 'light' : 'dark')}
            title={isDark ? t("Switch to light mode") : t("Switch to dark mode")}
          >
            {isDark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            <span>{isDark ? t("Light mode") : t("Dark mode")}</span>
          </button>
          <button type="button" className="side-tool side-help" onClick={() => requestTour()} title={t("How Planner works")}>
            <HelpIcon size={16} />
            <span>{t("How it works")}</span>
          </button>
          <button type="button" className="side-tool" data-tour="settings" onClick={openSettings} title={t("Settings")}>
            <SlidersIcon size={16} />
            <span>{t("Settings")}</span>
          </button>
          <p className="side-note">
            {syncStatus === 'off' ? t("Saved on this device") : (
              <>
                <i className={`sync-dot ${syncStatus}`} aria-hidden="true" />{' '}
                {syncStatus === 'syncing' ? t("Syncing…") : syncStatus === 'error' ? t("Sync problem") : syncStatus === 'offline' ? t("Offline · saved here") : t("Synced")}
              </>
            )}
          </p>
          {account ? (
            <div className="side-account">
              <div className="side-account-id">
                <span className="account-avatar" aria-hidden="true">
                  {accountInitial(account.displayName || account.username)}
                </span>
                <span className="account-meta">
                  <span className="account-name">{account.displayName || account.username}</span>
                  <span className="account-sub" dir="ltr">
                    {account.email ?? `@${account.username}`}
                  </span>
                </span>
              </div>
              <button type="button" className="side-signout" onClick={requestSignOut} title={t("Sign out")}>
                <ExitIcon size={15} />
                <span>{t("Sign out")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="workspace">
        <header className="mobile-bar">
          <button type="button" className="brand" onClick={() => navigate({ name: 'today' })}>
            <span className="brand-mark"><LeafIcon size={16} /></span>
            <span className="brand-text"><strong>{t("Planner")}</strong></span>
          </button>
          <div className="mobile-bar-actions">
            <button
              type="button"
              className="icon-btn round ai-orb"
              aria-label={t("AI coach")}
              title={t("AI coach")}
              onClick={() => navigate({ name: 'ai', tab: 'plan' })}
            >
              <SparklesIcon size={18} />
              {!aiSeen ? <i className="nav-attention" aria-hidden="true" /> : null}
            </button>
            <button type="button" className="icon-btn round notification-trigger" aria-label={unreadNotifications ? t("Notifications · {0} unread", { 0: unreadNotifications }) : t("Notifications")} title={t("Notifications")} onClick={() => setNotificationsOpen(true)}>
              <BellIcon size={18} />
              {unreadNotifications > 0 ? <i className="notification-dot" aria-hidden="true" /> : null}
            </button>
            <button type="button" className="icon-btn round" aria-label={t("Search")} data-tour="search" onClick={openPalette}>
              <SearchIcon size={18} />
            </button>
            <button
              type="button"
              className="icon-btn round"
              aria-label={isDark ? t("Switch to light mode") : t("Switch to dark mode")}
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
                        <button type="button" className="btn btn-tiny" onClick={importFile.open}>{t("Import")}</button>
                        <button
                          type="button"
                          className="btn btn-tiny danger"
                          onClick={() =>
                            requestConfirm({
                              title: t("Start fresh?"),
                              body: t("This clears the planner in this browser. Export a backup first if you might want the old data."),
                              confirmLabel: t("Start fresh"),
                              onConfirm: startFresh,
                            })
                          }
                        >
                          {t("Start fresh")}
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn btn-tiny" onClick={dismissError}>{t("Dismiss")}</button>
                    )}
                  </div>
                </div>
              ) : null}
              <div key={key} className="view-enter">
                <Suspense fallback={<LoadingScreen />}>
                  {route.name === 'today' || route.name === 'quickadd' ? <DayView date={today} /> : null}
                  {route.name === 'day' ? <DayView date={route.date} /> : null}
                  {route.name === 'calendar' ? <CalendarView /> : null}
                  {route.name === 'tasks' ? <TasksView /> : null}
                  {route.name === 'matrix' ? <MatrixView tasks={planner.state.tasks} /> : null}
                  {route.name === 'review' ? <div className="view"><WeeklyReview state={planner.state} onClose={() => go('today')} /></div> : null}
                  {route.name === 'habits' ? <HabitsView /> : null}
                  {route.name === 'goals' ? <GoalsView /> : null}
                  {route.name === 'notes' ? <NotesView /> : null}
                  {route.name === 'insights' ? <InsightsView /> : null}
                  {route.name === 'ai' ? <AIView /> : null}
                  {route.name === 'plans' ? <PlansView /> : null}
                  {route.name === 'panels' ? <PanelsView /> : null}
                  {route.name === 'student' ? <StudentPanelView /> : null}
                  {route.name === 'guardian' ? <GuardianPanelView /> : null}
                </Suspense>
              </div>
            </>
          )}
        </main>
      </div>

      <nav className="tabbar" aria-label={t("Primary")}>
        <Tab icon={SunIcon} name="today" label={t("Today")} active={route.name === 'today'} onClick={() => go('today')} />
        <Tab icon={CalendarIcon} name="calendar" label={t("Calendar")} active={route.name === 'calendar'} onClick={() => go('calendar')} />
        {/* The add action lives in the bar itself, centred for the thumb,
            instead of a floating button that lands on top of the content. */}
        <button type="button" className="tab tab-add" aria-label={t("Quick add")} onClick={openPalette}>
          <span className="tab-add-puck"><PlusIcon size={20} /></span>
        </button>
        <Tab icon={CheckIcon} name="tasks" label={t("Tasks")} active={route.name === 'tasks'} onClick={() => go('tasks')} />
        <Tab icon={DotsIcon} name="habits" label={t("Habits")} active={route.name === 'habits'} onClick={() => go('habits')} />
        <Tab icon={SlidersIcon} label={t("More")} active={moreActive || moreOpen} onClick={() => setMoreOpen(true)} />
      </nav>

      {moreOpen ? (
        <Modal title={t("More")} onClose={() => setMoreOpen(false)}>
          <div className="more-list">
            {account ? (
              <>
                <div className="more-account">
                  <span className="account-avatar" aria-hidden="true">
                    {accountInitial(account.displayName || account.username)}
                  </span>
                  <span className="account-meta">
                    <span className="account-name">{account.displayName || account.username}</span>
                    <span className="account-sub" dir="ltr">
                      {account.email ?? `@${account.username}`}
                    </span>
                  </span>
                </div>
                <div className="more-divider" role="separator" />
              </>
            ) : null}
            {/* Destinations as a grid of tiles: the old single 17-row column
                made every tab switch a long scroll on a phone. */}
            <div className="more-grid">
              <button type="button" className={cx('more-tile', route.name === 'goals' && 'on')} onClick={() => go('goals')}>
                <FlagIcon size={18} /> <span>{t("Goals")}</span>
              </button>
              <button type="button" className={cx('more-tile', route.name === 'notes' && 'on')} onClick={() => go('notes')}>
                <NoteIcon size={18} /> <span>{t("Notes")}</span>
              </button>
              <button type="button" className={cx('more-tile', route.name === 'insights' && 'on')} onClick={() => go('insights')}>
                <ArcIcon size={18} /> <span>{t("Insights")}</span>
              </button>
              <button type="button" className={cx('more-tile', route.name === 'matrix' && 'on')} onClick={() => go('matrix')}>
                <FlagIcon size={18} /> <span>{t("Matrix")}</span>
              </button>
              <button type="button" className="more-tile" onClick={() => { setMoreOpen(false); setNotificationsOpen(true); }}>
                <BellIcon size={18} />{' '}
                <span>
                  {t("Notifications")}
                  {unreadNotifications > 0 ? <span className="notification-badge">{unreadNotifications}</span> : null}
                </span>
              </button>
              <button type="button" className={cx('more-tile', route.name === 'review' && 'on')} onClick={() => go('review')}>
                <WeekIcon size={18} /> <span>{t("Weekly Review")}</span>
              </button>
              <button type="button" className={cx('more-tile', route.name === 'ai' && 'on')} onClick={() => go('ai')}>
                <SparklesIcon size={18} />{' '}
                <span>
                  {t("AI coach")}
                  {!aiSeen ? <i className="nav-attention more-attention" aria-hidden="true" /> : null}
                </span>
              </button>
              <button type="button" className={cx('more-tile', route.name === 'plans' && 'on')} onClick={() => go('plans')}>
                <WeekIcon size={18} /> <span>{t("Plans")}</span>
              </button>
              {panelNav.map((item) => (
                <button key={item.name} type="button" className={cx('more-tile', route.name === item.name && 'on')} onClick={() => go(item.name)}>
                  <item.icon size={18} /> <span>{item.label}</span>
                </button>
              ))}
              <button type="button" className={cx('more-tile', route.name === 'panels' && 'on')} onClick={() => go('panels')}>
                <HorizonIcon size={18} /> <span>{t("Panels")}</span>
              </button>
            </div>
            <div className="more-divider" role="separator" />
            {/* Utilities collapse into a tight two-column row. */}
            <details className="more-tools">
              <summary className="more-tools-summary">
                <SlidersIcon size={18} />
                <span>{t("Tools & settings")}</span>
                <span className="more-tools-hint">{t("Settings, backups and help")}</span>
              </summary>
              <div className="more-actions">
                <button type="button" onClick={() => { setMoreOpen(false); setShortcutsOpen(true); }}><HelpIcon size={18} /> {t("Keyboard shortcuts")}</button>
                <button type="button" onClick={() => { setMoreOpen(false); openSettings(); }}><SlidersIcon size={18} /> {t("Settings")}</button>
                <button type="button" onClick={() => { setMoreOpen(false); requestTour(); }}><HelpIcon size={18} /> {t("How Planner works")}</button>
                <button type="button" onClick={() => { setMoreOpen(false); window.setTimeout(requestAbout, 60); }}><HeartIcon size={18} /> {t("Why Planner?")}</button>
                <button type="button" onClick={() => { setMoreOpen(false); exportData(); }}><DownloadIcon size={18} /> {t("Export backup")}</button>
                <button type="button" onClick={() => { setMoreOpen(false); importFile.open(); }}><UploadIcon size={18} /> {t("Import backup")}</button>
              </div>
              {account ? (
                <button type="button" className="more-signout" onClick={() => { setMoreOpen(false); requestSignOut(); }}>
                  <ExitIcon size={18} /> {t("Sign out")}
                </button>
              ) : null}
            </details>
          </div>
        </Modal>
      ) : null}

      {notificationsOpen ? (
        <NotificationsSheet
          items={notificationItems}
          onClose={() => setNotificationsOpen(false)}
          onOpenToday={() => { setNotificationsOpen(false); navigate({ name: 'today' }); }}
          onMarkAllRead={() => markNotificationsRead()}
          onClear={() => clearNotifications()}
          onRead={(key) => markNotificationsRead([key])}
        />
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
              <button type="button" className="btn btn-ghost" data-autofocus onClick={closeConfirm}>{t("Cancel")}</button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  confirm.onConfirm();
                  closeConfirm();
                }}
              >
                {confirm.confirmLabel ?? t("Remove")}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
      {updateReady ? (
        <div className="toast update-toast" role="status">
          <span>{t("A new version of Planner is ready.")}</span>
          <button type="button" className="toast-action" onClick={() => applyUpdate()}>
            {t("Update now")}
          </button>
          <button type="button" className="toast-action" onClick={() => setUpdateReady(false)} aria-label={t("Later")}>
            {t("Later")}
          </button>
        </div>
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
      {tourStep !== null && ready ? (
        <TourSheet step={tourStep} onStep={setTourStep} onClose={closeTour} />
      ) : null}
      {aboutOpen ? <AboutSheet onClose={() => setAboutOpen(false)} /> : null}
      {shortcutsOpen ? <ShortcutsSheet onClose={() => setShortcutsOpen(false)} /> : null}
      {reviewOpen ? (
        <Modal title={t("Weekly Review")} onClose={() => setReviewOpen(false)}>
          <WeeklyReview state={planner.state} onClose={() => setReviewOpen(false)} />
        </Modal>
      ) : null}
      <input ref={importFile.ref} className="visually-hidden" tabIndex={-1} aria-hidden="true" type="file" accept="application/json,.json" onChange={importFile.onChange} />
    </div>
  );
}

function NavButton({
  item,
  active,
  attention,
  onClick,
}: {
  item: { name: string; label: string; icon: typeof SunIcon };
  active: boolean;
  attention?: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button type="button" data-tour-nav={item.name} className={cx('nav-link', active && 'active')} aria-current={active ? 'page' : undefined} title={item.label} onClick={onClick}>
      <span className="nav-icon-wrap">
        <Icon size={18} />
        {attention && !active ? <i className="nav-attention" aria-hidden="true" /> : null}
      </span>
      <span className="nav-text">{item.label}</span>
    </button>
  );
}

function Tab({
  icon: Icon,
  label,
  active,
  name,
  onClick,
}: {
  icon: typeof SunIcon;
  label: string;
  active: boolean;
  name?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" data-tour-nav={name} className={cx('tab', active && 'active')} aria-current={active ? 'page' : undefined} onClick={onClick}>
      <span className="tab-icon"><Icon size={20} /></span>
      {label}
    </button>
  );
}
