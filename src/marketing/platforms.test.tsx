// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Platforms } from './Platforms';
import { RELEASES_PAGE, SOURCE_PAGE, detectPlatform } from './downloads';

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

  it('is translated, not left in English, for Persian readers', () => {
    const html = render('fa');
    const text = html.textContent ?? '';
    expect(text).toContain('اندروید');
    expect(text).not.toContain('Windows 10 and 11');
  });
});
