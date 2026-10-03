// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Platforms } from './Platforms';
import {
  DOWNLOADS,
  RELEASES_PAGE,
  RELEASE_DOWNLOAD_BASE,
  SOURCE_PAGE,
  detectPlatform,
  deviceInstallActionFor,
  downloadsFor,
} from './downloads';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(lang: 'en' | 'fa' = 'en') {
  act(() => {
    root.render(
      <StrictMode>
        <Platforms lang={lang} />
      </StrictMode>,
    );
  });
  return container;
}

describe('detectPlatform', () => {
  it('names the device from the user agent', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15')).toBe('ios');
    // iPadOS 13+ claims to be a Mac; the Mobile token is the tell.
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Mobile/15E148')).toBe('ios');
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14; Xiaomi 14) AppleWebKit/537.36')).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe('macos');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36')).toBe('linux');
    expect(detectPlatform(undefined)).toBe('other');
  });
});

describe('device-specific app action', () => {
  it('links straight to the universal Android and Windows downloads', () => {
    expect(deviceInstallActionFor('android')).toEqual({
      href: `${RELEASE_DOWNLOAD_BASE}/app-release.apk`,
      labelKey: 'platformsDownloadApk',
      external: true,
    });
    expect(deviceInstallActionFor('windows')).toEqual({
      href: `${RELEASE_DOWNLOAD_BASE}/Planner-windows.exe`,
      labelKey: 'platformsDownloadWindows',
      external: true,
    });
  });

  it('asks for a choice where the right install depends on device architecture or store support', () => {
    for (const platform of ['macos', 'linux', 'ios', 'other'] as const) {
      expect(deviceInstallActionFor(platform)).toEqual({
        href: '#apps',
        labelKey: 'platformsSeeOptions',
        external: false,
      });
    }
  });
});

describe('the "get the app" section', () => {
  it('offers every platform, with no invented store links', () => {
    const html = render();
    const text = html.textContent ?? '';
    for (const heading of ['iPhone and iPad', 'Android', 'Windows', 'macOS', 'Linux']) {
      expect(text).toContain(heading);
    }
    // The installers are real: every card can reach the release page.
    const links = Array.from(html.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links).toContain(RELEASES_PAGE);
    expect(links).toContain(SOURCE_PAGE);
    // The iPhone card must not promise an App Store listing that does not exist.
    expect(text).not.toContain('App Store\n');
    expect(links.filter((href) => href?.includes('apps.apple.com'))).toEqual([]);
    expect(links.filter((href) => href?.includes('play.google.com'))).toEqual([]);
  });

  it('sends people to the web app when there is nothing to install', () => {
    const html = render();
    const webLinks = Array.from(html.querySelectorAll('a')).filter((a) => a.getAttribute('href') === '/app');
    expect(webLinks.length).toBeGreaterThan(0);
  });

  it('marks the reader\'s own device, and only that one', () => {
    const html = render();
    expect(html.querySelectorAll('.platform-card.is-here').length).toBeLessThanOrEqual(1);
  });

  it('downloads the file from this page, not from a page of links', () => {
    const html = render();
    const hrefs = Array.from(html.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    for (const item of DOWNLOADS.windows) {
      expect(hrefs).toContain(item.url);
    }
    expect(downloadsFor('windows')[0].url).toBe(`${RELEASE_DOWNLOAD_BASE}/Planner-windows.exe`);
    // The Android card offers the APK itself, not the releases page.
    expect(hrefs).toContain(`${RELEASE_DOWNLOAD_BASE}/app-release.apk`);
    // Every download leaves the page (GitHub serves it as an attachment).
    const downloads = Array.from(html.querySelectorAll('a')).filter((a) => a.getAttribute('href')?.startsWith(RELEASE_DOWNLOAD_BASE));
    expect(downloads.length).toBeGreaterThan(0);
    for (const link of downloads) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toContain('noreferrer');
    }
  });

  it('never names a version in a download link', () => {
    // These URLs are /releases/latest/download/<file>: a version in the file
    // name would break every button on the site at the next release.
    for (const items of Object.values(DOWNLOADS)) {
      for (const item of items) {
        expect(item.file).not.toMatch(/\d+\.\d+/);
        expect(item.url).toBe(`${RELEASE_DOWNLOAD_BASE}/${item.file}`);
      }
    }
  });

  it('highlights one download per card and offers the rest quietly', () => {
    const html = render();
    const primary = Array.from(html.querySelectorAll('a.btn-primary')).map((a) => a.getAttribute('href') ?? '');
    for (const items of Object.values(DOWNLOADS)) {
      expect(primary).toContain(items.find((item) => item.primary)?.url);
    }
    // macOS has two, because guessing a visitor's chip would be wrong half the
    // time on a platform where the wrong build does not run at all.
    expect(downloadsFor('macos')).toHaveLength(2);
    expect(primary.filter((href) => href.includes('Planner-macos')).length).toBe(1);
  });

  it('does not invent an iOS download', () => {
    // The only iOS artifact CI produces is unsigned: it cannot be installed by
    // anyone, so the card must not offer a file.
    expect(downloadsFor('ios')).toEqual([]);
    expect(downloadsFor('other')).toEqual([]);
    const html = render();
    const hrefs = Array.from(html.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => href.includes('ios'))).toEqual([]);
  });

  it('is translated, not left in English, for Persian readers', () => {
    const html = render('fa');
    const text = html.textContent ?? '';
    expect(text).toContain('اندروید');
    expect(text).not.toContain('Windows 10 and 11');
  });
});
