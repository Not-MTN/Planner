import { describe, expect, it } from 'vitest';
import {
  createVaultKeys,
  decryptState,
  deriveFromPassword,
  encryptState,
  formatRecoveryCodes,
  formatRecoveryKey,
  hashRecoveryKey,
  importDek,
  keyFromRecovery,
  newSalt,
  normalizeRecoveryKey,
  unwrapKey,
  unwrapWithRecoveryCode,
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
    const recovered = await unwrapKey(keys.wrappedRecovery[0]!, recoveryKek);
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

  it('gives each recovery code its own wrapped copy of the vault key', async () => {
    const codes = formatRecoveryCodes(3);
    expect(codes).toHaveLength(3);
    // Distinct codes, or a second copy would add nothing.
    expect(new Set(codes).size).toBe(3);

    const keys = await createVaultKeys(PASSWORD, codes);
    expect(keys.wrappedRecovery).toHaveLength(3);
    keys.wrappedRecovery.slice(1).forEach((wrap, index) => expect(wrap).not.toBe(keys.wrappedRecovery[index]));

    const state = createEmptyState();
    const cipher = await encryptState(state, keys.dek);
    // Every code must open the same vault on its own.
    for (const [index, code] of codes.entries()) {
      const kek = await keyFromRecovery(code, keys.salt);
      const dek = await unwrapKey(keys.wrappedRecovery[index]!, kek);
      await expect(decryptState(cipher, dek)).resolves.toBeTruthy();
    }
  });

  it('opens the vault with any code without being told which one it is', async () => {
    const codes = formatRecoveryCodes(4);
    const keys = await createVaultKeys(PASSWORD, codes);
    const state = createEmptyState();
    const cipher = await encryptState(state, keys.dek);

    // The last code in the set is the one being used; the earlier copies fail
    // first, exactly as they would for a wrong code.
    const last = await unwrapWithRecoveryCode(codes[3]!, keys.wrappedRecovery, keys.salt);
    expect(last?.index).toBe(3);
    await expect(decryptState(cipher, await importDek(last!.raw))).resolves.toBeTruthy();

    expect(await unwrapWithRecoveryCode('plnr-AAAA-AAAA-AAAA-AAAA-AAAA', keys.wrappedRecovery, keys.salt)).toBeNull();
    expect(await unwrapWithRecoveryCode(codes[0]!, [], keys.salt)).toBeNull();
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

  it('creates the same one-way recovery verifier across accepted key formats', () => {
    const key = formatRecoveryKey();
    expect(hashRecoveryKey(key)).toBe(hashRecoveryKey(key.toLowerCase().replace(/-/g, ' ')));
    expect(hashRecoveryKey(key)).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(() => hashRecoveryKey('not a recovery key')).toThrow();
  });

  it('refuses to decrypt a tampered vault', async () => {
    const keys = await createVaultKeys(PASSWORD, formatRecoveryKey());
    const cipher = await encryptState(createEmptyState(), keys.dek);
    const bytes = Buffer.from(cipher, 'base64');
    bytes[bytes.length - 1] ^= 0xff;
    await expect(decryptState(bytes.toString('base64'), keys.dek)).rejects.toThrow();
  });
});
