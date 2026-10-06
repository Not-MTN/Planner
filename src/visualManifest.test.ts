/**
 * The visual manifest is a second list of the same thing the spec contains, so
 * something has to hold the two together.
 *
 * `e2e/visual-snapshots.json` exists because CI needs to know whether any
 * baseline is missing *before* running Playwright (see
 * `scripts/check-visual-baselines.mjs`). A hand-maintained copy would drift the
 * first time somebody added a screenshot in a hurry, and the symptom would be a
 * red visual run whose only fix is to regenerate everything — exactly the
 * accident the manifest is meant to prevent.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTRA_SHOTS, allShotNames } from '../e2e/visual-shots';

const root = join(__dirname, '..');

const specSource = readFileSync(join(root, 'e2e', 'visual.spec.ts'), 'utf8');

/** Every screenshot the spec really takes, from the shared name list. */
function specNames(): string[] {
  return allShotNames().sort();
}

/** The names the spec writes literally, e.g. `shoot(page, shot('…'))`. */
function literalSpecNames(): string[] {
  return [...specSource.matchAll(/shot\('([^']+)'\)/g)].map((match) => match[1]);
}

function manifestNames(): string[] {
  const manifest = JSON.parse(readFileSync(join(root, 'e2e', 'visual-snapshots.json'), 'utf8')) as Record<string, boolean>;
  return Object.keys(manifest).sort();
}

describe('the visual snapshot manifest', () => {
  it('lists exactly the screenshots the spec takes', () => {
    expect(manifestNames()).toEqual(specNames());
  });

  it('lists every screenshot the spec actually writes', () => {
    // The matrix names come from the same constant the spec loops over, so the
    // one thing worth checking is that each hand-written shot in the spec is
    // listed — a deleted test with a leftover manifest entry, or the reverse.
    expect([...literalSpecNames()].sort()).toEqual([...EXTRA_SHOTS].sort());
    expect(specSource).toContain('matrixShot(view.name, language, theme)');
  });

  it('is not empty, and every entry is a PNG name', () => {
    const names = manifestNames();
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) expect(name).toMatch(/^[a-z0-9-]+\.png$/i);
  });
});
