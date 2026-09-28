/**
 * Voice quick add: wraps the Web Speech API with a small, honest surface.
 * Unsupported browsers get `available: false` and the button simply hides —
 * nothing is recorded anywhere else; speech goes through the browser's own
 * speech service, same as any dictation.
 */
import { useEffect, useRef, useState } from 'react';
import { getLang } from './i18n';

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
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
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function ctor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function speechAvailable(): boolean {
  return ctor() !== null;
}

/** Honest failure kinds the UI can translate. */
export type SpeechError = 'mic-blocked' | 'network' | 'no-speech' | 'unknown';

export function classifySpeechError(kind: string | undefined): SpeechError {
  const value = (kind ?? '').toLowerCase();
  if (value === 'not-allowed' || value === 'service-not-allowed' || value === 'audio-capture') return 'mic-blocked';
  if (value === 'network') return 'network';
  if (value === 'no-speech') return 'no-speech';
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
  const available = speechAvailable();

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  return {
    available,
    listening,
    start: (onText, callbacks) => {
      const Ctor = ctor();
      if (!Ctor || listening) return;
      // Legacy callers pass the interim handler as the second argument.
      const opts: SpeechCallbacks = typeof callbacks === 'function' ? { onInterim: callbacks } : callbacks ?? {};
      const recognition = new Ctor();
      recognition.lang = getLang() === 'fa' ? 'fa-IR' : 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      let heard = false;
      let errored = false; // onerror precedes onend — don't report the end twice
      recognition.onresult = (event) => {
        let final = '';
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result?.isFinal) final += result[0]?.transcript ?? '';
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
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
    },
  };
}
