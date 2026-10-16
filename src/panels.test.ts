import { describe, expect, it } from 'vitest';
import { createEmptyState } from './types';
import { sanitizePanels, sanitizeState } from './storage';
import { mergePanels, mergeStates } from './sync';
import { daysUntil, splitExplanations, studentCanDeletePlan, subjectMinutes, weekOf, weekResults, withExplanation, withFlushedPlans, withLinkPlan, withQueuedPlan, withSubject, withoutQueuedPlan, withoutStudentPlan, withoutSubject } from './panels';
import type { ChangeNote, ClassAssignment, ClassProgress, DayReport, GuardianPlan, HomeworkAssignment, HomeworkPhoto, HomeworkReview, HomeworkSubmission, Panels, PlannerState, QueuedPlan, ReportAck, StudentSubject } from './types';

function note(week: string, id: string): ChangeNote {
  return { id, createdAt: `2026-03-0${id}T10:00:00.000Z`, weekOf: week, summary: `change ${id}`, reason: 'because' };
}

function subject(id: string, name: string): StudentSubject {
  return { id, name, accent: 'blue', examDate: null, targetMinutes: null };
}

function stateWith(panels: Panels, extra: Partial<PlannerState> = {}): PlannerState {
  return { ...createEmptyState(), panels, ...extra };
}

describe('panel storage', () => {
  it('starts with both panels off and an empty planner', () => {
    const panels = sanitizePanels(undefined);
    expect(panels.student.enabled).toBe(false);
    expect(panels.guardian.enabled).toBe(false);
    expect(panels.guardian.kind).toBeNull();
  });

  it('keeps panel data through a save and load round trip', () => {
    const panels = withSubject(createEmptyState().panels, subject('s1', 'Physics'));
    const round = sanitizeState(JSON.parse(JSON.stringify(stateWith(panels))));
    expect(round?.panels.student.subjects[0]?.name).toBe('Physics');
  });

  it('keeps deleted-plan markers through local storage sanitization', () => {
    const base = createEmptyState().panels;
    const safe = sanitizePanels({ ...base, student: { ...base.student, deletedPlanIds: ['plan-one'] } });
    expect(safe.student.deletedPlanIds).toEqual(['plan-one']);
  });

  it('preserves daily and period approvals through a save and load round trip', () => {
    const base = createEmptyState().panels;
    const linkId = '12345678-1234-1234-1234-123456789abc';
    const approvedAt = '2026-10-12T12:00:00.000Z';
    const plan: GuardianPlan = {
      id: 'plan-one', author: 'Parent', linkId, cadence: 'week', start: '2026-10-01', title: 'Done', note: '',
      items: [], approvedAt, createdAt: '2026-10-01T08:00:00.000Z', updatedAt: approvedAt,
    };
    const report: DayReport = {
      id: 'report-one', planId: plan.id, linkId, date: '2026-10-02', doneIds: [], note: '',
      createdAt: '2026-10-02T20:00:00.000Z', updatedAt: '2026-10-02T20:00:00.000Z',
    };
    const ack: ReportAck = {
      id: 'ack-one', reportId: report.id, planId: plan.id, linkId, date: report.date, text: '', reactions: [],
      approvedAt, createdAt: approvedAt,
    };
    const panels: Panels = {
      ...base,
      student: {
        ...base.student,
        enabled: true,
        inbox: { ...base.student.inbox, plans: [plan] },
        reports: [report],
        acks: [ack],
      },
      guardian: {
        ...base.guardian,
        enabled: true,
        kind: 'parent',
        links: [{
          id: 'local-link-one', username: 'student', displayName: 'Student', status: 'linked', history: [], linkId,
          code: null, wrappedShareKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=', results: null,
          plans: [plan], reports: [report], acks: [ack],
        }],
      },
    };
    const round = sanitizeState(JSON.parse(JSON.stringify(stateWith(panels))));
    expect(round?.panels.student.inbox.plans[0]?.approvedAt).toBe(approvedAt);
    expect(round?.panels.student.acks?.[0]?.approvedAt).toBe(approvedAt);
    expect(round?.panels.guardian.links[0]?.plans[0]?.approvedAt).toBe(approvedAt);
    expect(round?.panels.guardian.links[0]?.acks?.[0]?.approvedAt).toBe(approvedAt);
  });

  it('never enables the guardian panel without a kind', () => {
    const panels = sanitizePanels({ guardian: { enabled: true, kind: 'mystery', links: [] } });
    expect(panels.guardian.enabled).toBe(false);
    expect(panels.guardian.kind).toBeNull();
  });

  it('drops junk subjects and notes but keeps the rest', () => {
    const panels = sanitizePanels({
      student: {
        enabled: true,
        subjects: [subject('s1', ' maths '), { id: 's2' }, null, { id: 's3', name: '' }],
        explanations: [note('2026-03-02', '1'), { id: 'x', summary: 'no week' }],
      },
    });
    expect(panels.student.subjects.map((item) => item.name)).toEqual(['maths']);
    expect(panels.student.explanations).toHaveLength(1);
  });

  it('keeps what a student studies and where they are', () => {
    const panels = sanitizePanels({
      student: { enabled: true, field: '  Mathematics ', grade: 'school-11', subjects: [], explanations: [] },
      guardian: { enabled: true, kind: 'parent', field: ' Physics ', links: [] },
    });
    expect(panels.student.field).toBe('Mathematics');
    expect(panels.student.grade).toBe('school-11');
    expect(panels.guardian.field).toBe('Physics');
  });

  it('drops a grade it does not recognise, and long or blank fields', () => {
    const panels = sanitizePanels({
      student: { enabled: true, field: '   ', grade: 'year-seven', subjects: [], explanations: [] },
    });
    expect(panels.student.field).toBeNull();
    expect(panels.student.grade).toBeNull();
    // Over-long text is trimmed to a sane length rather than thrown away.
    const long = sanitizePanels({ student: { enabled: true, field: 'x'.repeat(200), grade: 'university', subjects: [], explanations: [] } });
    expect(long.student.field).toHaveLength(60);
    expect(long.student.grade).toBe('university');
  });

  it('keeps the details when a panel is merged from two devices', () => {
    const base = createEmptyState().panels;
    const local = stateWith({ ...base, student: { ...base.student, enabled: true, field: 'Law', grade: 'university', subjects: [], explanations: [] } });
    const remote = stateWith({ ...base, student: { ...base.student, enabled: false, field: null, grade: null, subjects: [], explanations: [] } });
    const merged = mergePanels(local.panels, remote.panels);
    expect(merged.student.field).toBe('Law');
    expect(merged.student.grade).toBe('university');
    const other = mergePanels(remote.panels, local.panels);
    expect(other.student.field).toBe('Law');
  });

  it('caps subjects, notes and links so a vault never outgrows its budget', () => {
    const many = Array.from({ length: 60 }, (_, index) => subject(`s${index}`, `S${index}`));
    const notes = Array.from({ length: 260 }, (_, index) => note('2026-03-02', `${index}`));
    const links = Array.from({ length: 40 }, (_, index) => ({
      id: `l${index}`,
      username: `u${index}`,
      displayName: `U${index}`,
      status: 'linked' as const,
      results: null,
    }));
    const panels = sanitizePanels({ student: { enabled: true, subjects: many, explanations: notes }, guardian: { enabled: true, kind: 'parent', links } });
    expect(panels.student.subjects.length).toBe(40);
    expect(panels.student.explanations.length).toBe(200);
    expect(panels.guardian.links.length).toBe(20);
  });
});

describe('panel merge', () => {
  it('lets students delete plans from former guardians or plans ended at least a week ago', () => {
    const base = createEmptyState().panels;
    const linkId = '12345678-1234-1234-1234-123456789abc';
    const plan: GuardianPlan = {
      id: 'old-plan', author: 'Parent', linkId, cadence: 'day', start: '2026-10-01', title: 'Old plan', note: '',
      items: [], createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
    };
    expect(studentCanDeletePlan(plan, [linkId], '2026-10-07')).toBe(false);
    expect(studentCanDeletePlan(plan, [linkId], '2026-10-08')).toBe(true);
    expect(studentCanDeletePlan(plan, ['another-guardian'], '2026-10-02')).toBe(true);
    const withPlan: Panels = {
      ...base,
      student: { ...base.student, inbox: { ...base.student.inbox, plans: [plan] } },
    };
    const deleted = withoutStudentPlan(withPlan, plan.id);
    expect(deleted.student.inbox.plans).toEqual([]);
    expect(deleted.student.deletedPlanIds).toContain(plan.id);
  });

  it('keeps a student-deleted plan out of a later cross-device merge', () => {
    const base = createEmptyState().panels;
    const plan: GuardianPlan = {
      id: 'deleted-plan', author: 'Parent', linkId: 'guardian-link', cadence: 'day', start: '2026-10-01', title: 'Old', note: '',
      items: [], createdAt: '2026-10-01T08:00:00.000Z', updatedAt: '2026-10-01T08:00:00.000Z',
    };
    const local = stateWith({
      ...base,
      student: { ...base.student, deletedPlanIds: [plan.id] },
    });
    const remote = stateWith({
      ...base,
      student: { ...base.student, inbox: { ...base.student.inbox, plans: [plan] } },
    });
    const merged = mergeStates(local, remote);
    expect(merged.panels.student.inbox.plans).toEqual([]);
    expect(merged.panels.student.deletedPlanIds).toContain(plan.id);
  });

  it('treats an added panel as added even when the other device never saw it', () => {
    const local = stateWith(withSubject(createEmptyState().panels, subject('s1', 'Biology')));
    local.panels.student.enabled = true;
    const remote = stateWith(createEmptyState().panels);
    const merged = mergeStates(local, remote);
    expect(merged.panels.student.enabled).toBe(true);
    expect(merged.panels.student.subjects.map((item) => item.name)).toEqual(['Biology']);
  });

  it('keeps the kind chosen on either device', () => {
    const base = createEmptyState().panels;
    const local = stateWith({ ...base, guardian: { ...base.guardian, enabled: true, kind: 'parent', links: [] } });
    const remote = stateWith({ ...base, guardian: { ...base.guardian, enabled: false, kind: null, links: [] } });
    expect(mergePanels(local.panels, remote.panels).guardian.kind).toBe('parent');
    expect(mergePanels(remote.panels, local.panels).guardian.kind).toBe('parent');
  });

  it('does not duplicate subjects when both devices hold the same one', () => {
    const base = createEmptyState().panels;
    const a = stateWith(withSubject(base, subject('s1', 'History')));
    const b = stateWith(withSubject(base, subject('s1', 'History')));
    expect(mergePanels(a.panels, b.panels).student.subjects).toHaveLength(1);
  });

  it('syncs learning data while keeping filed days and approvals immutable', () => {
    const base = createEmptyState().panels;
    const linkId = '12345678-1234-1234-1234-123456789abc';
    const date = '2026-10-12';
    const submittedAt = `${date}T18:00:00.000Z`;
    const approvedAt = `${date}T20:00:00.000Z`;
    const plan: GuardianPlan = {
      id: 'plan-one', author: 'Parent', linkId, cadence: 'week', start: date, title: 'Week', note: '',
      items: [{ id: 'lesson-one', title: 'Maths', date, time: null, minutes: null, subject: null, url: null, done: true }],
      createdAt: `${date}T08:00:00.000Z`, updatedAt: `${date}T19:00:00.000Z`,
    };
    const report: DayReport = {
      id: 'report-one', planId: plan.id, linkId, date, doneIds: [], note: 'Not finished.',
      createdAt: `${date}T19:30:00.000Z`, updatedAt: `${date}T19:30:00.000Z`,
    };
    const pendingAck: ReportAck = {
      id: 'ack-one', reportId: report.id, planId: plan.id, linkId, date, text: 'Seen', reactions: [],
      approvedAt: null, createdAt: approvedAt,
    };
    const approvedAck: ReportAck = { ...pendingAck, approvedAt };
    const classOne: ClassAssignment = {
      id: 'class-one', linkId, author: 'Parent', title: 'Algebra', subject: 'Math', description: '',
      videoUrl: 'https://video.example/algebra', createdAt: `${date}T08:00:00.000Z`,
    };
    const classTwo: ClassAssignment = { ...classOne, id: 'class-two', title: 'Geometry' };
    const homeworkOne: HomeworkAssignment = {
      id: 'homework-one', linkId, author: 'Parent', title: 'Exercise 1', instructions: '', subject: 'Math',
      dueAt: null, createdAt: `${date}T08:00:00.000Z`,
    };
    const homeworkTwo: HomeworkAssignment = { ...homeworkOne, id: 'homework-two', title: 'Exercise 2' };
    const photo: HomeworkPhoto = {
      url: 'https://res.cloudinary.com/demo/raw/upload/v123/file.bin',
      publicId: `planner-homework/${linkId}/abcdef0123456789abcdef01`, name: 'work.jpg', mime: 'image/jpeg', bytes: 100,
    };
    const pending: HomeworkSubmission = {
      id: 'submission-one', assignmentId: homeworkOne.id, linkId, photos: [photo], submittedAt,
      status: 'submitted', guardianNote: '', reviewedAt: null,
    };
    const approved: HomeworkSubmission = {
      ...pending, status: 'approved', photos: [], guardianNote: 'Good work.', reviewedAt: approvedAt,
    };
    const review: HomeworkReview = {
      id: 'review-one', assignmentId: homeworkOne.id, submissionId: pending.id, linkId, note: 'Good work.', approvedAt,
    };
    const oldProgress: ClassProgress = { classId: classOne.id, linkId, completedAt: null, updatedAt: `${date}T18:00:00.000Z` };
    const newProgress: ClassProgress = { ...oldProgress, completedAt: approvedAt, updatedAt: approvedAt };
    const localLink = {
      id: 'local-link-one', username: 'student', displayName: 'Student', status: 'linked' as const, history: [], linkId,
      code: null, wrappedShareKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=', results: null,
      plans: [plan], reports: [], acks: [pendingAck], classes: [classOne], homework: [homeworkOne],
      classProgress: [oldProgress], homeworkSubmissions: [pending], homeworkReviews: [],
    };
    const remoteLink = {
      ...localLink, reports: [report], acks: [approvedAck], classes: [classTwo], homework: [homeworkTwo],
      classProgress: [newProgress], homeworkSubmissions: [approved], homeworkReviews: [review],
    };
    const local: Panels = {
      ...base,
      student: {
        ...base.student, enabled: true,
        inbox: { ...base.student.inbox, plans: [plan], classes: [classOne], homework: [homeworkOne] },
        reports: [], acks: [pendingAck], classProgress: [oldProgress], homeworkSubmissions: [pending],
      },
      guardian: { ...base.guardian, enabled: true, kind: 'parent', links: [localLink] },
    };
    const remote: Panels = {
      ...base,
      student: {
        ...base.student, enabled: true,
        inbox: { ...base.student.inbox, plans: [{ ...plan, items: [{ ...plan.items[0]!, done: false }] }], classes: [classTwo], homework: [homeworkTwo] },
        reports: [report], acks: [approvedAck], classProgress: [newProgress], homeworkSubmissions: [approved],
      },
      guardian: { ...base.guardian, enabled: true, kind: 'parent', links: [remoteLink] },
    };

    const merged = mergePanels(local, remote);
    expect(merged.student.reports).toHaveLength(1);
    expect(merged.student.acks?.[0]?.approvedAt).toBe(approvedAt);
    expect(merged.student.inbox.plans[0]?.items[0]?.done).toBe(false);
    expect(merged.student.inbox.classes?.map((item) => item.id).sort()).toEqual(['class-one', 'class-two']);
    expect(merged.student.inbox.homework?.map((item) => item.id).sort()).toEqual(['homework-one', 'homework-two']);
    expect(merged.student.classProgress?.[0]?.completedAt).toBe(approvedAt);
    expect(merged.student.homeworkSubmissions?.[0]).toMatchObject({ status: 'approved', photos: [], guardianNote: 'Good work.' });
    const mergedLink = merged.guardian.links[0]!;
    expect(mergedLink.reports).toHaveLength(1);
    expect(mergedLink.acks?.[0]?.approvedAt).toBe(approvedAt);
    expect(mergedLink.plans[0]?.items[0]?.done).toBe(false);
    expect(mergedLink.classes?.map((item) => item.id).sort()).toEqual(['class-one', 'class-two']);
    expect(mergedLink.homework?.map((item) => item.id).sort()).toEqual(['homework-one', 'homework-two']);
    expect(mergedLink.classProgress?.[0]?.completedAt).toBe(approvedAt);
    expect(mergedLink.homeworkSubmissions?.[0]).toMatchObject({ status: 'approved', photos: [], guardianNote: 'Good work.' });
    expect(mergedLink.homeworkReviews?.[0]?.approvedAt).toBe(approvedAt);
  });
});

describe('weekly results', () => {
  it('counts only what belongs to this week', () => {
    const week = weekOf('2026-03-04');
    const inside = week;
    const outside = '2020-01-01';
    const state = stateWith(createEmptyState().panels, {
      tasks: [
        { ...createEmptyState().tasks, id: 't1', title: 'in', dueDate: inside, completed: true } as never,
        { ...createEmptyState().tasks, id: 't2', title: 'out', dueDate: outside, completed: true } as never,
      ],
      events: [
        { ...createEmptyState().events, id: 'e1', title: 'in', date: inside, completed: false } as never,
      ],
      focusLog: [{ id: 'f1', taskId: 't1', title: 'in', minutes: 50, date: inside, endedAt: `${inside}T10:00:00.000Z` }],
    });
    const results = weekResults(state, week);
    expect(results.planned).toBe(2);
    expect(results.done).toBe(1);
    expect(results.focusMinutes).toBe(50);
  });

  it('counts study minutes from focus sessions on that subject’s tasks', () => {
    const week = weekOf('2026-03-04');
    const state = stateWith(createEmptyState().panels, {
      tasks: [
        { id: 't1', title: 'chapter 4', category: 'Physics' },
        { id: 't2', title: 'other', category: 'Music' },
      ] as never,
      focusLog: [
        { id: 'f1', taskId: 't1', title: 'chapter 4', minutes: 45, date: week, endedAt: `${week}T10:00:00.000Z` },
        { id: 'f2', taskId: 't2', title: 'other', minutes: 30, date: week, endedAt: `${week}T11:00:00.000Z` },
      ] as never,
    });
    expect(subjectMinutes(state, subject('s1', 'physics'), week)).toBe(45);
  });

  it('keeps this week’s detail and reduces older weeks to counts', () => {
    const week = '2026-03-02';
    const panels = withExplanation(
      withExplanation(withExplanation(createEmptyState().panels, note(week, '1')), note(week, '2')),
      note('2026-02-23', '3'),
    );
    const { current, past } = splitExplanations(panels.student.explanations, week);
    expect(current).toHaveLength(2);
    expect(past).toEqual([{ week: '2026-02-23', count: 1 }]);
  });

  it('counts days to an exam, and says so when it has passed', () => {
    expect(daysUntil('2026-03-10', '2026-03-04')).toBe(6);
    expect(daysUntil('2026-03-01', '2026-03-04')).toBe(-3);
    expect(daysUntil(null, '2026-03-04')).toBeNull();
  });

  it('removing a subject leaves the planner itself alone', () => {
    const panels = withSubject(createEmptyState().panels, subject('s1', 'Chemistry'));
    const next = withoutSubject(panels, 's1');
    expect(next.student.subjects).toHaveLength(0);
    expect(next.student.enabled).toBe(panels.student.enabled);
  });
});

describe('the send queue', () => {
  const draft = { cadence: 'week' as const, start: '2026-10-12', title: 'Chemistry week', note: '', items: [] };
  const queued = (id: string): QueuedPlan => ({ id, linkId: 'link-1', draft, createdAt: `${id}T08:00:00.000Z` });

  it('parks plans oldest first and refuses more than ten', () => {
    let panels = createEmptyState().panels;
    for (let index = 0; index < 12; index += 1) panels = withQueuedPlan(panels, queued(`q${index}`));
    expect(panels.guardian.queuedPlans?.map((entry) => entry.id)).toEqual([
      'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9',
    ]);
  });

  it('drops one waiting plan by its queue id', () => {
    let panels = createEmptyState().panels;
    panels = withQueuedPlan(withQueuedPlan(panels, queued('q0')), queued('q1'));
    expect(withoutQueuedPlan(panels, 'q0').guardian.queuedPlans?.map((entry) => entry.id)).toEqual(['q1']);
    expect(withoutQueuedPlan(panels, 'missing')).toBe(panels);
  });

  it('files flushed plans and lifts them from the queue', () => {
    const plan = (id: string): GuardianPlan => ({
      id, author: 'Dr Noor', linkId: 'link-1', cadence: 'week', start: '2026-10-12', title: 'Chemistry week',
      note: '', field: null, grade: null, restDays: [], items: [],
      createdAt: '2026-10-12T08:00:00.000Z', updatedAt: '2026-10-12T08:00:00.000Z',
    });
    const empty = createEmptyState().panels;
    const link = {
      id: 'nina', username: 'nina', displayName: 'Nina', status: 'linked' as const, history: [],
      linkId: 'link-1', code: null, wrappedShareKey: null, results: null, plans: [] as GuardianPlan[],
    };
    const base = { ...empty, guardian: { ...empty.guardian, links: [link] } };
    const before = withQueuedPlan(withQueuedPlan(base, queued('q0')), queued('q1'));
    const after = withLinkPlan(withoutQueuedPlan(withoutQueuedPlan(before, 'q0'), 'q1'), 'link-1', plan('plan-9'));
    const filed = withFlushedPlans(before, before, after);
    expect(filed.guardian.queuedPlans ?? []).toEqual([]);
    expect(filed.guardian.links[0]?.plans.map((entry) => entry.id)).toEqual(['plan-9']);
    expect(withFlushedPlans(before, before, before)).toBe(before);
  });

  it('keeps waiting plans through a save and load round trip', () => {
    const panels = withQueuedPlan(createEmptyState().panels, {
      id: 'q0',
      linkId: 'link-1',
      draft: { ...draft, items: [{ title: 'Acids', date: '2026-10-13', time: '08:00', minutes: null, subject: null, url: null }] },
      createdAt: '2026-10-12T08:00:00.000Z',
    });
    const round = sanitizeState(JSON.parse(JSON.stringify(stateWith(panels))));
    expect(round?.panels.guardian.queuedPlans?.[0]?.draft.title).toBe('Chemistry week');
    expect(round?.panels.guardian.queuedPlans?.[0]?.draft.items[0]?.title).toBe('Acids');
  });

  it('drops waiting plans that lost their shape', () => {
    const panels = sanitizePanels({
      guardian: { enabled: false, kind: null, field: null, links: [], notices: [], queuedPlans: [{ id: 'q0' }, null, 'junk'] },
    });
    expect(panels.guardian.queuedPlans ?? []).toEqual([]);
  });
});
