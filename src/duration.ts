/**
 * Hearing how long the user wants planned. "Plan my next two weeks",
 * «سه روز آینده رو برام بچین», "sort out tomorrow" — all become a concrete
 * start date + day count, so the AI plans for exactly as long as asked.
 *
 * Pure and defensive: anything unclear returns null (the caller keeps its
 * default range), and anything enormous is clamped to MAX_PLAN_DAYS.
 */
import { addDays, isValidISODate, todayISO, weekdayIndex } from './dates';

/** Longest stretch the AI will draft in one pass (keeps one request sane). */
export const MAX_PLAN_DAYS = 90;

export interface ParsedDuration {
  startDate: string;
  days: number;
  /** True when the user asked for more than MAX_PLAN_DAYS and we capped it. */
  clamped: boolean;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1,
  two: 2, couple: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const UNIT_DAYS: Record<string, number> = {
  day: 1, days: 1,
  week: 7, weeks: 7, fortnight: 14, fortnights: 14,
  month: 30, months: 30,
  year: 365, years: 365,
};

const EN_WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6,
};

const FA_WEEKDAYS: Record<string, number> = {
  // Longest names first when scanning — "یکشنبه" contains "شنبه".
  'یکشنبه': 0,
  'دوشنبه': 1,
  'سه‌شنبه': 2,
  'سه شنبه': 2,
  'چهارشنبه': 3,
  'پنجشنبه': 4,
  'جمعه': 5,
  'شنبه': 6,
};

/** Persian/Arabic-Indic digits → Latin, so «۱۰ روز آینده» parses like "10 days". */
export function normalizeDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
    .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
}

/**
 * Keyboards and speech engines emit the "same" Persian letter in several
 * shapes: Arabic ي/ك, alef variants, he-with-hamza, tatweel, and the
 * zero-width non-joiner that splits «سه‌شنبه» into half-words. Fold all of
 * them onto plain Persian forms so sloppy input parses like careful input.
 */
export function normalizePersianText(text: string): string {
  return text
    .replace(/[يیٸ]/g, 'ی')
    .replace(/[كک]/g, 'ک')
    .replace(/ٱ/g, 'ا')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[\u064B-\u065F\u0670]/g, '') // harakat diacritics from Arabic keyboards
    .replace(/ـ/g, '') // tatweel
    .replace(/\u200c/g, ' ') // ZWNJ — «پس‌فردا» reads like «پس فردا»
    .replace(/\s+/g, ' ');
}

function toDays(amount: number, unit: string): number | null {
  const per = UNIT_DAYS[unit];
  if (!per || !Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(amount * per);
}

function clampDays(days: number): ParsedDuration['days'] | null {
  if (!Number.isFinite(days) || days < 1) return null;
  return Math.min(MAX_PLAN_DAYS, Math.round(days));
}

function duration(days: number, startDate: string): ParsedDuration | null {
  const capped = clampDays(days);
  if (capped === null || !isValidISODate(startDate)) return null;
  return { startDate, days: capped, clamped: days > MAX_PLAN_DAYS };
}

function parseAmount(raw: string): number | null {
  const word = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (word in WORD_NUMBERS) return WORD_NUMBERS[word];
  if (word === 'few') return 3;
  const digits = Number(raw.replace(/[^\d.]/g, ''));
  return Number.isFinite(digits) && digits > 0 ? digits : null;
}

/** Days from `today` through the next occurrence of `weekday`, inclusive. */
function throughWeekday(today: string, weekday: number): number {
  const delta = (weekday - weekdayIndex(today) + 7) % 7;
  return (delta === 0 ? 7 : delta) + 1;
}

/** Next upcoming Saturday as an ISO date (today counts if it is one). */
function nextSaturday(today: string): string {
  const delta = (6 - weekdayIndex(today) + 7) % 7;
  return addDays(today, delta);
}

/**
 * Find the planning horizon a sentence asks for. Returns null when the text
 * does not clearly name a length — callers then keep their default range.
 */
export function parsePlanDuration(text: string, today = todayISO()): ParsedDuration | null {
  if (typeof text !== 'string' || !isValidISODate(today)) return null;
  let clean = normalizePersianText(normalizeDigits(text.toLowerCase())).trim();
  if (!clean) return null;
  // Exclamations ("what a day!") are not planning requests.
  clean = clean.replace(/\b(?:what|such) (?:a|an)\b/g, '');
  const tomorrow = addDays(today, 1);

  // ── English: explicit lengths ("next 10 days", "for two weeks", "a couple of weeks") ──
  const amountUnit = clean.match(
    /(?:\bfor\b|\bthe next\b|\bnext\b|\bover\b|\babout\b|\baround\b|\broughly\b|\bup to\b|\banother\b|\bplan(?:ning)?(?:\s+(?:my|the|our))?)\s+(?:a\s+)?(\d+|[a-z]+)\s+(?:of\s+|more\s+|extra\s+)?(day|days|week|weeks|fortnight|fortnights|month|months|year|years)\b(?!\s+ago)/,
  );
  if (amountUnit) {
    const amount = parseAmount(amountUnit[1]);
    const days = amount !== null ? toDays(amount, amountUnit[2]) : null;
    if (days !== null) return duration(days, today);
  }
  // Bare number + unit: "plan 14 days", "give me 3 weeks", "a couple of days".
  const bareUnit = clean.match(/\b(\d+|a|an|one|two|couple|three|few)\s+(?:of\s+)?(day|days|week|weeks|fortnight|fortnights|month|months|year|years)\b(?!\s+ago)/);
  if (bareUnit) {
    const amount = parseAmount(bareUnit[1]);
    const days = amount !== null ? toDays(amount, bareUnit[2]) : null;
    if (days !== null) return duration(days, today);
  }

  // ── English: named stretches ──
  if (/\btonight\b|\btoday\b/.test(clean)) return duration(1, today);
  if (/\btomorrow\b/.test(clean)) return duration(1, tomorrow);
  if (/\bthis week\b|\bmy week\b|\bnext week\b|\bthe week\b|\bthis weekend\b|\bnext weekend\b|\bweekend\b/.test(clean)) {
    if (/\bweekend\b/.test(clean)) return duration(2, nextSaturday(today));
    return duration(7, today);
  }
  if (/\bthis month\b|\bnext month\b|\bmy month\b|\bthe month\b|\bmonth ahead\b/.test(clean)) return duration(30, today);
  if (/\bnext year\b|\bthe next year\b|\bthis year\b|\byear ahead\b/.test(clean)) return duration(365, today);

  // ── English: "until / through Friday" ──
  const untilEn = clean.match(/\b(?:until|till|through|up to|to)\s+(?:this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues|tue|wed|thur|thurs|thu|fri|sat)\b/);
  if (untilEn && EN_WEEKDAYS[untilEn[1]] !== undefined) {
    return duration(throughWeekday(today, EN_WEEKDAYS[untilEn[1]]), today);
  }

  // ── Persian: named days ──
  if (/پس\s*فردا/.test(clean)) return duration(1, addDays(today, 2));
  if (/فردا/.test(clean)) return duration(1, tomorrow);
  if (/امروز|امشب/.test(clean)) return duration(1, today);

  // ── Persian: number + unit ("۱۰ روز آینده", "دو هفته بعد", "بیست روز") ──
  // Colloquial forms included ("یه", "پونزده"). Longest words first; the
  // lookbehind keeps a number from matching INSIDE a longer word — «شنبه»
  // ends in «نه» (nine), and «دوشنبه» starts with «دو» (two).
  const faWords: Record<string, number> = {
    'پانزده': 15, 'پونزده': 15, 'چهارده': 14, 'سیزده': 13, 'دوازده': 12, 'یازده': 11,
    'بیست': 20, 'ده': 10, 'هشت': 8, 'هفت': 7, 'شش': 6, 'پنج': 5, 'چهار': 4,
    'سه': 3, 'دو': 2, 'یه': 1, 'یک': 1, 'نه': 9, 'سی': 30,
  };
  const faUnit = clean.match(/(?<![\u0600-\u06FF])(\d+|پانزده|پونزده|چهارده|سیزده|دوازده|یازده|بیست|ده|هشت|هفت|شش|پنج|چهار|سه|دو|یه|یک|نه|سی)\s*(روز|هفته|ماه|سال)/);
  if (faUnit) {
    const amount = faWords[faUnit[1]] ?? Number(faUnit[1]);
    const per = { 'روز': 1, 'هفته': 7, 'ماه': 30, 'سال': 365 }[faUnit[2]];
    if (Number.isFinite(amount) && amount > 0 && per) return duration(amount * per, today);
  }
  // «چند روز آینده» — an unspecified few days.
  const chand = clean.match(/چند\s+(روز|هفته)/);
  if (chand) return duration(chand[1] === 'هفته' ? 14 : 3, today);

  // ── Persian: unit with a future marker ("هفته آینده", "ماه بعد") ──
  const faFuture = clean.match(/(روز|هفته|ماه)\s*(آینده|بعد|دیگه|اینده)/);
  if (faFuture) {
    const per = { 'روز': 1, 'هفته': 7, 'ماه': 30 }[faFuture[1]];
    if (per) return duration(per, faFuture[1] === 'روز' ? tomorrow : today);
  }
  if (/این\s+هفته|همین\s+هفته/.test(clean)) return duration(7, today);
  if (/این\s+ماه|همین\s+ماه/.test(clean)) return duration(30, today);
  if (/آخر\s+هفته/.test(clean)) {
    // Iranian weekend runs Thursday–Friday.
    const friday = nextFriday(today);
    return duration(2, addDays(friday, -1));
  }

  // ── Persian: "تا شنبه" (through a weekday) ──
  const untilFa = clean.match(/(?:تا|الی)\s*(یکشنبه|دوشنبه|سه‌شنبه|سه شنبه|چهارشنبه|پنجشنبه|جمعه|شنبه)/);
  if (untilFa && FA_WEEKDAYS[untilFa[1]] !== undefined) {
    return duration(throughWeekday(today, FA_WEEKDAYS[untilFa[1]]), today);
  }

  // ── Finglish: Persian spoken aloud but transcribed into Latin letters ──
  // ("farda miam", "do hafte kar daram", "hafte dige"). Recognition engines
  // do this whenever they listen to Persian with a non-Persian locale, so
  // hearing it as Persian is part of understanding the speaker.
  if (/\bpas\s*farda\b/.test(clean)) return duration(1, addDays(today, 2));
  if (/\bfarda\b/.test(clean)) return duration(1, tomorrow);
  if (/\bemshab\b|\bemrooz\b/.test(clean)) return duration(1, today);
  const FING_AMOUNTS: Record<string, number> = {
    yek: 1, ye: 1, do: 2, dota: 2, se: 3, seh: 3, char: 4, chahar: 4, panj: 5, ponj: 5,
    shish: 6, shesh: 6, haft: 7, hasht: 8, noh: 9, nah: 9, dah: 10, davazdah: 12, davazde: 12,
    sizdah: 13, sisdah: 13, chardah: 14, chahardah: 14, panzdah: 15, punzdah: 15, bist: 20, si: 30,
  };
  const FING_UNITS: Record<string, number> = {
    rooz: 1, ruz: 1, roz: 1, hafte: 7, hafteh: 7, maah: 30, mah: 30, saal: 365, sal: 365,
  };
  const fingUnit = clean.match(/\b(\d+|[a-z]{2,8})\s*(?:ta\s+)?(rooz|ruz|roz|hafte|hafteh|maah|mah|saal|sal)\b/);
  if (fingUnit) {
    const amount = FING_AMOUNTS[fingUnit[1]] ?? Number(fingUnit[1]);
    const per = FING_UNITS[fingUnit[2]];
    if (Number.isFinite(amount) && amount > 0 && per) return duration(amount * per, today);
  }
  if (/\bchand\s+(rooz|ruz|roz)\b/.test(clean)) return duration(3, today);
  if (/\b(in|hamin)\s+hafte\b/.test(clean)) return duration(7, today);
  if (/\b(in|hamin)\s+mah\b/.test(clean)) return duration(30, today);
  if (/\b(hafte|hafteh)\s*(ye|e)?\s+(ayande|dige|digeh|bad|baad)\b/.test(clean)) return duration(7, today);
  if (/\b(mah|maah)\s*(e)?\s+(ayande|dige|digeh|bad|baad)\b/.test(clean)) return duration(30, today);

  return null;
}

function nextFriday(today: string): string {
  const delta = (5 - weekdayIndex(today) + 7) % 7;
  return addDays(today, delta);
}
