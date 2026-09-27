import { useMemo, useState } from 'react';
import { NOTE_KINDS, noteKindById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { dayNumber, formatEdited, formatMonthShort, todayISO } from '../dates';
import { matchesQuery } from '../logic';
import { Empty } from '../components/ui';
import { extractTags, Markdown } from '../components/Markdown';
import { t } from '../i18n';

export function NotesView() {
  const { state, openComposer, deleteNote, updateNote, flash, undo } = usePlanner();
  const [kind, setKind] = useState<'all' | (typeof NOTE_KINDS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const allTags = useMemo(() => [...new Set(state.notes.flatMap((note) => extractTags(`${note.title} ${note.body}`)))].sort(), [state.notes]);
  const notes = useMemo(
    () =>
      state.notes
        .filter(
          (note) =>
            (kind === 'all' || note.kind === kind) &&
            matchesQuery([note.title, note.body, note.kind], query) &&
            (!tag || extractTags(`${note.title} ${note.body}`).includes(tag)),
        )
        .sort(
          (a, b) =>
            Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt.localeCompare(a.updatedAt),
        ),
    [state.notes, kind, query, tag],
  );

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">{t("Notes")}</p>
          <h1>{t("Notes")}</h1>
          <p className="lede">{t("A quiet place for thoughts.")}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'note', date: todayISO() })}>
          {t("Add note")}
        </button>
      </header>
      <div className="toolbar">
        <div className="filters" role="tablist" aria-label={t("Note kinds")}>
          <button type="button" role="tab" aria-selected={kind === 'all'} className={cx('filter', kind === 'all' && 'on')} onClick={() => setKind('all')}>
            {t("All")}
          </button>
          {NOTE_KINDS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={kind === item.id}
              className={cx('filter', kind === item.id && 'on')}
              onClick={() => setKind(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <label className="search">
          <span className="visually-hidden">{t("Search notes")}</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Search notes")} />
        </label>
      </div>
      {allTags.length ? (
        <div className="tag-row" role="group" aria-label={t("Filter by tag")}>
          {allTags.map((item) => (
            <button key={item} type="button" className={cx('note-tag', 'as-btn', tag === item && 'on')} aria-pressed={tag === item} onClick={() => setTag(tag === item ? null : item)}>
              #{item}
            </button>
          ))}
        </div>
      ) : null}
      {state.notes.length === 0 ? (
        <section className="card">
          <Empty
            image="/img/spot-notes.jpg"
            title={t("No notes yet.")}
            text={t("A quick note, an idea, a reminder, or a short journal entry.")}
            action={
              <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'note' })}>
                {t("Add note")}
              </button>
            }
          />
        </section>
      ) : notes.length === 0 ? (
        <section className="card">
          <Empty title={t("No notes match.")} text={t("Try another kind, or clear the search.")} />
        </section>
      ) : (
        <div className="note-grid">
          {notes.map((note) => {
            const meta = noteKindById(note.kind);
            return (
              <article key={note.id} className={cx('card note-card', `accent-${meta.accent}`, note.kind === 'journal' && 'is-journal', note.pinned && 'is-pinned')}>
                <button type="button" className="note-open" onClick={() => openComposer({ mode: 'edit', type: 'note', id: note.id })}>
                  <span className={cx('chip-label', `accent-${meta.accent}`)}>{meta.label}</span>
                  <h2>{note.title}</h2>
                  {note.body ? <div className="md-body"><Markdown text={note.body} limit={14} /></div> : <p>{t("No words yet.")}</p>}
                  <small>
                    {formatEdited(note.updatedAt)}
                    {note.date ? ` · ${dayNumber(note.date)} ${formatMonthShort(note.date)}` : ''}
                  </small>
                </button>
                <div className="note-actions">
                <button
                  type="button"
                  className="text-btn"
                  aria-pressed={Boolean(note.pinned)}
                  onClick={() => updateNote(note.id, { pinned: !note.pinned })}
                >
                  {note.pinned ? t("📌 Unpin") : t("Pin")}
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    deleteNote(note.id);
                    flash(t("Note “{0}” removed.", { 0: note.title }), { label: t("Undo"), run: undo });
                  }}
                >
                  {t("Remove")}
                </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
