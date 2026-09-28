import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { usePlanner } from '../context';
import { suggestTime, todayISO } from '../dates';
import { cx } from '../cx';
import { MicIcon, PlusIcon } from '../icons';
import { parseQuickAdd } from '../quickAdd';
import { useSpeechInput } from '../speech';
import { t } from '../i18n';

export function QuickAddBar({ defaultDate, placeholder }: { defaultDate?: string | null; placeholder?: string }) {
  const { addTask, addEvent, flash, undo } = usePlanner();
  const [text, setText] = useState('');
  const speech = useSpeechInput();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // PWA shortcut / deep link (#/today?qa=1) lands here: put the caret in the box.
    if (typeof window !== 'undefined' && /(#\/)?today\?qa=1/.test(window.location.hash)) {
      inputRef.current?.focus();
      window.history.replaceState(null, '', '#/today');
    }
  }, []);
  const fallback = defaultDate ?? todayISO();
  const parse = useMemo(() => (text.trim() ? parseQuickAdd(text, defaultDate ?? null) : null), [text, defaultDate]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!parse) return;
    if (parse.kind === 'event') {
      addEvent({
        title: parse.title,
        date: parse.date ?? fallback,
        startTime: parse.startTime ?? suggestTime(),
        endTime: parse.endTime,
        category: parse.category ?? 'personal',
        note: '',
        important: false,
      });
      flash(t("Event “{0}” added.", { 0: parse.title }), { label: t("Undo"), run: undo });
    } else {
      addTask({
        title: parse.title,
        priority: parse.priority ?? 'medium',
        dueDate: parse.date ?? defaultDate ?? null,
        dueTime: parse.startTime,
        category: parse.category ?? 'personal',
        note: '',
        goalId: null,
        repeat: parse.repeat,
        estimatedMinutes: parse.estimatedMinutes,
      });
      flash(t("Task “{0}” added.", { 0: parse.title }), { label: t("Undo"), run: undo });
    }
    setText('');
  };

  return (
    <form className="quick-add" onSubmit={submit}>
      <div className="quick-add-row">
        <span className="quick-add-icon" aria-hidden="true">
          <PlusIcon size={16} />
        </span>
        <input
          ref={inputRef}
          value={text}
          dir="auto"
          enterKeyHint="done"
          autoCapitalize="sentences"
          autoCorrect="on"
          spellCheck
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder ?? t("Add anything — try “Call mom tomorrow 5pm #work !high”")}
          aria-label={t("Quick add")}
          maxLength={200}
        />
        {speech.available ? (
          <button
            type="button"
            className={cx('icon-btn', 'quick-add-mic', speech.listening && 'listening')}
            aria-label={speech.listening ? t("Stop dictation") : t("Dictate")}
            aria-pressed={speech.listening}
            title={t("Dictate — tap, speak, done")}
            onClick={() => {
              if (speech.listening) {
                speech.stop();
              } else {
                speech.start((spoken) => {
                  setText((current) => (current.trim() ? `${current.replace(/\s+$/, '')} ${spoken}` : spoken));
                });
              }
            }}
          >
            <MicIcon size={16} />
          </button>
        ) : null}
        <button type="submit" className="btn btn-primary btn-small" disabled={!parse}>
          {t("Add")}
        </button>
      </div>
      {parse ? (
        <div className="quick-add-chips" aria-hidden="true">
          {parse.chips.map((chip) => (
            <span key={chip} className="chip">
              {chip}
            </span>
          ))}
        </div>
      ) : null}
    </form>
  );
}
