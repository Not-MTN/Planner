import { describe, expect, it } from 'vitest';
import {
  allowedAppOrigin,
  configuredAppOrigins,
  corsHeadersForRequest,
  normalizeOrigin,
  preflightResponse,
} from './appOrigins';
import { isSameOriginRequest } from './groqProxy';

const ANDROID = 'https://localhost';
const IOS = 'capacitor://localhost';
const DESKTOP = 'app://planner';
const SHELLS = `${ANDROID},${IOS},${DESKTOP}`;

function request(init: RequestInit & { url?: string } = {}): Request {
  const headers = new Headers(init.headers);
  return new Request(init.url ?? 'https://planner.example.com/api/auth/login', { ...init, headers });
}

describe('normalizeOrigin', () => {
  it('keeps bare origins, including custom schemes', () => {
    expect(normalizeOrigin('https://app.example.com')).toBe('https://app.example.com');
    expect(normalizeOrigin('https://app.example.com/')).toBe('https://app.example.com');
    expect(normalizeOrigin('https://app.example.com:443')).toBe('https://app.example.com');
    expect(normalizeOrigin('http://10.0.2.2:5173')).toBe('http://10.0.2.2:5173');
    expect(normalizeOrigin('capacitor://localhost')).toBe('capacitor://localhost');
    expect(normalizeOrigin('app://planner')).toBe('app://planner');
  });

  it('refuses anything that could widen the allow-list', () => {
    expect(normalizeOrigin('*')).toBeNull();
    expect(normalizeOrigin('https://*.example.com')).toBeNull();
    expect(normalizeOrigin('https://app.example.com/api')).toBeNull();
    expect(normalizeOrigin('https://app.example.com?x=1')).toBeNull();
    expect(normalizeOrigin('https://user:pass@app.example.com')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin('not a url')).toBeNull();
  });
});

describe('configuredAppOrigins', () => {
  it('is empty by default — nothing is trusted implicitly', () => {
    expect(configuredAppOrigins(undefined)).toEqual([]);
    expect(configuredAppOrigins('')).toEqual([]);
  });

  it('parses a list, drops junk, and de-duplicates', () => {
    const origins = configuredAppOrigins(` ${IOS} , https://localhost/, https://localhost,*, https://x.example.com/path `);
    expect(origins).toEqual([IOS, ANDROID]);
  });
});

describe('allowedAppOrigin', () => {
  it('answers only for origins the operator named', () => {
    const fromShell = request({ headers: { origin: IOS } });
    expect(allowedAppOrigin(fromShell, SHELLS)).toBe(IOS);
    expect(allowedAppOrigin(fromShell, '')).toBeNull();

    const fromSomewhereElse = request({ headers: { origin: 'https://evil.example.com' } });
    expect(allowedAppOrigin(fromSomewhereElse, SHELLS)).toBeNull();
  });

  it('treats a request without an Origin as same-origin, not as a shell', () => {
    expect(allowedAppOrigin(request(), SHELLS)).toBeNull();
  });

  it('does not treat the deployment itself as a shell origin', () => {
    const ownOrigin = request({ headers: { origin: 'https://planner.example.com', host: 'planner.example.com' } });
    expect(allowedAppOrigin(ownOrigin, 'https://planner.example.com')).toBeNull();
    expect(isSameOriginRequest(ownOrigin)).toBe(true);
  });
});

describe('isSameOriginRequest with packaged apps', () => {
  it('still refuses a browser cross-site request', () => {
    const blocked = request({
      method: 'POST',
      headers: { origin: 'https://evil.example.com', 'sec-fetch-site': 'cross-site' },
    });
    expect(isSameOriginRequest(blocked)).toBe(false);
  });

  it('refuses a shell-shaped request when the operator configured no origins', () => {
    const blocked = request({
      method: 'POST',
      headers: { origin: ANDROID, 'sec-fetch-site': 'cross-site' },
    });
    expect(isSameOriginRequest(blocked)).toBe(false);
  });

  it('accepts the shells the operator listed, which are cross-site by design', () => {
    const previous = process.env.PLANNER_APP_ORIGINS;
    process.env.PLANNER_APP_ORIGINS = SHELLS;
    try {
      for (const origin of [ANDROID, IOS, DESKTOP]) {
        const allowed = request({
          method: 'POST',
          headers: { origin, 'sec-fetch-site': 'cross-site' },
        });
        expect(isSameOriginRequest(allowed)).toBe(true);
      }
      // A look-alike host is still refused.
      const lookAlike = request({
        method: 'POST',
        headers: { origin: 'https://localhost.evil.example.com', 'sec-fetch-site': 'cross-site' },
      });
      expect(isSameOriginRequest(lookAlike)).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PLANNER_APP_ORIGINS;
      else process.env.PLANNER_APP_ORIGINS = previous;
    }
  });
});

describe('CORS answers', () => {
  it('echoes the exact origin with credentials, and only for allowed origins', () => {
    expect(corsHeadersForRequest(request({ headers: { origin: IOS } }), SHELLS)).toEqual({
      'Access-Control-Allow-Origin': IOS,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    });
    expect(corsHeadersForRequest(request({ headers: { origin: 'https://evil.example.com' } }), SHELLS)).toBeNull();
    expect(corsHeadersForRequest(request(), SHELLS)).toBeNull();
  });

  it('answers a preflight with the requested headers', () => {
    const preflight = request({
      method: 'OPTIONS',
      headers: {
        origin: ANDROID,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'content-type, x-sync-id',
      },
    });
    const response = preflightResponse(preflight, SHELLS);
    expect(response?.status).toBe(204);
    expect(response?.headers.get('access-control-allow-origin')).toBe(ANDROID);
    expect(response?.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response?.headers.get('access-control-allow-headers')).toBe('content-type, x-sync-id');
    expect(response?.headers.get('access-control-allow-methods')).toContain('PUT');
    expect(response?.headers.get('vary')).toContain('Access-Control-Request-Headers');
  });

  it('gives a browser preflight nothing', () => {
    const preflight = request({ method: 'OPTIONS', headers: { origin: 'https://evil.example.com' } });
    expect(preflightResponse(preflight, SHELLS)).toBeNull();
  });
});
