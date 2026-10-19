/**
 * Exams, from the student's side.
 *
 * Three shapes, one inbox:
 *
 *   test  — the variant drawn at Start is frozen in a persisted draft. Answers
 *           are committed to the server before the answer key is released, and
 *           the instant score comes straight back. One attempt, no do-overs.
 *   paper — the question file unlocks at Start and the clock starts then. When
 *           the clock ends the questions close and an upload window opens; miss
 *           it and the miss is reported, but a guardian can re-open the window.
 *   legacy— the older inline-question exams keep their on-device flow.
 *
 * The clock is always read off the wall (`Date.now() - startedAt`), never
 * counted down in state: a phone that sleeps comes back to the true time, and
 * a killed app cannot reset a sitting because the draft is persisted.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatFullDate, formatStamp } from '../dates';
import { faNum, t } from '../i18n';
import { CheckIcon, ClockIcon, ExamIcon, TickIcon, UploadIcon } from '../icons';
import { formatSize } from '../files';
import {
  beginExam,
  markPaperMissed,
  sitExam,
  submitPaperFiles,
  submitTestExam,
  syncStudentInbox,
  withExamAnswer,
} from '../auth/links';
import { examKind, examOpen, examProgress, examReview, openExamCount, withStudentExamDraft } from '../exams';
import { useNow } from '../hooks';
import {
  deleteLinkFileAssets,
  uploadEncryptedLinkFile,
  validateLinkFile,
} from '../linkMedia';
import { EXAM_FILES_MAX, EXAM_WRITTEN_MAX } from '../types';
import type { Exam, ExamFile, ExamSubmission, StudentExamDraft } from '../types';
import { ExamFileDownload, ExamFileRemove } from './ExamFiles';
import { Empty, Modal } from './ui';

const LETTERS = 'ABCDEFGH';

/** The question paper this student may reach for one exam, once started. */
function studentQuestionFile(exam: Exam, draft: StudentExamDraft): ExamFile | null {
  if (examKind(exam) === 'paper') return exam.paperFile ?? null;
  const variant = exam.variants?.find((item) => item.id === draft.variantId) ?? exam.variants?.[0];
  return variant?.file ?? null;
}

function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${faNum(hours)}:${pad(minutes)}:${pad(seconds)}` : `${faNum(minutes)}:${pad(seconds)}`;
}

export function StudentExams() {
  const { panels, state, updatePanels, flash } = usePlanner();
  const exams = useMemo(() => panels.student.inbox.exams ?? [], [panels.student.inbox.exams]);
  const sittings = useMemo(() => panels.student.examSubmissions ?? [], [panels.student.examSubmissions]);
  const drafts = panels.student.examDrafts ?? {};
  const [openId, setOpenId] = useState<string | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [reuploadId, setReuploadId] = useState<string | null>(null);

  const open = openId ? exams.find((exam) => exam.id === openId) : null;
  const openDraft = openId ? drafts[openId] ?? null : null;
  const reading = readingId ? sittings.find((item) => item.examId === readingId) : null;
  const reupload = reuploadId ? sittings.find((item) => item.examId === reuploadId) : null;
  const waiting = openExamCount(exams, sittings);

  const start = (exam: Exam) => {
    try {
      const { panels: next } = beginExam(panels, exam.id);
      updatePanels(next);
      setOpenId(exam.id);
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That exam could not be started.'));
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">
          <ExamIcon size={15} />
          {t('Exams')}
        </h2>
        {waiting > 0 ? <p className="card-note">{t('{0} waiting', { 0: faNum(waiting) })}</p> : null}
      </div>
      <p className="hint">{t('You are marked the moment you hand it in. The score is yours to see straight away.')}</p>

      {exams.length === 0 ? (
        <Empty
          compact
          title={t('No exam yet')}
          text={t('When your guardian sets one it lands here, with the questions and the time it allows.')}
        />
      ) : (
        <ul className="exam-list">
          {exams.map((exam) => {
            const handed = sittings.find((item) => item.examId === exam.id);
            const kind = examKind(exam);
            const isOpen = examOpen(exam, sittings);
            const draft = drafts[exam.id];
            const inProgress = !!draft;
            // A grant only re-opens the window while nothing is on file yet;
            // once the new attempt lands the button must disappear.
            const canReupload = kind === 'paper' && !!handed?.resubmitGrantedAt && (handed.files?.length ?? 0) === 0;
            const shareKey = panels.student.guardians.find((item) => item.linkId === exam.linkId)?.wrappedShareKey ?? '';
            // The paper unlocks at Start (that is when the clock starts), so
            // the row only offers it once a sitting actually exists.
            const unlockedFile = !handed && draft ? studentQuestionFile(exam, draft) : null;
            return (
              <li key={exam.id} className={cx('exam-row', handed && 'is-in', !handed && !isOpen && 'is-late')}>
                <div className="exam-row-main">
                  <p className="exam-title">
                    <span className={cx('exam-kind-badge', kind === 'paper' && 'is-paper')}>
                      {kind === 'paper' ? t('Paper') : t('Instant test')}
                    </span>
                    {exam.title}
                  </p>
                  <p className="exam-meta">
                    <span>{exam.subject || t('General')}</span>
                    {kind === 'test' && exam.variants?.length ? (
                      <span>{t('{0} variants', { 0: faNum(exam.variants.length) })}</span>
                    ) : null}
                    {exam.minutes ? (
                      <span>
                        <ClockIcon size={12} /> {t('{0} minutes', { 0: faNum(exam.minutes) })}
                      </span>
                    ) : null}
                    {kind === 'paper' ? (
                      <span>{t('{0} min upload window', { 0: faNum(exam.uploadMinutes ?? 10) })}</span>
                    ) : null}
                    {exam.dueAt ? <span>{t('By {0}', { 0: formatFullDate(exam.dueAt.slice(0, 10)) })}</span> : null}
                  </p>
                  {exam.note ? <p className="exam-note">{exam.note}</p> : null}
                  {handed ? <HandedSummary sitting={handed} /> : null}
                  {unlockedFile && shareKey ? (
                    <div className="exam-row-files">
                      <ExamFileDownload compact wrappedShareKey={shareKey} file={unlockedFile} />
                    </div>
                  ) : null}
                </div>
                <div className="exam-actions">
                  {handed ? (
                    <>
                      <button type="button" className="btn btn-outline btn-small" onClick={() => setReadingId(exam.id)}>
                        {t('Read it back')}
                      </button>
                      {canReupload ? (
                        <button type="button" className="btn btn-primary btn-small" onClick={() => setReuploadId(exam.id)}>
                          {t('Upload answers')}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <button
                      type="button"
                      className={cx('btn btn-small', isOpen || inProgress ? 'btn-primary' : 'btn-outline')}
                      onClick={() => (inProgress ? setOpenId(exam.id) : start(exam))}
                    >
                      {inProgress ? t('Carry on') : isOpen ? t('Start') : t('Sit it anyway')}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && openDraft ? (
        <SittingModal
          key={open.id}
          exam={open}
          draft={openDraft}
          onClose={() => setOpenId(null)}
          onDone={() => {
            setOpenId(null);
            void syncStudentInbox(panels, state.goals).catch(() => undefined);
          }}
        />
      ) : null}

      {reading && open === null ? (
        <ResultModal
          exam={exams.find((item) => item.id === reading.examId) ?? null}
          sitting={reading}
          onClose={() => setReadingId(null)}
        />
      ) : null}

      {reupload && open === null ? (
        <ReuploadModal
          exam={exams.find((item) => item.id === reupload.examId) ?? null}
          sitting={reupload}
          onClose={() => setReuploadId(null)}
          onDone={() => {
            setReuploadId(null);
            void syncStudentInbox(panels, state.goals).catch(() => undefined);
          }}
        />
      ) : null}
    </div>
  );
}

function HandedSummary({ sitting }: { sitting: ExamSubmission }) {
  if (sitting.kind === 'paper' || (!sitting.kind && sitting.files?.length)) {
    if (sitting.status === 'missed') {
      return (
        <p className="exam-score is-in exam-missed">
          <ClockIcon size={13} />
          <span>{t('Missed the upload window')}</span>
        </p>
      );
    }
    return (
      <p className="exam-score is-in">
        <TickIcon size={13} />
        {sitting.status === 'reviewed'
          ? t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })
          : t('Answer files handed in — waiting for the mark')}
        <span>{formatStamp(sitting.submittedAt)}</span>
        {sitting.late ? <span className="exam-late-tag">{t('Handed in late')}</span> : null}
      </p>
    );
  }
  return (
    <p className="exam-score is-in">
      <TickIcon size={13} />
      {t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })}
      <span>{t('Handed in at {0}', { 0: formatStamp(sitting.submittedAt) })}</span>
    </p>
  );
}

/* ------------------------------------------------------------------ sitting */

function SittingModal({
  exam,
  draft,
  onClose,
  onDone,
}: {
  exam: Exam;
  draft: StudentExamDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const kind = examKind(exam);
  if (kind === 'paper') return <PaperSitting exam={exam} draft={draft} onClose={onClose} onDone={onDone} />;
  if (exam.variants?.length) return <TestSitting exam={exam} draft={draft} onClose={onClose} onDone={onDone} />;
  return <LegacySitting exam={exam} onClose={onClose} />;
}

function useShareKey(linkId: string): string {
  const { panels } = usePlanner();
  return panels.student.guardians.find((item) => item.linkId === linkId)?.wrappedShareKey ?? '';
}

function TestSitting({
  exam,
  draft,
  onClose,
  onDone,
}: {
  exam: Exam;
  draft: StudentExamDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const { panels, updatePanels, flash, requestConfirm } = usePlanner();
  const now = useNow(1000);
  const [handing, setHanding] = useState(false);
  const handedRef = useRef(false);
  const variant = exam.variants?.find((item) => item.id === draft.variantId) ?? exam.variants?.[0] ?? null;
  const questions = variant?.questions ?? [];
  const answered = questions.filter((question) => draft.answers[question.id] !== undefined).length;
  const startedAt = Date.parse(draft.startedAt);
  const remainingMs = exam.minutes ? exam.minutes * 60_000 - (now.getTime() - startedAt) : null;
  const shareKey = useShareKey(exam.linkId);

  const handIn = async () => {
    if (handing || handedRef.current) return;
    handedRef.current = true;
    setHanding(true);
    try {
      const result = await submitTestExam(panels, exam.id);
      updatePanels(result.panels);
      flash(t('Handed in. Your score is below.'));
      onDone();
    } catch (error) {
      handedRef.current = false;
      flash(error instanceof Error ? error.message : t('That exam could not be handed in.'));
      setHanding(false);
    }
  };

  // The guardian's limit is a limit: at zero it goes in on its own.
  useEffect(() => {
    if (remainingMs !== null && remainingMs <= 0 && !handedRef.current) void handIn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainingMs]);

  if (!variant) {
    return (
      <Modal title={exam.title} onClose={onClose}>
        <p className="form-error">{t('That exam could not be opened.')}</p>
      </Modal>
    );
  }

  const choose = (questionId: string, choice: number) => {
    updatePanels(withExamAnswer(panels, exam.id, questionId, choice));
  };

  const confirmHandIn = () => {
    const blanks = questions.length - answered;
    requestConfirm({
      title: t('Hand in {0}?', { 0: exam.title }),
      body: blanks > 0 ? t('{0} are still blank. You can hand it in as it is.', { 0: faNum(blanks) }) : t('You have answered all of it.'),
      confirmLabel: t('Hand it in'),
      onConfirm: () => void handIn(),
    });
  };

  return (
    <Modal title={exam.title} onClose={onClose}>
      <div className="exam-sitting">
        <div className="exam-sitting-head">
          <span>
            {t('{0} of {1} answered', { 0: faNum(answered), 1: faNum(questions.length) })}
            {variant.label ? <span className="exam-variant-tag"> · {t('Your variant: {0}', { 0: variant.label })}</span> : null}
          </span>
          {remainingMs !== null ? (
            <span className={cx('exam-clock', remainingMs <= 5 * 60_000 && 'is-short')}>
              <ClockIcon size={12} />
              {formatClock(remainingMs)}
            </span>
          ) : null}
        </div>

        {variant.file ? (
          <div className="exam-paper-row">
            <ExamFileDownload wrappedShareKey={shareKey} file={variant.file} />
          </div>
        ) : null}

        {questions.length - answered > 0 ? (
          <p className="hint">{t('{0} still blank.', { 0: faNum(questions.length - answered) })}</p>
        ) : (
          <p className="hint is-good">
            <CheckIcon size={12} />
            {t('All of it is answered.')}
          </p>
        )}

        {questions.map((question, at) => {
          const filled = draft.answers[question.id] !== undefined;
          return (
            <div key={question.id} className={cx('exam-question', filled && 'is-filled')}>
              <p className="exam-prompt">
                <span>{faNum(at + 1)}.</span>
                {question.type === 'boolean' ? t('True / False') : t('Multiple choice')}
                <span className="exam-q-points">{t('{0} pts', { 0: faNum(question.points) })}</span>
              </p>
              <ul className="exam-choices">
                {question.options.map((option, index) => (
                  <li key={index} className="exam-choice">
                    <label className={cx(draft.answers[question.id] === index && 'is-on')}>
                      <input
                        className="check"
                        type="radio"
                        name={`sit-${question.id}`}
                        checked={draft.answers[question.id] === index}
                        onChange={() => choose(question.id, index)}
                      />
                      <span>
                        {question.type === 'boolean' ? option : `${LETTERS[index] ?? index + 1}. ${option}`}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <div className="form-actions">
          <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
            {t('Keep it open')}
          </button>
          <button type="button" className="btn btn-primary btn-small" disabled={handing} onClick={confirmHandIn}>
            {handing ? <span className="spinner" aria-hidden="true" /> : <TickIcon size={14} />}
            {t('Hand it in')}
          </button>
        </div>
        <p className="hint">{t('Closing it keeps your answers. They wait here until you come back.')}</p>
      </div>
    </Modal>
  );
}

function PaperSitting({
  exam,
  draft,
  onClose,
  onDone,
}: {
  exam: Exam;
  draft: StudentExamDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const now = useNow(1000);
  // Pending uploads live in the persisted draft, not just component state:
  // closing the modal (or the app) must never cost an encrypted upload.
  const [files, setFiles] = useState<ExamFile[]>(() => draft.pendingFiles ?? []);
  const filesRef = useRef(files);
  filesRef.current = files;
  const [sending, setSending] = useState(false);
  const missedRef = useRef(false);
  const shareKey = useShareKey(exam.linkId);
  const startedAt = Date.parse(draft.startedAt);
  const sittingEnds = startedAt + (Number(exam.minutes) || 0) * 60_000;
  const deadline = draft.uploadDeadline ? Date.parse(draft.uploadDeadline) : null;
  const inUploadPhase = now.getTime() >= sittingEnds;
  const windowClosed = deadline !== null && now.getTime() > deadline;
  const remainingMs = inUploadPhase ? (deadline ?? now.getTime()) - now.getTime() : sittingEnds - now.getTime();

  const persistFiles = (next: ExamFile[]) => {
    // Assign the ref first so two uploads finishing back-to-back can't both
    // build on the same stale list and clobber one another's files.
    filesRef.current = next;
    setFiles(next);
    updatePanels(withStudentExamDraft(panels, { ...draft, pendingFiles: next }));
  };

  // The window closing ends the sitting one way or the other: files already
  // encrypted and waiting are handed in at the deadline (so a missed tap on
  // "Hand it in" never costs the attempt), and an empty list is filed as a
  // miss the guardian can re-open.
  useEffect(() => {
    if (!windowClosed || missedRef.current) return;
    missedRef.current = true;
    try {
      const next =
        filesRef.current.length > 0
          ? submitPaperFiles(panels, exam.id, filesRef.current, new Date(deadline ?? Date.now()))
          : markPaperMissed(panels, exam.id);
      updatePanels(next);
      onDone();
    } catch {
      // A submission arriving in the meantime means there is nothing to file;
      // drop the modal so the row reflects the sitting that actually landed.
      missedRef.current = false;
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowClosed]);

  const addFile = async (picked: File) => {
    const problem = validateLinkFile(picked);
    if (problem) {
      flash(t(problem));
      return;
    }
    if (filesRef.current.some((item) => item.name === picked.name && item.bytes === picked.size)) {
      flash(t('That file is already in the list.'));
      return;
    }
    if (filesRef.current.length >= EXAM_FILES_MAX) {
      flash(t('You can add up to {0} files.', { 0: faNum(EXAM_FILES_MAX) }));
      return;
    }
    try {
      const uploaded = await uploadEncryptedLinkFile(exam.linkId, shareKey, picked, 'exam-answer');
      persistFiles([...filesRef.current, uploaded]);
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That file could not be uploaded.'));
    }
  };

  const removeFile = (file: ExamFile) => {
    persistFiles(filesRef.current.filter((item) => item.publicId !== file.publicId));
    void deleteLinkFileAssets(exam.linkId, [file]).catch(() => undefined);
  };

  const handIn = async () => {
    if (sending || files.length === 0) return;
    setSending(true);
    try {
      const next = submitPaperFiles(panels, exam.id, files);
      updatePanels(next);
      flash(t('Your answer files are on their way to your guardian.'));
      onDone();
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That exam could not be handed in.'));
      setSending(false);
    }
  };

  return (
    <Modal title={exam.title} onClose={onClose}>
      <div className="exam-sitting exam-paper-sitting">
        <div className="exam-sitting-head">
          <span className={cx('exam-phase-tag', inUploadPhase && 'is-upload')}>
            {inUploadPhase ? t('Upload phase') : t('Question time')}
          </span>
          <span className={cx('exam-clock', remainingMs <= 60_000 && 'is-short')}>
            <ClockIcon size={12} />
            {formatClock(remainingMs)}
          </span>
        </div>

        {exam.paperFile ? (
          <div className="exam-paper-row">
            <ExamFileDownload wrappedShareKey={shareKey} file={exam.paperFile} />
            <p className="hint">{inUploadPhase ? t('The questions are now closed. Only the upload window stays open.') : t('Download the paper and work through it before the clock ends.')}</p>
          </div>
        ) : null}

        {inUploadPhase ? (
          <div className="exam-upload-zone">
            <p className="exam-upload-lead">
              {t('Upload your answer papers. You can add up to {0} files of any type, 20 MB each.', { 0: faNum(EXAM_FILES_MAX) })}
            </p>
            {files.length > 0 ? (
              <ul className="exam-answer-files">
                {files.map((file) => (
                  <li key={file.publicId} className="exam-answer-file-row">
                    <span className="exam-file-meta">
                      <span className="exam-file-name">{file.name}</span>
                      <span className="exam-file-size">{formatSize(file.bytes)}</span>
                    </span>
                    <ExamFileRemove label={t('Remove file')} onRemove={() => removeFile(file)} />
                  </li>
                ))}
              </ul>
            ) : null}
            {files.length < EXAM_FILES_MAX ? (
              <label className="exam-upload-label btn btn-outline btn-small">
                <input
                  className="exam-file-input"
                  type="file"
                  disabled={sending || windowClosed}
                  onChange={(event) => {
                    const picked = event.target.files?.[0];
                    event.target.value = '';
                    if (picked) void addFile(picked);
                  }}
                />
                <UploadIcon size={14} />
                {t('Add an answer file')}
              </label>
            ) : null}
            {windowClosed ? <p className="form-error">{t('The upload window has closed.')}</p> : null}
            <div className="form-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
                {t('Keep it open')}
              </button>
              <button type="button" className="btn btn-primary btn-small" disabled={sending || files.length === 0 || windowClosed} onClick={() => void handIn()}>
                {sending ? <span className="spinner" aria-hidden="true" /> : <TickIcon size={14} />}
                {t('Hand it in')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="exam-upload-lead">
              {t('When the clock ends the questions close and a {0}-minute window opens to upload your answers.', { 0: faNum(exam.uploadMinutes ?? 10) })}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
                {t('Keep it open')}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function ReuploadModal({
  exam,
  sitting,
  onClose,
  onDone,
}: {
  exam: Exam | null;
  sitting: ExamSubmission;
  onClose: () => void;
  onDone: () => void;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const [files, setFiles] = useState<ExamFile[]>([]);
  const [sending, setSending] = useState(false);
  const shareKey = useShareKey(sitting.linkId);
  if (!exam) return null;

  const addFile = async (picked: File) => {
    const problem = validateLinkFile(picked);
    if (problem) {
      flash(t(problem));
      return;
    }
    if (files.some((item) => item.name === picked.name && item.bytes === picked.size)) {
      flash(t('That file is already in the list.'));
      return;
    }
    if (files.length >= EXAM_FILES_MAX) {
      flash(t('You can add up to {0} files.', { 0: faNum(EXAM_FILES_MAX) }));
      return;
    }
    try {
      const uploaded = await uploadEncryptedLinkFile(exam.linkId, shareKey, picked, 'exam-answer');
      setFiles((current) => [...current, uploaded]);
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That file could not be uploaded.'));
    }
  };

  const handIn = async () => {
    if (sending || files.length === 0) return;
    setSending(true);
    try {
      updatePanels(submitPaperFiles(panels, exam.id, files));
      flash(t('Your answer files are on their way to your guardian.'));
      onDone();
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That exam could not be handed in.'));
      setSending(false);
    }
  };

  return (
    <Modal title={exam.title} onClose={onClose}>
      <div className="exam-sitting exam-upload-zone">
        <p className="exam-upload-lead">{t('Your guardian re-opened the upload. Hand in your answer files now.')}</p>
        {exam.paperFile ? (
          <div className="exam-paper-row">
            <ExamFileDownload wrappedShareKey={shareKey} file={exam.paperFile} />
          </div>
        ) : null}
        {files.length > 0 ? (
          <ul className="exam-answer-files">
            {files.map((file) => (
              <li key={file.publicId} className="exam-answer-file-row">
                <span className="exam-file-meta">
                  <span className="exam-file-name">{file.name}</span>
                  <span className="exam-file-size">{formatSize(file.bytes)}</span>
                </span>
                <ExamFileRemove
                  label={t('Remove file')}
                  onRemove={() => {
                    setFiles((current) => current.filter((item) => item.publicId !== file.publicId));
                    void deleteLinkFileAssets(exam.linkId, [file]).catch(() => undefined);
                  }}
                />
              </li>
            ))}
          </ul>
        ) : null}
        {files.length < EXAM_FILES_MAX ? (
          <label className="exam-upload-label btn btn-outline btn-small">
            <input
              className="exam-file-input"
              type="file"
              disabled={sending}
              onChange={(event) => {
                const picked = event.target.files?.[0];
                event.target.value = '';
                if (picked) void addFile(picked);
              }}
            />
            <UploadIcon size={14} />
            {t('Add an answer file')}
          </label>
        ) : null}
        <div className="form-actions">
          <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="btn btn-primary btn-small" disabled={sending || files.length === 0} onClick={() => void handIn()}>
            {sending ? <span className="spinner" aria-hidden="true" /> : <TickIcon size={14} />}
            {t('Hand it in')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------- result */

function ResultModal({ exam, sitting, onClose }: { exam: Exam | null; sitting: ExamSubmission; onClose: () => void }) {
  const isPaper = sitting.kind === 'paper' || (!sitting.kind && !!sitting.files?.length);
  const shareKey = useShareKey(sitting.linkId);

  return (
    <Modal title={t('What you handed in')} onClose={onClose}>
      <div className="exam-reading">
        {isPaper ? <PaperResult exam={exam} sitting={sitting} shareKey={shareKey} /> : <TestResult exam={exam} sitting={sitting} />}
        {sitting.feedback ? (
          <p className="exam-feedback">
            <strong>{t('Their words')}</strong>
            {sitting.feedback}
          </p>
        ) : null}
        <div className="form-actions">
          <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
            {t('Close')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PaperResult({ exam, sitting, shareKey }: { exam: Exam | null; sitting: ExamSubmission; shareKey: string }) {
  if (sitting.status === 'missed') {
    return (
      <div className="exam-result-missed">
        <p className="exam-score is-in exam-missed">
          <ClockIcon size={14} />
          {sitting.resubmitGrantedAt
            ? t('Upload re-opened — use the “Upload answers” button to hand in your files.')
            : t('The upload window closed before files were handed in. Your guardian has been told.')}
        </p>
        {exam?.paperFile ? (
          <ExamFileDownload wrappedShareKey={shareKey} file={exam.paperFile} label={t('Download paper')} />
        ) : null}
      </div>
    );
  }
  return (
    <>
      <p className="exam-score is-in">
        <TickIcon size={14} />
        {sitting.status === 'reviewed'
          ? t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })
          : t('Answer files handed in — waiting for the mark')}
        <span>{formatStamp(sitting.submittedAt)}</span>
        {sitting.late ? <span className="exam-late-tag">{t('Handed in late')}</span> : null}
      </p>
      {sitting.files?.length ? (
        <div className="exam-reading-files">
          <p className="exam-reading-label">{t('Your answer files')}</p>
          <ul className="exam-answer-files">
            {sitting.files.map((file) => (
              <li key={file.publicId}>
                <ExamFileDownload wrappedShareKey={shareKey} file={file} label={file.name} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

function TestResult({ exam, sitting }: { exam: Exam | null; sitting: ExamSubmission }) {
  // Legacy exams still carry their key in the paper, so the full per-question
  // review is available; sealed exams reveal only the score and the verdicts.
  const variant = exam?.variants?.find((item) => item.id === sitting.variantId) ?? exam?.variants?.[0] ?? null;
  const legacyReview = useMemo(
    () => (exam && !exam.variants?.length ? examReview(exam, sitting) : null),
    [exam, sitting],
  );

  if (legacyReview) {
    return (
      <>
        <p className="exam-score is-in">
          <TickIcon size={14} />
          {t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })}
        </p>
        <ul className="exam-review">
          {legacyReview.map((item, at) => (
            <li key={item.id} className={cx('exam-review-row', item.verdict && `is-${item.verdict}`)}>
              <p className="exam-review-q">
                <span>{faNum(at + 1)}.</span>
                {item.prompt}
              </p>
              {item.choices.length > 0 ? (
                <ul className="exam-review-choices">
                  {item.choices.map((choice, index) => (
                    <li
                      key={index}
                      className={cx(
                        index === item.correct && 'is-correct',
                        index === item.chosen && index !== item.correct && 'is-chosen',
                      )}
                    >
                      {choice}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="exam-written-a">{item.written || t('Left blank')}</p>
              )}
              <p className="exam-review-mark">
                {item.verdict === 'right' ? (
                  <>
                    {t('Right')} · {t('{0} points', { 0: faNum(item.points) })}
                  </>
                ) : item.verdict === 'wrong' ? (
                  t('Wrong — the right one is marked above')
                ) : (
                  t('Not marked yet')
                )}
              </p>
            </li>
          ))}
        </ul>
      </>
    );
  }

  const wrongIds = new Set(sitting.wrong ?? []);
  const blankIds = new Set(sitting.blank ?? []);
  return (
    <>
      <p className="exam-score is-in">
        <TickIcon size={14} />
        {t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })}
        <span>
          {t('{0} right · {1} wrong · {2} blank', {
            0: faNum(sitting.right?.length ?? 0),
            1: faNum(sitting.wrong?.length ?? 0),
            2: faNum(sitting.blank?.length ?? 0),
          })}
        </span>
      </p>
      {variant ? (
        <ul className="exam-review">
          {variant.questions.map((question, at) => {
            const chosen = sitting.answers[question.id];
            const verdict = blankIds.has(question.id) ? null : wrongIds.has(question.id) ? 'wrong' : 'right';
            return (
              <li key={question.id} className={cx('exam-review-row', verdict && `is-${verdict}`)}>
                <p className="exam-review-q">
                  <span>{faNum(at + 1)}.</span>
                  {question.type === 'boolean' ? t('True / False') : t('Multiple choice')}
                </p>
                <p className="exam-review-choice-readout">
                  {chosen === undefined ? (
                    <span className="exam-blank-tag">{t('Left blank')}</span>
                  ) : (
                    question.options.map((option, index) => (
                      <span key={index} className={cx('exam-choice-readout', index === chosen && 'is-chosen')}>
                        {question.type === 'boolean' ? option : `${LETTERS[index] ?? index + 1}. ${option}`}
                      </span>
                    ))
                  )}
                </p>
                <p className="exam-review-mark">
                  {verdict === 'right' ? t('Right') : verdict === 'wrong' ? t('Wrong') : t('Left blank')}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------- legacy, untouched */

function LegacySitting({ exam, onClose }: { exam: Exam; onClose: () => void }) {
  const { panels, state, updatePanels, flash, requestConfirm } = usePlanner();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [written, setWritten] = useState<Record<string, string>>({});
  const [handing, setHanding] = useState(false);
  const now = useNow(15_000);
  const startedAt = useRef(Date.now());
  const minutesLeft = exam.minutes ? Math.max(0, Math.ceil(exam.minutes - (now.getTime() - startedAt.current) / 60_000)) : null;

  const handIn = async () => {
    if (handing) return;
    setHanding(true);
    try {
      const next = sitExam(panels, exam.id, { answers, written });
      updatePanels(next);
      await syncStudentInbox(next, state.goals);
      flash(t('Handed in. Your score is below.'));
      onClose();
    } catch (error) {
      flash(error instanceof Error ? error.message : t('That exam could not be handed in.'));
      setHanding(false);
    }
  };

  const confirmHandIn = () => {
    const { blanks } = examProgress(exam, answers, written);
    requestConfirm({
      title: t('Hand in {0}?', { 0: exam.title }),
      body: blanks.length > 0 ? t('{0} are still blank. You can hand it in as it is.', { 0: faNum(blanks.length) }) : t('You have answered all of it.'),
      confirmLabel: t('Hand it in'),
      onConfirm: () => void handIn(),
    });
  };

  return (
    <Modal title={exam.title} onClose={onClose}>
      <div className="exam-sitting">
        <div className="exam-sitting-head">
          <span>{t('{0} of {1} answered', { 0: faNum(examProgress(exam, answers, written).answered), 1: faNum(exam.questions.length) })}</span>
          {minutesLeft !== null ? (
            <span className={cx('exam-clock', minutesLeft <= 5 && 'is-short')}>
              <ClockIcon size={12} />
              {t('{0} minutes left', { 0: faNum(minutesLeft) })}
            </span>
          ) : null}
        </div>
        {exam.questions.map((question, at) => {
          const isWritten = question.choices.length === 0;
          const filled = isWritten ? !!written[question.id]?.trim() : answers[question.id] !== undefined;
          return (
            <div key={question.id} className={cx('exam-question', filled && 'is-filled')}>
              <p className="exam-prompt">
                <span>{faNum(at + 1)}.</span>
                {question.prompt}
              </p>
              {isWritten ? (
                <textarea
                  className="input"
                  rows={3}
                  maxLength={EXAM_WRITTEN_MAX}
                  value={written[question.id] ?? ''}
                  placeholder={t('Write it here')}
                  aria-label={t('Your answer to question {0}', { 0: faNum(at + 1) })}
                  onChange={(event) => setWritten((current) => ({ ...current, [question.id]: event.target.value }))}
                />
              ) : (
                <ul className="exam-choices">
                  {question.choices.map((choice, index) => (
                    <li key={index} className="exam-choice">
                      <label className={cx(answers[question.id] === index && 'is-on')}>
                        <input
                          className="check"
                          type="radio"
                          name={`legacy-${question.id}`}
                          checked={answers[question.id] === index}
                          onChange={() => setAnswers((current) => ({ ...current, [question.id]: index }))}
                        />
                        <span>{choice}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <div className="form-actions">
          <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
            {t('Keep it open')}
          </button>
          <button type="button" className="btn btn-primary btn-small" disabled={handing} onClick={confirmHandIn}>
            {handing ? <span className="spinner" aria-hidden="true" /> : <TickIcon size={14} />}
            {t('Hand it in')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
