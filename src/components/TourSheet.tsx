import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { cx } from '../cx';
import { GlobeIcon } from '../icons';
import { getLang, setLang, LANGUAGES, t, type Lang } from '../i18n';
import {
  advanceTour,
  backTour,
  markTourDone,
  TOUR_LENGTH,
  TOUR_SELECTORS,
  TOUR_STOPS,
  writeTourResume,
} from '../tour';

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;

function targetRect(selector: string | null): Rect | null {
  if (!selector) return null;
  const element = document.querySelector(selector);
  if (!element) return null;
  const box = element.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) return null;
  return { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
}

interface StepCopy {
  title: string;
  body: string;
}

/** Copy for the steps that come after the language chooser. */
function stepCopy(id: (typeof TOUR_STOPS)[number]): StepCopy {
  switch (id) {
    case 'quick':
      return {
        title: t("Type like you think"),
        body: t("Everything on Today starts here: “Call mom tomorrow 5pm #work !high” becomes a full task. The little microphone accepts your voice."),
      };
    case 'plan':
      return {
        title: t("One tap plans the day"),
        body: t("“Plan my day” fits your tasks into free time, estimates included. “Plan with AI” drafts a whole week you review before anything lands."),
      };
    case 'timeline':
      return {
        title: t("Your hours, gently held"),
        body: t("Timed things live here, with a moving “now” line. In Calendar → Week you can drag events to re-time them."),
      };
    case 'habits':
      return {
        title: t("Habits with a day off"),
        body: t("Tap to check a habit. The moon gives it a rest day without breaking the streak — and counted habits get a +1 button."),
      };
    case 'mood':
      return {
        title: t("How did today feel?"),
        body: t("One tap every evening. A glowing day fires confetti, and Insights shows the pattern behind your moods."),
      };
    case 'journal':
      return {
        title: t("A few lines stay with the day"),
        body: t("The journal saves itself as you write, becomes the day's note in Notes, and notes link together with [[double brackets]]."),
      };
    case 'done':
      return {
        title: t("That's the whole tour"),
        body: t("⌘K searches everything, ⌘Z takes anything back, and the gear holds sync, feeds, weather, shared lists and backups. Make today a good one."),
      };
    default:
      return { title: '', body: '' };
  }
}

export function TourSheet({ step, onStep, onClose }: { step: number; onStep: (index: number) => void; onClose: () => void }) {
  const stop = TOUR_STOPS[step];
  const [spot, setSpot] = useState<Rect | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const refresh = useCallback(() => {
    setSpot(targetRect(TOUR_SELECTORS[stop]));
  }, [stop]);

  useEffect(() => {
    // Bring the target near the middle, then (re)measure after layout settles.
    const selector = TOUR_SELECTORS[stop];
    if (selector) {
      document.querySelector(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const id1 = window.setTimeout(refresh, 120);
    const id2 = window.setTimeout(refresh, 420);
    window.addEventListener('resize', refresh);
    window.addEventListener('scroll', refresh, true);
    return () => {
      window.clearTimeout(id1);
      window.clearTimeout(id2);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('scroll', refresh, true);
    };
  }, [stop, refresh]);

  useEffect(() => {
    nextRef.current?.focus();
  }, [step]);

  const finish = () => {
    markTourDone();
    onClose();
  };

  const pickLanguage = (lang: Lang) => {
    if (lang === getLang()) {
      onStep(advanceTour(step) ?? TOUR_LENGTH - 1);
      return;
    }
    // Language applies on reload (same pattern as Settings) — the tour resumes.
    writeTourResume(advanceTour(step) ?? 1);
    setLang(lang);
    window.setTimeout(() => window.location.reload(), 40);
  };

  const isLang = stop === 'lang';
  const copy = stepCopy(stop);
  const canBack = step > 1;
  const last = advanceTour(step) === null;

  // Bubble position: to the side on wide screens, above/below on narrow ones.
  const bubbleStyle: CSSProperties = (() => {
    if (!spot) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const margin = 14;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const bubbleWidth = Math.min(350, vw - margin * 2);
    if (vw >= 900 && spot.left > 400) {
      return { top: Math.min(Math.max(spot.top, margin), Math.max(margin, vh - 260)), left: spot.left - bubbleWidth - 20, width: bubbleWidth };
    }
    if (vw >= 900 && spot.left + spot.width + 400 < vw) {
      return { top: Math.min(Math.max(spot.top, margin), Math.max(margin, vh - 260)), left: spot.left + spot.width + 20, width: bubbleWidth };
    }
    const below = spot.top + spot.height + margin + 210 < vh;
    const top = below ? spot.top + spot.height + margin : Math.max(margin, spot.top - 214);
    const left = Math.min(Math.max(margin, spot.left + spot.width / 2 - bubbleWidth / 2), vw - bubbleWidth - margin);
    return { top, left, width: bubbleWidth };
  })();

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
        className="tour-bubble"
        role="dialog"
        aria-modal="true"
        aria-label={isLang ? 'Choose your language' : copy.title}
        style={bubbleStyle}
        data-tour-bubble
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            finish();
          }
        }}
      >
        <div className="tour-top">
          <span className="tour-count">{isLang ? '' : t("Tour {0} of {1}", { 0: step, 1: TOUR_LENGTH - 1 })}</span>
          <button type="button" className="text-btn tour-skip" onClick={finish}>
            {isLang ? 'Skip · رد کن' : t("Skip tour")}
          </button>
        </div>
        {isLang ? (
          <div className="tour-lang">
            <span className="tour-lang-icon"><GlobeIcon size={26} /></span>
            <h2 className="tour-title">Welcome to Planner</h2>
            <p className="tour-body">Pick your language to begin a two-minute tour.<br />زبان خود را انتخاب کنید تا با اپلیکیشن آشنا شوید.</p>
            <div className="tour-lang-row">
              {LANGUAGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={cx('btn', item.id === getLang() ? 'btn-primary' : 'btn-soft', 'tour-lang-btn')}
                  aria-pressed={item.id === getLang()}
                  dir={item.dir}
                  ref={item.id === getLang() ? nextRef : undefined}
                  onClick={() => pickLanguage(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <h2 className="tour-title">{copy.title}</h2>
            <p className="tour-body">{copy.body}</p>
            <div className="tour-nav">
              <span className="tour-dots" aria-hidden="true">
                {TOUR_STOPS.slice(1, -1).map((id, index) => (
                  <i key={id} className={step - 1 === index ? 'on' : ''} />
                ))}
              </span>
              <span className="tour-buttons">
                {canBack ? (
                  <button type="button" className="btn btn-ghost btn-small" onClick={() => onStep(backTour(step))}>
                    {t("Back")}
                  </button>
                ) : null}
                <button
                  type="button"
                  ref={nextRef}
                  className="btn btn-primary btn-small"
                  onClick={() => (last ? finish() : onStep(advanceTour(step) ?? TOUR_LENGTH - 1))}
                >
                  {last ? t("Start planning") : t("Next")}
                </button>
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
