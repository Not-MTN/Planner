import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseHash, toHash, type Route } from './route';
import { downloadState, loadFrom, parseBackup, sanitizeState, saveTo, serialize, STORAGE_FULL, STORAGE_KEY } from './storage';
import { flushVaultPush, scheduleVaultPush } from './auth/vault';
import { readNotices, refreshResults, relayNotices, shareWeeklyResults, syncLinks } from './auth/links';
import { idbRead, idbWrite, savedAt } from './idb';
import {
  addAIMemory as addAIMemoryTo,
  clearAIMemory as clearAIMemoryIn,
  deleteAIMemory as deleteAIMemoryFrom,
  updateAIMemory as updateAIMemoryIn,
  saveAIPlan as saveAIPlanTo,
  deleteAIPlan as deleteAIPlanFrom,
  markAIPlanAdded as markAIPlanAddedIn,
  updateAIPlan as updateAIPlanIn,
  type AIPlanPatch,
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
  duplicateTask as duplicateTaskIn,
  copyWeek as copyWeekIn,
  carryWeekLeftovers as carryWeekLeftoversIn,
  clearCompletedTasks as clearCompletedTasksIn,
  deleteEvent as deleteEventFrom,
  deleteGoal as deleteGoalFrom,
  deleteHabit as deleteHabitFrom,
  deleteMilestone as deleteMilestoneFrom,
  deleteNote as deleteNoteFrom,
  deleteTask as deleteTaskFrom,
  moveEvent as moveEventIn,
  moveTask as moveTaskIn,
  completeTasks as completeTasksIn,
  deleteTasks as deleteTasksIn,
  moveTasks as moveTasksIn,
  updateTasks as updateTasksIn,
  setHabitValue as setHabitValueIn,
  skipHabit as skipHabitIn,
  setHabitArchived as setHabitArchivedIn,
  setIntention as setIntentionIn,
  setMood as setMoodIn,
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
  uid,
} from './mutate';
import { loadDisplayPrefs, loadWeekStart, setDisplayPrefs as storeDisplayPrefs, setWeekStart as storeWeekStart, todayISO, type DisplayPrefs, type WeekStart } from './dates';
import { dueReminders, loadFired, loadReminderSettings, saveFired, saveReminderSettings, showNotification, type ReminderSettings } from './reminders';
import { appendNotifications } from './notificationCenter';
import { backgroundPushEnabled, refreshBackgroundPushSchedule } from './push';
import { buildSampleState } from './sample';
import { deleteRemote, EMPTY_SYNC, generateCode, loadSyncSettings, mergeStates, normalizeCode, saveSyncSettings, SyncError, syncConfigured, syncOnce, type SyncSettings } from './sync';
import {
  EMPTY_SHARED,
  isSharedNote,
  loadSharedSettings,
  loadTombstones,
  normalizeSharedCode,
  saveSharedSettings,
  saveTombstones,
  SHARED_CATEGORY,
  syncSharedOnce,
  tombstoneKey,
  type SharedSettings,
  type Tombstones,
} from './shared';
import { fetchFeedEvents, loadFeeds, mergeFeedEvents, saveFeeds, type CalendarFeed } from './feeds';
import { loadWeatherSettings, saveWeatherSettings, type WeatherSettings } from './weather';
import { applyTheme, loadAccent, loadThemeMode, resolvedMode, type ThemeMode } from './theme';
import type { Accent } from './constants';
import { createEmptyState, type AIMemoryInput, type AttachmentRef, type ComposerState, type EventInput, type FixedCommitmentInput, type GoalInput, type HabitInput, type MoodValue, type NoteInput, type Panels, type PlannerState, type SavedAIPlanInput, type TaskInput } from './types';
import { t } from './i18n';
import { isTestEnv } from './env';
import { attachmentNotice, MAX_ATTACHMENTS_PER_NOTE, storeAttachment, sweepAttachmentBlobs } from './files';

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
  panels: Panels;
  /** Replaces the panels block. Panels are optional extras on top of the planner. */
  updatePanels: (next: Panels) => void;
  /** Adds or removes a panel. The personal planner is never affected. */
  setPanelEnabled: (panel: 'student' | 'guardian', enabled: boolean) => void;
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
  display: DisplayPrefs;
  setDisplay: (prefs: DisplayPrefs) => void;
  sync: SyncSettings;
  syncStatus: SyncStatus;
  syncMessage: string | null;
  syncAvailable: boolean | null;
  startSync: (code?: string) => string | null;
  stopSync: () => void;
  syncNow: () => void;
  deleteCloudCopy: () => Promise<void>;
  shared: SharedSettings;
  sharedStatus: SyncStatus;
  sharedMessage: string | null;
  startShared: (code?: string) => string | null;
  stopShared: () => void;
  syncSharedNow: () => void;
  feeds: CalendarFeed[];
  /** Validates + imports the feed once. Returns an error message, or null on success. */
  addFeed: (url: string) => Promise<string | null>;
  removeFeed: (url: string) => void;
  refreshFeeds: (force?: boolean) => void;
  weather: WeatherSettings;
  setWeather: (settings: WeatherSettings) => void;
  importTaskList: (tasks: TaskInput[]) => void;
  setWeekStart: (value: WeekStart) => void;
  setReminders: (settings: ReminderSettings) => void;
  celebrate: () => void;
  addTask: (input: TaskInput) => void;
  duplicateTask: (id: string) => void;
  updateTask: (id: string, patch: Partial<TaskInput>) => void;
  deleteTask: (id: string) => void;
  clearCompletedTasks: () => void;
  toggleTask: (id: string) => void;
  completeTasksByIds: (ids: string[], complete?: boolean) => void;
  updateTasksByIds: (ids: string[], patch: Partial<TaskInput>) => void;
  deleteTasksByIds: (ids: string[]) => void;
  moveTasksByIds: (ids: string[], date: string | null) => void;
  toggleSubtask: (taskId: string, subtaskId: string) => void;
  resizeEvent: (id: string, endTime: string) => void;
  logFocus: (entry: { taskId: string | null; title: string; minutes: number }) => void;
  importCalendar: (data: { events: EventInput[]; tasks: TaskInput[] }) => void;
  swapTasks: (aId: string, bId: string) => void;
  addEvent: (input: EventInput) => void;
  addFixedCommitment: (input: FixedCommitmentInput) => void;
  updateFixedCommitment: (id: string, patch: Partial<FixedCommitmentInput>) => void;
  deleteFixedCommitment: (id: string) => void;
  addAIMemory: (input: AIMemoryInput) => void;
  updateAIMemory: (id: string, patch: Partial<AIMemoryInput>) => void;
  deleteAIMemory: (id: string) => void;
  clearAIMemory: () => void;
  applyAIPlan: (draft: { tasks: TaskInput[]; events: EventInput[]; habits: HabitInput[] }, planId?: string) => void;
  /** Save an AI draft to the Plans page; returns the stored plan id. */
  saveAIPlan: (input: SavedAIPlanInput) => string;
  deleteAIPlan: (id: string) => void;
  /** Replace a saved plan's draft contents after the AI revises it. */
  updateAIPlan: (id: string, patch: AIPlanPatch) => void;
  rescheduleTasks: (moves: Array<{ id: string; date: string }>) => void;
  applySchedule: (plan: Array<{ id: string; date: string; time: string }>) => void;
  updateEvent: (id: string, patch: Partial<EventInput>) => void;
  deleteEvent: (id: string) => void;
  toggleEvent: (id: string) => void;
  moveEvent: (id: string, date: string) => void;
  moveTask: (id: string, date: string | null) => void;
  copyWeek: (fromDate: string) => void;
  carryWeekLeftovers: () => void;
  swapEventTimes: (aId: string, bId: string) => void;
  addHabit: (input: HabitInput) => void;
  addHabits: (inputs: HabitInput[]) => void;
  updateHabit: (id: string, patch: Partial<HabitInput>) => void;
  deleteHabit: (id: string) => void;
  setHabitArchived: (id: string, archived: boolean) => void;
  toggleHabit: (habitId: string, date: string) => void;
  setHabitValue: (habitId: string, date: string, value: number) => void;
  skipHabit: (habitId: string, date: string) => void;
  addGoal: (input: GoalInput) => void;
  updateGoal: (id: string, patch: Partial<Omit<GoalInput, 'milestone'>>) => void;
  deleteGoal: (id: string) => void;
  addMilestone: (goalId: string, title: string, dueDate?: string | null) => void;
  toggleMilestone: (goalId: string, milestoneId: string) => void;
  deleteMilestone: (goalId: string, milestoneId: string) => void;
  addNote: (input: NoteInput) => void;
  updateNote: (id: string, patch: Partial<NoteInput>) => void;
  attachFilesToNote: (noteId: string, files: File[]) => Promise<void>;
  deleteNote: (id: string) => void;
  setIntention: (date: string, text: string) => void;
  /** Log how a day felt (1–5); pass null to clear. */
  logMood: (date: string, value: MoodValue | null, taskId?: string) => void;
}

const PlannerContext = createContext<PlannerContextValue | null>(null);

/** How many items exist in `next` that weren't in `before` — for "merged from your other devices". */
function countNew(before: PlannerState, next: PlannerState): number {
  const diff = (a: Array<{ id: string }>, b: Array<{ id: string }>) => {
    const known = new Set(a.map((item) => item.id));
    return b.filter((item) => !known.has(item.id)).length;
  };
  return diff(before.tasks, next.tasks) + diff(before.events, next.events) + diff(before.notes, next.notes) + diff(before.goals, next.goals) + diff(before.habits, next.habits);
}

const HISTORY_LIMIT = 60;
/** Past states mirrored to IndexedDB so undo survives a reload. */
const HISTORY_PERSIST_LIMIT = 8;
const HISTORY_IDB_KEY = 'history';

export function PlannerProvider({ children, initialState }: { children: ReactNode; initialState?: PlannerState | null }) {
  // `initialState` wins when the planner was opened from an encrypted vault.
  const [boot] = useState(() =>
    initialState ? { state: sanitizeState(initialState) ?? loadFrom(localStorage).state, error: null as string | null, persist: true } : loadFrom(localStorage),
  );
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
  const [shared, setSharedState] = useState<SharedSettings>(() => loadSharedSettings());
  const [sharedStatus, setSharedStatus] = useState<SyncStatus>(() => (loadSharedSettings().code ? 'idle' : 'off'));
  const [sharedMessage, setSharedMessage] = useState<string | null>(null);
  const [feeds, setFeedsState] = useState<CalendarFeed[]>(() => loadFeeds());
  const [weather, setWeatherState] = useState<WeatherSettings>(() => loadWeatherSettings());
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

  // A small, rotating bit of applause when something gets ticked off — the
  // reward after the effort, on purpose. Never fires on un-checking.
  const PRAISES = [
    () => t("Done. Beautifully ticked. ✨"),
    () => t("One more off the list. 🎉"),
    () => t("That counts. Well done. 💛"),
    () => t("Checked, finished, gone. 🙌"),
    () => t("Forward motion. Keep it. 🌱"),
    () => t("You did the thing. ⭐"),
  ];
  const praiseStep = useRef(0);
  const praise = useCallback(() => {
    flash(PRAISES[praiseStep.current % PRAISES.length]());
    praiseStep.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flash]);


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
  // Skipped when we booted from a vault, which is the authoritative copy.
  useEffect(() => {
    if (!boot.persist || initialState) return;
    let cancelled = false;
    void idbRead().then((stored) => {
      // Restore the persisted undo stack too (past only — nothing to redo after a reload).
      void idbRead(HISTORY_IDB_KEY).then((raw) => {
        if (cancelled || !raw) return;
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!Array.isArray(parsed)) return;
          const states = parsed.flatMap((item) => {
            try {
              const clean = sanitizeState(item);
              return clean ? [clean] : [];
            } catch {
              return [];
            }
          });
          if (cancelled || states.length === 0 || historyRef.current.length > 0) return;
          historyRef.current = states.slice(-HISTORY_PERSIST_LIMIT);
          setCanUndo(true);
        } catch {
          /* unreadable history is dropped silently */
        }
      });
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
      // Housekeeping: drop attachment bytes whose refs no longer exist (deleted
      // notes from an earlier session, discarded drafts). Cheap and failure-less.
      void sweepAttachmentBlobs(stateRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [boot]);

  // ── Persisted undo stack (IndexedDB, capped; restored at the bottom of boot) ─
  const historyPersistTimer = useRef<number | null>(null);
  const persistHistory = useCallback(() => {
    if (!persistRef.current) return;
    if (historyPersistTimer.current) window.clearTimeout(historyPersistTimer.current);
    historyPersistTimer.current = window.setTimeout(() => {
      try {
        void idbWrite(JSON.stringify(historyRef.current.slice(-HISTORY_PERSIST_LIMIT)), HISTORY_IDB_KEY);
      } catch {
        /* history persistence is best-effort */
      }
    }, 700);
  }, []);

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
      persistHistory();
    } catch {
      setError(t("Something went wrong with that change."));
    }
  }, [trySave, syncHistoryFlags, persistHistory]);

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
    persistHistory();
    flash(t("Undone."));
  }, [flash, trySave, syncHistoryFlags, persistHistory]);

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


  // ── Encrypted vault: keep the copy on the server in step with this device ──
  // Signed in and unlocked, the vault is what other devices read. Writes are
  // batched, and the last few seconds of work are flushed when the tab goes away.
  useEffect(() => {
    scheduleVaultPush(state);
  }, [state]);

  /**
   * Everything that has to travel between accounts, run wherever the user is —
   * not only on the panel pages:
   *
   *   student  → sends this week's results, and passes a guardian's note on
   *   guardian → picks up new results and whatever the other adults wrote
   *
   * All of it is best effort: a phone with no signal simply catches up later.
   */
  const syncPanelLinks = useCallback(
    async (current: PlannerState) => {
      if (!current.panels.student.enabled && !current.panels.guardian.enabled) return;
      let panels = current.panels;
      try {
        if (current.panels.student.enabled && panels.student.guardians.length > 0) {
          await relayNotices(panels);
          const shared = await shareWeeklyResults(current, panels);
          panels = shared.panels;
        }
        if (current.panels.guardian.enabled) {
          panels = (await syncLinks(panels)).panels;
          panels = (await refreshResults(panels)).panels;
          panels = (await readNotices(panels)).panels;
        }
        // These helpers always build new objects; only a real change is saved,
        // otherwise this would quietly loop forever.
        if (JSON.stringify(panels) !== JSON.stringify(current.panels)) {
          commit(() => ({ ...current, panels }));
        }
      } catch {
        /* sharing is best effort; the next save tries again */
      }
    },
    [commit],
  );

  // Runs shortly after the planner changes, and once when it opens.
  const panelTimer = useRef<number | null>(null);
  useEffect(() => {
    const wantsStudent = state.panels.student.enabled && state.panels.student.guardians.length > 0;
    const wantsGuardian = state.panels.guardian.enabled && state.panels.guardian.links.length > 0;
    if (!wantsStudent && !wantsGuardian) return;
    if (panelTimer.current !== null) window.clearTimeout(panelTimer.current);
    panelTimer.current = window.setTimeout(() => {
      void syncPanelLinks(stateRef.current);
    }, 4000);
    return () => {
      if (panelTimer.current !== null) window.clearTimeout(panelTimer.current);
    };
  }, [state, syncPanelLinks]);

  useEffect(() => {
    const flush = () => void flushVaultPush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);

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
  const sharedRemoteApply = useRef(false);

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
    let arrived = 0;
    try {
      const before = stateRef.current;
      const outcome = await syncOnce(before, syncRef.current);
      if (!syncRef.current.code) return; // turned off meanwhile
      let settings = outcome.settings;
      if (stateRef.current !== before) {
        // Edited while syncing: keep those edits and send them next round.
        if (outcome.state) {
          const merged = mergeStates(stateRef.current, outcome.state);
          arrived = countNew(before, merged);
          remoteApply.current = true;
          if (trySave(merged)) {
            stateRef.current = merged;
            setState(merged);
          }
        }
        settings = { ...settings, dirty: true };
        syncAgain.current = true;
      } else if (outcome.state) {
        arrived = countNew(before, outcome.state);
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
      if (arrived > 0) flash(t("{0} new {1} merged from your other devices.", { 0: arrived, 1: arrived === 1 ? t("item") : t("items") }));
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

  // ── Shared space (second encrypted room for "Shared" category items) ────────
  const sharedRef = useRef(shared);
  const sharedBusy = useRef(false);
  const sharedAgain = useRef(false);
  const sharedTimer = useRef<number | null>(null);
  const tombstonesRef = useRef<Tombstones>(loadTombstones());

  const updateShared = useCallback((next: SharedSettings) => {
    sharedRef.current = next;
    saveSharedSettings(next);
    setSharedState(next);
  }, []);

  const runSharedSync = useCallback(async () => {
    if (!sharedRef.current.code) return;
    if (sharedBusy.current) {
      sharedAgain.current = true;
      return;
    }
    sharedBusy.current = true;
    setSharedStatus('syncing');
    try {
      const outcome = await syncSharedOnce(stateRef.current, sharedRef.current, tombstonesRef.current);
      if (!sharedRef.current.code) return; // turned off meanwhile
      tombstonesRef.current = outcome.tombstones;
      saveTombstones(outcome.tombstones);
      let settings = outcome.settings;
      if (outcome.state && outcome.state !== stateRef.current) {
        // Shared items arrived from the room: apply without re-marking this room
        // dirty (that flag would ping-pong the two devices forever). Personal
        // sync treats them as normal edits and can still carry them to your devices.
        sharedRemoteApply.current = true;
        if (trySave(outcome.state)) {
          stateRef.current = outcome.state;
          setState(outcome.state);
          settings = { ...settings, dirty: false };
        } else {
          sharedRemoteApply.current = false;
        }
      }
      updateShared(settings);
      setSharedStatus('idle');
      setSharedMessage(null);
    } catch (caught) {
      const failure = caught instanceof SyncError ? caught : null;
      setSharedStatus(failure?.code === 'network' ? 'offline' : 'error');
      setSharedMessage(failure?.message ?? t('Shared space failed to sync. It will try again.'));
    } finally {
      sharedBusy.current = false;
      if (sharedAgain.current) {
        sharedAgain.current = false;
        window.setTimeout(() => void runSharedSync(), 400);
      }
    }
  }, [trySave, updateShared]);

  const scheduleSharedSync = useCallback((delay = 1500) => {
    if (!sharedRef.current.code) return;
    if (sharedTimer.current) window.clearTimeout(sharedTimer.current);
    sharedTimer.current = window.setTimeout(() => void runSharedSync(), delay);
  }, [runSharedSync]);

  // Any local change marks the copy dirty and schedules an upload.
  const firstState = useRef(true);
  useEffect(() => {
    if (firstState.current) {
      firstState.current = false;
      return;
    }
    if (remoteApply.current) {
      remoteApply.current = false;
    } else if (syncRef.current.code) {
      if (!syncRef.current.dirty) updateSync({ ...syncRef.current, dirty: true });
      scheduleSync();
    }
    if (sharedRemoteApply.current) {
      sharedRemoteApply.current = false;
    } else if (sharedRef.current.code) {
      if (!sharedRef.current.dirty) updateShared({ ...sharedRef.current, dirty: true });
      scheduleSharedSync();
    }
  }, [state, scheduleSync, updateSync, scheduleSharedSync, updateShared]);

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
    if (!shared.code || isTestEnv()) return;
    void runSharedSync();
    const id = window.setInterval(() => void runSharedSync(), 60000);
    const onWake = () => {
      if (document.visibilityState === 'visible') void runSharedSync();
    };
    window.addEventListener('online', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [shared.code, runSharedSync]);

  const startShared = useCallback((input?: string): string | null => {
    const code = input === undefined ? generateCode() : normalizeSharedCode(input);
    if (!code) return null;
    updateShared({ ...EMPTY_SHARED, code, dirty: true });
    setSharedStatus('idle');
    setSharedMessage(null);
    return code;
  }, [updateShared]);

  const stopShared = useCallback(() => {
    if (sharedTimer.current) window.clearTimeout(sharedTimer.current);
    updateShared(EMPTY_SHARED);
    setSharedStatus('off');
    setSharedMessage(null);
  }, [updateShared]);

  /** Record a deletion of a shared item so the room removes it everywhere. */
  const recordTombstone = useCallback((type: 'task' | 'event' | 'note', id: string) => {
    if (!sharedRef.current.code) return;
    tombstonesRef.current = { ...tombstonesRef.current, [tombstoneKey(type, id)]: new Date().toISOString() };
    saveTombstones(tombstonesRef.current);
    updateShared({ ...sharedRef.current, dirty: true });
    scheduleSharedSync();
  }, [updateShared, scheduleSharedSync]);

  // ── Calendar feed subscriptions ─────────────────────────────────────────────
  const feedsRef = useRef(feeds);
  // Panels are additive: switching one on or off never touches tasks, events,
  // habits or anything else in the personal planner.
  const updatePanels = useCallback(
    (next: Panels) => {
      commit((current) => (current.panels === next ? current : { ...current, panels: next }));
    },
    [commit],
  );

  const setPanelEnabled = useCallback(
    (panel: 'student' | 'guardian', enabled: boolean) => {
      commit((current) => {
        const panels = current.panels;
        if (panel === 'student') {
          if (panels.student.enabled === enabled) return current;
          return { ...current, panels: { ...panels, student: { ...panels.student, enabled } } };
        }
        if (panels.guardian.enabled === enabled) return current;
        return { ...current, panels: { ...panels, guardian: { ...panels.guardian, enabled } } };
      });
    },
    [commit],
  );

  const updateFeeds = useCallback((next: CalendarFeed[]) => {
    feedsRef.current = next;
    saveFeeds(next);
    setFeedsState(next);
  }, []);

  const refreshFeeds = useCallback(async (force = false) => {
    if (isTestEnv()) return;
    const staleHours = 20;
    for (const feed of feedsRef.current) {
      const stale = !feed.lastFetchedAt || Date.now() - Date.parse(feed.lastFetchedAt) > staleHours * 3600_000;
      if (!force && !stale) continue;
      try {
        const events = await fetchFeedEvents(feed.url);
        commit((current) => mergeFeedEvents(current, feed.url, events));
        updateFeeds(feedsRef.current.map((item) => (item.url === feed.url ? { ...item, lastFetchedAt: new Date().toISOString(), lastError: null, count: events.length } : item)));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : t('The calendar could not be refreshed.');
        updateFeeds(feedsRef.current.map((item) => (item.url === feed.url ? { ...item, lastError: message } : item)));
      }
    }
  }, [commit, updateFeeds]);

  useEffect(() => {
    if (isTestEnv() || feeds.length === 0) return;
    void refreshFeeds(false);
    const id = window.setInterval(() => void refreshFeeds(false), 30 * 60 * 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feeds.length, refreshFeeds]);

  const addFeed = useCallback(async (input: string): Promise<string | null> => {
    const url = input.trim();
    if (!/^https?:\/\//i.test(url)) return t('Enter the calendar address starting with https.');
    if (feedsRef.current.some((feed) => feed.url === url)) return t('That calendar is already subscribed.');
    try {
      const events = await fetchFeedEvents(url);
      const feed: CalendarFeed = { url, addedAt: new Date().toISOString(), lastFetchedAt: new Date().toISOString(), lastError: null, count: events.length };
      updateFeeds([...feedsRef.current, feed]);
      commit((current) => mergeFeedEvents(current, url, events));
      return null;
    } catch (caught) {
      return caught instanceof Error ? caught.message : t('The calendar could not be added.');
    }
  }, [commit, updateFeeds]);

  const removeFeed = useCallback((url: string) => {
    updateFeeds(feedsRef.current.filter((feed) => feed.url !== url));
    commit((current) => ({ ...current, events: current.events.filter((event) => event.source?.url !== url) }));
  }, [commit, updateFeeds]);

  // ── App icon badge: open items due today (and earlier) ─────────────────────
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return;
    const today = todayISO();
    const open = state.tasks.filter((task) => !task.completed && !task.waiting && task.dueDate !== null && task.dueDate <= today).length;
    void (open > 0 ? navigator.setAppBadge?.(open).catch(() => undefined) : navigator.clearAppBadge?.().catch(() => undefined));
  }, [state]);

  const setWeather = useCallback((settings: WeatherSettings) => {
    saveWeatherSettings(settings);
    setWeatherState(settings);
  }, []);

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

  const setDisplay = useCallback((prefs: DisplayPrefs) => {
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
      appendNotifications(due, now);
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

  const pushScheduleTimer = useRef<number | null>(null);
  useEffect(() => {
    if (isTestEnv() || !backgroundPushEnabled()) return;
    if (pushScheduleTimer.current !== null) window.clearTimeout(pushScheduleTimer.current);
    pushScheduleTimer.current = window.setTimeout(() => {
      void refreshBackgroundPushSchedule(state, reminders).catch(() => { /* keep local reminders working if push is temporarily unavailable */ });
    }, 1200);
    return () => {
      if (pushScheduleTimer.current !== null) window.clearTimeout(pushScheduleTimer.current);
    };
  }, [state, reminders]);

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
    panels: state.panels,
    updatePanels,
    setPanelEnabled,
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
    shared,
    sharedStatus,
    sharedMessage,
    startShared,
    stopShared,
    syncSharedNow: () => void runSharedSync(),
    feeds,
    addFeed,
    removeFeed,
    refreshFeeds,
    weather,
    setWeather,
    importTaskList: (tasks) => {
      commit((current) => tasks.reduce((next, input) => addTaskTo(next, input), current));
      flash(t("{0} {1} imported.", { 0: tasks.length, 1: tasks.length === 1 ? t("task") : t("tasks") }));
    },
    addTask: (input) => commit((current) => addTaskTo(current, input)),
    duplicateTask: (id) => commit((current) => duplicateTaskIn(current, id)),
    updateTask: (id, patch) => commit((current) => updateTaskIn(current, id, patch)),
    deleteTask: (id) => {
      const task = stateRef.current.tasks.find((item) => item.id === id);
      if (task?.category === SHARED_CATEGORY) recordTombstone('task', id);
      commit((current) => deleteTaskFrom(current, id));
    },
    completeTasksByIds: (ids, complete = true) => commit((current) => completeTasksIn(current, ids, complete)),
    updateTasksByIds: (ids, patch) => commit((current) => updateTasksIn(current, ids, patch)),
    deleteTasksByIds: (ids) => {
      if (sharedRef.current.code) {
        for (const task of stateRef.current.tasks) {
          if (ids.includes(task.id) && task.category === SHARED_CATEGORY) recordTombstone('task', task.id);
        }
      }
      commit((current) => deleteTasksIn(current, ids));
    },
    moveTasksByIds: (ids, date) => commit((current) => moveTasksIn(current, ids, date)),
    clearCompletedTasks,
    toggleTask: (id) => {
      const wasOpen = stateRef.current.tasks.some((task) => task.id === id && !task.completed);
      commit((current) => toggleTaskIn(current, id));
      if (wasOpen) praise();
    },
    toggleSubtask: (taskId, subtaskId) => commit((current) => toggleSubtaskIn(current, taskId, subtaskId)),
    resizeEvent: (id, endTime) => commit((current) => resizeEventIn(current, id, endTime)),
    logFocus: (entry) => commit((current) => logFocusIn(current, entry)),
    importCalendar: (data) => commit((current) => {
      let next = current;
      const eventKey = (item: { title: string; date: string; startTime: string; endTime: string | null }) => `${item.title.trim().toLocaleLowerCase()}|${item.date}|${item.startTime}|${item.endTime ?? ''}`;
      const taskKey = (item: { title: string; dueDate: string | null; dueTime?: string | null }) => `${item.title.trim().toLocaleLowerCase()}|${item.dueDate ?? ''}|${item.dueTime ?? ''}`;
      const knownEvents = new Set(current.events.map(eventKey));
      for (const input of data.events) {
        const key = eventKey(input);
        if (knownEvents.has(key)) continue;
        knownEvents.add(key);
        next = addEventTo(next, input);
      }
      const knownTasks = new Set(current.tasks.map(taskKey));
      for (const input of data.tasks) {
        const key = taskKey(input);
        if (knownTasks.has(key)) continue;
        knownTasks.add(key);
        next = addTaskTo(next, input);
      }
      return next;
    }),
    swapTasks: (aId, bId) => commit((current) => swapTasksIn(current, aId, bId)),
    addEvent: (input) => commit((current) => addEventTo(current, input)),
    addFixedCommitment: (input) => commit((current) => addFixedCommitmentTo(current, input)),
    updateFixedCommitment: (id, patch) => commit((current) => updateFixedCommitmentIn(current, id, patch)),
    deleteFixedCommitment: (id) => commit((current) => deleteFixedCommitmentFrom(current, id)),
    addAIMemory: (input) => commit((current) => addAIMemoryTo(current, input)),
    updateAIMemory: (id, patch) => commit((current) => updateAIMemoryIn(current, id, patch)),
    deleteAIMemory: (id) => commit((current) => deleteAIMemoryFrom(current, id)),
    clearAIMemory: () => commit(clearAIMemoryIn),
    applyAIPlan: (draft, planId) => commit((current) => {
      let next = current;
      for (const input of draft.tasks) next = addTaskTo(next, input);
      for (const input of draft.events) next = addEventTo(next, input);
      for (const input of draft.habits) next = addHabitTo(next, input);
      if (planId) next = markAIPlanAddedIn(next, planId);
      return next;
    }),
    saveAIPlan: (input) => {
      const id = uid();
      commit((current) => saveAIPlanTo(current, input, id).state);
      return id;
    },
    deleteAIPlan: (id) => commit((current) => deleteAIPlanFrom(current, id)),
    updateAIPlan: (id, patch) => commit((current) => updateAIPlanIn(current, id, patch)),
    rescheduleTasks: (moves) => commit((current) => moves.reduce((next, move) => moveTaskIn(next, move.id, move.date), current)),
    applySchedule: (plan) => commit((current) => plan.reduce((next, item) => updateTaskIn(next, item.id, { dueDate: item.date, dueTime: item.time }), current)),
    updateEvent: (id, patch) => commit((current) => updateEventIn(current, id, patch)),
    deleteEvent: (id) => {
      const event = stateRef.current.events.find((item) => item.id === id);
      if (event?.category === SHARED_CATEGORY) recordTombstone('event', id);
      commit((current) => deleteEventFrom(current, id));
    },
    toggleEvent: (id) => commit((current) => toggleEventIn(current, id)),
    moveEvent: (id, date) => commit((current) => moveEventIn(current, id, date)),
    moveTask: (id, date) => commit((current) => moveTaskIn(current, id, date)),
    copyWeek: (fromDate) => commit((current) => copyWeekIn(current, fromDate)),
    carryWeekLeftovers: () => commit((current) => carryWeekLeftoversIn(current, todayISO())),
    swapEventTimes: (aId, bId) => commit((current) => swapEventTimesIn(current, aId, bId)),
    addHabit: (input) => commit((current) => addHabitTo(current, input)),
    addHabits: (inputs) => commit((current) => addHabitsTo(current, inputs)),
    updateHabit: (id, patch) => commit((current) => updateHabitIn(current, id, patch)),
    deleteHabit: (id) => commit((current) => deleteHabitFrom(current, id)),
    setHabitArchived: (id, archived) => commit((current) => setHabitArchivedIn(current, id, archived)),
    toggleHabit: (habitId, date) => commit((current) => toggleHabitIn(current, habitId, date)),
    setHabitValue: (habitId, date, value) => commit((current) => setHabitValueIn(current, habitId, date, value)),
    skipHabit: (habitId, date) => commit((current) => skipHabitIn(current, habitId, date)),
    addGoal: (input) => commit((current) => addGoalTo(current, input)),
    updateGoal: (id, patch) => commit((current) => updateGoalIn(current, id, patch)),
    deleteGoal: (id) => commit((current) => deleteGoalFrom(current, id)),
    addMilestone: (goalId, title, dueDate) => commit((current) => addMilestoneTo(current, goalId, title, undefined, undefined, dueDate ?? null)),
    toggleMilestone: (goalId, milestoneId) => commit((current) => toggleMilestoneIn(current, goalId, milestoneId)),
    deleteMilestone: (goalId, milestoneId) => commit((current) => deleteMilestoneFrom(current, goalId, milestoneId)),
    addNote: (input) => commit((current) => addNoteTo(current, input)),
    updateNote: (id, patch) => commit((current) => updateNoteIn(current, id, patch)),
    attachFilesToNote: async (noteId, files) => {
      const existing = stateRef.current.notes.find((item) => item.id === noteId)?.attachments ?? [];
      const room = Math.max(0, MAX_ATTACHMENTS_PER_NOTE - existing.length);
      const overflow = Math.max(0, files.length - room); // never store bytes we can't reference
      const toStore = files.slice(0, room);
      const added: AttachmentRef[] = [];
      let tooLarge = 0;
      let failed = 0;
      for (const file of toStore) {
        // Only persist under the note once it exists — never orphaned bytes.
        const result = await storeAttachment(file, file.name, file.type);
        if (result.ref) added.push(result.ref);
        else if (result.error === 'too-large') tooLarge += 1;
        else failed += 1;
      }
      if (added.length > 0) {
        commit((current) => {
          const note = current.notes.find((item) => item.id === noteId);
          const merged = [...(note?.attachments ?? []), ...added].slice(0, MAX_ATTACHMENTS_PER_NOTE);
          return updateNoteIn(current, noteId, { attachments: merged });
        });
      }
      const notice = attachmentNotice(added.length, tooLarge, failed, overflow, added[0]?.name ?? '');
      if (notice) flash(notice);
    },
    deleteNote: (id) => {
      const note = stateRef.current.notes.find((item) => item.id === id);
      if (note && sharedRef.current.code && isSharedNote(note)) recordTombstone('note', id);
      // Attachment bytes stay for the whole session: undo restores the note
      // and its files intact. Truly orphaned bytes are swept on the next boot.
      commit((current) => deleteNoteFrom(current, id));
    },
    setIntention: (date, text) => commit((current) => setIntentionIn(current, date, text)),
    logMood: (date, value, taskId) => commit((current) => setMoodIn(current, date, value, taskId)),
  }), [state, ready, error, notice, saveBlocked, route, navigate, composer, confirm, startFresh, exportData, importText, loadSample, flash, dismissNotice, praise, undo, redo, canUndo, canRedo, themeMode, accent, paletteOpen, settingsOpen, focus, confettiSeed, celebrate, clearCompletedTasks, commit, reminders, setReminders, weekStart, setWeekStart, display, setDisplay, sync, syncStatus, syncMessage, syncAvailable, startSync, stopSync, runSync, deleteCloudCopy, shared, sharedStatus, sharedMessage, startShared, stopShared, runSharedSync, feeds, addFeed, removeFeed, refreshFeeds, weather, setWeather, recordTombstone]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error('usePlanner must be used within PlannerProvider');
  return value;
}
