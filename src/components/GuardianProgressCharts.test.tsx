// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GuardianProgressCharts } from './GuardianProgressCharts';
import { setLang } from '../i18n';
import type { GuardianLink } from '../types';

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function link(partial: Partial<GuardianLink> = {}): GuardianLink {
  return {
    id: 'row-1',
    username: 'sara',
    displayName: 'Sara',
    status: 'linked',
    history: [],
    linkId: 'link-1',
    code: null,
    wrappedShareKey: 'wrapped',
    results: null,
    plans: [],
    ...partial,
  };
}

function mount(value: GuardianLink): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<GuardianProgressCharts link={value} />));
}

beforeEach(() => {
  setLang('en');
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  setLang('en');
});

describe('GuardianProgressCharts', () => {
  it('renders shared trend and status charts without leaking private work details', () => {
    mount(link({
      history: [
        { weekOf: '2026-10-05', planned: 4, done: 2, focusMinutes: 60, subjects: [], headline: null, updatedAt: '' },
        { weekOf: '2026-10-12', planned: 5, done: 4, focusMinutes: 90, subjects: [], headline: null, updatedAt: '' },
      ],
      exams: [
        { id: 'exam-1', linkId: 'link-1', author: 'Mum', title: 'Algebra quiz', subject: 'Maths', note: '', minutes: null, dueAt: null, questions: [], createdAt: '' },
        { id: 'exam-2', linkId: 'link-1', author: 'Mum', title: 'Unmarked test title', subject: 'English', note: '', minutes: null, dueAt: null, questions: [], createdAt: '' },
      ],
      examResults: [
        { id: 'result-1', examId: 'exam-1', linkId: 'link-1', answers: {}, written: { q: 'secret written answer' }, score: 4, marked: 5, submittedAt: '2026-10-12T12:00:00Z', status: 'reviewed' },
        { id: 'result-2', examId: 'exam-2', linkId: 'link-1', answers: {}, written: {}, score: 0, marked: 0, submittedAt: '2026-10-13T12:00:00Z', status: 'submitted' },
      ],
      homework: [
        { id: 'hw-1', linkId: 'link-1', author: 'Mum', title: 'Private homework title', instructions: 'private homework instructions', subject: 'Maths', dueAt: null, createdAt: '' },
        { id: 'hw-2', linkId: 'link-1', author: 'Mum', title: 'Another private title', instructions: '', subject: 'English', dueAt: null, createdAt: '' },
      ],
      homeworkSubmissions: [
        {
          id: 'submission-1', assignmentId: 'hw-1', linkId: 'link-1', submittedAt: '', status: 'approved', guardianNote: 'private review note', reviewedAt: '',
          photos: [{ url: 'https://example.test/photo', publicId: 'private-id', name: 'private-photo-name.png', mime: 'image/png', bytes: 10 }],
        },
      ],
      classes: [
        { id: 'class-1', linkId: 'link-1', author: 'Mum', title: 'Private class title', subject: 'Maths', description: 'private class description', videoUrl: 'https://example.test/video', createdAt: '' },
        { id: 'class-2', linkId: 'link-1', author: 'Mum', title: 'Another class', subject: 'Maths', description: '', videoUrl: '', createdAt: '' },
      ],
      classProgress: [
        { classId: 'class-1', linkId: 'link-1', completedAt: '2026-10-12T10:00:00Z', updatedAt: '' },
      ],
      goals: [
        { id: 'goal-1', linkId: 'link-1', author: 'Mum', title: 'Revision goal', note: '', target: null, steps: ['private goal step'], createdAt: '' },
      ],
      goalAnswers: [
        { suggestionId: 'goal-1', state: 'accepted', done: 2, total: 3, updatedAt: '2026-10-14T10:00:00Z' },
      ],
    }));

    expect(container?.textContent).toContain('Progress over time');
    expect(container?.querySelector('[role="img"][aria-label="Weekly completion rate"]')).not.toBeNull();
    expect(container?.textContent).toContain('Marked test scores');
    expect(container?.textContent).toContain('Algebra quiz');
    expect(container?.textContent).not.toContain('Unmarked test title');
    expect(container?.textContent).toContain('Homework status');
    expect(container?.querySelector('[role="img"][aria-label^="2 assigned"]')).not.toBeNull();
    expect(container?.textContent).toContain('Class progress');
    expect(container?.querySelector('[role="progressbar"][aria-label="Maths"]')?.getAttribute('aria-valuenow')).toBe('1');
    expect(container?.textContent).toContain('Revision goal');
    expect(container?.querySelector('[role="progressbar"][aria-label="Revision goal"]')?.getAttribute('aria-valuenow')).toBe('2');

    const rendered = container?.textContent ?? '';
    for (const privateDetail of [
      'secret written answer',
      'Private homework title',
      'private homework instructions',
      'private review note',
      'private-photo-name.png',
      'Private class title',
      'private class description',
      'private goal step',
    ]) {
      expect(rendered).not.toContain(privateDetail);
    }
  });

  it('shows no charts before pairing or when there is no shared progress to plot', () => {
    mount(link({ status: 'pending' }));
    expect(container?.textContent).toBe('');

    act(() => root?.render(<GuardianProgressCharts link={link()} />));
    expect(container?.textContent).toBe('');
  });
});
