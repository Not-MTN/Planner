import { describe, expect, it } from 'vitest';
import { sanitizeStudentExamDraft } from './exams';
import { sanitizePanels, sanitizeState } from './storage';
import { mergePanels } from './sync';
import { createEmptyState } from './types';
import type { Exam, ExamFile, Panels, StudentExamDraft, ExamSubmission } from './types';

const LINK = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';

const file = (suffix: string): ExamFile => ({
  url: `https://files.example/${suffix}.enc`,
  publicId: `planner-files/exam-answer/${LINK}/${suffix}`,
  name: `${suffix}.pdf`,
  mime: 'application/pdf',
  bytes: 2048,
});

const paperExam: Exam = {
  id: 'exam-paper',
  linkId: LINK,
  author: 'Guardian',
  title: 'Paper',
  subject: '',
  note: '',
  minutes: 30,
  dueAt: null,
  questions: [],
  createdAt: '2026-10-01T08:00:00.000Z',
  kind: 'paper',
  paperFile: file('question'),
  uploadMinutes: 10,
};

const draft: StudentExamDraft = {
  examId: 'exam-paper',
  linkId: LINK,
  kind: 'paper',
  startedAt: '2026-10-05T09:00:00.000Z',
  answers: {},
  variantId: null,
  uploadDeadline: '2026-10-05T09:40:00.000Z',
  phase: 'uploading',
  pendingFiles: [file('answer-1')],
};

function panelsWith(overrides: Partial<Panels['student']> = {}): Panels {
  const base = createEmptyState().panels;
  return {
    ...base,
    student: {
      ...base.student,
      enabled: true,
      guardians: [{ linkId: LINK, guardianUsername: 'guard', guardianDisplayName: 'Guard', wrappedShareKey: KEY, sharedWeek: null }],
      inbox: { ...base.student.inbox, exams: [paperExam] },
      ...overrides,
    },
  };
}

describe('sanitizeStudentExamDraft', () => {
  it('keeps a well-formed sitting draft, including pending uploads', () => {
    const clean = sanitizeStudentExamDraft(draft);
    expect(clean?.examId).toBe('exam-paper');
    expect(clean?.phase).toBe('uploading');
    expect(clean?.pendingFiles).toEqual([file('answer-1')]);
  });

  it('drops junk instead of crashing and defaults a bad phase', () => {
    expect(sanitizeStudentExamDraft(null)).toBeNull();
    expect(sanitizeStudentExamDraft({ examId: 'x' })).toBeNull();
    const noDeadline = sanitizeStudentExamDraft({ ...draft, uploadDeadline: undefined });
    expect(noDeadline?.uploadDeadline).toBeNull();
    const badPhase = sanitizeStudentExamDraft({ ...draft, phase: 'nonsense' });
    expect(badPhase?.phase).toBe('sitting');
  });

  it('strips malformed pending files and answer indexes', () => {
    const clean = sanitizeStudentExamDraft({
      ...draft,
      pendingFiles: [{ url: '', publicId: 'p', name: 'n', bytes: 0 }, file('answer-2')],
      answers: { q1: 1, q2: 99, q3: -1 },
    });
    expect(clean?.pendingFiles).toEqual([file('answer-2')]);
    expect(clean?.answers).toEqual({ q1: 1 });
  });
});

describe('drafts in local storage', () => {
  it('survives a full save/load round trip so a reload cannot reset the clock', () => {
    const panels = panelsWith({ examDrafts: { 'exam-paper': draft } });
    const state = { ...createEmptyState(), panels };
    const round = sanitizeState(JSON.parse(JSON.stringify(state)));
    const kept = round?.panels.student.examDrafts?.['exam-paper'];
    expect(kept?.startedAt).toBe(draft.startedAt);
    expect(kept?.uploadDeadline).toBe(draft.uploadDeadline);
    expect(kept?.pendingFiles).toEqual([file('answer-1')]);
  });

  it('drops a draft whose exam or link no longer exists', () => {
    const orphan: StudentExamDraft = { ...draft, examId: 'exam-gone', linkId: 'dead-link' };
    const panels = panelsWith({ examDrafts: { 'exam-paper': draft, gone: orphan } });
    const clean = sanitizePanels(panels);
    expect(Object.keys(clean.student.examDrafts ?? {})).toEqual(['exam-paper']);
  });

  it('keeps the verdict arrays on a graded submission through the round trip', () => {
    const sitting: ExamSubmission = {
      id: 'sitting-1',
      examId: 'exam-paper',
      linkId: LINK,
      answers: { q1: 0 },
      written: {},
      score: 3,
      marked: 5,
      submittedAt: '2026-10-05T09:35:00.000Z',
      status: 'submitted',
      kind: 'test',
      right: ['q1'],
      wrong: ['q2'],
      blank: ['q3'],
    };
    const clean = sanitizePanels(panelsWith({ examSubmissions: [sitting] }));
    const back = clean.student.examSubmissions?.[0];
    expect(back?.right).toEqual(['q1']);
    expect(back?.wrong).toEqual(['q2']);
    expect(back?.blank).toEqual(['q3']);
  });
});

describe('drafts and sittings across devices', () => {
  it('mergePanels keeps the earliest clock and unions pending files', () => {
    const phone = panelsWith({
      examDrafts: {
        'exam-paper': { ...draft, startedAt: '2026-10-05T09:00:00.000Z', pendingFiles: [file('answer-1')] },
      },
    });
    const laptop = panelsWith({
      examDrafts: {
        'exam-paper': { ...draft, startedAt: '2026-10-05T09:05:00.000Z', pendingFiles: [file('answer-2')] },
      },
    });
    const merged = mergePanels(phone, laptop);
    const kept = merged.student.examDrafts?.['exam-paper'];
    expect(kept?.startedAt).toBe('2026-10-05T09:00:00.000Z');
    expect(kept?.pendingFiles?.map((item) => item.publicId).sort()).toEqual(
      [file('answer-1').publicId, file('answer-2').publicId].sort(),
    );
  });

  it('mergePanels keeps a submission that exists on only one device, so the one-attempt rule holds', () => {
    const sitting: ExamSubmission = {
      id: 'sitting-1',
      examId: 'exam-paper',
      linkId: LINK,
      answers: {},
      written: {},
      score: 0,
      marked: 0,
      submittedAt: '2026-10-05T09:35:00.000Z',
      status: 'submitted',
      kind: 'paper',
      files: [file('answer-1')],
    };
    const withSitting = panelsWith({ examSubmissions: [sitting] });
    const empty = panelsWith();
    const merged = mergePanels(withSitting, empty);
    expect(merged.student.examSubmissions?.map((item) => item.id)).toEqual(['sitting-1']);
  });
});
