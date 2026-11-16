/**
 * A link slot carries a whole outbox, and the server will only take so much.
 *
 * The fitting is the difference between a guardian whose plan is delivered and
 * one whose plan sits in the offline queue for good: an over-size write is
 * refused every time it is retried. These check the rule itself — history goes
 * first, what is being written stays, and the result always fits.
 */
import { describe, expect, it } from 'vitest';
import { MAX_NOTE_BYTES } from '../shared/authContract';
import { fitToWire, wireBytes, type TrimStep } from './wireBudget';

interface Payload {
  v: 3;
  chat: string[];
  notices: string[];
  plans: string[];
}

const step = (key: keyof Payload, from: 'front' | 'back'): TrimStep<Payload> => [key, from];
const order: ReadonlyArray<TrimStep<Payload>> = [
  step('chat', 'front'),
  step('notices', 'back'),
  step('plans', 'back'),
];

const entry = (size: number): string => 'x'.repeat(size);

function payload(): Payload {
  return {
    v: 3,
    chat: [entry(400), entry(401), entry(402)],
    notices: [entry(300), entry(301), entry(302)],
    plans: [entry(500), entry(501), entry(502)],
  };
}

describe('fitting a slot to the wire', () => {
  it('leaves a slot that already fits exactly as it was', () => {
    const small = { v: 3 as const, chat: ['hello'], notices: [], plans: ['a week'] };
    expect(fitToWire(small, order)).toBe(small);
  });

  it('gives up the oldest history, in the order it was told to', () => {
    // Exactly one thread entry of room: that is the one that goes, and it is
    // the oldest, so the start of the conversation is what is dropped.
    const full = payload();
    const roomForOneChat = { ...full, chat: full.chat.slice(1) };
    const fitted = fitToWire(payload(), order, wireBytes(roomForOneChat));
    expect(fitted.chat).toEqual([entry(401), entry(402)]);
    expect(fitted.notices).toEqual(full.notices);
    expect(fitted.plans).toEqual(full.plans);

    // A little less room: the oldest notice goes next, before any plan does.
    const roomForOneNotices = { ...roomForOneChat, notices: full.notices.slice(0, -1) };
    const more = fitToWire(payload(), order, wireBytes(roomForOneNotices));
    expect(more.chat).toEqual([entry(401), entry(402)]);
    expect(more.notices).toEqual([entry(300), entry(301)]);
    expect(more.plans).toEqual(full.plans);
  });

  it('never empties a list: the entry the write is about is what survives', () => {
    // No room at all. Every list keeps its newest entry rather than arriving
    // as a successful send that delivered nothing. `chat` runs oldest first, so
    // its newest is the last one; the other lists run newest first.
    const fitted = fitToWire(payload(), order, 1);
    expect(fitted.chat).toEqual([entry(402)]);
    expect(fitted.notices).toEqual([entry(300)]);
    expect(fitted.plans).toEqual([entry(500)]);
  });

  it('measures what the wire measures — bytes, not characters', () => {
    // A Persian note is two bytes a letter once encrypted; counting characters
    // would let a slot through at twice the size the server will take.
    const persian = 'برنامهٔ این هفته را با هم مرور کنیم و هر روز چند درس بخوانیم.';
    const wide = { v: 3 as const, chat: [persian, persian.repeat(20)], notices: [], plans: [] };
    expect(wireBytes(wide)).toBeGreaterThan(persian.repeat(20).length + persian.length);
    const roomForNewest = { v: 3 as const, chat: [persian.repeat(20)], notices: [], plans: [] };
    const fitted = fitToWire(wide, [step('chat', 'front')], wireBytes(roomForNewest));
    expect(fitted.chat).toEqual([persian.repeat(20)]);
  });

  it('fits an outbox that is over the server ceiling', () => {
    const over: Payload = {
      v: 3,
      chat: Array.from({ length: 40 }, () => entry(600)),
      notices: Array.from({ length: 10 }, () => entry(160)),
      plans: Array.from({ length: 5 }, () => entry(20_000)),
    };
    expect(wireBytes(over)).toBeGreaterThan(MAX_NOTE_BYTES);
    const fitted = fitToWire(over, order);
    expect(wireBytes(fitted)).toBeLessThanOrEqual(MAX_NOTE_BYTES);
    // The newest of everything is still there.
    expect(fitted.chat.at(-1)).toBe(entry(600));
    expect(fitted.notices[0]).toBe(entry(160));
    expect(fitted.plans[0]).toBe(entry(20_000));
  });
});
