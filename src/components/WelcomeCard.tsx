import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { ESSENTIAL_PRESETS, presetToInput } from '../presets';
import { HabitGlyph, SparklesIcon, TickIcon } from '../icons';
import { t } from '../i18n';

export function WelcomeCard() {
  const { addHabits, flash, undo, loadSample } = usePlanner();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ESSENTIAL_PRESETS.map((preset) => preset.id)));

  const toggle = (id: string) => {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const add = () => {
    const chosen = ESSENTIAL_PRESETS.filter((preset) => picked.has(preset.id));
    if (chosen.length === 0) return;
    addHabits(chosen.map(presetToInput));
    flash(t("{0} daily essentials added.", { 0: chosen.length }), { label: t("Undo"), run: undo });
  };

  return (
    <section className="card welcome-card">
      <img className="welcome-img" src="/img/hero-day.jpg" alt="" loading="lazy" />
      <div className="welcome-body">
        <p className="kicker">{t("Welcome to Planner")}</p>
        <h2 className="welcome-title">{t("Start with the everyday essentials")}</h2>
        <p className="lede">{t("These must-dos will be waiting for you every morning. Add them now — adjust any time.")}</p>
        <div className="preset-grid">
          {ESSENTIAL_PRESETS.map((preset) => {
            const on = picked.has(preset.id);
            return (
              <button
                key={preset.id}
                type="button"
                className={cx('preset-chip', `accent-${preset.accent}`, on && 'on')}
                aria-pressed={on}
                onClick={() => toggle(preset.id)}
              >
                <span className={cx('icon-well', `accent-${preset.accent}`)}>
                  <HabitGlyph name={preset.icon} />
                </span>
                <span className="preset-copy">
                  <strong>{preset.name}</strong>
                  {preset.blurb ? <small>{preset.blurb}</small> : null}
                </span>
                <span className={cx('preset-tick', on && 'on')} aria-hidden="true">
                  {on ? <TickIcon size={12} /> : <span className="preset-plus">+</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div className="welcome-actions">
          <button type="button" className="btn btn-primary" onClick={add} disabled={picked.size === 0}>
            {t("Add")} {picked.size > 0 ? picked.size : ''} {picked.size === 1 ? t('essential') : t('essentials')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={loadSample}>
            <SparklesIcon size={15} /> {t("Explore a sample day")}
          </button>
        </div>
      </div>
    </section>
  );
}
