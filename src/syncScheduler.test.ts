import { describe, expect, it } from 'vitest';
import {
  activityChanged,
  highestPriority,
  MAX_BACKOFF_MS,
  pollDelayMs,
  POLL_INTERVALS_MS,
  priorityFromHeld,
} from './syncScheduler';

describe('pollDelayMs', () => {
  it('holds each priority to its own healthy rhythm', () => {
    expect(pollDelayMs('chat', true, 0)).toBe(POLL_INTERVALS_MS.chat);
    expect(pollDelayMs('panel', true, 0)).toBe(POLL_INTERVALS_MS.panel);
    expect(pollDelayMs('idle', true, 0)).toBe(POLL_INTERVALS_MS.idle);
  });

  it('never polls while the tab is hidden', () => {
    expect(pollDelayMs('chat', false, 0)).toBeNull();
    expect(pollDelayMs('chat', false, 5)).toBeNull();
  });

  it('backs off exponentially while failures mount, capped at the maximum', () => {
    const base = POLL_INTERVALS_MS.chat;
    expect(pollDelayMs('chat', true, 1)).toBe(base * 2);
    expect(pollDelayMs('chat', true, 2)).toBe(base * 4);
    expect(pollDelayMs('chat', true, 10)).toBe(MAX_BACKOFF_MS);
  });

  it('recovers its rhythm on the first success', () => {
    expect(pollDelayMs('panel', true, 0)).toBe(POLL_INTERVALS_MS.panel);
  });
});

describe('activityChanged', () => {
  it('treats the first probe as "nothing to do" when there are no links', () => {
    expect(activityChanged(null, {})).toBe(false);
  });

  it('treats the first probe with links as a change so the initial sync runs', () => {
    expect(activityChanged(null, { link1: '2026-10-19T10:00:00.000Z' })).toBe(true);
  });

  it('stays quiet when every timestamp matches what was last seen', () => {
    const seen = { link1: '2026-10-19T10:00:00.000Z' };
    expect(activityChanged(seen, { link1: '2026-10-19T10:00:00.000Z' })).toBe(false);
  });

  it('notices a single bumped timestamp among many', () => {
    const seen = {
      link1: '2026-10-19T10:00:00.000Z',
      link2: '2026-10-19T10:05:00.000Z',
    };
    expect(
      activityChanged(seen, {
        link1: '2026-10-19T10:00:00.000Z',
        link2: '2026-10-19T10:09:00.000Z',
      }),
    ).toBe(true);
  });

  it('notices a newly appeared link', () => {
    expect(
      activityChanged({ link1: '2026-10-19T10:00:00.000Z' }, {
        link1: '2026-10-19T10:00:00.000Z',
        link2: '2026-10-19T10:10:00.000Z',
      }),
    ).toBe(true);
  });
});

describe('priority', () => {
  it('an open chat outranks an open panel', () => {
    expect(highestPriority('chat', 'panel')).toBe('chat');
    expect(highestPriority('idle', 'panel')).toBe('panel');
  });

  it('folds held priorities down to the highest one', () => {
    expect(priorityFromHeld(['idle', 'panel', 'chat', 'panel'])).toBe('chat');
    expect(priorityFromHeld(['idle', 'idle'])).toBe('idle');
    expect(priorityFromHeld([])).toBe('idle');
  });
});
