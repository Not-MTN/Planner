import { useState } from 'react';
import { COPY, type Lang } from './copy';
import { DemoStage } from './DemoStage';
import { AppWindow } from './AppWindow';
import { AiProposal, DashboardBuild, Quotes, RetentionSlider, RoleSwitcher, Stats, VisibilityMatrix } from './Showcase';
import { pointerLeave, pointerMove } from './effects';

type Nav = (to: string) => void;

const SPOT = {
  onMouseMove: (event: React.MouseEvent<HTMLElement>) => pointerMove(event, { tilt: 2 }),
  onMouseLeave: pointerLeave,
};

const CHART_NOTES: { key: 'chart1' | 'chart2' | 'chart3' | 'chart4' | 'chart5' | 'chart6'; kind: string }[] = [
  { key: 'chart1', kind: 'spark' },
  { key: 'chart2', kind: 'mood' },
  { key: 'chart3', kind: 'rhythm' },
  { key: 'chart4', kind: 'grid' },
  { key: 'chart5', kind: 'compare' },
  { key: 'chart6', kind: 'donut' },
];

const DAYS = [34, 52, 41, 68, 55, 72, 78];
const HOURS = [2, 1, 0, 0, 4, 9, 14, 11, 6, 8, 12, 7, 3, 5, 10, 16, 13, 9, 6, 4, 3, 2, 1, 1];
const LOAD = [3, 5, 4, 8, 6, 9, 7];
const MOOD = [4, 3, 4, 2, 3, 2, 3];

function TinyChart({ kind }: { kind: string }) {
  if (kind === 'spark') {
    const points = DAYS.map((value, index) => `${index * 32},${44 - value * 0.4}`).join(' L ');
    return (
      <svg className="tiny" viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
        <path className="tiny-line" d={`M ${points}`} />
      </svg>
    );
  }
  if (kind === 'mood') {
    return (
      <svg className="tiny" viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
        {LOAD.map((value, index) => (
          <rect key={`l${index}`} className="tiny-bar load" x={index * 27 + 2} y={48 - value * 4} width="11" height={value * 4} />
        ))}
        {MOOD.map((value, index) => (
          <circle key={`m${index}`} className="tiny-dot" cx={index * 27 + 18} cy={48 - value * 8} r="3" />
        ))}
      </svg>
    );
  }
  if (kind === 'rhythm') {
    return (
      <div className="tiny-rhythm" aria-hidden="true">
        {HOURS.map((value, index) => (
          <span key={index} style={{ opacity: 0.12 + (value / 16) * 0.88, animationDelay: `${index * 22}ms` }} />
        ))}
      </div>
    );
  }
  if (kind === 'grid') {
    return (
      <div className="tiny-grid" aria-hidden="true">
        {Array.from({ length: 35 }, (_, index) => (
          <span
            key={index}
            className={index % 7 === 3 && index > 14 ? 'is-rest' : index % 5 === 0 ? 'is-off' : 'is-on'}
            style={{ animationDelay: `${index * 12}ms` }}
          />
        ))}
      </div>
    );
  }
  if (kind === 'compare') {
    return (
      <svg className="tiny" viewBox="0 0 200 48" preserveAspectRatio="none" aria-hidden="true">
        {LOAD.map((value, index) => (
          <g key={index}>
            <rect className="tiny-bar plan" x={index * 27 + 2} y={48 - value * 4.6} width="10" height={value * 4.6} />
            <rect className="tiny-bar real" x={index * 27 + 14} y={48 - value * 3} width="10" height={value * 3} />
          </g>
        ))}
      </svg>
    );
  }
  return (
    <svg className="tiny donut" viewBox="0 0 80 80" aria-hidden="true">
      <circle className="donut-seg study" cx="40" cy="40" r="30" strokeDasharray="118 188" />
      <circle className="donut-seg rest" cx="40" cy="40" r="30" strokeDasharray="56 188" strokeDashoffset="-118" />
      <circle className="donut-seg home" cx="40" cy="40" r="30" strokeDasharray="34 188" strokeDashoffset="-174" />
    </svg>
  );
}

export function Landing({ lang, navigate }: { lang: Lang; navigate: Nav }) {
  const c = COPY[lang];
  const [open, setOpen] = useState<number | null>(0);
  const faqs = [
    [c.faq1q, c.faq1a],
    [c.faq2q, c.faq2a],
    [c.faq3q, c.faq3a],
    [c.faq4q, c.faq4a],
    [c.faq5q, c.faq5a],
  ];
  const strip = [c.strip1, c.strip2, c.strip3, c.strip4, c.strip5];

  return (
    <main className="mkt-main">
      {/* ------------------------------- hero ------------------------------- */}
      <section className="hero">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-grain" aria-hidden="true" />
        <div className="wrap hero-inner">
          <p className="pill reveal" data-reveal>
            <span className="pill-dot" aria-hidden="true" />
            {c.heroBadge}
          </p>
          <h1 className="hero-title reveal" data-reveal style={{ transitionDelay: '70ms' }}>
            {c.heroTitleLead} <span className="grad-text">{c.heroTitleAccent}</span>
          </h1>
          <p className="hero-sub reveal" data-reveal style={{ transitionDelay: '140ms' }}>
            {c.heroSub}
          </p>
          <div className="hero-actions reveal" data-reveal style={{ transitionDelay: '210ms' }}>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/signup')}>
              {c.heroCta}
            </button>
            <a className="btn btn-ghost btn-lg" href="#how">
              {c.heroCta2}
            </a>
          </div>
          <ul className="hero-trust reveal" data-reveal style={{ transitionDelay: '280ms' }}>
            {[c.trustEncrypted, c.trustOffline, c.trustAds].map((item) => (
              <li key={item}>
                <span aria-hidden="true">✓</span> {item}
              </li>
            ))}
          </ul>
          <div className="reveal" data-reveal style={{ transitionDelay: '360ms' }}>
            <AppWindow lang={lang} />
            <p className="hero-note">{c.heroNote}</p>
          </div>
        </div>
      </section>

      {/* ------------------------------ marquee ----------------------------- */}
      <div className="strip" aria-hidden="true">
        <div className="strip-track">
          {[0, 1].map((copy) => (
            <div className="strip-group" key={copy}>
              {strip.map((item) => (
                <span key={item}>
                  <i />
                  {item}
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* --------------------- two sides, one loop -------------------------- */}
      <section className="section" id="how">
        <div className="wrap">
          <header className="section-head center reveal" data-reveal>
            <p className="kicker">{c.stepsKicker}</p>
            <h2>{lang === 'fa' ? 'دو طرف، یک هفته' : 'Two sides, one week'}</h2>
            <p className="lede">{c.heroSub}</p>
          </header>
          <DemoStage lang={lang} />
        </div>
      </section>

      {/* ------------------------------- steps ------------------------------ */}
      <section className="section section-tint">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.stepsKicker}</p>
            <h2>{c.stepsTitle}</h2>
            <p className="lede">{c.stepsSub}</p>
          </header>
          <ol className="steps">
            {[c.step1T, c.step2T, c.step3T].map((title, index) => (
              <li
                key={title}
                className="step spot reveal"
                data-reveal
                style={{ transitionDelay: `${index * 110}ms` }}
                {...SPOT}
              >
                <span className="step-num">{index + 1}</span>
                <h3>{title}</h3>
                <p>{[c.step1D, c.step2D, c.step3D][index]}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------ roles ------------------------------- */}
      <section className="section" id="roles">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.switcherKicker}</p>
            <h2>{c.switcherTitle}</h2>
            <p className="lede">{c.switcherSub}</p>
          </header>
          <RoleSwitcher lang={lang} />
        </div>
      </section>

      {/* ---------------------------- linking ------------------------------- */}
      <section className="section section-tint" id="linking">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.linkKicker}</p>
            <h2>{c.linkTitle}</h2>
            <p className="lede">{c.linkSub}</p>
          </header>

          <div className="link-layout">
            <ol className="link-rail">
              {[
                { t: c.link1T, d: c.link1D },
                { t: c.link2T, d: c.link2D },
                { t: c.link3T, d: c.link3D },
                { t: c.link4T, d: c.link4D },
              ].map((step, index) => (
                <li key={step.t} className="reveal" data-reveal style={{ transitionDelay: `${index * 90}ms` }}>
                  <span className="link-num">{index + 1}</span>
                  <div>
                    <h3>{step.t}</h3>
                    <p>{step.d}</p>
                  </div>
                </li>
              ))}
            </ol>

            <figure className="link-art reveal" data-reveal {...SPOT}>
              <img src="/img/auth-link.jpg" alt="" width="900" height="600" loading="lazy" decoding="async" />
              <figcaption>{c.linkNote}</figcaption>
            </figure>
          </div>

          <div className="link-extra reveal" data-reveal>
            <h3>{c.linkGuardianT}</h3>
            <p>{c.linkGuardianD}</p>
          </div>
        </div>
      </section>

      {/* ------------------------------ matrix ------------------------------ */}
      <section className="section section-tint">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.matrixKicker}</p>
            <h2>{c.matrixTitle}</h2>
            <p className="lede">{c.matrixSub}</p>
          </header>
          <VisibilityMatrix lang={lang} />
        </div>
      </section>

      {/* ----------------------------- guardian ----------------------------- */}
      <section className="section" id="guardians">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.dashKicker}</p>
            <h2>{c.dashTitle}</h2>
          </header>
          <DashboardBuild lang={lang} />
        </div>

        <div className="wrap">
          <div className="charts">
            {CHART_NOTES.map(({ key, kind }, index) => (
              <article
                key={key}
                className="chart spot reveal"
                data-reveal
                style={{ transitionDelay: `${index * 70}ms` }}
                {...SPOT}
              >
                <TinyChart kind={kind} />
                <h3>{c[key]}</h3>
                <p>{c[`${key}d` as keyof typeof c]}</p>
              </article>
            ))}
          </div>

          <div className="feed-card reveal" data-reveal>
            <p className="feed-title">{c.guardianFeed}</p>
            <ul>
              <li>
                <span className="feed-dot" aria-hidden="true" />
                <span className="feed-body">
                  <strong>{c.guardianFeed1Title}</strong>
                  <em>{c.guardianFeed1Why}</em>
                  <small>{c.guardianFeed1Meta}</small>
                </span>
              </li>
              <li>
                <span className="feed-dot" aria-hidden="true" />
                <span className="feed-body">
                  <strong>{c.guardianFeed3Title}</strong>
                  <em>{c.guardianFeed3Why}</em>
                  <small>{c.guardianFeed3Meta}</small>
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ------------------------------ student ----------------------------- */}
      <section className="section section-tint">
        <div className="wrap split">
          <div className="split-copy reveal" data-reveal>
            <p className="kicker">{c.studentKicker}</p>
            <h2>{c.studentTitle}</h2>
            <p className="lede">{c.studentSub}</p>
            <ul className="ticks">
              <li>{c.studentL1}</li>
              <li>{c.studentL2}</li>
              <li>{c.studentL3}</li>
              <li>{c.studentL4}</li>
            </ul>
          </div>
          <div className="split-art reveal" data-reveal style={{ transitionDelay: '140ms' }}>
            <div className="phone">
              <p className="phone-head">{c.heroDemoStudent}</p>
              <div className="phone-row">
                <span className="phone-box is-done" aria-hidden="true" />
                <span>{lang === 'fa' ? 'تکلیف ریاضی' : 'Math homework'}</span>
              </div>
              <div className="phone-row">
                <span className="phone-box" aria-hidden="true" />
                <span>{lang === 'fa' ? 'خواندن فصل چهارم' : 'Read chapter four'}</span>
              </div>
              <div className="phone-row is-private">
                <span className="phone-box" aria-hidden="true" />
                <span>{lang === 'fa' ? 'یادداشت شخصی' : 'A note just for me'}</span>
                <span className="private-pill">{c.studentPrivate}</span>
              </div>
              <button type="button" className="phone-cta">
                {lang === 'fa' ? 'امروز زیاد است' : 'This is too much today'}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------- AI -------------------------------- */}
      <section className="section" id="ai">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.aiKicker}</p>
            <h2>{c.aiTitle}</h2>
            <p className="lede">{c.aiSub}</p>
          </header>
          <div className="ai-grid">
            <article className="ai-card spot reveal" data-reveal {...SPOT}>
              <span className="ai-badge">{c.aiStudentT}</span>
              <p>{c.aiStudentD}</p>
            </article>
            <AiProposal lang={lang} />
          </div>
          <p className="ai-rule reveal" data-reveal>
            {c.aiRule}
          </p>
        </div>
      </section>

      {/* ------------------------------ privacy ----------------------------- */}
      <section className="section section-deep" id="privacy">
        <div className="wrap split">
          <div className="split-copy reveal" data-reveal>
            <p className="kicker">{c.privacyKicker}</p>
            <h2>{c.privacyTitle}</h2>
            <p className="lede">{c.privacySub}</p>
            <div className="privacy-grid">
              <div>
                <p className="privacy-head can">{c.privacyCanTitle}</p>
                <ul className="ticks">
                  <li>{c.privacyCan1}</li>
                  <li>{c.privacyCan2}</li>
                  <li>{c.privacyCan3}</li>
                </ul>
              </div>
              <div>
                <p className="privacy-head cannot">{c.privacyCannotTitle}</p>
                <ul className="crosses">
                  <li>{c.privacyCannot1}</li>
                  <li>{c.privacyCannot2}</li>
                  <li>{c.privacyCannot3}</li>
                </ul>
              </div>
            </div>
          </div>
          <div className="split-art reveal" data-reveal style={{ transitionDelay: '140ms' }}>
            <img className="art-float" src="/img/mkt-privacy.jpg" alt="" width="520" height="520" loading="lazy" />
          </div>
        </div>

        <div className="wrap">
          <div className="retention reveal" data-reveal>
            <div className="retention-copy">
              <h3>{c.retentionT}</h3>
              <p>{c.retentionD}</p>
            </div>
            <RetentionSlider lang={lang} />
          </div>
        </div>
      </section>

      {/* ------------------------------ offline ----------------------------- */}
      <section className="section">
        <div className="wrap">
          <header className="section-head reveal" data-reveal>
            <p className="kicker">{c.offlineKicker}</p>
            <h2>{c.offlineTitle}</h2>
            <p className="lede">{c.offlineSub}</p>
          </header>
          <div className="offline-row">
            {[c.offlineL1, c.offlineL2, c.offlineL3].map((line, index) => (
              <div
                key={line}
                className="offline-card spot reveal"
                data-reveal
                style={{ transitionDelay: `${index * 100}ms` }}
                {...SPOT}
              >
                <span className="offline-icon" aria-hidden="true">
                  {['✈', '⬇', '🔔'][index]}
                </span>
                <p>{line}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------- stats ------------------------------ */}
      <section className="section section-tint">
        <div className="wrap">
          <header className="section-head center reveal" data-reveal>
            <p className="kicker">{c.statsKicker}</p>
            <h2>{c.statsTitle}</h2>
          </header>
          <Stats lang={lang} />
        </div>
      </section>

      {/* ------------------------------- quotes ----------------------------- */}
      <section className="section">
        <div className="wrap">
          <header className="section-head center reveal" data-reveal>
            <p className="kicker">{c.quotesKicker}</p>
            <h2>{c.quotesTitle}</h2>
          </header>
          <Quotes lang={lang} />
        </div>
      </section>

      {/* -------------------------------- FAQ ------------------------------- */}
      <section className="section section-tint">
        <div className="wrap wrap-narrow">
          <header className="section-head center reveal" data-reveal>
            <p className="kicker">{c.faqKicker}</p>
            <h2>{c.faqTitle}</h2>
          </header>
          <div className="faq">
            {faqs.map(([question, answer], index) => (
              <div key={question} className={`faq-item reveal ${open === index ? 'is-open' : ''}`} data-reveal>
                <button type="button" onClick={() => setOpen(open === index ? null : index)} aria-expanded={open === index}>
                  <span>{question}</span>
                  <span className="faq-sign" aria-hidden="true" />
                </button>
                <div className="faq-body">
                  <p>{answer}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------- CTA ------------------------------- */}
      <section className="section cta">
        <div className="cta-glow" aria-hidden="true" />
        <div className="wrap wrap-narrow cta-inner reveal" data-reveal>
          <p className="pill">{c.ctaBadge}</p>
          <h2>{c.ctaTitle}</h2>
          <p>{c.ctaSub}</p>
          <div className="hero-actions">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => navigate('/signup')}>
              {c.ctaButton}
            </button>
            <a className="btn btn-ghost btn-lg" href="mailto:hello@example.com">
              {c.ctaSecondary}
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
