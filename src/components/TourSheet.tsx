import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { cx } from '../cx';
import {
  ArcIcon,
  BookIcon,
  CalendarIcon,
  CommandIcon,
  FlagIcon,
  GlobeIcon,
  HomeIcon,
  LeafIcon,
  MicIcon,
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

// Finnish remains available in the app settings, but not in the first-run tour.
const TOUR_LANGUAGES = LANGUAGES.filter((item) => item.id !== 'fi');

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
  ai: (size = 18) => <MicIcon size={size} />,
  plans: (size = 18) => <SparklesIcon size={size} />,
  tasks: (size = 18) => <BookIcon size={size} />,
  habits: (size = 18) => <LeafIcon size={size} />,
  goals: (size = 18) => <FlagIcon size={size} />,
  notes: (size = 18) => <NoteIcon size={size} />,
  insights: (size = 18) => <ArcIcon size={size} />,
  calendar: (size = 18) => <CalendarIcon size={size} />,
  search: (size = 18) => <CommandIcon size={size} />,
  settings: (size = 18) => <SlidersIcon size={size} />,
  done: (size = 18) => <SparklesIcon size={size} />,
};

interface StepCopy {
  title: string;
  body: string;
}

/**
 * One headline + the single most useful thing per page. The tour walks the
 * real pages; it teaches a feel for each place, not every button on it.
 */
function stepCopy(id: TourStopId): StepCopy {
  switch (id) {
    case 'today':
      return {
        title: t("Your day, at a glance"),
        body: t("The ring counts what's done and the tiles add things in one tap. Below, the add bar understands plain words — “call mom tomorrow 5pm” — and “Plan my day” fits your tasks into free time automatically. ⌘Z undoes anything."),
      };
    case 'ai':
      return {
        title: t("Talk to your AI coach"),
        body: t("The planner's brain. Tap the glowing mic or just type — any accent, English or فارسی, however casual — and it drafts a plan for as many days as you ask. You review everything before anything lands."),
      };
    case 'plans':
      return {
        title: t("Every draft, kept safe"),
        body: t("All AI plans are saved here automatically. Open one, ask the AI to revise it, and add it whenever you're ready — nothing touches your planner until you press Add."),
      };
    case 'tasks':
      return {
        title: t("All your tasks, your way"),
        body: t("Filter by today, upcoming or someday, flip to the board, or tap Select to complete, move or delete many at once."),
      };
    case 'habits':
      return {
        title: t("Small steps, kept kindly"),
        body: t("One tap checks a habit and streaks grow on their own. The little moon gives any day a rest without breaking your streak."),
      };
    case 'goals':
      return {
        title: t("The bigger picture"),
        body: t("Give each goal a horizon and milestones. Progress is counted for you, and the planner nudges you when a deadline gets close."),
      };
    case 'notes':
      return {
        title: t("Thoughts stay with you"),
        body: t("Notes keep tags, [[links]] to each other, and photos, music or files right inside. Everything stays on this device unless you sync it."),
      };
    case 'insights':
      return {
        title: t("See what actually works"),
        body: t("Streaks, your weekly rhythm, and the year in pixels. Quiet patterns to learn from — never scores to judge you."),
      };
    case 'calendar':
      return {
        title: t("The week, laid out"),
        body: t("Week, month and upcoming views. In Week view you can drag an event to re-time it, and the little load strips show which days are already full."),
      };
    case 'search':
      return {
        title: t("Everything, one keystroke"),
        body: t("⌘K (or /) finds tasks, notes and events, jumps to any page, and adds new things without lifting your hands from the keyboard."),
      };
    case 'settings':
      return {
        title: t("Your data, your rules"),
        body: t("The gear holds sync between your own devices, backups, themes, voice accents, and the AI's Groq connection. You can also install Planner as a full offline app."),
      };
    case 'done':
      return {
        title: t("That's the whole tour"),
        body: t("You know the house now: type to add, talk to plan, ⌘K to find, ⌘Z to forgive. Make today a good one."),
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
    // Re-measure as layout settles, on scroll, resize, and iOS visual-viewport
    // shifts. The later ticks also cover lazy-loaded pages the tour navigates
    // to (AI coach, Calendar…) — their anchors mount a beat after the route.
    let raf = 0;
    const onChange = () => {
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(refresh);
    };
    const id1 = window.setTimeout(refresh, 140);
    const id2 = window.setTimeout(refresh, 480);
    const id3 = window.setTimeout(refresh, 950);
    const id4 = window.setTimeout(refresh, 1400);
    const vv = window.visualViewport;
    window.addEventListener('resize', onChange);
    window.addEventListener('scroll', onChange, true);
    vv?.addEventListener('resize', onChange);
    vv?.addEventListener('scroll', onChange);
    return () => {
      window.clearTimeout(id1);
      window.clearTimeout(id2);
      window.clearTimeout(id3);
      window.clearTimeout(id4);
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
  const currentLang = getLang();
  const primaryTourLanguage = TOUR_LANGUAGES.some((item) => item.id === currentLang)
    ? currentLang
    : TOUR_LANGUAGES[0].id;
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
              {TOUR_LANGUAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx('tour-lang-btn', item.id === currentLang && 'on')}
                  aria-pressed={item.id === currentLang}
                  dir={item.dir}
                  data-tour-primary={item.id === primaryTourLanguage ? '' : undefined}
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
