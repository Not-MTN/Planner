/**
 * Developer API settings: personal access tokens for external projects.
 *
 * Two secrets do two different jobs, and the section says so plainly:
 *  - the API token authenticates a request as this account (revocable here);
 *  - the vault key decrypts the planner data, because the server never can.
 * An external project such as a home automation assistant needs both to read
 * or change anything, and losing the token only requires revoking it here —
 * the encryption key never rotates because of it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePlanner } from '../context';
import { t, getLang, type Lang } from '../i18n';
import { createApiToken, listApiTokens, revokeApiToken } from '../auth/apiTokens';
import { getActiveSession } from '../auth/session';
import { toBase64 } from '../auth/crypto';
import { API_TOKEN_EXPIRY_DAYS, type ApiTokenCreated, type ApiTokenInfo, type ApiTokenScope } from '../shared/authContract';
import { CopyIcon, PlusIcon, TrashIcon, KeyIcon, EyeIcon } from '../icons';
import { Field } from './ui';

const EXPIRY_CHOICES: ReadonlyArray<{ days: number; label: string }> = [
  { days: 0, label: 'Never' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
];

function formatDate(iso: string, lang: Lang): string {
  return new Date(iso).toLocaleDateString(lang === 'fa' ? 'fa-IR' : undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ApiTokensSection() {
  const { flash, requestConfirm } = usePlanner();
  const lang = getLang();
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<ApiTokenScope>('read');
  const [expiresInDays, setExpiresInDays] = useState<number>(90);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<ApiTokenCreated | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState<'token' | 'key' | null>(null);

  const load = useCallback(() => {
    let live = true;
    listApiTokens()
      .then((rows) => { if (live) { setTokens(rows); setLoadError(false); } })
      .catch(() => { if (live) { setTokens([]); setLoadError(true); } });
    return () => { live = false; };
  }, []);

  useEffect(() => load(), [load]);

  const vaultKey = useMemo(() => {
    const raw = getActiveSession()?.dekRaw;
    return raw ? toBase64(raw) : null;
  }, []);

  const apiBase = useMemo(() => {
    try {
      return `${window.location.origin}/api/external`;
    } catch {
      return '/api/external';
    }
  }, []);

  const copy = (text: string, which: 'token' | 'key') => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(which);
        flash(t('Copied to clipboard.'));
        window.setTimeout(() => setCopied(null), 1500);
      })
      .catch(() => flash(t('Copying failed. Select the text and copy it manually.')));
  };

  const create = async () => {
    if (!label.trim()) {
      setError(t('Give the token a name so you remember what uses it.'));
      return;
    }
    if (!API_TOKEN_EXPIRY_DAYS.includes(expiresInDays as (typeof API_TOKEN_EXPIRY_DAYS)[number])) return;
    setBusy(true);
    setError('');
    try {
      const result = await createApiToken({ label: label.trim(), scope, expiresInDays });
      setCreated(result);
      setTokens((rows) => [result, ...(rows ?? [])]);
      setLabel('');
      flash(t('Token created. Copy it now — it will not be shown again.'));
    } catch (caught) {
      setError(t('The token could not be created. Check your connection and try again.'));
      void caught;
    } finally {
      setBusy(false);
    }
  };

  const revoke = (token: ApiTokenInfo) => {
    requestConfirm({
      title: t('Revoke “{0}”?', { 0: token.label }),
      body: t('Any project using this token loses access immediately. Your planner data is untouched. You can create a new token any time.'),
      confirmLabel: t('Revoke token'),
      onConfirm: () => {
        setBusy(true);
        setError('');
        revokeApiToken(token.id)
          .then(() => {
            setTokens((rows) => (rows ?? []).filter((row) => row.id !== token.id));
            flash(t('Token revoked.'));
          })
          .catch(() => setError(t('That token could not be revoked. Try again.')))
          .finally(() => setBusy(false));
      },
    });
  };

  return (
    <section className="set-section api-tokens-section">
      <h3 className="kicker">{t('Developer API')}</h3>
      <p className="set-hint">
        {t('Let your own projects — a home assistant, a script, a dashboard — read this planner and make changes over HTTPS. Everything stays end-to-end encrypted: the token proves which account is calling, and your vault key is what unlocks the data.')}
      </p>

      <div className="api-token-create card">
        <p className="set-label">{t('Create a token')}</p>
        <div className="api-token-fields">
          <Field label={t('Token name')}>
            <input
              className="input"
              value={label}
              maxLength={80}
              placeholder={t('Jarvis on the home server')}
              onChange={(event) => setLabel(event.target.value)}
            />
          </Field>
          <Field label={t('Access')}>
            <div className="segmented" role="radiogroup" aria-label={t('Access')}>
              {([
                { id: 'read', label: t('Read only') },
                { id: 'readwrite', label: t('Read & write') },
              ] as const).map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  role="radio"
                  aria-checked={scope === choice.id}
                  className={scope === choice.id ? 'seg on' : 'seg'}
                  onClick={() => setScope(choice.id)}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('Expires')}>
            <select className="input" value={expiresInDays} onChange={(event) => setExpiresInDays(Number(event.target.value))}>
              {EXPIRY_CHOICES.map((choice) => (
                <option key={choice.days} value={choice.days}>{t(choice.label)}</option>
              ))}
            </select>
          </Field>
        </div>
        {error ? <p className="set-hint is-error" role="alert">{error}</p> : null}
        <div className="set-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={create}>
            <PlusIcon size={14} />
            {t('Create token')}
          </button>
        </div>
      </div>

      {created ? (
        <div className="api-token-reveal" role="status">
          <p className="set-label">
            <KeyIcon size={14} /> {t('Copy this token now')}
          </p>
          <p className="set-hint">{t('It is shown once. The server keeps only a hash, so it cannot be recovered later — only replaced.')}</p>
          <div className="api-secret-row">
            <code className="api-secret">{created.token}</code>
            <button type="button" className="btn btn-soft btn-small" onClick={() => copy(created.token, 'token')}>
              <CopyIcon size={13} />
              {copied === 'token' ? t('Copied') : t('Copy')}
            </button>
          </div>
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setCreated(null)}>
            {t('I have saved it')}
          </button>
        </div>
      ) : null}

      <div className="api-vault-key card">
        <p className="set-label">{t('Vault key (for reading the data)')}</p>
        <p className="set-hint">
          {t('The token authenticates; this 256-bit key decrypts the vault in your own project. Keep it beside the token in your project’s secret store, never in a screenshot or chat.')}
        </p>
        {vaultKey ? (
          <>
            <div className="api-secret-row">
              <code className="api-secret">{showKey ? vaultKey : '•'.repeat(32)}</code>
              <button type="button" className="btn btn-ghost btn-small" aria-pressed={showKey} onClick={() => setShowKey((value) => !value)}>
                <EyeIcon size={13} />
                {showKey ? t('Hide') : t('Show')}
              </button>
              <button type="button" className="btn btn-soft btn-small" onClick={() => copy(vaultKey, 'key')}>
                <CopyIcon size={13} />
                {copied === 'key' ? t('Copied') : t('Copy')}
              </button>
            </div>
          </>
        ) : (
          <p className="set-hint is-error">{t('Unlock the planner on this device once to reveal the vault key.')}</p>
        )}
      </div>

      <div className="api-token-list">
        <p className="set-label">{t('Active tokens')}</p>
        {tokens === null ? (
          <p className="set-hint">{t('Loading your tokens…')}</p>
        ) : loadError ? (
          <p className="set-hint is-error">{t('Tokens are available when an account server is connected.')}</p>
        ) : tokens.length === 0 ? (
          <p className="set-hint">{t('No tokens yet. Create one above to connect an external project.')}</p>
        ) : (
          <ul className="device-list">
            {tokens.map((token) => (
              <li key={token.id} className="set-row device-row">
                <div>
                  <p className="set-label">
                    {token.label}
                    <span className={token.scope === 'readwrite' ? 'device-badge is-write' : 'device-badge'}>
                      {token.scope === 'readwrite' ? t('Read & write') : t('Read only')}
                    </span>
                  </p>
                  <p className="set-hint">
                    {token.expiresAt ? t('Expires {0}', { 0: formatDate(token.expiresAt, lang) }) : t('Never expires')}
                    {' · '}
                    {token.lastUsedAt ? t('Last used {0}', { 0: formatDate(token.lastUsedAt, lang) }) : t('Never used')}
                    {' · '}
                    {t('Created {0}', { 0: formatDate(token.createdAt, lang) })}
                  </p>
                </div>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => revoke(token)}>
                  <TrashIcon size={13} />
                  {t('Revoke')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <details className="api-docs">
        <summary>{t('How to use it')}</summary>
        <div className="api-docs-body">
          <p className="set-hint">{t('Send the token as a bearer header. GET pulls the encrypted vault; PUT writes it back with optimistic concurrency.')}</p>
          <pre className="api-code"><code>{`# Who am I?
curl -H "Authorization: Bearer $PLANNER_TOKEN" ${apiBase}/me

# Pull the encrypted vault
curl -H "Authorization: Bearer $PLANNER_TOKEN" ${apiBase}/vault

# Write it back (baseVersion must match the version you read)
curl -X PUT ${apiBase}/vault \\
  -H "Authorization: Bearer $PLANNER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"baseVersion": 1, "ciphertext": "..."}'`}</code></pre>
          <p className="set-hint">
            {t('A read-only token cannot PUT — the API answers 403. A stale baseVersion answers 409 and returns the current vault, so the project can merge and retry. Decrypt and encrypt with the vault key using AES-256-GCM exactly as the app does.')}
          </p>
        </div>
      </details>
    </section>
  );
}
