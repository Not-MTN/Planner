/**
 * Exams, from the student's side.
 *
 * Sitting an exam is one screen: the questions, a clock if the guardian set
 * one, and a hand-in. The score is marked here, at hand-in, from the same
 * answer key the guardian wrote — so the number the student reads is the number
 * the guardian will read, and neither of them waits on a signal to find out how
 * it went. Written answers go too, and are the only part that needs a person.
 *
 * Two things are deliberate here. Closing the exam does not lose it: answers
 * are held per exam, so "keep it open" means what it says. And the clock is the
 * guardian's limit, not a decoration — at zero the exam hands itself in, which
 * is what a limit means.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatFullDate, formatStamp } from '../dates';
import { faNum, t } from '../i18n';
import { CheckIcon, ClockIcon, ExamIcon, TickIcon } from '../icons';
import { sitExam, syncStudentInbox } from '../auth/links';
import { examOpen, examProgress, examReview, openExamCount } from '../exams';
import { EXAM_WRITTEN_MAX } from '../types';
import type { Exam } from '../types';
import { Empty, Modal } from './ui';

/** What one student has typed into one exam, kept while they think. */
interface SittingDraft {
  answers: Record<string, number>;
  written: Record<string, string>;
  startedAt: number;
}

const emptyDraft = (): SittingDraft => ({ answers: {}, written: {}, startedAt: Date.now() });

export function StudentExams() {
  const { panels, state, updatePanels, flash, requestConfirm } = usePlanner();
  // Memoised because `?? []` would otherwise hand back a new array on every
  // render and take everything that depends on the exam list with it.
  const exams = useMemo(() => panels.student.inbox.exams ?? [], [panels.student.inbox.exams]);
  const sittings = useMemo(() => panels.student.examSubmissions ?? [], [panels.student.examSubmissions]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SittingDraft>>({});
  const [handing, setHanding] = useState(false);
  // The clock is read off the wall, not counted down in state: a phone that
  // sleeps for ten minutes comes back to the right number, not a wrong one.
  const [now, setNow] = useState(() => Date.now());
  const handedInRef = useRef(false);

  const open = openId ? exams.find((exam) => exam.id === openId) : null;
  const reading = readingId ? sittings.find((item) => item.examId === readingId) : null;
  const draft = (open && drafts[open.id]) || emptyDraft();
  // The clock effect reads the answers without depending on them: a keystroke
  // must not restart the timer that is counting the guardian's minutes.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /** Minutes left on the clock, when the exam has one and has been opened. */
  const minutesLeft = useCallback(
    (exam: Exam) => {
      const started = drafts[exam.id]?.startedAt;
      if (!exam.minutes || started === undefined) return null;
      return Math.max(0, Math.ceil(exam.minutes - (now - started) / 60_000));
    },
    [drafts, now],
  );

  const handIn = useCallback(async (exam: Exam, sitting: SittingDraft) => {
    if (handing || handedInRef.current) return;
    handedInRef.current = true;
    setHanding(true);
    try {
      const next = sitExam(panels, exam.id, { answers: sitting.answers, written: sitting.written });
      updatePanels(next);
      setDrafts((current) => {
        const rest = { ...current };
        delete rest[exam.id];
        return rest;
      });
      setOpenId(null);
      // Carried home on the same sync that carries everything else they send.
      await syncStudentInbox(next, state.goals);
      flash(t('Handed in. Your score is below.'));
    } catch (error) {
      handedInRef.current = false;
      flash(error instanceof Error ? error.message : t('That exam could not be handed in.'));
    } finally {
      setHanding(false);
    }
  }, [handing, panels, state.goals, updatePanels, flash]);

  // One clock for whichever exam is open, stopped as soon as it is not. It
  // ticks the wall, so nothing drifts while the tab is in the background.
  const isSitting = !!open;
  useEffect(() => {
    if (!isSitting) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [isSitting]);

  // The limit the guardian set is a limit: at zero the exam goes in on its own,
  // with the answers that were there. Better than a blank page and a warning.
  useEffect(() => {
    if (!open || handing || handedInRef.current) return;
    if (minutesLeft(open) !== 0) return;
    void handIn(open, draftRef.current);
  }, [open, now, handing, handIn, minutesLeft]);

  const start = (examId: string) => {
    setDrafts((current) => (current[examId] ? current : { ...current, [examId]: emptyDraft() }));
    handedInRef.current = false;
    setOpenId(examId);
    setNow(Date.now());
  };

  const patch = (patch_: Partial<SittingDraft>) => {
    if (!open) return;
    setDrafts((current) => ({ ...current, [open.id]: { ...emptyDraft(), ...current[open.id], ...patch_ } }));
  };

  const confirmHandIn = (exam: Exam, sitting: SittingDraft) => {
    const { blanks } = examProgress(exam, sitting.answers, sitting.written);
    requestConfirm({
      title: t('Hand in {0}?', { 0: exam.title }),
      body:
        blanks.length > 0
          ? t('{0} are still blank. You can hand it in as it is.', { 0: faNum(blanks.length) })
          : t('You have answered all of it.'),
      confirmLabel: t('Hand it in'),
      onConfirm: () => handIn(exam, sitting),
    });
  };

  const review = useMemo(
    () => (reading ? examReview(exams.find((exam) => exam.id === reading.examId)!, reading) : []),
    [reading, exams],
  );

  const waiting = openExamCount(exams, sittings);

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
            const isOpen = examOpen(exam, sittings);
            const left = minutesLeft(exam);
            const inProgress = !!drafts[exam.id];
            return (
              <li key={exam.id} className={cx('exam-row', handed && 'is-in', !handed && !isOpen && 'is-late')}>
                <div className="exam-row-main">
                  <p className="exam-title">{exam.title}</p>
                  <p className="exam-meta">
                    <span>{exam.subject || t('General')}</span>
                    <span>{t('{0} questions', { 0: faNum(exam.questions.length) })}</span>
                    {exam.minutes ? (
                      <span>
                        <ClockIcon size={12} /> {t('{0} minutes', { 0: faNum(exam.minutes) })}
                      </span>
                    ) : null}
                    {exam.dueAt ? <span>{t('By {0}', { 0: formatFullDate(exam.dueAt.slice(0, 10)) })}</span> : null}
                  </p>
                  {exam.note ? <p className="exam-note">{exam.note}</p> : null}
                  {handed ? (
                    <p className="exam-score is-in">
                      <TickIcon size={13} />
                      {t('{0} of {1}', { 0: faNum(handed.score), 1: faNum(handed.marked) })}
                      <span>{t('Handed in at {0}', { 0: formatStamp(handed.submittedAt) })}</span>
                    </p>
                  ) : null}
                  {handed?.feedback ? (
                    <p className="exam-feedback">
                      <strong>{t('Their words')}</strong>
                      {handed.feedback}
                    </p>
                  ) : null}
                </div>
                <div className="exam-actions">
                  {handed ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      onClick={() => setReadingId(exam.id)}
                    >
                      {t('Read it back')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={cx('btn btn-small', isOpen || inProgress ? 'btn-primary' : 'btn-outline')}
                      onClick={() => start(exam.id)}
                    >
                      {inProgress ? t('Carry on') : left !== null && left === 0 ? t('Time is up') : isOpen ? t('Start') : t('Sit it anyway')}
                    </button>
                  )}
                  {left !== null && left > 0 && !handed ? (
                    <span className="exam-clock is-inline">
                      <ClockIcon size={12} />
                      {t('{0} minutes left', { 0: faNum(left) })}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open ? (
        <Modal title={open.title} onClose={() => setOpenId(null)}>
          <div className="exam-sitting">
            <div className="exam-sitting-head">
              <span>{t('{0} of {1} answered', { 0: faNum(examProgress(open, draft.answers, draft.written).answered), 1: faNum(open.questions.length) })}</span>
              {minutesLeft(open) !== null ? (
                <span className={cx('exam-clock', (minutesLeft(open) ?? 0) <= 5 && 'is-short')}>
                  <ClockIcon size={12} />
                  {t('{0} minutes left', { 0: faNum(minutesLeft(open)!) })}
                </span>
              ) : null}
            </div>
            {examProgress(open, draft.answers, draft.written).blanks.length > 0 ? (
              <p className="hint">{t('{0} still blank.', { 0: faNum(examProgress(open, draft.answers, draft.written).blanks.length) })}</p>
            ) : (
              <p className="hint is-good">
                <CheckIcon size={12} />
                {t('All of it is answered.')}
              </p>
            )}

            {open.questions.map((question, at) => {
              const isWritten = question.choices.length === 0;
              const filled = isWritten ? !!draft.written[question.id]?.trim() : draft.answers[question.id] !== undefined;
              return (
                <div key={question.id} className={cx('exam-question', filled && 'is-filled')} id={`exam-q-${question.id}`}>
                  <p className="exam-prompt">
                    <span>{faNum(at + 1)}.</span>
                    {question.prompt}
                  </p>
                  {isWritten ? (
                    <textarea
                      className="input"
                      rows={3}
                      maxLength={EXAM_WRITTEN_MAX}
                      value={draft.written[question.id] ?? ''}
                      placeholder={t('Write it here')}
                      aria-label={t('Your answer to question {0}', { 0: faNum(at + 1) })}
                      onChange={(event) => patch({ written: { ...draft.written, [question.id]: event.target.value } })}
                    />
                  ) : (
                    <ul className="exam-choices">
                      {question.choices.map((choice, index) => (
                        <li key={index} className="exam-choice">
                          <label className={cx(draft.answers[question.id] === index && 'is-on')}>
                            <input
                              className="check"
                              type="radio"
                              name={`sit-${question.id}`}
                              checked={draft.answers[question.id] === index}
                              onChange={() => patch({ answers: { ...draft.answers, [question.id]: index } })}
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
              <button type="button" className="btn btn-outline btn-small" onClick={() => setOpenId(null)}>
                {t('Keep it open')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={handing}
                onClick={() => confirmHandIn(open, draft)}
              >
                {handing ? <span className="spinner" aria-hidden="true" /> : <TickIcon size={14} />}
                {t('Hand it in')}
              </button>
            </div>
            <p className="hint">{t('Closing it keeps your answers. They wait here until you come back.')}</p>
          </div>
        </Modal>
      ) : null}

      {reading && open === null ? (
        <Modal title={t('What you handed in')} onClose={() => setReadingId(null)}>
          <div className="exam-reading">
            <p className="exam-score is-in">
              <TickIcon size={14} />
              {t('{0} of {1}', { 0: faNum(reading.score), 1: faNum(reading.marked) })}
              {review.some((item) => item.verdict === null) ? (
                <span>{t('{0} written answers are still waiting to be read.', { 0: faNum(review.filter((item) => item.verdict === null).length) })}</span>
              ) : null}
            </p>
            {reading.feedback ? (
              <p className="exam-feedback">
                <strong>{t('Their words')}</strong>
                {reading.feedback}
              </p>
            ) : null}
            <ul className="exam-review">
              {review.map((item, at) => (
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
                      <>{t('Right')} · {t('{0} points', { 0: faNum(item.points) })}</>
                    ) : item.verdict === 'wrong' ? (
                      t('Wrong — the right one is marked above')
                    ) : (
                      t('Not marked yet')
                    )}
                  </p>
                </li>
              ))}
            </ul>
            <div className="form-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={() => setReadingId(null)}>
                {t('Close')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
