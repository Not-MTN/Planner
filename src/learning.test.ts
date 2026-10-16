import { describe, expect, it } from 'vitest';
import { classPlayerSource, sanitizeClassAssignment, sanitizeHomeworkPhoto, sanitizeHomeworkSubmission, withGuardianHomeworkReview, withoutLinkClass } from './learning';
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

  it('maps supported hosted video links to safe in-app player URLs', () => {
    expect(classPlayerSource('https://youtu.be/abcdefghijk')).toEqual({ kind: 'embed', src: 'https://www.youtube-nocookie.com/embed/abcdefghijk?playsinline=1' });
    expect(classPlayerSource('https://vimeo.com/123456789')).toEqual({ kind: 'embed', src: 'https://player.vimeo.com/video/123456789' });
    expect(classPlayerSource('https://vimeo.com/123456789/abcDEF')).toEqual({ kind: 'embed', src: 'https://player.vimeo.com/video/123456789?h=abcDEF' });
    expect(classPlayerSource('https://drive.google.com/file/d/abcdefghijk/view')).toEqual({ kind: 'embed', src: 'https://drive.google.com/file/d/abcdefghijk/preview' });
    expect(classPlayerSource('https://www.aparat.com/v/AbC123x')).toEqual({ kind: 'embed', src: 'https://www.aparat.com/video/video/embed/videohash/AbC123x/vt/frame' });
    expect(classPlayerSource('https://www.aparat.com/video/video/embed/videohash/AbC123x/vt/frame')).toEqual({ kind: 'embed', src: 'https://www.aparat.com/video/video/embed/videohash/AbC123x/vt/frame' });
    for (const url of [
      'https://namasha.com/v/1234',
      'https://tamasha.com/v/1234',
      'https://telewebion.com/episode/1234',
      'https://www.filimo.com/m/1234',
      'https://www.namava.ir/vod/1234',
      'https://rubika.ir/video/1234',
    ]) {
      expect(classPlayerSource(url)).toEqual({ kind: 'embed', src: url });
    }
    expect(classPlayerSource('https://cdn.example.org/lesson.mp4')).toEqual({ kind: 'video', src: 'https://cdn.example.org/lesson.mp4' });
    expect(classPlayerSource('https://video.example/watch?id=unknown')).toBeNull();
  });

  it('removes a class and its progress only from the selected guardian link', () => {
    const panels = panelsWithLearning();
    const next = withoutLinkClass(panels, linkId, classAssignment.id);
    expect(next.guardian.links[0]?.classes).toEqual([]);
    expect(next.guardian.links[0]?.classProgress).toEqual([]);
    expect(next.student.inbox.classes).toEqual([classAssignment]);
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
