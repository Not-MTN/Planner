#!/usr/bin/env node
/**
 * Fail early when a public release could not replace the app already installed.
 *
 * A version tag must be stable semver, the Android package and Windows app ID
 * are permanent, Android needs one persistent signing key, and its public
 * certificate fingerprint is pinned as an Actions variable. Manual builds on
 * branches remain usable with the debug key; tagged releases never do.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANDROID_APPLICATION_ID = 'com.notmtn.planner';
export const WINDOWS_APP_ID = 'com.notmtn.planner';
export const ANDROID_SIGNING_SECRETS = [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** Convert a colon-separated or plain SHA-256 fingerprint to lowercase hex. */
export function normalizeSha256Fingerprint(value) {
  const fingerprint = String(value ?? '').trim().replaceAll(':', '').replaceAll(/\s/g, '');
  return /^[0-9a-f]{64}$/i.test(fingerprint) ? fingerprint.toLowerCase() : null;
}

function readText(repoRoot, path, errors) {
  try {
    return readFileSync(join(repoRoot, path), 'utf8');
  } catch {
    errors.push(`Required project identity file is missing: ${path}`);
    return '';
  }
}

function checkFixedIdentity({ repoRoot, errors }) {
  const android = readText(repoRoot, 'android/app/build.gradle', errors);
  const androidId = /\bapplicationId\s+["']([^"']+)["']/.exec(android)?.[1];
  if (!androidId) errors.push('Could not read Android applicationId from android/app/build.gradle.');
  else if (androidId !== ANDROID_APPLICATION_ID) {
    errors.push(`Android applicationId changed from ${ANDROID_APPLICATION_ID} to ${androidId}; installed apps would not update in place.`);
  }

  const desktop = readText(repoRoot, 'desktop/electron-builder.yml', errors);
  const desktopId = /^appId:\s*([^\s#]+)/m.exec(desktop)?.[1];
  if (!desktopId) errors.push('Could not read desktop appId from desktop/electron-builder.yml.');
  else if (desktopId !== WINDOWS_APP_ID) {
    errors.push(`Windows appId changed from ${WINDOWS_APP_ID} to ${desktopId}; installed apps would not update in place.`);
  }

  if (!/^\s*deleteAppDataOnUninstall:\s*false\s*$/m.test(desktop)) {
    errors.push('desktop/electron-builder.yml must keep nsis.deleteAppDataOnUninstall set to false.');
  }
}

/**
 * Return all release-contract problems without printing values from secrets.
 * Empty `tag` means an ordinary workflow_dispatch build, not a public release.
 */
export function releaseContractErrors({
  tag = '',
  runNumber = '',
  environment = process.env,
  repoRoot = root,
} = {}) {
  const errors = [];
  checkFixedIdentity({ repoRoot, errors });

  if (!tag) return errors;

  const versionMatch = STABLE_TAG.exec(tag);
  if (!versionMatch) {
    errors.push(`Release tag must be vMAJOR.MINOR.PATCH (stable semver), not ${tag}.`);
  }

  const versionCode = Number(runNumber);
  if (!/^\d+$/.test(String(runNumber)) || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_ANDROID_VERSION_CODE) {
    errors.push(`Android versionCode must be a positive integer no greater than ${MAX_ANDROID_VERSION_CODE}; received ${runNumber || '(empty)'}.`);
  }

  const missingSecrets = ANDROID_SIGNING_SECRETS.filter((name) => !String(environment[name] ?? '').trim());
  if (missingSecrets.length > 0) {
    errors.push(`Tagged releases require these repository secrets: ${missingSecrets.join(', ')}.`);
  }

  if (!normalizeSha256Fingerprint(environment.ANDROID_SIGNING_CERT_SHA256)) {
    errors.push('Tagged releases require the Actions variable ANDROID_SIGNING_CERT_SHA256 (the SHA-256 fingerprint printed by npm run android:keystore).');
  }

  return errors;
}

export function assertReleaseContract(options = {}) {
  const errors = releaseContractErrors(options);
  if (errors.length > 0) throw new Error(errors.map((error) => `- ${error}`).join('\n'));
  return options.tag ? 'release' : 'manual';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const tag = process.env.PLANNER_RELEASE_TAG ?? '';
  const runNumber = process.env.PLANNER_RUN_NUMBER ?? '';
  try {
    const type = assertReleaseContract({ tag, runNumber });
    if (type === 'release') {
      console.log(`✓ ${tag} has a stable install identity and a pinned Android signing key.`);
      console.log('  Android data stays in place because the package name and signing certificate are stable.');
      console.log('  Windows data stays in place because the app ID is stable and NSIS preserves app data.');
    } else {
      console.log('✓ Manual build: public-release signing checks are not required.');
    }
  } catch (error) {
    console.error(`\n✗ Release contract failed\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
