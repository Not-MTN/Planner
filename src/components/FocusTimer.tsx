import { useEffect, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { CheckIcon, CloseIcon, StopwatchIcon } from '../icons';
import { t } from '../i18n';

const DURATIONS = [15, 25, 45, 60];

type Phase = 'setup' | 'running' | 'paused' | 'done';

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (frequency: number, at: number) => {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      const start = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 1.1);
      oscillator.connect(gain).connect(ctx.destination);
      oscillator.start(start);
      oscillator.stop(start + 1.2);
    };
    play(523.25, 0);
    play(659.25, 0.22);
    play(783.99, 0.44);
    window.setTimeout(() => ctx.close(), 2500);
  } catch {
    // Audio is a nicety; silence is fine.
  }
}

function formatRemaining(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function FocusTimer() {
  const { focus } = usePlanner();
  if (!focus) return null;
  return <FocusOverlay key={`${focus.taskId ?? 'free'}-${focus.title}`} sessionId={focus.taskId} title={focus.title} initialMinutes={focus.minutes} />;
}

function FocusOverlay({ sessionId, title, initialMinutes }: { sessionId: string | null; title: string; initialMinutes: number }) {
  const { state, stopFocus, toggleTask, flash, celebrate, undo, logFocus } = usePlanner();
  const [phase, setPhase] = useState<Phase>('setup');
  const [mode, setMode] = useState<'focus' | 'break'>('focus');
  const [rounds, setRounds] = useState(0);
  const loggedRef = useRef(false);
  const [minutes, setMinutes] = useState(initialMinutes);
  const [remaining, setRemaining] = useState(initialMinutes * 60);
  const [total, setTotal] = useState(initialMinutes * 60);
  const endRef = useRef(0);
  const titleRef = useRef(document.title);

  const task = sessionId ? state.tasks.find((item) => item.id === sessionId) : undefined;

  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => {
      const left = Math.max(0, Math.round((endRef.current - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        setPhase('done');
        chime();
        if (mode === 'focus') {
          celebrate();
          if (!loggedRef.current) {
            loggedRef.current = true;
            logFocus({ taskId: sessionId, title: task?.title ?? title, minutes: Math.round(total / 60) });
            setRounds((count) => count + 1);
          }
        }
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [phase, celebrate, mode, logFocus, sessionId, task?.title, title, total]);

  /** Ending early still counts the minutes you actually focused. */
  const end = () => {
    if (mode === 'focus' && (phase === 'running' || phase === 'paused') && !loggedRef.current) {
      const spent = Math.floor((total - remaining) / 60);
      if (spent >= 1) {
        logFocus({ taskId: sessionId, title: task?.title ?? title, minutes: spent });
        flash(t("{0} focused {1} saved to Insights.", { 0: spent, 1: spent === 1 ? t("minute") : t("minutes") }));
      }
    }
    stopFocus();
  };

  const startBreak = () => {
    const long = rounds > 0 && rounds % 4 === 0;
    const seconds = (long ? 15 : 5) * 60;
    setMode('break');
    setTotal(seconds);
    setRemaining(seconds);
    endRef.current = Date.now() + seconds * 1000;
    setPhase('running');
  };

  useEffect(() => {
    if (phase === 'running' || phase === 'paused') {
      document.title = t("{0} · Focus — Planner", { 0: formatRemaining(remaining) });
    } else if (phase === 'setup') {
      document.title = titleRef.current;
    }
    return () => {
      document.title = titleRef.current;
    };
  }, [phase, remaining]);

  const start = () => {
    const seconds = minutes * 60;
    setMode('focus');
    loggedRef.current = false;
    setTotal(seconds);
    setRemaining(seconds);
    endRef.current = Date.now() + seconds * 1000;
    setPhase('running');
  };

  const pause = () => setPhase('paused');
  const resume = () => {
    endRef.current = Date.now() + remaining * 1000;
    setPhase('running');
  };

  const extend = () => {
    if (phase === 'setup') {
      setMinutes((current) => Math.min(180, current + 5));
      return;
    }
    endRef.current += 5 * 60000;
    setTotal((current) => current + 300);
    setRemaining((current) => current + 300);
  };

  const again = () => {
    setMode('focus');
    setPhase('setup');
    setRemaining(minutes * 60);
  };

  const completeTask = () => {
    if (!sessionId) return;
    toggleTask(sessionId);
    flash(t("Task completed. Lovely."), { label: t("Undo"), run: undo });
    stopFocus();
  };

  const ratio = total > 0 ? Math.max(0, Math.min(1, 1 - remaining / total)) : 0;
  const radius = 120;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - ratio);

  return (
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label={t("Focus session")}>
      <div className="focus-card">
        <button type="button" className="icon-btn focus-close" aria-label={t("End focus session")} onClick={end}>
          <CloseIcon size={18} />
        </button>
        <p className="kicker">
          {mode === 'break' ? (phase === 'done' ? t("Break over") : t("Break")) : phase === 'done' ? t("Session complete") : t("Focus")}
          {rounds > 0 ? t(" · round {0}{1}", { 0: rounds, 1: mode === 'focus' && phase !== 'done' ? t(" → {0}", { 0: rounds + 1 }) : '' }) : ''}
        </p>
        <div className="focus-ring-wrap">
          <svg className="focus-ring" viewBox="0 0 280 280" aria-hidden="true">
            <circle className="focus-ring-track" cx="140" cy="140" r={radius} />
            <circle
              className={cx('focus-ring-value', phase === 'done' && 'is-done')}
              cx="140"
              cy="140"
              r={radius}
              strokeDasharray={circumference}
              strokeDashoffset={phase === 'done' ? 0 : offset}
            />
          </svg>
          <div className="focus-ring-copy">
            {phase === 'setup' ? (
              <>
                <strong>{minutes}</strong>
                <span>{t('minutes')}</span>
              </>
            ) : phase === 'done' ? (
              <>
                <CheckIcon size={44} />
                <span>{mode === 'break' ? t("ready?") : t("done")}</span>
              </>
            ) : (
              <>
                <strong>{formatRemaining(remaining)}</strong>
                <span>{phase === 'paused' ? t("paused") : mode === 'break' ? t("breathe · stretch") : t("keep going")}</span>
              </>
            )}
          </div>
        </div>
        <h2 className="focus-title">{task ? task.title : title}</h2>
        {task?.completed ? <p className="meta">{t("This task is already done.")}</p> : null}

        {phase === 'setup' ? (
          <>
            <div className="focus-durations" role="radiogroup" aria-label={t("Session length")}>
              {DURATIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={minutes === option}
                  className={cx('day-pill-btn', minutes === option && 'on')}
                  onClick={() => setMinutes(option)}
                >
                  {option} {t('min')}
                </button>
              ))}
            </div>
            <div className="focus-actions">
              <button type="button" className="btn btn-ghost" onClick={stopFocus}>{t("Cancel")}</button>
              <button type="button" className="btn btn-primary" onClick={start}>
                <StopwatchIcon size={16} /> {t("Start focusing")}
              </button>
            </div>
          </>
        ) : phase === 'running' ? (
          <div className="focus-actions">
            <button type="button" className="btn btn-soft" onClick={extend}>{t("+5 min")}</button>
            <button type="button" className="btn btn-ghost" onClick={pause}>{t("Pause")}</button>
            <button type="button" className="btn btn-danger" onClick={end}>{t("End")}</button>
          </div>
        ) : phase === 'paused' ? (
          <div className="focus-actions">
            <button type="button" className="btn btn-soft" onClick={extend}>{t("+5 min")}</button>
            <button type="button" className="btn btn-primary" onClick={resume}>{t("Resume")}</button>
            <button type="button" className="btn btn-danger" onClick={end}>{t("End")}</button>
          </div>
        ) : mode === 'break' ? (
          <div className="focus-actions">
            <button type="button" className="btn btn-primary" onClick={start}>
              <StopwatchIcon size={16} /> {t("Next round ·")} {minutes} {t('min')}
            </button>
            <button type="button" className="btn btn-ghost" onClick={stopFocus}>{t("Close")}</button>
          </div>
        ) : (
          <div className="focus-actions">
            <button type="button" className="btn btn-soft" onClick={startBreak}>
              {rounds > 0 && rounds % 4 === 0 ? t("Long break · 15 min") : t("Break · 5 min")}
            </button>
            {sessionId && !task?.completed ? (
              <button type="button" className="btn btn-primary" onClick={completeTask}>
                <CheckIcon size={16} /> {t("Complete task")}
              </button>
            ) : null}
            <button type="button" className="btn btn-soft" onClick={again}>{t("Another round")}</button>
            <button type="button" className="btn btn-ghost" onClick={stopFocus}>{t("Close")}</button>
          </div>
        )}
        <p className="focus-hint">{t("The timer keeps this tab awake — close anytime, no pressure.")}</p>
      </div>
    </div>
  );
}
