#!/usr/bin/env node
/**
 * Does every screenshot the visual suite takes have a committed baseline?
 *
 *   npm run check:visual-baselines
 *
 * Why this exists: Playwright writes a missing baseline and then fails the
 * test. That is the right behaviour for a laptop, where the answer is "look at
 * the picture and commit it", and the wrong behaviour in CI, where nobody can
 * look at anything — a run would go red for a picture that was never going to
 * exist, and the fix would be to run the whole suite with `--update-snapshots`,
 * which can also quietly rewrite baselines nobody meant to change.
 *
 * So the workflow asks this script first. It exits 1 when any expected picture
 * is missing, which is the signal to generate *and commit* a fresh set once;
 * after that, the suite compares against real references and a mismatch is a
 * real failure.
 *
 * The expected names live in `e2e/visual-snapshots.json` and a unit test
 * (`src/visualManifest.test.ts`) keeps that file in step with the spec, so
 * adding a screenshot without listing it fails on the laptop where the person
 * adding it can do something about it.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'e2e', 'visual-snapshots.json');
const snapshotsDir = join(root, 'e2e', 'visual.spec.ts-snapshots');

let expected;
try {
  expected = Object.keys(JSON.parse(readFileSync(manifestPath, 'utf8')));
} catch (error) {
  console.error(`✗ Could not read ${manifestPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (expected.length === 0) {
  console.error('✗ The visual manifest is empty, which would make this check meaningless.');
  process.exit(2);
}

// Playwright names a file `<name>-<project>-<platform>.png`, so a baseline
// "exists" when some file starts with the expected name.
const files = existsSync(snapshotsDir) ? readdirSync(snapshotsDir) : [];
const missing = expected.filter((name) => !files.some((file) => file.startsWith(name.replace(/\.png$/, ''))));

if (missing.length > 0) {
  console.log(`Planner has no baseline yet for ${missing.length} of ${expected.length} screenshots:`);
  for (const name of missing) console.log(`  · ${name}`);
  console.log('');
  console.log('The Visual regression workflow regenerates and commits the set when it sees this.');
  process.exit(1);
}

// A baseline nobody's test produces is dead weight and, worse, a picture that
// will never be compared again — usually a screenshot that was renamed.
const orphans = files.filter(
  (file) => file.endsWith('.png') && !expected.some((name) => file.startsWith(name.replace(/\.png$/, ''))),
);
if (orphans.length > 0) {
  console.log(`Orphaned baselines (no test produces them): ${orphans.join(', ')}`);
  console.log('Delete them, or list the screenshot in e2e/visual-snapshots.json.');
  process.exit(1);
}

console.log(`✓ All ${expected.length} visual baselines are present.`);
