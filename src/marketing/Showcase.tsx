import { useLayoutEffect, useRef, useState } from 'react';
import { COPY, type Lang } from './copy';
import { pointerLeave, pointerMove, useCountUp, useInView, useStage } from './effects';

type Role = 'personal' | 'student' | 'guardian';

const SPOT = { onMouseMove: (event: React.MouseEvent<HTMLElement>) => pointerMove(event, { tilt: 3 }), onMouseLeave: pointerLeave };

/* ------------------------------------------------------- role switcher */

function PreviewPersonal({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  // The app's own page names, localized exactly like the planner tabs
  // (keys in locales/fa.ts), so the tiles don't stay English in fa mode.
  const pages =
    lang === 'fa'
      ? ['امروز', 'تقویم', 'مربی هوش مصنوعی', 'برنامه‌ها', 'کارها', 'عادت‌ها', 'هدف‌ها', 'یادداشت‌ها', 'بینش‌ها']
      : ['Today', 'Calendar', 'AI Coach', 'Plans', 'Tasks', 'Habits', 'Goals', 'Notes', 'Insights'];
  return (
    <div className="preview-inner">
      <div className="preview-grid">
        {pages.map((page, index) => (
          <span key={page} className={index === 0 ? 'is-active' : ''} style={{ animationDelay: `${index * 45}ms` }}>
            {page}
          </span>
        ))}
      </div>
      <p className="preview-tag">{c.previewPersonalTag}</p>
    </div>
  );
}

function PreviewStudent({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  return (
    <div className="preview-inner">
      <ul className="preview-list">
        <li className="is-done">
          <span aria-hidden="true" /> {lang === 'fa' ? 'تکلیف ریاضی' : 'Math homework'}
        </li>
        <li>
          <span aria-hidden="true" /> {lang === 'fa' ? 'خواندن فصل چهارم' : 'Read chapter four'}
        </li>
        <li className="is-private">
          <span aria-hidden="true" /> {lang === 'fa' ? 'یادداشت شخصی' : 'A note just for me'}
          <em>{c.studentPrivate}</em>
        </li>
      </ul>
      <div className="preview-shared">
        <p>{lang === 'fa' ? 'به اشتراک گذاشته شده با' : 'Shared with'}</p>
        <div className="preview-people">
          <span className="preview-person">
            <i aria-hidden="true">M</i>
            {lang === 'fa' ? 'مادر' : 'Mum'}
          </span>
          <span className="preview-person">
            <i aria-hidden="true">A</i>
            {lang === 'fa' ? 'مشاور' : 'Advisor'}
          </span>
        </div>
      </div>
      <p className="preview-tag">{c.previewStudentTag}</p>
    </div>
  );
}

function PreviewGuardian({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  return (
    <div className="preview-inner">
      <div className="preview-roster">
        <div className="preview-student is-active">
          <span className="preview-avatar" aria-hidden="true">
            S
          </span>
          <span className="preview-who">
            <b>Sara</b>
            <i>{lang === 'fa' ? '۲ تغییر تازه' : '2 new changes'}</i>
          </span>
          <span className="preview-score">78%</span>
        </div>
        <div className="preview-student">
          <span className="preview-avatar" aria-hidden="true">
            A
          </span>
          <span className="preview-who">
            <b>Amir</b>
            <i>{lang === 'fa' ? 'هفته آرام' : 'Quiet week'}</i>
          </span>
          <span className="preview-score is-warn">41%</span>
        </div>
      </div>
      <p className="preview-tag">{c.previewGuardianTag}</p>
    </div>
  );
}

export function RoleSwitcher({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [role, setRole] = useState<Role>('personal');
  const tabs: [Role, string, string, string][] = [
    ['personal', c.roleTabPersonal, c.previewPersonalTitle, c.previewPersonalBody],
    ['student', c.roleTabStudent, c.previewStudentTitle, c.previewStudentBody],
    ['guardian', c.roleTabGuardian, c.previewGuardianTitle, c.previewGuardianBody],
  ];
  const active = tabs.find(([id]) => id === role)!;
  const roleIndex = tabs.findIndex(([id]) => id === role);

  // The sliding pill is measured against the real button boxes: labels differ
  // in width (per language and per role), so an equal-thirds step lands
  // between the tabs. Runs before paint, so the first frame is already right.
  const tabsRef = useRef<HTMLDivElement>(null);
  const inkRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const bar = tabsRef.current;
    const ink = inkRef.current;
    if (!bar || !ink) return;
    const align = () => {
      const button = bar.querySelectorAll<HTMLButtonElement>('button')[roleIndex];
      if (!button) return;
      const barBox = bar.getBoundingClientRect();
      const box = button.getBoundingClientRect();
      const rtl = getComputedStyle(bar).direction === 'rtl';
      const border = parseFloat(rtl ? getComputedStyle(bar).borderRightWidth : getComputedStyle(bar).borderLeftWidth) || 0;
      // inset-inline-start measures from the padding-box edge (border excluded).
      const start = rtl ? barBox.right - border - box.right : box.left - barBox.left - border;
      ink.style.insetInlineStart = `${Math.max(0, start)}px`;
      ink.style.width = `${box.width}px`;
    };
    align();
    // Web fonts arriving late change the label widths — re-measure after the
    // first paint so the pill doesn't stay aligned to the fallback metrics.
    if (document.fonts?.ready) void document.fonts.ready.then(align);
    window.addEventListener('resize', align);
    return () => window.removeEventListener('resize', align);
  }, [roleIndex, lang]);

  return (
    <div className="switcher">
      <div className="switcher-tabs reveal" data-reveal role="tablist" ref={tabsRef}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={role === id}
            className={role === id ? 'is-active' : ''}
            onClick={() => setRole(id)}
          >
            {label}
          </button>
        ))}
        <span className="switcher-ink" aria-hidden="true" />
      </div>

      <div className="switcher-body">
        <div className="switcher-copy reveal" data-reveal>
          <h3 key={active[2]}>{active[2]}</h3>
          <p key={active[3]}>{active[3]}</p>
        </div>
        <div className="switcher-preview spot" {...SPOT} key={role}>
          {role === 'personal' ? <PreviewPersonal lang={lang} /> : null}
          {role === 'student' ? <PreviewStudent lang={lang} /> : null}
          {role === 'guardian' ? <PreviewGuardian lang={lang} /> : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- visibility matrix */

type Cell = 'yes' | 'no' | 'opt';

export function VisibilityMatrix({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [hover, setHover] = useState<number | null>(null);
  const rows: [string, Cell, Cell, Cell][] = [
    [c.matrixRowPlan, 'yes', 'yes', 'yes'],
    [c.matrixRowHabit, 'yes', 'yes', 'opt'],
    [c.matrixRowMood, 'yes', 'yes', 'opt'],
    [c.matrixRowNote, 'yes', 'opt', 'no'],
    [c.matrixRowFocus, 'yes', 'yes', 'yes'],
    [c.matrixRowDeadline, 'yes', 'opt', 'yes'],
  ];
  const glyph: Record<Cell, string> = { yes: '✓', no: '—', opt: '◐' };
  const label: Record<Cell, string> = { yes: c.matrixYes, no: c.matrixNo, opt: c.matrixOpt };

  return (
    <div className="matrix reveal" data-reveal>
      <div className="matrix-row matrix-head">
        <span />
        <span>{c.matrixColOwner}</span>
        <span>{c.matrixColParent}</span>
        <span>{c.matrixColAdvisor}</span>
      </div>
      {rows.map(([name, owner, parent, advisor], index) => (
        <div
          key={name}
          className={`matrix-row ${hover === index ? 'is-hover' : ''}`}
          onMouseEnter={() => setHover(index)}
          onMouseLeave={() => setHover(null)}
        >
          <span className="matrix-name">{name}</span>
          {[owner, parent, advisor].map((cell, column) => (
            <span key={column} className={`matrix-cell is-${cell}`} title={label[cell]}>
              <b aria-hidden="true">{glyph[cell]}</b>
              <span className="sr-only">{label[cell]}</span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- dashboard stages */

export function DashboardBuild({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const { ref, stage } = useStage<HTMLDivElement>(3);
  const steps = [
    [c.dashS1T, c.dashS1D],
    [c.dashS2T, c.dashS2D],
    [c.dashS3T, c.dashS3D],
  ];

  return (
    <div className="dash" ref={ref}>
      <div className="dash-steps">
        {steps.map(([title, body], index) => (
          <div key={title} className={`dash-step ${stage === index ? 'is-active' : ''} ${stage > index ? 'is-done' : ''}`}>
            <span className="dash-dot" aria-hidden="true" />
            <div>
              <h3>{title}</h3>
              <p>{body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="dash-card spot" data-stage={stage} {...SPOT}>
        <div className="dash-card-head">
          <span className="dash-avatar" aria-hidden="true">
            S
          </span>
          <span>
            <b>Sara</b>
            <i>{lang === 'fa' ? 'این هفته' : 'This week'}</i>
          </span>
        </div>

        <div className={`dash-number ${stage >= 0 ? 'is-in' : ''}`}>
          <p>78%</p>
          <span className="dash-delta">{c.guardianHeroDelta}</span>
        </div>

        <p className={`dash-narrative ${stage >= 1 ? 'is-in' : ''}`}>{c.guardianNarrative}</p>

        <div className={`dash-charts ${stage >= 2 ? 'is-in' : ''}`}>
          <svg viewBox="0 0 160 40" preserveAspectRatio="none" aria-hidden="true">
            <path className="tiny-line" d="M0 30 L26 26 L52 28 L78 18 L104 20 L130 10 L160 4" />
          </svg>
          <div className="dash-bars" aria-hidden="true">
            {[3, 5, 4, 8, 6, 9, 7].map((value, index) => (
              <span key={index} style={{ height: `${value * 10}%`, animationDelay: `${index * 70}ms` }} />
            ))}
          </div>
          <div className="dash-grid" aria-hidden="true">
            {Array.from({ length: 21 }, (_, index) => (
              <span key={index} className={index % 6 === 0 ? 'is-off' : 'is-on'} style={{ animationDelay: `${index * 20}ms` }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- AI proposal */

export function AiProposal({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [state, setState] = useState<'idle' | 'done'>('idle');

  return (
    <div className={`proposal ${state === 'done' ? 'is-done' : ''}`}>
      <p className="proposal-by">{c.aiProposalBy}</p>
      <p className="proposal-title">{c.aiProposal}</p>
      <p className="proposal-why">{c.aiProposalWhy}</p>
      {state === 'idle' ? (
        <div className="proposal-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => setState('done')}>
            {c.aiApprove}
          </button>
          <button type="button" className="btn btn-outline btn-sm">
            {c.aiDecline}
          </button>
        </div>
      ) : (
        <p className="proposal-done">
          <span aria-hidden="true">✓</span> {c.aiApproved}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------- retention slider */

export function RetentionSlider({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [weeks, setWeeks] = useState(2);
  const forever = weeks >= 12;

  return (
    <div className="retention-tool">
      <div className="retention-slider">
        <label htmlFor="retention-range">
          <span>{c.retSliderLabel}</span>
          <b>{forever ? c.retForever : `${weeks} ${c.retWeeks}`}</b>
        </label>
        <input
          id="retention-range"
          type="range"
          min={1}
          max={12}
          step={1}
          value={weeks}
          onChange={(event) => setWeeks(Number(event.target.value))}
        />
      </div>

      <div className="retention-fold" aria-hidden="true">
        <span className="fold-live" style={{ flexGrow: weeks }}>
          {lang === 'fa' ? 'جزئیات کامل' : 'full detail'}
        </span>
        <span className="fold-arrow">→</span>
        <span className="fold-small" style={{ flexGrow: Math.max(1, 12 - weeks) }}>
          {c.retResults}
        </span>
      </div>

      <p className="retention-out">
        {c.retAfter} — {c.retResults}. <b>{c.retSize}</b>
      </p>
    </div>
  );
}

/* ------------------------------------------------------- stats */

function StatValue({ value, active }: { value: string; active: boolean }) {
  return <p className="stat-value">{useCountUp(value, active)}</p>;
}

export function Stats({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const items = [
    [c.stat1v, c.stat1l],
    [c.stat2v, c.stat2l],
    [c.stat3v, c.stat3l],
    [c.stat4v, c.stat4l],
  ];

  return (
    <div className="stats" ref={ref}>
      {items.map(([value, label], index) => (
        <div key={label} className="stat reveal" data-reveal style={{ transitionDelay: `${index * 90}ms` }}>
          <StatValue value={value} active={inView} />
          <p className="stat-label">{label}</p>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- quotes */

export function Quotes({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const items = [
    [c.authQuote1, c.authQuote1By],
    [c.authQuote2, c.authQuote2By],
    [c.quote3, c.quote3By],
  ];

  return (
    <div className="quotes">
      {items.map(([quote, by], index) => (
        <figure key={quote} className="quote spot reveal" data-reveal style={{ transitionDelay: `${index * 110}ms` }} {...SPOT}>
          <blockquote>{quote}</blockquote>
          <figcaption>{by}</figcaption>
        </figure>
      ))}
    </div>
  );
}
