/**
 * Voice AI: a spoken conversation with the planner ("I'm tired — plan my
 * evening" → the AI answers aloud AND drafts the plan). Logic lives here so
 * it stays testable without the speech UI.
 *
 * - STT: the browser's Web Speech service (see speech.ts), nothing recorded here.
 * - Brains: the existing Groq proxy (same as the typed plan builder).
 * - TTS: the browser's speech synthesizer; no audio ever leaves the device.
 */
import {
  DEFAULT_MAX_TOKENS,
  LONG_RANGE_MAX_TOKENS,
  buildPlanningContext,
  draftForModel,
  groqChatJson,
  normalizeDraftPlan,
  type AIProgress,
  type AIDraft,
  type PlanRange,
} from './ai';
import { addDays, todayISO } from './dates';
import { parsePlanDuration } from './duration';
import { getLang, t, type Lang } from './i18n';
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
  /** The horizon the draft was built for — the length the user asked for. */
  range: PlanRange;
}

/**
 * Voice plans default to "the week ahead, starting today". When the user
 * names a length — "plan my next two weeks", «سه روز آینده» — we plan for
 * exactly that long instead, so the AI honors "as long as we say".
 */
export function voiceRange(today = todayISO(), utterance = ''): PlanRange {
  const parsed = utterance ? parsePlanDuration(utterance, today) : null;
  if (parsed) return { startDate: parsed.startDate, days: parsed.days };
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
export function buildVoiceContext(state: PlannerState, today: string, range: PlanRange = { startDate: today, days: 7 }): unknown {
  const lastDate = addDays(range.startDate, Math.max(1, range.days) - 1);
  const pending = state.tasks
    .filter((task) => !task.completed && (task.dueDate === null || (task.dueDate >= range.startDate && task.dueDate <= lastDate)))
    .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || (a.dueTime ?? '99:99').localeCompare(b.dueTime ?? '99:99'))
    .slice(0, 30);
  return {
    today,
    lastDate,
    // Give voice the same real-life guardrails as the typed planner: explicit
    // preferences, goals, daily workload, overdue work and declined ideas.
    ...buildPlanningContext(state, range),
    pendingTaskTitles: pending.map((task) => ({ title: task.title, date: task.dueDate, time: task.dueTime, priority: task.priority })),
    recentMoods: state.moods.slice(-3).map((mood) => ({ date: mood.date, value: mood.value })),
  };
}

/**
 * The "strong ear": instructions that make the model understand tired,
 * casual, imperfect speech instead of needing dictionary-form sentences.
 */
export function voiceSystemPrompt(): string {
  return `You are a warm, practical planning companion having a SPOKEN conversation inside a personal planner. The user is tired and talks the way tired people talk: broken sentences, slang, jokes, approximate times ("evening-ish"), half-finished thoughts, sometimes switching Persian and English inside one sentence. Understand intent, not literal words — never make them repeat, and never demand formal phrasing.

The user may speak with ANY accent, and the transcript you receive is imperfect speech recognition, not careful typing. Expect misheard words, homophones ("for"/"four", "to"/"two"/"too", "won"/"one"), phonetic spellings, run-together words, stray punctuation, and Persian written in English letters (finglish) or vice versa. Read for meaning, silently correct obvious recognition errors, and never point out the accent or the messy wording. If a word is ambiguous, use the surrounding context and the planner data to infer it; only ask when the whole request is truly unclear.

Persian must be understood perfectly, however casually it is spoken. Expect fast colloquial Persian with Tehrani contractions and swallowed endings (میخوام، میخوای، میرم، برم، میشه، نیستش، خسته‌م، حوصلم سر رفته، یه کم، دوتا، هیچی), slang and filler words (مثلاً، یعنی، خلاصه، اصلاً، والا), Afghan/Dari or Tajik-flavored phrasing and vocabulary, Arabic-script typos (ي/ی, ك/ک, ة/ه), half-finished sentences, and Persian typed or transcribed in Latin letters — Finglish — such as "farda miam", "khasteam, ye hafte sabok michazi?", "do hafte kar daram". Treat ALL of that as normal Persian speech: read Finglish as Persian, repair recognition damage silently, and infer the meaning from context instead of giving up. Mixing Persian and English inside one breath is normal — understand both halves. Never ask the user to repeat, rephrase, or speak "properly".

Rules:
1. "reply": plain words meant to be heard out loud, IN THE USER'S LANGUAGE — if they speak Persian or Finglish, answer in warm, natural, conversational Persian (like a caring friend, not a textbook and not formal news-speak); if Finnish, answer in natural, warm Finnish; if English, answer in English; if mixed, follow whichever language dominates — no markdown, no bullet lists, no emojis, at most 60 words. Warm, human, direct, and specific to what they actually said; avoid generic filler. Never say "As requested" or claim that items have already been added: plans are drafts for the user to review. Dates and times inside the reply stay as plain digits.
2. When the user wants anything planned, arranged, moved, or cleared — INCLUDING vague tired asks like "fix tomorrow for me" — include a "draft" built from their context: a realistic, honest plan, never packed, respecting fixed weekly times and existing events. Tasks must have a date inside ${'${range}'}. Use events only when a time is useful. Do not duplicate anything already listed in the context. Honor the LENGTH the user asked for: spread the plan across that whole span, and keep longer spans lighter per day. The context includes live schedule items, the user's saved preferences and goals, daily workload, and saved plans. Treat draft-status saved plans as proposals, not confirmed calendar events. If the requested activity/time conflicts with a named event, class, fixed time, or timed task, tell the user exactly what is already scheduled and ask what to protect or move; leave "draft" null until they answer. Never silently skip the request, overwrite an existing item, or move the existing commitment without explicit permission.
3. If one crucial detail is missing (for example they asked to plan "this week" but the plan genuinely depends on a specific day), do not guess: put a brief acknowledgment in "reply", put ONE short spoken question in "followUp", and leave "draft" null. Do not repeat the follow-up question in "reply"; the app speaks both fields.
4. Keep health ideas gentle and optional; never medical advice. If they sound low, answer kindly first, plan lightly second.
5. "followUp": null or one short question that would genuinely change the plan. "draft": null or a JSON plan object.
6. A draft may already be on screen ("currentDraft", with its range). If the user refers to that plan — revise it, lighten it, tighten it, move things in it, add to it, or take things out — return the FULL revised draft for that same range: keep every item they did not ask to change, apply their change, and update the summary. Only build a brand-new plan when they clearly ask for a different one.

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
    range,
  };
}

const VOICE_TURN_TIMEOUT_MS = 45_000;

/** The draft currently on screen, so voice can revise instead of restart. */
export interface VoiceCurrentDraft {
  draft: AIDraft;
  range: PlanRange;
}

/**
 * One spoken exchange. A hard 45 s ceiling keeps the UI from hanging in
 * "thinking…" forever when the network stalls mid-request.
 *
 * When a draft is already on screen (`currentDraft`), the model can revise it
 * in place: "make Tuesday lighter" edits the plan instead of starting over.
 */
export interface VoiceTurnOptions {
  utterance: string;
  history: VoiceTurn[];
  state: PlannerState;
  currentDraft?: VoiceCurrentDraft | null;
  /** Lets the screen give up on an answer the person has stopped waiting for. */
  signal?: AbortSignal;
  /** Called with the answer as it grows, so the screen can show it has started. */
  onProgress?: AIProgress;
}

export async function voiceTurn(options: VoiceTurnOptions): Promise<VoiceReply> {
  const utterance = options.utterance.replace(/\s+/g, ' ').trim().slice(0, MAX_UTTERANCE_LEN);
  if (!utterance) throw new Error(t("I couldn't hear anything — try again?"));
  const today = todayISO();
  // Range resolution: (1) a length named right now, (2) a length said earlier
  // in this conversation, (3) the draft already on screen (revisions keep
  // their horizon), (4) the week-ahead default.
  const recentUserTurns = [...options.history].reverse().filter((turn) => turn.role === 'user').map((turn) => turn.text);
  let range: PlanRange | null = null;
  for (const said of [utterance, ...recentUserTurns]) {
    const parsed = parsePlanDuration(said, today);
    if (parsed) {
      range = { startDate: parsed.startDate, days: parsed.days };
      break;
    }
  }
  if (!range && options.currentDraft) range = options.currentDraft.range;
  if (!range) range = voiceRange(today);
  const payload = {
    utterance,
    today,
    range: { startDate: range.startDate, endDate: addDays(range.startDate, range.days - 1), days: range.days },
    history: compressHistory(options.history),
    ...(options.currentDraft ? { currentDraft: draftForModel(options.currentDraft.draft) } : {}),
    context: buildVoiceContext(options.state, today, range),
  };
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), VOICE_TURN_TIMEOUT_MS);
  // An outside cancel and our own ceiling are the same thing to the request.
  const onOutsideAbort = () => controller?.abort();
  options.signal?.addEventListener('abort', onOutsideAbort, { once: true });
  try {
    // A spoken "plan my next month" carries a whole draft inside the reply, so
    // the budget has to follow the horizon exactly as the typed builder's does —
    // otherwise the JSON is cut off mid-plan and the turn reads as a failure.
    const raw = await groqChatJson(
      systemForRange(range),
      JSON.stringify(payload),
      controller?.signal,
      range.days > 30 ? LONG_RANGE_MAX_TOKENS : DEFAULT_MAX_TOKENS,
      options.onProgress,
    );
    return normalizeVoiceReply(raw, options.state, range);
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') {
      // Stopped on purpose is not the same as too slow: the person asked.
      throw new Error(options.signal?.aborted ? t("Stopped.") : t("That took too long — try once more?"));
    }
    throw cause;
  } finally {
    options.signal?.removeEventListener('abort', onOutsideAbort);
    clearTimeout(timer);
  }
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
  resume?: () => void;
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

/** The speech tags that can actually speak a language, in order of preference. */
const SPEECH_TAGS: Record<Lang, string[]> = { en: ['en'], fi: ['fi', 'fin'], fa: ['fa', 'pes', 'per'] };

/** Best voice for a language: exact tag first, then base language, then any. */
export function pickVoice(voices: SpeechSynthesisVoiceLike[], lang: Lang): SpeechSynthesisVoiceLike | null {
  if (voices.length === 0) return null;
  const prefer = SPEECH_TAGS[lang];
  const norm = (tag: string) => tag.toLowerCase().replace(/_/g, '-');
  for (const tag of prefer.map(norm)) {
    const exact = voices.find((voice) => norm(voice.lang) === tag);
    if (exact) return exact;
    const partial = voices.find((voice) => norm(voice.lang).startsWith(tag) || norm(voice.lang).startsWith(`${tag}-`));
    if (partial) return partial;
  }
  // Never read one language's words with another language's voice (gibberish):
  // only English falls back to whatever is installed.
  if (lang !== 'en') return null;
  return voices.find((voice) => voice.default) ?? voices[0] ?? null;
}
/**
 * Which language a reply is actually written in. TTS must follow the TEXT,
 * not the app language: a Persian answer to a Persian question needs a
 * Persian voice even when the app UI is English (and vice versa).
 */
export function replyLang(text: string): Lang {
  const rtl = (text.match(/[\u0600-\u06FF]/g) ?? []).length;
  const latin = (text.match(/[a-z]/gi) ?? []).length;
  if (rtl > 0 && rtl >= latin) return 'fa';
  // Finnish replies often contain ä/ö/å; for a short reply with none, follow
  // the app's language rather than sending the text to an English voice.
  if (getLang() === 'fi' || /[äöå]/i.test(text)) return 'fi';
  if (latin === 0) return getLang();
  return 'en';
}

/**
 * Engines occasionally swallow BOTH onend and onerror (iOS Safari after a
 * backgrounded resume, Chrome after cancel). This timer settles the UI no
 * matter what the engine forgets to say.
 */
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let settleFn: (() => void) | null = null;

function clearSettle(): void {
  if (settleTimer !== null) clearTimeout(settleTimer);
  settleTimer = null;
  settleFn = null;
}

/** Speak a short reply aloud. Returns false when speech synthesis can't start. */
export function speakText(text: string, options: { lang?: Lang; onend?: () => void } = {}): boolean {
  const synth = synthesis();
  const clean = text.trim().slice(0, 400);
  if (!synth || !clean) return false;
  try {
    stopSpeaking(); // clears any prior watchdog + stops a stale utterance
    const utteranceLang = options.lang ?? getLang();
    const voices = synth.getVoices();
    const voice = pickVoice(voices, utteranceLang);
    if (utteranceLang !== 'en' && !voice) return false; // no voice for that language — stay silent
    const langTag = voice?.lang ?? (utteranceLang === 'fa' ? 'fa-IR' : utteranceLang === 'fi' ? 'fi-FI' : 'en-US');
    // Defer: some engines fire onend synchronously on a broken queue; the UI
    // must never receive "finished" before it knows it started.
    const finish = () => {
      if (settleFn !== null) {
        const notify = settleFn;
        clearSettle();
        setTimeout(notify, 0);
      }
    };
    settleFn = options.onend ?? null;
    // Watchdog: worst-case speech estimate + generous slack.
    settleTimer = setTimeout(finish, Math.min(20_000, Math.max(4_000, clean.length * 90)));
    const UtteranceCtor = (globalThis as { SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtteranceLike }).SpeechSynthesisUtterance;
    let utterance: SpeechSynthesisUtteranceLike;
    if (UtteranceCtor) {
      // Real engines (especially iOS Safari) only reliably play REAL utterances.
      const real = new UtteranceCtor(clean);
      real.lang = langTag;
      real.rate = 0.98;
      real.pitch = 1;
      if (voice) real.voice = voice;
      real.onend = finish;
      real.onerror = finish;
      utterance = real;
    } else {
      utterance = { text: clean, lang: langTag, rate: 0.98, pitch: 1, voice, onend: finish, onerror: finish };
    }
    synth.resume?.(); // iOS leaves the queue paused after backgrounding
    synth.speak(utterance);
    return true;
  } catch {
    clearSettle();
    return false;
  }
}

export function stopSpeaking(): void {
  clearSettle();
  try {
    synthesis()?.cancel();
  } catch {
    /* engines can throw on a dead queue */
  }
}
