import { useEffect, useState, type FormEvent } from 'react';
import { usePlanner } from '../context';
import { CheckIcon, TrashIcon, UploadIcon } from '../icons';
import { t, faNum } from '../i18n';
import { normalizeClassVideoUrl } from '../learning';
import { approveHomeworkSubmission, dropClass, sendClass, sendHomeworkAssignment } from '../auth/links';
import { decryptHomeworkPhoto } from '../homeworkMedia';
import './learning.css';
import { ClassVideoPlayer } from './ClassVideoPlayer';
import type { ClassAssignment, GuardianLink, HomeworkPhoto, HomeworkSubmission } from '../types';

function dueText(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
}

function SelectedStudents({
  students,
  selected,
  onChange,
}: {
  students: GuardianLink[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  if (!students.length) return <p className="empty-note">{t('No linked students are ready for assignments yet.')}</p>;
  return (
    <fieldset className="assignment-student-picker">
      <legend>{t('Give access to selected students')}</legend>
      <div className="assignment-student-options">
        {students.map((student) => (
          <label className="assignment-student-option" key={student.id}>
            <input
              type="checkbox"
              checked={selected.includes(student.id)}
              onChange={(event) => onChange(event.target.checked
                ? [...selected, student.id]
                : selected.filter((id) => id !== student.id))}
            />
            <span>{student.displayName || student.username}</span>
            <small><bdi>@{student.username}</bdi></small>
          </label>
        ))}
      </div>
      <p className="learning-privacy">{t('Each selected student gets their own assignment and approval status.')}</p>
    </fieldset>
  );
}

function ClassAssignmentCard({ assignment, link }: { assignment: ClassAssignment; link: GuardianLink }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [busy, setBusy] = useState(false);
  const progress = link.classProgress?.find((item) => item.classId === assignment.id);
  const completed = !!progress?.completedAt;
  const remove = async () => {
    if (busy || !link.linkId) return;
    setBusy(true);
    try {
      updatePanels(await dropClass(panels, link.linkId, assignment.id));
      flash(t('Class removed from the student and your list.'));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('The class could not be removed.'));
    } finally {
      setBusy(false);
    }
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
        <span className="learning-meta">{t('Assigned {0}', { 0: dueText(assignment.createdAt) ?? assignment.createdAt.slice(0, 10) })}</span>
        <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => void remove()}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <TrashIcon size={14} />}{t('Remove class')}
        </button>
      </div>
      <p className="learning-privacy">{t('Planner keeps only the video link, not the video file.')}</p>
    </li>
  );
}

function PhotoPreview({ photo, wrappedShareKey }: { photo: HomeworkPhoto; wrappedShareKey: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void decryptHomeworkPhoto(wrappedShareKey, photo)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setSrc(objectUrl);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photo, wrappedShareKey]);
  if (failed) return <span className="homework-photo-failed">{t('Photo could not be opened.')}</span>;
  if (!src) return <span className="homework-photo-loading">{t('Opening encrypted photo…')}</span>;
  return <img className="homework-photo-preview" src={src} alt={photo.name} />;
}

function HomeworkReviewCard({ submission, link }: { submission: HomeworkSubmission; link: GuardianLink }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [note, setNote] = useState(submission.guardianNote);
  const [busy, setBusy] = useState(false);
  const assignment = link.homework?.find((item) => item.id === submission.assignmentId);
  const approve = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !link.linkId) return;
    setBusy(true);
    try {
      const next = await approveHomeworkSubmission(panels, link.linkId, submission.id, note);
      updatePanels(next);
      flash(t('Homework approved. Photo files were deleted.'));
    } catch (error) {
      flash(error instanceof Error ? error.message : t('The homework could not be approved.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={`learning-card homework-review-card ${submission.status === 'approved' ? 'is-complete' : 'is-incomplete'}`}>
      <div className="learning-card-head">
        <div>
          <p className="learning-kicker">{assignment?.subject || t('Homework')} · <bdi>@{link.username}</bdi></p>
          <h3>{assignment?.title || t('Homework submission')}</h3>
        </div>
        <span className={`learning-state ${submission.status === 'approved' ? 'is-complete' : 'is-incomplete'}`}>
          {submission.status === 'approved' ? t('Approved') : t('Needs review')}
        </span>
      </div>
      <p className="learning-meta">{t('Submitted {0}', { 0: new Date(submission.submittedAt).toLocaleString() })}</p>
      {submission.status === 'submitted' && submission.photos.length > 0 ? (
        <div className="homework-photo-grid" aria-label={t('Submitted homework photos')}>
          {submission.photos.map((photo) => <PhotoPreview key={photo.publicId} photo={photo} wrappedShareKey={link.wrappedShareKey ?? ''} />)}
        </div>
      ) : null}
      {submission.status === 'approved' ? (
        <p className="learning-privacy">{submission.guardianNote || t('Approved. Submitted photos were deleted.')}</p>
      ) : (
        <form className="learning-upload-form" onSubmit={(event) => void approve(event)}>
          <label className="field">
            <span>{t('Optional note for the student')}</span>
            <textarea className="input" rows={2} maxLength={280} value={note} disabled={busy} onChange={(event) => setNote(event.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary btn-small" disabled={busy || !link.wrappedShareKey}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <CheckIcon size={14} />}
            {busy ? t('Deleting photos and approving…') : t('Approve and delete photos')}
          </button>
          <p className="learning-privacy">{t('The original photos are deleted from their host before the approval and note are saved.')}</p>
        </form>
      )}
    </li>
  );
}

export function GuardianAssignments({ link }: { link: GuardianLink }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [mode, setMode] = useState<'classes' | 'homework'>('classes');
  const availableStudents = panels.guardian.links.filter((student) => student.status === 'linked' && !!student.linkId && !!student.wrappedShareKey);
  const activeCanAssign = availableStudents.some((student) => student.id === link.id);
  const [selectedIds, setSelectedIds] = useState<string[]>(activeCanAssign ? [link.id] : []);
  const [classDraft, setClassDraft] = useState({ title: '', subject: '', description: '', videoUrl: '' });
  const [homeworkDraft, setHomeworkDraft] = useState({ title: '', subject: '', instructions: '', dueAt: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const classUrlValid = !!normalizeClassVideoUrl(classDraft.videoUrl);
  const classList = (link.classes ?? []).filter((assignment) => assignment.linkId === link.linkId);
  const homeworkList = (link.homework ?? []).filter((assignment) => assignment.linkId === link.linkId);
  const submissions = (link.homeworkSubmissions ?? []).filter((item) => item.linkId === link.linkId)
    .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));

  const assignClass = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    const recipients = availableStudents.filter((student) => selectedIds.includes(student.id));
    if (!recipients.length) return setError(t('Select at least one linked student.'));
    if (!classDraft.title.trim() || !classUrlValid) return setError(t('Add a class name and a secure video link.'));
    setBusy(true);
    let next = panels;
    let sent = 0;
    try {
      for (const student of recipients) {
        next = await sendClass(next, student.linkId!, classDraft);
        updatePanels(next);
        sent += 1;
      }
      setClassDraft({ title: '', subject: '', description: '', videoUrl: '' });
      flash(t('Class assigned to {0} {1}.', { 0: faNum(sent), 1: sent === 1 ? t('student') : t('students') }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('The class could not be assigned.'));
      if (sent > 0) flash(t('Some selected students received the class before the connection failed.'));
    } finally {
      setBusy(false);
    }
  };

  const assignHomework = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    const recipients = availableStudents.filter((student) => selectedIds.includes(student.id));
    if (!recipients.length) return setError(t('Select at least one linked student.'));
    if (!homeworkDraft.title.trim()) return setError(t('Add a homework title.'));
    let dueAt: string | null = null;
    if (homeworkDraft.dueAt) {
      const parsed = new Date(homeworkDraft.dueAt);
      if (!Number.isFinite(parsed.getTime())) return setError(t('Check the due date and time.'));
      dueAt = parsed.toISOString();
    }
    setBusy(true);
    let next = panels;
    let sent = 0;
    try {
      for (const student of recipients) {
        next = await sendHomeworkAssignment(next, student.linkId!, { ...homeworkDraft, dueAt });
        updatePanels(next);
        sent += 1;
      }
      setHomeworkDraft({ title: '', subject: '', instructions: '', dueAt: '' });
      flash(t('Homework assigned to {0} {1}.', { 0: faNum(sent), 1: sent === 1 ? t('student') : t('students') }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('The homework could not be assigned.'));
      if (sent > 0) flash(t('Some selected students received the homework before the connection failed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="guardian-assignments">
      <section className="card learning-section" aria-label={t('Classes and homework assignments')}>
        <header className="card-head">
          <div>
            <p className="kicker">{t('Learning')}</p>
            <h2 className="card-title">{t('Classes and homework')}</h2>
          </div>
          <div className="segmented assignment-mode-switch" role="group" aria-label={t('Assignment type')}>
            <button type="button" className={`segment ${mode === 'classes' ? 'on' : ''}`} aria-pressed={mode === 'classes'} onClick={() => { setMode('classes'); setError(''); }}>{t('Classes')}</button>
            <button type="button" className={`segment ${mode === 'homework' ? 'on' : ''}`} aria-pressed={mode === 'homework'} onClick={() => { setMode('homework'); setError(''); }}>{t('Homework')}</button>
          </div>
        </header>
        <p className="learning-privacy">{t('Choose exactly which linked students receive each assignment. Each student has separate progress and review.')}</p>
        {!activeCanAssign ? <p className="hint">{t('This student link is not ready for assignments. You can select other linked students above.')}</p> : null}
        <SelectedStudents students={availableStudents} selected={selectedIds} onChange={setSelectedIds} />
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {mode === 'classes' ? (
          <>
            <form className="learning-assignment-form" onSubmit={(event) => void assignClass(event)}>
              <label className="field"><span>{t('Class name')}</span><input className="input" maxLength={120} value={classDraft.title} disabled={busy} onChange={(event) => setClassDraft({ ...classDraft, title: event.target.value })} required /></label>
              <label className="field"><span>{t('Subject (optional)')}</span><input className="input" maxLength={60} value={classDraft.subject} disabled={busy} onChange={(event) => setClassDraft({ ...classDraft, subject: event.target.value })} /></label>
              <label className="field"><span>{t('Description (optional)')}</span><textarea className="input" rows={2} maxLength={400} value={classDraft.description} disabled={busy} onChange={(event) => setClassDraft({ ...classDraft, description: event.target.value })} /></label>
              <label className="field"><span>{t('Cloud-hosted video lesson link')}</span><input className="input" type="url" maxLength={500} placeholder="https://…" value={classDraft.videoUrl} disabled={busy} onChange={(event) => setClassDraft({ ...classDraft, videoUrl: event.target.value })} required /></label>
              {classDraft.videoUrl && !classUrlValid ? <p className="form-error">{t('Use a secure HTTPS video link.')}</p> : null}
              <p className="learning-privacy">{t('Recommended: Vimeo, YouTube unlisted, Google Drive, or a school LMS. Store the video with the provider, not in Planner or its database.')}</p>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !availableStudents.length || !classDraft.title.trim() || !classUrlValid}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <UploadIcon size={14} />}
                {t('Assign class')}
              </button>
            </form>
            <div className="learning-assigned-list">
              <h3 className="chart-title">{t('Assigned to {0}', { 0: link.displayName || link.username })}</h3>
              {classList.length ? <ul className="learning-list">{classList.map((item) => <ClassAssignmentCard key={item.id} assignment={item} link={link} />)}</ul> : <p className="empty-note">{t('No classes assigned to this student yet.')}</p>}
            </div>
          </>
        ) : (
          <>
            <form className="learning-assignment-form" onSubmit={(event) => void assignHomework(event)}>
              <label className="field"><span>{t('Homework title')}</span><input className="input" maxLength={120} value={homeworkDraft.title} disabled={busy} onChange={(event) => setHomeworkDraft({ ...homeworkDraft, title: event.target.value })} required /></label>
              <label className="field"><span>{t('Subject (optional)')}</span><input className="input" maxLength={60} value={homeworkDraft.subject} disabled={busy} onChange={(event) => setHomeworkDraft({ ...homeworkDraft, subject: event.target.value })} /></label>
              <label className="field"><span>{t('Instructions (optional)')}</span><textarea className="input" rows={3} maxLength={400} value={homeworkDraft.instructions} disabled={busy} onChange={(event) => setHomeworkDraft({ ...homeworkDraft, instructions: event.target.value })} /></label>
              <label className="field"><span>{t('Due date and time (optional)')}</span><input className="input" type="datetime-local" value={homeworkDraft.dueAt} disabled={busy} onChange={(event) => setHomeworkDraft({ ...homeworkDraft, dueAt: event.target.value })} /></label>
              <button type="submit" className="btn btn-primary btn-small" disabled={busy || !availableStudents.length || !homeworkDraft.title.trim()}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <UploadIcon size={14} />}
                {t('Assign homework')}
              </button>
            </form>
            <div className="learning-assigned-list">
              <h3 className="chart-title">{t('Assigned to {0}', { 0: link.displayName || link.username })}</h3>
              {homeworkList.length ? <ul className="learning-list">{homeworkList.map((item) => (
                <li key={item.id} className="learning-card is-incomplete">
                  <div className="learning-card-head"><div><p className="learning-kicker">{item.subject || t('Homework')}</p><h3>{item.title}</h3></div><span className="learning-state is-incomplete">{t('Assigned')}</span></div>
                  {item.instructions ? <p className="learning-description">{item.instructions}</p> : null}
                  <p className="learning-meta">{item.dueAt ? t('Due {0}', { 0: dueText(item.dueAt) ?? item.dueAt }) : t('No due time')}</p>
                </li>
              ))}</ul> : <p className="empty-note">{t('No homework assigned to this student yet.')}</p>}
            </div>
          </>
        )}
      </section>
      <section className="card learning-section" aria-label={t('Homework submissions to review')}>
        <header className="card-head"><div><p className="kicker">{t('Review')}</p><h2 className="card-title">{t('Homework submissions')}</h2></div><span className="learning-count">{faNum(submissions.filter((item) => item.status === 'submitted').length)}</span></header>
        {submissions.length ? <ul className="learning-list">{submissions.map((submission) => <HomeworkReviewCard key={submission.id} submission={submission} link={link} />)}</ul> : <p className="empty-note">{t('No homework submissions yet.')}</p>}
      </section>
    </div>
  );
}
