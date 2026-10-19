import { afterAll, describe, expect, it } from 'vitest';
import {
  handleExamCommit,
  handleExamSealGet,
  handleExamSealPut,
  handleLinks,
  handleSignup,
} from './authApi';
import { createMemoryAuthStore } from './authStore';
import { resetRateLimits } from './security';

const HASH = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const CIPHER = 'c2VhbGVkLWtleS1jaXBoZXJ0ZXh0';
const COMMIT = 'Y29tbWl0dGVkLWFuc3dlcnM=';

function post(path: string, body: unknown, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  });
}

function get(path: string, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}

const ACCOUNT = {
  username: 'guard',
  email: 'guard@example.com',
  displayName: 'Guard',
  role: 'guardian' as const,
  kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
  authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
  recoveryHashes: [
    'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'AgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    'AwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  ],
  wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
  wrappedRecovery: [
    'eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5eXl5',
    'enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6enp6',
    'MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA=',
  ],
  ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
};

async function pair() {
  const store = createMemoryAuthStore();
  resetRateLimits();
  const guardianCookie = cookieFrom(await handleSignup(post('/api/auth/signup', ACCOUNT), store));
  resetRateLimits();
  const invite = await handleLinks(
    post('/api/auth/links', { username: 'pupil', codeHash: HASH, wrappedShare: HASH }, guardianCookie),
    store,
  );
  expect(invite.status).toBe(201);
  const linkId = ((await invite.json()) as { link: { id: string } }).link.id;
  const studentCookie = cookieFrom(
    await handleSignup(
      post('/api/auth/signup', { ...ACCOUNT, username: 'pupil', role: 'student', email: 'pupil@example.com' }),
      store,
    ),
  );
  const student = await store.findAccount('pupil');
  if (!student) throw new Error('student missing');
  await store.acceptLink(HASH, { id: student.user.id, usernameLower: 'pupil' });
  return { store, guardianCookie, studentCookie, linkId };
}

afterAll(() => resetRateLimits());

describe('commit-then-reveal exam seals', () => {
  it('lets the guardian seal a key but keeps it hidden from the student until they commit', async () => {
    const { store, guardianCookie, studentCookie, linkId } = await pair();
    const examId = 'exam-001';

    resetRateLimits();
    const sealed = await handleExamSealPut(
      post('/api/auth/exam-seal', { linkId, examId, ciphertext: CIPHER }, guardianCookie),
      store,
    );
    expect(sealed.status).toBe(200);

    // Before committing, the student is refused the key.
    resetRateLimits();
    const hidden = await handleExamSealGet(
      get(`/api/auth/exam-key?linkId=${linkId}&examId=${examId}`, studentCookie),
      store,
    );
    expect(hidden.status).toBe(409);
    expect(((await hidden.json()) as { error: { code: string } }).error.code).toBe('not_released');

    // The guardian can always read their own sealed key.
    resetRateLimits();
    const own = await handleExamSealGet(
      get(`/api/auth/exam-key?linkId=${linkId}&examId=${examId}`, guardianCookie),
      store,
    );
    expect(own.status).toBe(200);
    expect(((await own.json()) as { ciphertext: string }).ciphertext).toBe(CIPHER);
  });

  it('enforces one attempt: a second commit is refused', async () => {
    const { store, guardianCookie, studentCookie, linkId } = await pair();
    const examId = 'exam-002';

    resetRateLimits();
    await handleExamSealPut(
      post('/api/auth/exam-seal', { linkId, examId, ciphertext: CIPHER }, guardianCookie),
      store,
    );

    resetRateLimits();
    const first = await handleExamCommit(
      post('/api/auth/exam-commit', { linkId, examId, ciphertext: COMMIT }, studentCookie),
      store,
    );
    expect(first.status).toBe(200);

    resetRateLimits();
    const second = await handleExamCommit(
      post('/api/auth/exam-commit', { linkId, examId, ciphertext: 'other' }, studentCookie),
      store,
    );
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('already_committed');

    // Now the key releases and carries the server's commit timestamp.
    resetRateLimits();
    const released = await handleExamSealGet(
      get(`/api/auth/exam-key?linkId=${linkId}&examId=${examId}`, studentCookie),
      store,
    );
    expect(released.status).toBe(200);
    const body = (await released.json()) as { ciphertext: string; committedAt: string };
    expect(body.ciphertext).toBe(CIPHER);
    expect(Number.isFinite(Date.parse(body.committedAt))).toBe(true);
  });

  it('refuses cross-link access and anonymous calls', async () => {
    const { store, guardianCookie, linkId } = await pair();
    resetRateLimits();
    const anonymous = await handleExamSealPut(
      post('/api/auth/exam-seal', { linkId, examId: 'exam-cross1', ciphertext: CIPHER }),
      store,
    );
    expect(anonymous.status).toBe(401);

    resetRateLimits();
    const missing = await handleExamSealGet(get(`/api/auth/exam-key?linkId=${linkId}&examId=exam-nope9`, guardianCookie), store);
    expect(missing.status).toBe(404);
  });

  it('refuses a commit for an exam that has no sealed key', async () => {
    const { store, studentCookie, linkId } = await pair();
    resetRateLimits();
    const response = await handleExamCommit(
      post('/api/auth/exam-commit', { linkId, examId: 'exam-ghost', ciphertext: COMMIT }, studentCookie),
      store,
    );
    expect(response.status).toBe(404);
  });
});
