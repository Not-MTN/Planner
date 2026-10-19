/**
 * Exams, from the guardian's side.
 *
 * Two exam shapes share one composer:
 *
 *   test  — one or more variants, each with an encrypted question paper and a
 *           multiple-choice / true-false answer key. The key is sealed to the
 *           server and only released after the student's answers are committed,
 *           so the score is instant and cannot be steered by a key seen early.
 *   paper — one question file and a clock. When the clock ends the student gets
 *           a short upload window, files come back here, and the mark is yours
 *           to give. A missed window can be re-opened from the same sitting.
 */
import { useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { formatFullDate, formatStamp, todayISO } from '../dates';
import { faNum, t } from '../i18n';
import { ClockIcon, ExamIcon, PlusIcon, TickIcon, TrashIcon } from '../icons';
import {
  dropExam,
  grantResubmission,
  markPaperSubmission,
  reviewExamSubmission,
  sendComposedExam,
} from '../auth/links';
import {
  composerDraftError,
  emptyKeyQuestion,
  emptyPaperDraft,
  emptyTestDraft,
  examKind,
  variantSummary,
  withQuestionCount,
  type KeyQuestionDraft,
  type PaperExamDraft,
  type TestExamDraft,
  type VariantDraft,
} from '../exams';
import { deleteLinkFileAssets } from '../linkMedia';
import { newId } from '../panels';
import { EXAM_CHOICES_MAX, EXAM_POINTS_MAX, EXAM_QUESTIONS_MAX, EXAM_UPLOAD_WINDOW_MIN, EXAM_VARIANTS_MAX } from '../types';
import type { Exam, ExamFile, ExamSubmission, GuardianLink } from '../types';
import { ExamFileDownload, ExamFilePicker } from './ExamFiles';
import { Empty, Field, Modal } from './ui';

const LETTERS = 'ABCDEFGH';

/** Every encrypted question paper attached to one exam, for download or sweep. */
function guardianQuestionFiles(exam: Exam): ExamFile[] {
  if (examKind(exam) === 'paper') return exam.paperFile ? [exam.paperFile] : [];
  return (exam.variants ?? []).flatMap((variant) => (variant.file ? [variant.file] : []));
}

export function GuardianExams({ link }: { link: GuardianLink }) {
  const { panels, updatePanels, requestConfirm, flash, kickPanelSync } = usePlanner();
  const [composing, setComposing] = useState(false);
  const [openSitting, setOpenSitting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exams = link.exams ?? [];
  const sittings = link.examResults ?? [];
  const shareKey = link.wrappedShareKey ?? '';

  const remove = (examId: string, title: string) =>
    requestConfirm({
      title: t('Take back {0}?', { 0: title }),
      body: t('It leaves the student’s list. A sitting already handed in stays on record.'),
      confirmLabel: t('Take it back'),
      onConfirm: async () => {
        try {
          const doomed = exams.find((item) => item.id === examId);
          const refs = doomed ? guardianQuestionFiles(doomed) : [];
          updatePanels(await dropExam(panels, link.linkId ?? '', examId));
          // The outbox pointer is the source of truth; the cloud bytes are
          // swept best-effort so a failed sweep never blocks the take-back.
          if (refs.length) await deleteLinkFileAssets(link.linkId ?? '', refs).catch(() => undefined);
          flash(t('That exam has been taken back.'));
          kickPanelSync();
        } catch (error_) {
          flash(error_ instanceof Error ? error_.message : t('That exam could not be taken back.'));
        }
      },
    });

  const sitting = openSitting ? sittings.find((item) => item.id === openSitting) : null;

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">
          <ExamIcon size={15} />
          {t('Exams')}
        </h2>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setComposing(true)}>
          <PlusIcon size={14} />
          {t('New exam')}
        </button>
      </div>
      <p className="hint">{t('Test exams are graded the moment they hand in. Answer papers come back as files for you to mark.')}</p>

      {exams.length === 0 ? (
        <Empty
          compact
          title={t('No exam set yet')}
          text={t('Attach a question paper, set the time and the answers — the student does the rest on their side.')}
          action={
            <button type="button" className="btn btn-primary btn-small" onClick={() => setComposing(true)}>
              {t('New exam')}
            </button>
          }
        />
      ) : (
        <ul className="exam-list">
          {exams.map((exam) => {
            const handed = sittings.find((item) => item.examId === exam.id);
            const dueSoon = !handed && !!exam.dueAt && exam.dueAt.slice(0, 10) === todayISO();
            const kind = examKind(exam);
            return (
              <li key={exam.id} className={cx('exam-row', handed && 'is-in', !handed && dueSoon && 'is-soon')}>
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
                      <span>{t('{0} min upload window', { 0: faNum(exam.uploadMinutes ?? EXAM_UPLOAD_WINDOW_MIN) })}</span>
                    ) : null}
                    {exam.dueAt ? (
                      <span>{dueSoon ? t('Due today') : t('By {0}', { 0: formatFullDate(exam.dueAt.slice(0, 10)) })}</span>
                    ) : null}
                  </p>
                  {exam.note ? <p className="exam-note">{exam.note}</p> : null}
                  {shareKey ? (
                    <div className="exam-row-files">
                      {kind === 'paper' && exam.paperFile ? (
                        <ExamFileDownload compact wrappedShareKey={shareKey} file={exam.paperFile} />
                      ) : null}
                      {kind === 'test'
                        ? (exam.variants ?? []).map((variant) =>
                            variant.file ? (
                              <ExamFileDownload
                                key={variant.id}
                                compact
                                wrappedShareKey={shareKey}
                                file={variant.file}
                                label={variant.label || t('Download questions')}
                              />
                            ) : null,
                          )
                        : null}
                    </div>
                  ) : null}
                  {handed ? (
                    <p className={cx('exam-score', 'is-in')}>
                      <TickIcon size={13} />
                      {handed.kind === 'paper' ? (
                        handed.status === 'reviewed' ? (
                          <span>
                            {t('{0} of {1}', { 0: faNum(handed.score), 1: faNum(handed.marked) })}
                          </span>
                        ) : handed.status === 'missed' ? (
                          <span className="exam-waiting">{t('Missed the upload window')}</span>
                        ) : (
                          <span className="exam-waiting">{t('Answer files waiting on your mark')}</span>
                        )
                      ) : (
                        <span>
                          {t('{0} of {1}', { 0: faNum(handed.score), 1: faNum(handed.marked) })}
                        </span>
                      )}
                      <span>{formatStamp(handed.submittedAt)}</span>
                      {handed.late ? <span className="exam-late-tag">{t('Handed in late')}</span> : null}
                    </p>
                  ) : (
                    <p className="exam-score">{t('Not handed in yet')}</p>
                  )}
                </div>
                <div className="exam-actions">
                  {handed ? (
                    <button type="button" className="btn btn-outline btn-small" onClick={() => setOpenSitting(handed.id)}>
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

      {composing ? (
        <ExamComposer
          link={link}
          onClose={() => setComposing(false)}
          onSent={() => {
            setComposing(false);
            kickPanelSync();
          }}
        />
      ) : null}

      {sitting ? (
        <SittingReader
          key={sitting.id}
          link={link}
          exam={exams.find((item) => item.id === sitting.examId) ?? null}
          sitting={sitting}
          shareKey={shareKey}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setOpenSitting(null)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ composer */

function ExamComposer({ link, onClose, onSent }: { link: GuardianLink; onClose: () => void; onSent: () => void }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [mode, setMode] = useState<'test' | 'paper'>('test');
  const [testDraft, setTestDraft] = useState<TestExamDraft>(emptyTestDraft);
  const [paperDraft, setPaperDraft] = useState<PaperExamDraft>(emptyPaperDraft);
  const [sending, setSending] = useState(false);
  const shareKey = link.wrappedShareKey ?? '';
  const draft = mode === 'test' ? testDraft : paperDraft;
  const error = composerDraftError(draft);

  const patchShared = (patch: Partial<Pick<TestExamDraft, 'title' | 'subject' | 'minutes' | 'dueAt' | 'note'>>) => {
    setTestDraft((current) => ({ ...current, ...patch }));
    setPaperDraft((current) => ({ ...current, ...patch }));
  };

  const send = async () => {
    if (error || sending || !link.linkId) return;
    setSending(true);
    try {
      const next = await sendComposedExam(panels, link.linkId, draft);
      updatePanels(next);
      flash(t('That exam is on its way.'));
      onSent();
    } catch (error_) {
      flash(error_ instanceof Error ? error_.message : t('That exam could not be saved.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title={t('New exam')} onClose={onClose}>
      <form
        className="exam-form"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="exam-mode-switch" role="group" aria-label={t('Exam type')}>
          <button
            type="button"
            className={cx('exam-mode-btn', mode === 'test' && 'is-on')}
            onClick={() => setMode('test')}
          >
            {t('Test exam (instant score)')}
          </button>
          <button
            type="button"
            className={cx('exam-mode-btn', mode === 'paper' && 'is-on')}
            onClick={() => setMode('paper')}
          >
            {t('Answer paper (file upload)')}
          </button>
        </div>

        <Field label={t('Name')} error={error && !draft.title.trim() ? error : null}>
          <input
            className="input"
            maxLength={120}
            value={draft.title}
            placeholder={t('The midterm, chapter four')}
            onChange={(event) => patchShared({ title: event.target.value })}
          />
        </Field>
        <div className="field-row">
          <Field label={t('Subject')}>
            <input
              className="input"
              maxLength={60}
              value={draft.subject}
              placeholder={t('Chemistry')}
              onChange={(event) => patchShared({ subject: event.target.value })}
            />
          </Field>
          <Field label={mode === 'paper' ? t('Exam time (minutes)') : t('Minutes')} hint={mode === 'paper' ? undefined : t('Optional')}>
            <input
              className="input"
              type="number"
              min={1}
              max={600}
              inputMode="numeric"
              value={draft.minutes}
              onChange={(event) => patchShared({ minutes: event.target.value })}
            />
          </Field>
          <Field label={t('Last day')} hint={t('Optional')}>
            <input
              className="input"
              type="date"
              min={todayISO()}
              value={draft.dueAt}
              onChange={(event) => patchShared({ dueAt: event.target.value })}
            />
          </Field>
        </div>
        <Field label={t('Note to them')} hint={t('Optional')}>
          <textarea className="input" rows={2} maxLength={280} value={draft.note} onChange={(event) => patchShared({ note: event.target.value })} />
        </Field>

        {mode === 'test' ? (
          <TestComposer draft={testDraft} setDraft={setTestDraft} linkId={link.linkId ?? ''} shareKey={shareKey} />
        ) : (
          <PaperComposer draft={paperDraft} setDraft={setPaperDraft} linkId={link.linkId ?? ''} shareKey={shareKey} />
        )}

        {error ? <p className="field-error">{error}</p> : null}
        <div className="form-actions">
          <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="submit" className="btn btn-primary btn-small" disabled={!!error || sending}>
            {sending ? <span className="spinner" aria-hidden="true" /> : <ExamIcon size={14} />}
            {t('Send the exam')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PaperComposer({
  draft,
  setDraft,
  linkId,
  shareKey,
}: {
  draft: PaperExamDraft;
  setDraft: (draft: PaperExamDraft) => void;
  linkId: string;
  shareKey: string;
}) {
  return (
    <div className="exam-paper-composer">
      <Field label={t('Answer paper file')}>
        <ExamFilePicker
          linkId={linkId}
          wrappedShareKey={shareKey}
          purpose="exam-question"
          label={t('Add the question paper')}
          file={draft.paperFile}
          onUploaded={(file) => setDraft({ ...draft, paperFile: file })}
          onClear={() => {
            if (draft.paperFile) void deleteLinkFileAssets(linkId, [draft.paperFile]).catch(() => undefined);
            setDraft({ ...draft, paperFile: null });
          }}
        />
      </Field>
      <Field label={t('Upload window')} hint={t('Minutes to upload after the clock ends')}>
        <input
          className="input"
          type="number"
          min={1}
          max={60}
          inputMode="numeric"
          value={draft.uploadMinutes}
          onChange={(event) => setDraft({ ...draft, uploadMinutes: event.target.value })}
        />
      </Field>
    </div>
  );
}

function TestComposer({
  draft,
  setDraft,
  linkId,
  shareKey,
}: {
  draft: TestExamDraft;
  setDraft: (draft: TestExamDraft) => void;
  linkId: string;
  shareKey: string;
}) {
  const [bulk, setBulk] = useState<Record<string, boolean>>({});

  const setVariant = (id: string, patch: Partial<VariantDraft>) =>
    setDraft({
      ...draft,
      variants: draft.variants.map((variant) => (variant.id === id ? { ...variant, ...patch } : variant)),
    });

  const addVariant = () => {
    if (draft.variants.length >= EXAM_VARIANTS_MAX) return;
    const letter = LETTERS[draft.variants.length] ?? String(draft.variants.length + 1);
    setDraft({ ...draft, variants: [...draft.variants, emptyVariantShape(letter)] });
  };

  return (
    <div className="exam-variants">
      {draft.variants.map((variant, index) => (
        <section key={variant.id} className="exam-variant">
          <div className="exam-variant-head">
            <Field label={t('Variant')}>
              <input
                className="input"
                maxLength={40}
                value={variant.label}
                aria-label={t('Variant {0}', { 0: LETTERS[index] ?? index + 1 })}
                onChange={(event) => setVariant(variant.id, { label: event.target.value })}
              />
            </Field>
            {draft.variants.length > 1 ? (
              <button
                type="button"
                className="icon-btn"
                aria-label={t('Remove variant')}
                onClick={() => setDraft({ ...draft, variants: draft.variants.filter((item) => item.id !== variant.id) })}
              >
                <TrashIcon size={15} />
              </button>
            ) : null}
          </div>

          <ExamFilePicker
            linkId={linkId}
            wrappedShareKey={shareKey}
            purpose="exam-question"
            label={t('Add the question paper')}
            file={variant.file}
            onUploaded={(file) => setVariant(variant.id, { file })}
            onClear={() => {
              if (variant.file) void deleteLinkFileAssets(linkId, [variant.file]).catch(() => undefined);
              setVariant(variant.id, { file: null });
            }}
          />

          <div className="exam-variant-controls">
            <Field label={t('Questions')}>
              <input
                className="input"
                type="number"
                min={1}
                max={EXAM_QUESTIONS_MAX}
                inputMode="numeric"
                value={variant.questions.length}
                aria-label={t('Set the number of questions on {0}.', { 0: variant.label })}
                onChange={(event) => setVariant(variant.id, withQuestionCount(variant, Number(event.target.value)))}
              />
            </Field>
            <label className="exam-bulk-toggle">
              <input type="checkbox" checked={!!bulk[variant.id]} onChange={(event) => setBulk({ ...bulk, [variant.id]: event.target.checked })} />
              {t('Bulk answer key')}
            </label>
          </div>

          {bulk[variant.id] ? (
            <BulkKey variant={variant} onChange={(answers) => setVariant(variant.id, applyBulk(variant, answers))} />
          ) : (
            <ul className="exam-key-list">
              {variant.questions.map((question, qAt) => (
                <KeyQuestionEditor
                  key={question.id}
                  question={question}
                  number={qAt + 1}
                  onChange={(patch) =>
                    setVariant(variant.id, {
                      questions: variant.questions.map((item) => (item.id === question.id ? { ...item, ...patch } : item)),
                    })
                  }
                />
              ))}
            </ul>
          )}
          <p className="hint">
            {(() => {
              const summary = variantSummary(variant);
              return t('{0} questions · {1} points', { 0: faNum(summary.questions), 1: faNum(summary.points) });
            })()}
          </p>
        </section>
      ))}
      <button type="button" className="btn btn-outline btn-small" disabled={draft.variants.length >= EXAM_VARIANTS_MAX} onClick={addVariant}>
        <PlusIcon size={14} />
        {t('Add variant')}
      </button>
    </div>
  );
}

function emptyVariantShape(letter: string): VariantDraft {
  return {
    id: newId('v'),
    label: t('Variant {0}', { 0: letter }),
    file: null,
    questions: [emptyKeyQuestion(`q1-${Date.now().toString(36)}`)],
  };
}

function applyBulk(variant: VariantDraft, answers: Array<number | null>): VariantDraft {
  return {
    ...variant,
    questions: variant.questions.map((question, at) => {
      const answer = answers[at];
      return typeof answer === 'number' && answer >= 0 && answer < question.options.length ? { ...question, answer } : question;
    }),
  };
}

function BulkKey({ variant, onChange }: { variant: VariantDraft; onChange: (answers: Array<number | null>) => void }) {
  return (
    <div className="exam-bulk-key">
      <p className="hint">{t('Set every correct answer in one strip.')}</p>
      <div className="exam-bulk-grid">
        {variant.questions.map((question, at) => (
          <label key={question.id} className="exam-bulk-cell">
            <span>{faNum(at + 1)}</span>
            <select
              className="input"
              value={question.answer ?? ''}
              aria-label={t('Correct answer for question {0}', { 0: faNum(at + 1) })}
              onChange={(event) => {
                const next = variant.questions.map((item, index) =>
                  index === at ? { ...item, answer: event.target.value === '' ? null : Number(event.target.value) } : item,
                );
                onChange(next.map((item) => item.answer));
              }}
            >
              <option value="">—</option>
              {question.options.map((option, index) => (
                <option key={index} value={index}>
                  {question.type === 'boolean' ? option : `${LETTERS[index] ?? index + 1}. ${option}`}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}

function KeyQuestionEditor({
  question,
  number,
  onChange,
}: {
  question: KeyQuestionDraft;
  number: number;
  onChange: (patch: Partial<KeyQuestionDraft>) => void;
}) {
  const toggleType = () => {
    if (question.type === 'boolean') {
      onChange({ type: 'single', options: ['', ''], answer: null });
    } else {
      onChange({ type: 'boolean', options: [t('True'), t('False')], answer: null });
    }
  };
  const setOption = (index: number, value: string) =>
    onChange({ options: question.options.map((option, at) => (at === index ? value : option)) });

  return (
    <li className="exam-key-question">
      <div className="exam-key-question-head">
        <span className="exam-key-number">{faNum(number)}.</span>
        <button type="button" className="btn btn-ghost btn-tiny" onClick={toggleType}>
          {question.type === 'boolean' ? t('True / False') : t('Multiple choice')}
        </button>
        <label className="exam-points">
          <span>{t('Points')}</span>
          <input
            className="input"
            type="number"
            min={1}
            max={EXAM_POINTS_MAX}
            inputMode="numeric"
            value={question.points}
            aria-label={t('Points for question {0}', { 0: faNum(number) })}
            onChange={(event) => onChange({ points: event.target.value })}
          />
        </label>
      </div>
      {question.type === 'single' ? (
        <ul className="exam-choices">
          {question.options.map((option, index) => (
            <li key={index} className="exam-choice">
              <input
                className="check"
                type="radio"
                name={`key-${question.id}`}
                checked={question.answer === index}
                aria-label={t('Mark option {0} correct', { 0: LETTERS[index] ?? index + 1 })}
                onChange={() => onChange({ answer: index })}
              />
              <input
                className="input"
                maxLength={200}
                value={option}
                placeholder={t('Option {0}', { 0: LETTERS[index] ?? index + 1 })}
                aria-label={t('Option {0} for question {1}', { 0: LETTERS[index] ?? index + 1, 1: faNum(number) })}
                onChange={(event) => setOption(index, event.target.value)}
              />
              {question.options.length > 2 ? (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={t('Remove this option')}
                  onClick={() =>
                    onChange({
                      options: question.options.filter((_, at) => at !== index),
                      answer: question.answer === index ? null : question.answer !== null && question.answer > index ? question.answer - 1 : question.answer,
                    })
                  }
                >
                  <TrashIcon size={13} />
                </button>
              ) : null}
            </li>
          ))}
          {question.options.length < EXAM_CHOICES_MAX ? (
            <li>
              <button
                type="button"
                className="text-btn"
                onClick={() => onChange({ options: [...question.options, ''] })}
              >
                <PlusIcon size={13} />
                {t('Another option')}
              </button>
            </li>
          ) : null}
        </ul>
      ) : (
        <div className="exam-boolean-row">
          {question.options.map((option, index) => (
            <label key={index} className={cx('exam-boolean-option', question.answer === index && 'is-on')}>
              <input
                className="check"
                type="radio"
                name={`bool-${question.id}`}
                checked={question.answer === index}
                onChange={() => onChange({ answer: index })}
              />
              <span>{option}</span>
            </label>
          ))}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ reading */

function SittingReader({
  link,
  exam,
  sitting,
  shareKey,
  busy,
  setBusy,
  onClose,
}: {
  link: GuardianLink;
  exam: Exam | null;
  sitting: ExamSubmission;
  shareKey: string;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  onClose: () => void;
}) {
  const { panels, updatePanels, flash } = usePlanner();
  const [words, setWords] = useState(sitting.feedback ?? '');
  const [mark, setMark] = useState(sitting.status === 'reviewed' ? String(sitting.score) : '');
  const [outOf, setOutOf] = useState(sitting.maxScore ? String(sitting.maxScore) : sitting.marked ? String(sitting.marked) : '');

  const isPaper = sitting.kind === 'paper' || (exam ? examKind(exam) === 'paper' : false);
  const variant = useMemo(
    () => exam?.variants?.find((item) => item.id === sitting.variantId) ?? exam?.variants?.[0] ?? null,
    [exam, sitting.variantId],
  );

  const saveWords = async () => {
    if (busy || !link.linkId) return;
    setBusy(true);
    try {
      updatePanels(await reviewExamSubmission(panels, link.linkId, sitting.id, words));
      flash(t('Your words are on their way.'));
      onClose();
    } catch (error_) {
      flash(error_ instanceof Error ? error_.message : t('Those words could not be sent.'));
    } finally {
      setBusy(false);
    }
  };

  const saveMark = async () => {
    if (busy || !link.linkId) return;
    const score = Number(mark);
    const max = Number(outOf);
    if (!Number.isFinite(score) || score < 0 || !Number.isFinite(max) || max < 1) {
      flash(t('Enter a mark and the total it is out of.'));
      return;
    }
    setBusy(true);
    try {
      updatePanels(await markPaperSubmission(panels, link.linkId, sitting.id, score, max, words));
      flash(t('Mark saved.'));
      onClose();
    } catch (error_) {
      flash(error_ instanceof Error ? error_.message : t('That mark could not be saved.'));
    } finally {
      setBusy(false);
    }
  };

  const allowAgain = async () => {
    if (busy || !link.linkId) return;
    setBusy(true);
    try {
      updatePanels(await grantResubmission(panels, link.linkId, sitting.examId));
      flash(t('Upload re-opened. They can hand in again.'));
      onClose();
    } catch (error_) {
      flash(error_ instanceof Error ? error_.message : t('That could not be changed.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={exam?.title ?? t('An exam')} onClose={onClose}>
      <div className="exam-reading">
        <p className="exam-score is-in">
          <TickIcon size={14} />
          {isPaper ? (
            sitting.status === 'reviewed'
              ? t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })
              : t('Waiting on your mark')
          ) : (
            t('{0} of {1}', { 0: faNum(sitting.score), 1: faNum(sitting.marked) })
          )}
          <span>{formatStamp(sitting.submittedAt)}</span>
          {sitting.late ? <span className="exam-late-tag">{t('Handed in late')}</span> : null}
        </p>

        {exam?.paperFile || variant?.file ? (
          <div className="exam-reading-files">
            <p className="exam-reading-label">{t('Question paper')}</p>
            <ExamFileDownload wrappedShareKey={shareKey} file={(exam?.paperFile ?? variant?.file) as ExamFile} label={t('Download paper')} />
          </div>
        ) : null}

        {isPaper ? (
          <div className="exam-reading-files">
            <p className="exam-reading-label">{t('Answer files')}</p>
            {(sitting.files ?? []).length === 0 ? (
              <p className="hint">{t('No answer files yet')}</p>
            ) : (
              <ul className="exam-answer-files">
                {(sitting.files ?? []).map((file) => (
                  <li key={file.publicId}>
                    <ExamFileDownload wrappedShareKey={shareKey} file={file} label={file.name} />
                  </li>
                ))}
              </ul>
            )}
            {(sitting.status === 'missed' || sitting.late) && !sitting.resubmitGrantedAt ? (
              <button type="button" className="btn btn-outline btn-small" disabled={busy} onClick={() => void allowAgain()}>
                {t('Allow upload again')}
              </button>
            ) : null}
            {sitting.resubmitGrantedAt && (sitting.files?.length ?? 0) === 0 ? (
              <p className="hint is-good">{t('Upload re-opened — waiting on the new attempt.')}</p>
            ) : null}
          </div>
        ) : variant ? (
          <ul className="exam-review">
            {variant.questions.map((question, at) => {
              const chosen = sitting.answers[question.id];
              const blank = chosen === undefined;
              const right = !blank && chosen === question.answer;
              return (
                <li
                  key={question.id}
                  className={cx('exam-review-row', right ? 'is-right' : 'is-wrong', blank && 'is-blank')}
                >
                  <p className="exam-review-q">
                    <span>{faNum(at + 1)}.</span>
                    {question.type === 'boolean' ? t('True / False') : t('Multiple choice')}
                  </p>
                  <ul className="exam-review-choices">
                    {question.options.map((option, index) => (
                      <li
                        key={index}
                        className={cx(
                          index === question.answer && 'is-correct',
                          index === chosen && index !== question.answer && 'is-chosen',
                        )}
                      >
                        {option}
                      </li>
                    ))}
                  </ul>
                  <p className="exam-review-mark">
                    {right
                      ? t('Right · {0} points', { 0: faNum(question.points) })
                      : blank
                        ? t('Left blank')
                        : t('Wrong')}
                  </p>
                </li>
              );
            })}
          </ul>
        ) : null}

        {isPaper ? (
          <div className="field-row">
            <Field label={t('Mark')}>
              <input className="input" type="number" min={0} inputMode="numeric" value={mark} onChange={(event) => setMark(event.target.value)} />
            </Field>
            <Field label={t('Out of')}>
              <input className="input" type="number" min={1} inputMode="numeric" value={outOf} onChange={(event) => setOutOf(event.target.value)} />
            </Field>
          </div>
        ) : null}
        <Field label={t('Say something back')} hint={t('They read it on their side, on this sitting.')}>
          <textarea className="input" rows={3} maxLength={280} value={words} onChange={(event) => setWords(event.target.value)} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn btn-outline btn-small" onClick={onClose}>
            {t('Close')}
          </button>
          {isPaper ? (
            <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => void saveMark()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : <TickIcon size={14} />}
              {t('Save the mark')}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-small" disabled={busy || !words.trim()} onClick={() => void saveWords()}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {t('Send')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
