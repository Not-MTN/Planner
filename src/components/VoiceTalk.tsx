import { useEffect, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { MicIcon, CloseIcon, VolumeIcon, SparklesIcon } from '../icons';
import { t, getLang } from '../i18n';
import { speakText, stopSpeaking, voiceTurn, type VoiceTurn } from '../voiceai';
import { useSpeechInput } from '../speech';
import type { AIDraft } from '../ai';

/**
 * Voice AI: tap the orb, talk like a tired human, and the AI answers back —
 * out loud when it can — and builds the plan for you from what you said.
 * Draft plans land in the normal review sheet the same way the typed flow does.
 */

type Phase = 'idle' | 'listening' | 'thinking' | 'speaking';

interface Bubble {
  role: 'user' | 'assistant';
  text: string;
}

export function VoiceTalk({ onDraft }: { onDraft: (draft: AIDraft) => void }) {
  const { state } = usePlanner();
  const speech = useSpeechInput();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [interim, setInterim] = useState('');
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  mutedRef.current = muted;

  // voice sessions stay alive only while this card mounts
  useEffect(() => () => {
    speech.stop();
    stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollLog = () => {
    window.setTimeout(() => {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
    }, 40);
  };

  const answer = async (utterance: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setInterim('');
    setPhase('thinking');
    setBubbles((current) => [...current, { role: 'user', text: utterance }]);
    scrollLog();
    try {
      const history: VoiceTurn[] = bubbles.slice(-10).map((bubble) => ({
        role: bubble.role === 'user' ? 'user' : 'assistant',
        text: bubble.text,
      }));
      const result = await voiceTurn({ utterance, history, state });
      const replyText = result.followUp ? `${result.reply} ${result.followUp}` : result.reply;
      setBubbles((current) => [...current, { role: 'assistant', text: replyText }]);
      scrollLog();
      if (result.draft) onDraft(result.draft);
      const spoken = !mutedRef.current && speakText(replyText, {
        lang: getLang(),
        onend: () => setPhase('idle'),
      });
      setPhase(spoken ? 'speaking' : 'idle');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Something snagged — try again?"));
      setPhase('idle');
    } finally {
      busyRef.current = false;
    }
  };

  const talk = () => {
    if (phase === 'listening') {
      speech.stop();
      setPhase('idle');
      return;
    }
    stopSpeaking();
    setError(null);
    speech.start(
      (spoken) => {
        void answer(spoken);
      },
      (live) => setInterim(live),
    );
    setPhase('listening');
  };

  const phaseLabel = (() => {
    if (!speech.available) return t("Voice needs Chrome, Edge or Safari — type below instead");
    if (phase === 'listening') return t("I'm listening — just talk");
    if (phase === 'thinking') return t("Thinking it through…");
    if (phase === 'speaking') return t("Speaking…");
    return t("Tap the mic and just say it");
  })();

  const hints = getLang() === 'fa'
    ? ['فردا روز سنگینیه، نظمش بده', 'خسته‌ام — عصرِ آرومی برام بچین']
    : ['Tomorrow is heavy — sort it out', "I'm wiped — make tonight easy"];

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
            aria-pressed={!muted}
            onClick={() => { setMuted((m) => !m); if (!muted) stopSpeaking(); }}
          >
            <VolumeIcon size={16} />
          </button>
          {bubbles.length > 0 ? (
            <button type="button" className="icon-btn" aria-label={t("Clear conversation")} onClick={() => { setBubbles([]); setInterim(''); stopSpeaking(); }}>
              <CloseIcon size={16} />
            </button>
          ) : null}
        </span>
      </header>

      <div className="voice-log" ref={logRef} aria-live="polite">
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
          bubbles.map((bubble, index) => (
            <p key={index} className={cx('voice-bubble', bubble.role)} dir="auto">
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
        {error ? <p className="voice-error">{error}</p> : null}
      </div>

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
      </div>
    </section>
  );
}
