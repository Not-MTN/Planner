/**
 * The passkey ceremony end to end against the real handlers: enrolment with a
 * wrapped vault key, passwordless login, counter enforcement, deletion — plus
 * the WebAuthn core's tamper rejections. The "authenticator" is a real P-256
 * keypair with real signatures (webauthnSim); everything the server checks is
 * the same code the browser's responses will face.
 */
import { describe, expect, it } from 'vitest';
import {
  handlePasskeyDelete,
  handlePasskeyList,
  handlePasskeyLoginOptions,
  handlePasskeyLoginVerify,
  handlePasskeyRegisterOptions,
  handlePasskeyRegisterVerify,
  handleLogin,
  handleSignup,
} from './authApi';
import { createMemoryAuthStore } from './authStore';
import { resetRateLimits } from './security';
import { WebAuthnError, cborDecode, cborEncode, derToRawSignature, toBase64Url, verifyAssertion, verifyRegistration } from './webauthn';
import { SIM_ORIGIN, simAssertionResponse, simCreateCredential, simRegistrationResponse } from './webauthnSim';
import type { PasskeyLoginResponse, PublicUser } from '../shared/authContract';

const ACCOUNT = {
  username: 'sara',
  email: 'sara@example.com',
  displayName: 'Sara',
  role: 'student' as const,
  kdfSalt: 'c2FsdHNhbHRzYWx0c2E=',
  authToken: 'YXV0aFRva2VuYXV0aFRva2VuYXV0aFRva2VuMTI=',
  recoveryHashes: ['AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='],
  wrappedDek: 'd3JhcHBlZERla3dyYXBwZWREZWt3cmFwcGVkRGVrMTI=',
  wrappedRecovery: ['d3JhcHBlZFJlY292ZXJ5d3JhcHBlZFJlY292ZXJ5MTI='],
  ciphertext: 'dmF1bHRjaXBoZXJ0ZXh0',
};

function request(path: string, method: string, body?: unknown, cookie?: string): Request {
  return new Request(`https://planner.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function cookieFrom(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0] ?? '';
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function combine(...cookies: (string | null | undefined)[]): string {
  return cookies.filter(Boolean).join('; ');
}

function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function signUp(store: ReturnType<typeof createMemoryAuthStore>): Promise<{ cookie: string; user: PublicUser }> {
  const response = await handleSignup(request('/api/auth/signup', 'POST', ACCOUNT), store);
  expect(response.status).toBe(201);
  const { user } = (await bodyOf(response)) as { user: PublicUser };
  return { cookie: cookieFrom(response), user };
}

describe('WebAuthn core', () => {
  it('round-trips CBOR for the attestation shapes we use', () => {
    const value = new Map<unknown, unknown>([
      ['fmt', 'none'],
      ['authData', new Uint8Array([1, 2, 3])],
      ['count', 4294967295],
      ['negative', -7],
      ['nested', new Map([[-2, new Uint8Array(32)]])],
    ]);
    const decoded = cborDecode(cborEncode(value));
    expect(decoded).toBeInstanceOf(Map);
    const map = decoded as Map<unknown, unknown>;
    expect(map.get('fmt')).toBe('none');
    expect(map.get('count')).toBe(4294967295);
    expect(map.get('negative')).toBe(-7);
    expect(map.get('authData')).toEqual(new Uint8Array([1, 2, 3]));
    expect((map.get('nested') as Map<unknown, unknown>).get(-2)).toEqual(new Uint8Array(32));
  });

  it('converts DER signatures to raw r||s and passes raw ones through', () => {
    const raw = new Uint8Array(64).fill(7);
    expect(derToRawSignature(raw)).toEqual(raw);

    // DER: SEQUENCE { INTEGER r, INTEGER s } with a leading zero byte on r.
    const r = new Uint8Array([0, 0xaa, 0xbb]);
    const s = new Uint8Array([0x7f, 0x01]);
    const der = new Uint8Array([0x30, 2 + (1 + r.length) + (1 + s.length), 0x02, r.length, ...r, 0x02, s.length, ...s]);
    const converted = derToRawSignature(der);
    expect(converted.length).toBe(64);
    expect(converted[0]).toBe(0); // r left-padded to 32 bytes
    expect(converted[30]).toBe(0xaa);
    expect(converted[31]).toBe(0xbb);
    expect(converted[62]).toBe(0x7f);
    expect(converted[63]).toBe(0x01);
    expect(() => derToRawSignature(new Uint8Array([1, 2, 3]))).toThrow(WebAuthnError);
  });

  it('accepts a genuine registration and rejects foreign origin or challenge', async () => {
    const credential = await simCreateCredential();
    const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const registration = await simRegistrationResponse(credential, challenge);
    const requestBase = new Request('https://planner.test/api/auth/passkey/register/verify', { method: 'POST' });

    const happy = await verifyRegistration({
      request: requestBase,
      clientDataJSON: registration.clientDataJSON,
      attestationObject: registration.attestationObject,
      expectedChallenge: challenge,
    });
    expect(happy.credentialId).toBe(credential.id);
    expect(happy.publicKey).toBe(Buffer.from(credential.publicKeyRaw).toString('base64'));

    await expect(
      verifyRegistration({
        request: requestBase,
        clientDataJSON: registration.clientDataJSON,
        attestationObject: registration.attestationObject,
        expectedChallenge: toBase64Url(crypto.getRandomValues(new Uint8Array(32))),
      }),
    ).rejects.toThrow(/challenge/);

    const wrongOrigin = await simRegistrationResponse(credential, challenge, 'https://evil.example');
    await expect(
      verifyRegistration({
        request: requestBase,
        clientDataJSON: wrongOrigin.clientDataJSON,
        attestationObject: wrongOrigin.attestationObject,
        expectedChallenge: challenge,
      }),
    ).rejects.toThrow(/origin/);
  });

  it('rejects assertions signed by any key but the credential’s own', async () => {
    const real = await simCreateCredential();
    const imposter = await simCreateCredential();
    const challenge = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const assertion = await simAssertionResponse(real, challenge, 1);
    await expect(
      verifyAssertion({
        request: new Request('https://planner.test/api/auth/passkey/login/verify', { method: 'POST' }),
        clientDataJSON: assertion.clientDataJSON,
        authenticatorData: assertion.authenticatorData,
        signature: assertion.signature,
        publicKeyRaw: imposter.publicKeyRaw,
        expectedChallenge: challenge,
      }),
    ).rejects.toThrow(/signature/);
  });
});

describe('passkey API', () => {
  it('enrols, signs in without a password, enforces the counter, and forgets', async () => {
    resetRateLimits();
    const store = createMemoryAuthStore();
    const { cookie: session, user } = await signUp(store);

    // ── enrolment options carry a challenge cookie bound to "register"
    const optionsResponse = await handlePasskeyRegisterOptions(
      request('/api/auth/passkey/register/options', 'POST', {}, session),
      store,
    );
    expect(optionsResponse.status).toBe(200);
    const { challenge } = (await bodyOf(optionsResponse)) as { challenge: string };
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    const challengeCookie = cookieFrom(optionsResponse);
    expect(challengeCookie).toContain('planner_passkey_challenge=register.');

    // ── a simulated authenticator answers the ceremony
    const credential = await simCreateCredential();
    const registration = await simRegistrationResponse(credential, challenge);
    const wrappedDek = Buffer.from(crypto.getRandomValues(new Uint8Array(44))).toString('base64');
    const verifyResponse = await handlePasskeyRegisterVerify(
      request(
        '/api/auth/passkey/register/verify',
        'POST',
        {
          id: registration.id,
          clientDataJSON: b64(registration.clientDataJSON),
          attestationObject: b64(registration.attestationObject),
          label: 'My laptop',
          transports: 'internal',
          prfWrappedDek: wrappedDek,
        },
        combine(session, challengeCookie),
      ),
      store,
    );
    expect(verifyResponse.status).toBe(201);
    expect((await bodyOf(verifyResponse)).passkey).toMatchObject({ label: 'My laptop', prf: true });
    // the challenge is consumed
    expect(verifyResponse.headers.get('set-cookie')).toContain('Max-Age=0');

    // ── listing shows exactly that passkey
    const list = await handlePasskeyList(request('/api/auth/passkey/list', 'GET', undefined, session), store);
    expect(list.status).toBe(200);
    const listed = (await bodyOf(list)).passkeys as Array<Record<string, unknown>>;
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ credentialId: credential.id, label: 'My laptop', prf: true, transports: 'internal' });

    // ── passwordless login: options narrow to this account's credentials
    const loginOptions = await handlePasskeyLoginOptions(
      request('/api/auth/passkey/login/options', 'POST', { username: ACCOUNT.username }),
      store,
    );
    expect(loginOptions.status).toBe(200);
    const parsed = (await bodyOf(loginOptions)) as { challenge: string; allowCredentials: string[] };
    expect(parsed.allowCredentials).toEqual([credential.id]);

    // ── the assertion verifies and the vault comes back with the wrapped key
    const assertion = await simAssertionResponse(credential, parsed.challenge, 1);
    const login = await handlePasskeyLoginVerify(
      request(
        '/api/auth/passkey/login/verify',
        'POST',
        {
          id: credential.id,
          clientDataJSON: b64(assertion.clientDataJSON),
          authenticatorData: b64(assertion.authenticatorData),
          signature: b64(assertion.signature),
          userHandle: user.id,
        },
        cookieFrom(loginOptions),
      ),
      store,
    );
    expect(login.status).toBe(200);
    const payload = (await bodyOf(login)) as unknown as PasskeyLoginResponse;
    expect(payload.user.username).toBe(ACCOUNT.username);
    expect(payload.wrappedDek).toBe(wrappedDek);
    expect(payload.vault.ciphertext).toBe(ACCOUNT.ciphertext);
    expect(cookieFrom(login)).toContain('planner_session=');

    // ── a clone that replays the same counter is refused
    const loginAgain = await handlePasskeyLoginOptions(
      request('/api/auth/passkey/login/options', 'POST', { username: ACCOUNT.username }),
      store,
    );
    const parsedAgain = (await bodyOf(loginAgain)) as { challenge: string };
    const cloned = await simAssertionResponse(credential, parsedAgain.challenge, 1);
    const replay = await handlePasskeyLoginVerify(
      request(
        '/api/auth/passkey/login/verify',
        'POST',
        {
          id: credential.id,
          clientDataJSON: b64(cloned.clientDataJSON),
          authenticatorData: b64(cloned.authenticatorData),
          signature: b64(cloned.signature),
          userHandle: user.id,
        },
        cookieFrom(loginAgain),
      ),
      store,
    );
    expect(replay.status).toBe(400);
    expect(await replay.text()).toMatch(/counter/);

    // ── a fresh, higher counter logs in; then deletion forgets the passkey
    const fresh = await handlePasskeyLoginOptions(
      request('/api/auth/passkey/login/options', 'POST', { username: ACCOUNT.username }),
      store,
    );
    const parsedFresh = (await bodyOf(fresh)) as { challenge: string };
    const next = await simAssertionResponse(credential, parsedFresh.challenge, 2);
    const good = await handlePasskeyLoginVerify(
      request(
        '/api/auth/passkey/login/verify',
        'POST',
        {
          id: credential.id,
          clientDataJSON: b64(next.clientDataJSON),
          authenticatorData: b64(next.authenticatorData),
          signature: b64(next.signature),
          userHandle: user.id,
        },
        cookieFrom(fresh),
      ),
      store,
    );
    expect(good.status).toBe(200);
    const signedIn = cookieFrom(good);

    const removed = await handlePasskeyDelete(
      request('/api/auth/passkey/delete', 'DELETE', { credentialId: credential.id }, signedIn),
      store,
    );
    expect(removed.status).toBe(200);
    const after = await handlePasskeyList(request('/api/auth/passkey/list', 'GET', undefined, signedIn), store);
    expect(((await bodyOf(after)).passkeys as unknown[]).length).toBe(0);

    const missing = await handlePasskeyDelete(
      request('/api/auth/passkey/delete', 'DELETE', { credentialId: credential.id }, signedIn),
      store,
    );
    expect(missing.status).toBe(404);
  });

  it('keeps unknown accounts indistinguishable from passkey-less ones', async () => {
    resetRateLimits();
    const store = createMemoryAuthStore();
    await signUp(store);
    const unknown = await handlePasskeyLoginOptions(
      request('/api/auth/passkey/login/options', 'POST', { username: 'ghost' }),
      store,
    );
    const known = await handlePasskeyLoginOptions(
      request('/api/auth/passkey/login/options', 'POST', { username: ACCOUNT.username }),
      store,
    );
    expect(unknown.status).toBe(200);
    expect(known.status).toBe(200);
    expect(((await bodyOf(unknown)).allowCredentials as unknown[]).length).toBe(0);
    expect(((await bodyOf(known)).allowCredentials as unknown[]).length).toBe(0);
  });

  it('requires a session to enrol, and rate-limits the options step', async () => {
    resetRateLimits();
    const store = createMemoryAuthStore();
    const anon = await handlePasskeyRegisterOptions(request('/api/auth/passkey/register/options', 'POST', {}), store);
    expect(anon.status).toBe(401);

    const { cookie: session } = await signUp(store);
    let limited = false;
    for (let attempt = 0; attempt < 12 && !limited; attempt += 1) {
      const response = await handlePasskeyRegisterOptions(request('/api/auth/passkey/register/options', 'POST', {}, session), store);
      if (response.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });

  it('refuses a verify with no challenge cookie', async () => {
    resetRateLimits();
    const store = createMemoryAuthStore();
    const { cookie: session } = await signUp(store);
    const credential = await simCreateCredential();
    const stale = await simRegistrationResponse(credential, toBase64Url(crypto.getRandomValues(new Uint8Array(32))));
    const response = await handlePasskeyRegisterVerify(
      request(
        '/api/auth/passkey/register/verify',
        'POST',
        {
          id: stale.id,
          clientDataJSON: b64(stale.clientDataJSON),
          attestationObject: b64(stale.attestationObject),
          label: 'No challenge',
        },
        session,
      ),
      store,
    );
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/expired/i);
  });

  it('scopes passkeys to their owner', async () => {
    resetRateLimits();
    const store = createMemoryAuthStore();
    const { cookie: session } = await signUp(store);
    const credential = await simCreateCredential();
    const options = await handlePasskeyRegisterOptions(request('/api/auth/passkey/register/options', 'POST', {}, session), store);
    const { challenge } = (await bodyOf(options)) as { challenge: string };
    const registration = await simRegistrationResponse(credential, challenge);
    const created = await handlePasskeyRegisterVerify(
      request(
        '/api/auth/passkey/register/verify',
        'POST',
        {
          id: registration.id,
          clientDataJSON: b64(registration.clientDataJSON),
          attestationObject: b64(registration.attestationObject),
          label: 'Only mine',
        },
        combine(session, cookieFrom(options)),
      ),
      store,
    );
    expect(created.status).toBe(201);

    // A second account cannot see or delete the first account's passkey.
    await handleSignup(
      request('/api/auth/signup', 'POST', { ...ACCOUNT, username: 'nadia', email: 'nadia@example.com' }),
      store,
    );
    const login = await handleLogin(request('/api/auth/login', 'POST', { username: 'nadia', authToken: ACCOUNT.authToken }), store);
    expect(login.status).toBe(200);
    const otherSession = cookieFrom(login);
    const others = await handlePasskeyList(request('/api/auth/passkey/list', 'GET', undefined, otherSession), store);
    expect(((await bodyOf(others)).passkeys as unknown[]).length).toBe(0);
    const steal = await handlePasskeyDelete(
      request('/api/auth/passkey/delete', 'DELETE', { credentialId: credential.id }, otherSession),
      store,
    );
    expect(steal.status).toBe(404);
  });
});

describe('simulated authenticator', () => {
  it('anchors its origin and rpId to one host', () => {
    expect(new URL(SIM_ORIGIN).hostname).toBe('planner.test');
  });
});
