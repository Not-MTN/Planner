import { afterAll, describe, expect, it } from 'vitest';
import {
  handleLinkFileDelete,
  handleLinkFileSign,
  handleLinks,
  handleSignup,
} from './authApi';
import { createMemoryAuthStore } from './authStore';
import { resetRateLimits } from './security';

const HASH = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const CLOUD = {
  CLOUDINARY_CLOUD_NAME: 'planner-test',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'test-secret-key',
};

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

async function linkedPair() {
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

describe('link file upload signatures', () => {
  it('reports 503 when cloud storage is not configured', async () => {
    const { store, guardianCookie, linkId } = await linkedPair();
    resetRateLimits();
    const response = await handleLinkFileSign(
      post('/api/auth/link-files/sign', { linkId, purpose: 'exam-question' }, guardianCookie),
      store,
      {},
    );
    expect(response.status).toBe(503);
  });

  it('refuses anonymous callers and bad purposes', async () => {
    const { store, guardianCookie, linkId } = await linkedPair();
    resetRateLimits();
    expect((await handleLinkFileSign(post('/api/auth/link-files/sign', { linkId, purpose: 'exam-question' }), store, CLOUD)).status).toBe(401);
    resetRateLimits();
    expect(
      (await handleLinkFileSign(
        post('/api/auth/link-files/sign', { linkId, purpose: 'homework' }, guardianCookie),
        store,
        CLOUD,
      )).status,
    ).toBe(400);
  });

  it('enforces who can upload which paper and returns a signed ticket', async () => {
    const { store, guardianCookie, studentCookie, linkId } = await linkedPair();

    // A student cannot publish a question paper.
    resetRateLimits();
    const refusedQuestion = await handleLinkFileSign(
      post('/api/auth/link-files/sign', { linkId, purpose: 'exam-question' }, studentCookie),
      store,
      CLOUD,
    );
    expect(refusedQuestion.status).toBe(403);

    // A guardian cannot hand in an answer paper.
    resetRateLimits();
    const refusedAnswer = await handleLinkFileSign(
      post('/api/auth/link-files/sign', { linkId, purpose: 'exam-answer' }, guardianCookie),
      store,
      CLOUD,
    );
    expect(refusedAnswer.status).toBe(403);

    // The guardian gets a question-paper ticket scoped to the link folder.
    resetRateLimits();
    const question = await handleLinkFileSign(
      post('/api/auth/link-files/sign', { linkId, purpose: 'exam-question' }, guardianCookie),
      store,
      CLOUD,
    );
    expect(question.status).toBe(200);
    const ticket = (await question.json()) as { publicId: string; signature: string; timestamp: number; cloudName: string };
    expect(ticket.publicId).toMatch(new RegExp(`^planner-files/exam-question/${linkId}/[a-f0-9]{24}$`));
    expect(ticket.signature).toMatch(/^[a-f0-9]{40}$/);
    expect(ticket.cloudName).toBe('planner-test');

    // The student gets an answer-paper ticket.
    resetRateLimits();
    const answer = await handleLinkFileSign(
      post('/api/auth/link-files/sign', { linkId, purpose: 'exam-answer' }, studentCookie),
      store,
      CLOUD,
    );
    expect(answer.status).toBe(200);
    expect(((await answer.json()) as { publicId: string }).publicId).toContain('exam-answer');
  });

  it('does not sign uploads for a link the caller does not belong to', async () => {
    const { store, linkId } = await linkedPair();
    resetRateLimits();
    const outsiderCookie = cookieFrom(
      await handleSignup(
        post('/api/auth/signup', { ...ACCOUNT, username: 'outsider', email: 'out@example.com' }),
        store,
      ),
    );
    resetRateLimits();
    const response = await handleLinkFileSign(
      post('/api/auth/link-files/sign', { linkId, purpose: 'exam-question' }, outsiderCookie),
      store,
      CLOUD,
    );
    expect(response.status).toBe(404);
  });
});

describe('link file delete validation', () => {
  it('validates ids before any network call', async () => {
    const { store, guardianCookie, linkId } = await linkedPair();
    resetRateLimits();
    const bad = await handleLinkFileDelete(
      post('/api/auth/link-files/delete', { linkId, publicIds: ['planner-homework/elsewhere/abc'] }, guardianCookie),
      store,
      CLOUD,
    );
    expect(bad.status).toBe(400);

    resetRateLimits();
    const empty = await handleLinkFileDelete(
      post('/api/auth/link-files/delete', { linkId, publicIds: [] }, guardianCookie),
      store,
      CLOUD,
    );
    expect(empty.status).toBe(400);

    // An id for a different link is rejected even when shaped correctly.
    resetRateLimits();
    const foreign = await handleLinkFileDelete(
      post(
        '/api/auth/link-files/delete',
        { linkId, publicIds: ['planner-files/exam-question/other-link/0123456789abcdef01234567'] },
        guardianCookie,
      ),
      store,
      CLOUD,
    );
    expect(foreign.status).toBe(400);
  });

  it('refuses anonymous deletes and only accepts POST', async () => {
    const { store } = await linkedPair();
    resetRateLimits();
    const response = await handleLinkFileDelete(
      get('/api/auth/link-files/delete', undefined),
      store,
      CLOUD,
    );
    expect(response.status).toBe(405);
  });
});
