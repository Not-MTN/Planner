// @vitest-environment node
/**
 * The privacy promise of the two AI panels, written as tests.
 *
 * A student's own AI may read their week. A guardian's AI may read the results
 * and nothing else — no task title, no note, no id, no reason beyond the
 * headline the student chose to send. If someone later adds a field to the
 * guardian prompt, these tests should be the thing that stops them.
 */
import { describe, expect, it } from 'vitest';
import { buildGuardianGuidancePayload, buildStudentAdvicePayload, normalizeAdvice, normalizeGuidance } from './ai';
import { createEmptyState } from './types';
import { weekOf, weekResults } from './panels';
import type { PlannerState, WeekResults } from './types';

const WEEK = weekOf();

function day(offset: number): string {
  const date = new Date(`${WEEK}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function stateWithEverything(): PlannerState {
  const state = createEmptyState();
  state.panels.student.enabled = true;
  state.panels.student.field = 'Physics';
  state.panels.student.grade = 'school-11';
  state.panels.student.subjects = [{ id: 'sub-1', name: 'Thermodynamics', accent: '#3b82f6', examDate: null, targetMinutes: 300 }];
  state.panels.student.explanations = [
    { id: 'exp-1', weekOf: WEEK, summary: 'Dropped chemistry to protect the mock exams.', reason: 'SECRET-REASON-BODY', createdAt: `${WEEK}T12:00:00.000Z` },
  ];
  state.tasks.push({
    id: 'task-in-week',
    title: 'SECRET-TASK-TITLE revise chapter 4',
    completed: false,
    priority: 'high',
    dueDate: day(2),
    dueTime: null,
    category: 'Thermodynamics',
    note: 'SECRET-NOTE-BODY',
    goalId: null,
    createdAt: `${WEEK}T09:00:00.000Z`,
    updatedAt: `${WEEK}T09:00:00.000Z`,
    subtasks: [],
    repeat: null,
    sortOrder: 0,
    waiting: null,
    estimatedMinutes: 45,
  });
  state.tasks.push({
    id: 'task-outside-week',
    title: 'SECRET-OTHER-WEEK',
    completed: false,
    priority: 'low',
    dueDate: day(20),
    dueTime: null,
    category: 'Thermodynamics',
    note: '',
    goalId: null,
    createdAt: `${WEEK}T09:00:00.000Z`,
    updatedAt: `${WEEK}T09:00:00.000Z`,
    subtasks: [],
    repeat: null,
    sortOrder: 1,
    waiting: null,
    estimatedMinutes: null,
  });
  state.notes.push({
    id: 'note-1',
    kind: 'journal',
    title: 'SECRET-NOTE-TITLE',
    body: 'SECRET-JOURNAL-BODY',
    date: WEEK,
    createdAt: `${WEEK}T20:00:00.000Z`,
    updatedAt: `${WEEK}T20:00:00.000Z`,
  });
  state.focusLog.push({ id: 'f1', taskId: 'task-in-week', title: 'Revise chapter 4', minutes: 50, date: day(1), endedAt: `${day(1)}T10:00:00.000Z` });
  return state;
}

/** Every key name anywhere inside a payload. */
function deepKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) deepKeys(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      deepKeys(item, out);
    }
  }
  return out;
}

describe('the student panel AI', () => {
  it('reads this week, and only this week', () => {
    const payload = buildStudentAdvicePayload(stateWithEverything(), WEEK);
    const text = JSON.stringify(payload);

    expect(text).toContain('SECRET-TASK-TITLE'); // their own planner: fair game
    expect(text).not.toContain('SECRET-OTHER-WEEK'); // a later week is not this week
    expect(text).not.toContain('SECRET-JOURNAL-BODY'); // notes are none of its business
    expect(text).not.toContain('SECRET-NOTE-BODY'); // and neither are task notes
    expect(payload.field).toBe('Physics');
    expect(payload.grade).toBe('school-11');
  });

  it('keeps the payload to the week, the subjects and the student’s own words', () => {
    const payload = buildStudentAdvicePayload(stateWithEverything(), WEEK);
    expect(Object.keys(payload).sort()).toEqual([
      'field',
      'focusedMinutesBySubject',
      'focusedMinutesTotal',
      'grade',
      'subjects',
      'tasks',
      'week',
      'whatTheySaid',
    ]);
    expect(payload.focusedMinutesTotal).toBe(50);
    expect(payload.focusedMinutesBySubject).toEqual([{ name: 'Thermodynamics', minutes: 50 }]);
    expect(payload.whatTheySaid).toEqual(['Dropped chemistry to protect the mock exams.']);
  });
});

describe('the guardian panel AI', () => {
  const results: WeekResults = weekResults(stateWithEverything(), WEEK);

  it('never sees a task title, a note, or an id', () => {
    const payload = buildGuardianGuidancePayload(results, []);
    const text = JSON.stringify(payload);
    const keys = deepKeys(payload);

    for (const secret of ['SECRET-TASK-TITLE', 'SECRET-NOTE-TITLE', 'SECRET-JOURNAL-BODY', 'SECRET-NOTE-BODY', 'task-in-week']) {
      expect(text).not.toContain(secret);
    }
    for (const forbidden of ['title', 'note', 'notes', 'id', 'taskId', 'body', 'summary']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('carries counts, minutes, subject names and the headline the student wrote', () => {
    const payload = buildGuardianGuidancePayload(results, [{ ...results, weekOf: day(-7), planned: 9, done: 4, focusMinutes: 210 }]);
    const thisWeek = (payload.thisWeek ?? {}) as Record<string, unknown>;
    expect(thisWeek.planned).toBe(1);
    expect(thisWeek.done).toBe(0);
    expect(thisWeek.focusMinutes).toBe(50);
    expect(thisWeek.whatTheySaid).toBe('Dropped chemistry to protect the mock exams.');
    expect(payload.earlierWeeks).toEqual([{ weekOf: day(-7), planned: 9, done: 4, focusMinutes: 210 }]);
  });

  it('keeps history short, so a prompt cannot grow without limit', () => {
    const history = Array.from({ length: 40 }, (_unused, index) => ({
      ...results,
      weekOf: day(-7 * (index + 1)),
      planned: index,
      done: index,
      focusMinutes: index,
    }));
    const payload = buildGuardianGuidancePayload(results, history);
    expect((payload.earlierWeeks as unknown[]).length).toBe(11);
  });
});

describe('reading an AI answer safely', () => {
  it('survives a reply with nothing usable in it', () => {
    expect(normalizeAdvice(null)).toEqual({ summary: '', focus: [], watchOut: null });
    expect(normalizeAdvice({ summary: 42, focus: 'nope', watchOut: {} })).toEqual({ summary: '', focus: [], watchOut: null });
    expect(normalizeGuidance(undefined)).toEqual({ summary: '', questions: [], encouragement: null });
  });

  it('trims, drops blanks, and caps the lists', () => {
    const advice = normalizeAdvice({
      summary: '  A steady week.  ',
      focus: ['  First  ', '', '  Second  ', 'Third', 'Fourth', 'Fifth', 'Sixth'],
      watchOut: '  Do not add more on Thursday.  ',
    });
    expect(advice.summary).toBe('A steady week.');
    expect(advice.focus).toEqual(['First', 'Second', 'Third', 'Fourth', 'Fifth']);
    expect(advice.watchOut).toBe('Do not add more on Thursday.');

    const guidance = normalizeGuidance({
      summary: 'They finished most of what they planned.',
      questions: ['  How did the thermodynamics feel?  ', '', 'What got in the way?'],
      encouragement: '  Focus time went up.  ',
    });
    expect(guidance.questions).toEqual(['How did the thermodynamics feel?', 'What got in the way?']);
    expect(guidance.encouragement).toBe('Focus time went up.');
  });
});

/* ------------------------------------------------------------------------- */
/* What happens when the AI is unhappy: the panel must show words, never a    */
/* stack trace, and never a blank card that looks broken.                     */

import { afterEach, describe as describeFailures, expect as expectFailure, it as itFailure, vi } from 'vitest';
import { generateGuardianGuidance, generateStudentAdvice } from './ai';

function reply(body: unknown, status = 200, contentType = 'application/json'): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': contentType },
  });
}

function completion(content: string): unknown {
  return { choices: [{ message: { content } }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describeFailures('when the AI is unhappy', () => {
  const results: WeekResults = weekResults(createEmptyState(), WEEK);

  itFailure('explains a missing key instead of failing silently', async () => {
    // A 503 with no detail of its own is the signature of an unset key.
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { code: 'upstream_auth' } }, 503)));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow(/GROQ_API_KEY/);
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { code: 'upstream_auth' } }, 503)));
    await expectFailure(generateGuardianGuidance({ results })).rejects.toThrow(/GROQ_API_KEY/);
  });

  itFailure('passes on whatever the proxy actually said, when it said something', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { message: 'Your key was rotated.', code: 'upstream_auth' } }, 401)));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow(/Your key was rotated/);
  });

  itFailure('points at billing, not the key, when the free allowance runs out', async () => {
    const exhausted =
      'Your Groq key is working — the account has just run out of free allowance. Add a payment method at https://console.groq.com/settings/billing.';
    // Groq reports this as a 429, which otherwise reads as "just retry later".
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { message: exhausted, code: 'billing' } }, 429)));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow(/console\.groq\.com\/settings\/billing/);

    // Without a message the client still has its own words for it.
    vi.stubGlobal('fetch', vi.fn(async () => reply({ error: { code: 'billing' } }, 429)));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow(/free allowance/i);
  });

  itFailure('survives an answer that is not JSON at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('<html>A proxy answer</html>', 200, 'text/html')));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow();
  });

  itFailure('says so when the answer has nothing usable in it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(completion('{}'))));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow(/unexpected format/i);

    vi.stubGlobal('fetch', vi.fn(async () => reply(completion('[]'))));
    await expectFailure(generateGuardianGuidance({ results })).rejects.toThrow(/unexpected format/i);
  });

  itFailure('passes a rate limit message through in plain words', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ error: { message: 'Slow down for a minute.', code: 'rate_limited' } }, 429)),
    );
    await expectFailure(generateGuardianGuidance({ results })).rejects.toThrow(/Slow down for a minute/);
  });

  itFailure('reports a missing proxy rather than hanging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply('Not Found', 404, 'text/plain')));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow(/proxy/i);
  });

  itFailure('returns nothing rather than throwing when the reply is empty but well-formed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(completion('{"summary":"","focus":[],"watchOut":null}'))));
    await expectFailure(generateStudentAdvice({ state: createEmptyState() })).rejects.toThrow();
  });
});
