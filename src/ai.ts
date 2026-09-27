import { getLang, t } from './i18n';
import { CATEGORIES, HABIT_ICONS, PRIORITIES, categoryById } from './constants';
import type { Priority } from './constants';
import { addDays, isValidISODate, isValidTime, timeToMinutes, weekdayIndex } from './dates';
import { isDone, isPlannedDay } from './logic';
import type {
  EventInput,
  FixedCommitment,
  HabitFrequency,
  HabitInput,
  PlannerState,
  TaskInput,
} from './types';

export const XAI_CHAT_URL = '/api/xai/chat/completions';
export const XAI_STATUS_URL = '/api/xai/status';
export const XAI_TEXT_MODEL = 'grok-4.7';
export const XAI_VISION_MODEL = 'grok-4.7';
/**
 * Vercel Functions accept request bodies up to 4.5 MB. Base64 grows an image by ~33%,
 * so a 3 MB image (~4.2 MB encoded) plus the prompt still fits in one request.
 */
export const MAX_PLAN_IMAGE_BYTES = 3 * 1024 * 1024;
export const XAI_KEY_MISSING_MESSAGE = 'XAI_API_KEY is not configured on the server. On Vercel, add it under Project Settings → Environment Variables and redeploy. Locally, add it to .env.local and restart the dev server.';

export interface PlanRange {
  startDate: string;
  days: number;
}

export interface SkippedAIEvent {
  title: string;
  date: string;
  reason: string;
}

export interface AIDraft {
  summary: string;
  tasks: TaskInput[];
  events: EventInput[];
  habits: HabitInput[];
  suggestions: string[];
  skippedEvents: SkippedAIEvent[];
}

export interface CarryForwardSuggestion {
  taskId: string;
  title: string;
  fromDate: string;
  date: string;
  reason: string;
}

export interface AIReview {
  summary: string;
  wins: string[];
  improvements: string[];
  wellness: string;
  carryForward: CarryForwardSuggestion[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function cleanText(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function stringList(value: unknown, limit = 5): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const text = cleanText(item, 240);
    return text ? [text] : [];
  }).slice(0, limit);
}

function withinRange(date: unknown, range: PlanRange): date is string {
  if (typeof date !== 'string' || !isValidISODate(date)) return false;
  const last = addDays(range.startDate, range.days - 1);
  return date >= range.startDate && date <= last;
}

function category(value: unknown): string {
  const selected = cleanText(value, 40).toLowerCase();
  return CATEGORIES.some((item) => item.id === selected) ? selected : 'personal';
}

function dueDate(value: unknown, range: PlanRange): string | null {
  if (withinRange(value, range)) return value;
  return null;
}

function eventEnd(startTime: string, endTime: string | null): number {
  const start = timeToMinutes(startTime);
  if (endTime && isValidTime(endTime) && timeToMinutes(endTime) > start) return timeToMinutes(endTime);
  return Math.min(24 * 60, start + 60);
}

function timeOverlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function fixedSlots(state: PlannerState, date: string): FixedCommitment[] {
  const weekday = weekdayIndex(date);
  return state.fixedCommitments.filter((commitment) => commitment.weekday === weekday);
}

function eventConflicts(
  event: Pick<EventInput, 'date' | 'startTime' | 'endTime'>,
  state: PlannerState,
  accepted: EventInput[],
): string | null {
  const proposedStart = timeToMinutes(event.startTime);
  const proposedEnd = eventEnd(event.startTime, event.endTime);
  const fixed = fixedSlots(state, event.date);
  for (const commitment of fixed) {
    if (timeOverlaps(proposedStart, proposedEnd, timeToMinutes(commitment.startTime), timeToMinutes(commitment.endTime))) {
      return t("overlaps protected time: {0}", { 0: commitment.title });
    }
  }
  const existing = state.events.filter((item) => item.date === event.date);
  for (const item of existing) {
    if (timeOverlaps(proposedStart, proposedEnd, timeToMinutes(item.startTime), eventEnd(item.startTime, item.endTime))) {
      return t("overlaps your existing event: {0}", { 0: item.title });
    }
  }
  const timedTasks = state.tasks.filter((task) => task.dueDate === event.date && task.dueTime);
  for (const task of timedTasks) {
    const start = timeToMinutes(task.dueTime as string);
    if (timeOverlaps(proposedStart, proposedEnd, start, Math.min(24 * 60, start + 30))) {
      return t("overlaps your timed task: {0}", { 0: task.title });
    }
  }
  for (const item of accepted) {
    if (item.date !== event.date) continue;
    if (timeOverlaps(proposedStart, proposedEnd, timeToMinutes(item.startTime), eventEnd(item.startTime, item.endTime))) {
      return t("overlaps another suggested plan: {0}", { 0: item.title });
    }
  }
  return null;
}

function parseFrequency(value: unknown): HabitFrequency {
  const raw = asRecord(value);
  const type = typeof value === 'string' ? value : cleanText(raw?.type, 20);
  if (type === 'weekdays') return { type: 'weekdays' };
  if (type === 'weekly') {
    const times = typeof raw?.times === 'number' && Number.isFinite(raw.times) ? Math.round(raw.times) : 3;
    return { type: 'weekly', times: Math.max(1, Math.min(7, times)) };
  }
  if (type === 'custom') {
    const days = Array.isArray(raw?.days)
      ? [...new Set(raw.days.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
    if (days.length > 0) return { type: 'custom', days };
  }
  return { type: 'daily' };
}

function normalizePlan(rawValue: unknown, state: PlannerState, range: PlanRange): AIDraft {
  const raw = asRecord(rawValue);
  if (!raw) throw new Error(t(t("xAI returned a plan in an unexpected format. Try again.")));
  const tasks: TaskInput[] = [];
  const existingTaskKeys = new Set(
    state.tasks.map((task) => `${task.dueDate ?? ''}|${task.title.toLowerCase().trim()}`),
  );
  const incomingTaskKeys = new Set<string>();
  if (Array.isArray(raw.tasks)) {
    for (const value of raw.tasks.slice(0, 40)) {
      const item = asRecord(value);
      if (!item) continue;
      const title = cleanText(item.title, 140);
      const date = dueDate(item.date, range);
      if (!title || !date) continue;
      const key = `${date}|${title.toLowerCase()}`;
      if (existingTaskKeys.has(key) || incomingTaskKeys.has(key)) continue;
      incomingTaskKeys.add(key);
      const priorityText = cleanText(item.priority, 12).toLowerCase();
      const priority = PRIORITIES.some((option) => option.id === priorityText) ? (priorityText as Priority) : 'medium';
      tasks.push({
        title,
        priority,
        dueDate: date,
        dueTime: null,
        category: category(item.category),
        note: cleanText(item.note, 1000),
        goalId: null,
      });
    }
  }

  const events: EventInput[] = [];
  const skippedEvents: SkippedAIEvent[] = [];
  const existingEventKeys = new Set(state.events.map((event) => `${event.date}|${event.startTime}|${event.title.toLowerCase()}`));
  if (Array.isArray(raw.events)) {
    for (const value of raw.events.slice(0, 40)) {
      const item = asRecord(value);
      if (!item) continue;
      const title = cleanText(item.title, 140);
      const date = dueDate(item.date, range);
      const startTime = cleanText(item.startTime, 5);
      const endTime = cleanText(item.endTime, 5);
      if (!title || !date || !isValidTime(startTime) || !isValidTime(endTime) || timeToMinutes(endTime) <= timeToMinutes(startTime)) continue;
      const key = `${date}|${startTime}|${title.toLowerCase()}`;
      if (existingEventKeys.has(key)) continue;
      const input: EventInput = {
        title,
        date,
        startTime,
        endTime,
        category: category(item.category),
        note: cleanText(item.note, 1000),
        important: item.important === true,
      };
      const conflict = eventConflicts(input, state, events);
      if (conflict) {
        skippedEvents.push({ title, date, reason: conflict });
        continue;
      }
      events.push(input);
      existingEventKeys.add(key);
    }
  }

  const existingHabitNames = new Set(state.habits.filter((habit) => !habit.archived).map((habit) => habit.name.toLowerCase().trim()));
  const habits: HabitInput[] = [];
  if (Array.isArray(raw.habits)) {
    for (const value of raw.habits.slice(0, 12)) {
      const item = asRecord(value);
      if (!item) continue;
      const name = cleanText(item.name, 60);
      if (!name || existingHabitNames.has(name.toLowerCase())) continue;
      existingHabitNames.add(name.toLowerCase());
      const freq = parseFrequency(item.frequency);
      const iconName = cleanText(item.icon, 20).toLowerCase();
      const icon = HABIT_ICONS.some((entry) => entry.id === iconName) ? iconName : 'leaf';
      const habitCategory = category(item.category || 'health');
      habits.push({
        name,
        icon,
        accent: categoryById(habitCategory).accent,
        frequency: freq,
      });
    }
  }

  return {
    summary: cleanText(raw.summary, 400) || t(t("A first draft for the days ahead.")),
    tasks,
    events,
    habits,
    suggestions: stringList(raw.wellbeing ?? raw.suggestions, 5),
    skippedEvents,
  };
}

function extractContent(payload: unknown): string {
  const root = asRecord(payload);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const content = message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.flatMap((part) => {
      const text = asRecord(part)?.text;
      return typeof text === 'string' ? [text] : [];
    }).join('\n');
  }
  throw new Error(t(t("xAI did not return a response. Check the server configuration and try again.")));
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    throw new Error(t(t("The AI response was not valid JSON. Please try again.")));
  }
}

async function xaiJson(system: string, user: string, imageDataUrl?: string): Promise<unknown> {
  const content = imageDataUrl
    ? [
        { type: 'text', text: user },
        { type: 'image_url', image_url: { url: imageDataUrl, detail: 'high' } },
      ]
    : user;
  let response: Response;
  try {
    response = await fetch(XAI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: imageDataUrl ? XAI_VISION_MODEL : XAI_TEXT_MODEL,
        temperature: 0.35,
        max_tokens: 3500,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: getLang() === 'fa' ? `${system}\n\nWrite every human-readable text value (summary, titles, notes, names, wins, improvements, wellness, reasons) in Persian (Farsi). Keep JSON keys, enum values, dates and times in English/ASCII exactly as specified.` : system },
          { role: 'user', content },
        ],
      }),
    });
  } catch {
    throw new Error(t(t("Could not reach the xAI proxy. Check the server and try again.")));
  }
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = cleanText(asRecord(asRecord(payload)?.error)?.message, 240);
    if (response.status === 401) throw new Error(t(t("xAI rejected XAI_API_KEY. Check the server environment variable.")));
    if (response.status === 403) throw new Error(message || t(t("xAI rejected XAI_API_KEY. Check the server environment variable.")));
    if (response.status === 503) throw new Error(message || XAI_KEY_MISSING_MESSAGE);
    if (response.status === 413) throw new Error(message || t(t("The image or plan is too large for one request. Use a smaller image (up to 3 MB).")));
    if (response.status === 404) throw new Error(t(t("The xAI proxy was not found on this deployment. Redeploy with the api/ functions included.")));
    if (response.status === 504) throw new Error(message || t(t("The xAI request timed out. Please try again.")));
    throw new Error(message || t("xAI request failed ({0}). Please try again.", { 0: response.status }));
  }
  return parseJson(extractContent(payload));
}

export async function checkXAIConfiguration(): Promise<boolean> {
  try {
    const response = await fetch(XAI_STATUS_URL, { headers: { Accept: 'application/json' } });
    if (!response.ok) return false;
    const payload = asRecord(await response.json());
    return payload?.configured === true;
  } catch {
    return false;
  }
}

export async function generateAIPlan(options: {
  prompt: string;
  range: PlanRange;
  state: PlannerState;
  imageDataUrl?: string;
}): Promise<AIDraft> {
  const { prompt, range, state, imageDataUrl } = options;
  if (!isValidISODate(range.startDate) || range.days < 1 || range.days > 60) throw new Error(t(t("Choose a valid planning date range.")));
  if (!prompt.trim() && !imageDataUrl) throw new Error(t(t("Tell the AI what you want to do, or upload a plan image.")));
  const lastDate = addDays(range.startDate, range.days - 1);
  const currentPlans = {
    fixedWeeklyTimes: state.fixedCommitments.map((item) => ({
      weekday: item.weekday,
      title: item.title,
      startTime: item.startTime,
      endTime: item.endTime,
    })),
    existingEvents: state.events
      .filter((item) => item.date >= range.startDate && item.date <= lastDate)
      .map(({ title, date, startTime, endTime, category: itemCategory }) => ({ title, date, startTime, endTime, category: itemCategory })),
    timedTasks: state.tasks
      .filter((item) => item.dueDate && item.dueDate >= range.startDate && item.dueDate <= lastDate && item.dueTime)
      .map(({ title, dueDate: date, dueTime }) => ({ title, date, time: dueTime })),
    existingTasks: state.tasks
      .filter((item) => item.dueDate && item.dueDate >= range.startDate && item.dueDate <= lastDate)
      .map(({ title, dueDate: date, completed }) => ({ title, date, completed })),
    habits: state.habits.filter((item) => !item.archived).map(({ name, frequency }) => ({ name, frequency })),
    goals: state.goals.map(({ title, deadline }) => ({ title, deadline })),
  };
  const system = `You are a supportive, practical planning assistant inside a personal planner. Create a realistic plan, not a packed schedule. The local date range is ${range.startDate} through ${lastDate}, inclusive. Use ISO dates (YYYY-MM-DD) and 24-hour times. Preserve every existing item. Fixed weekly commitments and existing events are busy, protected time: NEVER create an event that overlaps them. Leave buffers and open time. Do not schedule before 07:00 or after 21:30 unless the user explicitly asks. Keep health suggestions gentle and optional: suggest ordinary basics such as movement, water, meals, daylight, breaks, and sleep routines only when appropriate. Do not diagnose, prescribe, or give medical advice; respect restrictions mentioned by the user and do not assume the user's age or health status. Return ONLY a JSON object with this shape: {"summary":"short supportive overview","tasks":[{"title":"...","date":"YYYY-MM-DD","priority":"low|medium|high","category":"personal|work|health|learning|home|social","note":"optional"}],"events":[{"title":"...","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","category":"personal|work|health|learning|home|social","important":false,"note":"optional"}],"habits":[{"name":"...","frequency":{"type":"daily|weekdays|custom|weekly","days":[1,2],"times":3},"category":"health|personal|learning|home","icon":"water|book|study|moon|sun|walk|heart|leaf|coffee|pencil|home|stretch|spark"}],"wellbeing":["up to three gentle, specific health or balance ideas"]}. Tasks must have a date inside the range. Use events only when a time is useful. Habits should be repeatable and few; do not add a habit that already exists. Avoid duplicating the user's current tasks and events. If the user uploaded a handwritten or printed plan, transcribe what is clear, preserve dates/times, and put unclear details in the summary rather than guessing.`;
  const user = `Planning request: ${prompt.trim() || 'Read the uploaded image and turn the plan into planner tasks, timed events, and a few repeatable habits where appropriate.'}\n\nCurrent schedule and constraints (do not add over existing times):\n${JSON.stringify(currentPlans)}`;
  const raw = await xaiJson(system, user, imageDataUrl);
  return normalizePlan(raw, state, range);
}

function reviewCarryForward(raw: unknown, candidates: PlannerState['tasks'], today: string): CarryForwardSuggestion[] {
  const candidateById = new Map(candidates.map((task) => [task.id, task]));
  const suggested = new Map<string, { date: string; reason: string }>();
  const list = Array.isArray(raw) ? raw : [];
  for (const value of list) {
    const item = asRecord(value);
    const taskId = cleanText(item?.taskId, 80);
    const date = cleanText(item?.date, 10);
    if (!candidateById.has(taskId) || !isValidISODate(date) || date <= today || date > addDays(today, 30) || suggested.has(taskId)) continue;
    suggested.set(taskId, { date, reason: cleanText(item?.reason, 200) || t(t("A little more room to finish this.")) });
  }
  const defaultDate = addDays(today, 1);
  return candidates.map((task) => {
    const choice = suggested.get(task.id);
    return {
      taskId: task.id,
      title: task.title,
      fromDate: task.dueDate ?? today,
      date: choice?.date ?? defaultDate,
      reason: choice?.reason ?? t(t("Move it forward only if it still matters to you.")),
    };
  });
}

export async function generateAIReview(options: {
  state: PlannerState;
  range: PlanRange;
  today: string;
}): Promise<AIReview> {
  const { state, range, today } = options;
  if (!isValidISODate(range.startDate) || range.days < 1 || range.days > 60) throw new Error(t(t("Choose a valid review date range.")));
  const lastDate = addDays(range.startDate, range.days - 1);
  const dates = Array.from({ length: range.days }, (_, index) => addDays(range.startDate, index));
  const tasks = state.tasks
    .filter((task) => task.dueDate && task.dueDate >= range.startDate && task.dueDate <= lastDate)
    .map((task) => ({ id: task.id, title: task.title, date: task.dueDate, completed: task.completed, priority: task.priority, category: task.category }));
  const events = state.events
    .filter((event) => event.date >= range.startDate && event.date <= lastDate)
    .map((event) => ({ title: event.title, date: event.date, completed: event.completed, category: event.category }));
  const activeHabits = state.habits.filter((habit) => !habit.archived);
  const habits = activeHabits.map((habit) => {
    const plannedDates = dates.filter((date) => date <= lastDate && date >= habit.createdOn && isPlannedDay(habit, date));
    const doneCount = dates.filter((date) => isDone(state, habit.id, date)).length;
    const expectedCount = habit.frequency.type === 'weekly'
      ? Math.max(doneCount, dates.length < 7 ? 0 : Math.ceil(dates.length / 7) * habit.frequency.times)
      : plannedDates.length;
    return { name: habit.name, frequency: habit.frequency, done: doneCount, expected: expectedCount };
  });
  const openTasks = state.tasks.filter(
    (task) => !task.completed && task.dueDate !== null && task.dueDate >= range.startDate && task.dueDate <= lastDate,
  );
  const payload = {
    period: { startDate: range.startDate, endDate: lastDate },
    tasks,
    events,
    habits,
    totals: {
      tasksDone: tasks.filter((task) => task.completed).length,
      tasksTotal: tasks.length,
      eventsDone: events.filter((event) => event.completed).length,
      eventsTotal: events.length,
      habitsDone: habits.reduce((sum, habit) => sum + Math.min(habit.done, habit.expected), 0),
      habitCheckInsExpected: habits.reduce((sum, habit) => sum + habit.expected, 0),
    },
    unfinishedTasksToConsiderForCarryForward: openTasks.map((task) => ({ id: task.id, title: task.title, date: task.dueDate })),
  };
  const system = `You are a kind, honest planning coach. Review the planner data for ${range.startDate} through ${lastDate}. Be specific, balanced, and non-judgmental; never shame the user or equate productivity with self-worth. Point out concrete wins and one or two realistic improvements. Always include one gentle, broadly safe wellbeing idea without diagnosing or prescribing. Return ONLY JSON: {"summary":"2-4 sentences","wins":["..."],"improvements":["..."],"wellness":"one optional, gentle wellbeing idea","carryForward":[{"taskId":"an exact supplied task id","date":"YYYY-MM-DD after ${today} and within the next 30 days","reason":"short reason"}]}. Carry forward each unfinished task only if it still appears useful, use only supplied IDs, and choose practical future dates that leave space. Never invent, delete, or mark tasks complete. This is reflective coaching, not medical advice.`;
  const raw = asRecord(await xaiJson(system, `Here is the user's logged activity. Do not treat empty days as failures.\n${JSON.stringify(payload)}`));
  if (!raw) throw new Error(t(t("xAI returned a review in an unexpected format. Try again.")));
  return {
    summary: cleanText(raw.summary, 700) || t(t("You showed up for some of the things that mattered. Let’s make the next plan a little easier to keep.")),
    wins: stringList(raw.wins, 5),
    improvements: stringList(raw.improvements, 5),
    wellness: cleanText(raw.wellness, 300) || t(t("Leave a little room for rest and a short stretch or walk if that feels good.")),
    carryForward: reviewCarryForward(raw.carryForward, openTasks, today),
  };
}

export function hasReviewActivity(state: PlannerState, range: PlanRange): boolean {
  const lastDate = addDays(range.startDate, range.days - 1);
  return state.tasks.some((task) => task.dueDate !== null && task.dueDate >= range.startDate && task.dueDate <= lastDate) ||
    state.events.some((event) => event.date >= range.startDate && event.date <= lastDate) ||
    state.habits.some((habit) => !habit.archived && habit.createdOn <= lastDate);
}

export function friendlyXAIError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return t(t("The AI could not complete that request. Please try again."));
}
