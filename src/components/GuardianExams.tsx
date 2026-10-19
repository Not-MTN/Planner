/**
 * Exams, from the guardian's side.
 *
 * Two things live here, because they are two halves of one act: setting the
 * exam, and reading what came back. The exam a student is sitting is the same
 * exam the guardian set — it is never re-created, never copied into a new id,
 * and the words written on the way back land on the sitting it answers.
 *
 * The marking is deliberately not the guardian's to wait for: the options are
 * marked the moment the student hands it in, on their device, from the same
 * answer key. What reaches the guardian is a score that is already theirs to
 * read, the questions that went wrong, and the written answers, which do need
 * a person.
 */
import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatFullDate, formatStamp, todayISO } from '../dates';
import { faNum, t } from '../i18n';
import { ExamIcon, PlusIcon, TickIcon, TrashIcon } from '../icons';
import { dropExam, reviewExamSubmission, sendExam } from '../auth/links';
import {
  draftExamSummary,
  emptyExamDraft,
  emptyExamQuestion,
  examDraftError,
  examReview,
  isWrittenQuestion,
} from '../exams';
import { newId } from '../panels';
import { EXAM_CHOICES_MAX, EXAM_QUESTIONS_MAX } from '../types';
import type { GuardianLink } from '../types';
import { Empty, Field, Modal } from './ui';

export function GuardianExams({ link }: { link: GuardianLink }) {
  const { panels, updatePanels, requestConfirm, flash } = usePlanner();
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(emptyExamDraft);
  const [sending, setSending] = useState(false);
  const [openSitting, setOpenSitting] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const [savingWords, setSavingWords] = useState(false);

  const exams = link.exams ?? [];
  const sittings = link.examResults ?? [];
  const error = examDraftError(draft);
  const summary = draftExamSummary(draft);

  const addQuestion = () =>
    setDraft((current) => ({
      ...current,
      questions: [...current.questions, emptyExamQuestion(newId('q'))].slice(0, EXAM_QUESTIONS_MAX),
    }));

  const setQuestion = (id: string, patch: Partial<(typeof draft.questions)[number]>) =>
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question) => (question.id === id ? { ...question, ...patch } : question)),
    }));

  const setChoice = (id: string, index: number, value: string) =>
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((question) =>
        question.id === id
          ? { ...question, choices: question.choices.map((choice, at) => (at === index ? value : choice)) }
          : question,
      ),
    }));

  const send = async () => {
    if (error || sending) return;
    setSending(true);
    try {
      updatePanels(await sendExam(panels, link.linkId ?? '', draft));
      setComposing(false);
      setDraft(emptyExamDraft());
      flash(t('That exam is on its way.'));
    } catch (error_) {
      flash(error_ instanceof Error ? error_.message : t('That exam could not be saved.'));
    } finally {
      setSending(false);
    }
  };

  const remove = (examId: string, title: string) =>
    requestConfirm({
      title: t('Take back {0}?', { 0: title }),
      body: t('It leaves the student’s list. A sitting already handed in stays on record.'),
      confirmLabel: t('Take it back'),
      onConfirm: async () => {
        try {
          updatePanels(await dropExam(panels, link.linkId ?? '', examId));
          flash(t('That exam has been taken back.'));
        } catch (error_) {
          flash(error_ instanceof Error ? error_.message : t('That exam could not be taken back.'));
        }
      },
    });

  const saveWords = async (submissionId: string) => {
    if (savingWords) return;
    setSavingWords(true);
    try {
      updatePanels(await reviewExamSubmission(panels, link.linkId ?? '', submissionId, words));
      setOpenSitting(null);
      setWords('');
      flash(t('Your words are on their way.'));
    } catch (error_) {
      flash(error_ instanceof Error ? error_.message : t('Those words could not be sent.'));
    } finally {
      setSavingWords(false);
    }
  };

  const sitting = openSitting ? sittings.find((item) => item.id === openSitting) : null;
  const sittingExam = sitting ? exams.find((exam) => exam.id === sitting.examId) : null;
  const review = sitting && sittingExam ? examReview(sittingExam, sitting) : [];
  const wrong = review.filter((item) => item.verdict === 'wrong');
  const unread = review.filter((item) => item.verdict === null);
  // A sitting whose exam has been taken back still deserves a home: the record
  // stays even after the exam leaves the list.
  const orphaned = sittings.filter((item) => !exams.some((exam) => exam.id === item.examId));

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">
          <ExamIcon size={15} />
          {t('Exams')}
        </h2>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setComposing(true)}>
          <PlusIcon size={14} />
          {t('Set an exam')}
        </button>
      </div>
      <p className="hint">
        {t('Options are marked the moment they hand it in. You read the score, and answer the written ones.')}
      </p>

      {exams.length === 0 ? (
        <Empty
          compact
          title={t('No exam set yet')}
          text={t('Write the questions once, here. The student sits it on their side and reads the score at once.')}
          action={
            <button type="button" className="btn btn-primary btn-small" onClick={() => setComposing(true)}>
              {t('Set an exam')}
            </button>
          }
        />
      ) : (
        <ul className="exam-list">
          {exams.map((exam) => {
            const handed = sittings.find((item) => item.examId === exam.id);
            const dueSoon = !handed && !!exam.dueAt && exam.dueAt.slice(0, 10) === todayISO();
            return (
              <li key={exam.id} className={cx('exam-row', handed && 'is-in', !handed && dueSoon && 'is-soon')}>
                <div className="exam-row-main">
                  <p className="exam-title">{exam.title}</p>
                  <p className="exam-meta">
                    <span>{exam.subject || t('General')}</span>
                    <span>{t('{0} questions', { 0: faNum(exam.questions.length) })}</span>
                    {exam.minutes ? <span>{t('{0} minutes', { 0: faNum(exam.minutes) })}</span> : null}
                    {exam.dueAt ? (
                      <span>{dueSoon ? t('Due today') : t('By {0}', { 0: formatFullDate(exam.dueAt.slice(0, 10)) })}</span>
                    ) : null}
                  </p>
                  {exam.note ? <p className="exam-note">{exam.note}</p> : null}
                  {handed ? (
                    <p className="exam-score is-in">
                      <TickIcon size={13} />
                      {t('{0} of {1}', { 0: faNum(handed.score), 1: faNum(handed.marked) })}
                      <span>{formatStamp(handed.submittedAt)}</span>
                      {handed.reviewedAt ? (
                        <span className="exam-answered-tag">{t('Answered')}</span>
                      ) : (
                        <span className="exam-waiting">{t('Waiting on your words')}</span>
                      )}
                    </p>
                  ) : (
                    <p className="exam-score">{t('Not handed in yet')}</p>
                  )}
                </div>
                <div className="exam-actions">
                  {handed ? (
                    <button
                      type="button"
                      className="btn btn-outline btn-small"
                      onClick={() => {
                        setOpenSitting(handed.id);
                        setWords(handed.feedback ?? '');
                      }}
                    >
                      {handed.reviewedAt ? t('Read it again') : t('Read it')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={t('Take back {0}', { 0: exam.title })}
                    onClick={() => remove(exam.id, exam.title)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {orphaned.length > 0 ? (
        <section className="exam-orphans" aria-label={t('Taken back, still on record')}>
          <p className="exam-orphans-head">{t('Taken back, still on record')}</p>
          <ul className="exam-list">
            {orphaned.map((item) => (
              <li key={item.id} className="exam-row is-orphan">
                <div className="exam-row-main">
                  <p className="exam-title">{t('An exam')}</p>
                  <p className="exam-meta">
                    <span>{t('{0} of {1}', { 0: faNum(item.score), 1: faNum(item.marked) })}</span>
                    <span>{formatStamp(item.submittedAt)}</span>
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-outline btn-small"
                  onClick={() => {
                    setOpenSitting(item.id);
                    setWords(item.feedback ?? '');
                  }}
                >
                  {t('Read it')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {composing ? (
        <Modal title={t('Set an exam')} onClose={() => setComposing(false)}>
          <form
            className="exam-form"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <Field label={t('Name')} error={error && !draft.title.trim() ? error : null}>
              <input
                className="input"
                maxLength={120}
                value={draft.title}
                placeholder={t('The midterm, chapter four')}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              />
            </Field>
            <div className="field-row">
              <Field label={t('Subject')}>
                <input
                  className="input"
                  maxLength={60}
                  value={draft.subject}
                  placeholder={t('Chemistry')}
                  onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                />
              </Field>
              <Field label={t('Minutes')} hint={t('Optional')}>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={600}
                  value={draft.minutes}
                  onChange={(event) => setDraft({ ...draft, minutes: event.target.value })}
                />
              </Field>
              {/* The day it closes. Validated all along and shown on the
                  student's list — it just had nowhere to be typed until now. */}
              <Field label={t('Last day')} hint={t('Optional')}>
                <input
                  className="input"
                  type="date"
                  min={todayISO()}
                  value={draft.dueAt}
                  onChange={(event) => setDraft({ ...draft, dueAt: event.target.value })}
                />
              </Field>
            </div>
            <Field label={t('Note to them')} hint={t('Optional')}>
              <textarea
                className="input"
                rows={2}
                maxLength={280}
                value={draft.note}
                onChange={(event) => setDraft({ ...draft, note: event.target.value })}
              />
            </Field>

            <div className="exam-questions">
              {draft.questions.map((question, at) => (
                <div
                  key={question.id}
                  className={cx('exam-question', question.prompt.trim() && 'is-filled')}
                >
                  <div className="exam-question-head">
                    <span>
                      {t('Question {0}', { 0: faNum(at + 1) })}
                      {isWrittenQuestion(question) && question.prompt.trim() ? (
                        <em>{t('Written answer')}</em>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={t('Remove this question')}
                      disabled={draft.questions.length === 1}
                      onClick={() =>
                        setDraft({ ...draft, questions: draft.questions.filter((item) => item.id !== question.id) })
                      }
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                  <textarea
                    className="input"
                    rows={2}
                    maxLength={400}
                    value={question.prompt}
                    placeholder={t('Ask it here')}
                    aria-label={t('Question {0}', { 0: faNum(at + 1) })}
                    onChange={(event) => setQuestion(question.id, { prompt: event.target.value })}
                  />
                  <ul className="exam-choices">
                    {question.choices.map((choice, index) => (
                      <li key={index} className="exam-choice">
                        <input
                          className="check"
                          type="radio"
                          name={`answer-${question.id}`}
                          checked={(question.answer ?? -1) === index}
                          aria-label={t('The right answer for question {0}', { 0: faNum(at + 1) })}
                          onChange={() => setQuestion(question.id, { answer: index })}
                        />
                        <input
                          className="input"
                          maxLength={200}
                          value={choice}
                          placeholder={`${t('Option')} ${faNum(index + 1)}`}
                          aria-label={t('Option {0} for question {1}', { 0: faNum(index + 1), 1: faNum(at + 1) })}
                          onChange={(event) => setChoice(question.id, index, event.target.value)}
                        />
                        {question.choices.length > 2 ? (
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={t('Remove this option')}
                            onClick={() =>
                              setQuestion(question.id, {
                                choices: question.choices.filter((_, at_) => at_ !== index),
                                answer:
                                  (question.answer ?? -1) === index
                                    ? null
                                    : (question.answer ?? -1) > index
                                      ? (question.answer ?? 1) - 1
                                      : question.answer,
                              })
                            }
                          >
                            <TrashIcon size={13} />
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  <div className="exam-choice-foot">
                    <button
                      type="button"
                      className="text-btn"
                      disabled={question.choices.length >= EXAM_CHOICES_MAX}
                      onClick={() => setQuestion(question.id, { choices: [...question.choices, ''] })}
                    >
                      <PlusIcon size={13} />
                      {t('Another option')}
                    </button>
                    {isWrittenQuestion(question) ? (
                      <span className="hint">{t('No options — they will write the answer.')}</span>
                    ) : (
                      <span className="hint">{t('Tap the circle beside the right one.')}</span>
                    )}
                    <label className="exam-points">
                      <span>{t('Points')}</span>
                      <input
                        className="input"
                        type="number"
                        min={1}
                        max={100}
                        value={question.points}
                        aria-label={t('Points for question {0}', { 0: faNum(at + 1) })}
                        onChange={(event) => setQuestion(question.id, { points: event.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-outline btn-small"
                disabled={draft.questions.length >= EXAM_QUESTIONS_MAX}
                onClick={addQuestion}
              >
                <PlusIcon size={14} />
                {t('Another question')}
              </button>
            </div>

            {error ? <p className="field-error">{error}</p> : null}
            {/* One whole sentence, not two glued together: a translator cannot
                reorder a fragment that only makes sense spliced onto the end of
                another one, and Persian and Finnish both do reorder. */}
            <p className="exam-summary">
              {summary.written > 0
                ? t('{0} questions · {1} points · {2} of them written', {
                    0: faNum(summary.questions),
                    1: faNum(summary.points),
                    2: faNum(summary.written),
                  })
                : t('{0} questions · {1} points', {
                    0: faNum(summary.questions),
                    1: faNum(summary.points),
                  })}
            </p>
            <div className="form-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={() => setComposing(false)}>
                {t('Cancel')}
              </button>
              <button type="submit" className="btn btn-primary btn-small" disabled={!!error || sending}>
                {sending ? <span className="spinner" aria-hidden="true" /> : <ExamIcon size={14} />}
                {t('Send the exam')}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}

      {sitting ? (
        <Modal title={t('What they handed in')} onClose={() => setOpenSitting(null)}>
          <div className="exam-reading">
            <p className="exam-score is-in">
              <TickIcon size={14} />
              {t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })}
              <span>{formatStamp(sitting.submittedAt)}</span>
            </p>
            {wrong.length > 0 ? (
              <p className="exam-wrong-line">
                {t('{0} went wrong: {1}', {
                  0: faNum(wrong.length),
                  1: wrong
                    .map((item) => faNum(review.findIndex((entry) => entry.id === item.id) + 1))
                    .join('، '),
                })}
              </p>
            ) : null}
            {unread.length > 0 ? (
              <p className="hint">{t('{0} written answers need you.', { 0: faNum(unread.length) })}</p>
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
                    {item.verdict === 'right'
                      ? t('Right · {0} points', { 0: faNum(item.points) })
                      : item.verdict === 'wrong'
                        ? t('Wrong')
                        : t('Not marked yet')}
                  </p>
                </li>
              ))}
            </ul>
            <Field label={t('Say something back')} hint={t('They read it on their side, on this sitting.')}>
              <textarea
                className="input"
                rows={3}
                maxLength={280}
                value={words}
                onChange={(event) => setWords(event.target.value)}
              />
            </Field>
            <div className="form-actions">
              <button type="button" className="btn btn-outline btn-small" onClick={() => setOpenSitting(null)}>
                {t('Close')}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-small"
                disabled={savingWords || !words.trim()}
                onClick={() => void saveWords(sitting.id)}
              >
                {savingWords ? <span className="spinner" aria-hidden="true" /> : null}
                {t('Send')}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
