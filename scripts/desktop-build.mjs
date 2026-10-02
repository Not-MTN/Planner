#!/usr/bin/env node
/**
 * Build the desktop app end to end:
 *
 *   1. `vite build` — with PLANNER_API_ORIGIN baked in when it is set, so the
 *      bundled copy knows where its `/api/*` lives.
 *   2. copy dist → desktop/dist and write desktop/config.json.
 *   3. hand off to electron-builder (or, with --run, just start the app).
 *
 * Usage (from the repository root):
 *
 *   npm run desktop:dev                 build and start, bundled and local-only
 *   PLANNER_APP_URL=https://… npm run desktop:dist
 *   PLANNER_API_ORIGIN=https://… npm run desktop:dist:win
 *
 * Extra arguments are passed to electron-builder, so `--win`, `--mac`,
 * `--linux`, `--dir` and friends all work.
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const args = process.argv.slice(2);
const run = args.includes('--run');
const forwarded = args.filter((arg) => arg !== '--run');

function runStep(command, commandArgs, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
  });
}

try {
  console.log('▸ building the web app');
  await runStep('npm', ['run', 'build']);

  console.log('▸ preparing desktop/dist');
  await runStep('node', [join(here, 'desktop-prepare.mjs')]);

  if (run) {
    console.log('▸ starting the desktop app');
    await runStep('npm', ['--prefix', 'desktop', 'run', 'start']);
  } else {
    console.log('▸ packaging installers');
    await runStep('npm', ['--prefix', 'desktop', 'run', 'dist', '--', ...forwarded]);
    console.log('\n✓ Installers are in desktop/release/');
  }
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
