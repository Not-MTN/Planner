// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createEmptyState, type GuardianPlan, type PlannerState, type Task } from '../types';
import { encryptState, decryptState, importDek, toBase64 } from '../auth/crypto';
import {
  PlannerClient,
  PlannerApiError,
  ConflictError,
  agendaForDay,
  studentCanDeletePlan,
  studentPanelView,
  todayISO,
  upcomingReminders,
  widgetBundle,
  addDaysISO,
} from './plannerClient';
import { decryptEnvelope, encryptEnvelope, importVaultKey } from './cryptoEnvelope';

async function testKey(): Promise<{ base64: string; appKey: CryptoKey; sdkKey: CryptoKey }> {
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) raw[i] = i + 1;
  // Capture the base64 first: importDek zeroizes the raw bytes after import.
  const base64 = toBase64(raw);
  return {
    base64,
    appKey: await importDek(raw, false),
    sdkKey: await importVaultKey(base64),
  };
}

function stateWith(mutate: (state: PlannerState) => void): PlannerState {
  const state = createEmptyState();
  mutate(state);
  return state;
}

function task(partial: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    completed: false,
    priority: 'medium',
    dueDate: null,
    dueTime: null,
    category: '',
    note: '',
    goalId: null,
    sortOrder: 0,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    repeat: null,
    subtasks: [],
    waiting: null,
    estimatedMinutes: null,
    ...partial,
  };
}

function weekPlan(partial: Partial<GuardianPlan> & Pick<GuardianPlan, 'id' | 'linkId' | 'start' | 'title'>): GuardianPlan {
  return {
    author: 'Parent',
    cadence: 'week',
    note: '',
    items: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...partial,
  };
}

/** A fetch stand-in that serves one encrypted vault and records every write. */
function fakeVaultServer(initial: PlannerState, key: CryptoKey) {
  let version = 1;
  let ciphertext = '';
  const pushes: Array<{ baseVersion: number; state: PlannerState }> = [];
  const putQueue: Array<() => Promise<Response>> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (url.endsWith('/api/external/me')) {
      return new Response(JSON.stringify({
        account: { id: 'u1', username: 'nina', displayName: 'Nina', role: 'personal' },
        token: { id: 't1', label: 'Jarvis', scope: 'readwrite', expiresAt: null },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/external/vault') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify({ version, ciphertext }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.endsWith('/api/external/vault') && init?.method === 'PUT') {
      if (putQueue.length > 0) return putQueue.shift()!();
      const body = JSON.parse(String(init.body)) as { baseVersion: number; ciphertext: string };
      if (body.baseVersion !== version) {
        return new Response(JSON.stringify({
          error: { message: 'Another device synced first.', code: 'conflict' },
          current: { version, ciphertext },
        }), { status: 409, headers: { 'Content-Type': 'application/json' } });
      }
      version += 1;
      ciphertext = body.ciphertext;
      const state = await decryptState(body.ciphertext, key);
      pushes.push({ baseVersion: body.baseVersion, state });
      return new Response(JSON.stringify({ version, ciphertext, updatedAt: new Date().toISOString() }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw new Error(`unexpected request ${url}`);
  });
  return {
    fetchImpl,
    pushes,
    async seed() {
      ciphertext = await encryptState(initial, key);
    },
    async queueConflict(nextState: PlannerState, nextKey: CryptoKey) {
      // Another device's write lands first: advance the stored vault, then make
      // the next PUT fail with that newer vault as the 409 `current` blob.
      version += 1;
      ciphertext = await encryptState(nextState, nextKey);
      const current = { version, ciphertext };
      putQueue.push(() => Promise.resolve(new Response(JSON.stringify({
        error: { message: 'Another device synced first.', code: 'conflict' },
        current,
      }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    },
  };
}

describe('crypto envelope interoperability', () => {
  it('decrypts what the app encrypted and vice versa, byte for byte', async () => {
    const { appKey, sdkKey } = await testKey();
    const state = stateWith((s) => {
      s.tasks.push(task({ id: 't1', title: 'Read chapter 4', dueDate: '2026-10-26' }));
    });

    const appCipher = await encryptState(state, appKey);
    const viaSdk = JSON.parse(await decryptEnvelope(appCipher, sdkKey)) as PlannerState;
    expect(viaSdk.tasks[0]?.title).toBe('Read chapter 4');

    const sdkCipher = await encryptEnvelope(JSON.stringify(state), sdkKey);
    const viaApp = await decryptState(sdkCipher, appKey);
    expect(viaApp.tasks[0]?.id).toBe('t1');
  });

  it('rejects a key that is not 32 bytes', async () => {
    await expect(importVaultKey(toBase64(new Uint8Array(16)))).rejects.toThrow(/32 bytes/);
  });
});

describe('widget-ready views', () => {
  const today = todayISO();
  const tomorrow = addDaysISO(today, 1);

  const state = stateWith((s) => {
    s.tasks.push(
      task({ id: 'open-today', title: 'Essay', dueDate: today, dueTime: '17:00' }),
      task({ id: 'open-overdue', title: 'Old worksheet', dueDate: addDaysISO(today, -2) }),
      task({ id: 'done-today', title: 'Tidied desk', completed: true, completedAt: `${today}T08:00:00.000Z` }),
    );
    s.events.push({
      id: 'e1', title: 'Dentist', date: today, startTime: '09:00', endTime: '09:45',
      category: '', note: '', important: true, completed: false, sortOrder: 0,
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', repeat: null, source: null,
    });
    s.panels.student.enabled = true;
    s.panels.student.fixedClasses = [{
      id: 'fc1', title: 'Maths class', weekday: new Date(`${tomorrow}T00:00:00`).getDay(),
      startTime: '08:00', endTime: '09:30',
      createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    }];
    s.panels.student.inbox.plans.push(weekPlan({
      id: 'plan-1', linkId: 'link-1', title: 'Exam week', start: addDaysISO(today, -2),
      items: [
        { id: 'i1', title: 'Physics problems', date: today, time: '16:00', end: '17:30', minutes: null, subject: null, done: false, url: null },
      ],
    }));
    s.panels.student.inbox.homework = [{
      id: 'hw1', linkId: 'link-1', author: 'Parent', title: 'Essay draft', instructions: '', subject: 'English',
      dueAt: `${tomorrow}T18:00:00.000Z`, createdAt: '2026-10-01T00:00:00.000Z',
    }];
  });

  it('builds the day agenda with overdue work, events and plan lessons', () => {
    const agenda = agendaForDay(state, today);
    expect(agenda.tasksDue.map((t) => t.id)).toEqual(['open-today']);
    expect(agenda.overdue.map((t) => t.id)).toEqual(['open-overdue']);
    expect(agenda.events[0]?.title).toBe('Dentist');
    expect(agenda.planItems[0]).toMatchObject({ planId: 'plan-1', title: 'Physics problems', time: '16:00' });
  });

  it('lists upcoming reminders timed and sorted, including the next fixed class', () => {
    const reminders = upcomingReminders(state, { from: today, withinMinutes: 60 * 48 });
    const kinds = reminders.map((r) => `${r.kind}:${r.title}`);
    expect(kinds).toContain('event:Dentist');
    expect(kinds).toContain('task:Essay');
    expect(kinds).toContain('plan-item:Physics problems');
    expect(kinds).toContain('fixed-class:Maths class');
    // Sorted by start time; the 09:00 dentist is before the 16:00 plan lesson.
    expect(reminders[0]?.title).toBe('Dentist');
    const fixed = reminders.find((r) => r.kind === 'fixed-class');
    expect(fixed?.date).toBe(tomorrow);
  });

  it('summarizes the student panel for an external screen', () => {
    const view = studentPanelView(state);
    expect(view?.plans[0]).toMatchObject({ id: 'plan-1', itemCount: 1, doneCount: 0 });
    expect(view?.homework[0]).toMatchObject({ id: 'hw1', submitted: false, approved: false });
    expect(view?.fixedClasses[0]?.title).toBe('Maths class');
  });

  it('packs one widget bundle with counts and the next five reminders', () => {
    const bundle = widgetBundle(state, new Date(`${today}T12:00:00`));
    expect(bundle.openTasks).toBe(2);
    expect(bundle.overdueTasks).toBe(1);
    expect(bundle.completedToday).toBe(1);
    expect(bundle.eventsToday).toBe(1);
    expect(bundle.planLessonsToday).toBe(1);
    expect(bundle.student).toMatchObject({ enabled: true, activePlans: 1, openHomework: 1, fixedClasses: 1 });
    expect(bundle.nextReminders.length).toBeLessThanOrEqual(5);
  });
});

describe('PlannerClient over HTTP', () => {
  it('identifies the account behind a token', async () => {
    const key = await testKey();
    const server = fakeVaultServer(createEmptyState(), key.appKey);
    const client = new PlannerClient({ baseUrl: 'https://planner.test', token: 'plnr_at_x', vaultKey: key.base64, fetchImpl: server.fetchImpl });
    const me = await client.me();
    expect(me.account.username).toBe('nina');
    expect(me.token.scope).toBe('readwrite');
  });

  it('adds and removes tasks through an encrypted round trip', async () => {
    const key = await testKey();
    const initial = stateWith((s) => s.tasks.push(task({ id: 'keep', title: 'Already here' })));
    const server = fakeVaultServer(initial, key.appKey);
    await server.seed();
    const client = new PlannerClient({ baseUrl: 'https://planner.test', token: 'plnr_at_x', vaultKey: key.base64, fetchImpl: server.fetchImpl });

    await client.addTask({ title: 'From Jarvis', dueDate: '2026-10-27', dueTime: '07:30', category: 'Home' });
    expect(server.pushes).toHaveLength(1);
    const written = server.pushes[0]!.state;
    expect(written.tasks.map((t) => t.title)).toEqual(['Already here', 'From Jarvis']);
    const added = written.tasks.find((t) => t.title === 'From Jarvis')!;
    expect(added).toMatchObject({ completed: false, priority: 'medium', dueDate: '2026-10-27', repeat: null, subtasks: [] });

    await client.removeTask(added.id);
    expect(server.pushes).toHaveLength(2);
    expect(server.pushes[1]!.state.tasks.map((t) => t.id)).toEqual(['keep']);
  });

  it('retries by re-applying the mutator when another device wins the version', async () => {
    const key = await testKey();
    const initial = createEmptyState();
    const server = fakeVaultServer(initial, key.appKey);
    await server.seed();
    const client = new PlannerClient({ baseUrl: 'https://planner.test', token: 'plnr_at_x', vaultKey: key.base64, fetchImpl: server.fetchImpl });

    // The phone adds a task between Jarvis's pull and push.
    const phoneState = stateWith((s) => s.tasks.push(task({ id: 'phone-task', title: 'Typed on the phone' })));
    await server.queueConflict(phoneState, key.appKey);

    await client.addTask({ title: 'From Jarvis' });
    const finalState = server.pushes[0]!.state;
    // Both edits survive: the mutator was re-applied to the phone's vault.
    expect(finalState.tasks.map((t) => t.title).sort()).toEqual(['From Jarvis', 'Typed on the phone']);
  });

  it('surfaces a server 403 from a read-only token as a typed error', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'This token is read-only.', code: 'forbidden_scope' },
    }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    const key = await testKey();
    const client = new PlannerClient({ baseUrl: 'https://planner.test', token: 'plnr_at_ro', vaultKey: key.base64, fetchImpl });
    await expect(client.addTask({ title: 'nope' })).rejects.toMatchObject({ status: 403, code: 'forbidden_scope' });
  });

  it('enforces the app rule for removing a student plan', async () => {
    const key = await testKey();
    const today = todayISO();
    const state = stateWith((s) => {
      s.panels.student.enabled = true;
      s.panels.student.guardians = [{
        linkId: 'active-link', guardianUsername: 'parent', guardianDisplayName: 'Parent',
        wrappedShareKey: '', sharedWeek: null,
      }];
      s.panels.student.inbox.plans.push(
        weekPlan({ id: 'active-plan', linkId: 'active-link', title: 'This week', start: today }),
        weekPlan({ id: 'old-plan', linkId: 'active-link', title: 'Long over', start: addDaysISO(today, -20) }),
        weekPlan({ id: 'former-plan', linkId: 'ended-link', title: 'From a former guardian', start: today }),
      );
    });
    const server = fakeVaultServer(state, key.appKey);
    await server.seed();
    const client = new PlannerClient({ baseUrl: 'https://planner.test', token: 'plnr_at_x', vaultKey: key.base64, fetchImpl: server.fetchImpl });

    await expect(client.removeStudentPlan('active-plan')).rejects.toBeInstanceOf(PlannerApiError);
    expect(studentCanDeletePlan(weekPlan({ id: 'old-plan', linkId: 'active-link', title: 'x', start: addDaysISO(today, -20) }), ['active-link'], today)).toBe(true);

    await client.removeStudentPlan('former-plan');
    const remaining = server.pushes[0]!.state.panels.student.inbox.plans.map((p) => p.id);
    expect(remaining).toEqual(['active-plan', 'old-plan']);
    expect(server.pushes[0]!.state.panels.student.deletedPlanIds).toContain('former-plan');
  });
});

describe('conflict error shape', () => {
  it('carries the current vault so callers can merge themselves', () => {
    const error = new ConflictError({ version: 7, ciphertext: 'abc' });
    expect(error.status).toBe(409);
    expect(error.current?.version).toBe(7);
  });
});
