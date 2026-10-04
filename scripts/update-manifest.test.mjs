import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ANDROID_APK_NAME,
  UPDATE_MANIFEST_NAME,
  WINDOWS_INSTALLER_NAME,
  createUpdateManifest,
  writeUpdateManifest,
} from './create-update-manifest.mjs';

const certificate = 'ab'.repeat(32);
const expectedFingerprint = certificate.toUpperCase().match(/.{2}/g).join(':');
let artifactsDir;

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function putArtifacts({ android = 'test apk bytes', windows = 'test installer bytes' } = {}) {
  await mkdir(join(artifactsDir, 'meta'), { recursive: true });
  await writeFile(join(artifactsDir, ANDROID_APK_NAME), android);
  await writeFile(join(artifactsDir, WINDOWS_INSTALLER_NAME), windows);
  await writeFile(join(artifactsDir, 'meta', 'android-signing-cert-sha256.txt'), certificate);
}

beforeEach(async () => {
  artifactsDir = await mkdtemp(join(tmpdir(), 'planner-release-'));
  await putArtifacts();
});

afterEach(async () => {
  await rm(artifactsDir, { recursive: true, force: true });
});

describe('release update manifest', () => {
  it('records stable package identities, exact release URLs, versions and file hashes', async () => {
    const manifest = await createUpdateManifest({
      artifactsDir,
      tag: 'v2.4.0',
      androidVersionCode: '37',
      expectedSigningCertificateSha256: expectedFingerprint,
    });

    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.tag).toBe('v2.4.0');
    expect(manifest.version).toBe('2.4.0');
    expect(manifest.platforms.android).toMatchObject({
      channel: 'direct-apk',
      applicationId: 'com.notmtn.planner',
      versionName: '2.4.0',
      versionCode: 37,
      signingCertificateSha256: certificate,
      asset: {
        fileName: 'app-release.apk',
        downloadUrl: 'https://github.com/Not-MTN/Planner/releases/download/v2.4.0/app-release.apk',
        sha256: hash('test apk bytes'),
        sizeBytes: Buffer.byteLength('test apk bytes'),
      },
    });
    expect(manifest.platforms.windows).toMatchObject({
      appId: 'com.notmtn.planner',
      version: '2.4.0',
      installer: {
        fileName: 'Planner-windows.exe',
        downloadUrl: 'https://github.com/Not-MTN/Planner/releases/download/v2.4.0/Planner-windows.exe',
        sha256: hash('test installer bytes'),
        sizeBytes: Buffer.byteLength('test installer bytes'),
      },
    });
  });

  it('writes the stable manifest asset name as formatted JSON', async () => {
    const file = await writeUpdateManifest({
      artifactsDir,
      tag: 'v2.4.0',
      androidVersionCode: '37',
      expectedSigningCertificateSha256: expectedFingerprint,
    });
    expect(file).toBe(join(artifactsDir, UPDATE_MANIFEST_NAME));
    const saved = JSON.parse(await readFile(file, 'utf8'));
    expect(saved.version).toBe('2.4.0');
  });

  it('publishes the APK certificate even when the Actions pin disagrees', async () => {
    await writeFile(join(artifactsDir, 'meta', 'android-signing-cert-sha256.txt'), 'ff'.repeat(32));
    const manifest = await createUpdateManifest({
      artifactsDir,
      tag: 'v2.4.0',
      androidVersionCode: '37',
      expectedSigningCertificateSha256: expectedFingerprint,
    });
    expect(manifest.platforms.android.signingCertificateSha256).toBe('ff'.repeat(32));
  });

  it('refuses incomplete assets, invalid tags and invalid version codes', async () => {
    await expect(createUpdateManifest({
      artifactsDir,
      tag: 'v2.4.0-beta.1',
      androidVersionCode: '37',
      expectedSigningCertificateSha256: expectedFingerprint,
    })).rejects.toThrow(/stable semver/);
    await expect(createUpdateManifest({
      artifactsDir,
      tag: 'v2.4.0',
      androidVersionCode: '0',
      expectedSigningCertificateSha256: expectedFingerprint,
    })).rejects.toThrow(/versionCode/);
    await rm(join(artifactsDir, WINDOWS_INSTALLER_NAME));
    await expect(createUpdateManifest({
      artifactsDir,
      tag: 'v2.4.0',
      androidVersionCode: '37',
      expectedSigningCertificateSha256: expectedFingerprint,
    })).rejects.toThrow(/Required release asset is missing/);
  });
});
