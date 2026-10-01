/**
 * Time-based one-time passwords (RFC 6238), as a second step at sign-in.
 *
 * Planner cannot read the vault, so a stolen password is already the whole
 * disaster: it opens the encrypted planner anywhere. A passkey is the good
 * answer, but not every browser and not every device has one. An
 * authenticator app works everywhere, costs nothing, and means a leaked
 * password on its own is no longer enough.
 *
 * Everything here is the standard 6-digit, 30-second, SHA-1 profile that every
 * authenticator app implements. Deliberately nothing clever: the code has to
 * match what Google Authenticator, 1Password, Authy and Aegis would show.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Seconds in one step. Every app assumes 30. */
const PERIOD = 30;
/** Digits shown to the user. Every app assumes 6. */
const DIGITS = 6;
/**
 * How many steps either side of "now" are accepted. One step each way is what
 * the apps themselves allow, and covers a clock that has drifted or a code
 * typed just as the step turned over.
 */
const SKEW = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encodes bytes as unpadded base32, the form every app expects. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/**
 * Decodes base32, tolerating the ways people actually type a secret: lower
 * case, spaces, dashes, and the padding the URI form sometimes carries.
 *
 * 0, 1, 8 and 9 are not in the base32 alphabet, but they are what O, I, B and
 * G look like in most typefaces — so they are read back as their look-alikes
 * rather than rejected outright.
 */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text
    .replace(/[\s-]/g, '')
    .replace(/=+$/, '')
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/8/g, 'B');
  if (clean.length === 0) return null;
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh 160-bit secret, as recommended by RFC 4226. */
export function newTotpSecret(): string {
  return base32Encode(new Uint8Array(randomBytes(20)));
}

function counterAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / PERIOD);
}

/** The 6-digit code for one step, as a zero-padded string. */
export function totpCode(secret: string, counter: number): string | null {
  const key = base32Decode(secret);
  if (!key || key.length === 0) return null;
  const step = Buffer.alloc(8);
  // Counters beyond 2^32 would need the high word; nobody will be alive to see it.
  step.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  step.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac('sha1', key).update(step).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const truncated =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(truncated % 10 ** DIGITS).padStart(DIGITS, '0');
}

/** The code an app would be showing right now. */
export function currentTotpCode(secret: string, at: number = Date.now()): string | null {
  return totpCode(secret, counterAt(at));
}

/**
 * Checks a typed code.
 *
 * `afterCounter` is the step of the last code this account accepted. Recording
 * it closes the obvious hole in plain TOTP: a code stays valid for its whole
 * 30-second window, so anyone who sees one (over a shoulder, in a screenshot)
 * can replay it inside that window. Refusing to accept the same step twice
 * does not stop a fast thief, but it does stop the casual one.
 */
export function verifyTotp(
  secret: string,
  code: string,
  options: { at?: number; afterCounter?: number } = {},
): { ok: boolean; counter: number } {
  const typed = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return { ok: false, counter: options.afterCounter ?? 0 };
  const now = counterAt(options.at ?? Date.now());
  const floor = options.afterCounter ?? -1;
  for (let offset = -SKEW; offset <= SKEW; offset += 1) {
    const counter = now + offset;
    if (counter <= floor) continue;
    const expected = totpCode(secret, counter);
    if (!expected) continue;
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(typed, 'utf8');
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true, counter };
  }
  return { ok: false, counter: floor };
}

/**
 * The `otpauth://` URI authenticator apps import.
 *
 * Most apps still accept a pasted secret, so this is a convenience rather than
 * the only way in — it is why no QR code has to be drawn here.
 */
export function totpUri(account: string, secret: string, issuer = 'Planner'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** The secret split into groups of four, which is how apps show it for typing. */
export function formatTotpSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) ?? []).join(' ');
}
