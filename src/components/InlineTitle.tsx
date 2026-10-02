import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cx } from '../cx';
import { PencilIcon } from '../icons';
import { t } from '../i18n';

/**
 * A title you can correct where it sits.
 *
 * Opening the whole composer to fix one typo means reading every field again
 * and hoping Save keeps the rest intact, so rows that only need a wording fix
 * get this instead: click the title, type, Enter. Everything else about the
 * item (date, priority, checklist, note) is untouched, because the only field
 * written is the title.
 *
 * Enter saves, Escape cancels, clicking away saves. An empty title is never
 * saved — the row would just vanish from every filtered list.
 */
export function InlineTitle({
  value,
  onCommit,
  onOpenDetails,
  onEditingChange,
  className,
  maxLength = 140,
  disabled = false,
}: {
  value: string;
  /** Called with the trimmed title, only when it actually changed. */
  onCommit: (next: string) => void;
  /** Optional pencil: saves the inline text, then opens the full editor. */
  onOpenDetails?: () => void;
  /** Lets a draggable row stand down while its title is being typed in. */
  onEditingChange?: (editing: boolean) => void;
  className?: string;
  maxLength?: number;
  /** Read-only rows (a repeat projection) keep the caller's own handler. */
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [refocus, setRefocus] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Callers pass an inline arrow; a ref keeps the effect off every render.
  const editingChangeRef = useRef(onEditingChange);
  editingChangeRef.current = onEditingChange;

  useEffect(() => {
    editingChangeRef.current?.(editing);
  }, [editing]);

  // Sync, undo and edits made elsewhere still win — unless the user is
  // mid-word, in which case their keystrokes do.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Grow with the text: a long title should not be edited through a slot.
  useLayoutEffect(() => {
    const node = areaRef.current;
    if (!editing || !node) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [editing, draft]);

  useEffect(() => {
    if (!editing) return;
    const node = areaRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    // Caret at the end: the usual job is fixing a word, not rewriting the line.
    node.setSelectionRange(node.value.length, node.value.length);
  }, [editing]);

  // Keyboard saves hand focus back to the title, so the row stays navigable.
  useEffect(() => {
    if (editing || !refocus) return;
    buttonRef.current?.focus({ preventScroll: true });
    setRefocus(false);
  }, [editing, refocus]);

  const close = (save: boolean, handBackFocus: boolean) => {
    setEditing(false);
    if (handBackFocus) setRefocus(true);
    if (!save) return;
    const next = draft.trim();
    if (!next || next === value) return;
    onCommit(next);
  };

  if (!editing) {
    return (
      <button
        ref={buttonRef}
        type="button"
        dir="auto"
        className={cx('item-title', 'inline-title', className)}
        title={t("Click to edit the title")}
        onClick={() => {
          if (disabled) return;
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </button>
    );
  }

  return (
    <span className="inline-title-edit" onClick={(event) => event.stopPropagation()}>
      <textarea
        ref={areaRef}
        className={cx('item-title', 'inline-title-input', className)}
        dir="auto"
        value={draft}
        rows={1}
        maxLength={maxLength}
        enterKeyHint="done"
        aria-label={t("Title")}
        onChange={(event) => setDraft(event.target.value)}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            close(true, true);
          } else if (event.key === 'Escape') {
            // Do not let Escape reach the page (or a sheet) behind the row.
            event.preventDefault();
            event.stopPropagation();
            close(false, true);
          }
        }}
        onBlur={() => close(true, false)}
      />
      {onOpenDetails ? (
        <button
          type="button"
          className="icon-btn inline-title-details"
          aria-label={t("Edit details")}
          title={t("Edit details")}
          // Keep focus (and the draft) in place so the click still lands.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            close(true, false);
            onOpenDetails();
          }}
        >
          <PencilIcon size={15} />
        </button>
      ) : null}
      <span className="inline-title-hint">{t("Enter saves, Esc cancels")}</span>
    </span>
  );
}
