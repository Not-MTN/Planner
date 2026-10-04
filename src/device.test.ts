import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * The app runs as a website, an installed app on a phone, and a window on a
 * laptop — and most of what breaks in each of those is not something a jsdom
 * test can see, because jsdom has no layout, no scrollbars and no notches.
 * These tests read the source instead: they hold the phone/tablet/desktop
 * contracts in place so that a later tidy-up cannot quietly delete them.
 */

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function cssFiles(dir = 'src', out: string[] = []): string[] {
  for (const name of readdirSync(join(process.cwd(), dir))) {
    const path = join(dir, name);
    if (statSync(join(process.cwd(), path)).isDirectory()) {
      if (!['node_modules', 'locales'].includes(name)) cssFiles(path, out);
    } else if (name.endsWith('.css')) out.push(path);
  }
  return out;
}

const stylesheets = cssFiles().map((path) => ({ path, text: read(path) }));
const allCss = stylesheets.map((sheet) => sheet.text).join('\n');
const html = read('index.html');

/** Prose about 100vh is not a use of it. */
function withoutComments(css: string): string {
  return css.replace(/\/\*[^]*?\*\//g, '');
}

/** Drop the legacy fallback block, where 100vh is deliberate and correct. */
function withoutDvhFallback(css: string): string {
  const marker = '@supports not (height: 100dvh)';
  const at = css.indexOf(marker);
  if (at < 0) return css;
  let depth = 0;
  let i = css.indexOf('{', at);
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return css.slice(0, at) + css.slice(i + 1);
}

describe('the page is set up for a phone', () => {
  it('asks for the real device width, including behind a notch', () => {
    const viewport = /<meta\s+name="viewport"\s+content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(viewport).toContain('width=device-width');
    expect(viewport).toContain('initial-scale=1');
    // Without this, a phone in landscape or with a notch letterboxes the app.
    expect(viewport).toContain('viewport-fit=cover');
  });

  it('can be installed and named on a home screen', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('apple-mobile-web-app-capable');
    expect(html).toContain('rel="apple-touch-icon"');
    const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
      display?: string;
      start_url?: string;
      icons?: { purpose?: string; sizes?: string }[];
    };
    expect(manifest.display).toBe('standalone');
    // Android crops the icon to a circle; without a maskable one it is clipped.
    expect(manifest.icons?.some((icon) => icon.purpose?.includes('maskable'))).toBe(true);
    // A start_url that 404s means an installed app opens on an error page.
    const rewrites = JSON.parse(read('vercel.json')) as { rewrites?: { source?: string }[] };
    const target = (manifest.start_url ?? '/').split('#')[0] || '/';
    const sources = rewrites.rewrites?.map((rule) => rule.source) ?? [];
    const served = target === '/' || sources.some((source) => source === target);
    expect(served, `${target} is not served (rewrites: ${sources.join(', ')})`).toBe(true);
  });

  it('keeps clear of the notch and the home indicator', () => {
    // The bottom inset is the one that hides controls behind the gesture bar.
    expect(allCss).toMatch(/env\(\s*safe-area-inset-bottom/);
  });
});

describe('viewport units survive iOS', () => {
  it('never relies on 100vh alone', () => {
    // iOS counts 100vh from the top of a collapsed browser chrome, so a
    // full-height element runs under it. Every 100vh must be a fallback with a
    // dynamic-viewport value beside it, or live in the @supports block above.
    const offenders: string[] = [];
    for (const { path, text } of stylesheets) {
      // Comments first, then the legacy block: both are allowed to say 100vh.
      const lines = withoutDvhFallback(withoutComments(text)).split('\n');
      lines.forEach((line, index) => {
        if (!line.includes('100vh')) return;
        // A fallback sits on the next line, sometimes behind a comment that
        // explains it — so look a few lines either side, not just either side.
        const near = lines.slice(Math.max(0, index - 3), index + 4).join('\n');
        if (!near.includes('dvh')) offenders.push(`${path}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

describe('touch input behaves', () => {
  it('stops iOS zooming the page when a field is focused', () => {
    // Below 16px, Safari zooms in to focus a field and often never zooms back.
    const coarse = /@media \(pointer: coarse\)[^]*?input[^]*?font-size:\s*16px/s.exec(allCss);
    expect(coarse, 'no pointer:coarse rule sets inputs to 16px').toBeTruthy();
  });

  it('gives thumb-sized targets on touch screens', () => {
    expect(allCss).toMatch(/@media \(pointer: coarse\)/);
    // The settings chips are the newest control and the easiest to shrink.
    expect(/@media \(pointer: coarse\)[^]*?\.set-nav-item[^]*?min-height:\s*(4[0-9]|[5-9][0-9])px/s.test(allCss)).toBe(true);
  });

  it('removes the 300ms double-tap delay and the grey tap flash', () => {
    expect(allCss).toContain('-webkit-tap-highlight-color: transparent');
    expect(allCss).toMatch(/touch-action:\s*manipulation/);
  });
});

describe('nothing hides behind the phone tab bar', () => {
  it('lifts toasts above it', () => {
    // The tab bar is fixed at the bottom up to the desktop breakpoint.
    expect(/@media \(max-width: 1023px\)[^]*?\.tabbar[^]*?display:\s*flex/s.test(allCss)).toBe(true);
    const lifted = /@media \(max-width: 1023px\)\s*\{\s*\.toast\s*\{[^}]*bottom:[^}]*safe-area-inset-bottom/s.exec(allCss);
    expect(lifted, 'toasts still sit at the bottom of a phone screen').toBeTruthy();
  });
});

describe('opening a sheet does not move the page', () => {
  it('reserves the scrollbar gutter', () => {
    // Windows and Android draw a scrollbar that takes up layout width; a sheet
    // hides it while open, and the app jumped sideways by exactly that width.
    expect(allCss).toMatch(/(^|\n)\s*html\s*\{[^}]*scrollbar-gutter:\s*stable/s);
  });
});

describe('a long sheet keeps its own way out', () => {
  it('sticks the title, and in settings the tab strip with it', () => {
    // Settings is the longest surface in the app and its strip is the only way
    // between groups; scrolling back to the top to switch was the tax.
    expect(/\.sheet-top\s*\{[^}]*position:\s*sticky/s.test(allCss)).toBe(true);
    const strip = read('src/components/SettingsSheet.tsx');
    expect(strip, 'the strip is no longer inside the sticky header').toMatch(/subheader=\{/);
  });

  it('keeps the strip on one line so it cannot wrap into two rows', () => {
    expect(/\.sheet-top\s+\.set-nav\s*\{[^}]*flex-wrap:\s*nowrap/s.test(allCss)).toBe(true);
  });
});

describe('the sticky sheet title lines up with the sheet at every width', () => {
  it('bleeds by exactly the sheet padding, which changes per breakpoint', () => {
    // Hard-coding 22px here would leave the header 4px short on a phone (18px)
    // and 4px long on a desktop (26px).
    expect(allCss).toMatch(/--sheet-pad-x:\s*22px/);
    expect(allCss).toMatch(/--sheet-pad-x:\s*18px/);
    expect(allCss).toMatch(/--sheet-pad-x:\s*26px/);
    expect(/\.sheet-top\s*\{[^}]*margin:\s*0\s*calc\(-1 \* var\(--sheet-pad-x/s.test(allCss)).toBe(true);
  });
});

describe('numbers the reader sees are localised', () => {
  it('never prints a bare count as JSX text', () => {
    // A count rendered straight into the page shows Latin digits inside a
    // Persian UI. Persian means Eastern Arabic numerals everywhere; t() does
    // that for its own {placeholders}, and lists need faNum( around them.
    const offencers: string[] = [];
    const files: string[] = [];
    for (const dir of ['src/views', 'src/components']) {
      for (const name of readdirSync(join(process.cwd(), dir))) {
        if (name.endsWith('.tsx') && !name.includes('.test.')) files.push(join(dir, name));
      }
    }
    const child = />\{((?:[^{}]|\{[^{}]*\})*)\}/g;
    for (const path of files) {
      const text = read(path);
      for (const match of text.matchAll(child)) {
        const expr = match[1] ?? '';
        if (!expr.includes('.length')) continue;
        if (/faNum|faDigits|tn\(|t\(|\.length\s*(===|!==|>|<|\?|&&)/.test(expr)) continue;
        offencers.push(`${path}: ${expr.trim().slice(0, 60)}`);
      }
    }
    expect(offencers).toEqual([]);
  });
});
