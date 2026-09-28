import { describe, expect, it } from 'vitest';
import { MAX_PLAN_DAYS, normalizeDigits, normalizePersianText, parsePlanDuration } from './duration';

// 2026-09-28 is a Monday.
const today = '2026-09-28';

describe('parsePlanDuration', () => {
  it('hears explicit English lengths', () => {
    expect(parsePlanDuration('Plan my next 10 days', today)).toMatchObject({ startDate: today, days: 10 });
    expect(parsePlanDuration('plan the next two weeks for me', today)).toMatchObject({ startDate: today, days: 14 });
    expect(parsePlanDuration('I need a plan for 3 weeks', today)).toMatchObject({ startDate: today, days: 21 });
    expect(parsePlanDuration('sort out the next month', today)).toMatchObject({ startDate: today, days: 30 });
    expect(parsePlanDuration('plan a couple of weeks', today)).toMatchObject({ startDate: today, days: 14 });
    expect(parsePlanDuration('plan a few days', today)).toMatchObject({ startDate: today, days: 3 });
  });

  it('hears named stretches and single days', () => {
    expect(parsePlanDuration('make tonight easy', today)).toMatchObject({ startDate: today, days: 1 });
    expect(parsePlanDuration('fix tomorrow for me', today)).toMatchObject({ startDate: '2026-09-29', days: 1 });
    expect(parsePlanDuration('plan my week', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('plan next week', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('plan my month', today)).toMatchObject({ startDate: today, days: 30 });
  });

  it('hears "until Friday" as through that day, inclusive', () => {
    // Monday → through Friday 2026-10-02 = Mon..Fri = 5 days.
    expect(parsePlanDuration('plan until friday', today)).toMatchObject({ startDate: today, days: 5 });
    // Same weekday means the NEXT one (a full week + inclusive).
    expect(parsePlanDuration('plan through monday', today)).toMatchObject({ startDate: today, days: 8 });
  });

  it('hears weekend as Saturday + Sunday', () => {
    // From Monday, the next Saturday is 2026-10-03.
    expect(parsePlanDuration('plan the weekend', today)).toMatchObject({ startDate: '2026-10-03', days: 2 });
    // On Saturday itself, the weekend starts today.
    expect(parsePlanDuration('plan the weekend', '2026-10-03')).toMatchObject({ startDate: '2026-10-03', days: 2 });
  });

  it('hears Persian lengths, including Persian digits', () => {
    expect(parsePlanDuration('فردا رو برام درست کن', today)).toMatchObject({ startDate: '2026-09-29', days: 1 });
    expect(parsePlanDuration('برای امروز یه برنامه سبک بچین', today)).toMatchObject({ startDate: today, days: 1 });
    expect(parsePlanDuration('هفته آینده رو برنامه بریز', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('سه روز آینده رو برام بچین', today)).toMatchObject({ startDate: today, days: 3 });
    expect(parsePlanDuration('۱۰ روز آینده برنامه می‌خوام', today)).toMatchObject({ startDate: today, days: 10 });
    expect(parsePlanDuration('دو هفته بعد', today)).toMatchObject({ startDate: today, days: 14 });
    expect(parsePlanDuration('ماه آینده', today)).toMatchObject({ startDate: today, days: 30 });
  });

  it('ignores sentences that do not name a planning length', () => {
    expect(parsePlanDuration('what a day!', today)).toBeNull();
    expect(parsePlanDuration('I finished my plan 3 days ago', today)).toBeNull();
    expect(parsePlanDuration('help me relax', today)).toBeNull();
    expect(parsePlanDuration('', today)).toBeNull();
  });

  it('caps very long requests at the planning horizon and flags them', () => {
    const year = parsePlanDuration('plan the next year', today);
    expect(year).toMatchObject({ startDate: today, days: MAX_PLAN_DAYS, clamped: true });
    expect(MAX_PLAN_DAYS).toBeGreaterThanOrEqual(30);
  });

  it('normalizes Persian and Arabic digits', () => {
    expect(normalizeDigits('۱۰ روز')).toBe('10 روز');
    expect(normalizeDigits('٥ أيام')).toBe('5 أيام');
  });

  it('folds messy Persian script onto plain forms', () => {
    // Arabic-letter variants, he-with-hamza, tatweel and ZWNJ all normalize.
    expect(normalizePersianText('يكشنبه')).toBe('یکشنبه');
    expect(normalizePersianText('كِتاب')).toBe('کتاب');
    expect(normalizePersianText('خانۀ')).toBe('خانه');
    expect(normalizePersianText('آینده أ')).toBe('اینده ا');
    expect(normalizePersianText('سه‌شنبه')).toBe('سه شنبه');
    expect(normalizePersianText('پـس‌فردا')).toBe('پس فردا');
  });

  it('hears casual spoken Persian, however it is typed', () => {
    expect(parsePlanDuration('یه هفته دیگه', today)).toMatchObject({ days: 7 });
    expect(parsePlanDuration('امشب خسته‌ام، یه چیز سبک', today)).toMatchObject({ startDate: today, days: 1 });
    expect(parsePlanDuration('پس‌فردا میام', today)).toMatchObject({ startDate: '2026-09-30', days: 1 });
    expect(parsePlanDuration('بیست روز وقت دارم', today)).toMatchObject({ startDate: today, days: 20 });
    expect(parsePlanDuration('چند هفته مرخصی‌ام', today)).toMatchObject({ startDate: today, days: 14 });
    // Arabic-letter keyboards and ZWNJ keyboards — still understood.
    // Monday → through Sunday = 7 days; through Tuesday = 2 days.
    expect(parsePlanDuration('تا يكشنبه', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('تا سه‌شنبه', today)).toMatchObject({ startDate: today, days: 2 });
    // Weekday names must not be misread as numbers («دوشنبه» starts with «دو»,
    // «شنبه» ends with «نه»).
    expect(parsePlanDuration('دوشنبه هفته بعد', today)).toMatchObject({ startDate: today, days: 7 });
  });

  it('hears Finglish — Persian transcribed into Latin letters', () => {
    expect(parsePlanDuration('farda miam', today)).toMatchObject({ startDate: '2026-09-29', days: 1 });
    expect(parsePlanDuration('pasfarda kar daram', today)).toMatchObject({ startDate: '2026-09-30', days: 1 });
    expect(parsePlanDuration('emshab khasteam', today)).toMatchObject({ startDate: today, days: 1 });
    expect(parsePlanDuration('do hafte kar daram', today)).toMatchObject({ startDate: today, days: 14 });
    expect(parsePlanDuration('ye hafte sabok michazi', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('10 rooz miam', today)).toMatchObject({ startDate: today, days: 10 });
    expect(parsePlanDuration('hafte dige', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('hafteye ayande', today)).toMatchObject({ startDate: today, days: 7 });
    expect(parsePlanDuration('mahe ayande', today)).toMatchObject({ startDate: today, days: 30 });
    expect(parsePlanDuration('in hafte', today)).toMatchObject({ startDate: today, days: 7 });
  });
});
