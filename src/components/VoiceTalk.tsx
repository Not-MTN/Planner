import { useEffect, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { MicIcon, CloseIcon, VolumeIcon, SparklesIcon } from '../icons';
import { t, getLang } from '../i18n';
import { replyLang, speakText, stopSpeaking, voiceRange, voiceTurn, type VoiceCurrentDraft, type VoiceTurn } from '../voiceai';
import { useSpeechInput, type SpeechError } from '../speech';
import { findPromptScheduleConflicts, type AIDraft, type PlanRange, type PromptScheduleConflict } from '../ai';
import { displayTime, formatFullDate, todayISO } from '../dates';

/**
 * Voice AI: tap the orb, talk like a tired human, and the AI answers back —
 * out loud when it can — and builds the plan for you from what you said.
 * Draft plans land in the normal review sheet the same way the typed flow does.
 *
 * Every phase has a way home: speech errors, network stalls and speech engines
 * that never call back all settle the UI instead of leaving it spinning.
 */

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Bubble {
  /** Stable identity: a retry replaces a bubble, and index keys reused the DOM. */
  id: string;
  role: 'user' | 'assistant';
  text: string;
}

let bubbleSeq = 0;
function newBubble(role: Bubble['role'], text: string): Bubble {
  bubbleSeq += 1;
  return { id: `bubble-${bubbleSeq}`, role, text };
}

function speechErrorMessage(error: SpeechError): string {
  if (error === 'mic-blocked') return t("The mic is off — allow the microphone and tap again");
  if (error === 'network') return t("The voice service couldn't be reached — check your connection");
  if (error === 'no-speech') return t("I didn't catch that — say it once more?");
  return t("Something snagged — try again?");
}

export function VoiceTalk({ onDraft, currentDraft = null }: {
  onDraft: (draft: AIDraft, range: PlanRange) => void;
  /** The draft currently in the review card, so voice can revise it in place. */
  currentDraft?: VoiceCurrentDraft | null;
}) {
  const { state } = usePlanner();
  const speech = useSpeechInput();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [interim, setInterim] = useState('');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConflict, setPendingConflict] = useState<{ utterance: string; conflict: PromptScheduleConflict } | null>(null);
  /** True once the answer has started arriving, as opposed to being thought about. */
  const [writing, setWriting] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const lastUtteranceRef = useRef<string | null>(null);
  const thinkingRef = useRef<AbortController | null>(null);
  mutedRef.current = muted;
  phaseRef.current = phase;

  // Voice sessions stay alive only while this card mounts; never set state
  // after leaving the page (the in-flight request resolves anyway).
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      thinkingRef.current?.abort();
      speech.stop();
      stopSpeaking();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const settle = (next: Phase) => {
    if (mountedRef.current) setPhase(next);
  };

  const scrollLog = () => {
    window.setTimeout(() => {
      // scrollTo is absent in some engines/environments (jsdom) — never crash on it.
      const node = logRef.current;
      if (node && typeof node.scrollTo === 'function') {
        node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
      }
    }, 40);
  };

  const answer = async (utterance: string, echo = true, approvedConflict?: PromptScheduleConflict) => {
    if (busyRef.current) return;
    lastUtteranceRef.current = utterance;
    setError(null);
    setInterim('');
    if (!approvedConflict) {
      const range = currentDraft?.range ?? voiceRange(todayISO(), utterance);
      const conflict = findPromptScheduleConflicts(utterance, state, range)[0];
      if (conflict) {
        setPendingConflict({ utterance, conflict });
        const reply = t("There’s a conflict: {0} is already scheduled on {1} from {2} to {3}, so {4} is not free. Should I keep it and find another time?", {
          0: conflict.title,
          1: formatFullDate(conflict.date),
          2: displayTime(conflict.startTime),
          3: displayTime(conflict.endTime),
          4: displayTime(conflict.requestedTime),
        });
        setBubbles((current) => [...current, ...(echo ? [newBubble('user', utterance)] : []), newBubble('assistant', reply)]);
        scrollLog();
        const spoken = !mutedRef.current && speakText(reply, { lang: replyLang(reply), onend: () => settle('idle') });
        setPhase(spoken ? 'speaking' : 'idle');
        return;
      }
    }
    busyRef.current = true;
    setPendingConflict(null);
    setPhase('thinking');
    if (echo) setBubbles((current) => [...current, newBubble('user', utterance)]);
    scrollLog();
    try {
      const history: VoiceTurn[] = bubbles.slice(-10).map((bubble) => ({ role: bubble.role, text: bubble.text }));
      const requestText = approvedConflict
        ? `${utterance}\n\nScheduling decision: Keep the existing ${approvedConflict.title} on ${approvedConflict.date} from ${approvedConflict.startTime} to ${approvedConflict.endTime} protected. Do not move or overlap it; find another genuinely free time for my requested activity and tell me you worked around this conflict.`
        : utterance;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      thinkingRef.current = controller;
      setWriting(false);
      const result = await voiceTurn({
        utterance: requestText,
        history,
        state,
        currentDraft,
        signal: controller?.signal,
        onProgress: () => {
          if (mountedRef.current) setWriting(true);
        },
      });
      if (!mountedRef.current) return;
      const replyText = result.followUp ? `${result.reply} ${result.followUp}` : result.reply;
      setBubbles((current) => [...current, newBubble('assistant', replyText)]);
      scrollLog();
      if (result.draft) onDraft(result.draft, result.range);
      // The voice follows the reply's own language, not the app's: a Persian
      // answer to a Persian question is read by a Persian voice either way.
      const spoken = !mutedRef.current && speakText(replyText, {
        lang: replyLang(replyText),
        onend: () => settle('idle'),
      });
      setPhase(spoken ? 'speaking' : 'idle');
    } catch (cause) {
      const stopped = cause instanceof Error && cause.message === t("Stopped.");
      if (mountedRef.current && !stopped) setError(cause instanceof Error ? cause.message : t("Something snagged — try again?"));
      settle('idle');
    } finally {
      thinkingRef.current = null;
      setWriting(false);
      busyRef.current = false;
    }
  };

  const talk = () => {
    if (phaseRef.current === 'listening') {
      speech.stop();
      settle('idle');
      setInterim('');
      return;
    }
    stopSpeaking();
    setError(null);
    setInterim('');
    setPhase('listening'); // first — an instantly-fired error must settle BACK to idle
    speech.start(
      (spoken) => {
        setInterim('');
        void answer(spoken);
      },
      {
        onInterim: (live) => setInterim(live),
        onError: (kind) => {
          setInterim('');
          setError(speechErrorMessage(kind));
          settle('idle');
        },
        onEnd: (heard) => {
          // Silence without an error: come home quietly, only if still waiting.
          if (!heard && phaseRef.current === 'listening') settle('idle');
          setInterim('');
        },
      },
    );
    try {
      (navigator as { vibrate?: (pattern: number) => boolean }).vibrate?.(8); // a small yes on Android
    } catch {
      /* haptics are a nicety, never a blocker */
    }
  };

  const phaseLabel = (() => {
    if (!speech.available) return t("Voice needs Chrome, Edge or Safari — type below instead");
    if (phase === 'listening') return t("I'm listening — just talk");
    // Once words are arriving it is no longer thinking — it is writing, and
    // saying so is the difference between a wait and a wait that looks stuck.
    if (phase === 'thinking') return writing ? t("Writing…") : t("Thinking it through…");
    if (phase === 'speaking') return t("Speaking…");
    return t("Tap the mic and just say it");
  })();

  const stopWaiting = () => {
    if (phase === 'speaking') stopSpeaking();
    thinkingRef.current?.abort();
    if (phase === 'speaking') settle('idle');
  };

  // Both languages show up either way — saying it in the "other" language
  // works just as well, and the hints make that obvious.
  const hints = getLang() === 'fa'
    ? ['فردا روز سنگینیه، نظمش بده', 'خسته‌ام — عصرِ آرومی برام بچین', 'Two weeks of exams — help me fit it all in']
    : getLang() === 'fi'
      ? ['Huomisesta tulee kiireinen — auta järjestämään se', 'Olen ihan poikki — suunnittele rauhallinen ilta', 'Two weeks of exams — help me fit it all in']
      : ['Tomorrow is heavy — sort it out', "I'm wiped — make tonight easy", 'فردا روز سنگینیه، نظمش بده'];

  return (
    <section className={cx('card voice-card', `voice-${phase}`)} aria-label={t("Talk to the AI")}>
      <header className="card-head">
        <div>
          <p className="kicker">{t("Talk to your planner")}</p>
          <h2 className="card-title">{t("Just say it — I'll sort the rest")}</h2>
          <p className="meta">{t("Casual, tired, mid-sentence — all fine. I'll answer and build the plan.")}</p>
        </div>
        <span className="voice-tools">
          <button
            type="button"
            className={cx('icon-btn', muted && 'off')}
            aria-label={muted ? t("Unmute voice replies") : t("Mute voice replies")}
            aria-pressed={muted}
            onClick={() => { setMuted((m) => !m); if (!muted) stopSpeaking(); }}
          >
            <VolumeIcon size={16} />
          </button>
          {bubbles.length > 0 ? (
            <button type="button" className="icon-btn" aria-label={t("Clear conversation")} onClick={() => { setBubbles([]); setInterim(''); stopSpeaking(); settle('idle'); }}>
              <CloseIcon size={16} />
            </button>
          ) : null}
        </span>
      </header>

      <div className="voice-log" ref={logRef} role="log" aria-live="polite">
        {bubbles.length === 0 ? (
          <div className="voice-empty">
            <span className="voice-empty-orb" aria-hidden="true"><SparklesIcon size={22} /></span>
            <p className="voice-empty-title">{t("Tired? Just talk.")}</p>
            <ul className="voice-hints">
              {hints.map((hint) => (
                <li key={hint}><button type="button" className="chip" onClick={() => void answer(hint)} dir="auto">{hint}</button></li>
              ))}
            </ul>
          </div>
        ) : (
          bubbles.map((bubble) => (
            <p key={bubble.id} className={cx('voice-bubble', bubble.role)} dir="auto">
              {bubble.text}
            </p>
          ))
        )}
        {phase === 'thinking' ? (
          <p className="voice-bubble assistant thinking" aria-hidden="true">
            <i /><i /><i />
          </p>
        ) : null}
        {interim ? <p className="voice-bubble user interim" dir="auto">{interim}<span className="voice-caret" /></p> : null}
        {error ? (
          <p className="voice-error" role="alert">
            <span>{error}</span>
            {lastUtteranceRef.current ? (
              <button type="button" className="voice-retry" onClick={() => void answer(lastUtteranceRef.current!, false)}>
                {t("Try again")}
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
      {pendingConflict ? (
        <div className="voice-schedule-conflict" role="alert">
          <button
            type="button"
            className="btn btn-primary btn-small"
            onClick={() => void answer(pendingConflict.utterance, false, pendingConflict.conflict)}
          >
            {t("Keep {0} and find another time", { 0: pendingConflict.conflict.title })}
          </button>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setPendingConflict(null)}>
            {t("I’ll change my request")}
          </button>
        </div>
      ) : null}

      <div className="voice-controls">
        <button
          type="button"
          className={cx('voice-orb', phase)}
          aria-label={phase === 'listening' ? t("Stop—I'm done") : t("Talk to the AI")}
          aria-pressed={phase === 'listening'}
          disabled={!speech.available || phase === 'thinking'}
          onClick={talk}
        >
          {phase === 'listening' ? (
            <span className="voice-bars" aria-hidden="true"><i /><i /><i /><i /><i /></span>
          ) : phase === 'thinking' ? (
            <span className="voice-spin" aria-hidden="true" />
          ) : (
            <MicIcon size={22} />
          )}
        </button>
        <p className={cx('voice-phase', phase === 'listening' && 'live')}>{phaseLabel}</p>
        {phase === 'thinking' || phase === 'speaking' ? (
          <button type="button" className="btn btn-ghost btn-small voice-stop" onClick={stopWaiting}>
            {t("Stop")}
          </button>
        ) : null}
      </div>
    </section>
  );
}
