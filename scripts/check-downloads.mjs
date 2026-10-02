#!/usr/bin/env node
/**
 * Check that every download button on the website still points at a real file.
 *
 *   npm run check:downloads
 *
 * The buttons use GitHub's stable "newest release with this file" URL:
 *
 *     https://github.com/Not-MTN/Planner/releases/latest/download/<file>
 *
 * which keeps working release after release — as long as the artifact name
 * never changes. Rename `Planner-windows.exe` in electron-builder.yml and every
 * Windows visitor gets a 404 that no test would have noticed, because the site
 * ships links, not files.
 *
 * So this asks GitHub whether each name exists. `releases/latest/download/…`
 * answers 302 whether or not the file is there, so the check follows one hop to
 * the versioned asset URL and reads that status: 302 exists, 404 missing.
 *
 * Requires network access. Exits non-zero on a missing file, so it can gate a
 * release.
 */
import { readFileSync } from 'node:fs';

const SOURCE = 'src/marketing/downloads.ts';
const TIMEOUT_MS = 20_000;

// The asset names live in `download(file, ...)` calls. Reading them with a
// pattern rather than importing keeps this runnable with plain `node`, and the
// count assertion below means a rewrite of that file cannot quietly reduce this
// check to nothing.
const text = readFileSync(SOURCE, 'utf8');
const names = [...text.matchAll(/download\(\s*'([^']+)'/g)].map((match) => match[1]);
if (names.length < 4) {
  console.error(`✗ Found only ${names.length} download names in ${SOURCE} — this check reads \`download('file.md', …)\` calls; update it if that changed.`);
  process.exit(2);
}

/** The deepest, most specific reason a request failed (the outer one is always "fetch failed"). */
function describeError(error) {
  const seen = new Set();
  const messages = [];
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === 'string' && current.message.trim()) messages.push(current.message.trim());
    const nested = Array.isArray(current.errors) && current.errors.length > 0 ? current.errors[0] : current.cause;
    if (!nested) break;
    current = nested;
  }
  const useful = messages.filter((message) => !/^fetch failed$/i.test(message));
  return useful[useful.length - 1] ?? messages[0] ?? 'the request failed';
}

const RELEASE = 'https://github.com/Not-MTN/Planner/releases/latest/download';

console.log(`\nChecking ${names.length} download link(s) against the latest release\n`);

// Two different answers, deliberately kept apart. "Missing" is a real
// observation — GitHub answered and the file is not there. "Unchecked" means
// the request never got an answer, and a network blip must not be reported as
// a renamed artifact, because that sends somebody looking for a rename that
// never happened.
const missing = [];
const unchecked = [];
for (const name of names) {
  try {
    // The first hop is a fixed redirect; the second one knows whether the
    // asset is really there.
    const head = await fetch(`${RELEASE}/${name}`, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    const location = head.headers.get('location') ?? '';
    if (head.status !== 302 || !location) {
      console.log(`✗ ${name} — expected a redirect, got HTTP ${head.status}`);
      missing.push(name);
      continue;
    }
    const asset = await fetch(location, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (asset.status === 302) {
      console.log(`✓ ${name}`);
    } else {
      console.log(`✗ ${name} — not in the latest release (HTTP ${asset.status})`);
      missing.push(name);
    }
  } catch (error) {
    const detail = describeError(error);
    console.log(`? ${name} — could not be checked: ${detail}`);
    unchecked.push(name);
  }
}

console.log('');
if (missing.length === 0 && unchecked.length === 0) {
  console.log('Every download button on the site resolves to a real file.');
  process.exit(0);
}

if (unchecked.length === names.length) {
  console.log(`None of the ${names.length} download links could be checked — GitHub could not be reached.`);
  console.log('This says nothing about the release; run it again.');
  process.exit(1);
}

if (missing.length > 0) {
  console.log(`${missing.length} of ${names.length} are missing:`);
  for (const name of missing) console.log(`  ${name}`);
  console.log('\nEither the release is too old to have them, or an artifact was renamed.');
}
if (unchecked.length > 0) {
  console.log(`${unchecked.length} of ${names.length} could not be checked:`);
  for (const name of unchecked) console.log(`  ${name}`);
}
console.log(`Keep the names in ${SOURCE} and the artifact names in step: Windows and`);
console.log('Linux/macOS are named in desktop/electron-builder.yml, the APK in');
console.log('.github/workflows/apps.yml. A version number in an artifact name breaks');
console.log('these URLs on the next release, which is why there is none.');
process.exit(1);
