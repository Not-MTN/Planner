import { useEffect, useState } from 'react';
import { COPY, type Lang } from './copy';
import {
  AuthError,
  completePasskeyTotpSignIn,
  completeTotpSignIn,
  fetchApiStatus,
  resetPasswordWithRecovery,
  signIn,
  signUp,
  type AuthErrorCode,
} from '../auth/session';
import { PasskeyError, passkeySignIn, passkeysSupported, registerPasskey } from '../auth/passkey';
import { RecoveryCodes } from '../components/RecoveryCodes';
import { EMAIL_PATTERN, USERNAME_PATTERN } from '../shared/authContract';
import { loadFrom } from '../storage';

type Nav = (to: string) => void;
type Mode = 'signin' | 'signup' | 'recover';
type Role = 'personal' | 'student' | 'guardian';

function strength(password: string, lang: Lang): { score: 0 | 1 | 2 | 3; label: string } {
  const c = COPY[lang];
  if (password.length === 0) return { score: 0, label: '' };
  if (password.length < 10) return { score: 0, label: c.authStrengthWeak };
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((rule) => rule.test(password)).length;
  if (password.length >= 16 && variety >= 3) return { score: 3, label: c.authStrengthStrong };
  if (password.length >= 12 || variety >= 3) return { score: 2, label: c.authStrengthGood };
  return { score: 1, label: c.authStrengthFair };
}

/** Tracks Caps Lock while someone types a password, so a hint can appear. */
function useCapsLock(): readonly [boolean, { onKeyUp: (event: React.KeyboardEvent) => void; onKeyDown: (event: React.KeyboardEvent) => void }] {
  const [caps, setCaps] = useState(false);
  const watch = {
    onKeyUp: (event: React.KeyboardEvent) => setCaps(event.getModifierState('CapsLock')),
    onKeyDown: (event: React.KeyboardEvent) => setCaps(event.getModifierState('CapsLock')),
  };
  return [caps, watch] as const;
}

/** Maps API failures to the selected language without leaking English server copy into Persian screens. */
function errorText(code: AuthErrorCode | null, detail: string | null, c: Record<string, string>, lang: Lang): string {
  if (code === 'bad_credentials') return c.errBadCredentials;
  if (code === 'email_taken') return c.errEmailTaken;
  if (code === 'taken') return c.errTaken;
  if (code === 'not_configured') return c.errNotConfigured;
  if (code === 'network') return c.errNetwork;
  // These two are named precisely, because retrying them never helps: something
  // in front of the app, or a missing deployment, answered instead of the API.
  if (code === 'deployment_gate') return c.errDeploymentGate;
  if (code === 'api_missing') return c.errApiMissing;
  if (detail?.toLowerCase().includes('too many requests')) return c.errRateLimited;
  if (lang === 'fa') return c.errUnknown;
  return detail ?? c.errUnknown;
}

/**
 * The one-line technical detail ("POST /api/auth/salt → 401 text/html — …"),
 * shown under the friendly sentence so a broken deployment can be diagnosed
 * without opening dev tools.
 */
function errorDetailText(caught: unknown): string | null {
  if (!(caught instanceof AuthError)) return null;
  if (caught.code !== 'deployment_gate' && caught.code !== 'api_missing' && caught.code !== 'unknown') return null;
  // Never echo a credential-shaped server message back into the panel.
  return caught.detail && caught.detail.length <= 200 ? caught.detail : null;
}

/**
 * Every auth screen asks once, before anyone types, whether the accounts API is
 * reachable and configured. A protected domain or a deployment without
 * `DATABASE_URL` is then explained up front instead of as a failed sign-in.
 */
function useServerNotice(c: Record<string, string>, lang: Lang): { notice: string | null; detail: string | null } {
  const [state, setState] = useState<{ notice: string | null; detail: string | null }>({ notice: null, detail: null });

  useEffect(() => {
    let cancelled = false;
    fetchApiStatus().then(
      (status) => {
        if (cancelled) return;
        // A dev/preview server without a database still lets people sign up, but
        // forgets them on restart — say that instead of "accounts are not set up".
        const notice =
          status.storage === 'temporary' ? c.errTemporaryAccounts : status.configured ? null : c.errNotConfigured;
        setState({ notice, detail: null });
      },
      (caught: unknown) => {
        if (cancelled) return;
        setState({
          notice: errorText(
            caught instanceof AuthError ? caught.code : null,
            caught instanceof AuthError ? caught.detail : null,
            c,
            lang,
          ),
          detail: errorDetailText(caught),
        });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [c, lang]);

  return state;
}

/** The notice above the form: what is wrong with the server, and how to read it. */
function ServerNotice({ notice, detail }: { notice: string | null; detail: string | null }) {
  if (!notice) return null;
  return (
    <div className="auth-notice reveal-in" role="status">
      <p>{notice}</p>
      {detail ? <code dir="ltr">{detail}</code> : null}
    </div>
  );
}

/** Maps a passkey failure onto translated copy. */
function passkeyErrorText(caught: unknown, c: Record<string, string>, lang: Lang): string {
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
    if (caught.detail?.toLowerCase().includes('too many requests')) return c.errRateLimited;
    return lang === 'fa' ? c.errUnknown : caught.detail ?? c.errUnknown;
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
      <div className="auth-leaves">
        <i /><i /><i /><i /><i />
      </div>
      <div className="auth-aside-body">
        <p className="auth-mark">
          <img className="auth-mark-logo" src="/logo-mark.svg" alt="" width="30" height="30" />
          {c.brand}
        </p>
        <blockquote key={quote.key} className="auth-quote">
          <p>{c[quote.key]}</p>
          <cite>{c[quote.by]}</cite>
        </blockquote>
        <ul className="auth-aside-points">
          <li>{c.heroTrust}</li>
        </ul>
        <div className="auth-dots">
          {QUOTES.map((item, position) => (
            <button
              key={item.art}
              type="button"
              tabIndex={-1}
              className={position === index ? 'is-active' : undefined}
              onClick={() => setIndex(position)}
            />
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
  const [caps, watchCaps] = useCapsLock();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  /** Set when the password was accepted and a code is owed before signing in. */
  const [totpReason, setTotpReason] = useState<'password' | 'passkey' | null>(null);
  const [code, setCode] = useState('');
  const server = useServerNotice(c, lang);

  // If already signed in, go straight to app
  useEffect(() => {
    let cancelled = false;
    import('../auth/session').then(({ fetchSession }) => {
      fetchSession().then((user) => {
        if (!cancelled && user) navigate('/app');
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [navigate]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      await signIn(identifier, password, remember);
      navigate('/app');
    } catch (caught) {
      // Half a sign-in: the password was right, and an authenticator app is
      // owed. Nothing is signed in yet, so stay here and ask for the code.
      if (caught instanceof AuthError && caught.code === 'totp_required') {
        setTotpReason('password');
        setCode('');
        setError(null);
        setBusy(false);
        return;
      }
      setError(errorText(caught instanceof AuthError ? caught.code : null, caught instanceof AuthError ? caught.detail : null, c, lang));
      setErrorDetail(errorDetailText(caught));
      setBusy(false);
    }
  };

  // Passwordless: one touch with the passkey, then straight in (with the
  // vault already open where the passkey carries the wrapped key).
  const withPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      const result = await passkeySignIn(identifier);
      if (result.totpRequired) {
        setTotpReason('passkey');
        setCode('');
        setBusy(false);
        return;
      }
      navigate('/app');
    } catch (caught) {
      setError(passkeyErrorText(caught, c, lang));
      setErrorDetail(errorDetailText(caught));
      setBusy(false);
    }
  };

  const submitCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !totpReason) return;
    setBusy(true);
    setError(null);
    setErrorDetail(null);
    try {
      if (totpReason === 'password') await completeTotpSignIn(code);
      else await completePasskeyTotpSignIn(code);
      setTotpReason(null);
      setCode('');
      navigate('/app');
    } catch (caught) {
      if (caught instanceof AuthError && caught.code === 'totp_required') {
        setError(c.authTotpWrong);
        setCode('');
        setBusy(false);
        return;
      }
      setError(errorText(caught instanceof AuthError ? caught.code : null, caught instanceof AuthError ? caught.detail : null, c, lang));
      setErrorDetail(errorDetailText(caught));
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Aside lang={lang} />
      <section className="auth-panel">
        <div className="auth-form">
          {totpReason ? (
            <form
              className="auth-fields reveal-in"
              onSubmit={submitCode}
              aria-busy={busy}
              aria-describedby={error ? 'signin-error' : undefined}
            >
              <header className="auth-head">
                <h1>{c.authTotpTitle}</h1>
                <p>{c.authTotpSub}</p>
              </header>

              <label className="field">
                <span>{c.authTotpLabel}</span>
                <input
                  id="signin-totp"
                  className="input-totp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={7}
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="000000"
                  autoFocus
                  required
                />
              </label>

              {error ? (
                <p id="signin-error" className="auth-error" role="alert">
                  {error}
                </p>
              ) : null}

              <button type="submit" className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
                {busy ? c.authBusy : c.authTotpContinue}
              </button>

              <p className="auth-note">
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    setTotpReason(null);
                    setCode('');
                    setError(null);
                  }}
                >
                  {c.authTotpBack}
                </button>
              </p>
            </form>
          ) : (
          <>
          <header className="auth-head reveal-in">
            <h1>{c.authSignInTitle}</h1>
            <p>{c.authSignInSub}</p>
          </header>

          <form
            className="auth-fields reveal-in"
            style={{ animationDelay: '60ms' }}
            onSubmit={submit}
            aria-busy={busy}
            aria-describedby={error ? 'signin-error' : undefined}
          >
            <ServerNotice notice={server.notice} detail={server.detail} />

            <label className="field">
              <span>{c.authUsername}</span>
              <input
                id="signin-identifier"
                name="username"
                type="text"
                inputMode="email"
                dir="ltr"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder={c.authUsernamePlaceholder}
                required
              />
            </label>

            <label className="field">
              <span>{c.authPassword}</span>
              <span className="field-wrap">
                <input
                  id="signin-password"
                  name="password"
                  type={show ? 'text' : 'password'}
                  dir="ltr"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder={c.authPasswordPlaceholder}
                  required
                  {...watchCaps}
                />
                <button
                  type="button"
                  className="field-toggle"
                  aria-label={show ? c.authHide : c.authShow}
                  aria-pressed={show}
                  onClick={() => setShow(!show)}
                >
                  {show ? c.authHide : c.authShow}
                </button>
              </span>
              {caps && !show ? <small className="auth-caps">{c.authCapsLock}</small> : null}
            </label>

            <label className="check">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span>
                <strong>{c.authRemember}</strong>
                <em>{c.authRememberHint}</em>
              </span>
            </label>

            {error ? (
              <>
                <p id="signin-error" className="auth-error" role="alert">
                  {error}
                </p>
                {errorDetail ? <code className="auth-error-detail" dir="ltr">{errorDetail}</code> : null}
              </>
            ) : null}
            <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy}>
              {busy ? <span className="spinner" aria-hidden="true" /> : null}
              {busy ? c.authBusy : c.authSignInAction}
            </button>
          </form>
          </>
          )}

          {!totpReason && passkeysSupported() ? (
            <>
              <div className="auth-or reveal-in" style={{ animationDelay: '120ms' }}>
                <span>{c.authOr}</span>
              </div>
              <button
                type="button"
                className="btn btn-outline btn-block reveal-in"
                style={{ animationDelay: '150ms' }}
                disabled={busy}
                aria-busy={busy}
                onClick={() => void withPasskey()}
              >
                <span className="btn-key" aria-hidden="true" />
                {busy ? c.authPasskeyBusy : c.authPasskey}
              </button>
              <p className="auth-hint reveal-in" style={{ animationDelay: '180ms' }}>
                {c.authPasskeyHint}
              </p>
            </>
          ) : null}

          {totpReason ? null : (
          <footer className="auth-foot reveal-in" style={{ animationDelay: '220ms' }}>
            <button type="button" className="link" onClick={() => navigate('/recover')}>
              {c.authForgot}
            </button>
            <p>
              {c.authNoAccount} <button type="button" className="link" onClick={() => navigate('/signup')}>{c.authCreate}</button>
            </p>
          </footer>
          )}
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
  const [caps, watchCaps] = useCapsLock();
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
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [passkeyAdded, setPasskeyAdded] = useState(false);
  const server = useServerNotice(c, lang);

  useEffect(() => {
    let cancelled = false;
    import('../auth/session').then(({ fetchSession }) => {
      fetchSession().then((user) => {
        if (!cancelled && user) navigate('/app');
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [navigate]);

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
      setError(passkeyErrorText(caught, c, lang));
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
      const created = await signUp({
        username,
        email,
        displayName: name,
        role: chosen,
        password,
        // Signed up on this device, so trust it by default; Settings can forget it.
        initialState: { ...state, panels },
      });
      setRecoveryCodes(created.recoveryCodes);
      setBusy(false);
      setStep('recovery');
    } catch (caught) {
      setError(errorText(caught instanceof AuthError ? caught.code : null, caught instanceof AuthError ? caught.detail : null, c, lang));
      setErrorDetail(errorDetailText(caught));
      setBusy(false);
    }
  };

  const meter = strength(password, lang);

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
                  setErrorDetail(null);
                  setStep('role');
                }}
              >
                <ServerNotice notice={server.notice} detail={server.detail} />

                <label className="field">
                  <span>{c.authName}</span>
                  <input
                    name="name"
                    type="text"
                    autoComplete="name"
                    autoCapitalize="words"
                    placeholder={c.authNamePlaceholder}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={60}
                    required
                  />
                  <em>{c.authNameHint}</em>
                </label>
                <label className="field">
                  <span>{c.authUsernameOnly}</span>
                  <input
                    name="username"
                    type="text"
                    dir="ltr"
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={c.authNewUsernamePlaceholder}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    minLength={3}
                    maxLength={24}
                    required
                  />
                  <em>{c.authUsernameHint}</em>
                </label>
                <label className="field">
                  <span>{c.authEmail}</span>
                  <input
                    name="email"
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    placeholder={c.authEmailPlaceholder}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <em>{c.authEmailHint}</em>
                </label>
                <label className="field">
                  <span>{c.authPassword}</span>
                  <span className="field-wrap">
                    <input
                      name="new-password"
                      type={show ? 'text' : 'password'}
                      dir="ltr"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={c.authPasswordPlaceholder}
                      required
                      {...watchCaps}
                    />
                    <button
                      type="button"
                      className="field-toggle"
                      aria-label={show ? c.authHide : c.authShow}
                      aria-pressed={show}
                      onClick={() => setShow(!show)}
                    >
                      {show ? c.authHide : c.authShow}
                    </button>
                  </span>
                  {caps && !show ? <small className="auth-caps">{c.authCapsLock}</small> : null}
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
                  <>
                    <p className="auth-error" role="alert">
                      {error}
                    </p>
                    {errorDetail ? <code className="auth-error-detail" dir="ltr">{errorDetail}</code> : null}
                  </>
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
                      <option value="">{c.authChooseGrade}</option>
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
                  <>
                    <p className="auth-error" role="alert">
                      {error}
                    </p>
                    {errorDetail ? <code className="auth-error-detail" dir="ltr">{errorDetail}</code> : null}
                  </>
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

              <RecoveryCodes codes={recoveryCodes} copy={c} idPrefix="signup" onConfirmedChange={setSaved} />

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
                  {error ? (
                    <>
                      <p className="auth-error reveal-in">{error}</p>
                      {errorDetail ? <code className="auth-error-detail" dir="ltr">{errorDetail}</code> : null}
                    </>
                  ) : null}
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
  const [identifier, setIdentifier] = useState('');
  const [key, setKey] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [caps, watchCaps] = useCapsLock();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorDetail, setErrorDetail] = useState<string | null>(null);
  const [nextRecoveryCodes, setNextRecoveryCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const meter = strength(password, lang);
  const server = useServerNotice(c, lang);

  const recoverWithPasskey = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await passkeySignIn();
      if (result.unlocked) {
        navigate('/app');
        return;
      }
      // The session is authenticated, but this credential cannot unwrap the
      // vault key in this browser. Stay here so the recovery-key reset remains available.
      setError(c.errPasskeyNoPrf);
    } catch (caught) {
      setError(passkeyErrorText(caught, c, lang));
    } finally {
      setBusy(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    if (password.length < 10) {
      setError(c.errShortPassword);
      return;
    }
    if (password !== confirmation) {
      setError(c.authPasswordMismatch);
      return;
    }

    setBusy(true);
    try {
      const generated = await resetPasswordWithRecovery(identifier, key, password);
      setNextRecoveryCodes(generated);
      setSaved(false);
    } catch (caught) {
      if (caught instanceof AuthError && caught.code === 'bad_credentials') {
        setError(c.authRecoveryInvalid);
      } else {
        setError(errorText(caught instanceof AuthError ? caught.code : null, caught instanceof AuthError ? caught.detail : null, c, lang));
        setErrorDetail(errorDetailText(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <Aside lang={lang} />
      <section className="auth-panel">
        <div className="auth-form">
          {nextRecoveryCodes ? (
            <>
              <header className="auth-head reveal-in">
                <h1>{c.authRecoveryCompleteTitle}</h1>
                <p>{c.authRecoveryCompleteSub}</p>
              </header>
              <RecoveryCodes codes={nextRecoveryCodes} copy={c} idPrefix="recover" onConfirmedChange={setSaved} />
              <footer className="auth-foot reveal-in" style={{ animationDelay: '130ms' }}>
                <button type="button" className="btn btn-primary btn-block" disabled={!saved} onClick={() => navigate('/login')}>
                  {c.authRecoveryComplete}
                </button>
                <p className="auth-note">{c.authRecoveryView}</p>
              </footer>
            </>
          ) : (
            <>
              <header className="auth-head reveal-in">
                <h1>{c.authRecoverTitle}</h1>
                <p>{c.authRecoverSub}</p>
              </header>

              <form className="auth-fields reveal-in" style={{ animationDelay: '60ms' }} onSubmit={submit} aria-busy={busy}>
                <ServerNotice notice={server.notice} detail={server.detail} />

                <label className="field">
                  <span>{c.authRecoverIdentifier}</span>
                  <input
                    name="username"
                    type="text"
                    inputMode="email"
                    dir="ltr"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={c.authUsernamePlaceholder}
                    required
                  />
                </label>
                <label className="field">
                  <span>{c.authRecoverKeyLabel}</span>
                  <input
                    name="recovery-key"
                    type="text"
                    dir="ltr"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={c.authRecoverKeyPlaceholder}
                    required
                  />
                  <em>{c.authRecoverKeyD}</em>
                </label>
                <label className="field">
                  <span>{c.authRecoverNewPassword}</span>
                  <span className="field-wrap">
                    <input
                      name="new-password"
                      type={showPassword ? 'text' : 'password'}
                      dir="ltr"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder={c.authPasswordPlaceholder}
                      required
                      {...watchCaps}
                    />
                    <button
                      type="button"
                      className="field-toggle"
                      aria-label={showPassword ? c.authHide : c.authShow}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? c.authHide : c.authShow}
                    </button>
                  </span>
                  {caps && !showPassword ? <small className="auth-caps">{c.authCapsLock}</small> : null}
                  {password ? <em>{c.authPasswordHint}</em> : null}
                  {password ? (
                    <span className="meter" data-score={meter.score}>
                      <i />
                      <i />
                      <i />
                      <b>{meter.label}</b>
                    </span>
                  ) : null}
                </label>
                <label className="field">
                  <span>{c.authRecoverConfirm}</span>
                  <span className="field-wrap">
                    <input
                      name="confirm-password"
                      type={showConfirmation ? 'text' : 'password'}
                      dir="ltr"
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="field-toggle"
                      aria-label={showConfirmation ? c.authHide : c.authShow}
                      aria-pressed={showConfirmation}
                      onClick={() => setShowConfirmation(!showConfirmation)}
                    >
                      {showConfirmation ? c.authHide : c.authShow}
                    </button>
                  </span>
                </label>
                {error ? (
                  <>
                    <p className="auth-error" role="alert">{error}</p>
                    {errorDetail ? <code className="auth-error-detail" dir="ltr">{errorDetail}</code> : null}
                  </>
                ) : null}
                <button type="submit" className="btn btn-primary btn-block" disabled={busy} aria-busy={busy}>
                  {busy ? <span className="spinner" aria-hidden="true" /> : null}
                  {busy ? c.authRecoverResetting : c.authRecoverReset}
                </button>
              </form>

              {passkeysSupported() ? (
                <>
                  <div className="auth-or reveal-in" style={{ animationDelay: '120ms' }}>
                    <span>{c.authOr}</span>
                  </div>
                  <button type="button" className="btn btn-outline btn-block" disabled={busy} onClick={() => void recoverWithPasskey()}>
                    <span className="btn-key" aria-hidden="true" />
                    {c.authRecoverPasskey}
                  </button>
                  <p className="auth-hint">{c.authRecoverPasskeyD}</p>
                </>
              ) : null}

              <footer className="auth-foot reveal-in" style={{ animationDelay: '150ms' }}>
                <button type="button" className="link" onClick={() => navigate('/login')}>
                  {c.authRecoverBack}
                </button>
              </footer>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
