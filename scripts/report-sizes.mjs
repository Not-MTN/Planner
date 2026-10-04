#!/usr/bin/env node
/**
 * Weigh what the installers carry.
 *
 *   npm run size:report                 report the payload and any installers
 *   npm run size:report -- --check 4    also fail if dist/ is bigger than 4 MB
 *
 * Electron itself is ~90 MB of every installer and none of it is ours, so the
 * number this can actually control is the payload next to it: `dist/`, which
 * electron-builder packs into the Windows, macOS and Linux artefacts and
 * Capacitor packs into the APK. This prints where that payload goes, so a
 * regression has a name attached to it instead of being a rumour.
 *
 * Run it after `npm run build`. If `desktop/release/` holds finished
 * installers (after `npm run desktop:dist`), they are listed too.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const webDist = join(root, 'dist');
const installerDir = join(root, 'desktop', 'release');

/** 1_048_576 bytes as "1.05 MB": precise enough to compare two builds. */
export function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = Number(bytes) || 0;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(2) : value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

/** The folder a path lives in, or '.' when it sits at the root of what we weighed. */
export function topFolder(filePath) {
  const parts = String(filePath).split(/[\\/]/);
  if (parts.length < 2) return '.';
  return parts.slice(0, -1).join('/');
}

/**
 * Group `{ path, size }` entries into folders, biggest first.
 * Paths use '/' on the way in and out, so the report reads the same on Windows.
 */
export function summarise(entries) {
  const groups = new Map();
  let total = 0;
  for (const entry of entries) {
    const folder = topFolder(entry.path);
    groups.set(folder, (groups.get(folder) ?? 0) + (Number(entry.size) || 0));
    total += Number(entry.size) || 0;
  }
  const rows = [...groups.entries()]
    .map(([folder, size]) => ({ folder, size }))
    .sort((a, b) => b.size - a.size || a.folder.localeCompare(b.folder));
  return { total, rows };
}

/** The report body: a title, one line per folder, and a total. */
export function describeSummary(title, entries) {
  const { total, rows } = summarise(entries);
  if (!rows.length) return [`${title}`, '  (nothing built yet)'];
  const width = Math.max(...rows.map((row) => row.folder.length), 8);
  return [
    title,
    ...rows.map((row) => `  ${formatBytes(row.size).padStart(9)}  ${row.folder.padEnd(width)}`),
    `  ${'-'.repeat(width + 11)}`,
    `  ${formatBytes(total).padStart(9)}  total`,
  ];
}

/** What a `--check <MB>` run decides about a payload of `totalBytes`. */
export function checkBudget(totalBytes, budgetMb) {
  const limit = Math.round(Number(budgetMb) * 1024 * 1024);
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: true, message: '' };
  }
  const ok = totalBytes <= limit;
  return {
    ok,
    message: ok
      ? `✓ payload ${formatBytes(totalBytes)} is within the ${budgetMb} MB budget`
      : `✗ payload ${formatBytes(totalBytes)} exceeds the ${budgetMb} MB budget by ${formatBytes(totalBytes - limit)}`,
  };
}

/** Every file under `dir` as `{ path, size }`, with paths relative to `dir`. */
export function collectFiles(dir) {
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
      try {
        out.push({ path: relative(dir, full).split(sep).join('/'), size: statSync(full).size });
      } catch {
        /* a file that vanished mid-walk is not worth failing the report */
      }
    }
  };
  walk(dir);
  return out;
}

function parseBudget(args) {
  const flag = args.indexOf('--check');
  if (flag === -1) return null;
  const value = Number(args[flag + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    console.error('✗ --check needs a size in megabytes, e.g. --check 4');
    process.exit(2);
  }
  return value;
}

const args = process.argv.slice(2);
const budgetMb = parseBudget(args);
const payload = collectFiles(webDist);
const installers = collectFiles(installerDir);

console.log(describeSummary('Packaged app payload (dist/) — what every installer carries', payload).join('\n'));

if (installers.length) {
  const lines = installers
    .slice()
    .sort((a, b) => b.size - a.size)
    .map((file) => `  ${formatBytes(file.size).padStart(9)}  ${file.path}`);
  console.log('\nBuilt installers (desktop/release/)');
  console.log(lines.join('\n'));
}

if (budgetMb !== null) {
  const { ok, message } = checkBudget(summarise(payload).total, budgetMb);
  console.log(`\n${message}`);
  if (!ok) process.exit(1);
}
