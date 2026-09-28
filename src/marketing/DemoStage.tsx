/**
 * The hero demo: one student card and one guardian card, with a short looping
 * animation that shows a task being completed on one side and the guardian's
 * week score updating on the other. This is the fastest way to explain a
 * two-sided product without a paragraph of copy.
 */
import { useEffect, useRef, useState } from 'react';
import { COPY, type Lang } from './copy';

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

const TASKS: { en: string; fa: string; time: string }[] = [
  { en: 'Math homework', fa: 'تکلیف ریاضی', time: '16:00' },
  { en: 'Chemistry lab notes', fa: 'یادداشت آزمایش شیمی', time: '17:30' },
  { en: 'Read chapter four', fa: 'خواندن فصل چهارم', time: '20:00' },
  { en: 'Water · 6 glasses', fa: 'آب · ۶ لیوان', time: '' },
];

const SCORES = [42, 58, 72, 78, 78];
const DONE_AT = [1, 2, 3, 4];

/** Pauses the loop while the card is off-screen so it never runs in the background. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, inView };
}

export function DemoStage({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const { ref, inView } = useInView<HTMLDivElement>();
  const [step, setStep] = useState(0);

  useEffect(() => {
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      setStep(4);
      return;
    }
    if (!inView) return;
    const delays = [1400, 1200, 1200, 1600, 2800];
    const timer = window.setTimeout(() => setStep((value) => (value + 1) % 5), delays[step] ?? 1400);
    return () => window.clearTimeout(timer);
  }, [step, inView]);

  const done = DONE_AT.filter((index) => step >= index).length;
  const score = SCORES[step] ?? 78;
  const feedCount = step >= 4 ? 2 : step >= 3 ? 1 : 0;

  return (
    <div className="demo" ref={ref} data-step={step}>
      <div className="demo-card demo-student">
        <div className="demo-head">
          <div>
            <p className="demo-kicker">{c.heroDemoStudent}</p>
            <p className="demo-date">{lang === 'fa' ? 'پنجشنبه، ۱۲ مارس' : 'Thursday, 12 March'}</p>
          </div>
          <span className="demo-live" aria-hidden="true" />
        </div>

        <div className="demo-ringrow">
          <svg className="demo-ring" viewBox="0 0 80 80" role="img" aria-label={`${done} of 4 done`}>
            <circle className="ring-track" cx="40" cy="40" r={RING_R} />
            <circle
              className="ring-fill"
              cx="40"
              cy="40"
              r={RING_R}
              strokeDasharray={RING_C}
              style={{ strokeDashoffset: RING_C * (1 - done / 4) }}
            />
          </svg>
          <div>
            <p className="demo-ringnum">
              {done}/<span>4</span>
            </p>
            <p className="demo-ringlabel">{lang === 'fa' ? 'انجام‌شده امروز' : 'done today'}</p>
          </div>
        </div>

        <ul className="demo-tasks">
          {TASKS.map((task, index) => (
            <li key={task.en} className={step > index ? 'is-done' : ''} style={{ transitionDelay: `${index * 60}ms` }}>
              <span className="demo-box" aria-hidden="true">
                <svg viewBox="0 0 16 16">
                  <path d="M3.5 8.5l3 3 6-7" />
                </svg>
              </span>
              <span className="demo-taskname">{lang === 'fa' ? task.fa : task.en}</span>
              {task.time ? <span className="demo-time">{task.time}</span> : null}
            </li>
          ))}
        </ul>

        <div className="demo-foot">
          <span className={`demo-chip ${step >= 3 ? 'is-on' : ''}`}>
            {lang === 'fa' ? 'حال: خوب' : 'Mood: good'}
          </span>
          <span className="demo-footnote">{lang === 'fa' ? 'بقیه‌اش خصوصی می‌ماند' : 'The rest stays private'}</span>
        </div>
      </div>

      <div className="demo-bridge" aria-hidden="true">
        <span className="demo-bridge-line" />
        <span className="demo-bridge-dot" />
        <span className="demo-bridge-label">{lang === 'fa' ? 'همگام می‌شود' : 'syncs'}</span>
      </div>

      <div className="demo-card demo-guardian">
        <div className="demo-head">
          <div className="demo-who">
            <span className="demo-avatar" aria-hidden="true">
              S
            </span>
            <div>
              <p className="demo-kicker">{c.heroDemoGuardian}</p>
              <p className="demo-date">{lang === 'fa' ? 'والد · دو دانش‌آموز' : 'Parent · two students'}</p>
            </div>
          </div>
        </div>

        <div className="demo-score">
          <p className="demo-scorenum">{score}%</p>
          <span className="demo-delta">{c.guardianHeroDelta}</span>
        </div>

        <svg className="demo-spark" viewBox="0 0 200 44" preserveAspectRatio="none" aria-hidden="true">
          <path className="spark-fill" d="M0 34 L28 30 L56 32 L84 22 L112 24 L140 14 L168 16 L200 6 L200 44 L0 44 Z" />
          <path className="spark-line" d="M0 34 L28 30 L56 32 L84 22 L112 24 L140 14 L168 16 L200 6" />
        </svg>

        <ul className="demo-feed">
          {feedCount > 0 ? (
            <li className="feed-item" key="one">
              <span className="feed-dot" aria-hidden="true" />
              <span className="feed-body">
                <strong>{c.guardianFeed1Title}</strong>
                <em>{c.guardianFeed1Why}</em>
                <small>{c.guardianFeed1Meta}</small>
              </span>
            </li>
          ) : null}
          {feedCount > 1 ? (
            <li className="feed-item" key="two">
              <span className="feed-dot" aria-hidden="true" />
              <span className="feed-body">
                <strong>{c.guardianFeed2Title}</strong>
                <small>{c.guardianFeed2Meta}</small>
              </span>
            </li>
          ) : null}
          {feedCount === 0 ? <li className="feed-empty">{lang === 'fa' ? 'هنوز تغییری نیست' : 'No changes yet'}</li> : null}
        </ul>

        <p className="demo-narrative">{c.guardianNarrative}</p>
      </div>
    </div>
  );
}
