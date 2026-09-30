import { useState } from 'react';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { dayNumber, formatMonthShort, isValidISODate, todayISO } from '../dates';
import { BookIcon, CalendarIcon, FlagIcon, PencilIcon, PlusIcon, StopwatchIcon, TrashIcon } from '../icons';
import { t } from '../i18n';
import { ACCENTS } from '../constants';
import { daysUntil, newId, subjectMinutes, subjectProgress, weekOf, withoutSubject } from '../panels';
import { studyQueue, subjectDraftError, upcomingExams, type StudyWindow, type SubjectDraft } from '../panelFeatures';
import type { StudentSubject } from '../types';
import { Empty, Field } from './ui';
import { minutesLabel } from './charts';

const emptySubject: SubjectDraft = { name: '', examDate: '', targetHours: '' };

function dateLabel(date: string): string {
  return `${dayNumber(date)} ${formatMonthShort(date)}`;
}

export function StudentWorkspace() {
  const { state, panels, addTask, toggleTask, startFocus, openComposer, flash } = usePlanner();
  const today = todayISO();
  const subjects = panels.student.subjects;
  const [window, setWindow] = useState<StudyWindow>('week');
  const [subjectId, setSubjectId] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [showAllExams, setShowAllExams] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: '', subjectId: '', date: today, minutes: '25' });
  const [taskError, setTaskError] = useState<string | null>(null);
  const selectedId = subjects.some((subject) => subject.id === subjectId) ? subjectId : '';
  const queue = studyQueue(state, window, selectedId, today);
  const exams = upcomingExams(subjects, today);
  const estimate = queue.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0);

  const openTask = (subject?: StudentSubject) => {
    setTaskError(null);
    setTaskDraft({
      title: subject ? t('Revise {0}', { 0: subject.name }) : '',
      subjectId: subject?.id ?? (selectedId || subjects[0]?.id || ''),
      date: today,
      minutes: '25',
    });
    setAddingTask(true);
  };

  const createTask = (event: React.FormEvent) => {
    event.preventDefault();
    const subject = subjects.find((item) => item.id === taskDraft.subjectId);
    if (!taskDraft.title.trim() || !subject) {
      setTaskError(t('Choose a subject and give the study task a title.'));
      return;
    }
    if (taskDraft.date && !isValidISODate(taskDraft.date)) {
      setTaskError(t('Choose a valid due date.'));
      return;
    }
    const minutes = Number(taskDraft.minutes);
    if (taskDraft.minutes && (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)) {
      setTaskError(t('Choose between 1 and 1440 minutes, or leave it empty.'));
      return;
    }
    addTask({
      title: taskDraft.title.trim(),
      category: subject.name,
      dueDate: taskDraft.date || null,
      dueTime: null,
      priority: 'medium',
      note: '',
      goalId: null,
      estimatedMinutes: taskDraft.minutes ? Math.round(minutes) : null,
    });
    setAddingTask(false);
    setTaskError(null);
    // Make an undated or later task visible immediately instead of hiding the successful add.
    setWindow('all');
    setSubjectId(subject.id);
    flash(t('Study task added to your planner.'));
  };

  return (
    <>
      <div className="panel-workspace-grid">
        <section className="card study-queue-card" aria-label={t('Your study queue')}>
          <header className="card-head">
            <div>
              <p className="kicker">{t('One step at a time')}</p>
              <h2 className="card-title">{t('Your study queue')}</h2>
            </div>
            <button
              type="button"
              className="btn btn-soft btn-small"
              disabled={subjects.length === 0}
              aria-expanded={addingTask}
              onClick={() => (addingTask ? setAddingTask(false) : openTask())}
            >
              <PlusIcon size={14} /> {t('Add study task')}
            </button>
          </header>
          {addingTask ? (
            <form className="study-task-form panel-inline-form" onSubmit={createTask}>
              <Field label={t('Study task')}>
                <input
                  className="input"
                  value={taskDraft.title}
                  maxLength={140}
                  autoFocus
                  required
                  placeholder={t('Revise chapter 4')}
                  onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
                />
              </Field>
              <div className="panel-form-grid">
                <Field label={t('Subject')}>
                  <select
                    className="input"
                    value={taskDraft.subjectId}
                    required
                    onChange={(event) => setTaskDraft({ ...taskDraft, subjectId: event.target.value })}
                  >
                    <option value="">{t('Choose a subject')}</option>
                    {subjects.map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t('Due date')}>
                  <input
                    className="input"
                    type="date"
                    value={taskDraft.date}
                    onChange={(event) => setTaskDraft({ ...taskDraft, date: event.target.value })}
                  />
                </Field>
                <Field label={t('Estimated minutes')}>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={1440}
                    step={1}
                    value={taskDraft.minutes}
                    onChange={(event) => setTaskDraft({ ...taskDraft, minutes: event.target.value })}
                  />
                </Field>
              </div>
              {taskError ? (
                <p className="field-error" role="alert">
                  {taskError}
                </p>
              ) : null}
              <div className="panel-form-actions">
                <button type="submit" className="btn btn-primary btn-small">
                  {t('Save study task')}
                </button>
                <button type="button" className="btn btn-ghost btn-small" onClick={() => setAddingTask(false)}>
                  {t('Cancel')}
                </button>
              </div>
              <p className="hint">{t('Task titles stay private. Guardians receive weekly totals, not this queue.')}</p>
            </form>
          ) : null}
          <div className="study-toolbar">
            <div className="segmented" role="group" aria-label={t('Study task window')}>
              <button
                type="button"
                className={cx('segment', window === 'today' && 'on')}
                aria-pressed={window === 'today'}
                onClick={() => {
                  setWindow('today');
                  setShowAll(false);
                }}
              >
                {t('Today')}
              </button>
              <button
                type="button"
                className={cx('segment', window === 'week' && 'on')}
                aria-pressed={window === 'week'}
                onClick={() => {
                  setWindow('week');
                  setShowAll(false);
                }}
              >
                {t('This week')}
              </button>
              <button
                type="button"
                className={cx('segment', window === 'all' && 'on')}
                aria-pressed={window === 'all'}
                onClick={() => {
                  setWindow('all');
                  setShowAll(false);
                }}
              >
                {t('All open')}
              </button>
            </div>
            <select
              className="input study-subject-filter"
              aria-label={t('Filter by subject')}
              value={selectedId}
              onChange={(event) => {
                setSubjectId(event.target.value);
                setShowAll(false);
              }}
            >
              <option value="">{t('All subjects')}</option>
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </div>
          {queue.length > 0 ? (
            <>
              <p className="panel-list-summary" aria-live="polite">
                {t('{0} open tasks · {1} estimated', { 0: queue.length, 1: minutesLabel(estimate) })}
              </p>
              <ul className="study-task-list">
                {(showAll ? queue : queue.slice(0, 6)).map((task) => (
                  <li key={task.id} className="study-task-row">
                    <input
                      type="checkbox"
                      checked={task.completed}
                      aria-label={t('Complete {0}', { 0: task.title })}
                      onChange={() => toggleTask(task.id)}
                    />
                    <div className="study-task-copy">
                      <button
                        type="button"
                        className="study-task-title"
                        onClick={() => openComposer({ mode: 'edit', type: 'task', id: task.id })}
                      >
                        {task.title}
                      </button>
                      <p className="study-task-meta">
                        <span>{task.category}</span>
                        <span className={cx(task.dueDate && task.dueDate < today && 'study-overdue')}>
                          {task.dueDate
                            ? task.dueDate < today
                              ? t('Overdue · {0}', { 0: dateLabel(task.dueDate) })
                              : task.dueDate === today
                                ? t('Today')
                                : dateLabel(task.dueDate)
                            : t('No due date')}
                        </span>
                        {task.estimatedMinutes ? <span>{minutesLabel(task.estimatedMinutes)}</span> : null}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-tiny"
                      aria-label={t('Focus on {0}', { 0: task.title })}
                      onClick={() =>
                        startFocus({
                          taskId: task.id,
                          title: task.title,
                          minutes: Math.min(60, task.estimatedMinutes ?? 25),
                        })
                      }
                    >
                      <StopwatchIcon size={14} /> {t('Focus')}
                    </button>
                  </li>
                ))}
              </ul>
              {queue.length > 6 ? (
                <button type="button" className="text-btn panel-show-more" onClick={() => setShowAll(!showAll)}>
                  {showAll ? t('Show less') : t('Show all {0} tasks', { 0: queue.length })}
                </button>
              ) : null}
            </>
          ) : (
            <Empty
              title={subjects.length === 0 ? t('Make a little room for studying') : t('A clear study queue')}
              text={
                subjects.length === 0
                  ? t('Add a subject below to get started. Your personal planner stays as it is.')
                  : t('Nothing due in this view. Add a study task, or choose All open to see undated and later work.')
              }
            />
          )}
          <p className="panel-private-note">
            <BookIcon size={13} /> {t('Only tasks in your tracked subject categories appear here.')}
          </p>
        </section>

        <section className="card exam-agenda" aria-label={t('Upcoming exams')}>
          <header className="card-head">
            <div>
              <p className="kicker">{t('A little ahead')}</p>
              <h2 className="card-title">{t('Upcoming exams')}</h2>
            </div>
            <span className="panel-section-icon">
              <CalendarIcon size={19} />
            </span>
          </header>
          {exams.length > 0 ? (
            <>
              <ul className="exam-agenda-list">
                {(showAllExams ? exams : exams.slice(0, 4)).map(({ subject, days }) => (
                  <li key={subject.id} className={cx(`accent-${subject.accent}`, days <= 7 && 'exam-near')}>
                    <span className="exam-date-tile">
                      <strong>{dayNumber(subject.examDate!)}</strong>
                      <span>{formatMonthShort(subject.examDate!)}</span>
                    </span>
                    <div className="exam-agenda-copy">
                      <strong>{subject.name}</strong>
                      <p>
                        {days === 0
                          ? t('Exam today')
                          : days === 1
                            ? t('Exam tomorrow')
                            : t('{0} days to exam', { 0: days })}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="icon-btn round"
                      aria-label={t('Add revision for {0}', { 0: subject.name })}
                      title={t('Add revision for {0}', { 0: subject.name })}
                      onClick={() => openTask(subject)}
                    >
                      <PlusIcon size={16} />
                    </button>
                  </li>
                ))}
              </ul>
              {exams.length > 4 ? (
                <button
                  type="button"
                  className="text-btn panel-show-more"
                  onClick={() => setShowAllExams(!showAllExams)}
                >
                  {showAllExams ? t('Show less') : t('Show all exams')}
                </button>
              ) : null}
              <p className="hint">{t('Use + to turn exam preparation into a study task.')}</p>
            </>
          ) : (
            <Empty
              title={t('No upcoming exams')}
              text={t('Set an exam date on a subject below. Past exams stay in your subjects, not in this list.')}
            />
          )}
        </section>
      </div>
      <SubjectTracker onStudy={openTask} />
    </>
  );
}

function SubjectTracker({ onStudy }: { onStudy: (subject: StudentSubject) => void }) {
  const { state, panels, updatePanels, saveStudentSubject, requestConfirm, flash } = usePlanner();
  const [form, setForm] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<SubjectDraft>(emptySubject);
  const [error, setError] = useState<string | null>(null);
  const subjects = panels.student.subjects;
  const week = weekOf();

  const open = (subject?: StudentSubject) => {
    setForm(subject?.id ?? 'new');
    setDraft(
      subject
        ? {
            name: subject.name,
            examDate: subject.examDate ?? '',
            targetHours: subject.targetMinutes ? String(subject.targetMinutes / 60) : '',
          }
        : emptySubject,
    );
    setError(null);
  };

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const editingId = form && form !== 'new' ? form : undefined;
    const issue = subjectDraftError(subjects, draft, editingId);
    if (issue) {
      setError(issue);
      return;
    }
    const previous = subjects.find((subject) => subject.id === editingId);
    saveStudentSubject({
      id: editingId ?? newId('sub'),
      name: draft.name.trim(),
      accent: previous?.accent ?? ACCENTS[subjects.length % ACCENTS.length] ?? 'sage',
      examDate: draft.examDate || null,
      targetMinutes: draft.targetHours ? Math.round(Number(draft.targetHours) * 60) : null,
    });
    setForm(null);
    setError(null);
    flash(editingId ? t('Subject updated. Existing study tasks keep their progress.') : t('Subject added.'));
  };

  const remove = (subject: StudentSubject) =>
    requestConfirm({
      title: t('Remove {0}?', { 0: subject.name }),
      body: t('Only this subject tracker is removed. Your tasks, events, and focus history are kept.'),
      confirmLabel: t('Remove subject'),
      onConfirm: () => {
        updatePanels((current) => withoutSubject(current, subject.id));
        if (form === subject.id) setForm(null);
        flash(t('Subject removed.'));
      },
    });

  return (
    <section className="card subject-tracker" aria-label={t('Subjects')}>
      <header className="card-head">
        <div>
          <p className="kicker">{t('Subjects')}</p>
          <h2 className="card-title">{t('What you’re working towards')}</h2>
        </div>
        <button
          type="button"
          className="btn btn-tiny"
          aria-expanded={form !== null}
          onClick={() => (form ? setForm(null) : open())}
        >
          <PlusIcon size={14} /> {t('Subject')}
        </button>
      </header>
      {form ? (
        <form className="panel-form panel-inline-form subject-form" onSubmit={save}>
          <div className="panel-form-grid">
            <Field label={t('Subject')}>
              <input
                className="input"
                value={draft.name}
                autoFocus
                maxLength={60}
                required
                placeholder={t('Mathematics')}
                onChange={(event) => {
                  setDraft({ ...draft, name: event.target.value });
                  setError(null);
                }}
              />
            </Field>
            <Field label={t('Exam date')}>
              <input
                className="input"
                type="date"
                value={draft.examDate}
                onChange={(event) => setDraft({ ...draft, examDate: event.target.value })}
              />
            </Field>
            <Field label={t('Target hours per week')}>
              <input
                className="input"
                type="number"
                min={0.5}
                max={168}
                step={0.5}
                value={draft.targetHours}
                placeholder={t('Optional')}
                onChange={(event) => setDraft({ ...draft, targetHours: event.target.value })}
              />
            </Field>
          </div>
          {error ? (
            <p className="field-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="panel-form-actions">
            <button type="submit" className="btn btn-primary btn-small">
              {form === 'new' ? t('Add subject') : t('Save subject')}
            </button>
            <button type="button" className="btn btn-ghost btn-small" onClick={() => setForm(null)}>
              {t('Cancel')}
            </button>
          </div>
          <p className="hint">
            {t('Study time is counted from focus sessions on tasks in a category with the same name.')}
          </p>
          {form !== 'new' ? (
            <p className="hint">
              {t('Renaming also updates matching task and event categories. Your focus history is kept.')}
            </p>
          ) : null}
        </form>
      ) : null}
      {subjects.length === 0 ? (
        <Empty title={t('No subjects yet')} text={t('Add one to watch an exam date and weekly focus.')} />
      ) : (
        <ul className="subject-tracker-grid">
          {subjects.map((subject) => {
            const minutes = subjectMinutes(state, subject, week);
            const progress = subjectProgress(state, subject, week);
            const days = daysUntil(subject.examDate);
            const target = subject.targetMinutes ?? 0;
            const ratio =
              target > 0 ? Math.min(1, minutes / target) : progress.total ? progress.done / progress.total : 0;
            return (
              <li key={subject.id} className={cx('subject-tile', `accent-${subject.accent}`)}>
                <div className="subject-tile-head">
                  <span className="subject-tile-symbol">
                    <BookIcon size={18} />
                  </span>
                  <h3>{subject.name}</h3>
                  <button
                    type="button"
                    className="icon-btn round"
                    aria-label={t('Edit {0}', { 0: subject.name })}
                    onClick={() => open(subject)}
                  >
                    <PencilIcon size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn round"
                    aria-label={t('Remove {0}', { 0: subject.name })}
                    onClick={() => remove(subject)}
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
                <p className={cx('subject-tile-exam', days !== null && days >= 0 && days <= 7 && 'exam-near')}>
                  <FlagIcon size={13} />{' '}
                  {days === null
                    ? t('No exam date')
                    : days < 0
                      ? t('Exam passed')
                      : days === 0
                        ? t('Exam today')
                        : t('{0} days to exam', { 0: days })}
                </p>
                <div className="subject-target-copy">
                  <span>{t('Focused this week')}</span>
                  <strong>
                    {minutesLabel(minutes)}
                    {target > 0 ? <span> / {minutesLabel(target)}</span> : null}
                  </strong>
                </div>
                <div
                  className="subject-target-bar"
                  role="progressbar"
                  aria-label={t('Weekly progress for {0}', { 0: subject.name })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(ratio * 100)}
                >
                  <span style={{ width: `${Math.round(ratio * 100)}%` }} />
                </div>
                <div className="subject-tile-foot">
                  <span>
                    {target > 0
                      ? minutes >= target
                        ? t('Weekly target reached')
                        : t('{0} left to your target', { 0: minutesLabel(Math.max(0, target - minutes)) })
                      : t('{0} of {1} tasks done', { 0: progress.done, 1: progress.total })}
                  </span>
                  <button type="button" className="text-btn" onClick={() => onStudy(subject)}>
                    {t('Plan study')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
