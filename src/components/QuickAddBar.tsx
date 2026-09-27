import { useMemo, useState, type FormEvent } from 'react';
import { usePlanner } from '../context';
import { suggestTime, todayISO } from '../dates';
import { PlusIcon } from '../icons';
import { parseQuickAdd } from '../quickAdd';
import { t } from '../i18n';

export function QuickAddBar({ defaultDate, placeholder }: { defaultDate?: string | null; placeholder?: string }) {
  const { addTask, addEvent, flash, undo } = usePlanner();
  const [text, setText] = useState('');
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
