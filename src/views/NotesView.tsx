import { useMemo, useState } from 'react';
import { NOTE_KINDS, noteKindById } from '../constants';
import { usePlanner } from '../context';
import { cx } from '../cx';
import { dayNumber, formatEdited, formatMonthShort, todayISO } from '../dates';
import { matchesQuery } from '../logic';
import { Empty } from '../components/ui';

export function NotesView() {
  const { state, openComposer, deleteNote, flash, undo } = usePlanner();
  const [kind, setKind] = useState<'all' | (typeof NOTE_KINDS)[number]['id']>('all');
  const [query, setQuery] = useState('');
  const notes = useMemo(
    () =>
      state.notes.filter((note) => (kind === 'all' || note.kind === kind) && matchesQuery([note.title, note.body, note.kind], query)),
    [state.notes, kind, query],
  );

  return (
    <div className="view">
      <header className="page-head">
        <div>
          <p className="kicker">Notes</p>
          <h1>Notes</h1>
          <p className="lede">A quiet place for thoughts.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'note', date: todayISO() })}>
          Add note
        </button>
      </header>
      <div className="toolbar">
        <div className="filters" role="tablist" aria-label="Note kinds">
          <button type="button" role="tab" aria-selected={kind === 'all'} className={cx('filter', kind === 'all' && 'on')} onClick={() => setKind('all')}>
            All
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
          <span className="visually-hidden">Search notes</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" />
        </label>
      </div>
      {state.notes.length === 0 ? (
        <section className="card">
          <Empty
            title="No notes yet."
            text="A quick note, an idea, a reminder, or a short journal entry."
            action={
              <button type="button" className="btn btn-primary" onClick={() => openComposer({ mode: 'create', type: 'note' })}>
                Add note
              </button>
            }
          />
        </section>
      ) : notes.length === 0 ? (
        <section className="card">
          <Empty title="No notes match." text="Try another kind, or clear the search." />
        </section>
      ) : (
        <div className="note-grid">
          {notes.map((note) => {
            const meta = noteKindById(note.kind);
            return (
              <article key={note.id} className={cx('card note-card', `accent-${meta.accent}`, note.kind === 'journal' && 'is-journal')}>
                <button type="button" className="note-open" onClick={() => openComposer({ mode: 'edit', type: 'note', id: note.id })}>
                  <span className={cx('chip-label', `accent-${meta.accent}`)}>{meta.label}</span>
                  <h2>{note.title}</h2>
                  <p>{note.body || 'No words yet.'}</p>
                  <small>
                    {formatEdited(note.updatedAt)}
                    {note.date ? ` · ${dayNumber(note.date)} ${formatMonthShort(note.date)}` : ''}
                  </small>
                </button>
                <button
                  type="button"
                  className="text-btn"
                  onClick={() => {
                    deleteNote(note.id);
                    flash(`Note “${note.title}” removed.`, { label: 'Undo', run: undo });
                  }}
                >
                  Remove
                </button>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
