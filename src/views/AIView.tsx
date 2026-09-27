import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { CATEGORIES, categoryById } from '../constants';
import { usePlanner } from '../context';
import { addDays, formatFullDate, timeToMinutes, todayISO, weekdayIndex, displayTime } from '../dates';
import { MAX_PLAN_IMAGE_BYTES, XAI_KEY_MISSING_MESSAGE, checkXAIConfiguration, friendlyXAIError, generateAIPlan, generateAIReview, hasReviewActivity } from '../ai';
import type { AIReview, AIDraft, PlanRange } from '../ai';
import { cx } from '../cx';
import { CalendarIcon, CheckIcon, LeafIcon, PlusIcon, SparklesIcon, UploadIcon } from '../icons';
import type { FixedCommitmentInput } from '../types';

const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

type PlanningPeriod = 'day' | 'week' | 'month' | 'custom';
type AISection = 'plan' | 'review';

function periodDays(period: PlanningPeriod, customDays: string): number {
  if (period === 'day') return 1;
  if (period === 'week') return 7;
  if (period === 'month') return 30;
  const value = Number(customDays);
  return Number.isFinite(value) ? Math.min(60, Math.max(2, Math.round(value))) : 14;
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

export function AIView() {
  const planner = usePlanner();
  const { state, route, navigate, openSettings, addFixedCommitment, updateFixedCommitment, deleteFixedCommitment, applyAIPlan, rescheduleTasks, flash } = planner;
  const today = todayISO();
  const currentTab: AISection = route.name === 'ai' ? route.tab ?? 'plan' : 'plan';
  const [xaiConfigured, setXaiConfigured] = useState<boolean | null>(null);
  const [period, setPeriod] = useState<PlanningPeriod>('day');
  const [customDays, setCustomDays] = useState('14');
  const [planStart, setPlanStart] = useState(today);
  const [reviewThrough, setReviewThrough] = useState(today);
  const [prompt, setPrompt] = useState('');
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [draft, setDraft] = useState<AIDraft | null>(null);
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

  const days = periodDays(period, customDays);
  const planRange = useMemo<PlanRange>(() => ({ startDate: planStart, days }), [planStart, days]);
  const reviewRange = useMemo<PlanRange>(() => ({ startDate: addDays(reviewThrough, -(days - 1)), days }), [reviewThrough, days]);
  const planEnd = addDays(planRange.startDate, planRange.days - 1);
  const reviewStart = reviewRange.startDate;
  const reviewEnd = addDays(reviewRange.startDate, reviewRange.days - 1);
  const sortedBlocks = [...state.fixedCommitments].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

  useEffect(() => {
    let active = true;
    void checkXAIConfiguration().then((configured) => {
      if (active) setXaiConfigured(configured);
    });
    return () => { active = false; };
  }, []);

  const goToTab = (tab: AISection) => navigate({ name: 'ai', tab });

  const generatePlan = async () => {
    setError('');
    setDraft(null);
    const configured = await checkXAIConfiguration();
    setXaiConfigured(configured);
    if (!configured) {
      setError(XAI_KEY_MISSING_MESSAGE);
      openSettings();
      return;
    }
    setWorking(true);
    try {
      const result = await generateAIPlan({
        prompt,
        range: planRange,
        state,
        imageDataUrl: image?.dataUrl,
      });
      setDraft(result);
    } catch (reason) {
      setError(friendlyXAIError(reason));
    } finally {
      setWorking(false);
    }
  };

  const generateReview = async () => {
    setError('');
    setReview(null);
    const configured = await checkXAIConfiguration();
    setXaiConfigured(configured);
    if (!configured) {
      setError(XAI_KEY_MISSING_MESSAGE);
      openSettings();
      return;
    }
    if (!hasReviewActivity(state, reviewRange)) {
      setError('There is not enough activity in this period to review yet. Add a task or habit check-in first.');
      return;
    }
    setWorking(true);
    try {
      const result = await generateAIReview({ state, range: reviewRange, today });
      setReview(result);
      setCarrySelection(Object.fromEntries(result.carryForward.map((item) => [item.taskId, true])));
      setCarryDates(Object.fromEntries(result.carryForward.map((item) => [item.taskId, item.date])));
    } catch (reason) {
      setError(friendlyXAIError(reason));
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
      setError('Use a PNG or JPG image.');
      return;
    }
    if (file.size > MAX_PLAN_IMAGE_BYTES) {
      setError('That image is over 3 MB. Choose a smaller or more compressed image for the AI to read.');
      return;
    }
    try {
      const dataUrl = await readFile(file);
      setImage({ name: file.name, dataUrl });
    } catch (reason) {
      setError(friendlyXAIError(reason));
    }
  };

  const addDraft = () => {
    if (!draft) return;
    const nowSafe = filterPlanAgainstCurrentState(draft, state);
    const taskCount = nowSafe.tasks.length;
    const eventCount = nowSafe.events.length;
    const habitCount = nowSafe.habits.length;
    if (taskCount + eventCount + habitCount === 0) {
      setDraft(nowSafe);
      setError('Nothing new can be added from this draft. It may already be in your planner or an event time may conflict with protected time.');
      return;
    }
    applyAIPlan({ tasks: nowSafe.tasks, events: nowSafe.events, habits: nowSafe.habits });
    setDraft(null);
    flash(`Added ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'}, ${eventCount} ${eventCount === 1 ? 'event' : 'events'} and ${habitCount} ${habitCount === 1 ? 'habit' : 'habits'}. Undo is available.`);
  };

  const saveBlock = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBlockError('');
    if (!blockTitle.trim()) {
      setBlockError('Give this recurring time a name.');
      return;
    }
    if (blockStart >= blockEnd) {
      setBlockError('The end time needs to be later than the start time.');
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
    flash(editingBlockId ? 'Weekly time updated.' : 'Weekly time protected.');
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
      if (blocked.length > 0) setError(`No tasks were moved. These timed items would overlap your schedule: ${blocked.join(', ')}.`);
      return;
    }
    rescheduleTasks(moves);
    setReview(null);
    flash(`Moved ${moves.length} unfinished ${moves.length === 1 ? 'task' : 'tasks'} to future days.`);
    if (blocked.length > 0) setError(`Kept ${blocked.length} timed ${blocked.length === 1 ? 'task' : 'tasks'} on their original dates because a protected or scheduled time would conflict.`);
  };

  return (
    <div className="view ai-view">
      <header className="page-head ai-page-head">
        <div>
          <p className="kicker">AI coach · powered by xAI Grok</p>
          <h1>Make a plan that fits.</h1>
          <p className="lede">Turn a brain dump or a picture into a kind, realistic schedule — then reflect on what worked.</p>
        </div>
        <div className="ai-head-actions">
          <span className={cx('chip', xaiConfigured ? 'ai-connected' : 'ai-disconnected')}>
            <span className="status-dot" />{xaiConfigured === null ? 'Checking xAI key…' : xaiConfigured ? 'xAI connected' : 'XAI_API_KEY needed'}
          </span>
          <button type="button" className="btn btn-soft btn-small" onClick={openSettings}>AI settings</button>
        </div>
      </header>

      <div className="ai-tabs segmented" role="tablist" aria-label="AI coach">
        <button type="button" role="tab" aria-selected={currentTab === 'plan'} className={cx('seg', currentTab === 'plan' && 'on')} onClick={() => goToTab('plan')}>
          <SparklesIcon size={15} /> Plan with AI
        </button>
        <button type="button" role="tab" aria-selected={currentTab === 'review'} className={cx('seg', currentTab === 'review' && 'on')} onClick={() => goToTab('review')}>
          <CheckIcon size={15} /> Review how I did
        </button>
      </div>

      <section className="ai-privacy card">
        <span className="ai-privacy-icon"><LeafIcon size={18} /></span>
        <p><strong>Your data, your choice.</strong> Your prompt and relevant schedule/check-in details go to xAI through the server proxy. The API key stays on the server, and planner notes are not included. AI suggestions never change your planner until you review and add them.</p>
      </section>

      {error ? <div className="banner ai-error" role="alert"><p>{error}</p></div> : null}

      {currentTab === 'plan' ? (
        <>
          <section className="card ai-builder">
            <header className="card-head">
              <div>
                <p className="kicker">Tell it what matters</p>
                <h2 className="card-title">What do you want to do?</h2>
              </div>
              <span className="chip">{planRange.days} {planRange.days === 1 ? 'day' : 'days'}</span>
            </header>
            <div className="ai-range-controls">
              <label className="field">
                <span>Plan horizon</span>
                <select value={period} onChange={(event) => setPeriod(event.target.value as PlanningPeriod)}>
                  <option value="day">Daily · 1 day</option>
                  <option value="week">Weekly · 7 days</option>
                  <option value="month">Monthly · 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              <label className="field">
                <span>Start date</span>
                <input type="date" min={today} value={planStart} onChange={(event) => setPlanStart(event.target.value || today)} />
              </label>
              {period === 'custom' ? (
                <label className="field ai-custom-days">
                  <span>Number of days</span>
                  <input type="number" min={2} max={60} value={customDays} onChange={(event) => setCustomDays(event.target.value)} />
                </label>
              ) : null}
            </div>
            <p className="ai-range-note">{formatFullDate(planRange.startDate)} — {formatFullDate(planEnd)}. Fixed weekly times and existing events are treated as busy, protected slots.</p>
            <label className="field ai-prompt-field">
              <span>Your plan request</span>
              <textarea
                rows={5}
                maxLength={2400}
                value={prompt}
                placeholder="Example: I have class Tuesday morning. Help me fit in studying, a short workout, meals, and time to unwind. Keep each day manageable."
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <div className="ai-upload-row">
              <label className="btn btn-soft btn-small ai-upload-button">
                <UploadIcon size={15} /> Add a plan picture
                <input type="file" accept="image/png,image/jpeg" onChange={onImage} />
              </label>
              <span className="hint">PNG or JPG · up to 3 MB. Images are sent to xAI for reading and are not saved in your planner.</span>
            </div>
            {image ? (
              <div className="ai-image-preview">
                <img src={image.dataUrl} alt="Preview of uploaded plan" />
                <div><strong>{image.name}</strong><span>Attached to this request only</span></div>
                <button type="button" className="text-btn" onClick={() => setImage(null)}>Remove</button>
              </div>
            ) : null}
            <div className="ai-builder-actions">
              <p className="meta">Health ideas stay gentle and optional. The AI is not a medical professional.</p>
              <button type="button" className="btn btn-primary" disabled={working || (!prompt.trim() && !image)} onClick={generatePlan}>
                <SparklesIcon size={16} />{working ? 'Building your plan…' : 'Build a draft'}
              </button>
            </div>
          </section>

          {draft ? <PlanDraft draft={draft} onAdd={addDraft} onDiscard={() => setDraft(null)} /> : null}

          <section className="card fixed-manager">
            <header className="card-head">
              <div>
                <p className="kicker">Protect your schedule</p>
                <h2 className="card-title">Weekly fixed times</h2>
                <p className="meta">Add class, work, care, or anything that always happens at the same time.</p>
              </div>
              <span className="fixed-protected-count">{state.fixedCommitments.length} protected</span>
            </header>
            <form className="fixed-form" onSubmit={saveBlock}>
              <label className="field">
                <span>Name</span>
                <input value={blockTitle} maxLength={140} placeholder="Class" onChange={(event) => setBlockTitle(event.target.value)} />
              </label>
              <label className="field">
                <span>Repeats</span>
                <select value={blockDay} onChange={(event) => setBlockDay(Number(event.target.value))}>
                  {WEEKDAYS.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Starts</span>
                <input type="time" value={blockStart} onChange={(event) => setBlockStart(event.target.value)} />
              </label>
              <label className="field">
                <span>Ends</span>
                <input type="time" value={blockEnd} onChange={(event) => setBlockEnd(event.target.value)} />
              </label>
              <label className="field">
                <span>Type</span>
                <select value={blockCategory} onChange={(event) => setBlockCategory(event.target.value)}>
                  {CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              <div className="fixed-form-actions">
                {editingBlockId ? <button type="button" className="btn btn-ghost btn-small" onClick={() => { setEditingBlockId(null); setBlockTitle(''); setBlockError(''); }}>Cancel</button> : null}
                <button type="submit" className="btn btn-soft btn-small"><PlusIcon size={15} />{editingBlockId ? 'Save change' : 'Protect time'}</button>
              </div>
              {blockError ? <small className="field-error fixed-form-error">{blockError}</small> : null}
            </form>
            {sortedBlocks.length === 0 ? (
              <p className="empty-inline fixed-empty">No recurring times yet. Add “Class · Tuesday · 08:00–09:00” to keep that hour clear in every AI plan.</p>
            ) : (
              <ul className="fixed-list">
                {sortedBlocks.map((block) => (
                  <li key={block.id} className="fixed-list-item">
                    <span className={cx('fixed-list-dot', `accent-${categoryById(block.category).accent}`)} />
                    <div className="fixed-list-copy">
                      <strong>{block.title}</strong>
                      <span>{WEEKDAYS.find((day) => day.value === block.weekday)?.label} · {displayTime(block.startTime)}–{displayTime(block.endTime)} · Protected every week</span>
                    </div>
                    <button type="button" className="text-btn" onClick={() => editBlock(block.id)}>Edit</button>
                    <button type="button" className="icon-btn" aria-label={`Remove ${block.title}`} onClick={() => { deleteFixedCommitment(block.id); if (editingBlockId === block.id) { setEditingBlockId(null); setBlockTitle(''); } }}>×</button>
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
              <p className="kicker">Look back without judgment</p>
              <h2 className="card-title">How did this stretch go?</h2>
              <p className="meta">Review plans, completions, and habit check-ins. Missed items are suggestions to reschedule, never failures.</p>
            </div>
            <div className="ai-review-form">
              <label className="field">
                <span>Review period</span>
                <select value={period} onChange={(event) => setPeriod(event.target.value as PlanningPeriod)}>
                  <option value="day">Daily · 1 day</option>
                  <option value="week">Weekly · 7 days</option>
                  <option value="month">Monthly · 30 days</option>
                  <option value="custom">Custom range</option>
                </select>
              </label>
              <label className="field">
                <span>Through</span>
                <input type="date" max={today} value={reviewThrough} onChange={(event) => setReviewThrough(event.target.value || today)} />
              </label>
              {period === 'custom' ? (
                <label className="field">
                  <span>Number of days</span>
                  <input type="number" min={2} max={60} value={customDays} onChange={(event) => setCustomDays(event.target.value)} />
                </label>
              ) : null}
              <button type="button" className="btn btn-primary" disabled={working} onClick={generateReview}>
                <SparklesIcon size={16} />{working ? 'Reflecting…' : 'Get my AI review'}
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
          <p className="kicker">A few good next steps</p>
          <h2 className="card-title">Small features that make this even smarter</h2>
          <ul>
            <li><strong>Protected weekly schedule:</strong> add classes, shifts, appointments, or family time once; AI will reserve those slots.</li>
            <li><strong>End-of-day check-in:</strong> a two-minute note about energy and mood can help future plans get more realistic.</li>
            <li><strong>Gentle capacity setting:</strong> choose a light, normal, or full day so the planner leaves enough room to rest.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}

function filterPlanAgainstCurrentState(draft: AIDraft, state: ReturnType<typeof usePlanner>['state']): AIDraft {
  const tasks = draft.tasks.filter((candidate) => !state.tasks.some((task) =>
    task.dueDate === candidate.dueDate && task.title.toLowerCase().trim() === candidate.title.toLowerCase().trim(),
  ));
  const events: AIDraft['events'] = [];
  const skippedEvents = [...draft.skippedEvents];
  for (const candidate of draft.events) {
    const candidateStart = Number(candidate.startTime.slice(0, 2)) * 60 + Number(candidate.startTime.slice(3, 5));
    const candidateEnd = candidate.endTime
      ? Number(candidate.endTime.slice(0, 2)) * 60 + Number(candidate.endTime.slice(3, 5))
      : candidateStart + 60;
    const existing = state.events.filter((event) => event.date === candidate.date).map((event) => ({ start: event.startTime, end: event.endTime ?? addMinutes(event.startTime, 60), title: event.title }));
    const fixed = state.fixedCommitments.filter((item) => item.weekday === weekdayIndex(candidate.date)).map((item) => ({ start: item.startTime, end: item.endTime, title: item.title }));
    const timedTasks = state.tasks.filter((task) => task.dueDate === candidate.date && task.dueTime).map((task) => ({ start: task.dueTime as string, end: addMinutes(task.dueTime as string, 30), title: task.title }));
    const accepted = events.filter((event) => event.date === candidate.date).map((event) => ({ start: event.startTime, end: event.endTime ?? addMinutes(event.startTime, 60), title: event.title }));
    const overlap = [...existing, ...fixed, ...timedTasks, ...accepted].find((item) => {
      const start = Number(item.start.slice(0, 2)) * 60 + Number(item.start.slice(3, 5));
      const end = Number(item.end.slice(0, 2)) * 60 + Number(item.end.slice(3, 5));
      return candidateStart < end && start < candidateEnd;
    });
    if (overlap) skippedEvents.push({ title: candidate.title, date: candidate.date, reason: `overlaps protected time: ${overlap.title}` });
    else events.push(candidate);
  }
  const habits = draft.habits.filter((candidate) => !state.habits.some((habit) => habit.name.toLowerCase().trim() === candidate.name.toLowerCase().trim()));
  return { ...draft, tasks, events, habits, skippedEvents };
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

function addMinutes(time: string, amount: number): string {
  const mins = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + amount;
  return `${String(Math.floor(Math.min(mins, 1439) / 60)).padStart(2, '0')}:${String(Math.min(mins, 1439) % 60).padStart(2, '0')}`;
}

function PlanDraft({ draft, onAdd, onDiscard }: { draft: AIDraft; onAdd: () => void; onDiscard: () => void }) {
  const total = draft.tasks.length + draft.events.length + draft.habits.length;
  return (
    <section className="card ai-draft-card">
      <header className="card-head">
        <div>
          <p className="kicker">Review before adding</p>
          <h2 className="card-title">Your AI draft</h2>
        </div>
        <span className="chip">{total} suggestions</span>
      </header>
      <p className="ai-draft-summary">{draft.summary}</p>
      {draft.suggestions.length > 0 ? (
        <div className="ai-wellbeing"><LeafIcon size={17} /><div><strong>Gentle wellbeing ideas</strong><ul>{draft.suggestions.map((item, index) => <li key={index}>{item}</li>)}</ul></div></div>
      ) : null}
      {draft.tasks.length + draft.events.length + draft.habits.length === 0 ? <p className="empty-inline">The AI did not find new items to add. Try a more specific request.</p> : null}
      {draft.events.length > 0 ? <DraftGroup title="Timed plans" count={draft.events.length}>
        {draft.events.map((item, index) => <li key={`e-${index}`}><span className="draft-kind event-kind">Event</span><span>{item.title}</span><small>{formatFullDate(item.date)} · {displayTime(item.startTime)}–{displayTime(item.endTime)}</small></li>)}
      </DraftGroup> : null}
      {draft.tasks.length > 0 ? <DraftGroup title="Tasks" count={draft.tasks.length}>
        {draft.tasks.map((item, index) => <li key={`t-${index}`}><span className="draft-kind task-kind">Task</span><span>{item.title}</span><small>{item.dueDate ? formatFullDate(item.dueDate) : ''}</small></li>)}
      </DraftGroup> : null}
      {draft.habits.length > 0 ? <DraftGroup title="Habits" count={draft.habits.length}>
        {draft.habits.map((item, index) => <li key={`h-${index}`}><span className="draft-kind habit-kind">Habit</span><span>{item.name}</span><small>{frequencyLabel(item.frequency)}</small></li>)}
      </DraftGroup> : null}
      {draft.skippedEvents.length > 0 ? (
        <div className="ai-skipped">
          <strong>Protected times kept clear</strong>
          <p>These timed suggestions were skipped because they overlapped with an existing commitment:</p>
          <ul>{draft.skippedEvents.map((item, index) => <li key={`${item.title}-${index}`}>{item.title} · {formatFullDate(item.date)} — {item.reason}</li>)}</ul>
        </div>
      ) : null}
      <div className="form-actions ai-draft-actions">
        <button type="button" className="btn btn-ghost" onClick={onDiscard}>Discard draft</button>
        <button type="button" className="btn btn-primary" disabled={total === 0} onClick={onAdd}><CheckIcon size={16} /> Add this plan</button>
      </div>
      <p className="meta ai-undo-note">Adding a draft is one undoable change. Review the dates before you add it.</p>
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
        <div><p className="kicker">Your reflection</p><h2 className="card-title">A kind, honest look back</h2></div>
        <SparklesIcon size={20} />
      </header>
      <p className="ai-review-summary">{review.summary}</p>
      <div className="ai-review-columns">
        <div className="ai-review-block ai-wins"><h3><CheckIcon size={15} /> What went well</h3>{review.wins.length ? <ul>{review.wins.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Showing up is worth noticing, even when the list was small.</p>}</div>
        <div className="ai-review-block ai-improve"><h3><CalendarIcon size={15} /> One thing to adjust</h3>{review.improvements.length ? <ul>{review.improvements.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p>Try choosing one small priority and leaving a little more breathing room.</p>}</div>
      </div>
      <div className="ai-wellbeing"><LeafIcon size={17} /><div><strong>Take care of yourself</strong><p>{review.wellness}</p><small>General wellbeing only — not medical advice.</small></div></div>
      <div className="carry-forward">
        <div className="card-head"><div><p className="kicker">A fresh place for it</p><h3>Unfinished tasks</h3><p className="meta">Choose what still matters and where to move it. Nothing is changed until you apply.</p></div></div>
        {review.carryForward.length === 0 ? <p className="empty-inline">No unfinished dated tasks in this period to carry forward.</p> : (
          <>
            <ul className="carry-list">
              {review.carryForward.map((item) => (
                <li key={item.taskId}>
                  <label className="carry-check"><input type="checkbox" checked={carrySelection[item.taskId] ?? true} onChange={(event) => setCarrySelection({ ...carrySelection, [item.taskId]: event.target.checked })} /><span>{item.title}</span></label>
                  <small>{item.reason}</small>
                  <label className="carry-date"><span>Move to</span><input type="date" min={addDays(today, 1)} value={carryDates[item.taskId] ?? item.date} onChange={(event) => setCarryDates({ ...carryDates, [item.taskId]: event.target.value })} /></label>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-soft btn-small" disabled={selectedCount === 0} onClick={onCarry}>Move selected to future days</button>
          </>
        )}
      </div>
    </section>
  );
}

function frequencyLabel(frequency: AIDraft['habits'][number]['frequency']): string {
  if (frequency.type === 'daily') return 'Every day';
  if (frequency.type === 'weekdays') return 'Weekdays';
  if (frequency.type === 'weekly') return `${frequency.times}× a week`;
  const labels = WEEKDAYS.filter((day) => frequency.days.includes(day.value)).map((day) => day.label.slice(0, 3));
  return labels.length ? labels.join(', ') : 'Custom schedule';
}
