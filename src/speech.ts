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

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
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

export interface SpeechInput {
  available: boolean;
  listening: boolean;
  /** Start dictation; every recognised sentence is handed to onText. */
  start: (onText: (text: string) => void) => void;
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
    start: (onText) => {
      const Ctor = ctor();
      if (!Ctor || listening) return;
      const recognition = new Ctor();
      recognition.lang = getLang() === 'fa' ? 'fa-IR' : 'en-US';
      recognition.interimResults = true;
      recognition.continuous = false;
      recognition.onresult = (event) => {
        let text = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (result?.isFinal) text += result[0]?.transcript ?? '';
        }
        if (text.trim()) onText(text.replace(/\s+/g, ' ').trim());
      };
      recognition.onend = () => setListening(false);
      recognition.onerror = () => setListening(false);
      recognitionRef.current = recognition;
      setListening(true);
      try {
        recognition.start();
      } catch {
        setListening(false);
      }
    },
    stop: () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setListening(false);
    },
  };
}
