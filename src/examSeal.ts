/**
 * The commit-then-reveal protocol for test-exam answer keys.
 *
 * The answer key never sits in the student's encrypted inbox: the guardian
 * seals it with the link key into its own server slot, and the server only
 * releases it after the student's answers have been committed. Both envelopes
 * are ciphertext the server cannot read; its only job is the ordering —
 * commit first, key second, exactly once.
 */
import { decryptJson, encryptJson, importDek, unwrapKeyRaw } from './auth/crypto';
import { AuthError, getActiveSession, request } from './auth/session';
import type { ExamKeyQuestion } from './types';

/** What the guardian seals: the full key for every variant of one exam. */
export interface SealedExamKey {
  examId: string;
  variants: Array<{ id: string; questions: ExamKeyQuestion[] }>;
  sealedAt: string;
}

/** What the student commits, irrevocably, before the key can be read. */
export interface ExamCommitEnvelope {
  examId: string;
  variantId: string | null;
  answers: Record<string, number>;
  startedAt: string;
  committedAt: string;
}

async function linkKey(wrappedShareKey: string): Promise<CryptoKey> {
  const session = getActiveSession();
  if (!session) throw new Error('Sign in before using exams.');
  return unwrapKeyRaw(wrappedShareKey, session.dek).then((raw) => importDek(raw, false));
}

/** Guardian: seal the answer key when the exam is sent (or re-sealed after an edit). */
export async function sealExamKey(
  linkId: string,
  wrappedShareKey: string,
  examId: string,
  envelope: SealedExamKey,
): Promise<void> {
  const key = await linkKey(wrappedShareKey);
  const ciphertext = await encryptJson(envelope, key);
  await request('/api/auth/exam-seal', {
    method: 'POST',
    body: JSON.stringify({ linkId, examId, ciphertext }),
  });
}

/** Student: commit the one allowed attempt. */
export async function commitExamAnswers(
  linkId: string,
  wrappedShareKey: string,
  envelope: ExamCommitEnvelope,
): Promise<'committed' | 'already'> {
  const key = await linkKey(wrappedShareKey);
  const ciphertext = await encryptJson(envelope, key);
  try {
    await request('/api/auth/exam-commit', {
      method: 'POST',
      body: JSON.stringify({ linkId, examId: envelope.examId, ciphertext }),
    });
    return 'committed';
  } catch (error) {
    if (error instanceof AuthError && String(error.code) === 'already_committed') return 'already';
    throw error;
  }
}

/**
 * Student: read the released key. Null means the commit has not landed yet
 * (or the server still holds the key sealed) — the caller must not grade
 * against a key it could not honestly obtain.
 */
export async function fetchReleasedExamKey(
  linkId: string,
  wrappedShareKey: string,
  examId: string,
): Promise<SealedExamKey | null> {
  try {
    const response = await request<{ ciphertext: string }>(
      `/api/auth/exam-key?linkId=${encodeURIComponent(linkId)}&examId=${encodeURIComponent(examId)}`,
    );
    const key = await linkKey(wrappedShareKey);
    return decryptJson<SealedExamKey>(response.ciphertext, key);
  } catch (error) {
    if (error instanceof AuthError && String(error.code) === 'not_released') return null;
    throw error;
  }
}
