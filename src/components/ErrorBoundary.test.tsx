// @vitest-environment jsdom
/**
 * The boundary has one job: the user never ends up staring at a blank page, and
 * we hear about the crash. Both halves are tested here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';
import { enableReportingInTests, resetReportCounters, setReportTransport, setReportingEnabled } from '../reporting';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function text(): string {
  return document.body.textContent ?? '';
}

function render(node: ReactNode): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(<StrictMode>{node}</StrictMode>);
  });
}

function Boom(): ReactElement {
  throw new Error('Calendar exploded');
}

beforeEach(() => {
  resetReportCounters();
  enableReportingInTests();
  setReportingEnabled(true);
  // React logs every error a boundary catches; that noise is not the subject.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  setReportTransport(null);
  act(() => root?.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('shows a way out instead of a blank page', () => {
    render(
      <ErrorBoundary area="calendar">
        <Boom />
      </ErrorBoundary>,
    );
    expect(text()).toContain('This part of Planner stopped working.');
    expect(text()).toContain('Try again');
    expect(container?.querySelector('[role="alert"]')).toBeTruthy();
  });

  it('tells the user nothing was lost — the fear that matters most', () => {
    render(
      <ErrorBoundary area="calendar">
        <Boom />
      </ErrorBoundary>,
    );
    expect(text()).toContain('Nothing was lost');
  });

  it('reports the crash with the area it happened in', () => {
    const sent: Record<string, unknown>[] = [];
    setReportTransport((body) => sent.push(JSON.parse(body) as Record<string, unknown>));
    render(
      <ErrorBoundary area="calendar">
        <Boom />
      </ErrorBoundary>,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].area).toBe('calendar');
    expect(sent[0].message).toBe('Calendar exploded');
    // The React component stack is how we find the component that threw.
    expect(typeof sent[0].componentStack).toBe('string');
    // The id is what a user quotes when they write in.
    expect(text()).toContain(String(sent[0].id));
  });

  it('renders children untouched when nothing throws', () => {
    render(
      <ErrorBoundary area="calendar">
        <p>All is well</p>
      </ErrorBoundary>,
    );
    expect(text()).toContain('All is well');
    expect(container?.querySelector('[role="alert"]')).toBeNull();
  });

  it('sends nothing when the user has turned reporting off', () => {
    const sent: unknown[] = [];
    setReportTransport((body) => sent.push(body));
    setReportingEnabled(false);
    render(
      <ErrorBoundary area="calendar">
        <Boom />
      </ErrorBoundary>,
    );
    // The screen still appears — only the report is suppressed.
    expect(text()).toContain('This part of Planner stopped working.');
    expect(sent).toHaveLength(0);
  });
});
