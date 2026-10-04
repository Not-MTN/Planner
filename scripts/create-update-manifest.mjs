#!/usr/bin/env node
/**
 * Create the stable JSON update feed attached to every public release.
 *
 * The feed deliberately names only the direct-install Android APK and the
 * Windows NSIS installer. Play handles Play-installed Android copies, and iOS
 * updates stay with the App Store; neither is eligible for this sideload feed.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeSha256Fingerprint } from './validate-release-contract.mjs';

export const UPDATE_MANIFEST_NAME = 'planner-update.json';
export const RELEASE_REPOSITORY = 'Not-MTN/Planner';
export const ANDROID_APPLICATION_ID = 'com.notmtn.planner';
export const WINDOWS_APP_ID = 'com.notmtn.planner';
export const ANDROID_APK_NAME = 'app-release.apk';
export const WINDOWS_INSTALLER_NAME = 'Planner-windows.exe';
const MAX_ANDROID_VERSION_CODE = 2_100_000_000;
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  throw new Error(message);
}

function parseInputs(tag, versionCodeValue) {
  const match = STABLE_TAG.exec(String(tag ?? ''));
  if (!match) fail(`Release tag must be vMAJOR.MINOR.PATCH (stable semver); received ${tag || '(empty)'}.`);

  const versionCode = Number(versionCodeValue);
  if (!/^\d+$/.test(String(versionCodeValue ?? '')) || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > MAX_ANDROID_VERSION_CODE) {
    fail(`Android versionCode must be a positive integer no greater than ${MAX_ANDROID_VERSION_CODE}; received ${versionCodeValue || '(empty)'}.`);
  }

  return { tag, version: tag.slice(1), versionCode };
}

async function fileMetadata(filePath) {
  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    fail(`Required release asset is missing: ${filePath}`);
  }
  if (!fileStat.isFile()) fail(`Release asset is not a file: ${filePath}`);

  const hash = createHash('sha256');
  await new Promise((resolvePromise, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolvePromise);
  });
  return { sizeBytes: fileStat.size, sha256: hash.digest('hex') };
}

function assetUrl(tag, fileName) {
  return `https://github.com/${RELEASE_REPOSITORY}/releases/download/${tag}/${fileName}`;
}

/**
 * Build the manifest from the artifacts collected by the Apps workflow.
 * `expectedSigningCertificateSha256` is a non-secret Actions variable pinned
 * to the certificate that owns the Android app identity.
 */
export async function createUpdateManifest({
  artifactsDir,
  tag,
  androidVersionCode,
  expectedSigningCertificateSha256,
}) {
  if (!artifactsDir) fail('An artifacts directory is required.');
  const { version, versionCode } = parseInputs(tag, androidVersionCode);
  const expectedFingerprint = normalizeSha256Fingerprint(expectedSigningCertificateSha256);
  if (!expectedFingerprint) fail('ANDROID_SIGNING_CERT_SHA256 must be a 64-digit SHA-256 certificate fingerprint.');

  const androidFile = join(artifactsDir, ANDROID_APK_NAME);
  const windowsFile = join(artifactsDir, WINDOWS_INSTALLER_NAME);
  const certificateFile = join(artifactsDir, 'meta', 'android-signing-cert-sha256.txt');
  let actualFingerprint;
  try {
    actualFingerprint = normalizeSha256Fingerprint(await readFile(certificateFile, 'utf8'));
  } catch {
    fail(`Android signing fingerprint is missing: ${certificateFile}`);
  }
  if (!actualFingerprint) fail(`Android signing fingerprint is malformed: ${certificateFile}`);
  if (actualFingerprint !== expectedFingerprint) {
    fail('The Android APK signing certificate does not match ANDROID_SIGNING_CERT_SHA256. Refusing to publish an APK that could strand installed copies.');
  }

  const [androidAsset, windowsAsset] = await Promise.all([
    fileMetadata(androidFile),
    fileMetadata(windowsFile),
  ]);
  const manifest = {
    schemaVersion: 1,
    product: 'Planner',
    tag,
    version,
    platforms: {
      android: {
        channel: 'direct-apk',
        applicationId: ANDROID_APPLICATION_ID,
        versionName: version,
        versionCode,
        signingCertificateSha256: actualFingerprint,
        asset: {
          fileName: ANDROID_APK_NAME,
          downloadUrl: assetUrl(tag, ANDROID_APK_NAME),
          ...androidAsset,
        },
      },
      windows: {
        appId: WINDOWS_APP_ID,
        version,
        installer: {
          fileName: WINDOWS_INSTALLER_NAME,
          downloadUrl: assetUrl(tag, WINDOWS_INSTALLER_NAME),
          ...windowsAsset,
        },
      },
    },
  };
  return manifest;
}

export async function writeUpdateManifest(options) {
  const manifest = await createUpdateManifest(options);
  const output = join(options.artifactsDir, UPDATE_MANIFEST_NAME);
  await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return output;
}

async function main(args) {
  const [artifactsDir, tag, androidVersionCode] = args;
  if (!artifactsDir || !tag || !androidVersionCode) {
    fail('Usage: node scripts/create-update-manifest.mjs <artifacts-dir> <vX.Y.Z> <android-version-code>');
  }
  const output = await writeUpdateManifest({
    artifactsDir: resolve(artifactsDir),
    tag,
    androidVersionCode,
    expectedSigningCertificateSha256: process.env.ANDROID_SIGNING_CERT_SHA256,
  });
  console.log(`✓ Created ${output}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n✗ Could not create the update manifest\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
