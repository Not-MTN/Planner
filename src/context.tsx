import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { parseHash, toHash, type Route } from './route';
import { downloadState, loadFrom, parseBackup, saveTo } from './storage';
import {
  addEvent as addEventTo,
  addGoal as addGoalTo,
  addHabit as addHabitTo,
  addMilestone as addMilestoneTo,
  addNote as addNoteTo,
  addTask as addTaskTo,
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
  updateEvent as updateEventIn,
  updateGoal as updateGoalIn,
  updateHabit as updateHabitIn,
  updateNote as updateNoteIn,
  updateTask as updateTaskIn,
} from './mutate';
import { todayISO } from './dates';
import { createEmptyState, type ComposerState, type EventInput, type GoalInput, type HabitInput, type NoteInput, type PlannerState, type TaskInput } from './types';

export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel?: string;
  onConfirm: () => void;
}

interface PlannerContextValue {
  state: PlannerState;
  ready: boolean;
  error: string | null;
  notice: string | null;
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
  addTask: (input: TaskInput) => void;
  updateTask: (id: string, patch: Partial<TaskInput>) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string) => void;
  swapTasks: (aId: string, bId: string) => void;
  addEvent: (input: EventInput) => void;
  updateEvent: (id: string, patch: Partial<EventInput>) => void;
  deleteEvent: (id: string) => void;
  toggleEvent: (id: string) => void;
  moveEvent: (id: string, date: string) => void;
  moveTask: (id: string, date: string | null) => void;
  swapEventTimes: (aId: string, bId: string) => void;
  addHabit: (input: HabitInput) => void;
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

export function PlannerProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(() => loadFrom(localStorage));
  const [state, setState] = useState<PlannerState>(boot.state);
  const [ready] = useState(true);
  const [error, setError] = useState<string | null>(boot.error);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveBlocked, setSaveBlocked] = useState(!boot.persist);
  const [route, setRoute] = useState<Route>(() => (typeof window === 'undefined' ? { name: 'today' } : parseHash(window.location.hash)));
  const [composer, setComposer] = useState<ComposerState | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const persistRef = useRef(boot.persist);
  const noticeTimer = useRef<number | null>(null);

  const flash = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 2800);
  }, []);

  useEffect(() => {
    const sync = (closeOverlays: boolean) => {
      setRoute(parseHash(window.location.hash));
      if (closeOverlays) {
        setComposer(null);
        setConfirm(null);
      }
    };
    const onHash = () => sync(true);
    window.addEventListener('hashchange', onHash);
    if (!window.location.hash) window.history.replaceState(null, '', '#/today');
    sync(false);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const commit = useCallback((updater: (current: PlannerState) => PlannerState) => {
    try {
      const prev = stateRef.current;
      const next = updater(prev);
      stateRef.current = next;
      setState(next);
      if (!persistRef.current) return;
      const saveError = saveTo(localStorage, next);
      if (saveError) {
        stateRef.current = prev;
        setState(prev);
        setError(saveError);
      }
    } catch {
      setError('Something went wrong with that change.');
    }
  }, []);

  const navigate = useCallback((next: Route) => {
    setComposer(null);
    setConfirm(null);
    const hash = toHash(next);
    if (window.location.hash === hash) {
      setRoute(next);
      return;
    }
    window.location.hash = hash;
  }, []);

  const startFresh = useCallback(() => {
    const empty = createEmptyState();
    persistRef.current = true;
    stateRef.current = empty;
    setState(empty);
    setSaveBlocked(false);
    const saveError = saveTo(localStorage, empty);
    setError(saveError);
    if (!saveError) flash('Planner cleared.');
  }, [flash]);

  const importText = useCallback((text: string) => {
    const parsed = parseBackup(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    persistRef.current = true;
    stateRef.current = parsed.state;
    setState(parsed.state);
    setSaveBlocked(false);
    const saveError = saveTo(localStorage, parsed.state);
    setError(saveError);
    if (!saveError) flash('Backup imported.');
  }, [flash]);

  const exportData = useCallback(() => {
    try {
      downloadState(stateRef.current, todayISO());
    } catch {
      setError('The backup could not be downloaded.');
    }
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
    addTask: (input) => commit((current) => addTaskTo(current, input)),
    updateTask: (id, patch) => commit((current) => updateTaskIn(current, id, patch)),
    deleteTask: (id) => commit((current) => deleteTaskFrom(current, id)),
    toggleTask: (id) => commit((current) => toggleTaskIn(current, id)),
    swapTasks: (aId, bId) => commit((current) => swapTasksIn(current, aId, bId)),
    addEvent: (input) => commit((current) => addEventTo(current, input)),
    updateEvent: (id, patch) => commit((current) => updateEventIn(current, id, patch)),
    deleteEvent: (id) => commit((current) => deleteEventFrom(current, id)),
    toggleEvent: (id) => commit((current) => toggleEventIn(current, id)),
    moveEvent: (id, date) => commit((current) => moveEventIn(current, id, date)),
    moveTask: (id, date) => commit((current) => moveTaskIn(current, id, date)),
    swapEventTimes: (aId, bId) => commit((current) => swapEventTimesIn(current, aId, bId)),
    addHabit: (input) => commit((current) => addHabitTo(current, input)),
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
  }), [state, ready, error, notice, saveBlocked, route, navigate, composer, confirm, startFresh, exportData, importText, commit]);

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerContextValue {
  const value = useContext(PlannerContext);
  if (!value) throw new Error('usePlanner must be used within PlannerProvider');
  return value;
}
