import { describe, expect, it } from 'vitest';
import {
  createVaultKeys,
  decryptState,
  deriveFromPassword,
  encryptState,
  formatRecoveryKey,
  keyFromRecovery,
  newSalt,
  normalizeRecoveryKey,
  unwrapKey,
} from './crypto';
import { createEmptyState } from '../types';

const PASSWORD = 'correct horse battery staple';

describe('vault crypto', () => {
  it('derives a stable auth token and KEK from a password and salt', async () => {
    const salt = newSalt();
    const first = await deriveFromPassword(PASSWORD, salt);
    const second = await deriveFromPassword(PASSWORD, salt);
    expect(first.authToken).toBe(second.authToken);
    expect(first.authToken.length).toBeGreaterThan(40); // 32 bytes, base64
    // The auth token and the encryption key are different halves of the output.
    const other = await deriveFromPassword(PASSWORD + 'x', salt);
    expect(other.authToken).not.toBe(first.authToken);
  });

  it('derives different keys for different salts', async () => {
    const a = await deriveFromPassword(PASSWORD, newSalt());
    const b = await deriveFromPassword(PASSWORD, newSalt());
    expect(a.authToken).not.toBe(b.authToken);
  });

  it('wraps and unwraps the vault key with the password key', async () => {
    const keys = await createVaultKeys(PASSWORD, formatRecoveryKey());
    const { kek } = await deriveFromPassword(PASSWORD, keys.salt);
    const dek = await unwrapKey(keys.wrappedDek, kek);

    const state = createEmptyState();
    state.tasks.push({
      id: 't1',
      title: 'Math homework',
      completed: false,
      priority: 'medium',
      dueDate: '2026-09-30',
      dueTime: '16:00',
      category: 'study',
      note: '',
      goalId: null,
      sortOrder: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      repeat: null,
      subtasks: [],
      waiting: null,
      estimatedMinutes: null,
    });

    const cipher = await encryptState(state, dek);
    const back = await decryptState(cipher, dek);
    expect(back.tasks[0]?.title).toBe('Math homework');
  });

  it('can recover the vault key from the recovery key alone', async () => {
    const recovery = formatRecoveryKey();
    const keys = await createVaultKeys(PASSWORD, recovery);
    const recoveryKek = await keyFromRecovery(recovery, keys.salt);
    const recovered = await unwrapKey(keys.wrappedRecovery, recoveryKek);
    const state = createEmptyState();
    const cipher = await encryptState(state, keys.dek);
    // Decrypting with the recovered key proves both paths open the same vault.
    await expect(decryptState(cipher, recovered)).resolves.toBeTruthy();
  });

  it('cannot open the vault with the wrong password', async () => {
    const keys = await createVaultKeys(PASSWORD, formatRecoveryKey());
    const wrong = await deriveFromPassword('wrong password', keys.salt);
    await expect(unwrapKey(keys.wrappedDek, wrong.kek)).rejects.toThrow();
  });

  it('formats and normalises recovery keys tolerantly', () => {
    const key = formatRecoveryKey();
    expect(key).toMatch(/^plnr(-[A-Z2-9]{4}){5}$/);
    expect(normalizeRecoveryKey(key)).toBe(key);
    expect(normalizeRecoveryKey(key.toLowerCase())).toBe(key);
    expect(normalizeRecoveryKey(key.replace(/-/g, ' '))).toBe(key);
    expect(normalizeRecoveryKey(key.slice(5))).toBe(key);
    expect(normalizeRecoveryKey('plnr-ABCD')).toBeNull();
    expect(normalizeRecoveryKey('plnr-0000-1111-2222-3333-4444')).toBeNull(); // 0/1 are not in the alphabet
  });

  it('refuses to decrypt a tampered vault', async () => {
    const keys = await createVaultKeys(PASSWORD, formatRecoveryKey());
    const cipher = await encryptState(createEmptyState(), keys.dek);
    const bytes = Buffer.from(cipher, 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    await expect(decryptState(bytes.toString('base64'), keys.dek)).rejects.toThrow();
  });
});
