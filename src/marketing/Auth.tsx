import { useEffect, useMemo, useState } from 'react';
import { COPY, type Lang } from './copy';
import { AuthError, signIn, signUp, type AuthErrorCode } from '../auth/session';
import { PasskeyError, passkeySignIn, passkeysSupported, registerPasskey } from '../auth/passkey';
import { EMAIL_PATTERN, USERNAME_PATTERN } from '../shared/authContract';
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

/** Maps an API failure onto translated copy; unknown failures say what the server said. */
function errorText(code: AuthErrorCode | null, detail: string | null, c: Record<string, string>): string {
  if (code === 'bad_credentials') return c.errBadCredentials;
  if (code === 'email_taken') return c.errEmailTaken;
  if (code === 'taken') return c.errTaken;
  if (code === 'not_configured') return c.errNotConfigured;
  if (code === 'network') return c.errNetwork;
  // Validation rejections, rate limits, database outages… the server's own
  // sentence is the only one that says what to do next.
  return detail ?? c.errUnknown;
}

/** Maps a passkey failure onto translated copy. */
function passkeyErrorText(caught: unknown, c: Record<string, string>): string {
  if (caught instanceof PasskeyError) {
    if (caught.code === 'cancelled') return c.errPasskeyCancelled;
    if (caught.code === 'no_prf') return c.errPasskeyNoPrf;
    if (caught.code === 'unsupported') return c.errPasskeyUnsupported;
    if (caught.code === 'no_session') return c.errPasskeySession;
    return c.errPasskeyRejected;
  }
  if (caught instanceof AuthError) {
    if (caught.code === 'bad_credentials') return c.errPasskeyRejected;
    if (caught.code === 'not_configured') return c.errNotConfigured;
    if (caught.code === 'network') return c.errNetwork;
    return caught.detail ?? c.errUnknown;
  }
  return c.errUnknown;
}

/**
 * The panel beside the form: three photographs that slowly cross-fade, each
 * with its own line. Purely decorative, so it stays out of the accessibility
 * tree and stops entirely when the visitor prefers less motion.
 */
const QUOTES: {
  key: 'authQuote1' | 'authQuote2' | 'authQuote3';
  by: 'authQuote1By' | 'authQuote2By' | 'authQuote3By';
  art: string;
}[] = [
  { key: 'authQuote1', by: 'authQuote1By', art: '/img/auth-desk.jpg' },
  { key: 'authQuote2', by: 'authQuote2By', art: '/img/auth-privacy.jpg' },
  { key: 'authQuote3', by: 'authQuote3By', art: '/img/auth-link.jpg' },
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
      <div className="auth-aside-stage">
        {QUOTES.map((item, position) => (
          <img
            key={item.art}
            className={position === index ? 'auth-aside-art is-active' : 'auth-aside-art'}
            src={item.art}
            alt=""
            width="900"
            height="600"
            loading={position === 0 ? 'eager' : 'lazy'}
            decoding="async"
          />
        ))}
        <div className="auth-aside-veil" />
      </div>
      <div className="auth-aside-body">
        <p className="auth-mark">{c.brand}</p>
        <blockquote key={quote.key} className="auth-quote">
          <p>{c[quote.key]}</p>
          <cite>{c[quote.by]}</cite>
        </blockquote>
        <ul className="auth-aside-points">
          <li>{c.heroTrust}</li>
        </ul>
        <div className="auth-dots">
          {QUOTES.map((item, position) => (
            <span key={item.art} className={position === index ? 'is-active' : undefined} />
          ))}
        </div>
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
      await signIn(identifier, password, remember);
      navigate('/app');
    } catch (caught) {
      setError(errorText(caught instanceof AuthError ? caught.code : null, caught instanceof AuthError ? caught.detail : null, c));
      setBusy(false);
    }
  };

  // Passwordless: one touch with the passkey, then straight in (with the
  // vault already open where the passkey carries the wrapped key).
  const withPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await passkeySignIn(identifier);
      navigate('/app');
    } catch (caught) {
      setError(passkeyErrorText(caught, c));
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

          <button
            type="button"
            className="btn btn-outline btn-block reveal-in"
            style={{ animationDelay: '150ms' }}
            disabled={busy}
            onClick={() => void withPasskey()}
          >
            <span className="btn-key" aria-hidden="true" />
            {busy ? c.authPasskeyBusy : c.authPasskey}
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
  const [guardianKind, setGuardianKind] = useState<'advisor' | 'parent'>('advisor');
  const [studentField, setStudentField] = useState('');
  const [studentGrade, setStudentGrade] = useState('');
  const [guardianField, setGuardianField] = useState('');
  const gradeOptions = [
    { id: 'school-9', label: c.authGrade9 },
    { id: 'school-10', label: c.authGrade10 },
    { id: 'school-11', label: c.authGrade11 },
    { id: 'school-12', label: c.authGrade12 },
    { id: 'university', label: c.authGradeUniversity },
    { id: 'postgrad', label: c.authGradePostgrad },
    { id: 'other', label: c.authGradeOther },
  ];
  const [agreed, setAgreed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyAdded, setPasskeyAdded] = useState(false);

  /**
   * SPEC ladder, first rung after "trusted device": enrol a passkey right
   * after sign-up while the freshly unwrapped vault key is in memory. With
   * PRF this passkey later opens the planner without a password at all.
   */
  const addPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await registerPasskey();
      setPasskeyAdded(true);
    } catch (caught) {
      setError(passkeyErrorText(caught, c));
    } finally {
      setBusy(false);
    }
  };

  /** A panel without its details is not a panel yet. */
  const panelDetails = (chosen: Role): { field: string | null; grade: string | null } | null => {
    if (chosen === 'student') {
      if (!studentField.trim() || !studentGrade) return null;
      return { field: studentField.trim(), grade: studentGrade };
    }
    if (chosen === 'guardian') {
      if (!guardianField.trim()) return null;
      return { field: guardianField.trim(), grade: null };
    }
    return { field: null, grade: null };
  };

  const createAccount = async (chosen: Role = role) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Anything already planned in this browser becomes the first vault.
      const { state } = loadFrom(window.localStorage);
      const details = panelDetails(chosen);
      if (!details) {
        setError(c.authRoleMissing);
        setBusy(false);
        return;
      }
      // A panel is an extra, so choosing one here only switches that panel on —
      // the planner underneath is exactly what they already had.
      const panels = {
        student: {
          ...state.panels.student,
          enabled: chosen === 'student',
          field: chosen === 'student' ? details.field : state.panels.student.field,
          grade: chosen === 'student' ? details.grade : state.panels.student.grade,
        },
        guardian: {
          ...state.panels.guardian,
          enabled: chosen === 'guardian',
          kind: chosen === 'guardian' ? guardianKind : state.panels.guardian.kind,
          field: chosen === 'guardian' ? details.field : state.panels.guardian.field,
        },
      };
      await signUp({
        username,
        email,
        displayName: name,
        role: chosen,
        password,
        // Signed up on this device, so trust it by default; Settings can forget it.
        initialState: { ...state, panels },
      });
      setBusy(false);
      setStep('recovery');
    } catch (caught) {
      setError(errorText(caught instanceof AuthError ? caught.code : null, caught instanceof AuthError ? caught.detail : null, c));
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
                  // The server enforces the same rules; catching them here keeps
                  // the real message from ever being needed.
                  if (!name.trim() || name.trim().length > 60) {
                    setError(c.errNameRules);
                    return;
                  }
                  if (!USERNAME_PATTERN.test(username.trim())) {
                    setError(c.errUsernameRules);
                    return;
                  }
                  if (email.trim() && !EMAIL_PATTERN.test(email.trim())) {
                    setError(c.errEmailRules);
                    return;
                  }
                  setError(null);
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
                  <em>{c.authUsernameHint}</em>
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
                {error ? (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                ) : null}
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
              {role === 'student' ? (
                <div className="role-details reveal-in" style={{ animationDelay: '90ms' }}>
                  <label className="field">
                    <span>{c.authStudentField}</span>
                    <input
                      className="input"
                      value={studentField}
                      autoComplete="off"
                      placeholder={c.authStudentFieldHint}
                      onChange={(event) => setStudentField(event.target.value)}
                    />
                    {studentField.trim() ? <small className="hint">{c.authStudentFieldHint}</small> : null}
                  </label>
                  <label className="field">
                    <span>{c.authStudentGrade}</span>
                    <select className="input" value={studentGrade} onChange={(event) => setStudentGrade(event.target.value)}>
                      <option value="">—</option>
                      {gradeOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}

              {role === 'guardian' ? (
                <div className="role-details reveal-in" style={{ animationDelay: '90ms' }}>
                  <label className="field">
                    <span>{c.authGuardianField}</span>
                    <input
                      className="input"
                      value={guardianField}
                      autoComplete="off"
                      placeholder={c.authGuardianFieldHint}
                      onChange={(event) => setGuardianField(event.target.value)}
                    />
                    {guardianField.trim() ? <small className="hint">{c.authGuardianFieldHint}</small> : null}
                  </label>
                </div>
              ) : null}
              {role === 'guardian' ? (
                <div className="role-pick role-kind reveal-in" style={{ animationDelay: '110ms' }}>
                  <p className="role-kind-label">{c.authRoleKind}</p>
                  {(
                    [
                      ['parent', c.authRoleKindParent, c.authRoleKindParentD],
                      ['advisor', c.authRoleKindAdvisor, c.authRoleKindAdvisorD],
                    ] as ['parent' | 'advisor', string, string][]
                  ).map(([value, title, description]) => (
                    <button
                      type="button"
                      key={value}
                      className={`role-option ${guardianKind === value ? 'is-chosen' : ''}`}
                      onClick={() => setGuardianKind(value)}
                      aria-pressed={guardianKind === value}
                    >
                      <span className="role-radio" aria-hidden="true" />
                      <span>
                        <strong>{title}</strong>
                        <em>{description}</em>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <footer className="auth-foot reveal-in" style={{ animationDelay: '120ms' }}>
                <button
                  type="button"
                  className="link"
                  onClick={() => createAccount('personal')}
                >
                  {c.authRoleSkip}
                </button>
                {error ? (
                  <p className="auth-error" role="alert">
                    {error}
                  </p>
                ) : null}
                <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void createAccount()}>
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

              {passkeysSupported() ? (
                <>
                  <div className="auth-or reveal-in" style={{ animationDelay: '130ms' }}>
                    <span>{c.authOr}</span>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline btn-block reveal-in"
                    style={{ animationDelay: '150ms' }}
                    disabled={busy || passkeyAdded}
                    onClick={() => void addPasskey()}
                  >
                    <span className="btn-key" aria-hidden="true" />
                    {passkeyAdded ? c.authPasskeyAdded : c.authPasskeyAdd}
                  </button>
                  <p className="auth-hint reveal-in" style={{ animationDelay: '170ms' }}>
                    {c.authPasskeyAddHint}
                  </p>
                  {error ? <p className="auth-error reveal-in">{error}</p> : null}
                </>
              ) : null}

              <footer className="auth-foot reveal-in" style={{ animationDelay: '190ms' }}>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The passkey *is* the recovery for the trusted-device → passkey → key
  // ladder: sign in with the credential on any browser, no identifier needed.
  const recoverWithPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await passkeySignIn();
      navigate('/app');
    } catch (caught) {
      setError(passkeyErrorText(caught, c));
      setBusy(false);
    }
  };

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
            <button type="button" className="recover-option" disabled>
              <span className="recover-icon" aria-hidden="true">
                📱
              </span>
              <span>
                <strong>{c.authRecoverDevice}</strong>
                <em>{c.authRecoverDeviceD}</em>
              </span>
            </button>
            {passkeysSupported() ? (
              <button
                type="button"
                className="recover-option"
                disabled={busy}
                onClick={() => void recoverWithPasskey()}
              >
                <span className="recover-icon" aria-hidden="true">
                  🔑
                </span>
                <span>
                  <strong>{c.authRecoverPasskey}</strong>
                  <em>{c.authRecoverPasskeyD}</em>
                </span>
              </button>
            ) : null}

            <label className="field">
              <span>{c.authRecoverKeyLabel}</span>
              <input value={key} onChange={(event) => setKey(event.target.value)} placeholder="plnr-••••-••••-••••-••••" />
              <em>{c.authRecoverKeyD}</em>
            </label>
            {error ? <p className="auth-error">{error}</p> : null}
            <button type="button" className="btn btn-primary btn-block" disabled={busy || key.trim().length < 8}>
              {busy ? c.authPasskeyBusy : c.authContinue}
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
