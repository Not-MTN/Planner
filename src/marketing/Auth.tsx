import { useEffect, useMemo, useState } from 'react';
import { COPY, type Lang } from './copy';
import { AuthError, signIn, signUp, type AuthErrorCode } from '../auth/session';
import { loadFrom } from '../storage';

type Nav = (to: string) => void;
type Mode = 'signin' | 'signup' | 'recover';
type Role = 'personal' | 'student' | 'guardian';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeRecoveryKey(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return `plnr-${chars.match(/.{4}/g)!.join('-')}`;
}

function strength(password: string, lang: Lang): { score: 0 | 1 | 2 | 3; label: string } {
  const c = COPY[lang];
  if (password.length === 0) return { score: 0, label: '' };
  if (password.length < 10) return { score: 0, label: c.authStrengthWeak };
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  if (password.length >= 16 && variety >= 3) return { score: 3, label: c.authStrengthStrong };
  if (password.length >= 12 || variety >= 3) return { score: 2, label: c.authStrengthGood };
  return { score: 1, label: c.authStrengthFair };
}

/** Maps an API failure onto translated copy. */
function errorText(code: AuthErrorCode | null, c: Record<string, string>): string {
  if (code === 'bad_credentials') return c.errBadCredentials;
  if (code === 'email_taken') return c.errEmailTaken;
  if (code === 'taken') return c.errTaken;
  if (code === 'not_configured') return c.errNotConfigured;
  if (code === 'network') return c.errNetwork;
  return c.errUnknown;
}

const QUOTES: { key: 'authQuote1' | 'authQuote2'; by: 'authQuote1By' | 'authQuote2By' }[] = [
  { key: 'authQuote1', by: 'authQuote1By' },
  { key: 'authQuote2', by: 'authQuote2By' },
];

function Aside({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % QUOTES.length), 7000);
    return () => window.clearInterval(timer);
  }, []);
  const quote = QUOTES[index];

  return (
    <aside className="auth-aside" aria-hidden="true">
      <div className="auth-aside-glow" />
      <img className="auth-aside-art" src="/img/mkt-hero.jpg" alt="" width="900" height="600" />
      <div className="auth-aside-body">
        <p className="auth-mark">{c.brand}</p>
        <blockquote key={quote.key} className="auth-quote">
          <p>{c[quote.key]}</p>
          <cite>{c[quote.by]}</cite>
        </blockquote>
        <ul className="auth-aside-points">
          <li>{c.heroTrust}</li>
        </ul>
      </div>
    </aside>
  );
}

export function Auth({ lang, mode, navigate }: { lang: Lang; mode: Mode; navigate: Nav }) {
  if (mode === 'recover') return <Recover lang={lang} navigate={navigate} />;
  if (mode === 'signin') return <SignIn lang={lang} navigate={navigate} />;
  return <SignUp lang={lang} navigate={navigate} />;
}

/* ------------------------------------------------------------------ sign in */

function SignIn({ lang, navigate }: { lang: Lang; navigate: Nav }) {
  const c = COPY[lang];
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(identifier, password);
      navigate('/app');
    } catch (caught) {
      setError(errorText(caught instanceof AuthError ? caught.code : null, c));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Aside lang={lang} />
      <section className="auth-panel">
        <div className="auth-form">
          <header className="auth-head reveal-in">
            <h1>{c.authSignInTitle}</h1>
            <p>{c.authSignInSub}</p>
          </header>

          <form
            className="auth-fields reveal-in"
            style={{ animationDelay: '60ms' }}
            onSubmit={submit}
          >
            <label className="field">
              <span>{c.authUsername}</span>
              <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete="username" required />
            </label>

            <label className="field">
              <span>{c.authPassword}</span>
              <span className="field-wrap">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button type="button" className="field-toggle" onClick={() => setShow(!show)}>
                  {show ? c.authHide : c.authShow}
                </button>
              </span>
            </label>

            <label className="check">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>
                <strong>{c.authRemember}</strong>
                <em>{c.authRememberHint}</em>
              </span>
            </label>

            {error ? (
              <p className="auth-error" role="alert">
                {error}
              </p>
            ) : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {busy ? c.authBusy : c.authSignInAction}
            </button>
          </form>

          <div className="auth-or reveal-in" style={{ animationDelay: '120ms' }}>
            <span>{c.authOr}</span>
          </div>

          <button type="button" className="btn btn-outline btn-block reveal-in" style={{ animationDelay: '150ms' }}>
            <span className="btn-key" aria-hidden="true" />
            {c.authPasskey}
          </button>
          <p className="auth-hint reveal-in" style={{ animationDelay: '180ms' }}>
            {c.authPasskeyHint}
          </p>

          <footer className="auth-foot reveal-in" style={{ animationDelay: '220ms' }}>
            <button type="button" className="link" onClick={() => navigate('/recover')}>
              {c.authForgot}
            </button>
            <p>
              {c.authNoAccount} <button type="button" className="link" onClick={() => navigate('/signup')}>{c.authCreate}</button>
            </p>
          </footer>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ sign up */

function SignUp({ lang, navigate }: { lang: Lang; navigate: Nav }) {
  const c = COPY[lang];
  const [step, setStep] = useState<'details' | 'role' | 'recovery'>('details');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<Role>('personal');
  const [agreed, setAgreed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createAccount = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Anything already planned in this browser becomes the first vault.
      const { state } = loadFrom(window.localStorage);
      await signUp({
        username,
        email,
        displayName: name,
        role,
        password,
        initialState: state,
      });
      setBusy(false);
      setStep('recovery');
    } catch (caught) {
      setError(errorText(caught instanceof AuthError ? caught.code : null, c));
      setBusy(false);
    }
  };

  const key = useMemo(makeRecoveryKey, []);
  const meter = strength(password, lang);

  const download = () => {
    const blob = new Blob([`Planner recovery key\n\n${key}\n\n${c.authRecoverySub}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planner-recovery-key.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="auth">
      <Aside lang={lang} />
      <section className="auth-panel">
        <div className="auth-form">
          <ol className="auth-steps reveal-in">
            <li className={step === 'details' ? 'is-active' : 'is-done'}>1</li>
            <li className={step === 'role' ? 'is-active' : step === 'recovery' ? 'is-done' : ''}>2</li>
            <li className={step === 'recovery' ? 'is-active' : ''}>3</li>
          </ol>

          {step === 'details' ? (
            <>
              <header className="auth-head reveal-in">
                <h1>{c.authSignUpTitle}</h1>
                <p>{c.authSignUpSub}</p>
              </header>
              <form
                className="auth-fields reveal-in"
                style={{ animationDelay: '60ms' }}
                onSubmit={(event) => {
                  event.preventDefault();
                  setStep('role');
                }}
              >
                <label className="field">
                  <span>{c.authName}</span>
                  <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
                  <em>{c.authNameHint}</em>
                </label>
                <label className="field">
                  <span>{c.authUsernameOnly}</span>
                  <input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
                </label>
                <label className="field">
                  <span>{c.authEmail}</span>
                  <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
                  <em>{c.authEmailHint}</em>
                </label>
                <label className="field">
                  <span>{c.authPassword}</span>
                  <span className="field-wrap">
                    <input
                      type={show ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button type="button" className="field-toggle" onClick={() => setShow(!show)}>
                      {show ? c.authHide : c.authShow}
                    </button>
                  </span>
                  <em>{c.authPasswordHint}</em>
                  <span className="meter" data-score={meter.score}>
                    <i />
                    <i />
                    <i />
                    <b>{meter.label}</b>
                  </span>
                </label>
                <label className="check">
                  <input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} required />
                  <span>{c.authTerms}</span>
                </label>
                <button type="submit" className="btn btn-primary btn-block" disabled={!agreed || password.length < 10}>
                  {c.authContinue}
                </button>
              </form>
            </>
          ) : null}

          {step === 'role' ? (
            <>
              <header className="auth-head reveal-in">
                <h1>{c.authStepRole}</h1>
                <p>{c.authStepRoleSub}</p>
              </header>
              <div className="role-pick reveal-in" style={{ animationDelay: '60ms' }}>
                {(
                  [
                    ['personal', c.authRolePersonal, c.authRolePersonalD],
                    ['student', c.authRoleStudent, c.authRoleStudentD],
                    ['guardian', c.authRoleGuardian, c.authRoleGuardianD],
                  ] as [Role, string, string][]
                ).map(([value, title, description]) => (
                  <button
                    type="button"
                    key={value}
                    className={`role-option ${role === value ? 'is-chosen' : ''}`}
                    onClick={() => setRole(value)}
                    aria-pressed={role === value}
                  >
                    <span className="role-radio" aria-hidden="true" />
                    <span>
                      <strong>{title}</strong>
                      <em>{description}</em>
                    </span>
                  </button>
                ))}
              </div>
              <footer className="auth-foot reveal-in" style={{ animationDelay: '120ms' }}>
                <button type="button" className="link" onClick={() => setStep('details')}>
                  {c.authBack}
                </button>
                {error ? (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={createAccount}>
                  {busy ? <span className="spinner" aria-hidden="true" /> : null}
                  {busy ? c.authBusy : c.authContinue}
                </button>
              </footer>
            </>
          ) : null}

          {step === 'recovery' ? (
            <>
              <header className="auth-head reveal-in">
                <h1>{c.authRecoveryTitle}</h1>
                <p>{c.authRecoverySub}</p>
              </header>

              <div className="recovery reveal-in" style={{ animationDelay: '60ms' }}>
                <code>{key}</code>
                <div className="recovery-actions">
                  <button type="button" className="btn btn-outline" onClick={copy}>
                    {copied ? c.authRecoveryCopied : c.authRecoveryCopy}
                  </button>
                  <button type="button" className="btn btn-outline" onClick={download}>
                    {c.authRecoveryDownload}
                  </button>
                </div>
                <p className="recovery-warn">{c.authRecoveryWarn}</p>
              </div>

              <label className="check reveal-in" style={{ animationDelay: '110ms' }}>
                <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
                <span>{c.authRecoverySaved}</span>
              </label>

              <footer className="auth-foot reveal-in" style={{ animationDelay: '150ms' }}>
                <button type="button" className="btn btn-primary btn-block" disabled={!saved} onClick={() => navigate('/app')}>
                  {c.authGoToApp}
                </button>
                <p className="auth-note">{c.authRecoveryView}</p>
              </footer>
            </>
          ) : null}

          {step === 'details' ? (
            <footer className="auth-foot reveal-in" style={{ animationDelay: '220ms' }}>
              <p>
                {c.authHasAccount} <button type="button" className="link" onClick={() => navigate('/login')}>{c.authSignInAction}</button>
              </p>
              <p className="auth-note">{c.authDemoNote}</p>
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ recover */

function Recover({ lang, navigate }: { lang: Lang; navigate: Nav }) {
  const c = COPY[lang];
  const [key, setKey] = useState('');

  return (
    <div className="auth">
      <Aside lang={lang} />
      <section className="auth-panel">
        <div className="auth-form">
          <header className="auth-head reveal-in">
            <h1>{c.authRecoverTitle}</h1>
            <p>{c.authRecoverSub}</p>
          </header>

          <div className="auth-fields reveal-in" style={{ animationDelay: '60ms' }}>
            <button type="button" className="recover-option">
              <span className="recover-icon" aria-hidden="true">
                📱
              </span>
              <span>
                <strong>{c.authRecoverDevice}</strong>
                <em>{c.authRecoverDeviceD}</em>
              </span>
            </button>
            <button type="button" className="recover-option">
              <span className="recover-icon" aria-hidden="true">
                🔑
              </span>
              <span>
                <strong>{c.authRecoverPasskey}</strong>
                <em>{c.authRecoverPasskeyD}</em>
              </span>
            </button>

            <label className="field">
              <span>{c.authRecoverKeyLabel}</span>
              <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="plnr-••••-••••-••••-••••" />
              <em>{c.authRecoverKeyD}</em>
            </label>
            <button type="button" className="btn btn-primary btn-block" disabled={key.trim().length < 8}>
              {c.authContinue}
            </button>
          </div>

          <footer className="auth-foot reveal-in" style={{ animationDelay: '140ms' }}>
            <button type="button" className="link" onClick={() => navigate('/login')}>
              {c.authRecoverBack}
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
}
