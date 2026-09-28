import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../cx';
import {
  ArcIcon,
  BookIcon,
  CalendarIcon,
  CommandIcon,
  GlobeIcon,
  HeartIcon,
  HomeIcon,
  HorizonIcon,
  LeafIcon,
  NoteIcon,
  SlidersIcon,
  SparklesIcon,
} from '../icons';
import { LANGUAGES, getLang, setLang, t, type Lang } from '../i18n';
import { requestAbout } from '../about';
import {
  advanceTour,
  backTour,
  markTourDone,
  TOUR_CONTENT_STEPS,
  TOUR_LENGTH,
  TOUR_SELECTORS,
  TOUR_STOPS,
  writeTourResume,
  type TourStopId,
} from '../tour';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const MARGIN = 12;

/** First visible element matching the selector (sidebar vs tabbar duplicates). */
function targetRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const elements = document.querySelectorAll(selector);
  for (const element of Array.from(elements)) {
    const box = element.getBoundingClientRect();
    if (box.width > 2 && box.height > 2) {
      return { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
    }
  }
  return null;
}

const STEP_ICON: Partial<Record<TourStopId, (size?: number) => ReactNode>> = {
  today: (size = 18) => <HomeIcon size={size} />,
  quick: (size = 18) => <SparklesIcon size={size} />,
  plan: (size = 18) => <SparklesIcon size={size} />,
  timeline: (size = 18) => <HorizonIcon size={size} />,
  habits: (size = 18) => <LeafIcon size={size} />,
  mood: (size = 18) => <HeartIcon size={size} />,
  journal: (size = 18) => <NoteIcon size={size} />,
  search: (size = 18) => <CommandIcon size={size} />,
  tabs: (size = 18) => <BookIcon size={size} />,
  calendar: (size = 18) => <CalendarIcon size={size} />,
  insights: (size = 18) => <ArcIcon size={size} />,
  settings: (size = 18) => <SlidersIcon size={size} />,
  done: (size = 18) => <SparklesIcon size={size} />,
};

interface StepCopy {
  title: string;
  body: string;
}

function stepCopy(id: TourStopId): StepCopy {
  switch (id) {
    case 'today':
      return {
        title: t("Your day at a glance"),
        body: t("Today gathers everything: the ring counts events, tasks and habits done, and the tiles add a task, an event or a focus session in one tap. Walk other days with the arrows up top."),
      };
    case 'quick':
      return {
        title: t("Type like you think"),
        body: t("“Call mom tomorrow 5pm #personal !high” becomes a full task — date, time, category, priority. The microphone accepts your voice, great on the go."),
      };
    case 'plan':
      return {
        title: t("One tap plans the day"),
        body: t("“Plan my day” fits untimed and overdue tasks into the free hours, using each task's estimate. “Plan with AI” sketches a whole week you review before anything lands."),
      };
    case 'timeline':
      return {
        title: t("Your hours, gently held"),
        body: t("Timed things live here with a moving “now” line, so you always know where you are. In Calendar → Week you can drag an event to re-time it — and ⌘Z takes any change back."),
      };
    case 'habits':
      return {
        title: t("Habits with a day off"),
        body: t("One tap checks a habit; counted habits get their own +1. The little moon gives the day a rest without breaking your streak — kindness is built in."),
      };
    case 'mood':
      return {
        title: t("How did today feel?"),
        body: t("A single tap each evening is all it asks. A glowing day fires confetti, and Insights quietly shows the pattern behind your days."),
      };
    case 'journal':
      return {
        title: t("A few lines stay with the day"),
        body: t("The journal saves itself while you write and becomes the day's note. Notes can hold tags and [[links]] to each other — a diary that searches itself."),
      };
    case 'search':
      return {
        title: t("Find anything in one place"),
        body: t("⌘K (or /) opens the palette: search tasks, notes and events, jump to any page, or add something without lifting your hands. Everything is a keystroke away."),
      };
    case 'tabs':
      return {
        title: t("Tasks, your way"),
        body: t("Filter by today, upcoming or someday, flip to the board, or tap Select to handle many at once — complete, move or delete in bulk."),
      };
    case 'calendar':
      return {
        title: t("See the whole week"),
        body: t("Week, month and upcoming views, external calendar feeds and the weather. The little load strip shows which days are packed before you commit."),
      };
    case 'insights':
      return {
        title: t("Notice your patterns"),
        body: t("Streaks, weekly bars, the year in pixels and plan-vs-focus. Not to judge you — to help you see what actually works for you."),
      };
    case 'settings':
      return {
        title: t("Your data, your rules"),
        body: t("The gear holds sync between your own devices, shared lists, calendar feeds, weather, imports and backups. From there you can also install Planner for a full offline app."),
      };
    case 'done':
      return {
        title: t("That's the whole tour"),
        body: t("You know the house now: type to add, tap to plan, ⌘K to find, ⌘Z to forgive. Make today a good one."),
      };
    default:
      return { title: '', body: '' };
  }
}

/** Keep focus inside the bubble while the showcase is open (Tab + Escape). */
function trapKeys(event: React.KeyboardEvent, root: HTMLElement | null, onEscape: () => void): void {
  if (event.key === 'Escape') {
    event.stopPropagation();
    onEscape();
    return;
  }
  if (event.key !== 'Tab' || !root) return;
  const focusables = Array.from(root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
    (el) => !el.hasAttribute('disabled') && el.getClientRects().length > 0,
  );
  if (focusables.length === 0) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey && (active === first || !root.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}

export function TourSheet({ step, onStep, onClose }: { step: number; onStep: (index: number) => void; onClose: () => void }) {
  const stop = TOUR_STOPS[step];
  const [spot, setSpot] = useState<Rect | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    setSpot(targetRect(TOUR_SELECTORS[stop]));
  }, [stop]);

  useEffect(() => {
    const selector = TOUR_SELECTORS[stop];
    if (selector) {
      document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // Re-measure as layout settles, on scroll, resize, and iOS visual-viewport shifts.
    let raf = 0;
    const onChange = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(refresh);
    };
    const id1 = window.setTimeout(refresh, 140);
    const id2 = window.setTimeout(refresh, 480);
    const vv = window.visualViewport;
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    vv?.addEventListener('resize', onChange);
    vv?.addEventListener('scroll', onChange);
    return () => {
      window.clearTimeout(id1);
      window.clearTimeout(id2);
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('scroll', onChange, true);
      vv?.removeEventListener('resize', onChange);
      vv?.removeEventListener('scroll', onChange);
    };
  }, [stop, refresh]);

  useEffect(() => {
    // Focus the primary action on every step; keyboard users never leave the bubble.
    const primary = bubbleRef.current?.querySelector<HTMLElement>('[data-tour-primary]');
    primary?.focus();
  }, [step, stop]);

  const finish = () => {
    markTourDone();
    onClose();
  };

  const pickLanguage = (lang: Lang) => {
    if (lang === getLang()) {
      onStep(advanceTour(step) ?? TOUR_LENGTH - 1);
      return;
    }
    // Language applies on reload (same pattern as Settings) — the tour resumes there.
    writeTourResume(advanceTour(step) ?? 1);
    setLang(lang);
    window.setTimeout(() => window.location.reload(), 40);
  };

  const isLang = stop === 'lang';
  const copy = stepCopy(stop);
  const last = advanceTour(step) === null;

  // Bubble placement: beside the spotlight on wide screens, above/below on narrow.
  const bubbleStyle: CSSProperties = (() => {
    if (!spot) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const maxW = Math.min(360, vw - MARGIN * 2);
    const estH = Math.min(300, vh * 0.62);
    if (vw >= 900 && spot.left > maxW + MARGIN * 2) {
      const top = Math.min(Math.max(MARGIN, spot.top), Math.max(MARGIN, vh - estH - MARGIN));
      return { top, left: spot.left - maxW - 22 };
    }
    if (vw >= 900 && vw - (spot.left + spot.width) > maxW + MARGIN * 2) {
      const top = Math.min(Math.max(MARGIN, spot.top), Math.max(MARGIN, vh - estH - MARGIN));
      return { top, left: spot.left + spot.width + 22 };
    }
    const fitsBelow = spot.top + spot.height + MARGIN + estH < vh;
    const top = fitsBelow
      ? spot.top + spot.height + MARGIN
      : Math.max(MARGIN, spot.top - estH - MARGIN);
    const left = Math.min(Math.max(MARGIN, spot.left + spot.width / 2 - maxW / 2), vw - maxW - MARGIN);
    return { top, left };
  })();

  const icon = STEP_ICON[stop]?.(18);

  return (
    <div className="tour" role="presentation" data-tour>
      {spot ? (
        <div
          className="tour-spot"
          style={{ top: spot.top, left: spot.left, width: spot.width, height: spot.height }}
          aria-hidden="true"
        />
      ) : (
        <div className="tour-dim" aria-hidden="true" />
      )}
      <div
        ref={bubbleRef}
        className={cx('tour-bubble', isLang && 'tour-bubble-lang')}
        role="dialog"
        aria-modal="true"
        aria-label={isLang ? 'Choose your language · انتخاب زبان' : copy.title}
        style={bubbleStyle}
        data-tour-bubble
        onKeyDown={(event) => trapKeys(event, bubbleRef.current, finish)}
      >
        {isLang ? (
          <div className="tour-lang">
            <span className="tour-lang-icon" aria-hidden="true"><GlobeIcon size={30} /></span>
            <h2 className="tour-title tour-title-xl">Welcome to Planner</h2>
            <p className="tour-body" dir="auto">
              Pick your language — a short tour walks you through everything.<br />
              <span dir="rtl">زبان خود را انتخاب کنید؛ یک تور کوتاه همه‌چیز را نشانتان می‌دهد.</span>
            </p>
            <div className="tour-lang-row">
              {LANGUAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx('tour-lang-btn', item.id === getLang() && 'on')}
                  aria-pressed={item.id === getLang()}
                  dir={item.dir}
                  data-tour-primary={item.id === getLang() ? '' : undefined}
                  onClick={() => pickLanguage(item.id)}
                >
                  <strong>{item.label}</strong>
                  <span>{item.id === 'en' ? 'Hello!' : 'سلام!'}</span>
                </button>
              ))}
            </div>
            <button type="button" className="text-btn tour-skip" onClick={finish}>
              Skip the tour · رد کردن تور
            </button>
          </div>
        ) : (
          <>
            <div className="tour-top">
              <span className="tour-chip" aria-hidden="true">
                <span className="tour-chip-icon">{icon}</span>
                <span>{t("Tour {0} of {1}", { 0: step, 1: TOUR_CONTENT_STEPS })}</span>
              </span>
              <button type="button" className="text-btn tour-skip" onClick={finish}>
                {t("Skip tour")}
              </button>
            </div>
            <h2 className="tour-title">{copy.title}</h2>
            <p className="tour-body">{copy.body}</p>
            {spot ? <p className="tour-hint">{t("Showcase — the app is paused. Press Next when you're ready.")}</p> : null}
            <div className="tour-nav">
              <span className="tour-dots" aria-hidden="true">
                {TOUR_STOPS.slice(1, -1).map((id, index) => (
                  <i key={id} className={step - 1 === index ? 'on' : step - 1 > index ? 'past' : ''} />
                ))}
              </span>
              <span className="tour-buttons">
                {step > 1 ? (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => onStep(backTour(step))}>
                    {t("Back")}
                  </button>
                ) : null}
                {stop === 'done' ? (
                  <button type="button" className="btn btn-soft btn-small" onClick={() => { finish(); requestAbout(); }}>
                    {t("Why Planner?")}
                  </button>
                ) : null}
                <button
                  type="button"
                  data-tour-primary=""
                  className="btn btn-primary btn-small"
                  onClick={() => (last ? finish() : onStep(advanceTour(step) ?? TOUR_LENGTH - 1))}
                >
                  {stop === 'done' ? t("Start planning") : t("Next")}
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
