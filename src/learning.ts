/**
 * Safe shapes and small state transitions for student-specific classes and
 * guardian-set homework. Video and photo bytes never enter planner state: class
 * URLs point to existing hosts, while homework photos are encrypted in the
 * browser and live as opaque Cloudinary files until approval deletes them.
 */
import { HOMEWORK_ITEMS_KEPT, HOMEWORK_NOTE_MAX, HOMEWORK_PHOTOS_MAX } from './types';
import type {
  ClassAssignment,
  ClassProgress,
  HomeworkAssignment,
  HomeworkPhoto,
  HomeworkReview,
  HomeworkSubmission,
  Panels,
} from './types';

const TEXT = {
  title: 120,
  author: 60,
  subject: 60,
  description: 400,
  linkId: 64,
  id: 80,
  name: 160,
};

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

/** HTTPS only: a class points to a video host, it is never an uploaded blob. */
export function normalizeClassVideoUrl(value: string): string | null {
  const trimmed = value.trim().slice(0, 500);
  if (!trimmed) return null;
  const withScheme = trimmed.includes('://') ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function sanitizeClassAssignment(value: unknown): ClassAssignment | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, TEXT.id);
  const linkId = text(raw.linkId, TEXT.linkId);
  const title = text(raw.title, TEXT.title);
  const videoUrl = normalizeClassVideoUrl(String(raw.videoUrl ?? ''));
  const createdAt = timestamp(raw.createdAt);
  if (!id || !linkId || !title || !videoUrl || !createdAt) return null;
  return {
    id,
    linkId,
    author: text(raw.author, TEXT.author),
    title,
    subject: text(raw.subject, TEXT.subject),
    description: text(raw.description, TEXT.description),
    videoUrl,
    createdAt,
  };
}

export function sanitizeHomeworkAssignment(value: unknown): HomeworkAssignment | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, TEXT.id);
  const linkId = text(raw.linkId, TEXT.linkId);
  const title = text(raw.title, TEXT.title);
  const createdAt = timestamp(raw.createdAt);
  if (!id || !linkId || !title || !createdAt) return null;
  const dueAt = raw.dueAt === null || raw.dueAt === undefined || raw.dueAt === '' ? null : timestamp(raw.dueAt);
  if (raw.dueAt && !dueAt) return null;
  return {
    id,
    linkId,
    author: text(raw.author, TEXT.author),
    title,
    instructions: text(raw.instructions, TEXT.description),
    subject: text(raw.subject, TEXT.subject),
    dueAt,
    createdAt,
  };
}

/** Only ciphertext blobs on the expected Cloudinary host survive the wire. */
export function sanitizeHomeworkPhoto(value: unknown): HomeworkPhoto | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const urlText = text(raw.url, 1000);
  let url: URL;
  try {
    url = new URL(urlText);
  } catch {
    return null;
  }
  const publicId = text(raw.publicId, 180);
  const name = text(raw.name, TEXT.name) || 'homework-photo.jpg';
  const mime = raw.mime === 'image/jpeg' || raw.mime === 'image/png' || raw.mime === 'image/webp' ? raw.mime : '';
  const bytes = typeof raw.bytes === 'number' && Number.isFinite(raw.bytes) ? Math.round(raw.bytes) : 0;
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'res.cloudinary.com' ||
    !url.pathname.includes('/raw/upload/') ||
    !/^planner-homework\/[a-f0-9-]{8,64}\/[a-f0-9]{24}$/.test(publicId) ||
    !mime ||
    bytes < 1 ||
    bytes > 8 * 1024 * 1024
  ) return null;
  return { url: url.toString(), publicId, name, mime, bytes };
}

export function sanitizeHomeworkSubmission(value: unknown): HomeworkSubmission | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, TEXT.id);
  const assignmentId = text(raw.assignmentId, TEXT.id);
  const linkId = text(raw.linkId, TEXT.linkId);
  const submittedAt = timestamp(raw.submittedAt);
  if (!id || !assignmentId || !linkId || !submittedAt) return null;
  const status = raw.status === 'approved' ? 'approved' : 'submitted';
  const photos = status === 'approved'
    ? []
    : (Array.isArray(raw.photos) ? raw.photos : [])
      .flatMap((photo) => {
        const clean = sanitizeHomeworkPhoto(photo);
        return clean ? [clean] : [];
      })
      .slice(0, HOMEWORK_PHOTOS_MAX);
  return {
    id,
    assignmentId,
    linkId,
    photos,
    submittedAt,
    status,
    guardianNote: text(raw.guardianNote, HOMEWORK_NOTE_MAX),
    reviewedAt: status === 'approved' ? timestamp(raw.reviewedAt) : null,
  };
}

export function sanitizeHomeworkReview(value: unknown): HomeworkReview | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const id = text(raw.id, TEXT.id);
  const assignmentId = text(raw.assignmentId, TEXT.id);
  const submissionId = text(raw.submissionId, TEXT.id);
  const linkId = text(raw.linkId, TEXT.linkId);
  const approvedAt = timestamp(raw.approvedAt);
  if (!id || !assignmentId || !submissionId || !linkId || !approvedAt) return null;
  return { id, assignmentId, submissionId, linkId, note: text(raw.note, HOMEWORK_NOTE_MAX), approvedAt };
}

export function sanitizeClassProgress(value: unknown): ClassProgress | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const classId = text(raw.classId, TEXT.id);
  const linkId = text(raw.linkId, TEXT.linkId);
  const updatedAt = timestamp(raw.updatedAt);
  if (!classId || !linkId || !updatedAt) return null;
  const completedAt = raw.completedAt === null || raw.completedAt === undefined ? null : timestamp(raw.completedAt);
  if (raw.completedAt && !completedAt) return null;
  return { classId, linkId, completedAt, updatedAt };
}

function mergeBy<T>(current: T[], incoming: T[], keyOf: (item: T) => string, limit = HOMEWORK_ITEMS_KEPT): T[] {
  const byKey = new Map(current.map((item) => [keyOf(item), item]));
  for (const item of incoming) byKey.set(keyOf(item), item);
  return [...byKey.values()].slice(-limit);
}

export function withLinkClass(panels: Panels, linkId: string, assignment: ClassAssignment): Panels {
  const links = panels.guardian.links.map((link) => link.linkId !== linkId
    ? link
    : { ...link, classes: mergeBy(link.classes ?? [], [assignment], (item) => item.id) });
  return { ...panels, guardian: { ...panels.guardian, links } };
}

/** Remove a class from the guardian's assignment and progress lists. */
export function withoutLinkClass(panels: Panels, linkId: string, classId: string): Panels {
  const links = panels.guardian.links.map((link) => link.linkId !== linkId
    ? link
    : {
        ...link,
        classes: (link.classes ?? []).filter((item) => item.id !== classId),
        classProgress: (link.classProgress ?? []).filter((item) => item.classId !== classId),
      });
  return { ...panels, guardian: { ...panels.guardian, links } };
}

/** Map supported hosted links to a safe in-app player source. */
export function classPlayerSource(value: string): { kind: 'video' | 'embed'; src: string } | null {
  const secure = normalizeClassVideoUrl(value);
  if (!secure) return null;
  const url = new URL(secure);
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com' || host === 'youtu.be') {
    const segments = url.pathname.split('/').filter(Boolean);
    const id = host === 'youtu.be'
      ? segments[0]
      : url.searchParams.get('v') || (['embed', 'shorts', 'live'].includes(segments[0] ?? '') ? segments[1] : '');
    return id && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${id}?playsinline=1` }
      : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = url.pathname.match(/(?:^|\/)video\/(\d+)|(?:^|\/)(\d+)(?:$|\/)/);
    const id = match?.[1] || match?.[2];
    if (!id) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const privacyHash = url.searchParams.get('h') || (segments[0] === id ? segments[1] : '');
    const query = privacyHash && /^[A-Za-z0-9]+$/.test(privacyHash) ? `?h=${encodeURIComponent(privacyHash)}` : '';
    return { kind: 'embed', src: `https://player.vimeo.com/video/${id}${query}` };
  }
  if (host === 'aparat.com') {
    const segments = url.pathname.split('/').filter(Boolean);
    const embedMatch = url.pathname.match(/\/videohash\/([A-Za-z0-9_-]+)/i);
    const id = embedMatch?.[1]
      || (segments[0] === 'v' ? segments[1] : '')
      || (segments.length === 3 && segments[1] === 'video' ? segments[2] : '');
    return id && /^[A-Za-z0-9_-]{4,64}$/.test(id)
      ? { kind: 'embed', src: `https://www.aparat.com/video/video/embed/videohash/${id}/vt/frame` }
      : null;
  }
  const iranianVideoHosts = [
    'namasha.com', 'namasha.ir', 'tamasha.com', 'telewebion.com',
    'filimo.com', 'namava.ir', 'rubika.ir', 'rubika.com',
  ];
  if (iranianVideoHosts.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    // Use provider-supplied embed URLs when present, otherwise try the HTTPS page itself.
    // Providers that disallow framing remain available through the external-link fallback.
    return { kind: 'embed', src: secure };
  }
  if (host === 'drive.google.com') {
    const id = url.pathname.match(/\/file\/d\/([A-Za-z0-9_-]+)/)?.[1] || url.searchParams.get('id');
    return id && /^[A-Za-z0-9_-]{10,}$/.test(id)
      ? { kind: 'embed', src: `https://drive.google.com/file/d/${id}/preview` }
      : null;
  }
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) return { kind: 'video', src: secure };
  return null;
}

export function withLinkHomework(panels: Panels, linkId: string, assignment: HomeworkAssignment): Panels {
  const links = panels.guardian.links.map((link) => link.linkId !== linkId
    ? link
    : { ...link, homework: mergeBy(link.homework ?? [], [assignment], (item) => item.id) });
  return { ...panels, guardian: { ...panels.guardian, links } };
}

export function withGuardianClassProgress(panels: Panels, linkId: string, progress: ClassProgress): Panels {
  const links = panels.guardian.links.map((link) => link.linkId !== linkId
    ? link
    : { ...link, classProgress: mergeBy(link.classProgress ?? [], [progress], (item) => item.classId) });
  return { ...panels, guardian: { ...panels.guardian, links } };
}

export function withGuardianHomeworkSubmission(panels: Panels, submission: HomeworkSubmission): Panels {
  const links = panels.guardian.links.map((link) => link.linkId !== submission.linkId
    ? link
    : { ...link, homeworkSubmissions: mergeBy(link.homeworkSubmissions ?? [], [submission], (item) => item.id) });
  return { ...panels, guardian: { ...panels.guardian, links } };
}

export function withGuardianHomeworkReview(panels: Panels, review: HomeworkReview): Panels {
  const links = panels.guardian.links.map((link) => {
    if (link.linkId !== review.linkId) return link;
    const reviews = mergeBy(link.homeworkReviews ?? [], [review], (item) => item.submissionId);
    const submissions = (link.homeworkSubmissions ?? []).map((submission) => submission.id !== review.submissionId
      ? submission
      : { ...submission, status: 'approved' as const, photos: [], guardianNote: review.note, reviewedAt: review.approvedAt });
    return { ...link, homeworkReviews: reviews, homeworkSubmissions: submissions };
  });
  return { ...panels, guardian: { ...panels.guardian, links } };
}

export function withStudentClassProgress(panels: Panels, progress: ClassProgress): Panels {
  const classProgress = mergeBy(panels.student.classProgress ?? [], [progress], (item) => `${item.linkId}:${item.classId}`);
  return { ...panels, student: { ...panels.student, classProgress } };
}

export function withStudentHomeworkSubmission(panels: Panels, submission: HomeworkSubmission): Panels {
  if ((panels.student.homeworkSubmissions ?? []).some((item) => item.assignmentId === submission.assignmentId)) return panels;
  const homeworkSubmissions = mergeBy(panels.student.homeworkSubmissions ?? [], [submission], (item) => item.id);
  return { ...panels, student: { ...panels.student, homeworkSubmissions } };
}

export function withStudentHomeworkReview(panels: Panels, review: HomeworkReview): Panels {
  const homeworkSubmissions = (panels.student.homeworkSubmissions ?? []).map((submission) => submission.id !== review.submissionId
    ? submission
    : { ...submission, status: 'approved' as const, photos: [], guardianNote: review.note, reviewedAt: review.approvedAt });
  return { ...panels, student: { ...panels.student, homeworkSubmissions } };
}
