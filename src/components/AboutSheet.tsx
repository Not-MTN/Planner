import { Modal } from './ui';
import { t } from '../i18n';
import { requestTour } from '../tour';
import { DownloadIcon, GlobeIcon, HeartIcon, HelpIcon, LeafIcon, SparklesIcon, UndoIcon } from '../icons';

/**
 * "Why Planner?" — not a tour, just the honest answer to why this app exists
 * and why someone should choose it. Opened from Settings, the More sheet,
 * or the last step of the tour.
 */
export function AboutSheet({ onClose }: { onClose: () => void }) {
  return (
    <Modal title={t("Why Planner?")} onClose={onClose} className="sheet-about">
      <div className="about">
        <p className="about-lede">
          {t("One quiet place for one wild life. Planner keeps your days, habits, moods and notes together — private by default, calm by design.")}
        </p>
        <div className="about-grid">
          <div className="about-card">
            <span className="about-icon accent-sage"><LeafIcon size={17} /></span>
            <div>
              <strong>{t("Private by design")}</strong>
              <p>{t("Local-first, with no accounts ever. Your data lives on your device, and nowhere you didn't send it.")}</p>
            </div>
          </div>
          <div className="about-card">
            <span className="about-icon accent-peach"><SparklesIcon size={17} /></span>
            <div>
              <strong>{t("One calm place")}</strong>
              <p>{t("Tasks, events, habits, moods and notes on a single quiet page — no ten little apps fighting for your attention.")}</p>
            </div>
          </div>
          <div className="about-card">
            <span className="about-icon accent-lav"><UndoIcon size={17} /></span>
            <div>
              <strong>{t("Forgiving by default")}</strong>
              <p>{t("⌘Z takes anything back, mistakes are just steps, and a rest day never breaks a streak.")}</p>
            </div>
          </div>
          <div className="about-card">
            <span className="about-icon accent-sky"><GlobeIcon size={17} /></span>
            <div>
              <strong>{t("Works everywhere")}</strong>
              <p>{t("Installs on iOS, Android, tablets and desktops, works fully offline, and speaks English, فارسی and suomi.")}</p>
            </div>
          </div>
          <div className="about-card">
            <span className="about-icon accent-sage"><DownloadIcon size={17} /></span>
            <div>
              <strong>{t("Open, and yours")}</strong>
              <p>{t("JSON backups, calendar feeds in and out, optional sync through your own server — your data is never held hostage.")}</p>
            </div>
          </div>
          <div className="about-card">
            <span className="about-icon accent-peach"><HeartIcon size={17} /></span>
            <div>
              <strong>{t("Built for real people")}</strong>
              <p>{t("Voice quick-add, honest time estimates, weather, a focus timer — and a confetti moment when you win the day.")}</p>
            </div>
          </div>
        </div>
        <div className="about-foot">
          <p className="meta">{t("Free to use. Made with care.")}</p>
          <span className="about-actions">
            <button
              type="button"
              className="btn btn-soft btn-small"
              onClick={() => {
                onClose();
                window.setTimeout(requestTour, 60);
              }}
            >
              <HelpIcon size={14} /> {t("See how it works")}
            </button>
            <button type="button" className="btn btn-primary btn-small" data-autofocus onClick={onClose}>
              {t("Done")}
            </button>
          </span>
        </div>
      </div>
    </Modal>
  );
}
