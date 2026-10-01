import { useState } from 'react';
import { usePlanner } from '../context';
import { postPraise } from '../auth/links';
import { t } from '../i18n';
import { minutesLabel } from './charts';
import type { GuardianLink } from '../types';

/**
 * Guardian: send encouragement.
 *
 * A blank box under a heading like this is harder to fill than it looks, so the
 * openers are drawn from the week the guardian has actually been shown: the
 * hours, the finished work, the subject that got the time. Praise that names
 * something real lands; praise that names nothing does not.
 */
export function PraiseComposer({ link }: { link: GuardianLink }) {
  const { panels, updatePanels, flash } = usePlanner();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const results = link.results;

  const openers = [
    results && results.focusMinutes >= 60
      ? t('You focused for {0} this week. That is real work.', { 0: minutesLabel(results.focusMinutes) })
      : null,
    results && results.done > 0 ? t('You finished {0} things you had planned.', { 0: results.done }) : null,
    results?.subjects[0]?.name ? t('{0} got your attention this week.', { 0: results.subjects[0].name }) : null,
    t('However this week went, I noticed you keeping at it.'),
  ].filter((line): line is string => Boolean(line));

  const send = async (message: string) => {
    if (sending) return;
    const clean = message.trim().slice(0, 160);
    if (!clean) {
      setError(t('Say something, even a few words.'));
      return;
    }
    setSending(true);
    setError(null);
    try {
      const next = await postPraise(panels, link.linkId ?? '', clean);
      updatePanels(() => next);
      setText('');
      flash(t('Sent. They can keep it as long as they like.'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('That could not be sent.'));
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="praise-form"
      onSubmit={(event) => {
        event.preventDefault();
        void send(text);
      }}
    >
      <label className="field-label" htmlFor={`praise-${link.id}`}>
        {t('Say something kind')}
      </label>
      <p className="praise-note">{t('Not a task and not a plan. Something they can read again on a hard week.')}</p>
      <textarea
        id={`praise-${link.id}`}
        className="input"
        rows={2}
        maxLength={160}
        value={text}
        placeholder={t('You kept going this week, and I saw it.')}
        disabled={sending}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
      />
      {openers.length > 0 ? (
        <div className="praise-openers">
          {openers.map((line) => (
            <button key={line} type="button" className="text-btn" disabled={sending} onClick={() => void send(line)}>
              {line}
            </button>
          ))}
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      <div className="panel-form-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={sending || !text.trim()}>
          {sending ? <span className="spinner" aria-hidden="true" /> : null}
          {t('Send')}
        </button>
        <span className="note-character-count">{text.length}/160</span>
      </div>
    </form>
  );
}
