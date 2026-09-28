/**
 * Voice AI: a spoken conversation with the planner ("I'm tired — plan my
 * evening" → the AI answers aloud AND drafts the plan). Logic lives here so
 * it stays testable without the speech UI.
 *
 * - STT: the browser's Web Speech service (see speech.ts), nothing recorded here.
 * - Brains: the existing xAI proxy (same as the typed plan builder).
 * - TTS: the browser's speech synthesizer; no audio ever leaves the device.
 */
import { xaiChatJson, normalizeDraftPlan, type AIDraft, type PlanRange } from './ai';
import { addDays, todayISO } from './dates';
import { getLang, t } from './i18n';
import type { PlannerState } from './types';

export interface VoiceTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface VoiceReply {
  /** The spoken-style answer shown to the user (and read aloud). */
  reply: string;
  /** An optional one-line spoken follow-up question. */
  followUp: string | null;
  /** A draft plan the AI built from this conversation, if any. */
  draft: AIDraft | null;
}

/** Voice plans default to "the week ahead, starting today". */
export function voiceRange(today = todayISO()): PlanRange {
  return { startDate: today, days: 7 };
}

// Voice sessions stay small: the model hears the recent conversation only.
export const VOICE_HISTORY_LIMIT = 10;
const MAX_UTTERANCE_LEN = 600;
const MAX_TURN_TEXT = 280;

export function compressHistory(turns: VoiceTurn[]): VoiceTurn[] {
  return turns
    .slice(-VOICE_HISTORY_LIMIT)
    .map((turn) => ({ role: turn.role, text: turn.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TURN_TEXT) }))
    .filter((turn) => turn.text.length > 0);
}

/** Compact, honest context the voice AI needs to plan around. */
export function buildVoiceContext(state: PlannerState, today: string): unknown {
  const lastDate = addDays(today, 6);
  const pending = state.tasks.filter((task) => !task.completed).slice(0, 15);
  const moods = state.moods.slice(-3);
  return {
    today,
    lastDate,
    pendingTaskTitles: pending.map((task) => ({ title: task.title, date: task.dueDate, time: task.dueTime })),
    existingEvents: state.events
      .filter((event) => event.date >= today && event.date <= lastDate)
      .slice(0, 20)
      .map((event) => ({ title: event.title, date: event.date, startTime: event.startTime, endTime: event.endTime })),
    fixedWeeklyTimes: state.fixedCommitments.map((item) => ({ weekday: item.weekday, title: item.title, startTime: item.startTime, endTime: item.endTime })),
    habits: state.habits.filter((habit) => !habit.archived).map((habit) => habit.name),
    recentMoods: moods.map((mood) => ({ date: mood.date, value: mood.value })),
  };
}

/**
 * The "strong ear": instructions that make the model understand tired,
 * casual, imperfect speech instead of needing dictionary-form sentences.
 */
export function voiceSystemPrompt(): string {
  return `You are a warm, practical planning companion having a SPOKEN conversation inside a personal planner. The user is tired and talks the way tired people talk: broken sentences, slang, jokes, approximate times ("evening-ish"), half-finished thoughts, sometimes switching Persian and English inside one sentence. Understand intent, not literal words — never make them repeat, and never demand formal phrasing.

Rules:
1. "reply": plain words meant to be heard out loud — no markdown, no bullet lists, no emojis, at most 60 words. Warm, human, direct. Never say "As requested". Talk like a good friend who plans.
2. When the user wants anything planned, arranged, moved, or cleared — INCLUDING vague tired asks like "fix tomorrow for me" — include a "draft" built from their context: a realistic, honest plan, never packed, respecting fixed weekly times and existing events. Tasks must have a date inside ${'${range}'}. Use events only when a time is useful. Do not duplicate anything already listed in the context.
3. If one crucial thing is missing (for example they asked to plan "this week" but the draft would depend on a specific day), ask ONE short spoken question in "reply", set "followUp" to the same question, and leave "draft" null.
4. Keep health ideas gentle and optional; never medical advice. If they sound low, answer kindly first, plan lightly second.
5. "followUp": null or one short question that would genuinely change the plan. "draft": null or a JSON plan object.

Return ONLY a JSON object: {"reply": "…", "followUp": "…|null", "draft": null | {"summary": "…", "tasks": [{"title": "…", "date": "YYYY-MM-DD", "priority": "low|medium|high", "category": "personal|work|health|learning|home|social", "note": "optional"}], "events": [{"title": "…", "date": "YYYY-MM-DD", "startTime": "HH:MM", "endTime": "HH:MM", "category": "personal|work|health|learning|home|social", "important": false, "note": "optional"}], "habits": [{"name": "…", "frequency": {"type": "daily|weekdays|custom|weekly", "days": [1,2], "times": 3}, "category": "health|personal|learning|home", "icon": "water|book|study|moon|sun|walk|heart|leaf|coffee|pencil|home|stretch|spark"}], "suggestions": ["up to three gentle wellbeing ideas"]}}`;
}

/** Default range built into the system prompt each call. */
function systemForRange(range: PlanRange): string {
  return voiceSystemPrompt().replace('${range}', `the dates ${range.startDate} through ${addDays(range.startDate, range.days - 1)} inclusive`);
}

export function normalizeVoiceReply(rawValue: unknown, state: PlannerState, range: PlanRange): VoiceReply {
  const raw = rawValue && typeof rawValue === 'object' ? (rawValue as Record<string, unknown>) : {};
  const replyText = typeof raw.reply === 'string' ? raw.reply.replace(/\s+/g, ' ').trim() : '';
  const follow = typeof raw.followUp === 'string' ? raw.followUp.replace(/\s+/g, ' ').trim().slice(0, MAX_TURN_TEXT) : '';
  let draft: AIDraft | null = null;
  if (raw.draft && typeof raw.draft === 'object') {
    const normalized = normalizeDraftPlan(raw.draft, state, range);
    const hasContent =
      normalized.tasks.length > 0 || normalized.events.length > 0 || normalized.habits.length > 0;
    draft = hasContent ? normalized : null;
  }
  return {
    reply: replyText || t("Got it. Let me look at that with fresh eyes — say it once more?",
    ),
    followUp: follow || null,
    draft,
  };
}

export async function voiceTurn(options: { utterance: string; history: VoiceTurn[]; state: PlannerState }): Promise<VoiceReply> {
  const utterance = options.utterance.replace(/\s+/g, ' ').trim().slice(0, MAX_UTTERANCE_LEN);
  if (!utterance) throw new Error(t("I couldn't hear anything — try again?"));
  const range = voiceRange();
  const payload = {
    utterance,
    today: todayISO(),
    history: compressHistory(options.history),
    context: buildVoiceContext(options.state, range.startDate),
  };
  const raw = await xaiChatJson(systemForRange(range), JSON.stringify(payload));
  return normalizeVoiceReply(raw, options.state, range);
}

// ── Text to speech ────────────────────────────────────────────────────

interface SpeechSynthesisVoiceLike {
  lang: string;
  name: string;
  default?: boolean;
}

interface SpeechSynthesisLike {
  getVoices: () => SpeechSynthesisVoiceLike[];
  cancel: () => void;
  speak: (utterance: unknown) => void;
}

interface SpeechSynthesisUtteranceLike {
  text: string;
  lang: string;
  rate: number;
  pitch: number;
  voice: SpeechSynthesisVoiceLike | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function synthesis(): SpeechSynthesisLike | null {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return null;
  return window.speechSynthesis as unknown as SpeechSynthesisLike;
}

/** Best voice for a language: exact tag first, then base language, then any. */
export function pickVoice(voices: SpeechSynthesisVoiceLike[], lang: 'en' | 'fa'): SpeechSynthesisVoiceLike | null {
  if (voices.length === 0) return null;
  const prefer = lang === 'fa' ? ['fa', 'pes', 'per'] : ['en'];
  const norm = (tag: string) => tag.toLowerCase().replace(/_/g, '-');
  for (const tag of prefer.map(norm)) {
    const exact = voices.find((voice) => norm(voice.lang) === tag);
    if (exact) return exact;
    const partial = voices.find((voice) => norm(voice.lang).startsWith(tag) || norm(voice.lang).startsWith(`${tag}-`));
    if (partial) return partial;
  }
  // Never read Persian text with an English voice (gibberish): only fall back for English.
  if (lang === 'fa') return null;
  return voices.find((voice) => voice.default) ?? voices[0] ?? null;
}

export function ttsAvailable(): boolean {
  return synthesis() !== null;
}

/** Speak a short reply aloud. Returns false when speech synthesis can't start. */
export function speakText(text: string, options: { lang?: 'en' | 'fa'; onend?: () => void } = {}): boolean {
  const synth = synthesis();
  if (!synth || !text.trim()) return false;
  try {
    synth.cancel();
    const utteranceLang = options.lang ?? getLang();
    const voices = synth.getVoices();
    const voice = pickVoice(voices, utteranceLang);
    if (utteranceLang === 'fa' && !voice) return false; // no Persian voice installed — stay silent
    const utterance: SpeechSynthesisUtteranceLike = {
      text: text.slice(0, 400),
      lang: voice?.lang ?? (utteranceLang === 'fa' ? 'fa-IR' : 'en-US'),
      rate: 0.98,
      pitch: 1,
      voice,
      onend: options.onend ?? null,
      onerror: options.onend ?? null,
    };
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

export function stopSpeaking(): void {
  synthesis()?.cancel();
}
