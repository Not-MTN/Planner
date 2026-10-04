/**
 * Voice quick add: wraps the Web Speech API with a small, honest surface.
 * Unsupported browsers get `available: false` and the button simply hides —
 * nothing is recorded anywhere else; speech goes through the browser's own
 * speech service, same as any dictation.
 */
import { useEffect, useRef, useState } from 'react';
import { getLang, t } from './i18n';
import { isNativeMobileShell } from './shared/nativeShell';

/**
 * Speech recognition is far more accurate when the engine is told which
 * accent to expect. These are the locales we offer for the listening side;
 * the user picks whichever matches how they actually talk.
 */
export interface SpeechLocale {
  id: string;
  /** BCP-47 tag handed to the recognition engine. */
  tag: string;
  label: string;
}

export const SPEECH_LOCALES: SpeechLocale[] = [
  { id: 'auto', tag: '', get label() { return t("Match my language"); } },
  { id: 'en-US', tag: 'en-US', get label() { return t("English (US)"); } },
  { id: 'en-GB', tag: 'en-GB', get label() { return t("English (UK)"); } },
  { id: 'en-IN', tag: 'en-IN', get label() { return t("English (India)"); } },
  { id: 'en-AU', tag: 'en-AU', get label() { return t("English (Australia)"); } },
  { id: 'en-NG', tag: 'en-NG', get label() { return t("English (Nigeria)"); } },
  { id: 'en-ZA', tag: 'en-ZA', get label() { return t("English (South Africa)"); } },
  { id: 'fi-FI', tag: 'fi-FI', get label() { return t("Finnish (Suomi)"); } },
  { id: 'fa-IR', tag: 'fa-IR', get label() { return t("Persian (فارسی)"); } },
];

const SPEECH_LOCALE_KEY = 'planner-speech-locale';

export function loadSpeechLocaleId(): string {
  try {
    const raw = localStorage.getItem(SPEECH_LOCALE_KEY);
    return raw && SPEECH_LOCALES.some((locale) => locale.id === raw) ? raw : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveSpeechLocaleId(id: string): void {
  try {
    localStorage.setItem(SPEECH_LOCALE_KEY, id);
  } catch {
    /* storage unavailable — recognition falls back to the default */
  }
}

/**
 * The BCP-47 tag the recognizer should listen with. Respects the user's
 * accent choice; "auto" follows the app language (fa or en-US).
 */
export function recognitionLang(localeId = loadSpeechLocaleId()): string {
  const chosen = SPEECH_LOCALES.find((locale) => locale.id === localeId);
  if (chosen && chosen.tag) return chosen.tag;
  const language = getLang();
  return language === 'fa' ? 'fa-IR' : language === 'fi' ? 'fi-FI' : 'en-US';
}

interface SpeechAlternativeLike {
  transcript: string;
  /** Present on final results; higher = the engine is surer about it. */
  confidence?: number;
}

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length?: number;
  0: SpeechAlternativeLike;
  [index: number]: SpeechAlternativeLike | boolean | number | undefined;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorLike {
  error?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  /** Ask the engine for several guesses; we keep the most confident one. */
  maxAlternatives?: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start: () => void;
  stop: () => void;
}

/**
 * Pick the engine's most confident reading of a result. Accented speech often
 * lands in alternative 2 or 3 rather than the first guess, so trusting raw
 * order loses words; confidence order keeps them.
 */
export function bestTranscript(result: SpeechRecognitionResultLike): string {
  const count = typeof result.length === 'number' ? Math.max(1, result.length) : 1;
  let transcript = result[0]?.transcript ?? '';
  let confidence = typeof result[0]?.confidence === 'number' ? result[0].confidence : -1;
  for (let i = 1; i < Math.min(count, 8); i += 1) {
    const alternative = result[i] as SpeechAlternativeLike | undefined;
    if (!alternative || typeof alternative.transcript !== 'string') continue;
    const sure = typeof alternative.confidence === 'number' ? alternative.confidence : -1;
    if (sure > confidence) {
      confidence = sure;
      transcript = alternative.transcript;
    }
  }
  return transcript;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function speechAvailable(): boolean {
  return isNativeMobileShell() || ctor() !== null;
}

/** Honest failure kinds the UI can translate. */
export type SpeechError = 'mic-blocked' | 'network' | 'no-speech' | 'unknown';

export function classifySpeechError(kind: string | undefined): SpeechError {
  const value = (kind ?? '').toLowerCase();
  if (/not-allowed|service-not-allowed|audio-capture|permission|not authorized/.test(value)) return 'mic-blocked';
  if (value.includes('network')) return 'network';
  if (/no-speech|no match|speech timeout/.test(value)) return 'no-speech';
  return 'unknown';
}

export interface SpeechCallbacks {
  onInterim?: (text: string) => void;
  /** Recognition failed (mic permission, offline voice service, …). */
  onError?: (error: SpeechError) => void;
  /**
   * Recognition ended. `heard` is true when any usable text arrived this
   * session — lets the UI settle back to idle when the user stayed silent.
   */
  onEnd?: (heard: boolean) => void;
}

export interface SpeechInput {
  available: boolean;
  listening: boolean;
  /** Start dictation; every recognised sentence is handed to onText. */
  start: (onText: (text: string) => void, callbacks?: SpeechCallbacks | ((text: string) => void)) => void;
  stop: () => void;
}

export function useSpeechInput(): SpeechInput {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const nativeStopRef = useRef<(() => void) | null>(null);
  const available = speechAvailable();

  useEffect(() => {
    return () => {
      nativeStopRef.current?.();
      nativeStopRef.current = null;
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return {
    available,
    listening,
    start: (onText, callbacks) => {
      if (listening || recognitionRef.current || nativeStopRef.current) return;
      // Legacy callers pass the interim handler as the second argument.
      const opts: SpeechCallbacks = typeof callbacks === 'function' ? { onInterim: callbacks } : callbacks ?? {};

      // Android WebViews do not consistently expose Web Speech. The native
      // recognizer requests RECORD_AUDIO only after this user-initiated tap.
      if (isNativeMobileShell()) {
        type NativeRecognizer = typeof import('@capacitor-community/speech-recognition').SpeechRecognition;
        let plugin: NativeRecognizer | null = null;
        let stopped = false;
        let finished = false;
        let heard = false;
        const finish = (error?: SpeechError) => {
          if (finished) return;
          finished = true;
          if (nativeStopRef.current === stopNative) nativeStopRef.current = null;
          setListening(false);
          if (error) opts.onError?.(error);
          else opts.onEnd?.(heard);
        };
        const stopNative = () => {
          if (finished || stopped) return;
          stopped = true;
          setListening(false);
          // stop() lets the platform return its final transcript; it does not
          // discard the words the person just finished saying.
          void plugin?.stop().catch(() => undefined);
        };
        nativeStopRef.current = stopNative;
        setListening(true);
        void (async () => {
          try {
            const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
            plugin = SpeechRecognition;
            if (stopped) {
              finish();
              return;
            }
            const capability = await plugin.available();
            if (!capability.available) {
              finish('unknown');
              return;
            }
            let permission = await plugin.checkPermissions();
            if (permission.speechRecognition !== 'granted') permission = await plugin.requestPermissions();
            if (permission.speechRecognition !== 'granted') {
              finish('mic-blocked');
              return;
            }
            if (stopped) {
              finish();
              return;
            }
            const result = await plugin.start({
              language: recognitionLang(),
              maxResults: 5,
              partialResults: false,
              popup: false,
            });
            const transcript = result.matches?.find((match) => match.trim())?.replace(/\s+/g, ' ').trim();
            if (transcript) {
              heard = true;
              onText(transcript);
            }
            finish();
          } catch (error) {
            // A user-initiated stop can race with the final native callback;
            // it is a quiet end, not a failed microphone session.
            if (stopped) finish();
            else finish(classifySpeechError(error instanceof Error ? error.message : String(error)));
          }
        })();
        return;
      }

      const Ctor = ctor();
      if (!Ctor) return;
      const recognition = new Ctor();
      // The accent the user picked (or the app language default) — matching the
      // engine to the speaker is the single biggest accuracy win.
      recognition.lang = recognitionLang();
      recognition.interimResults = true;
      recognition.continuous = false;
      try {
        recognition.maxAlternatives = 5;
      } catch {
        /* some engines refuse the property — first guess still works */
      }
      let heard = false;
      let errored = false; // onerror precedes onend — don't report the end twice
      recognition.onresult = (event) => {
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) continue;
          if (result.isFinal) final += bestTranscript(result);
          else interim += result[0]?.transcript ?? '';
        }
        if (interim.trim() && opts.onInterim) opts.onInterim(interim.replace(/\s+/g, ' ').trim());
        if (final.trim()) {
          heard = true;
          onText(final.replace(/\s+/g, ' ').trim());
        }
      };
      recognition.onend = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setListening(false);
        if (!errored) opts.onEnd?.(heard);
      };
      recognition.onerror = (event) => {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        errored = true;
        setListening(false);
        opts.onError?.(classifySpeechError(event?.error));
      };
      recognitionRef.current = recognition;
      setListening(true);
      try {
        recognition.start();
      } catch {
        if (recognitionRef.current === recognition) recognitionRef.current = null;
        setListening(false);
        opts.onError?.('unknown');
      }
    },
    stop: () => {
      if (nativeStopRef.current) {
        nativeStopRef.current();
        return;
      }
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
    },
  };
}
