/**
 * The wire's size ceiling, and the trimming that keeps an outbox under it.
 *
 * A link has two encrypted slots — the guardian's outbox and the student's —
 * and each one carries *all* of what that side has said and planned, not a
 * single message. The server accepts a slot up to `MAX_NOTE_BYTES`; a write
 * over that is refused, and a refused write is how a guardian's plan ends up
 * parked in the offline queue and never delivered: the composer fails, the
 * queue keeps the draft, and every retry fails the same way.
 *
 * So the client fits the payload to the wire before sending it. What it gives
 * up is history — the oldest entry of whichever list can spare it — never the
 * item being written, because every writer puts its new item at the front of a
 * newest-first list (and the thread, which runs oldest first, is the last list
 * to be touched).
 */
import { MAX_NOTE_BYTES } from '../shared/authContract';

/** How big a payload is once it has been encrypted and base64'd. */
const utf8 = new TextEncoder();
export function wireBytes(value: unknown): number {
  // Bytes, not characters: a Persian planner is worth two bytes for most of
  // what it writes, and counting code units would let a slot through at twice
  // the size the server will take.
  return utf8.encode(JSON.stringify(value)).length;
}

/**
 * One list in a payload, and which end of it holds the oldest entry.
 *
 * `front` is for lists that run oldest first (the thread); `back` for the ones
 * that put their newest entry first (everything else the link carries).
 */
export type TrimStep<T> = [key: keyof T, from: 'front' | 'back'];

/**
 * Drop entries, one at a time, until the payload fits the budget.
 *
 * Steps are tried in the order given, so the least valuable history goes first.
 * A list is never emptied: its last entry is what that write is *about* — the
 * plan being sent, the message being typed — and a slot that arrives without it
 * would look like a successful send that delivered nothing. If there is still
 * no room after every step, the payload is returned as small as it can be and
 * the caller decides whether that is small enough.
 */
export function fitToWire<T extends object>(
  payload: T,
  sacrifice: ReadonlyArray<TrimStep<T>>,
  budget: number = MAX_NOTE_BYTES,
): T {
  if (wireBytes(payload) <= budget) return payload;
  let fitted = payload;
  // One entry from every list per pass, rather than emptying the first list
  // before touching the second: losing an entire conversation to keep one extra
  // old notice would be the wrong trade, and this way the pressure is spread
  // over the history that can afford it.
  let dropped = true;
  while (dropped && wireBytes(fitted) > budget) {
    dropped = false;
    for (const [key, from] of sacrifice) {
      if (wireBytes(fitted) <= budget) break;
      const list = fitted[key] as unknown;
      if (!Array.isArray(list) || list.length <= 1) continue;
      fitted = { ...fitted, [key]: from === 'front' ? list.slice(1) : list.slice(0, -1) };
      dropped = true;
    }
  }
  return fitted;
}
