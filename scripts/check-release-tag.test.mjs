import { describe, expect, it } from 'vitest';
import { releaseTagKind, suggestedReleaseTag } from './check-release-tag.mjs';

describe('release tag names', () => {
  it('accepts the one shape that builds and publishes', () => {
    expect(releaseTagKind('v1.2.0')).toBe('release');
    expect(releaseTagKind('v1.1.2')).toBe('release');
    expect(releaseTagKind('v10.20.30')).toBe('release');
    expect(releaseTagKind(' v1.2.0 ')).toBe('release');
  });

  it('catches a version pushed without its v — the tag that builds nothing', () => {
    for (const tag of ['1.1.2', '1.1', '10.20.30', 'release-1.1.2', 'RELEASE_2.0.0', '1.1.2-rc1', 'V2.0.0']) {
      expect(releaseTagKind(tag), tag).toBe('mistyped');
    }
  });

  it('suggests the v-prefixed tag the release was meant to use', () => {
    expect(suggestedReleaseTag('1.1.2')).toBe('v1.1.2');
    expect(suggestedReleaseTag('release-1.1.2')).toBe('v1.1.2');
    expect(suggestedReleaseTag('v.2.0.0')).toBe('v2.0.0');
    expect(suggestedReleaseTag('version_10.0.1')).toBe('v10.0.1');
  });

  it('leaves the Apps workflow to refuse malformed v tags loudly', () => {
    // `tags: ['v*']` matches these, so an Apps run starts and its release
    // contract check fails it — the guard only says so, nothing more is needed.
    expect(releaseTagKind('v1.2')).toBe('contract-rejects');
    expect(releaseTagKind('v2.0.0-rc.1')).toBe('contract-rejects');
    expect(releaseTagKind('v.1.1.2')).toBe('contract-rejects');
  });

  it('reports any tag starting with a lowercase v as an Apps run, whatever follows', () => {
    // The filter is a glob on the first letter, so a tag that merely begins
    // with `v` still starts a build that then publishes nothing.
    expect(releaseTagKind('visual-baselines')).toBe('contract-rejects');
    expect(releaseTagKind('version_2.0.0')).toBe('contract-rejects');
    expect(releaseTagKind('vnext')).toBe('contract-rejects');
  });

  it('does not call tags that are not versions a release attempt', () => {
    for (const tag of ['snapshot', '2026', 'design-board-render-fixes', 'release-candidate', 'dependabot/npm_and_yarn/vite-8.3.2']) {
      expect(releaseTagKind(tag), tag).toBe('unrelated');
    }
  });

  it('reports a missing tag instead of guessing', () => {
    expect(releaseTagKind('')).toBe('missing');
    expect(releaseTagKind('   ')).toBe('missing');
    expect(releaseTagKind(undefined)).toBe('missing');
  });
});
