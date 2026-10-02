#!/usr/bin/env node
/**
 * Get the desktop app ready to build.
 *
 * 1. Copy the built web app (`dist/`) into `desktop/dist`, because
 *    electron-builder only packages files inside its own directory.
 * 2. Write `desktop/config.json` with the two addresses the window needs:
 *
 *      PLANNER_APP_URL     load this deployment instead of the bundled copy
 *      PLANNER_API_ORIGIN  where the bundled copy should send `/api/*`
 *
 *    Both are optional. With neither, the desktop app is a fully offline,
 *    local-only Planner — which is the default on purpose.
 *
 * Passing `--clear` writes an empty config, which is how you go back to the
 * bundled, offline build after trying a deployment.
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const webDist = join(root, 'dist');
const desktopDist = join(root, 'desktop', 'dist');
const configFile = join(root, 'desktop', 'config.json');

function clean(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function normalizeUrl(value, label) {
  const cleaned = clean(value);
  if (!cleaned) return '';
  let url;
  try {
    url = new URL(cleaned);
  } catch {
    console.error(`✗ ${label} is not a URL: ${cleaned}`);
    process.exit(1);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    console.error(`✗ ${label} must be http(s): ${cleaned}`);
    process.exit(1);
  }
  if (url.pathname !== '' && url.pathname !== '/') {
    console.error(`✗ ${label} must be an origin with no path: ${cleaned}`);
    process.exit(1);
  }
  return url.origin;
}

if (!existsSync(join(webDist, 'index.html'))) {
  console.error('✗ dist/index.html is missing — run `npm run build` first.');
  process.exit(1);
}

await rm(desktopDist, { recursive: true, force: true });
await mkdir(desktopDist, { recursive: true });
await cp(webDist, desktopDist, { recursive: true });

const clear = process.argv.includes('--clear');
const appUrl = clear ? '' : normalizeUrl(process.env.PLANNER_APP_URL, 'PLANNER_APP_URL');
const apiOrigin = clear ? '' : normalizeUrl(process.env.PLANNER_API_ORIGIN, 'PLANNER_API_ORIGIN');

await writeFile(configFile, `${JSON.stringify({ appUrl, apiOrigin }, null, 2)}\n`);

if (appUrl) {
  console.log(`✓ desktop/dist ← dist (${appUrl})`);
  console.log('  The window will load that deployment, so accounts, sync and AI work as they do in a browser.');
} else if (apiOrigin) {
  console.log(`✓ desktop/dist ← dist (bundled, API at ${apiOrigin})`);
  console.log(`  Add this origin to PLANNER_APP_ORIGINS on the server: app://planner`);
} else {
  console.log('✓ desktop/dist ← dist (bundled, local-only)');
  console.log('  Set PLANNER_APP_URL or PLANNER_API_ORIGIN to let the desktop app sign in and sync.');
}

if (!appUrl && !apiOrigin) {
  console.log('  config.json was written empty: the window loads the copy inside the installer.');
}
