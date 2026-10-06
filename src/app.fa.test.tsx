// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Persian UI', () => {
  it('renders the app right-to-left with Persian labels', async () => {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, onchange: null, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
    Element.prototype.scrollIntoView = () => undefined;
    window.scrollTo = () => undefined;
    localStorage.setItem('planner-lang', 'fa');
    const { applyDocumentLang, loadDictionary } = await import('./i18n');
    // Dictionaries arrive on demand (src/i18n.ts): the test reads Persian
    // labels, so it waits for Persian the way the app does before its first paint.
    await loadDictionary('fa');
    const { createRoot } = await import('react-dom/client');
    const { App } = await import('./App');
    applyDocumentLang();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<App />));
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.documentElement.lang).toBe('fa');
    const text = document.body.textContent ?? '';
    expect(text).toContain('امروز');
    expect(text).toContain('تنظیمات');
    act(() => root.unmount());
  });
});
