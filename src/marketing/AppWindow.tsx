/**
 * The hero artwork: a framed app window with a living Today view. Tasks tick
 * themselves off on a loop, a floating card shows the change reaching a
 * guardian, and the whole thing drifts with the pointer.
 */
import { useEffect, useState } from 'react';
import { COPY, type Lang } from './copy';
import { digitsIn } from '../i18n';
import { useParallax } from './effects';

const NAV = [
  ['today', 'Today'],
  ['calendar', 'Calendar'],
  ['ai', 'AI Coach'],
  ['plans', 'Plans'],
  ['tasks', 'Tasks'],
  ['habits', 'Habits'],
  ['goals', 'Goals'],
  ['notes', 'Notes'],
  ['insights', 'Insights'],
] as const;

const TASKS: { en: string; fa: string; time: string }[] = [
  { en: 'Math homework', fa: 'تکلیف ریاضی', time: '16:00' },
  { en: 'Chemistry lab notes', fa: 'یادداشت آزمایش شیمی', time: '17:30' },
  { en: 'Read chapter four', fa: 'خواندن فصل چهارم', time: '20:00' },
  { en: 'Water · 6 of 8', fa: 'آب · ۶ از ۸', time: '' },
  { en: 'Call Grandma', fa: 'زنگ به مادربزرگ', time: '19:00' },
];

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

export function AppWindow({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const parallax = useParallax<HTMLDivElement>(1);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setStep(4);
      return;
    }
    const delays = [1600, 1100, 1100, 1500, 2600];
    const timer = window.setTimeout(() => setStep((value) => (value + 1) % 5), delays[step] ?? 1500);
    return () => window.clearTimeout(timer);
  }, [step]);

  const done = Math.min(4, step);

  return (
    <div className="window-wrap" ref={parallax}>
      <div className="window" style={{ transform: 'translate3d(var(--px, 0), var(--py, 0), 0)' }}>
        <div className="window-bar">
          <span className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="window-tab">
            <span className="window-brand">{c.appWinTitle}</span>
            <span className="window-crumb">{c.appWinTab}</span>
          </span>
          <span className="window-search" aria-hidden="true">
            ⌘K
          </span>
        </div>

        <div className="window-body">
          <aside className="window-side">
            <div className="window-me">
              <span className="window-avatar" aria-hidden="true">
                S
              </span>
              <span>
                <b>Sara</b>
                <i>{c.appWinTab}</i>
              </span>
            </div>
            <nav aria-label={c.appWinTitle}>
              {NAV.map(([id, label], index) => (
                <span key={id} className={index === 0 ? 'is-active' : ''}>
                  <em aria-hidden="true" />
                  {label}
                </span>
              ))}
            </nav>
            <div className="window-orb" aria-hidden="true">
              <span />
            </div>
          </aside>

          <div className="window-main">
            <header className="window-head">
              <div>
                <p className="window-date">{lang === 'fa' ? 'پنجشنبه، ۱۲ مارس' : 'Thursday, 12 March'}</p>
                <h3>{lang === 'fa' ? 'یک روز آرام' : 'A quiet day'}</h3>
              </div>
              <svg className="window-ring" viewBox="0 0 70 70" aria-hidden="true">
                <circle className="ring-track" cx="35" cy="35" r={RING_R} />
                <circle
                  className="ring-fill"
                  cx="35"
                  cy="35"
                  r={RING_R}
                  strokeDasharray={RING_C}
                  style={{ strokeDashoffset: RING_C * (1 - done / 5) }}
                />
                <text x="35" y="39">
                  {digitsIn(Math.round((done / 5) * 100), lang)}%
                </text>
              </svg>
            </header>

            <ul className="window-tasks">
              {TASKS.map((task, index) => (
                <li key={task.en} className={step > index ? 'is-done' : ''}>
                  <span className="window-box" aria-hidden="true">
                    <svg viewBox="0 0 16 16">
                      <path d="M3.5 8.5l3 3 6-7" />
                    </svg>
                  </span>
                  <span className="window-task">{lang === 'fa' ? task.fa : task.en}</span>
                  {task.time ? <span className="window-time">{task.time}</span> : null}
                </li>
              ))}
            </ul>

            <div className="window-quick">
              <span className="window-quick-plus" aria-hidden="true">
                +
              </span>
              <span className="window-quick-text">
                {lang === 'fa' ? 'یک کار اضافه کن…' : 'Add a task…'}
                <i className="window-caret" aria-hidden="true" />
              </span>
            </div>
          </div>
        </div>

        <div className={`window-note ${step >= 3 ? 'is-in' : ''}`}>
          <span className="window-note-dot" aria-hidden="true" />
          <span>
            <strong>{c.heroCardTitle}</strong>
            <em>{c.heroCardWhy}</em>
            <small>{c.heroCardMeta}</small>
          </span>
        </div>

        <span className="window-sheen" aria-hidden="true" />
      </div>

      <span className="window-chip window-chip-1" aria-hidden="true">
        {c.heroStat1}
      </span>
      <span className="window-chip window-chip-2" aria-hidden="true">
        {c.heroStat2}
      </span>
      <span className="window-chip window-chip-3" aria-hidden="true">
        {c.heroStat3}
      </span>
    </div>
  );
}
