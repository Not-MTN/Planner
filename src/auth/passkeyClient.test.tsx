// @vitest-environment jsdom
/**
 * The passkey journey through the real UI and the real API handlers: enrol a
 * passkey on the recovery screen after sign-up (with the PRF-wrapped vault
 * key), then sign in from the login screen with nothing but a touch — the
 * session and the vault both come back. A simulated authenticator stands in
 * for the browser's WebAuthn API; every request hits the real server code.
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Site } from '../marketing/Site';
import { resetRateLimits } from '../server/security';
import { simAssertionResponse, simCreateCredential, simRegistrationResponse, type SimCredential } from '../server/webauthnSim';
import { getActiveSession } from './session';

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  (window as unknown as { matchMedia: unknown }).matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
  class StubObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = StubObserver;
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => window.clearTimeout(handle));
});

let container: HTMLDivElement;
let root: Root;
let requests: string[] = [];
let assign: ReturnType<typeof vi.fn>;
let cookieJar: Map<string, string>;
let signedUpUser: { id: string; username: string } | null;
let credential: SimCredential;
let prfSupported: boolean;
let createBehaviour: 'ok' | 'cancel';
let assertionCounter: number;

/** The authenticator's PRF answer — constant, like one credential's own secret. */
const PRF_OUTPUT = new Uint8Array(32).fill(0x5a);

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function applySetCookie(response: Response): void {
  const raw = response.headers.get('set-cookie');
  if (!raw) return;
  const [pair] = raw.split(';');
  const [name, ...rest] = (pair ?? '').split('=');
  const value = rest.join('=');
  if (value) cookieJar.set(name!.trim(), value);
  else cookieJar.delete(name!.trim());
}

function cookieHeader(): string {
  return [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  requests = [];
  cookieJar = new Map();
  signedUpUser = null;
  prfSupported = true;
  createBehaviour = 'ok';
  assertionCounter = 0;
  resetRateLimits();
  window.localStorage.clear();

  assign = vi.fn();
  vi.stubGlobal('location', { pathname: '/signup', hostname: 'planner.test', origin: 'https://planner.test', assign });

  credential = undefined as unknown as SimCredential;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, 'https://planner.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      requests.push(`${method} ${path}`);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cookieJar.size) headers.Cookie = cookieHeader();
      const request = new Request(`https://planner.test${path}`, {
        method,
        headers,
        body: init?.body ? String(init?.body) : undefined,
      });
      const { handleApiRequest } = await import('../server/apiRouter');
      const response = await handleApiRequest(request, {});
      applySetCookie(response.clone());
      if (path === '/api/auth/signup' && method === 'POST') {
        signedUpUser = ((await response.clone().json()) as { user: { id: string; username: string } }).user;
      }
      return response;
    }),
  );

  // A platform authenticator with PRF — Chrome/Edge shape.
  vi.stubGlobal(
    'PublicKeyCredential',
    class {
      static async getClientCapabilities() {
        return { extensions: prfSupported ? ['prf', 'credProps'] : ['credProps'] };
      }
    },
  );

  vi.stubGlobal('navigator', {
    ...navigator,
    credentials: {
      create: vi.fn(async (options: { publicKey: { challenge: Uint8Array } }) => {
        if (createBehaviour === 'cancel') {
          throw new DOMException('The operation was cancelled.', 'NotAllowedError');
        }
        const reg = await simRegistrationResponse(credential, b64url(options.publicKey.challenge));
        return {
          id: reg.id,
          rawId: reg.rawId,
          type: 'public-key',
          response: {
            clientDataJSON: reg.clientDataJSON,
            attestationObject: reg.attestationObject,
            getTransports: () => ['internal'],
          },
          getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: PRF_OUTPUT.buffer } } }),
        };
      }),
      get: vi.fn(async (options: { publicKey: { challenge: Uint8Array } }) => {
        if (createBehaviour === 'cancel') {
          throw new DOMException('The operation was cancelled.', 'NotAllowedError');
        }
        assertionCounter += 1;
        const assertion = await simAssertionResponse(credential, b64url(options.publicKey.challenge), assertionCounter);
        return {
          id: credential.id,
          rawId: credential.rawId,
          type: 'public-key',
          response: {
            clientDataJSON: assertion.clientDataJSON,
            authenticatorData: assertion.authenticatorData,
            signature: assertion.signature,
            userHandle: new TextEncoder().encode(signedUpUser!.id),
          },
          getClientExtensionResults: () => ({ prf: { results: { first: PRF_OUTPUT.buffer } } }),
        };
      }),
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function renderAt(path: string) {
  vi.stubGlobal('location', { pathname: path, hostname: 'planner.test', origin: 'https://planner.test', assign });
  window.history.pushState({}, '', path);
  await act(async () => {
    root.render(
      <StrictMode>
        <Site />
      </StrictMode>,
    );
  });
}

function setValue(input: HTMLInputElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function setChecked(input: HTMLInputElement, checked: boolean) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')?.set;
    setter?.call(input, checked);
    input.dispatchEvent(new Event('click', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function click(element: Element | null | undefined) {
  await act(async () => {
    (element as HTMLButtonElement | null | undefined)?.click();
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 30_000) {
  await act(async () => {
    for (let waited = 0; waited < timeoutMs && !predicate(); waited += 100) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
}

const buttonStartingWith = (text: string) =>
  [...container.querySelectorAll('button')].find((button) => (button.textContent ?? '').trim().startsWith(text));

async function createAccountThroughForm(username: string) {
  await renderAt('/signup');
  const inputs = [...container.querySelectorAll('input')] as HTMLInputElement[];
  setValue(inputs[0]!, 'Omid Hashemi');
  setValue(inputs[1]!, username);
  setValue(inputs[2]!, '');
  setValue(inputs[3]!, 'a-long-enough-password');
  setChecked(inputs[4]!, true);
  await click(container.querySelector('form.auth-fields button[type="submit"]'));
  await click(buttonStartingWith('Continue'));
  await waitFor(() => container.textContent.includes('Save your recovery key'));
}

describe('passkey journey', () => {
  it('enrols a passkey after sign-up, then opens the planner with it and no password', async () => {
    credential = await simCreateCredential();
    await createAccountThroughForm('passkeyuser');

    // The recovery step offers enrolment while the fresh vault key is in memory.
    expect(buttonStartingWith('Add a passkey')).toBeTruthy();
    await click(buttonStartingWith('Add a passkey'));
    await waitFor(() => container.textContent.includes('Passkey added'));
    expect(buttonStartingWith('Passkey added')?.textContent).toContain('Passkey added');
    expect(requests).toContain('POST /api/auth/passkey/register/options');
    expect(requests).toContain('POST /api/auth/passkey/register/verify');
    expect(container.querySelector('.auth-error')).toBeNull();

    // Fresh page at the login screen: one touch, no password field touched.
    act(() => root.unmount());
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await renderAt('/login');
    await click(buttonStartingWith('Sign in with a passkey'));
    await waitFor(() => assign.mock.calls.length > 0);

    expect(assign).toHaveBeenCalledWith('/app');
    expect(requests).toContain('POST /api/auth/passkey/login/options');
    expect(requests).toContain('POST /api/auth/passkey/login/verify');

    // The PRF-unwrapped vault key adopted the session — no password involved.
    const session = getActiveSession();
    expect(session?.user.username).toBe('passkeyuser');
    expect(session?.dekRaw).toBeTruthy();
    expect(session?.vault.ciphertext.length).toBeGreaterThan(0);
  }, 60_000);

  it('refuses to enrol when the browser has no PRF — before creating anything', async () => {
    prfSupported = false;
    credential = await simCreateCredential();
    await createAccountThroughForm('noprfuser');

    await click(buttonStartingWith('Add a passkey'));
    await waitFor(() => Boolean(container.querySelector('.auth-error')));
    expect(container.querySelector('.auth-error')?.textContent).toBe(
      "This browser's passkeys cannot open your planner — your password will.",
    );
    expect(requests).not.toContain('POST /api/auth/passkey/register/verify');
    expect(buttonStartingWith('Add a passkey')).toBeTruthy(); // still offers it, plainly
  }, 60_000);

  it('turns a cancelled sign-in touch into a sentence, not an error flood', async () => {
    createBehaviour = 'cancel';
    await renderAt('/login');
    await click(buttonStartingWith('Sign in with a passkey'));
    await waitFor(() => Boolean(container.querySelector('.auth-error')));
    expect(container.querySelector('.auth-error')?.textContent).toBe('Passkey sign-in was cancelled.');
    expect(assign).not.toHaveBeenCalled();
    expect(requests).toContain('POST /api/auth/passkey/login/options');
    expect(requests).not.toContain('POST /api/auth/passkey/login/verify');
  }, 60_000);
});
