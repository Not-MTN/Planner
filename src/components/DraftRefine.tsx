import { useState, type FormEvent } from 'react';
import { SparklesIcon } from '../icons';
import { t } from '../i18n';

/**
 * "Ask the AI to change this draft" — one line of natural language
 * ("make Tuesday lighter", "move the workout to evening") and the plan is
 * revised in place. Used by the AI coach draft card and the Plans page.
 */
export function DraftRefine({ working, onRefine }: {
  working: boolean;
  onRefine: (request: string) => void;
}) {
  const [request, setRequest] = useState('');
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clean = request.trim();
    if (!clean || working) return;
    onRefine(clean);
    setRequest('');
  };
  return (
    <form className="ai-refine" onSubmit={submit}>
      <input
        value={request}
        maxLength={500}
        disabled={working}
        placeholder={t("Ask for a change — “make Tuesday lighter”, “move the workout to evening”…")}
        aria-label={t("Ask the AI to change this draft")}
        onChange={(event) => setRequest(event.target.value)}
      />
      <button type="submit" className="btn btn-soft btn-small" disabled={working || !request.trim()}>
        <SparklesIcon size={14} /> {working ? t("Revising…") : t("Revise draft")}
      </button>
    </form>
  );
}
