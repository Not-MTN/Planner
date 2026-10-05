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
 * It also looks for the two files that make a *link* open the app rather than
 * a browser tab (deep links — see docs/APPS.md §3). Those are optional in a way
 * the origins are not: an app nobody links into still works. So a missing file
 * is reported and does not fail the run, unless this run was asked to care:
 *
 *   PLANNER_REQUIRE_DEEP_LINKS=1 npm run check:deployment -- https://your-app…
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

async function request(path, headers, method = 'GET', redirect = 'follow') {
  try {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { 'User-Agent': 'planner-deployment-check', ...headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect,
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

/**
 * A check whose answer is worth reporting but does not decide the run: deep
 * links are an extra, and failing a deployment over them would train people to
 * ignore the exit code. `PLANNER_REQUIRE_DEEP_LINKS=1` promotes them.
 */
const notes = [];
const requireDeepLinks = process.env.PLANNER_REQUIRE_DEEP_LINKS === '1';
function note(name, ok, detail) {
  notes.push({ name, ok, detail });
  const mark = ok ? '✓' : requireDeepLinks ? '✗' : '•';
  console.log(`${mark} ${name}${detail ? ` — ${detail}` : ''}`);
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

// 5. Deep links: do the two files that let a guardian's link open the installed
//    app answer, and answer for the app this repository builds?
//
//    In the address of a guardian's QR code, the *path* is always "/" and the
//    code rides in the hash — a hash never reaches a server, which is why these
//    files claim the whole path space rather than a route. Google and Apple both
//    fetch them without cookies, without redirects and (Apple) without caring
//    what the file is called, only what it says.
const appId = (process.env.PLANNER_APP_ID ?? '').trim() || 'com.notmtn.planner';
const fingerprint = (process.env.ANDROID_SIGNING_CERT_SHA256 ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
const teamId = (process.env.IOS_TEAM_ID ?? '').trim().toUpperCase();

function servedAsJson(response, body) {
  const type = response.headers.get('content-type') ?? '';
  // Order matters: a redirect is the classic silent failure (the file is there,
  // just not where the platform looked), so it is named before the status.
  if (response.status >= 300 && response.status < 400) return `redirects (HTTP ${response.status}) — verification stops at a redirect`;
  if (response.status !== 200) return `HTTP ${response.status}`;
  if (!type.includes('json')) return `served as ${type || 'no content-type'}, not application/json`;
  try {
    JSON.parse(body);
  } catch {
    return 'not valid JSON';
  }
  return '';
}

const assetLinks = await request('/.well-known/assetlinks.json', { Accept: 'application/json' }, 'GET', 'manual');
if (!assetLinks.response) {
  note('Android links are claimed', false, assetLinks.error ?? 'the request failed');
} else {
  const body = await assetLinks.response.text().catch(() => '');
  const problem = servedAsJson(assetLinks.response, body);
  if (problem) {
    note('Android links are claimed', false, `/.well-known/assetlinks.json ${problem}`);
  } else {
    const parsed = JSON.parse(body);
    const target = (Array.isArray(parsed) ? parsed : []).find((entry) => entry?.target?.namespace === 'android_app');
    const listed = (target?.target?.sha256_cert_fingerprints ?? []).map((value) => String(value).replace(/[^0-9a-fA-F]/g, '').toUpperCase());
    if (target?.target?.package_name !== appId) {
      note('Android links are claimed', false, `names ${target?.target?.package_name ?? 'no package'}, not ${appId}`);
    } else if (fingerprint && !listed.includes(fingerprint)) {
      note('Android links are claimed', false, `does not list the signing certificate of this build (${appId} is there, the fingerprint is not)`);
    } else {
      note('Android links are claimed', true, `${appId}, ${listed.length} certificate${listed.length === 1 ? '' : 's'}`);
    }
  }
}

const appleFile = await request('/.well-known/apple-app-site-association', { Accept: 'application/json' }, 'GET', 'manual');
if (!appleFile.response) {
  note('iPhone and iPad links are claimed', false, appleFile.error ?? 'the request failed');
} else {
  const body = await appleFile.response.text().catch(() => '');
  const problem = servedAsJson(appleFile.response, body);
  if (problem) {
    note('iPhone and iPad links are claimed', false, `/.well-known/apple-app-site-association ${problem}`);
  } else {
    const parsed = JSON.parse(body);
    const ids = (parsed?.applinks?.details ?? []).flatMap((detail) => detail?.appIDs ?? []);
    const expected = teamId ? `${teamId}.${appId}` : '';
    const names = ids.some((id) => String(id).endsWith(`.${appId}`));
    if (!names) note('iPhone and iPad links are claimed', false, `names ${ids.join(', ') || 'no app'}, not ${appId}`);
    else if (expected && !ids.includes(expected)) note('iPhone and iPad links are claimed', false, `names a different team than ${expected}`);
    else note('iPhone and iPad links are claimed', true, ids.join(', '));
  }
}

const soft = notes.filter((item) => !item.ok);
const failed = [...results.filter((item) => !item.ok), ...(requireDeepLinks ? soft : [])];
console.log('');
if (failed.length === 0) {
  console.log('All good: the installed apps can reach this deployment.');
  if (soft.length === 0) {
    console.log('Deep links are set up too: a link opens the app instead of a browser tab.');
  } else {
    console.log(`${soft.length} deep-link check${soft.length === 1 ? '' : 's'} did not pass (\u2022 above): links`);
    console.log('open in the browser instead of the app. That is not a fault in the apps —');
    console.log('set PLANNER_REQUIRE_DEEP_LINKS=1 to make it fail loudly — and §3 of docs/APPS.md');
    console.log('is how to set it up.');
  }
  console.log('Next: build them — Actions → Apps → Run workflow, or see docs/APPS.md.');
  process.exit(0);
}

if (unreachable) {
  console.log('Could not reach the deployment, so nothing could be checked.');
  console.log('This says nothing either way — a wrong address, a network problem or a');
  console.log('deployment that is down all look like this. Try again once it is up.');
  process.exit(2);
}

const total = results.length + (requireDeepLinks ? notes.length : 0);
console.log(`${failed.length} of ${total} checks failed.`);
if (results.some((item) => !item.ok)) {
  console.log('\nTo fix the app origins, set this in your host\'s environment variables');
  console.log('(Vercel: Project → Settings → Environment Variables) and redeploy:\n');
  console.log(`  PLANNER_APP_ORIGINS=${SHELL_ORIGINS.map((entry) => entry.origin).join(',')}`);
  console.log('\nIn Vercel: open the project → Settings → Environment Variables, add it for');
  console.log('Production (and Preview, if you build previews), then redeploy — changing a');
  console.log('variable does not reach the running deployment on its own.');
  console.log('\nAn origin you do not name stays refused, which is the point: naming');
  console.log('capacitor://localhost does not let any website call your API.');
}
if (requireDeepLinks && soft.length > 0) {
  console.log('\nTo fix the deep links: the deployment builds them from two variables');
  console.log('(Vercel: Project → Settings → Environment Variables, then redeploy):\n');
  console.log('  ANDROID_SIGNING_CERT_SHA256=the release certificate fingerprint (or a comma-separated list)');
  console.log(`  IOS_TEAM_ID=your Apple Developer team id   # pairs with ${appId}`);
  console.log('\nSection 3 of docs/APPS.md walks through both files, and what to do when');
  console.log('a platform has already cached a wrong answer.');
}
process.exit(1);
