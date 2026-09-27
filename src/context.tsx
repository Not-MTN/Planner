import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseHash, toHash, type Route } from './route';
import { downloadState, loadFrom, parseBackup, sanitizeState, saveTo, serialize, STORAGE_FULL, STORAGE_KEY } from './storage';
import { idbRead, idbWrite, savedAt } from './idb';
import {
  addEvent as addEventTo,
  addFixedCommitment as addFixedCommitmentTo,
  deleteFixedCommitment as deleteFixedCommitmentFrom,
  updateFixedCommitment as updateFixedCommitmentIn,
  addGoal as addGoalTo,
  addHabit as addHabitTo,
  addHabits as addHabitsTo,
  addMilestone as addMilestoneTo,
  addNote as addNoteTo,
  addTask as addTaskTo,
  clearCompletedTasks as clearCompletedTasksIn,
  deleteEvent as deleteEventFrom,
  deleteGoal as deleteGoalFrom,
  deleteHabit as deleteHabitFrom,
  deleteMilestone as deleteMilestoneFrom,
  deleteNote as deleteNoteFrom,
  deleteTask as deleteTaskFrom,
  moveEvent as moveEventIn,
  moveTask as moveTaskIn,
  setHabitArchived as setHabitArchivedIn,
  setIntention as setIntentionIn,
  swapEventTimes as swapEventTimesIn,
  swapTasks as swapTasksIn,
  toggleEvent as toggleEventIn,
  toggleHabit as toggleHabitIn,
  toggleMilestone as toggleMilestoneIn,
  toggleTask as toggleTaskIn,
  toggleSubtask as toggleSubtaskIn,
  resizeEvent as resizeEventIn,
  logFocus as logFocusIn,
  updateEvent as updateEventIn,
  updateGoal as updateGoalIn,
  updateHabit as updateHabitIn,
  updateNote as updateNoteIn,
  updateTask as updateTaskIn,
} from './mutate';
import { loadDisplayPrefs, loadWeekStart, setDisplayPrefs as storeDisplayPrefs, setWeekStart as storeWeekStart, todayISO, type DateLanguage, type TimeFormat, type WeekStart } from './dates';
import { dueReminders, loadFired, loadReminderSettings, saveFired, saveReminderSettings, showNotification, type ReminderSettings } from './reminders';
import { buildSampleState } from './sample';
import { deleteRemote, EMPTY_SYNC, generateCode, loadSyncSettings, mergeStates, normalizeCode, saveSyncSettings, SyncError, syncConfigured, syncOnce, type SyncSettings } from './sync';
import { applyTheme, loadAccent, loadThemeMode, resolvedMode, type ThemeMode } from './theme';
import type { Accent } from './constants';
import { createEmptyState, type ComposerState, type EventInput, type FixedCommitmentInput, type GoalInput, type HabitInput, type NoteInput, type PlannerState, type TaskInput } from './types';
import { t } from './i18n';

export interface NoticeAction {
  label: string;
  run: () => void;
}

export interface Notice {
  message: string;
  action?: NoticeAction;
}

export interface FocusSession {
  taskId: string | null;
  title: string;
  minutes: number;
}

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'offline';

interface PlannerContextValue {
  state: PlannerState;
  ready: boolean;
  error: string | null;
  notice: Notice | null;
  saveBlocked: boolean;
  route: Route;
  navigate: (route: Route) => void;
  composer: ComposerState | null;
  openComposer: (composer: ComposerState) => void;
  closeComposer: () => void;
  confirm: ConfirmRequest | null;
  requestConfirm: (confirm: ConfirmRequest) => void;
  closeConfirm: () => void;
  dismissError: () => void;
  startFresh: () => void;
  exportData: () => void;
  importText: (text: string) => void;
  loadSample: () => void;
  flash: (message: string, action?: NoticeAction) => void;
  dismissNotice: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  isDark: boolean;
  accent: Accent;
  setAccent: (accent: Accent) => void;
  paletteOpen: boolean;
  openPalette: () => void;
  closePalette: () => void;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  focus: FocusSession | null;
  startFocus: (session: FocusSession) => void;
  stopFocus: () => void;
  confettiSeed: number;
  reminders: ReminderSettings;
  weekStart: WeekStart;
  display: { dateLanguage: DateLanguage; timeFormat: TimeFormat };
  setDisplay: (prefs: { dateLanguage: DateLanguage; timeFormat: TimeFormat }) => void;
  sync: SyncSettings;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  syncAvailable: boolean | null;
  startSync: (code?: string) => string | null;
  stopSync: () => void;
  syncNow: () => void;
  deleteCloudCopy: () => Promise<void>;
  setWeekStart: (value: WeekStart) => void;
  setReminders: (settings: ReminderSettings) => void;
  celebrate: () => void;
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, patch: Partial<TaskInput>) => void;
  deleteTask: (id: string) => void;
  clearCompletedTasks: () => void;
  toggleTask: (id: string) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;
  resizeEvent: (id: string, endTime: string) => void;
  logFocus: (entry: { taskId: string | null; title: string; minutes: number }) => void;
  importCalendar: (data: { events: EventInput[]; tasks: TaskInput[] }) => void;
  swapTasks: (aId: string, bId: string) => void;
  addEvent: (input: EventInput) => void;
  addFixedCommitment: (input: FixedCommitmentInput) => void;
  updateFixedCommitment: (id: string, patch: Partial<FixedCommitmentInput>) => void;
  deleteFixedCommitment: (id: string) => void;
  applyAIPlan: (draft: { tasks: TaskInput[]; events: EventInput[]; habits: HabitInput[] }) => void;
  rescheduleTasks: (moves: Array<{ id: string; date: string }>) => void;
  applySchedule: (plan: Array<{ id: string; date: string; time: string }>) => void;
  updateEvent: (id: string, patch: Partial<EventInput>) => void;
  deleteEvent: (id: string) => void;
  toggleEvent: (id: string) => void;
  moveEvent: (id: string, date: string) => void;
  moveTask: (id: string, date: string | null) => void;
  swapEventTimes: (aId: string, bId: string) => void;
  addHabit: (input: HabitInput) => void;
  addHabits: (inputs: HabitInput[]) => void;
  updateHabit: (id: string, patch: Partial<HabitInput>) => void;
  deleteHabit: (id: string) => void;
  setHabitArchived: (id: string, archived: boolean) => void;
  toggleHabit: (habitId: string, date: string) => void;
  addGoal: (input: GoalInput) => void;
  updateGoal: (id: string, patch: Partial<Omit<GoalInput, 'milestone'>>) => void;
  deleteGoal: (id: string) => void;
  addMilestone: (goalId: string, title: string) => void;
  toggleMilestone: (goalId: string, milestoneId: string) => void;
  deleteMilestone: (goalId: string, milestoneId: string) => void;
  addNote: (input: NoteInput) => void;
  updateNote: (id: string, patch: Partial<NoteInput>) => void;
  deleteNote: (id: string) => void;
  setIntention: (date: string, text: string) => void;
}

const PlannerContext = createContext<PlannerContextValue | null>(null);

const HISTORY_LIMIT = 60;

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(() => loadFrom(localStorage));
  const [state, setState] = useState<PlannerState>(boot.state);
  const [ready] = useState(true);
  const [error, setError] = useState<string | null>(boot.error);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saveBlocked, setSaveBlocked] = useState(!boot.persist);
  const [route, setRoute] = useState<Route>(() => (typeof window === 'undefined' ? { name: 'today' } : parseHash(window.location.hash)));
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());
  const [accent, setAccent] = useState<Accent>(() => loadAccent('sage'));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [confettiSeed, setConfettiSeed] = useState(0);
  const [sync, setSyncState] = useState<SyncSettings>(() => loadSyncSettings());
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (loadSyncSettings().code ? 'idle' : 'off'));
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncAvailable, setSyncAvailable] = useState<boolean | null>(null);
  const [display, setDisplayState] = useState(() => loadDisplayPrefs());
  const [weekStart, setWeekStartState] = useState<WeekStart>(() => loadWeekStart());
  const [reminders, setRemindersState] = useState<ReminderSettings>(() => loadReminderSettings());
  const stateRef = useRef(state);
  stateRef.current = state;
  const historyRef = useRef<PlannerState[]>([]);
  const futureRef = useRef<PlannerState[]>([]);
  const persistRef = useRef(boot.persist);
  const noticeTimer = useRef<number | null>(null);

  const syncHistoryFlags = useCallback(() => {
    setCanUndo(historyRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, []);

  const flash = useCallback((message: string, action?: NoticeAction) => {
    setNotice(action ? { message, action } : { message });
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), action ? 5200 : 2800);
  }, []);

  const dismissNotice = useCallback(() => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice(null);
  }, []);

  useEffect(() => {
    const sync = (closeOverlays: boolean) => {
      setRoute(parseHash(window.location.hash));
      if (closeOverlays) {
        setComposer(null);
        setConfirm(null);
        setPaletteOpen(false);
      }
    };
    const onHash = () => sync(true);
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.history.replaceState(null, '', '#/today');
    sync(false);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const idbOnly = useRef(false);
  const trySave = useCallback((next: PlannerState): boolean => {
    if (!persistRef.current) return true;
    const serialized = serialize(next);
    void idbWrite(serialized);
    const saveError = saveTo(localStorage, next);
    if (saveError === STORAGE_FULL && typeof indexedDB !== 'undefined') {
      // localStorage is full — IndexedDB holds the copy instead (it has far more room).
      if (!idbOnly.current) {
        idbOnly.current = true;
        setNotice({ message: t("Your planner outgrew basic storage — now saving to larger browser storage.") });
      }
      return true;
    }
    if (saveError) {
      setError(saveError);
      return false;
    }
    return true;
  }, []);

  // On start, prefer the IndexedDB copy if it's newer (localStorage full or cleared).
  useEffect(() => {
    if (!boot.persist) return;
    let cancelled = false;
    void idbRead().then((stored) => {
      if (cancelled) return;
      let local: string | null = null;
      try {
        local = localStorage.getItem(STORAGE_KEY);
      } catch {
        local = null;
      }
      if (stored && savedAt(stored) > savedAt(local)) {
        let parsed: PlannerState | null = null;
        try {
          parsed = sanitizeState(JSON.parse(stored) as unknown);
        } catch {
          parsed = null;
        }
        if (parsed && stateRef.current === boot.state) {
          stateRef.current = parsed;
          setState(parsed);
        }
      } else if (!stored) {
        void idbWrite(serialize(stateRef.current));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [boot]);

  const commit = useCallback((updater: (current: PlannerState) => PlannerState) => {
    try {
      const prev = stateRef.current;
      const next = updater(prev);
      if (next === prev) return;
      if (!trySave(next)) return;
      stateRef.current = next;
      setState(next);
      historyRef.current = [...historyRef.current.slice(-HISTORY_LIMIT + 1), prev];
      futureRef.current = [];
      syncHistoryFlags();
    } catch {
      setError(t("Something went wrong with that change."));
    }
  }, [trySave, syncHistoryFlags]);

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    if (!trySave(prev)) return;
    historyRef.current = history.slice(0, -1);
    futureRef.current = [stateRef.current, ...futureRef.current].slice(0, HISTORY_LIMIT);
    stateRef.current = prev;
    setState(prev);
    syncHistoryFlags();
    flash(t("Undone."));
  }, [flash, trySave, syncHistoryFlags]);

  const redo = useCallback(() => {
    const future = futureRef.current;
    if (future.length === 0) return;
    const next = future[0];
    if (!trySave(next)) return;
    futureRef.current = future.slice(1);
    historyRef.current = [...historyRef.current.slice(-HISTORY_LIMIT + 1), stateRef.current];
    stateRef.current = next;
    setState(next);
    syncHistoryFlags();
    flash(t("Redone."));
  }, [flash, trySave, syncHistoryFlags]);

  const undoRef = useRef(undo);
  undoRef.current = undo;

  const navigate = useCallback((next: Route) => {
    setComposer(null);
    setConfirm(null);
    setPaletteOpen(false);
    setSettingsOpen(false);
    const hash = toHash(next);
    if (window.location.hash === hash) {
      setRoute(next);
      return;
    }
    window.location.hash = hash;
  }, []);

  useEffect(() => {
    applyTheme(themeMode, accent);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme(themeMode, accent);
    if (themeMode === 'system') media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [themeMode, accent]);

  const syncRef = useRef(sync);
  const syncBusy = useRef(false);
  const syncAgain = useRef(false);
  const syncTimer = useRef<number | null>(null);
  const remoteApply = useRef(false);

  const updateSync = useCallback((next: SyncSettings) => {
    syncRef.current = next;
    saveSyncSettings(next);
    setSyncState(next);
  }, []);

  const runSync = useCallback(async () => {
    if (!syncRef.current.code) return;
    if (syncBusy.current) {
      syncAgain.current = true;
      return;
    }
    syncBusy.current = true;
    setSyncStatus('syncing');
    try {
      const before = stateRef.current;
      const outcome = await syncOnce(before, syncRef.current);
      if (!syncRef.current.code) return; // turned off meanwhile
      let settings = outcome.settings;
      if (stateRef.current !== before) {
        // Edited while syncing: keep those edits and send them next round.
        if (outcome.state) {
          const merged = mergeStates(stateRef.current, outcome.state);
          remoteApply.current = true;
          if (trySave(merged)) {
            stateRef.current = merged;
            setState(merged);
          }
        }
        settings = { ...settings, dirty: true };
        syncAgain.current = true;
      } else if (outcome.state) {
        remoteApply.current = true;
        if (trySave(outcome.state)) {
          stateRef.current = outcome.state;
          setState(outcome.state);
          // Undo history can't safely span another device's changes.
          historyRef.current = [];
          futureRef.current = [];
          syncHistoryFlags();
        }
      }
      updateSync(settings);
      setSyncStatus('idle');
      setSyncMessage(null);
    } catch (caught) {
      const failure = caught instanceof SyncError ? caught : null;
      setSyncStatus(failure?.code === 'network' ? 'offline' : 'error');
      setSyncMessage(
        failure?.message ??
          (caught instanceof Error && caught.name === 'OperationError'
            ? t("This sync code does not match the data stored for it.")
            : t("Sync failed. Your planner is still saved on this device.")),
      );
    } finally {
      syncBusy.current = false;
      if (syncAgain.current) {
        syncAgain.current = false;
        window.setTimeout(() => void runSync(), 400);
      }
    }
  }, [trySave, syncHistoryFlags, updateSync]);

  const scheduleSync = useCallback((delay = 1500) => {
    if (!syncRef.current.code) return;
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => void runSync(), delay);
  }, [runSync]);

  // Any local change marks the copy dirty and schedules an upload.
  const firstState = useRef(true);
  useEffect(() => {
    if (firstState.current) {
      firstState.current = false;
      return;
    }
    if (remoteApply.current) {
      remoteApply.current = false;
      return;
    }
    if (!syncRef.current.code) return;
    if (!syncRef.current.dirty) updateSync({ ...syncRef.current, dirty: true });
    scheduleSync();
  }, [state, scheduleSync, updateSync]);

  useEffect(() => {
    if (!sync.code) return;
    void runSync();
    const onWake = () => {
      if (document.visibilityState === 'visible') void runSync();
    };
    const id = window.setInterval(() => void runSync(), 60000);
    window.addEventListener('online', onWake);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onWake);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [sync.code, runSync]);

  useEffect(() => {
    if (typeof fetch === 'undefined' || import.meta.env.MODE === 'test') return;
    void syncConfigured().then(setSyncAvailable);
  }, []);

  const startSync = useCallback((input?: string): string | null => {
    const code = input === undefined ? generateCode() : normalizeCode(input);
    if (!code) return null;
    // dirty = true so this device's data is merged with whatever is already stored.
    updateSync({ ...EMPTY_SYNC, code, dirty: true });
    setSyncStatus('idle');
    setSyncMessage(null);
    return code;
  }, [updateSync]);

  const stopSync = useCallback(() => {
    if (syncTimer.current) window.clearTimeout(syncTimer.current);
    updateSync(EMPTY_SYNC);
    setSyncStatus('off');
    setSyncMessage(null);
  }, [updateSync]);

  const deleteCloudCopy = useCallback(async () => {
    const code = syncRef.current.code;
    if (!code) return;
    try {
      await deleteRemote(code);
      stopSync();
      flash(t("Cloud copy deleted. This device keeps its planner."));
    } catch {
      setSyncMessage(t("The cloud copy could not be deleted. Try again."));
    }
  }, [stopSync, flash]);

  const setDisplay = useCallback((prefs: { dateLanguage: DateLanguage; timeFormat: TimeFormat }) => {
    storeDisplayPrefs(prefs);
    setDisplayState(prefs);
  }, []);

  const setWeekStart = useCallback((value: WeekStart) => {
    storeWeekStart(value);
    setWeekStartState(value);
  }, []);

  const setReminders = useCallback((settings: ReminderSettings) => {
    setRemindersState(settings);
    saveReminderSettings(settings);
  }, []);

  useEffect(() => {
    if (!reminders.enabled) return;
    const check = () => {
      const now = new Date();
      const fired = loadFired(todayISO(now));
      const due = dueReminders(stateRef.current, now, reminders, fired);
      if (due.length === 0) return;
      for (const reminder of due) {
        fired.add(reminder.key);
        void showNotification(reminder).then((shown) => {
          if (!shown) flash(`🔔 ${reminder.title} — ${reminder.body}`);
        });
      }
      saveFired(fired);
    };
    check();
    const id = window.setInterval(check, 20000);
    return () => window.clearInterval(id);
  }, [reminders, flash]);

  const startFresh = useCallback(() => {
    const empty = createEmptyState();
    persistRef.current = true;
    stateRef.current = empty;
    setState(empty);
    historyRef.current = [];
    futureRef.current = [];
    syncHistoryFlags();
    setSaveBlocked(false);
    const saved = trySave(empty);
    if (saved) flash(t("Planner cleared."));
  }, [flash, syncHistoryFlags]);

  const importText = useCallback((text: string) => {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    persistRef.current = true;
    stateRef.current = parsed.state;
    setState(parsed.state);
    historyRef.current = [];
    futureRef.current = [];
    syncHistoryFlags();
    setSaveBlocked(false);
    const saved = trySave(parsed.state);
    if (saved) flash(t("Backup imported."));
  }, [flash, trySave, syncHistoryFlags]);

  const exportData = useCallback(() => {
    try {
      downloadState(stateRef.current, todayISO());
      flash(t("Backup downloaded."));
    } catch {
      setError(t("The backup could not be downloaded."));
    }
  }, [flash]);

  const loadSample = useCallback(() => {
    commit(() => buildSampleState());
    flash(t("Sample day loaded — undo with ⌘Z any time."));
  }, [commit, flash]);

  const clearCompletedTasks = useCallback(() => {
    const count = stateRef.current.tasks.filter((task) => task.completed).length;
    if (count === 0) return;
    commit(clearCompletedTasksIn);
    flash(t("{0} completed {1} cleared.", { 0: count, 1: count === 1 ? t("task") : t("tasks") }), { label: t("Undo"), run: () => undoRef.current() });
  }, [commit, flash]);

  const celebrate = useCallback(() => {
    setConfettiSeed((seed) => seed + 1);
  }, []);

  const value = useMemo<PlannerContextValue>(() => ({
    state,
    ready,
    error,
    notice,
    saveBlocked,
    route,
    navigate,
    composer,
    openComposer: setComposer,
    closeComposer: () => setComposer(null),
    confirm,
    requestConfirm: setConfirm,
    closeConfirm: () => setConfirm(null),
    dismissError: () => {
      if (!saveBlocked) setError(null);
    },
    startFresh,
    exportData,
    importText,
    loadSample,
    flash,
    dismissNotice,
    undo,
    redo,
    canUndo,
    canRedo,
    themeMode,
    setThemeMode,
    isDark: resolvedMode(themeMode) === 'dark',
    accent,
    setAccent,
    paletteOpen,
    openPalette: () => setPaletteOpen(true),
    closePalette: () => setPaletteOpen(false),
    settingsOpen,
    openSettings: () => setSettingsOpen(true),
    closeSettings: () => setSettingsOpen(false),
    focus,
    startFocus: (session) => setFocus(session),
    stopFocus: () => setFocus(null),
    confettiSeed,
    celebrate,
    reminders,
    setReminders,
    weekStart,
    setWeekStart,
    display,
    setDisplay,
    sync,
    syncStatus,
    syncMessage,
    syncAvailable,
    startSync,
    stopSync,
    syncNow: () => void runSync(),
    deleteCloudCopy,
    addTask: (input) => commit((current) => addTaskTo(current, input)),
    updateTask: (id, patch) => commit((current) => updateTaskIn(current, id, patch)),
    deleteTask: (id) => commit((current) => deleteTaskFrom(current, id)),
    clearCompletedTasks,
    toggleTask: (id) => commit((current) => toggleTaskIn(current, id)),
    toggleSubtask: (taskId, subtaskId) => commit((current) => toggleSubtaskIn(current, taskId, subtaskId)),
    resizeEvent: (id, endTime) => commit((current) => resizeEventIn(current, id, endTime)),
    logFocus: (entry) => commit((current) => logFocusIn(current, entry)),
    importCalendar: (data) => commit((current) => {
      let next = current;
      for (const input of data.events) next = addEventTo(next, input);
      for (const input of data.tasks) next = addTaskTo(next, input);
      return next;
    }),
    swapTasks: (aId, bId) => commit((current) => swapTasksIn(current, aId, bId)),
    addEvent: (input) => commit((current) => addEventTo(current, input)),
    addFixedCommitment: (input) => commit((current) => addFixedCommitmentTo(current, input)),
    updateFixedCommitment: (id, patch) => commit((current) => updateFixedCommitmentIn(current, id, patch)),
    deleteFixedCommitment: (id) => commit((current) => deleteFixedCommitmentFrom(current, id)),
    applyAIPlan: (draft) => commit((current) => {
      let next = current;
      for (const input of draft.tasks) next = addTaskTo(next, input);
      for (const input of draft.events) next = addEventTo(next, input);
      for (const input of draft.habits) next = addHabitTo(next, input);
      return next;
    }),
    rescheduleTasks: (moves) => commit((current) => moves.reduce((next, move) => moveTaskIn(next, move.id, move.date), current)),
    applySchedule: (plan) => commit((current) => plan.reduce((next, item) => updateTaskIn(next, item.id, { dueDate: item.date, dueTime: item.time }), current)),
    updateEvent: (id, patch) => commit((current) => updateEventIn(current, id, patch)),
    deleteEvent: (id) => commit((current) => deleteEventFrom(current, id)),
    toggleEvent: (id) => commit((current) => toggleEventIn(current, id)),
    moveEvent: (id, date) => commit((current) => moveEventIn(current, id, date)),
    moveTask: (id, date) => commit((current) => moveTaskIn(current, id, date)),
    swapEventTimes: (aId, bId) => commit((current) => swapEventTimesIn(current, aId, bId)),
    addHabit: (input) => commit((current) => addHabitTo(current, input)),
    addHabits: (inputs) => commit((current) => addHabitsTo(current, inputs)),
    updateHabit: (id, patch) => commit((current) => updateHabitIn(current, id, patch)),
    deleteHabit: (id) => commit((current) => deleteHabitFrom(current, id)),
    setHabitArchived: (id, archived) => commit((current) => setHabitArchivedIn(current, id, archived)),
    toggleHabit: (habitId, date) => commit((current) => toggleHabitIn(current, habitId, date)),
    addGoal: (input) => commit((current) => addGoalTo(current, input)),
    updateGoal: (id, patch) => commit((current) => updateGoalIn(current, id, patch)),
    deleteGoal: (id) => commit((current) => deleteGoalFrom(current, id)),
    addMilestone: (goalId, title) => commit((current) => addMilestoneTo(current, goalId, title)),
    toggleMilestone: (goalId, milestoneId) => commit((current) => toggleMilestoneIn(current, goalId, milestoneId)),
    deleteMilestone: (goalId, milestoneId) => commit((current) => deleteMilestoneFrom(current, goalId, milestoneId)),
    addNote: (input) => commit((current) => addNoteTo(current, input)),
    updateNote: (id, patch) => commit((current) => updateNoteIn(current, id, patch)),
    deleteNote: (id) => commit((current) => deleteNoteFrom(current, id)),
    setIntention: (date, text) => commit((current) => setIntentionIn(current, date, text)),
  }), [state, ready, error, notice, saveBlocked, route, navigate, composer, confirm, startFresh, exportData, importText, loadSample, flash, dismissNotice, undo, redo, canUndo, canRedo, themeMode, accent, paletteOpen, settingsOpen, focus, confettiSeed, celebrate, clearCompletedTasks, commit, reminders, setReminders, weekStart, setWeekStart, display, setDisplay, sync, syncStatus, syncMessage, syncAvailable, startSync, stopSync, runSync, deleteCloudCopy]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error('usePlanner must be used within PlannerProvider');
  return value;
}
