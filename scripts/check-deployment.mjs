#!/usr/bin/env node
/**
 * Check that a deployment is ready for the installed apps.
 *
 *   npm run check:deployment -- https://your-app.example.com
 *
 * The website works the moment it is deployed. The *apps* need one more thing:
 * they run from their own origin (`https://localhost` on Android,
 * `capacitor://localhost` on iOS, `app://planner` on the desktop), so the
 * server has to allow those origins explicitly. Until it does, every account,
 * sync and AI request is refused — and because a browser hides the reason
 * behind "CORS error", the app just looks broken.
 *
 * So this script asks the deployment the same questions a phone would, and
 * prints the one-line fix when an answer is missing.
 *
 * Exit codes, because CI has to tell two different situations apart:
 *
 *   0  the deployment is ready for the apps
 *   1  it answered, and the apps would be refused (a real misconfiguration)
 *   2  it could not be reached at all (inconclusive — do not fail a build for
 *      somebody else's outage, but do not pretend it was checked either)
 *   3  the script was used wrongly
 */
const SHELL_ORIGINS = [
  { origin: 'https://localhost', app: 'Android' },
  { origin: 'capacitor://localhost', app: 'iPhone / iPad' },
  { origin: 'app://planner', app: 'Desktop (Windows / macOS / Linux)' },
];

const raw = (process.argv[2] ?? process.env.PLANNER_API_ORIGIN ?? '').trim();
if (!raw) {
  console.error('Usage: npm run check:deployment -- https://your-app.example.com');
  console.error('   or: PLANNER_API_ORIGIN=https://… npm run check:deployment');
  process.exit(3);
}

let base;
try {
  base = new URL(raw).origin;
} catch {
  console.error(`✗ Not a URL: ${raw}`);
  process.exit(3);
}

const TIMEOUT_MS = 20_000;
/** Where the app reads its own status: a GET that needs no account. */
const STATUS_PATH = '/api/auth/status';

/**
 * The reason a request failed, in one non-empty sentence.
 *
 * This is fussier than it looks, and it has to be: Node's `fetch` wraps a
 * refused connection in an `AggregateError` whose own `message` is empty, so
 * the naive `error.message` produced an empty string — which is falsy, which
 * made the caller treat "could not reach the deployment" as "the deployment
 * answered". That is the one diagnosis that must never be wrong here, because
 * it decides whether CI says "fix your server" or "nothing could be checked".
 */
function describeError(error) {
  const seen = new Set();
  const messages = [];
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === 'string' && current.message.trim()) messages.push(current.message.trim());
    // AggregateError keeps the real reasons in `errors`; a refused connection
    // arrives as one of those, with the useful text inside it.
    const nested = Array.isArray(current.errors) && current.errors.length > 0 ? current.errors[0] : current.cause;
    if (!nested) break;
    current = nested;
  }
  // The deepest message wins. The outer one is always "fetch failed", which
  // tells nobody anything; "connect ECONNREFUSED 127.0.0.1:5173" is the answer.
  const useful = messages.filter((message) => !/^fetch failed$/i.test(message));
  if (useful.length > 0) return useful[useful.length - 1];
  if (messages.length > 0) return messages[0];
  if (error instanceof Error && error.name) return error.name;
  const text = String(error ?? '').trim();
  return text || 'the request failed';
}

async function request(path, headers, method = 'GET') {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'User-Agent': 'planner-deployment-check', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: 'follow',
    });
    return { response };
  } catch (error) {
    return { error: describeError(error) };
  }
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

console.log(`\nChecking ${base}\n`);

// 1. Is the site itself live?
const site = await request('/', {});
// Keyed off the response, not off an error string: a falsy-but-present error
// once sent this down the wrong branch and crashed.
const unreachable = !site.response;
if (!site.response) {
  record('the site answers', false, site.error ?? 'the request failed');
} else {
  const body = await site.response.text().catch(() => '');
  const looksRight = site.response.status === 200 && /planner/i.test(body);
  record(
    'the site answers',
    looksRight,
    looksRight ? `HTTP 200, ${Math.round(body.length / 1024)} KB of HTML` : `HTTP ${site.response.status}`,
  );
}

// 2. Is the API deployed behind the same domain?
const api = await request(STATUS_PATH, { Accept: 'application/json' });
if (!api.response) {
  record('the API answers', false, api.error ?? 'the request failed');
} else {
  const type = api.response.headers.get('content-type') ?? '';
  const ok = api.response.status === 200 && type.includes('json');
  record('the API answers', ok, ok ? `HTTP 200, ${type}` : `HTTP ${api.response.status}, ${type || 'no content-type'}`);
}

// 3. Does it trust each shell origin? This is the part that needs setting up.
for (const { origin, app } of SHELL_ORIGINS) {
  const result = await request(STATUS_PATH, { Origin: origin, Accept: 'application/json' });
  if (!result.response) {
    record(`${app} is allowed`, false, result.error ?? 'the request failed');
    continue;
  }
  const allowed = result.response.headers.get('access-control-allow-origin');
  const credentials = result.response.headers.get('access-control-allow-credentials');
  if (allowed === origin) {
    record(`${app} is allowed`, true, `Access-Control-Allow-Origin: ${allowed}${credentials === 'true' ? ', credentials' : ''}`);
  } else if (allowed) {
    record(`${app} is allowed`, false, `answered for a different origin: ${allowed}`);
  } else {
    record(`${app} is allowed`, false, 'no Access-Control-Allow-Origin — this origin is not in PLANNER_APP_ORIGINS');
  }
}

// 4. A real preflight, the way a POST with JSON and cookies arrives.
const preflightOrigin = SHELL_ORIGINS[0].origin;
const preflight = await request(
  STATUS_PATH,
  {
    Origin: preflightOrigin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  },
  'OPTIONS',
);
if (!preflight.response) {
  record('preflight (OPTIONS) answers', false, preflight.error ?? 'the request failed');
} else {
  const allowed = preflight.response.headers.get('access-control-allow-origin');
  const ok = preflight.response.status === 204 && allowed === preflightOrigin;
  record(
    'preflight (OPTIONS) answers',
    ok,
    ok ? 'HTTP 204 with the shell origin' : `HTTP ${preflight.response.status}${allowed ? `, allow-origin ${allowed}` : ', no allow-origin'}`,
  );
}

const failed = results.filter((item) => !item.ok);
console.log('');
if (failed.length === 0) {
  console.log('All good: the installed apps can reach this deployment.');
  console.log('Next: build them — Actions → Apps → Run workflow, or see docs/APPS.md.');
  process.exit(0);
}

if (unreachable) {
  console.log('Could not reach the deployment, so nothing could be checked.');
  console.log('This says nothing either way — a wrong address, a network problem or a');
  console.log('deployment that is down all look like this. Try again once it is up.');
  process.exit(2);
}

console.log(`${failed.length} of ${results.length} checks failed.`);
console.log('\nTo fix the app origins, set this in your host\'s environment variables');
console.log('(Vercel: Project → Settings → Environment Variables) and redeploy:\n');
console.log(`  PLANNER_APP_ORIGINS=${SHELL_ORIGINS.map((entry) => entry.origin).join(',')}`);
console.log('\nIn Vercel: open the project → Settings → Environment Variables, add it for');
console.log('Production (and Preview, if you build previews), then redeploy — changing a');
console.log('variable does not reach the running deployment on its own.');
console.log('\nAn origin you do not name stays refused, which is the point: naming');
console.log('capacitor://localhost does not let any website call your API.');
process.exit(1);
