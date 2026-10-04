import { describe, expect, it } from 'vitest';
import { checkBudget, describeSummary, formatBytes, summarise, topFolder } from './report-sizes.mjs';

const MB = 1024 * 1024;

describe('report-sizes', () => {
  it('prints sizes in the unit a human would reach for', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(812)).toBe('812 B');
    expect(formatBytes(1.5 * MB)).toBe('1.50 MB');
    expect(formatBytes(46.3 * MB)).toBe('46.3 MB');
  });

  it('groups files into the folder they sit in, biggest first', () => {
    const { total, rows } = summarise([
      { path: 'index.html', size: 100 },
      { path: 'img/mkt-week.webp', size: 500 },
      { path: 'assets/index-a1b2.js', size: 900 },
      { path: 'img/hero-day.webp', size: 300 },
    ]);
    expect(total).toBe(1800);
    expect(rows).toEqual([
      { folder: 'assets', size: 900 },
      { folder: 'img', size: 800 },
      { folder: '.', size: 100 },
    ]);
  });

  it('reads Windows paths the same way, so the report is identical everywhere', () => {
    expect(topFolder('img\\hero-day.webp')).toBe('img');
    expect(summarise([{ path: 'img\\hero-day.webp', size: 5 }]).rows).toEqual([{ folder: 'img', size: 5 }]);
  });

  it('lays the summary out as a titled table with a total', () => {
    const lines = describeSummary('Payload', [{ path: 'img/a.webp', size: 2 * MB }]);
    expect(lines[0]).toBe('Payload');
    expect(lines[1]).toContain('2.00 MB');
    expect(lines[1]).toContain('img');
    expect(lines.at(-1)).toContain('total');
  });

  it('says so when there is nothing to weigh yet', () => {
    expect(describeSummary('Payload', [])).toEqual(['Payload', '  (nothing built yet)']);
  });

  it('passes a payload that fits the budget and fails one that does not', () => {
    expect(checkBudget(3.9 * MB, 4).ok).toBe(true);
    expect(checkBudget(4.1 * MB, 4).ok).toBe(false);
    expect(checkBudget(4.1 * MB, 4).message).toContain('exceeds');
  });

  it('treats a missing or nonsense budget as no budget at all', () => {
    expect(checkBudget(99 * MB, undefined).ok).toBe(true);
    expect(checkBudget(99 * MB, 0).ok).toBe(true);
  });
});
