/**
 * Two time boxes, one promise.
 *
 * "Chemistry from four to six" is what a guardian means, and this is how they
 * say it — the same two boxes, the same forgiving reading, everywhere a lesson
 * gets a time: the week composer, the plan's steps, an edit to a running plan,
 * and a student's ask for a change.
 *
 * The pair is read the way it was meant (`readLessonTimePair`): one box filled
 * is that lesson's start, and an end before the start is dropped with a line
 * saying so. What will be sent is on screen before it is sent — "16:00 – 18:00 ·
 * 2 h" — so nobody has to guess whether the pair they typed counted.
 */
import { displayTime } from '../dates';
import { t } from '../i18n';
import { ClockIcon } from '../icons';
import { lessonDurationLabel, lessonTimeLabel, lessonTimePairHint, readLessonTimePair } from '../weekPlans';
import { TimeField } from './TimeField';

/** Slots worth one tap: the hours a lesson usually runs. */
export const TIME_SLOTS: Array<{ time: string; end: string }> = [
  { time: '08:00', end: '10:00' },
  { time: '10:00', end: '12:00' },
  { time: '14:00', end: '16:00' },
  { time: '16:00', end: '18:00' },
  { time: '18:00', end: '20:00' },
  { time: '20:00', end: '22:00' },
];

/** "16:00 – 18:00" for a slot chip, in the reader's clock and numerals. */
export function timeSlotLabel(slot: { time: string; end: string }): string {
  return `${displayTime(slot.time)} – ${displayTime(slot.end)}`;
}

/**
 * The row of quick slots. Tapping one fills the pair beside it; tapping the
 * one that is already filled clears it, so a time can be taken back again.
 */
export function TimeSlots({
  time,
  end,
  onPick,
  disabled,
  label,
}: {
  time: string;
  end: string;
  onPick: (slot: { time: string; end: string } | null) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="lesson-slots" role="group" aria-label={label}>
      {TIME_SLOTS.map((slot) => {
        const on = slot.time === time && slot.end === end;
        return (
          <button
            key={`${slot.time}-${slot.end}`}
            type="button"
            className={`btn btn-ghost btn-tiny lesson-slot${on ? ' is-on' : ''}`}
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onPick(on ? null : slot)}
          >
            {timeSlotLabel(slot)}
          </button>
        );
      })}
    </div>
  );
}

export function LessonTimePicker({
  time,
  end,
  onChange,
  disabled,
  /** Names the lesson in the boxes' accessible names: "From (Chemistry)". */
  subject,
  /** The dense rows have no room for a preview line of their own. */
  quiet,
  /**
   * What the two boxes are called where they sit. A plan's steps are a list of
   * four time pairs on one screen, so there they are named for the step they
   * belong to — "Step 1 start time" — and everywhere else they stay the short
   * "From" and "To" the rest of the app reads them as.
   */
  fromLabel,
  toLabel,
}: {
  time: string | null | undefined;
  end: string | null | undefined;
  onChange: (next: { time: string; end: string }) => void;
  disabled?: boolean;
  subject?: string;
  quiet?: boolean;
  fromLabel?: string;
  toLabel?: string;
}) {
  const pair = readLessonTimePair(time, end);
  const hint = lessonTimePairHint(pair);
  const span = lessonTimeLabel(pair);
  const duration = lessonDurationLabel(pair);

  // The pair is a group with the lesson's name on it, and the two boxes inside
  // keep the same short labels everywhere: a row of four time pairs is read as
  // "Time for Chemistry — From, To", not as four fields all called "From".
  return (
    <span
      className="lesson-time"
      role="group"
      aria-label={subject ? t('Time for {0}', { 0: subject }) : t('Lesson time')}
    >
      <span className="week-time-pair">
        <TimeField
          value={time}
          label={fromLabel ?? t('From')}
          disabled={disabled}
          placeholder={t('Start')}
          onChange={(next) => onChange({ time: next, end: end ?? '' })}
        />
        <span aria-hidden="true">–</span>
        <TimeField
          value={end}
          label={toLabel ?? t('To')}
          disabled={disabled}
          placeholder={t('End')}
          onChange={(next) => onChange({ time: time ?? '', end: next })}
        />
      </span>
      {!quiet && span ? (
        <span className="lesson-time-read">
          <ClockIcon size={13} />
          {span}
          {duration ? <em>{duration}</em> : null}
        </span>
      ) : null}
      {hint ? (
        <span className="lesson-time-fix" role="note">
          {hint}
        </span>
      ) : null}
    </span>
  );
}
