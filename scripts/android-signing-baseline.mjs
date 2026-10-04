import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test-only releases published before a permanent Android key was configured.
 * They used per-run CI debug keys, so they cannot establish an update signer.
 * Keep this allowlist narrow: the first permanent-key release establishes the
 * signer in planner-update.json, and every later release must match that feed.
 *
 * The repository owner confirmed these releases were only installed for their
 * own testing; there are no external installs whose data could be stranded by
 * establishing a new signing lineage.
 */
export const LEGACY_TEST_ANDROID_RELEASE_TAGS = Object.freeze([
  'v1.0.0',
  'v1.0.1',
]);

const legacyTestTags = new Set(LEGACY_TEST_ANDROID_RELEASE_TAGS);

export function androidSigningBaselineTags(releaseTags) {
  return releaseTags.filter((tag) => !legacyTestTags.has(tag));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const releaseTags = process.argv.slice(2);
  const skipped = releaseTags.filter((tag) => legacyTestTags.has(tag));
  if (skipped.length > 0) {
    console.error(
      `::notice title=Skipping legacy test APK signers::Ignoring ${skipped.join(', ')} during initial signing bootstrap; the first permanent-key release establishes the update lineage.`,
    );
  }
  const baselineTags = androidSigningBaselineTags(releaseTags);
  if (baselineTags.length > 0) process.stdout.write(`${baselineTags.join('\n')}\n`);
}
