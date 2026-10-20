import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatInstantTime, localDateFromTimestamp } from './dates';

/**
 * Instants are stored in UTC; people read them where they are.
 *
 * Chat once rendered a message's time by slicing "HH:MM" out of its ISO
 * string — UTC on every device, so a message sent at 00:35 in Tehran read
 * "21:05" and sat under the previous day's heading. These tests pin the
 * replacement to the device's own time zone on both sides of Greenwich.
 * (Node applies a changed TZ to Dates made afterwards, which is what makes
 * the zone stub below mean anything.)
 */
describe('instants are read in the device time zone', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('shows Tehran wall-clock time, not UTC', () => {
    vi.stubEnv('TZ', 'Asia/Tehran'); // UTC+3:30, no daylight saving
    // 21:05 UTC is 00:35 the next day in Tehran.
    expect(formatInstantTime('2026-10-20T21:05:00.000Z')).toBe('00:35');
    expect(localDateFromTimestamp('2026-10-20T21:05:00.000Z')).toBe('2026-10-21');
  });

  it('shows New York wall-clock time, not UTC', () => {
    vi.stubEnv('TZ', 'America/New_York'); // UTC-4 in October
    // 02:05 UTC is still 22:05 the previous evening in New York.
    expect(formatInstantTime('2026-10-20T02:05:00.000Z')).toBe('22:05');
    expect(localDateFromTimestamp('2026-10-20T02:05:00.000Z')).toBe('2026-10-19');
  });

  it('is blank for a timestamp that is not one', () => {
    expect(formatInstantTime('not a date')).toBe('');
    expect(formatInstantTime('')).toBe('');
  });
});
