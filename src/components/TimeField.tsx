/**
 * A tap-first time field for every device.
 *
 * The native `<input type="time">` is a different widget on every browser and
 * a struggle on phones — small spinners, no quick jumps, and keyboards that
 * cover the form. This keeps one reliable interaction everywhere: a field that
 * shows the chosen time and opens a sheet with hour and minute columns, the
 * common lesson slots, and a native exact-time entry for desktop keyboards.
 *
 * The value is always a 24-hour `HH:MM` string, or '' for "no time". Nothing
 * half-typed ever leaves the component, so a plan can never be broken by a
 * value the reader did not confirm.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cx } from '../cx';
import { displayTime, isValidTime } from '../dates';
import { t } from '../i18n';
import { ClockIcon } from '../icons';
import { TIME_SLOTS, timeSlotLabel } from './LessonTime';

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function split(value: string | null | undefined): { hour: number; minute: number } {
  if (value && isValidTime(value)) {
    const [hour, minute] = value.split(':').map(Number);
    return { hour: hour ?? 0, minute: minute ?? 0 };
  }
  return { hour: 8, minute: 0 };
}

export function TimeField({
  value,
  onChange,
  label,
  disabled = false,
  placeholder,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => split(value));
  const sheetId = useId();
  const rootRef = useRef<HTMLSpanElement>(null);
  const hourRef = useRef<HTMLButtonElement>(null);
  const minuteRef = useRef<HTMLButtonElement>(null);
  const hasValue = !!value && isValidTime(value);

  // The sheet edits a draft; it only becomes the field's value on Done, so
  // opening it to look around never half-fills the form behind the overlay.
  const openSheet = useCallback(() => {
    if (disabled) return;
    setDraft(split(value));
    setOpen(true);
  }, [disabled, value]);

  useLayoutEffect(() => {
    if (!open) return;
    hourRef.current?.scrollIntoView({ block: 'center' });
    minuteRef.current?.scrollIntoView({ block: 'center' });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  const draftLabel = useMemo(() => displayTime(`${pad(draft.hour)}:${pad(draft.minute)}`), [draft]);

  const choose = (patch: Partial<{ hour: number; minute: number }>) => {
    setDraft((current) => ({ ...current, ...patch }));
  };

  const confirm = () => {
    onChange(`${pad(draft.hour)}:${pad(draft.minute)}`);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
  };

  return (
    <span className="time-field" ref={rootRef}>
      <button
        type="button"
        className={cx('time-field-trigger', 'input', hasValue && 'has-value')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={openSheet}
      >
        <ClockIcon size={14} />
        <span>{hasValue ? displayTime(value!) : (placeholder ?? t('Set time'))}</span>
      </button>
      {open ? (
        <span className="time-sheet-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <span className="time-sheet" role="dialog" aria-modal="true" aria-label={label} id={sheetId}>
            <span className="time-sheet-handle" aria-hidden="true" />
            <span className="time-sheet-head">
              <strong>{label}</strong>
              <span className="time-sheet-value" dir="ltr">{draftLabel}</span>
            </span>
            <span className="time-sheet-columns">
              <span className="time-column" aria-label={t('Hour')}>
                {HOURS.map((hour) => (
                  <button
                    key={hour}
                    type="button"
                    ref={hour === draft.hour ? hourRef : undefined}
                    className={cx('time-cell', hour === draft.hour && 'is-on')}
                    aria-pressed={hour === draft.hour}
                    onClick={() => choose({ hour })}
                  >
                    {pad(hour)}
                  </button>
                ))}
              </span>
              <span className="time-colon" aria-hidden="true">:</span>
              <span className="time-column" aria-label={t('Minute')}>
                {MINUTES.map((minute) => (
                  <button
                    key={minute}
                    type="button"
                    ref={minute === draft.minute ? minuteRef : undefined}
                    className={cx('time-cell', minute === draft.minute && 'is-on')}
                    aria-pressed={minute === draft.minute}
                    onClick={() => choose({ minute })}
                  >
                    {pad(minute)}
                  </button>
                ))}
              </span>
            </span>
            <span className="time-sheet-slots" role="group" aria-label={t('Common lesson times')}>
              {TIME_SLOTS.map((slot) => {
                const on = slot.time === `${pad(draft.hour)}:${pad(draft.minute)}`;
                return (
                  <button
                    key={`${slot.time}-${slot.end}`}
                    type="button"
                    className={cx('btn btn-ghost btn-tiny lesson-slot', on && 'is-on')}
                    aria-pressed={on}
                    onClick={() => {
                      const [hour, minute] = slot.time.split(':').map(Number);
                      setDraft({ hour: hour ?? 0, minute: minute ?? 0 });
                    }}
                  >
                    {timeSlotLabel(slot)}
                  </button>
                );
              })}
            </span>
            <span className="time-sheet-exact">
              <label>
                <span className="hint">{t('Or type an exact time')}</span>
                <input
                  type="time"
                  className="input"
                  value={`${pad(draft.hour)}:${pad(draft.minute)}`}
                  onChange={(event) => {
                    if (isValidTime(event.target.value)) {
                      const [hour, minute] = event.target.value.split(':').map(Number);
                      setDraft({ hour: hour ?? 0, minute: minute ?? 0 });
                    }
                  }}
                />
              </label>
            </span>
            <span className="time-sheet-actions">
              <button type="button" className="btn btn-ghost btn-small" onClick={clear}>
                {t('Clear time')}
              </button>
              <button type="button" className="btn btn-primary btn-small" onClick={confirm} data-autofocus>
                {t('Done')}
              </button>
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
