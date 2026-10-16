// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { setLang } from '../i18n';
import { CompletionRing } from './charts';
import { Ring } from './ui';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function mount(element: ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  setLang('en');
});

describe('numbers inside progress circles', () => {
  it('keeps long day totals on one line and isolates them from RTL text direction', () => {
    mount(<Ring value={1} label="123456/123456" caption="done today" />);
    const label = container?.querySelector('.ring-number');
    expect(label?.classList.contains('is-long')).toBe(true);
    expect(label?.getAttribute('dir')).toBe('ltr');
  });

  it('marks large completion counts for the smaller fitting style', () => {
    mount(<CompletionRing done={1234} planned={5678} />);
    expect(container?.querySelector('.completion-ring-percent')?.getAttribute('dir')).toBe('ltr');
    expect(container?.querySelector('.completion-ring-count')?.classList.contains('is-long')).toBe(true);
  });
});
