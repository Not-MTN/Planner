#!/usr/bin/env node
/**
 * Build the web app and hand it to the Android and iOS projects.
 *
 *   npm run native:sync                 bundled, local-only (works with no server)
 *   PLANNER_APP_URL=https://… npm run native:sync
 *                                       the shells load that deployment
 *   PLANNER_API_ORIGIN=https://… npm run native:sync
 *                                       bundled copy, API at that deployment
 *
 * `PLANNER_APP_URL` and `PLANNER_API_ORIGIN` are read by both halves of the
 * build: capacitor.config.ts (where the shell loads or which API it talks to)
 * and vite.config.ts (the API origin baked into the web bundle). Everything
 * about the resulting app is printed at the end, so nobody has to guess which
 * kind of build just landed in android/ and ios/.
 *
 * Pass platform names to sync only those: `npm run native:sync -- android`.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const platforms = requested.length > 0 ? requested : ['android', 'ios'];

for (const platform of platforms) {
  if (!existsSync(join(root, platform))) {
    console.error(`✗ There is no ${platform}/ project. Run: npx cap add ${platform}`);
    process.exit(1);
  }
}

function runStep(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`))));
  });
}

function summarize() {
  const appUrl = (process.env.PLANNER_APP_URL ?? '').trim();
  const apiOrigin = (process.env.PLANNER_API_ORIGIN ?? '').trim();
  // Where a link the app hands out (a guardian's invite QR) has to point, and
  // the domain whose https addresses open the app. Any of the three names
  // answers; the packaged app is served from localhost, so it cannot be its own.
  const linkOrigin = (process.env.PLANNER_LINK_ORIGIN ?? '').trim() || appUrl || apiOrigin;
  console.log('\n── what was built ─────────────────────────────────────────────');
  if (appUrl) {
    console.log(`  the app loads   ${appUrl}`);
    console.log('  accounts, sync and AI come from that deployment, same-origin.');
    console.log('  the device needs the network the first time; after that the');
    console.log('  service worker keeps the app working offline.');
  } else if (apiOrigin) {
    console.log('  the app loads   its own bundled copy (offline, instant start)');
    console.log(`  its API         ${apiOrigin}`);
    console.log(`  on the server   PLANNER_APP_ORIGINS must list https://localhost`);
    console.log('                  (Android) and capacitor://localhost (iOS), or every');
    console.log('                  account and sync request answers 403.');
  } else {
    console.log('  the app loads   its own bundled copy (offline, instant start)');
    console.log('  its API         none — this build is local-only: the planner works,');
    console.log('                  sign-in and sync have nowhere to go.');
    console.log('  to change that  set PLANNER_APP_URL or PLANNER_API_ORIGIN and re-run.');
  }
  if (linkOrigin) {
    console.log(`  its links       ${linkOrigin} — once that domain serves the two`);
    console.log('                  /.well-known files, its links open the app');
    console.log('                  instead of a browser tab (docs/APPS.md §3).');
  } else {
    console.log('  its links       planner:// only — no deployment address to claim.');
  }
  console.log('───────────────────────────────────────────────────────────────\n');
}

try {
  console.log('▸ building the web app');
  await runStep('npm', ['run', 'build']);
  // One platform per call: `cap sync android ios` accepts a single platform
  // and silently ignores the rest, which would leave one shell stale.
  for (const platform of platforms) {
    console.log(`▸ copying it into ${platform}`);
    await runStep('npx', ['cap', 'sync', platform]);
  }
  summarize();
  console.log(`Next: \`npx cap open ${platforms[0]}\` to build and run it, or see docs/APPS.md.`);
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
