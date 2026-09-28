// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Site } from './Site';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  class StubObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  window.IntersectionObserver = StubObserver as unknown as typeof IntersectionObserver;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
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

async function renderAt(path: string) {
  window.history.pushState({}, '', path);
  await act(async () => {
    root.render(
      <StrictMode>
        <Site />
      </StrictMode>,
    );
  });
}

describe('marketing site', () => {
  it('renders the landing page with the hero and the role switcher', async () => {
    await renderAt('/');
    const text = container.textContent ?? '';
    expect(text).toContain('A planner that keeps');
    expect(text).toContain('Three doors, one planner');
    expect(text).toContain('Nothing is visible by accident');
    expect(text).toContain('Small promises, kept');
    expect(container.querySelectorAll('[data-reveal]').length).toBeGreaterThan(10);
  });

  it('renders the app window and the hero demo', async () => {
    await renderAt('/');
    expect(container.querySelector('.window')).not.toBeNull();
    expect(container.querySelector('.window-tasks li')).not.toBeNull();
    expect(container.querySelector('.demo')).not.toBeNull();
  });

  it('renders the sign-up flow in three steps', async () => {
    await renderAt('/signup');
    const text = container.textContent ?? '';
    expect(text).toContain('Create your planner');
    expect(container.querySelectorAll('.auth-steps li').length).toBe(3);
    expect(container.querySelector('input[autocomplete="new-password"]')).not.toBeNull();
  });

  it('renders sign in and the recovery ladder', async () => {
    await renderAt('/login');
    expect(container.textContent).toContain('Welcome back');

    await act(async () => {
      root.render(
        <StrictMode>
          <Site />
        </StrictMode>,
      );
    });
    await act(async () => {
      window.history.pushState({}, '', '/recover');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(container.textContent).toContain('Get back in');
  });

  it('does not use the app translation layer', async () => {
    // The i18n test scans src/ for translatable strings; the marketing site must
    // keep its own dictionary so it never trips that check.
    const { COPY } = await import('./copy');
    expect(COPY.en.brand).toBe('Planner');
    expect(Object.keys(COPY.fa).length).toBe(Object.keys(COPY.en).length);
  });
});
