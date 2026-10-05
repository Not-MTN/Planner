/**
 * The desktop shell's own logic: route → file, headers, and what counts as
 * this app. Electron itself is not involved, so these run anywhere.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The desktop shell is CommonJS (Electron loads it directly); the tests are
// ESM, so they pull it in through createRequire rather than a bundler shim.
const require = createRequire(import.meta.url);
const {
  DEFAULT_PREFERENCES,
  MAX_REMINDERS,
  WINDOWS_UPDATE_MANIFEST_URL,
  contentType,
  contentSecurityPolicy,
  isHttpUrl,
  isInternal,
  isTrustedUpdateUrl,
  dueReminders,
  msUntilNext,
  normalizeAddress,
  normalizePreferences,
  normalizeReminderSchedule,
  originOf,
  reminderInHorizon,
  resolveRequestedFile,
  validateWindowsOffer,
  windowsOfferFromManifest,
} = require('./lib.cjs');

function fakeBundle() {
  const root = mkdtempSync(join(tmpdir(), 'planner-bundle-'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Planner</title>');
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'assets', 'index-abc123.js'), 'console.log(1)');
  writeFileSync(join(root, 'manifest.webmanifest'), '{}');
  writeFileSync(join(root, '..', 'outside.txt'), 'not part of the bundle');
  return root;
}

describe('normalizeAddress', () => {
  it('trims and drops trailing slashes', () => {
    expect(normalizeAddress(' https://planner.example.com/ ')).toBe('https://planner.example.com');
    expect(normalizeAddress(undefined)).toBe('');
    expect(normalizeAddress('/')).toBe('');
  });
});

describe('isHttpUrl', () => {
  it('accepts only http(s)', () => {
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('http://localhost:5173/app')).toBe(true);
    expect(isHttpUrl('app://planner/app')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});

describe('isInternal', () => {
  it('accepts the app origin and the bundled scheme', () => {
    expect(isInternal('https://planner.example.com/app', 'https://planner.example.com')).toBe(true);
    // Custom schemes have no opaque origin in Chromium — and Node disagrees,
    // which is why originOf() composes protocol and host itself.
    expect(originOf('app://planner/app')).toBe('app://planner');
    expect(isInternal('app://planner/app', 'app://planner')).toBe(true);
    expect(isInternal('app://elsewhere/app', 'app://planner')).toBe(false);
  });

  it('sends everything else to the browser', () => {
    expect(isInternal('https://github.com/Not-MTN/Planner', 'app://planner')).toBe(false);
    expect(isInternal('https://planner.example.com.evil.example/app', 'https://planner.example.com')).toBe(false);
    expect(isInternal('http://localhost:5173/app', 'app://planner')).toBe(false);
  });
});

describe('contentType', () => {
  it('names the types the app actually ships', () => {
    expect(contentType('/x/index.html')).toBe('text/html; charset=utf-8');
    expect(contentType('/x/assets/index-abc.js')).toBe('text/javascript; charset=utf-8');
    expect(contentType('/x/manifest.webmanifest')).toBe('application/manifest+json; charset=utf-8');
    expect(contentType('/x/icon-192.png')).toBe('image/png');
    expect(contentType('/x/font.woff2')).toBe('font/woff2');
    expect(contentType('/x/unknown.bin')).toBe('application/octet-stream');
  });
});

describe('contentSecurityPolicy', () => {
  it('allows the weather origin and the local app, and nothing else', () => {
    const policy = contentSecurityPolicy();
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain('connect-src');
    expect(policy).toContain('https://api.open-meteo.com');
    expect(policy).not.toContain('api.github.com');
    expect(policy).not.toContain('https://planner.example.com');
  });

  it('adds the configured API origin to connect-src only', () => {
    const policy = contentSecurityPolicy('https://planner.example.com/');
    expect(policy).toContain("connect-src 'self' https://planner.example.com https://api.open-meteo.com");
    const script = /script-src[^;]*/.exec(policy)?.[0] ?? '';
    expect(script).not.toContain('planner.example.com');
  });
});

describe('resolveRequestedFile', () => {
  it('serves files that exist', () => {
    const root = fakeBundle();
    expect(resolveRequestedFile('/assets/index-abc123.js', root)).toBe(join(root, 'assets', 'index-abc123.js'));
    expect(resolveRequestedFile('/manifest.webmanifest', root)).toBe(join(root, 'manifest.webmanifest'));
  });

  it('falls back to index.html for the app\'s routes', () => {
    const root = fakeBundle();
    for (const route of ['/', '/app', '/login', '/signup', '/recover', '/app/', '/day/2026-10-02']) {
      expect(resolveRequestedFile(route, root)).toBe(join(root, 'index.html'));
    }
  });

  it('answers 404 for a missing file, so a broken asset is visible', () => {
    const root = fakeBundle();
    expect(resolveRequestedFile('/assets/missing.js', root)).toBeNull();
    expect(resolveRequestedFile('/nope.png', root)).toBeNull();
  });

  it('never serves anything outside the bundle', () => {
    const root = fakeBundle();
    for (const attempt of ['/../outside.txt', '/..%2Foutside.txt', '/assets/../../outside.txt']) {
      const resolved = resolveRequestedFile(attempt, root);
      expect(resolved === null || resolved.startsWith(root)).toBe(true);
    }
    expect(resolveRequestedFile('/%00/app', root)).toBeNull();
  });
});

describe('Windows updater contract', () => {
  it('accepts only the stable release manifest and exact Windows installer path', () => {
    const version = '1.4.2';
    const hash = 'ab'.repeat(32);
    const manifest = {
      schemaVersion: 1,
      product: 'Planner',
      tag: `v${version}`,
      version,
      platforms: {
        android: {},
        windows: {
          appId: 'com.notmtn.planner',
          version,
          installer: {
            fileName: 'Planner-windows.exe',
            downloadUrl: `https://github.com/Not-MTN/Planner/releases/download/v${version}/Planner-windows.exe`,
            sizeBytes: 4096,
            sha256: hash,
          },
        },
      },
    };
    const offer = windowsOfferFromManifest(manifest);
    expect(WINDOWS_UPDATE_MANIFEST_URL).toBe('https://github.com/Not-MTN/Planner/releases/latest/download/planner-update.json');
    expect(offer).toMatchObject({ version, sha256: hash });
    expect(validateWindowsOffer(offer)).toMatchObject({ version, sha256: hash });
    expect(isTrustedUpdateUrl(offer.downloadUrl)).toBe(true);

    expect(validateWindowsOffer({ ...offer, downloadUrl: 'https://example.com/Planner-windows.exe' })).toBeNull();
    expect(validateWindowsOffer({ ...offer, appId: 'com.attacker.app' })).toBeNull();
    expect(validateWindowsOffer({ ...offer, fileName: 'other.exe' })).toBeNull();
    expect(validateWindowsOffer({ ...offer, sha256: 'bad' })).toBeNull();
    expect(windowsOfferFromManifest({ ...manifest, version: '1.4.3' })).toBeNull();
  });
});

// A regression guard for the kind of bug that only appears after installing:
// main.cjs required ./lib.cjs, but electron-builder.yml did not package it,
// so every installed copy crashed at launch with "Cannot find module".
// The dev run never catches that (the file is on disk there), so this test
// cross-checks the packaging list against what the shell actually requires.
describe('electron-builder packaging', () => {
  const here = join(new URL('.', import.meta.url).pathname);
  const read = (name) => readFileSync(join(here, name), 'utf8');

  const packaged = (() => {
    const yml = read('electron-builder.yml');
    const filesBlock = yml.match(/^files:\n((?:[ \t]+-[^\n]*\n|[ \t]*#[^\n]*\n|[ \t]*\n)+)/m);
    if (!filesBlock) return [];
    // Entries only — blank lines and comments are part of the list's shape but
    // not part of what it packs, and this test is about what gets installed.
    return [...filesBlock[1].matchAll(/^[ \t]+-[ \t]*(.*)$/gm)].map((m) => m[1].trim()).filter(Boolean);
  })();

  const localRequires = (name) =>
    [...read(name).matchAll(/require\((['"])(\.\/[^'"]+)\1\)/g)].map((m) => m[2].slice(2));

  it('found the files list at all', () => {
    expect(packaged.length).toBeGreaterThan(0);
    expect(packaged).toContain('main.cjs');
  });

  it('packages every file main.cjs and preload.cjs require', () => {
    for (const entry of ['main.cjs', 'preload.cjs']) {
      for (const required of localRequires(entry)) {
        expect(packaged, `${entry} requires ./${required}, which electron-builder.yml does not package`).toContain(required);
      }
    }
  });

  it('packages the tray icon the background mode needs', () => {
    // Same failure shape as the lib.cjs bug above, one release later: an icon
    // that exists in the repository but not in the installer leaves a hidden
    // window with no tray to bring it back.
    for (const icon of ['build/icon.ico', 'build/icon.png']) {
      expect(packaged, `background mode reads ${icon}`).toContain(icon);
    }
  });
});

// ── Background mode and the reminder hand-off ──────────────────────────────
//
// The main process owns both; these are the rules it applies to what the page
// sends over IPC and to what it reads back from disk.
describe('desktop preferences', () => {
  it('defaults to staying in the background, and keeps only booleans', () => {
    expect(DEFAULT_PREFERENCES.background).toBe(true);
    expect(normalizePreferences(undefined)).toEqual({ background: true, backgroundExplained: false });
    expect(normalizePreferences({ background: false })).toEqual({ background: false, backgroundExplained: false });
    expect(normalizePreferences({ backgroundExplained: true })).toEqual({ background: true, backgroundExplained: true });
    // A corrupted file must not turn into a truthy value, and the two fields
    // fall back independently — one bad key does not reset the other.
    expect(normalizePreferences({ background: 'yes', backgroundExplained: true })).toEqual({ background: true, backgroundExplained: true });
    expect(normalizePreferences({ background: false, backgroundExplained: 7 })).toEqual({ background: false, backgroundExplained: false });
    expect(normalizePreferences([])).toEqual({ background: true, backgroundExplained: false });
  });
});

describe('the reminder schedule the main process accepts', () => {
  const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
  const reminder = (overrides = {}) => ({ key: '2026-10-05|task|abc|09:00', title: 'Practice', body: 'Starts at 09:00', at: at(30), ...overrides });

  it('takes a plain reminder and ignores anything it did not write', () => {
    const one = reminder();
    expect(normalizeReminderSchedule([one])).toEqual([{ key: '2026-10-05|task|abc|09:00', title: 'Practice', body: 'Starts at 09:00', at: Date.parse(one.at) }]);
    expect(normalizeReminderSchedule('nope')).toEqual([]);
    expect(normalizeReminderSchedule([null, 42, {}, { ...reminder(), key: '' }])).toEqual([]);
    // A key with characters outside the reminder-key alphabet is refused, so
    // the bridge cannot be used as a general-purpose notification pipe.
    expect(normalizeReminderSchedule([reminder({ key: 'hello world!' })])).toEqual([]);
    expect(normalizeReminderSchedule([reminder({ title: '   ' })])).toEqual([]);
    expect(normalizeReminderSchedule([reminder({ at: 'not a date' })])).toEqual([]);
  });

  it('trims long text and deduplicates by key', () => {
    const long = normalizeReminderSchedule([reminder({ title: 'T'.repeat(400), body: 'B'.repeat(400) })]);
    expect(long[0].title).toHaveLength(120);
    expect(long[0].body).toHaveLength(240);
    const duplicated = normalizeReminderSchedule([reminder({ title: 'first' }), reminder({ title: 'second' })]);
    expect(duplicated).toHaveLength(1);
    expect(duplicated[0].title).toBe('first');
  });

  it('sorts by time and caps the list', () => {
    const many = Array.from({ length: MAX_REMINDERS + 10 }, (_, index) => reminder({ key: `k-${index}`, at: at(index + 1) }));
    const sorted = normalizeReminderSchedule(many);
    expect(sorted).toHaveLength(MAX_REMINDERS);
    expect(sorted[0].at).toBeLessThan(sorted[1].at);
  });

  it('knows what is due, what is next, and what is too far away to matter', () => {
    const now = Date.now();
    const schedule = normalizeReminderSchedule([
      reminder({ key: 'past', at: new Date(now - 60_000).toISOString() }),
      reminder({ key: 'soon', at: new Date(now + 60_000).toISOString() }),
      reminder({ key: 'later', at: new Date(now + 3 * 60 * 60_000).toISOString() }),
    ]);
    expect(dueReminders(schedule, now).map((item) => item.key)).toEqual(['past']);
    expect(msUntilNext(schedule, now)).toBeGreaterThan(50_000);
    expect(msUntilNext(schedule, now)).toBeLessThanOrEqual(60_000);
    expect(msUntilNext([], now)).toBeNull();
    expect(reminderInHorizon(schedule[1], now)).toBe(true);
    // A reminder left over from three days ago is stale, not overdue, and one
    // forty days out is past anything the schedule should have carried.
    expect(reminderInHorizon({ at: now - 3 * 24 * 60 * 60_000 }, now)).toBe(false);
    expect(reminderInHorizon({ at: now + 41 * 24 * 60 * 60_000 }, now)).toBe(false);
  });
});
