#!/usr/bin/env node
/**
 * Say what a pushed tag actually does.
 *
 * A release is a tag — but only a `v*` tag starts the workflow that builds and
 * publishes it (`apps.yml`, `on.push.tags: ['v*']`). Any other name starts no
 * build at all, so a version typed without its `v` fails the quietest way a
 * release can: every check is green, the run list shows a tag push that ran
 * Security checks and nothing else, and no release ever appears. `1.1.2` was
 * pushed that way; the release that should have followed it did not exist.
 *
 *   npm run check:release-tag -- 1.1.2
 *   node scripts/check-release-tag.mjs "$GITHUB_REF_NAME"
 *
 * Exit codes:
 *   0  a tag that releases (`v1.2.0`), or one that is not a release tag at all
 *   1  a version-like tag that cannot release anything — the mistake above
 *   2  no tag to check (the argument is missing)
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The one shape the release contract accepts and the Apps workflow watches. */
const RELEASE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * A version written without its `v`: `1.1.2`, `1.1`, `release-1.1.2`,
 * `1.1.2-rc1`. A dot is required, so a plain number (`2026`) or a word
 * (`snapshot`) is not mistaken for a version — those tags are not release
 * attempts and this check has nothing to say about them.
 *
 * Only reached for tags that do not start with `v`, because that letter is
 * what the Apps workflow filters on and such a tag is reported as whatever the
 * workflow will do with it (`version_2.0.0` and `visual-baselines` both start
 * with `v` and so both start an Apps run).
 */
const VERSION_WITHOUT_V = /^(?:(?:release|rel|version|ver)[-/_ ]?)?v?\.?\d+\.\d+(?:\.\d+)*(?:[-+][0-9a-z.-]*)?$/i;

/**
 * Classify a tag by what its push does. The Apps workflow watches `v*`, so a
 * leading `v` decides between the first two answers whatever follows it:
 *
 *   release            builds and publishes
 *   contract-rejects   starts the Apps workflow, which stops at its release
 *                      contract check (stable three-part semver is required)
 *   mistyped           looks like a version, matches no workflow: nothing is
 *                      built or published, and nothing upstream ever notices
 *   unrelated          not a release tag; no workflow acts on it
 */
export function releaseTagKind(rawTag) {
  const tag = String(rawTag ?? '').trim();
  if (!tag) return 'missing';
  if (/^v/.test(tag)) return RELEASE_TAG.test(tag) ? 'release' : 'contract-rejects';
  return VERSION_WITHOUT_V.test(tag) ? 'mistyped' : 'unrelated';
}

/** The tag somebody almost certainly meant, when they left the `v` off. */
export function suggestedReleaseTag(tag) {
  const version = String(tag).trim().replace(/^(?:(?:release|rel|version|ver)[-/_ ]?)+/i, '').replace(/^v?\.?/i, '');
  return `v${version}`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const tag = process.argv[2] ?? process.env.GITHUB_REF_NAME ?? '';
  const kind = releaseTagKind(tag);
  const inActions = process.env.GITHUB_ACTIONS === 'true';
  const annotate = (level, title, message) => {
    if (inActions) console.log(`::${level} title=${title}::${message}`);
  };

  switch (kind) {
    case 'missing':
      console.error('✗ No tag to check. Pass one: node scripts/check-release-tag.mjs v1.2.0');
      process.exitCode = 2;
      break;
    case 'release':
      console.log(`✓ ${tag} starts the Apps workflow: the desktop installers, the signed APK and Play bundle, the unsigned iOS archive, and the release they are attached to.`);
      annotate('notice', 'This tag releases', `${tag} builds and publishes. Hand the release notes a read when the workflow finishes.`);
      break;
    case 'contract-rejects':
      console.log(`• ${tag} starts the Apps workflow, which stops at its release contract check: a release tag is vMAJOR.MINOR.PATCH (stable semver), so nothing is published under this name.`);
      annotate('notice', 'This tag will be refused', `${tag} matches the Apps workflow but not the release contract (vMAJOR.MINOR.PATCH, stable semver). Nothing will be published.`);
      break;
    case 'mistyped': {
      const corrected = suggestedReleaseTag(tag);
      console.error([
        `✗ Tag ${tag} cannot release anything.`,
        '',
        '  Releases are built by the Apps workflow, which runs on `v*` tags only',
        '  (.github/workflows/apps.yml). This name matches no workflow, so the push',
        '  built nothing: the version bump and every green check are all upstream of',
        '  the part that publishes, and no release appears.',
        '',
        `  To release the commit this tag points at (${corrected}):`,
        '',
        `      git tag ${corrected} <the commit ${tag} points at> && git push origin ${corrected}`,
        `      git push origin :refs/tags/${tag}`,
        '',
        `  A release tag has exactly one shape, and ${corrected} is it when the version`,
        '  is three stable parts. If this tag was not a release attempt, name it',
        '  something that is not a version.',
      ].join('\n'));
      annotate('error', 'This tag releases nothing', `${tag} matches no workflow: releases only build on v* tags (vMAJOR.MINOR.PATCH). Push ${corrected} at the same commit to release the commit, then delete ${tag}.`);
      process.exitCode = 1;
      break;
    }
    default:
      console.log(`• ${tag} is not a release tag: no workflow builds or publishes on it. Releases are tagged vMAJOR.MINOR.PATCH.`);
      break;
  }
}
