import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ANDROID_SIGNING_SECRETS,
  assertReleaseContract,
  normalizeSha256Fingerprint,
  releaseContractErrors,
} from './validate-release-contract.mjs';

const fingerprint = '0A:'.repeat(31) + '0A';
const environment = {
  ...Object.fromEntries(ANDROID_SIGNING_SECRETS.map((name) => [name, 'configured'])),
  ANDROID_SIGNING_CERT_SHA256: fingerprint,
};

describe('release contract', () => {
  it('allows a well-formed tagged release with pinned signing identity', () => {
    expect(assertReleaseContract({ tag: 'v2.4.0', runNumber: '37', environment })).toBe('release');
  });

  it('does not require release secrets for a manual build', () => {
    expect(assertReleaseContract({ tag: '', runNumber: '', environment: {} })).toBe('manual');
  });

  it('requires stable three-part tags and a valid increasing-version source', () => {
    expect(releaseContractErrors({ tag: 'v2.4', runNumber: '37', environment }).join('\n')).toContain('vMAJOR.MINOR.PATCH');
    expect(releaseContractErrors({ tag: 'v2.4.0-beta.1', runNumber: '37', environment })).toContainEqual(expect.stringContaining('stable semver'));
    expect(releaseContractErrors({ tag: 'v2.4.0', runNumber: '0', environment })).toContainEqual(expect.stringContaining('versionCode'));
    expect(releaseContractErrors({ tag: 'v2.4.0', runNumber: '2100000001', environment })).toContainEqual(expect.stringContaining('versionCode'));
  });

  it('requires every signing secret and the public certificate pin', () => {
    const errors = releaseContractErrors({ tag: 'v2.4.0', runNumber: '37', environment: {} });
    for (const name of ANDROID_SIGNING_SECRETS) expect(errors.join('\n')).toContain(name);
    expect(errors.join('\n')).toContain('ANDROID_SIGNING_CERT_SHA256');
  });

  it('normalizes colon-separated certificate fingerprints but rejects malformed values', () => {
    expect(normalizeSha256Fingerprint(fingerprint)).toBe('0a'.repeat(32));
    expect(normalizeSha256Fingerprint('aabb')).toBeNull();
    expect(normalizeSha256Fingerprint('zz'.repeat(32))).toBeNull();
  });

  it('keeps sideload install permission out of the Play distribution', () => {
    const mainManifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
    const directManifest = readFileSync(new URL('../android/app/src/direct/AndroidManifest.xml', import.meta.url), 'utf8');
    const build = readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
    const workflow = readFileSync(new URL('../.github/workflows/apps.yml', import.meta.url), 'utf8');

    expect(mainManifest).not.toContain('REQUEST_INSTALL_PACKAGES');
    expect(directManifest).toContain('REQUEST_INSTALL_PACKAGES');
    expect(build).toContain('direct {');
    expect(build).toContain('play {');
    expect(workflow).toContain('assembleDirectRelease bundlePlayRelease');
  });

  it('registers the Android updater and wires the verified APK hand-off', () => {
    const activity = readFileSync(new URL('../android/app/src/main/java/com/notmtn/planner/MainActivity.java', import.meta.url), 'utf8');
    const plugin = readFileSync(new URL('../android/app/src/main/java/com/notmtn/planner/PlannerUpdaterPlugin.java', import.meta.url), 'utf8');
    const paths = readFileSync(new URL('../android/app/src/main/res/xml/file_paths.xml', import.meta.url), 'utf8');

    expect(activity).toContain('registerPlugin(PlannerUpdaterPlugin.class)');
    expect(activity).toContain('reopenAfterSuccessfulUpdate()');
    expect(activity).toContain('pendingVersionCode');
    expect(plugin).toContain('@CapacitorPlugin(name = "PlannerUpdater")');
    expect(plugin).toContain('FileProvider.getUriForFile');
    expect(plugin).toContain('canRequestPackageInstalls()');
    const installFlow = plugin.slice(
      plugin.indexOf('public void installUpdate'),
      plugin.indexOf('@ActivityCallback\n    private void unknownSourcesSettingsResult'),
    );
    expect(installFlow).toContain('executor.execute');
    expect(installFlow).toContain('verifyDownloadedApk(apk, request)');
    expect(installFlow).toContain('activity.runOnUiThread');
    expect(installFlow).toContain('startSystemInstaller(call, request, apk)');
    expect(paths).toContain('planner-updates/');
  });
});
