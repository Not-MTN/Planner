import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, categoryById } from '../constants';
import { usePlanner } from '../context';
import { addDays, addMinutes, formatFullDate, timeToMinutes, todayISO, weekdayIndex, displayTime } from '../dates';
import { analyzeDraft, filterDraftAgainstState, findPromptScheduleConflicts, habitFrequencyLabel, MAX_PLAN_IMAGE_BYTES, GROQ_KEY_MISSING_MESSAGE, checkGroqConfiguration, friendlyGroqError, generateAIPlan, generateAIReview, hasReviewActivity, parseTimetableImage, refineAIPlan } from '../ai';
import type { AIReview, AIDraft, DraftWarning, PlanRange, PromptScheduleConflict, TimetableParse } from '../ai';
import { MAX_PLAN_DAYS, parsePlanDuration } from '../duration';
import { cx } from '../cx';
import { useSpeechInput } from '../speech';
import { VoiceTalk } from '../components/VoiceTalk';
import { DraftRefine } from '../components/DraftRefine';
import { CalendarIcon, CheckIcon, LeafIcon, MicIcon, PlusIcon, SparklesIcon, UploadIcon } from '../icons';
import type { AIDeclined, AIDeclinedKind, AIMemory, AIMemoryCategory, FixedCommitmentInput } from '../types';
import { markAIVisited } from '../tour';
import { t } from '../i18n';

const WEEKDAYS = [
  { value: 1, label: t("Monday") },
  { value: 2, label: t("Tuesday") },
  { value: 3, label: t("Wednesday") },
  { value: 4, label: t("Thursday") },
  { value: 5, label: t("Friday") },
  { value: 6, label: t("Saturday") },
  { value: 0, label: t("Sunday") },
];

/** Full names by weekday number (0 = Sunday), for the timetable review card. */
const WEEKDAY_LABELS: Record<number, string> = Object.fromEntries(WEEKDAYS.map((day) => [day.value, String(day.label)]));

type PlanningPeriod = 'day' | 'week' | 'month' | 'custom';
type AISection = 'plan' | 'review';

const MEMORY_CATEGORIES: Array<{ value: AIMemoryCategory; label: string }> = [
  { value: 'preference', label: t("Preferences") },
  { value: 'person', label: t("People & relationships") },
  { value: 'routine', label: t("Routines") },
  { value: 'boundary', label: t("Boundaries") },
  { value: 'context', label: t("Life context") },
];

function periodDays(period: PlanningPeriod, customDays: string): number {
  if (period === 'day') return 1;
  if (period === 'week') return 7;
  if (period === 'month') return 30;
  const value = Number(customDays);
  return Number.isFinite(value) ? Math.min(MAX_PLAN_DAYS, Math.max(2, Math.round(value))) : 14;
}

/** Short label for a saved plan — the request in brief. */
function planTitleFor(prompt: string, hasImage: boolean): string {
  const clean = prompt.replace(/\s+/g, ' ').trim();
  if (clean) return clean.length > 60 ? `${clean.slice(0, 60)}…` : clean;
  return hasImage ? t("Plan from your picture") : t("Voice plan");
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That image could not be read. Try another file.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string' || !reader.result.startsWith('data:image/')) {
        reject(new Error('That file is not a readable image.'));
        return;
      }
      resolve(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

const PLAN_CHIPS = [
  "Plan my days around my unfinished tasks",
  "Add a small workout, three times next week",
  "Keep mornings light. Push deep work after lunch.",
  "Weekly reset: review what slipped and re-plan it",
];

export function AIView() {
  const planner = usePlanner();
  const {
    state,
    route,
    navigate,
    openSettings,
    addFixedCommitment,
    updateFixedCommitment,
    deleteFixedCommitment,
    addAIMemory,
    updateAIMemory,
    deleteAIMemory,
    clearAIMemory,
    declineSuggestions,
    forgetDeclined,
    clearDeclined,
    requestConfirm,
    applyAIPlan,
    saveAIPlan,
    updateAIPlan,
    rescheduleTasks,
    flash,
  } = planner;
  const today = todayISO();
  const currentTab: AISection = route.name === 'ai' ? route.tab ?? 'plan' : 'plan';
  const [groqConfigured, setGroqConfigured] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<PlanningPeriod>('day');
  const [customDays, setCustomDays] = useState('14');
  const [planStart, setPlanStart] = useState(today);
  const [reviewThrough, setReviewThrough] = useState(today);
  const [prompt, setPrompt] = useState('');
  const [pendingScheduleConflict, setPendingScheduleConflict] = useState<PromptScheduleConflict | null>(null);
  const speech = useSpeechInput();
  const dictate = () => {
    if (speech.listening) {
      speech.stop();
      return;
    }
    speech.start((spoken) => {
      setPendingScheduleConflict(null);
      setPrompt((current) => (current.trim() ? `${current.replace(/\s+$/, '')} ${spoken}` : spoken));
    });
  };
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [draft, setDraft] = useState<AIDraft | null>(null);
  // The saved-plan id behind the card on screen — so "Add this plan" can mark
  // the copy on the Plans page as added in the same undoable step.
  const [draftPlanId, setDraftPlanId] = useState<string | null>(null);
  const [review, setReview] = useState<AIReview | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [carrySelection, setCarrySelection] = useState<Record<string, boolean>>({});
  const [carryDates, setCarryDates] = useState<Record<string, string>>({});
  const [blockTitle, setBlockTitle] = useState('');
  const [blockDay, setBlockDay] = useState(2);
  const [blockStart, setBlockStart] = useState('08:00');
  const [blockEnd, setBlockEnd] = useState('09:00');
  const [blockCategory, setBlockCategory] = useState('learning');
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [blockError, setBlockError] = useState('');
  /**
   * Which suggestions on the card are ticked, by `kind:index` key.
   *
   * Empty means "everything" rather than "nothing": a draft the user has not
   * touched yet should offer all of it, and opting out has to be an act.
   */
  const [draftSelection, setDraftSelection] = useState<Record<string, boolean>>({});
  /** A timetable read from an image, waiting to become protected weekly time. */
  const [timetable, setTimetable] = useState<TimetableParse | null>(null);
  const [timetableSelection, setTimetableSelection] = useState<Record<number, boolean>>({});

  const days = periodDays(period, customDays);
  const planRange = useMemo<PlanRange>(() => ({ startDate: planStart, days }), [planStart, days]);
  // The range the on-screen draft was written for (it may differ from the
  // builder controls once the user switches them). Voice and typed revisions
  // always follow this range, not whatever the builder says now.
  const [draftRange, setDraftRange] = useState<PlanRange>(planRange);
  // "Plan my next two weeks" — hear the length in the request itself so the
  // AI plans for exactly as long as the user says.
  const heard = useMemo(() => parsePlanDuration(prompt, today), [prompt, today]);
  const heardDiffers = heard !== null && (heard.startDate !== planStart || heard.days !== days);
  const reviewRange = useMemo<PlanRange>(() => ({ startDate: addDays(reviewThrough, -(days - 1)), days }), [reviewThrough, days]);
  const planEnd = addDays(planRange.startDate, planRange.days - 1);
  const reviewStart = reviewRange.startDate;
  const reviewEnd = addDays(reviewRange.startDate, reviewRange.days - 1);
  const sortedBlocks = [...state.fixedCommitments].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

  useEffect(() => {
    let active = true;
    void checkGroqConfiguration().then((configured) => {
      if (active) setGroqConfigured(configured);
    });
    return () => { active = false; };
  }, []);

  // Opening this page retires the one-time "AI coach" attention dot in the nav.
  useEffect(() => {
    markAIVisited();
  }, []);

  const goToTab = (tab: AISection) => navigate({ name: 'ai', tab });

  const generatePlan = async (approvedConflict?: PromptScheduleConflict) => {
    const requestText = prompt.trim();
    const promptRange = heard && heardDiffers ? { startDate: heard.startDate, days: heard.days } : planRange;
    const generationRange = approvedConflict && heard && heardDiffers ? promptRange : planRange;
    if (!approvedConflict && requestText) {
      const conflicts = findPromptScheduleConflicts(requestText, state, promptRange);
      if (conflicts.length > 0) {
        setPendingScheduleConflict(conflicts[0]!);
        setError('');
        return;
      }
    }
    setPendingScheduleConflict(null);
    setError('');
    setDraft(null);
    setDraftPlanId(null);
    const configured = await checkGroqConfiguration();
    setGroqConfigured(configured);
    if (!configured) {
      setError(GROQ_KEY_MISSING_MESSAGE);
      openSettings();
      return;
    }
    setWorking(true);
    try {
      const schedulingDecision = approvedConflict
        ? `\n\nScheduling decision: Keep the existing ${approvedConflict.title} on ${approvedConflict.date} from ${approvedConflict.startTime} to ${approvedConflict.endTime} protected. The user asked for a new activity at ${approvedConflict.requestedTime}; do not move or overlap the existing item. Find a genuinely free alternative time for the requested activity and mention that you worked around the conflict.`
        : '';
      const result = await generateAIPlan({
        prompt: `${requestText}${schedulingDecision}`,
        range: generationRange,
        state,
        imageDataUrl: image?.dataUrl,
      });
      // Every draft also lands on the Plans page, so it can be revisited later.
      const planId = saveAIPlan({
        title: planTitleFor(requestText, Boolean(image?.dataUrl)),
        prompt: requestText,
        summary: result.summary,
        startDate: generationRange.startDate,
        days: generationRange.days,
        source: 'typed',
        tasks: result.tasks,
        events: result.events,
        habits: result.habits,
        suggestions: result.suggestions,
      });
      setDraft(result);
      setDraftRange(generationRange);
      setDraftPlanId(planId);
      setDraftSelection({});
    } catch (reason) {
      setError(friendlyGroqError(reason));
    } finally {
      setWorking(false);
    }
  };

  /**
   * Read a photo of a timetable.
   *
   * Deliberately a separate action from "build a draft": a timetable repeats
   * for a whole term, so it belongs in protected weekly time, not in a list of
   * one-off tasks somebody would have to re-enter every week.
   */
  const readTimetable = async () => {
    if (!image) return;
    setError('');
    setWorking(true);
    try {
      const parsed = await parseTimetableImage({ imageDataUrl: image.dataUrl });
      setTimetable(parsed);
      setTimetableSelection({});
      if (parsed.blocks.length === 0) {
        setError(t("I could not read any weekly times from that picture. Try a clearer, straight-on photo of the whole timetable."));
      }
    } catch (reason) {
      setError(friendlyGroqError(reason));
    } finally {
      setWorking(false);
    }
  };

  const addTimetable = () => {
    if (!timetable) return;
    const kept = timetable.blocks.filter((_, index) => timetableSelection[index] ?? true);
    if (kept.length === 0) {
      setError(t("Tick at least one time to protect, or discard the reading."));
      return;
    }
    for (const block of kept) {
      addFixedCommitment({
        title: block.title,
        weekday: block.weekday,
        startTime: block.startTime,
        endTime: block.endTime,
        category: 'learning',
        // The room or teacher is worth keeping, but it is a note and not part
        // of the title — titles are what show up everywhere else.
        note: block.detail ?? '',
      });
    }
    setTimetable(null);
    setTimetableSelection({});
    setImage(null);
    flash(t("Protected {0} weekly {1}. Undo is available.", { 0: kept.length, 1: kept.length === 1 ? t("time") : t("times") }));
  };

  /**
   * "Revise draft" — the AI edits the draft that is on screen and the linked
   * copy on the Plans page is updated in the same step. The range never
   * changes: the draft keeps the span it was written for.
   */
  const refineDraft = async (request: string) => {
    if (!draft) return;
    setError('');
    const configured = await checkGroqConfiguration();
    setGroqConfigured(configured);
    if (!configured) {
      setError(GROQ_KEY_MISSING_MESSAGE);
      openSettings();
      return;
    }
    setWorking(true);
    try {
      const result = await refineAIPlan({ draft, request, range: draftRange, state });
      setDraft(result);
      if (draftPlanId) {
        updateAIPlan(draftPlanId, {
          summary: result.summary,
          tasks: result.tasks,
          events: result.events,
          habits: result.habits,
          suggestions: result.suggestions,
        });
      }
      flash(t("Draft updated — review the changes before adding."));
    } catch (reason) {
      setError(friendlyGroqError(reason));
    } finally {
      setWorking(false);
    }
  };

  /** Voice drafts land on the Plans page too — source 'voice'. */
  const onVoiceDraft = (next: AIDraft, range: PlanRange) => {
    // Voice asked to change the plan on screen → revise the linked copy in
    // place when the spans line up; otherwise treat it as a brand-new draft.
    const linked = draftPlanId ? state.aiPlans.find((plan) => plan.id === draftPlanId) : null;
    if (linked && linked.startDate === range.startDate && linked.days === range.days) {
      updateAIPlan(linked.id, {
        summary: next.summary,
        tasks: next.tasks,
        events: next.events,
        habits: next.habits,
        suggestions: next.suggestions,
      });
    } else {
      const planId = saveAIPlan({
        title: t("Voice plan"),
        prompt: '',
        summary: next.summary,
        startDate: range.startDate,
        days: range.days,
        source: 'voice',
        tasks: next.tasks,
        events: next.events,
        habits: next.habits,
        suggestions: next.suggestions,
      });
      setDraftPlanId(planId);
    }
    setDraft(next);
    setDraftRange(range);
    setDraftSelection({});
    setError('');
  };

  const generateReview = async () => {
    setError('');
    setReview(null);
    const configured = await checkGroqConfiguration();
    setGroqConfigured(configured);
    if (!configured) {
      setError(GROQ_KEY_MISSING_MESSAGE);
      openSettings();
      return;
    }
    if (!hasReviewActivity(state, reviewRange)) {
      setError(t("There is not enough activity in this period to review yet. Add a task or habit check-in first."));
      return;
    }
    setWorking(true);
    try {
      const result = await generateAIReview({ state, range: reviewRange, today });
      setReview(result);
      setCarrySelection(Object.fromEntries(result.carryForward.map((item) => [item.taskId, true])));
      setCarryDates(Object.fromEntries(result.carryForward.map((item) => [item.taskId, item.date])));
    } catch (reason) {
      setError(friendlyGroqError(reason));
    } finally {
      setWorking(false);
    }
  };

  const onImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      setError(t("Use a PNG or JPG image."));
      return;
    }
    if (file.size > MAX_PLAN_IMAGE_BYTES) {
      setError(t("That image is over 3 MB. Choose a smaller or more compressed image for the AI to read."));
      return;
    }
    try {
      const dataUrl = await readFile(file);
      setImage({ name: file.name, dataUrl });
    } catch (reason) {
      setError(friendlyGroqError(reason));
    }
  };

  /** Unticked means no. A draft that was never touched keeps everything. */
  const isKept = (key: string): boolean => draftSelection[key] ?? true;

  /** The suggestions on the card, in the order they are listed. */
  const draftItems = useMemo(
    () =>
      draft
        ? [
            ...draft.events.map((item, index) => ({ key: `event:${index}`, title: item.title, kind: 'event' as AIDeclinedKind })),
            ...draft.tasks.map((item, index) => ({ key: `task:${index}`, title: item.title, kind: 'task' as AIDeclinedKind })),
            ...draft.habits.map((item, index) => ({ key: `habit:${index}`, title: item.name, kind: 'habit' as AIDeclinedKind })),
          ]
        : [] as Array<{ key: string; title: string; kind: AIDeclinedKind }>,
    [draft],
  );

  const keptCount = draftItems.filter((item) => isKept(item.key)).length;
  const declinedFromDraft = draftItems.filter((item) => !isKept(item.key));

  const addDraft = () => {
    if (!draft) return;
    // Only what was ticked reaches the planner. The rest is remembered in the
    // same undoable step, so undoing the plan undoes the lesson too.
    const kept = new Set(draftItems.filter((item) => isKept(item.key)).map((item) => item.key));
    const nowSafe = filterDraftAgainstState(draft, state);
    const tasks = nowSafe.tasks.filter((_, index) => kept.has(`task:${index}`));
    const events = nowSafe.events.filter((_, index) => kept.has(`event:${index}`));
    const habits = nowSafe.habits.filter((_, index) => kept.has(`habit:${index}`));
    const taskCount = tasks.length;
    const eventCount = events.length;
    const habitCount = habits.length;
    if (taskCount + eventCount + habitCount === 0) {
      // Nothing ticked is a nudge, not an error — unless the draft itself was
      // empty to begin with, which is worth saying out loud.
      if (nowSafe.tasks.length + nowSafe.events.length + nowSafe.habits.length === 0) {
        setDraft(nowSafe);
        setError(t("Nothing new can be added from this draft. It may already be in your planner or an event time may conflict with protected time."));
        return;
      }
      setError(t("Tick at least one suggestion to add, or discard the draft."));
      return;
    }
    const declined = declinedFromDraft.map(({ title, kind }) => ({ title, kind }));
    applyAIPlan({ tasks, events, habits }, draftPlanId ?? undefined, declined);
    setDraft(null);
    setDraftPlanId(null);
    setDraftSelection({});
    flash(
      declined.length > 0
        ? t("Added {0} of {1} suggestions. The {2} you left out will not be suggested again — forget them in AI memory if you change your mind.", {
            0: taskCount + eventCount + habitCount,
            1: draftItems.length,
            2: declined.length === 1 ? t("one") : t("ones"),
          })
        : t("Added {0} {1}, {2} {3} and {4} {5}. Undo is available.", { 0: taskCount, 1: taskCount === 1 ? t("task") : t("tasks"), 2: eventCount, 3: eventCount === 1 ? t("event") : t("events"), 4: habitCount, 5: habitCount === 1 ? t("habit") : t("habits") }),
    );
  };

  const discardDraft = () => {
    if (!draft) return;
    // Discarding the lot is the strongest signal there is: every suggestion
    // on the card was looked at and turned down.
    const declined = draftItems.map(({ title, kind }) => ({ title, kind }));
    if (declined.length > 0) declineSuggestions(declined);
    setDraft(null);
    setDraftPlanId(null);
    setDraftSelection({});
    flash(
      declined.length > 0
        ? t("Draft discarded. Those {0} suggestions will not come back.", { 0: declined.length })
        : t("Draft discarded."),
    );
  };

  const saveBlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBlockError('');
    if (!blockTitle.trim()) {
      setBlockError(t("Give this recurring time a name."));
      return;
    }
    if (blockStart >= blockEnd) {
      setBlockError(t("The end time needs to be later than the start time."));
      return;
    }
    const input: FixedCommitmentInput = {
      title: blockTitle.trim(),
      weekday: blockDay,
      startTime: blockStart,
      endTime: blockEnd,
      category: blockCategory,
      note: '',
    };
    if (editingBlockId) updateFixedCommitment(editingBlockId, input);
    else addFixedCommitment(input);
    setBlockTitle('');
    setEditingBlockId(null);
    flash(editingBlockId ? t("Weekly time updated.") : t("Weekly time protected."));
  };

  const editBlock = (id: string) => {
    const block = state.fixedCommitments.find((item) => item.id === id);
    if (!block) return;
    setEditingBlockId(id);
    setBlockTitle(block.title);
    setBlockDay(block.weekday);
    setBlockStart(block.startTime);
    setBlockEnd(block.endTime);
    setBlockCategory(block.category);
    setBlockError('');
  };

  const carrySelected = review?.carryForward.filter((item) => carrySelection[item.taskId] && state.tasks.some((task) => task.id === item.taskId && !task.completed)) ?? [];

  const carryTasks = () => {
    const moves: Array<{ id: string; date: string }> = [];
    const blocked: string[] = [];
    for (const item of carrySelected) {
      const date = carryDates[item.taskId] || item.date;
      if (date <= today) continue;
      const conflict = timedTaskConflict(state, item.taskId, date, moves);
      if (conflict) blocked.push(`${item.title} (${conflict})`);
      else moves.push({ id: item.taskId, date });
    }
    if (moves.length === 0) {
      if (blocked.length > 0) setError(t("No tasks were moved. These timed items would overlap your schedule: {0}.", { 0: blocked.join(', ') }));
      return;
    }
    rescheduleTasks(moves);
    setReview(null);
    flash(t("Moved {0} unfinished {1} to future days.", { 0: moves.length, 1: moves.length === 1 ? t("task") : t("tasks") }));
    if (blocked.length > 0) setError(t("Kept {0} timed {1} on their original dates because a protected or scheduled time would conflict.", { 0: blocked.length, 1: blocked.length === 1 ? t("task") : t("tasks") }));
  };

  return (
    <div className="view ai-view">
      <header className="page-head ai-page-head">
        <div>
          <p className="kicker">{t("AI coach · powered by Groq")}</p>
          <h1>{t("Make a plan that fits.")}</h1>
          <p className="lede">{t("Turn a brain dump or a picture into a kind, realistic schedule — then reflect on what worked.")}</p>
        </div>
        <div className="ai-head-actions">
          <span className={cx('chip', groqConfigured ? 'ai-connected' : 'ai-disconnected')}>
            <span className="status-dot" />{groqConfigured === null ? t("Checking Groq key…") : groqConfigured ? t("Groq connected") : 'GROQ_API_KEY needed'}
          </span>
          <button type="button" className="btn btn-soft btn-small" onClick={openSettings}>{t("AI settings")}</button>
        </div>
      </header>

      <div className="ai-tabs segmented" role="tablist" aria-label={t("AI coach")}>
        <button type="button" role="tab" aria-selected={currentTab === 'plan'} className={cx('seg', currentTab === 'plan' && 'on')} onClick={() => goToTab('plan')}>
          <SparklesIcon size={15} /> {t("Plan with AI")}
        </button>
        <button type="button" role="tab" aria-selected={currentTab === 'review'} className={cx('seg', currentTab === 'review' && 'on')} onClick={() => goToTab('review')}>
          <CheckIcon size={15} /> {t("Review how I did")}
        </button>
      </div>

      <section className="ai-privacy card">
        <span className="ai-privacy-icon"><LeafIcon size={18} /></span>
        <p><strong>{t("Your data, your choice.")}</strong> {t("Your prompt, saved AI memory, and relevant schedule/check-in details go to Groq through the server proxy. The API key stays on the server, planner notes are not included, and you can forget memory at any time. AI suggestions never change your planner until you review and add them.")}</p>
      </section>

      <MemoryCard
        memories={state.aiMemory}
        declined={state.aiDeclined ?? []}
        addMemory={addAIMemory}
        updateMemory={updateAIMemory}
        deleteMemory={deleteAIMemory}
        clearMemory={clearAIMemory}
        forgetDeclined={forgetDeclined}
        clearDeclined={clearDeclined}
        requestConfirm={requestConfirm}
        flash={flash}
      />

      {error ? <div className="banner ai-error" role="alert"><p>{error}</p></div> : null}

      {currentTab === 'plan' ? (
        <>
          <p className="ai-apply-note" role="note">
            {t("Typed and spoken requests create a reviewable draft. Voice can revise the draft on screen, but it does not directly change existing tasks or events. Review the draft and choose Add this plan to add its tasks, events and habits to your planner.")}
          </p>
          <VoiceTalk onDraft={onVoiceDraft} currentDraft={draft ? { draft, range: draftRange } : null} />
          <section className="card ai-builder">
            <header className="card-head">
              <div>
                <p className="kicker">{t("Tell it what matters")}</p>
                <h2 className="card-title">{t("What do you want to do?")}</h2>
              </div>
              <span className="chip">{planRange.days} {planRange.days === 1 ? t("day") : t("days")}</span>
            </header>
            <div className="ai-range-controls">
              <label className="field">
                <span>{t("Plan horizon")}</span>
                <select value={period} onChange={(event) => setPeriod(event.target.value as PlanningPeriod)}>
                  <option value="day">{t("Daily · 1 day")}</option>
                  <option value="week">{t("Weekly · 7 days")}</option>
                  <option value="month">{t("Monthly · 30 days")}</option>
                  <option value="custom">{t("Custom range")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("Start date")}</span>
                <input type="date" min={today} value={planStart} onChange={(event) => setPlanStart(event.target.value || today)} />
              </label>
              {period === 'custom' ? (
                <label className="field ai-custom-days">
                  <span>{t("Number of days")}</span>
                  <input type="number" min={2} max={MAX_PLAN_DAYS} value={customDays} onChange={(event) => setCustomDays(event.target.value)} />
                </label>
              ) : null}
            </div>
            <p className="ai-range-note">{t("{start} — {end}. Fixed weekly times and existing events are treated as busy, protected slots.", {
              start: formatFullDate(planRange.startDate),
              end: formatFullDate(planEnd),
            })}</p>
            {pendingScheduleConflict ? (
              <div className="ai-schedule-conflict" role="alert">
                <strong>{t("I spotted a schedule conflict")}</strong>
                <p>{t("You mentioned {0}; {1} is already scheduled on {2} from {3} to {4}. Should I keep that commitment and find another time for your request?", {
                  0: displayTime(pendingScheduleConflict.requestedTime),
                  1: pendingScheduleConflict.title,
                  2: formatFullDate(pendingScheduleConflict.date),
                  3: displayTime(pendingScheduleConflict.startTime),
                  4: displayTime(pendingScheduleConflict.endTime),
                })}</p>
                <div className="form-actions">
                  <button type="button" className="btn btn-primary btn-small" onClick={() => void generatePlan(pendingScheduleConflict)}>
                    {t("Keep {0} and find another time", { 0: pendingScheduleConflict.title })}
                  </button>
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => setPendingScheduleConflict(null)}>{t("I’ll change my request")}</button>
                </div>
              </div>
            ) : null}
            {heard && heardDiffers ? (
              <div className="ai-heard-range" role="status">
                <span><CalendarIcon size={14} /> {heard.clamped
                  ? t("That's a long stretch — I can plan up to {0} days in one go.", { 0: MAX_PLAN_DAYS })
                  : t("Sounds like you want {0} {1} planned.", { 0: heard.days, 1: heard.days === 1 ? t("day") : t("days") })}
                </span>
                <button
                  type="button"
                  className="btn btn-soft btn-small"
                  onClick={() => { setPeriod('custom'); setCustomDays(String(heard.days)); setPlanStart(heard.startDate); }}
                >
                  {t("Plan that long")}
                </button>
              </div>
            ) : null}
            <div className="chip-row ai-chips" role="group" aria-label={t("Start from a suggestion")}>
              {PLAN_CHIPS.map((chip) => (
                <button key={chip} type="button" className="chip" onClick={() => { setPendingScheduleConflict(null); setPrompt(chip); }}>
                  {chip}
                </button>
              ))}
            </div>
            <label className="field ai-prompt-field">
              <span className="ai-prompt-label">
                {t("Your plan request")}
                {speech.available ? (
                  <button
                    type="button"
                    className={cx('icon-btn', 'voice-mic', speech.listening && 'listening')}
                    aria-label={speech.listening ? t("Stop dictation") : t("Dictate your plan request")}
                    aria-pressed={speech.listening}
                    title={t("Dictate — tap, speak, done")}
                    onClick={dictate}
                  >
                    <MicIcon size={16} />
                    {speech.listening ? <span className="voice-live">{t("Listening…")}</span> : null}
                  </button>
                ) : null}
              </span>
              <textarea
                rows={5}
                maxLength={2400}
                value={prompt}
                placeholder={speech.available ? t("Type or dictate — tap the mic and just say your day. Example: “Class Tuesday 8am, gym after, help me fit it all in.”") : t("Example: I have class Tuesday morning. Help me fit in studying, a short workout, meals, and time to unwind. Keep each day manageable.")}
                onChange={(event) => { setPendingScheduleConflict(null); setPrompt(event.target.value); }}
              />
            </label>
            <div className="ai-upload-row">
              <label className="btn btn-soft btn-small ai-upload-button">
                <UploadIcon size={15} /> {t("Add a plan picture")}
                <input type="file" accept="image/png,image/jpeg" onChange={onImage} />
              </label>
              <span className="hint">{t("PNG or JPG · up to 3 MB. Images are sent to Groq for reading and are not saved in your planner.")}</span>
            </div>
            {image ? (
              <div className="ai-image-preview">
                <img src={image.dataUrl} alt={t("Preview of uploaded plan")} />
                <div><strong>{image.name}</strong><span>{t("Attached to this request only")}</span></div>
                <button type="button" className="text-btn" onClick={() => setImage(null)}>{t("Remove")}</button>
              </div>
            ) : null}
            {image ? (
              <div className="ai-timetable-row">
                <button type="button" className="btn btn-soft btn-small" disabled={working} onClick={() => void readTimetable()}>
                  <CalendarIcon size={15} /> {working ? t("Reading the timetable…") : t("This is a weekly timetable")}
                </button>
                <span className="hint">{t("Reads the class grid into protected weekly times instead of one-off tasks.")}</span>
              </div>
            ) : null}
            <div className="ai-builder-actions">
              <p className="meta">{t("Health ideas stay gentle and optional. The AI is not a medical professional.")}</p>
              <button type="button" className="btn btn-primary" disabled={working || (!prompt.trim() && !image)} onClick={() => void generatePlan()}>
                <SparklesIcon size={16} />{working ? t("Building your plan…") : t("Build a draft")}
              </button>
            </div>
          </section>

          {timetable ? (
            <TimetableCard
              timetable={timetable}
              isKept={(index) => timetableSelection[index] ?? true}
              onToggle={(index) => setTimetableSelection((current) => ({ ...current, [index]: !(current[index] ?? true) }))}
              onAdd={addTimetable}
              onDiscard={() => { setTimetable(null); setTimetableSelection({}); }}
            />
          ) : null}

          {draft ? (
            <PlanDraft
              draft={draft}
              warnings={analyzeDraft(draft, state, draftRange)}
              working={working}
              onRefine={refineDraft}
              onAdd={addDraft}
              onDiscard={discardDraft}
              isKept={isKept}
              onToggle={(key) => setDraftSelection((current) => ({ ...current, [key]: !(current[key] ?? true) }))}
              keptCount={keptCount}
            />
          ) : null}

          <section className="card fixed-manager">
            <header className="card-head">
              <div>
                <p className="kicker">{t("Protect your schedule")}</p>
                <h2 className="card-title">{t("Weekly fixed times")}</h2>
                <p className="meta">{t("Add class, work, care, or anything that always happens at the same time.")}</p>
              </div>
              <span className="fixed-protected-count">{state.fixedCommitments.length} {t('protected')}</span>
            </header>
            <form className="fixed-form" onSubmit={saveBlock}>
              <label className="field">
                <span>{t("Name")}</span>
                <input value={blockTitle} maxLength={140} placeholder={t("Class")} onChange={(event) => setBlockTitle(event.target.value)} />
              </label>
              <label className="field">
                <span>{t("Repeats")}</span>
                <select value={blockDay} onChange={(event) => setBlockDay(Number(event.target.value))}>
                  {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{t("Starts")}</span>
                <input type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} />
              </label>
              <label className="field">
                <span>{t("Ends")}</span>
                <input type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} />
              </label>
              <label className="field">
                <span>{t("Type")}</span>
                <select value={blockCategory} onChange={(event) => setBlockCategory(event.target.value)}>
                  {CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <div className="fixed-form-actions">
                {editingBlockId ? <button type="button" className="btn btn-ghost btn-small" onClick={() => { setEditingBlockId(null); setBlockTitle(''); setBlockError(''); }}>{t("Cancel")}</button> : null}
                <button type="submit" className="btn btn-soft btn-small"><PlusIcon size={15} />{editingBlockId ? t("Save change") : t("Protect time")}</button>
              </div>
              {blockError ? <small className="field-error fixed-form-error">{blockError}</small> : null}
            </form>
            {sortedBlocks.length === 0 ? (
              <p className="empty-inline fixed-empty">{t("No recurring times yet. Add “Class · Tuesday · 08:00–09:00” to keep that hour clear in every AI plan.")}</p>
            ) : (
              <ul className="fixed-list">
                {sortedBlocks.map((block) => (
                  <li key={block.id} className="fixed-list-item">
                    <span className={cx('fixed-list-dot', `accent-${categoryById(block.category).accent}`)} />
                    <div className="fixed-list-copy">
                      <strong>{block.title}</strong>
                      <span>{t("{day} · {start}–{end} · Protected every week", {
                        day: WEEKDAYS.find((day) => day.value === block.weekday)?.label ?? '',
                        start: displayTime(block.startTime),
                        end: displayTime(block.endTime),
                      })}</span>
                    </div>
                    <button type="button" className="text-btn" onClick={() => editBlock(block.id)}>{t("Edit")}</button>
                    <button type="button" className="icon-btn" aria-label={t("Remove {0}", { 0: block.title })} onClick={() => { deleteFixedCommitment(block.id); if (editingBlockId === block.id) { setEditingBlockId(null); setBlockTitle(''); } }}>×</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : (
        <>
          <section className="card ai-review-controls">
            <div>
              <p className="kicker">{t("Look back without judgment")}</p>
              <h2 className="card-title">{t("How did this stretch go?")}</h2>
              <p className="meta">{t("Review plans, completions, and habit check-ins. Missed items are suggestions to reschedule, never failures.")}</p>
            </div>
            <div className="ai-review-form">
              <label className="field">
                <span>{t("Review period")}</span>
                <select value={period} onChange={(event) => setPeriod(event.target.value as PlanningPeriod)}>
                  <option value="day">{t("Daily · 1 day")}</option>
                  <option value="week">{t("Weekly · 7 days")}</option>
                  <option value="month">{t("Monthly · 30 days")}</option>
                  <option value="custom">{t("Custom range")}</option>
                </select>
              </label>
              <label className="field">
                <span>{t("Through")}</span>
                <input type="date" max={today} value={reviewThrough} onChange={(event) => setReviewThrough(event.target.value || today)} />
              </label>
              {period === 'custom' ? (
                <label className="field">
                  <span>{t("Number of days")}</span>
                  <input type="number" min={2} max={MAX_PLAN_DAYS} value={customDays} onChange={(event) => setCustomDays(event.target.value)} />
                </label>
              ) : null}
              <button type="button" className="btn btn-primary" disabled={working} onClick={generateReview}>
                <SparklesIcon size={16} />{working ? t("Reflecting…") : t("Get my AI review")}
              </button>
            </div>
            <p className="ai-range-note">{formatFullDate(reviewStart)} — {formatFullDate(reviewEnd)}</p>
          </section>
          {review ? (
            <ReviewCard
              review={review}
              carrySelection={carrySelection}
              carryDates={carryDates}
              setCarrySelection={setCarrySelection}
              setCarryDates={setCarryDates}
              today={today}
              onCarry={carryTasks}
              selectedCount={carrySelected.length}
            />
          ) : null}
        </>
      )}

      <section className="ai-ideas card wash-sage">
        <div className="ai-ideas-mark"><LeafIcon size={20} /></div>
        <div>
          <p className="kicker">{t("A few good next steps")}</p>
          <h2 className="card-title">{t("Small features that make this even smarter")}</h2>
          <ul>
            <li><strong>{t("Protected weekly schedule:")}</strong> {t("add classes, shifts, appointments, or family time once; AI will reserve those slots.")}</li>
            <li><strong>{t("End-of-day check-in:")}</strong> {t("a two-minute note about energy and mood can help future plans get more realistic.")}</li>
            <li><strong>{t("Gentle capacity setting:")}</strong> {t("choose a light, normal, or full day so the planner leaves enough room to rest.")}</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function MemoryCard({
  memories,
  declined,
  addMemory,
  updateMemory,
  deleteMemory,
  clearMemory,
  forgetDeclined,
  clearDeclined,
  requestConfirm,
  flash,
}: {
  memories: AIMemory[];
  declined: AIDeclined[];
  addMemory: (input: { text: string; category: AIMemoryCategory }) => void;
  updateMemory: (id: string, patch: { text?: string; category?: AIMemoryCategory }) => void;
  deleteMemory: (id: string) => void;
  clearMemory: () => void;
  forgetDeclined: (id: string) => void;
  clearDeclined: () => void;
  requestConfirm: (request: { title: string; body: string; confirmLabel?: string; onConfirm: () => void }) => void;
  flash: (message: string) => void;
}) {
  const [text, setText] = useState('');
  const [category, setCategory] = useState<AIMemoryCategory>('context');
  const [editingId, setEditingId] = useState<string | null>(null);

  const reset = () => {
    setText('');
    setCategory('context');
    setEditingId(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!text.trim()) return;
    if (editingId) {
      updateMemory(editingId, { text: text.trim(), category });
      flash(t("AI memory updated."));
    } else {
      addMemory({ text: text.trim(), category });
      flash(t("AI will remember that."));
    }
    reset();
  };

  const forgetAllDeclined = () => {
    if (declined.length === 0) return;
    requestConfirm({
      title: t("Forget every suggestion you turned down?"),
      body: t("The AI may suggest all of them again. Your saved memories are untouched."),
      confirmLabel: t("Forget all"),
      onConfirm: () => {
        clearDeclined();
        flash(t("Those suggestions may come back."));
      },
    });
  };

  const edit = (memory: AIMemory) => {
    setEditingId(memory.id);
    setText(memory.text);
    setCategory(memory.category);
  };

  const forgetAll = () => {
    if (memories.length === 0) return;
    requestConfirm({
      title: t("Forget all AI memory?"),
      body: t("This removes the facts and preferences you saved for AI. Your tasks, notes, and calendar stay unchanged."),
      confirmLabel: t("Forget all"),
      onConfirm: () => {
        clearMemory();
        reset();
        flash(t("AI memory forgotten."));
      },
    });
  };

  return (
    <section className="card ai-memory-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Teach it what matters")}</p>
          <h2 className="card-title">{t("AI memory")}</h2>
          <p className="meta">{t("Save the parts of your life you want future plans to understand. Write them in your own words; you stay in control.")}</p>
          <p className="ai-memory-safety">{t("Only save details you are comfortable sending to Groq when you ask for help.")}</p>
        </div>
        <span className="ai-memory-count">{memories.length} {t("remembered")}</span>
      </header>
      <form className="ai-memory-form" onSubmit={submit}>
        <label className="field ai-memory-text">
          <span>{editingId ? t("Edit memory") : t("Something for AI to remember")}</span>
          <textarea
            rows={2}
            maxLength={500}
            value={text}
            placeholder={t("Example: I do my best thinking before noon, and I keep Sunday evenings for family.")}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <label className="field ai-memory-category">
          <span>{t("Memory type")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as AIMemoryCategory)}>
            {MEMORY_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <div className="ai-memory-actions">
          {editingId ? <button type="button" className="btn btn-ghost btn-small" onClick={reset}>{t("Cancel")}</button> : null}
          <button type="submit" className="btn btn-soft btn-small" disabled={!text.trim()}>
            <PlusIcon size={15} /> {editingId ? t("Save memory") : t("Remember this")}
          </button>
        </div>
      </form>
      {memories.length > 0 ? (
        <>
          <ul className="ai-memory-list">
            {memories.map((memory) => (
              <li key={memory.id}>
                <div className="ai-memory-copy">
                  <span className="ai-memory-kind">{memoryCategoryLabel(memory.category)}</span>
                  <p>{memory.text}</p>
                </div>
                <div className="ai-memory-item-actions">
                  <button type="button" className="text-btn" onClick={() => edit(memory)}>{t("Edit")}</button>
                  <button type="button" className="icon-btn" aria-label={t("Forget {0}", { 0: memory.text })} onClick={() => { deleteMemory(memory.id); if (editingId === memory.id) reset(); }}>{t("Forget")}</button>
                </div>
              </li>
            ))}
          </ul>
          <div className="ai-memory-foot">
            <span>{t("Only these saved memories are added to AI planning and reviews. They are stored with your planner.")}</span>
            <button type="button" className="text-btn danger-text" onClick={forgetAll}>{t("Forget all")}</button>
          </div>
        </>
      ) : (
        <p className="empty-inline ai-memory-empty">{t("Nothing saved yet. Add a preference, person, routine, or boundary when you are ready.")}</p>
      )}
      {declined.length > 0 ? (
        <div className="ai-declined">
          <div className="ai-declined-head">
            <strong>{t("Suggestions you turned down")}</strong>
            {/* Visible on purpose: a preference the AI learned on its own and
                then acted on silently is a guess nobody can correct. */}
            <button type="button" className="text-btn danger-text" onClick={forgetAllDeclined}>{t("Forget all")}</button>
          </div>
          <p className="meta">{t("The AI will not suggest these again. They are forgotten on their own after a while. Remove one if you would like to hear it again.")}</p>
          <ul className="ai-memory-list">
            {[...declined].reverse().map((item) => (
              <li key={item.id}>
                <div className="ai-memory-copy">
                  <span className="ai-memory-kind">{declinedKindLabel(item.kind)}</span>
                  <p>{item.title}</p>
                </div>
                <div className="ai-memory-item-actions">
                  <button type="button" className="text-btn" onClick={() => { forgetDeclined(item.id); flash(t("It may suggest that again.")); }}>{t("Forget")}</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function declinedKindLabel(kind: AIDeclinedKind): string {
  return kind === 'task' ? t("Task") : kind === 'event' ? t("Event") : t("Habit");
}

function memoryCategoryLabel(category: AIMemoryCategory): string {
  return MEMORY_CATEGORIES.find((item) => item.value === category)?.label ?? t("Life context");
}

function timedTaskConflict(
  state: ReturnType<typeof usePlanner>['state'],
  taskId: string,
  date: string,
  acceptedMoves: Array<{ id: string; date: string }>,
): string | null {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task?.dueTime) return null;
  const start = timeToMinutes(task.dueTime);
  const end = Math.min(24 * 60, start + 30);
  const slots: Array<{ start: string; end: string; title: string }> = [
    ...state.fixedCommitments.filter((item) => item.weekday === weekdayIndex(date)).map((item) => ({ start: item.startTime, end: item.endTime, title: item.title })),
    ...state.events.filter((item) => item.date === date).map((item) => ({ start: item.startTime, end: item.endTime ?? addMinutes(item.startTime, 60), title: item.title })),
    ...state.tasks.filter((item) => item.id !== taskId && item.dueDate === date && item.dueTime).map((item) => ({ start: item.dueTime as string, end: addMinutes(item.dueTime as string, 30), title: item.title })),
    ...acceptedMoves.filter((move) => move.date === date).flatMap((move) => {
      const other = state.tasks.find((item) => item.id === move.id);
      return other?.dueTime ? [{ start: other.dueTime, end: addMinutes(other.dueTime, 30), title: other.title }] : [];
    }),
  ];
  const conflict = slots.find((slot) => {
    const slotStart = timeToMinutes(slot.start);
    const slotEnd = timeToMinutes(slot.end);
    return start < slotEnd && slotStart < end;
  });
  return conflict ? `overlaps ${conflict.title}` : null;
}

function PlanDraft({ draft, warnings, working, onRefine, onAdd, onDiscard, isKept, onToggle, keptCount }: {
  draft: AIDraft;
  warnings: DraftWarning[];
  working: boolean;
  onRefine: (request: string) => void;
  onAdd: () => void;
  onDiscard: () => void;
  /** Unticked means no: opting out has to be an act, not a default. */
  isKept: (key: string) => boolean;
  onToggle: (key: string) => void;
  keptCount: number;
}) {
  const total = draft.tasks.length + draft.events.length + draft.habits.length;
  const allKept = keptCount === total;
  const reason = (key: string): string => draft.reasons?.[key] ?? '';
  return (
    <section className="card ai-draft-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Review before adding")}</p>
          <h2 className="card-title">{t("Your AI draft")}</h2>
        </div>
        <span className="chip">{allKept ? `${total} ${t('suggestions')}` : `${keptCount} ${t('of')} ${total}`}</span>
      </header>
      <p className="ai-draft-summary">{draft.summary}</p>
      {warnings.length > 0 ? (
        <div className="draft-warnings" role="status">
          <strong>{t("A few things to double-check")}</strong>
          <ul>{warnings.map((warning, index) => <li key={`${warning.kind}-${index}`}>{warning.message}</li>)}</ul>
        </div>
      ) : null}
      <DraftRefine working={working} onRefine={onRefine} />
      {draft.suggestions.length > 0 ? (
        <div className="ai-wellbeing"><LeafIcon size={17} /><div><strong>{t("Gentle wellbeing ideas")}</strong><ul>{draft.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div></div>
      ) : null}
      {draft.tasks.length + draft.events.length + draft.habits.length === 0 ? <p className="empty-inline">{t("The AI did not find new items to add. Try a more specific request.")}</p> : null}
      {draft.events.length > 0 ? <DraftGroup title={t("Timed plans")} count={draft.events.length}>
        {draft.events.map((item, index) => (
          <li key={`e-${index}`} className={isKept(`event:${index}`) ? 'draft-item' : 'draft-item is-declined'}>
            <label className="draft-check">
              <input type="checkbox" checked={isKept(`event:${index}`)} onChange={() => onToggle(`event:${index}`)} aria-label={t("Add {0}", { 0: item.title })} />
              <span className="draft-kind event-kind">{t("Event")}</span>
              <span className="draft-item-copy">
                <span className="draft-item-title">{item.title}</span>
                {reason(`event:${index}`) ? <small className="draft-item-reason">{reason(`event:${index}`)}</small> : null}
              </span>
              <small className="draft-item-when">{formatFullDate(item.date)} · {displayTime(item.startTime)}–{displayTime(item.endTime)}</small>
            </label>
          </li>
        ))}
      </DraftGroup> : null}
      {draft.tasks.length > 0 ? <DraftGroup title={t("Tasks")} count={draft.tasks.length}>
        {draft.tasks.map((item, index) => (
          <li key={`t-${index}`} className={isKept(`task:${index}`) ? 'draft-item' : 'draft-item is-declined'}>
            <label className="draft-check">
              <input type="checkbox" checked={isKept(`task:${index}`)} onChange={() => onToggle(`task:${index}`)} aria-label={t("Add {0}", { 0: item.title })} />
              <span className="draft-kind task-kind">{t("Task")}</span>
              <span className="draft-item-copy">
                <span className="draft-item-title">{item.title}</span>
                {reason(`task:${index}`) ? <small className="draft-item-reason">{reason(`task:${index}`)}</small> : null}
              </span>
              <small className="draft-item-when">{item.dueDate ? formatFullDate(item.dueDate) : ''}</small>
            </label>
          </li>
        ))}
      </DraftGroup> : null}
      {draft.habits.length > 0 ? <DraftGroup title={t("Habits")} count={draft.habits.length}>
        {draft.habits.map((item, index) => (
          <li key={`h-${index}`} className={isKept(`habit:${index}`) ? 'draft-item' : 'draft-item is-declined'}>
            <label className="draft-check">
              <input type="checkbox" checked={isKept(`habit:${index}`)} onChange={() => onToggle(`habit:${index}`)} aria-label={t("Add {0}", { 0: item.name })} />
              <span className="draft-kind habit-kind">{t("Habit")}</span>
              <span className="draft-item-copy">
                <span className="draft-item-title">{item.name}</span>
                {reason(`habit:${index}`) ? <small className="draft-item-reason">{reason(`habit:${index}`)}</small> : null}
              </span>
              <small className="draft-item-when">{habitFrequencyLabel(item.frequency)}</small>
            </label>
          </li>
        ))}
      </DraftGroup> : null}
      {draft.skippedEvents.length > 0 ? (
        <div className="ai-skipped">
          <strong>{t("Protected times kept clear")}</strong>
          <p>{t("These timed suggestions were skipped because they overlapped with an existing commitment:")}</p>
          <ul>{draft.skippedEvents.map((item, index) => <li key={`${item.title}-${index}`}>{item.title} · {formatFullDate(item.date)} — {item.reason}</li>)}</ul>
        </div>
      ) : null}
      <div className="form-actions ai-draft-actions">
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>{t("Discard draft")}</button>
        <button type="button" className="btn btn-primary" disabled={total === 0 || keptCount === 0} onClick={onAdd}>
          <CheckIcon size={16} /> {allKept ? t("Add this plan") : t("Add {0} selected", { 0: keptCount })}
        </button>
      </div>
      {/* Said plainly, because the consequence is otherwise invisible: what
          is left out here stops being suggested at all. */}
      <p className="meta ai-undo-note">{allKept ? t("Everything is ticked, so all of it will be added. Untick anything you do not want — the AI stops suggesting what you leave out.") : t("Adding what is ticked is one undoable change. The {0} you left out will not be suggested again.", { 0: keptCount === total ? 0 : total - keptCount })}</p>
      <p className="meta ai-saved-note">{t("Also saved to your Plans page, so you can come back to it any time.")}</p>
    </section>
  );
}

/**
 * The timetable read from an image, before it becomes protected time.
 *
 * Reviewed rather than applied straight away. These blocks are what the whole
 * week gets planned around, so a wrong one is expensive: it does not just add
 * a bad item, it quietly pushes everything else out of the way.
 */
function TimetableCard({ timetable, isKept, onToggle, onAdd, onDiscard }: {
  timetable: TimetableParse;
  isKept: (index: number) => boolean;
  onToggle: (index: number) => void;
  onAdd: () => void;
  onDiscard: () => void;
}) {
  const keptCount = timetable.blocks.filter((_, index) => isKept(index)).length;
  const allKept = keptCount === timetable.blocks.length;
  return (
    <section className="card ai-draft-card ai-timetable-card">
      <header className="card-head">
        <div>
          <p className="kicker">{t("Review before protecting")}</p>
          <h2 className="card-title">{t("Your weekly timetable")}</h2>
        </div>
        <span className="chip">{allKept ? `${timetable.blocks.length} ${t("times")}` : `${keptCount} ${t("of")} ${timetable.blocks.length}`}</span>
      </header>
      <p className="ai-draft-summary">{timetable.summary}</p>

      {timetable.blocks.length > 0 ? (
        <div className="draft-group">
          <div className="draft-group-head">
            <strong>{t("Every week")}</strong>
            <span>{timetable.blocks.length}</span>
          </div>
          <ul>
            {timetable.blocks.map((block, index) => (
              <li key={`${block.weekday}-${block.startTime}-${block.title}`} className={isKept(index) ? 'draft-item' : 'draft-item is-declined'}>
                <label className="draft-check">
                  <input
                    type="checkbox"
                    checked={isKept(index)}
                    onChange={() => onToggle(index)}
                    aria-label={t("Add {0}", { 0: `${block.title} ${WEEKDAY_LABELS[block.weekday] ?? ''} ${displayTime(block.startTime)}` })}
                  />
                  <span className="draft-kind event-kind">{WEEKDAY_LABELS[block.weekday] ?? ''}</span>
                  <span className="draft-item-title">{block.title}</span>
                  <small>
                    {displayTime(block.startTime)}–{displayTime(block.endTime)}
                    {block.detail ? ` · ${block.detail}` : ''}
                  </small>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* What could not be read is named, not guessed: a gap is obvious and
          fixable, a confidently wrong time is neither. */}
      {timetable.unclear.length > 0 ? (
        <div className="ai-skipped">
          <strong>{t("I could not read these")}</strong>
          <p>{t("Add them yourself with Protect time — I would rather leave a gap than invent a time.")}</p>
          <ul>{timetable.unclear.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      ) : null}

      <div className="form-actions ai-draft-actions">
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>{t("Discard")}</button>
        <button type="button" className="btn btn-primary" disabled={timetable.blocks.length === 0 || keptCount === 0} onClick={onAdd}>
          <CheckIcon size={16} /> {allKept ? t("Protect these times") : t("Protect {0} selected", { 0: keptCount })}
        </button>
      </div>
      <p className="meta ai-undo-note">{t("Each one becomes protected weekly time, so future plans work around it. Untick anything that is not right.")}</p>
    </section>
  );
}

function DraftGroup({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="draft-group">
      <div className="draft-group-head"><strong>{title}</strong><span>{count}</span></div>
      <ul>{children}</ul>
    </div>
  );
}

function ReviewCard({
  review,
  carrySelection,
  carryDates,
  setCarrySelection,
  setCarryDates,
  today,
  onCarry,
  selectedCount,
}: {
  review: AIReview;
  carrySelection: Record<string, boolean>;
  carryDates: Record<string, string>;
  setCarrySelection: (next: Record<string, boolean>) => void;
  setCarryDates: (next: Record<string, string>) => void;
  today: string;
  onCarry: () => void;
  selectedCount: number;
}) {
  return (
    <section className="card ai-review-card">
      <header className="card-head">
        <div><p className="kicker">{t("Your reflection")}</p><h2 className="card-title">{t("A kind, honest look back")}</h2></div>
        <SparklesIcon size={20} />
      </header>
      <p className="ai-review-summary">{review.summary}</p>
      <div className="ai-review-columns">
        <div className="ai-review-block ai-wins"><h3><CheckIcon size={15} /> {t("What went well")}</h3>{review.wins.length ? <ul>{review.wins.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>{t("Showing up is worth noticing, even when the list was small.")}</p>}</div>
        <div className="ai-review-block ai-improve"><h3><CalendarIcon size={15} /> {t("One thing to adjust")}</h3>{review.improvements.length ? <ul>{review.improvements.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>{t("Try choosing one small priority and leaving a little more breathing room.")}</p>}</div>
      </div>
      <div className="ai-wellbeing"><LeafIcon size={17} /><div><strong>{t("Take care of yourself")}</strong><p>{review.wellness}</p><small>{t("General wellbeing only — not medical advice.")}</small></div></div>
      <div className="carry-forward">
        <div className="card-head"><div><p className="kicker">{t("A fresh place for it")}</p><h3>{t("Unfinished tasks")}</h3><p className="meta">{t("Choose what still matters and where to move it. Nothing is changed until you apply.")}</p></div></div>
        {review.carryForward.length === 0 ? <p className="empty-inline">{t("No unfinished dated tasks in this period to carry forward.")}</p> : (
          <>
            <ul className="carry-list">
              {review.carryForward.map((item) => (
                <li key={item.taskId}>
                  <label className="carry-check"><input type="checkbox" checked={carrySelection[item.taskId] ?? true} onChange={(event) => setCarrySelection({ ...carrySelection, [item.taskId]: event.target.checked })} /><span>{item.title}</span></label>
                  <small>{item.reason}</small>
                  <label className="carry-date"><span>{t("Move to")}</span><input type="date" min={addDays(today, 1)} value={carryDates[item.taskId] ?? item.date} onChange={(event) => setCarryDates({ ...carryDates, [item.taskId]: event.target.value })} /></label>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-soft btn-small" disabled={selectedCount === 0} onClick={onCarry}>{t("Move selected to future days")}</button>
          </>
        )}
      </div>
    </section>
  );
}


