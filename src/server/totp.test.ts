import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  currentTotpCode,
  formatTotpSecret,
  newTotpSecret,
  totpCode,
  totpUri,
  verifyTotp,
} from './totp';

/**
 * The RFC 6238 test vector: secret "12345678901234567890" (ASCII). The RFC
 * lists the expected code for a set of T = 59s, 1111111109s and so on. If
 * these three match, the HMAC, the dynamic truncation and the step arithmetic
 * all match what every authenticator app does.
 */
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    const at = (seconds: number) => seconds * 1000;
    expect(currentTotpCode(RFC_SECRET, at(59))).toBe('287082');
    expect(currentTotpCode(RFC_SECRET, at(1_111_111_109))).toBe('081804');
    expect(currentTotpCode(RFC_SECRET, at(1_111_111_111))).toBe('050471');
    expect(currentTotpCode(RFC_SECRET, at(1_234_567_890))).toBe('005924');
    expect(currentTotpCode(RFC_SECRET, at(2_000_000_000))).toBe('279037');
  });

  it('round-trips a secret through base32', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const bytes = base32Decode(secret)!;
    // 20 random bytes is 160 bits.
    expect(bytes).toHaveLength(20);
    expect(base32Encode(bytes)).toBe(secret);
  });

  it('reads a secret typed the way people type it', () => {
    const secret = newTotpSecret();
    const spaced = formatTotpSecret(secret).toLowerCase();
    const code = currentTotpCode(secret)!;
    // Lower case, spaces: what a person copies out of the setup screen.
    expect(currentTotpCode(spaced)).toBe(code);
    expect(verifyTotp(spaced, code).ok).toBe(true);
  });

  it('accepts the code on either side of the step boundary', () => {
    const secret = newTotpSecret();
    const now = 1_700_000_000_000;
    // One step behind and one step ahead are accepted: clocks drift, and the
    // code a person is reading may have been generated just before the turn.
    expect(verifyTotp(secret, totpCode(secret, Math.floor(now / 30000) - 1)!, { at: now }).ok).toBe(true);
    expect(verifyTotp(secret, totpCode(secret, Math.floor(now / 30000) + 1)!, { at: now }).ok).toBe(true);
    // Two steps away is a wrong code, not a slow typist.
    expect(verifyTotp(secret, totpCode(secret, Math.floor(now / 30000) - 2)!, { at: now }).ok).toBe(false);
    expect(verifyTotp(secret, totpCode(secret, Math.floor(now / 30000) + 2)!, { at: now }).ok).toBe(false);
  });

  it('refuses a code that has already been used, but not merely an old one', () => {
    const secret = newTotpSecret();
    const now = 1_700_000_015_000;
    const counter = Math.floor(now / 30000);
    const code = totpCode(secret, counter)!;
    expect(verifyTotp(secret, code, { at: now }).ok).toBe(true);
    // Replaying it inside its own 30-second window must fail.
    expect(verifyTotp(secret, code, { at: now, afterCounter: counter }).ok).toBe(false);
    // The next step is still fine.
    expect(verifyTotp(secret, totpCode(secret, counter + 1)!, { at: now + 30_000, afterCounter: counter }).ok).toBe(true);
  });

  it('rejects anything that is not a six-digit code', () => {
    const secret = newTotpSecret();
    const code = currentTotpCode(secret)!;
    expect(verifyTotp(secret, code.slice(1)).ok).toBe(false);
    expect(verifyTotp(secret, `${code}0`).ok).toBe(false);
    expect(verifyTotp(secret, 'abcdef').ok).toBe(false);
    expect(verifyTotp(secret, '').ok).toBe(false);
    // Spaces are how people paste a code from an app.
    expect(verifyTotp(secret, `${code.slice(0, 3)} ${code.slice(3)}`).ok).toBe(true);
  });

  it('produces a URI every authenticator app understands', () => {
    const secret = newTotpSecret();
    const uri = totpUri('sara', secret);
    expect(uri.startsWith('otpauth://totp/Planner%3Asara?')).toBe(true);
    const params = new URLSearchParams(uri.slice(uri.indexOf('?') + 1));
    expect(params.get('secret')).toBe(secret);
    expect(params.get('issuer')).toBe('Planner');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });

  it('gives different accounts different secrets', () => {
    const secrets = new Set(Array.from({ length: 20 }, () => newTotpSecret()));
    expect(secrets.size).toBe(20);
  });
});
