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
  const [inputFocused, setInputFocused] = useState(false);
  const speech = useSpeechInput();
  const inputRef = useRef<HTMLInputElement>(null);
  // The example placeholder is a lesson on wide screens and a wall of
  // truncated text on a phone, so small screens get the short version.
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches,
  );
  useEffect(() => {
    const query = window.matchMedia('(max-width: 480px)');
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // The caret for `#/today?qa=1` is Shell.tsx's job (it keeps watch while the
  // app settles). Stripping the query here would race it: this effect runs
  // before the Shell's, the router re-reads the address, the route flips to
  // `today` and the view remounts under the caret that was just placed.
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
    <form
      className="quick-add"
      onSubmit={submit}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setInputFocused(false);
      }}
    >
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
          onFocus={() => setInputFocused(true)}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder ?? (narrow ? t("Add anything…") : t("Add anything — try “Call mom tomorrow 5pm #work !high”"))}
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
      {narrow && inputFocused && !text.trim() ? (
        <div className="quick-add-examples" role="group" aria-label={t("Quick-add examples")}>
          <span>{t("Try an example")}</span>
          {[t("Call mom tomorrow 5pm #work !high"), t("Drink water every day")].map((example) => (
            <button
              key={example}
              type="button"
              className="quick-add-example"
              onClick={() => {
                setText(example);
                inputRef.current?.focus();
                setInputFocused(false);
              }}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}
