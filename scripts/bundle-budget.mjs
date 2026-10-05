#!/usr/bin/env node
/**
 * The bundle budget: what a browser actually downloads, per release.
 *
 * `npm run size:report` weighs everything in `dist/` — the number that matters
 * for an installer, where a spare image costs a megabyte. A browser downloads
 * something else: the entry script and stylesheet in `index.html`, plus the
 * chunks it fetches next, all compressed. That is what this checks, because a
 * dependency that doubles the entry bundle is invisible in the payload total and
 * very visible on a phone.
 *
 *   npm run check:bundle-budget              compare dist/ against the baseline
 *   npm run check:bundle-budget -- --update  rewrite the baseline (a human does
 *                                            this on purpose, in its own commit)
 *
 * Three rules, in order of how badly they hurt:
 *
 *   1. Hard caps — `limits` in scripts/bundle-budget.json. Exceeding one fails
 *      whatever the baseline says; these are the numbers not to cross.
 *   2. Regression — a chunk already in the baseline may not grow past
 *      `tolerancePercent` (default 10%) without someone deciding it should.
 *   3. New chunks are allowed and reported: a new route is not a regression,
 *      and the caps above still apply to it.
 *
 * Chunk filenames carry a content hash, which changes on every edit, so the
 * baseline cannot be keyed by filename. It is keyed by where the chunk came
 * from, using the manifest Vite already writes: `src/main.tsx`, `src/pwa.ts`,
 * and `src/components/AccountGate.tsx [css]` for a chunk's stylesheet. Files
 * Vite does not emit (the hand-written `public/sw.js`, `public/theme-init.js`)
 * have no hash and are keyed by their path. Renaming or splitting a module is
 * therefore visible in the report as a new key, which is the point.
 *
 * Run it after `npm run build`; without `dist/` it fails rather than guessing.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const distDir = join(root, 'dist');
const baselinePath = join(root, 'scripts', 'bundle-budget.json');
const args = process.argv.slice(2);

export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(2) : value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/**
 * `assets/index-C3x9pQ.js` → `assets/index.js`.
 *
 * Vite's hash is a dash followed by eight base64-ish characters before the
 * extension. A name without one is left alone, so the function is safe to run
 * over hand-written filenames too.
 */
export function stripHash(path) {
  const text = String(path).split('\\').join('/');
  return text.replace(/-[A-Za-z0-9_-]{6,12}(\.[a-z0-9]+)$/i, '$1');
}

/** Compressed size — what the network carries, at the cheap and universal gzip. */
export function compressedSize(buffer) {
  return gzipSync(buffer, { level: 9 }).length;
}

/**
 * `dist/.vite/manifest.json` as `file → stable key`. Empty when the manifest
 * is missing (an older build), in which case callers fall back to names with
 * the hash stripped.
 *
 * The keys Vite chooses are not uniform: a module that is imported dynamically
 * gets its source path (`src/views/AIView.tsx`), a shared chunk gets a
 * chunk-name key with a hash (`_AccountGate-UTJDnoKx.js`), the HTML entry is
 * keyed `index.html`, and a CSS chunk is keyed by its own hashed filename. A
 * baseline keyed naively by those changes on every build, so the labels here
 * are picked in order of how stable they are:
 *
 *   1. a source path (`src/…`, `node_modules/…`) — the module a chunk is;
 *   2. `index.html [entry]` for the script the HTML loads;
 *   3. the chunk's name for a shared chunk (`AccountGate`, `vendor`, `theme`);
 *   4. `stripHash(path)` for anything left — every CSS chunk (`assets/panels.css`)
 *      and the hand-written `public/` files Vite copies verbatim.
 */
export function readManifest(dist) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8'));
  } catch {
    return new Map();
  }
  const keys = new Map();
  const claim = (file, label) => {
    if (!file || !label) return;
    const path = String(file).replace(/^\//, '');
    if (!keys.has(path)) keys.set(path, label);
  };
  const records = Object.entries(manifest).map(([key, value]) => ({
    key,
    record: value && typeof value === 'object' ? value : {},
  }));

  // JavaScript first, from the most stable label available.
  for (const { key, record } of records) claim(record.file, jsLabel(key, record));
  // Then everything left — the CSS chunks, which are keyed by their own name
  // (a shared stylesheet legitimately belongs to no single chunk, and picking
  // one owner would make the key move when the module graph does), plus the
  // hand-written `public/` files Vite copies verbatim.
  for (const { key, record } of records) claim(record.file, chunkLabel(key));
  return keys;
}

/** A chunk filename without its hash or Vite's shared-chunk `_` marker. */
export function chunkLabel(path) {
  return stripHash(path).replace(/^_/, '');
}

/** A hashed chunk filename, as opposed to a path someone wrote in the repo. */
export function looksLikeChunkFile(value) {
  return /^_/.test(value) || /-[A-Za-z0-9_-]{6,12}\.[a-z0-9]+$/.test(value);
}

function jsLabel(key, record) {
  const src = typeof record.src === 'string' ? record.src : '';
  if (src.endsWith('.html')) return `${src} [entry]`;
  if (src && !looksLikeChunkFile(src)) return src;
  if (typeof record.name === 'string' && record.name && /^[A-Za-z][A-Za-z0-9_-]*$/.test(record.name)) return record.name;
  return null;
}

/**
 * Give every file its stable key, and make the keys unique: a module that
 * appears twice (an entry and an async chunk) must not collapse into one row.
 */
export function labelBundles(files, manifest) {
  const seen = new Map();
  return files.map((file) => {
    const base = manifest.get(file.path) ?? stripHash(file.path);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return { ...file, name: count === 1 ? base : `${base} [${count}]` };
  });
}

/**
 * Every JS and CSS file in `dist/` with its raw and compressed size.
 * Source maps and the HTML itself are not downloaded as bundles.
 */
export function collectBundles(dir) {
  const out = [];
  const walk = (current) => {
    let listed;
    try {
      listed = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of listed) {
      const full = join(current, item.name);
      if (item.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(js|css)$/.test(item.name) || /\.map$/.test(item.name)) continue;
      const buffer = readFileSync(full);
      out.push({
        path: relative(dir, full).split(sep).join('/'),
        name: relative(dir, full).split(sep).join('/'),
        size: buffer.length,
        gzip: compressedSize(buffer),
      });
    }
  };
  walk(dir);
  return out.sort((a, b) => b.gzip - a.gzip || a.path.localeCompare(b.path));
}

/**
 * The files `index.html` makes the browser fetch before the app can paint:
 * `<script src>`, `<link rel="stylesheet" href>` and `<link
 * rel="modulepreload">`. Returned as a set of `dist/`-relative paths.
 */
export function entryAssets(html) {
  const assets = new Set();
  const add = (value) => {
    if (!value) return;
    const clean = String(value).replace(/^\.?\//, '').split('?')[0].split('#')[0];
    if (/\.(js|css)$/.test(clean)) assets.add(clean);
  };
  for (const match of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/gi)) add(match[1]);
  for (const match of html.matchAll(/<link[^>]*>/gi)) {
    const tag = match[0];
    if (!/rel="(?:stylesheet|modulepreload|preload)"/i.test(tag)) continue;
    add(/href="([^"]+)"/i.exec(tag)?.[1]);
  }
  return assets;
}

/**
 * Decide whether a build fits.
 *
 * `files` is `collectBundles()` output, `entry` the `entryAssets()` set,
 * `baseline` the committed `scripts/bundle-budget.json`. Returns the rows to
 * print, the problems that failed the build, and notes that are worth printing
 * without failing anything.
 */
export function evaluateBudget({ files, entry, baseline, tolerancePercent }) {
  const limits = baseline.limits ?? {};
  const measured = baseline.measured ?? {};
  const tolerance = (Number.isFinite(tolerancePercent) ? tolerancePercent : baseline.tolerancePercent ?? 10) / 100;
  const rows = [];
  const problems = [];
  const notes = [];

  const entryFiles = files.filter((file) => entry.has(file.path));
  const entryGzip = entryFiles.reduce((sum, file) => sum + file.gzip, 0);
  const totalGzip = files.reduce((sum, file) => sum + file.gzip, 0);
  const biggest = files[0];

  for (const file of files) {
    const before = measured[file.name];
    const row = { name: file.name, path: file.path, gzip: file.gzip, size: file.size, before, inEntry: entry.has(file.path) };
    rows.push(row);
    if (before === undefined) {
      notes.push(`new: ${file.name} (${formatBytes(file.gzip)})`);
    } else if (file.gzip > Math.ceil(before * (1 + tolerance))) {
      problems.push(
        `${file.name} grew to ${formatBytes(file.gzip)} from ${formatBytes(before)} (past the ${Math.round(tolerance * 100)}% tolerance). ` +
          'Split it, drop the dependency, or — if it is a decision — run `npm run check:bundle-budget -- --update` in its own commit.',
      );
    }
  }

  for (const name of Object.keys(measured)) {
    if (!files.some((file) => file.name === name)) notes.push(`gone: ${name} (was ${formatBytes(measured[name])})`);
  }

  if (Number.isFinite(limits.totalGzipBytes) && totalGzip > limits.totalGzipBytes) {
    problems.push(`total compressed JavaScript and CSS is ${formatBytes(totalGzip)} — over the ${formatBytes(limits.totalGzipBytes)} cap.`);
  }
  if (Number.isFinite(limits.entryGzipBytes) && entryGzip > limits.entryGzipBytes) {
    problems.push(
      `the entry bundle (${entryFiles.map((file) => file.name).join(', ') || 'none'}) is ${formatBytes(entryGzip)} — over the ${formatBytes(limits.entryGzipBytes)} cap.`,
    );
  }
  if (biggest && Number.isFinite(limits.chunkGzipBytes) && biggest.gzip > limits.chunkGzipBytes) {
    problems.push(`${biggest.name} alone is ${formatBytes(biggest.gzip)} — over the ${formatBytes(limits.chunkGzipBytes)} per-chunk cap.`);
  }

  return { rows, problems, notes, entryGzip, totalGzip, limits };
}

function loadBaseline() {
  try {
    return JSON.parse(readFileSync(baselinePath, 'utf8'));
  } catch (error) {
    console.error(`✗ could not read scripts/bundle-budget.json: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

function currentBuild() {
  let html;
  try {
    html = readFileSync(join(distDir, 'index.html'), 'utf8');
  } catch {
    console.error('✗ dist/index.html is missing — run `npm run build` first.');
    process.exit(2);
  }
  const files = labelBundles(collectBundles(distDir), readManifest(distDir));
  if (!files.length) {
    console.error('✗ dist/ has no JavaScript or CSS — did the build succeed?');
    process.exit(2);
  }
  return { files, entry: entryAssets(html) };
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const { files, entry } = currentBuild();
  const baseline = loadBaseline();

  if (args.includes('--update')) {
    const limits = {
      ...baseline.limits,
      // A cap that the current build already breaks would be a lie the next
      // run inherits. Growth keeps the existing headroom when there is any.
      totalGzipBytes: Math.max(baseline.limits?.totalGzipBytes ?? 0, Math.ceil(files.reduce((sum, file) => sum + file.gzip, 0) * 1.15)),
      entryGzipBytes: Math.max(
        baseline.limits?.entryGzipBytes ?? 0,
        Math.ceil(files.filter((file) => entry.has(file.path)).reduce((sum, file) => sum + file.gzip, 0) * 1.15),
      ),
      chunkGzipBytes: Math.max(baseline.limits?.chunkGzipBytes ?? 0, Math.ceil(files[0].gzip * 1.15)),
    };
    const next = {
      ...baseline,
      updated: new Date().toISOString().slice(0, 10),
      tolerancePercent: baseline.tolerancePercent ?? 10,
      limits,
      measured: Object.fromEntries(files.map((file) => [file.name, file.gzip])),
    };
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`✓ baseline rewritten: ${files.length} file(s), ${formatBytes(next.measured ? files.reduce((sum, file) => sum + file.gzip, 0) : 0)} total compressed.`);
    console.log('  Commit scripts/bundle-budget.json together with the change that moved it.');
    process.exit(0);
  }

  const { rows, problems, notes, entryGzip, totalGzip, limits } = evaluateBudget({
    files,
    entry,
    baseline,
    tolerancePercent: Number(baseline.tolerancePercent),
  });

  console.log('Compressed bundle sizes (dist/)');
  for (const row of rows) {
    const delta = row.before === undefined ? 'new' : row.before === row.gzip ? '=' : `${row.gzip > row.before ? '+' : ''}${formatBytes(Math.abs(row.gzip - row.before))}`;
    const marker = row.inEntry ? '*' : ' ';
    console.log(`  ${marker} ${formatBytes(row.gzip).padStart(9)}  ${delta.padStart(9)}  ${row.name}`);
  }
  console.log(`  ${'-'.repeat(34)}`);
  console.log(`    ${formatBytes(entryGzip).padStart(9)}  entry (marked *), cap ${formatBytes(limits.entryGzipBytes)}`);
  console.log(`    ${formatBytes(totalGzip).padStart(9)}  total,      cap ${formatBytes(limits.totalGzipBytes)}`);
  for (const note of notes) console.log(`  · ${note}`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log(problems.length ? `\n✗ bundle budget failed (${problems.length} problem(s))` : '\n✓ bundle budget holds');
  process.exit(problems.length ? 1 : 0);
}
