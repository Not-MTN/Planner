import { useState, type FormEvent } from 'react';
import { usePlanner } from '../context';
import { formatFullDate } from '../dates';
import { faNum, t } from '../i18n';
import { CheckIcon, UploadIcon } from '../icons';
import { withStudentClassProgress } from '../learning';
import { HOMEWORK_PHOTOS_MAX } from '../types';
import type { ClassAssignment, HomeworkAssignment, HomeworkPhoto, Panels } from '../types';
import { syncStudentInbox, submitHomework } from '../auth/links';
import { uploadEncryptedHomeworkPhoto, deleteHomeworkPhotoAssets, HOMEWORK_PHOTO_MAX_BYTES } from '../homeworkMedia';
import '../panels.css';
import './learning.css';
import { ClassVideoPlayer } from './ClassVideoPlayer';

function formatDue(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function syncStudentFields(current: Panels, synced: Panels) {
  return {
    ...current,
    student: {
      ...current.student,
      inbox: {
        ...current.student.inbox,
        notices: synced.student.inbox.notices,
        plans: synced.student.inbox.plans,
        goals: synced.student.inbox.goals,
        classes: synced.student.inbox.classes,
        homework: synced.student.inbox.homework,
      },
      acks: synced.student.acks,
      classProgress: synced.student.classProgress,
      homeworkSubmissions: synced.student.homeworkSubmissions,
    },
  };
}

function HomeworkUploadForm({ assignment }: { assignment: HomeworkAssignment }) {
  const { panels, state, updatePanels, flash } = usePlanner();
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const upload = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setError('');
    if (files.length < 1 || files.length > HOMEWORK_PHOTOS_MAX) {
      setError(t('Choose one to three photos.'));
      return;
    }
    const guardian = panels.student.guardians.find((item) => item.linkId === assignment.linkId);
    if (!guardian) {
      setError(t('This homework link is no longer active.'));
      return;
    }
    setSending(true);
    const photos: HomeworkPhoto[] = [];
    let submissionSaved = false;
    try {
      for (const file of files) {
        if (file.size > HOMEWORK_PHOTO_MAX_BYTES) throw new Error(t('Each photo must be 8 MB or smaller.'));
        photos.push(await uploadEncryptedHomeworkPhoto(assignment.linkId, guardian.wrappedShareKey, file));
      }
      const next = submitHomework(panels, assignment.id, photos);
      if (next === panels) throw new Error(t('This homework already has a submission.'));
      const submission = next.student.homeworkSubmissions?.find((item) => item.assignmentId === assignment.id);
      if (!submission) throw new Error(t('This homework already has a submission.'));
      updatePanels((current) => current.student.homeworkSubmissions?.some((item) => item.assignmentId === assignment.id)
        ? current
        : {
            ...current,
            student: {
              ...current.student,
              homeworkSubmissions: [submission, ...(current.student.homeworkSubmissions ?? [])].slice(0, 30),
            },
          });
      submissionSaved = true;
      setFiles([]);
      const synced = await syncStudentInbox(next, state.goals);
      updatePanels((current) => syncStudentFields(current, synced.panels));
      flash(t('Homework sent to your guardian. Your photos stay encrypted until they review them.'));
    } catch (caught) {
      if (!submissionSaved && photos.length > 0) void deleteHomeworkPhotoAssets(assignment.linkId, photos).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : t('Those photos could not be uploaded. Try again.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <form className="learning-upload-form" onSubmit={(event) => void upload(event)}>
      <label className="field">
        <span>{t('Photo(s) of your work')}</span>
        <input
          className="input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={sending}
          onChange={(event) => setFiles(Array.from(event.target.files ?? []).slice(0, HOMEWORK_PHOTOS_MAX))}
        />
      </label>
      <p className="learning-privacy">{t('Photos are encrypted on this device before upload. Your guardian deletes the photo files after approval; only the approval or their note remains.')}</p>
      {files.length > 0 ? <p className="hint">{t('{0} of {1} photos selected', { 0: faNum(files.length), 1: HOMEWORK_PHOTOS_MAX })}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button type="submit" className="btn btn-primary btn-small" disabled={sending || files.length === 0}>
        {sending ? <span className="spinner" aria-hidden="true" /> : <UploadIcon size={14} />}
        {sending ? t('Encrypting and sending…') : t('Send homework')}
      </button>
    </form>
  );
}

function ClassCard({ assignment }: { assignment: ClassAssignment }) {
  const { panels, state, updatePanels } = usePlanner();
  const progress = panels.student.classProgress?.find((item) => item.classId === assignment.id && item.linkId === assignment.linkId);
  const completed = !!progress?.completedAt;
  const toggle = () => {
    const now = new Date().toISOString();
    const next = withStudentClassProgress(panels, {
      classId: assignment.id,
      linkId: assignment.linkId,
      completedAt: completed ? null : now,
      updatedAt: now,
    });
    updatePanels(next);
    void syncStudentInbox(next, state.goals)
      .then((synced) => updatePanels((current) => syncStudentFields(current, synced.panels)))
      .catch(() => undefined);
  };
  return (
    <li className={`learning-card ${completed ? 'is-complete' : 'is-incomplete'}`}>
      <div className="learning-card-head">
        <div>
          <p className="learning-kicker">{assignment.subject || t('Class')}</p>
          <h3>{assignment.title}</h3>
        </div>
        <span className={`learning-state ${completed ? 'is-complete' : 'is-incomplete'}`}>
          {completed ? t('Completed') : t('To do')}
        </span>
      </div>
      {assignment.description ? <p className="learning-description">{assignment.description}</p> : null}
      <ClassVideoPlayer videoUrl={assignment.videoUrl} title={assignment.title} />
      <div className="learning-card-actions">
        <button type="button" className="btn btn-ghost btn-small" aria-pressed={completed} onClick={toggle}>
          <CheckIcon size={14} /> {completed ? t('Mark not done') : t('Mark complete')}
        </button>
      </div>
      <p className="learning-privacy">{t('Video is hosted by the linked service; Planner stores only this link.')}</p>
    </li>
  );
}

function HomeworkCard({ assignment }: { assignment: HomeworkAssignment }) {
  const { panels } = usePlanner();
  const submission = panels.student.homeworkSubmissions?.find((item) => item.assignmentId === assignment.id);
  const due = formatDue(assignment.dueAt);
  return (
    <li className={`learning-card homework-card ${submission?.status === 'approved' ? 'is-complete' : 'is-incomplete'}`}>
      <div className="learning-card-head">
        <div>
          <p className="learning-kicker">{assignment.subject || t('Homework')}</p>
          <h3>{assignment.title}</h3>
        </div>
        <span className={`learning-state ${submission?.status === 'approved' ? 'is-complete' : 'is-incomplete'}`}>
          {submission?.status === 'approved' ? t('Approved') : submission ? t('Submitted') : t('To do')}
        </span>
      </div>
      {assignment.instructions ? <p className="learning-description">{assignment.instructions}</p> : null}
      <p className="learning-meta">
        <span>{t('From {0}', { 0: assignment.author })}</span>
        {due ? <span>{t('Due {0}', { 0: due })}</span> : <span>{t('No due time')}</span>}
      </p>
      {submission ? (
        <div className="homework-submission-summary">
          <p>{t('Sent {0}', { 0: formatFullDate(submission.submittedAt.slice(0, 10)) })} · {t('{0} photos', { 0: faNum(submission.photos.length) })}</p>
          {submission.status === 'approved' ? <p className="learning-privacy">{submission.guardianNote || t('Your guardian approved this work. The photo files were deleted.')}</p> : <p className="learning-privacy">{t('Waiting for your guardian to review. Photos are hidden from the submitted list.')}</p>}
        </div>
      ) : (
        <HomeworkUploadForm assignment={assignment} />
      )}
    </li>
  );
}

export function StudentLearningHub() {
  const { panels } = usePlanner();
  const classes = panels.student.inbox.classes ?? [];
  const homework = panels.student.inbox.homework ?? [];
  return (
    <div className="learning-hub">
      <section className="card learning-section" aria-label={t('Classes assigned to you')}>
        <header className="card-head">
          <div>
            <p className="kicker">{t('Classes')}</p>
            <h2 className="card-title">{t('Lessons from your guardians')}</h2>
          </div>
          <span className="learning-count">{faNum(classes.length)}</span>
        </header>
        {classes.length ? (
          <ul className="learning-list">{classes.map((assignment) => <ClassCard key={assignment.id} assignment={assignment} />)}</ul>
        ) : <p className="empty-note">{t('No classes have been assigned to you yet.')}</p>}
      </section>
      <section className="card learning-section" aria-label={t('Homework assigned to you')}>
        <header className="card-head">
          <div>
            <p className="kicker">{t('Homework')}</p>
            <h2 className="card-title">{t('Your assignments')}</h2>
          </div>
          <span className="learning-count">{faNum(homework.length)}</span>
        </header>
        {homework.length ? (
          <ul className="learning-list">{homework.map((assignment) => <HomeworkCard key={assignment.id} assignment={assignment} />)}</ul>
        ) : <p className="empty-note">{t('No homework has been assigned to you yet.')}</p>}
      </section>
    </div>
  );
}
