import { describe, expect, it } from 'vitest';
import { sanitizeClassAssignment, sanitizeHomeworkPhoto, sanitizeHomeworkSubmission, withGuardianHomeworkReview } from './learning';
import { sanitizePanels } from './storage';
import { createEmptyPanels } from './types';
import type { ClassAssignment, GuardianLink, HomeworkAssignment, HomeworkPhoto, HomeworkReview, HomeworkSubmission, Panels } from './types';

const linkId = '12345678-1234-1234-1234-123456789abc';
const wrappedShareKey = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const now = '2026-10-12T20:00:00.000Z';
const photo: HomeworkPhoto = {
  url: `https://res.cloudinary.com/demo/raw/upload/v123/planner-homework/${linkId}/abcdef0123456789abcdef01.bin`,
  publicId: `planner-homework/${linkId}/abcdef0123456789abcdef01`,
  name: 'work.jpg',
  mime: 'image/jpeg',
  bytes: 2048,
};
const classAssignment: ClassAssignment = {
  id: 'class-one', linkId, author: 'A guardian', title: 'Algebra', subject: 'Math',
  description: 'Watch the lesson.', videoUrl: 'https://video.example/lesson', createdAt: now,
};
const homework: HomeworkAssignment = {
  id: 'homework-one', linkId, author: 'A guardian', title: 'Exercise 2', instructions: 'Show your steps.',
  subject: 'Math', dueAt: null, createdAt: now,
};
const pending: HomeworkSubmission = {
  id: 'submission-one', assignmentId: homework.id, linkId, photos: [photo], submittedAt: now,
  status: 'submitted', guardianNote: '', reviewedAt: null,
};
const guardianLink: GuardianLink = {
  id: 'local-link-one', username: 'student', displayName: 'Student', status: 'linked', history: [],
  linkId, code: null, wrappedShareKey, results: null, plans: [], classes: [classAssignment], homework: [homework],
  classProgress: [{ classId: classAssignment.id, linkId, completedAt: now, updatedAt: now }],
  homeworkSubmissions: [pending], homeworkReviews: [],
};
const guardianReview: HomeworkReview = {
  id: 'review-one', assignmentId: homework.id, submissionId: pending.id, linkId, note: 'Well done.', approvedAt: now,
};

function panelsWithLearning(): Panels {
  const empty = createEmptyPanels();
  return {
    ...empty,
    student: {
      ...empty.student,
      enabled: true,
      field: 'Math',
      grade: 'other',
      guardians: [{ linkId, guardianUsername: 'guardian', guardianDisplayName: 'Guardian', wrappedShareKey, sharedWeek: null }],
      inbox: { notices: [], plans: [], classes: [classAssignment], homework: [homework] },
      classProgress: [{ classId: classAssignment.id, linkId, completedAt: now, updatedAt: now }],
      homeworkSubmissions: [pending],
    },
    guardian: { ...empty.guardian, enabled: true, kind: 'parent', field: 'Math', links: [guardianLink] },
  };
}

describe('learning assignments and photo retention', () => {
  it('accepts HTTPS class links and rejects active content or insecure URLs', () => {
    expect(sanitizeClassAssignment(classAssignment)).toEqual(classAssignment);
    expect(sanitizeClassAssignment({ ...classAssignment, videoUrl: 'javascript:alert(1)' })).toBeNull();
    expect(sanitizeClassAssignment({ ...classAssignment, videoUrl: 'http://video.example/lesson' })).toBeNull();
  });

  it('accepts only opaque Cloudinary photo pointers', () => {
    expect(sanitizeHomeworkPhoto(photo)).toEqual(photo);
    expect(sanitizeHomeworkPhoto({ ...photo, url: 'data:image/jpeg;base64,AA==' })).toBeNull();
    expect(sanitizeHomeworkPhoto({ ...photo, publicId: 'other-link/file' })).toBeNull();
  });

  it('keeps assignments and per-link progress through local storage sanitization', () => {
    const safe = sanitizePanels(panelsWithLearning());
    expect(safe.student.inbox.classes).toEqual([classAssignment]);
    expect(safe.student.inbox.homework).toEqual([homework]);
    expect(safe.student.classProgress).toEqual([{ classId: classAssignment.id, linkId, completedAt: now, updatedAt: now }]);
    expect(safe.student.homeworkSubmissions?.[0]?.photos).toEqual([photo]);
    expect(safe.guardian.links[0]?.classes).toEqual([classAssignment]);
    expect(safe.guardian.links[0]?.homework).toEqual([homework]);
    expect(safe.guardian.links[0]?.classProgress?.[0]?.classId).toBe(classAssignment.id);
    expect(safe.guardian.links[0]?.homeworkSubmissions?.[0]?.photos).toEqual([photo]);
  });

  it('strips submitted photo pointers on approval and preserves only status and note', () => {
    const approved = withGuardianHomeworkReview(panelsWithLearning(), guardianReview);
    const guardianSubmission = approved.guardian.links[0]?.homeworkSubmissions?.[0];
    expect(guardianSubmission).toMatchObject({ status: 'approved', photos: [], guardianNote: 'Well done.', reviewedAt: now });
    const studentCopy = sanitizeHomeworkSubmission({ ...pending, status: 'approved', guardianNote: 'Well done.', reviewedAt: now, photos: [photo] });
    expect(studentCopy).toMatchObject({ status: 'approved', photos: [], guardianNote: 'Well done.' });
    const safe = sanitizePanels({ ...approved, student: { ...approved.student, homeworkSubmissions: [studentCopy] } });
    expect(safe.student.homeworkSubmissions?.[0]).toMatchObject({ status: 'approved', photos: [], guardianNote: 'Well done.' });
  });
});
