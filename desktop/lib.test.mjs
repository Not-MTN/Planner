/**
 * The desktop shell's own logic: route → file, headers, and what counts as
 * this app. Electron itself is not involved, so these run anywhere.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// The desktop shell is CommonJS (Electron loads it directly); the tests are
// ESM, so they pull it in through createRequire rather than a bundler shim.
const require = createRequire(import.meta.url);
const { contentType, contentSecurityPolicy, isHttpUrl, isInternal, normalizeAddress, originOf, resolveRequestedFile } = require('./lib.cjs');

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
