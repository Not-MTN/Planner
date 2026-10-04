import { describe, expect, it, vi } from 'vitest';
import {
  checkUpdate,
  checkUpdateFromManifest,
  currentVersion,
  dismissedVersion,
  dismissVersion,
  findUpdate,
  isNewer,
  latestVersion,
  parseVersion,
  parseUpdateManifest,
} from './updates';

/**
 * The rule this module exists to keep: an update check may only ever be quiet
 * or correct. A packaged app cannot update itself, so telling someone about a
 * newer release is the whole feature — and a wrong version, a repeated nag or
 * an error where there is simply no network would all be worse than silence.
 */

function storage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  } as unknown as Storage & { map: Map<string, string> };
}

function release(tag: string) {
  return vi.fn(async () => new Response(JSON.stringify({ tag_name: tag }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

describe('parseVersion', () => {
  it('reads the shapes a tag can take', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2')).toEqual([1, 2]);
    expect(parseVersion('1.2.3+build.5')).toEqual([1, 2, 3]);
  });

  it('sorts a pre-release before the release it leads to', () => {
    // 1.2.0-beta is older than 1.2.0, so it must never look like an update.
    expect(isNewer('1.2.0-beta.1', '1.2.0')).toBe(false);
    expect(isNewer('1.2.0', '1.2.0-beta.1')).toBe(true);
  });

  it('refuses what it cannot understand', () => {
    for (const value of ['', 'nightly', 'v', 'one.two.three', undefined, null]) {
      expect(parseVersion(value)).toBeNull();
    }
  });
});

describe('isNewer', () => {
  it('only counts a strictly newer release', () => {
    expect(isNewer('1.0.1', '1.0.0')).toBe(true);
    expect(isNewer('1.1.0', '1.0.9')).toBe(true);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    // The same version built from a tag the release job has not published yet.
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('0.9.0', '1.0.0')).toBe(false);
    // A missing part is zero, so these are the same version.
    expect(isNewer('1.2', '1.2.0')).toBe(false);
    expect(isNewer('1.2.1', '1.2')).toBe(true);
  });

  it('stays quiet when either side is unknown', () => {
    expect(isNewer(undefined, '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '')).toBe(false);
    expect(isNewer('nightly', '1.0.0')).toBe(false);
  });
});

describe('latestVersion', () => {
  it('reads the newest published release', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v1.4.0' }), { status: 200 }));
    await expect(latestVersion(fetcher as unknown as typeof fetch)).resolves.toBe('1.4.0');
  });

  it('ignores drafts and pre-releases', async () => {
    const draft = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v2.0.0', draft: true }), { status: 200 }));
    await expect(latestVersion(draft as unknown as typeof fetch)).resolves.toBeNull();
    const pre = vi.fn(async () => new Response(JSON.stringify({ tag_name: 'v2.0.0', prerelease: true }), { status: 200 }));
    await expect(latestVersion(pre as unknown as typeof fetch)).resolves.toBeNull();
  });

  it('returns null instead of throwing when anything goes wrong', async () => {
    // No network, a rate limit, an HTML error page, a body that is not JSON.
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(latestVersion(offline as unknown as typeof fetch)).resolves.toBeNull();
    const limited = vi.fn(async () => new Response('rate limited', { status: 403 }));
    await expect(latestVersion(limited as unknown as typeof fetch)).resolves.toBeNull();
    const html = vi.fn(async () => new Response('<html>', { status: 200 }));
    await expect(latestVersion(html as unknown as typeof fetch)).resolves.toBeNull();
  });
});

describe('checkUpdate', () => {
  it('distinguishes a confirmed current install from an available update', async () => {
    const current = await checkUpdate({
      fetcher: release(`v${currentVersion()}`) as unknown as typeof fetch,
      storage: storage(),
    });
    expect(current).toEqual({ status: 'current', version: null });

    const available = await checkUpdate({
      fetcher: release('v9.9.9') as unknown as typeof fetch,
      storage: storage(),
    });
    expect(available).toEqual({ status: 'available', version: '9.9.9' });
  });

  it('keeps a dismissed release quiet while retaining its version in startup state', async () => {
    const dismissed = storage({ 'planner-update-dismissed': '9.9.9' });
    await expect(
      checkUpdate({ fetcher: release('v9.9.9') as unknown as typeof fetch, storage: dismissed }),
    ).resolves.toEqual({ status: 'dismissed', version: '9.9.9' });
  });

  it('reports an unknown result instead of calling an unreachable release service current', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(checkUpdate({ fetcher: offline as unknown as typeof fetch, storage: storage() })).resolves.toEqual({
      status: 'unavailable',
      version: null,
    });
  });
});

describe('findUpdate', () => {
  it('reports a newer release', async () => {
    const found = await findUpdate({ fetcher: release('v9.9.9') as unknown as typeof fetch, storage: storage() });
    expect(found).toBe('9.9.9');
  });

  it('says nothing when this build is already the newest', async () => {
    expect(await findUpdate({ fetcher: release(`v${currentVersion()}`) as unknown as typeof fetch, storage: storage() })).toBeNull();
  });

  it('tells the user once per version, not on every launch', async () => {
    const dismissed = storage();
    const fetcher = release('v9.9.9') as unknown as typeof fetch;
    expect(await findUpdate({ fetcher, storage: dismissed })).toBe('9.9.9');
    dismissVersion('9.9.9', dismissed);
    expect(dismissedVersion(dismissed)).toBe('9.9.9');
    // Same release, next launch: quiet.
    expect(await findUpdate({ fetcher, storage: dismissed })).toBeNull();
    // A newer one still gets through.
    expect(await findUpdate({ fetcher: release('v9.9.10') as unknown as typeof fetch, storage: dismissed })).toBe('9.9.10');
  });

  it('cannot be broken by a fetch that fails', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(findUpdate({ fetcher: offline as unknown as typeof fetch, storage: storage() })).resolves.toBeNull();
  });
});

describe('currentVersion', () => {
  it('is the version this build was made from', () => {
    // vite.config.ts defines this from PLANNER_VERSION_NAME, or package.json.
    expect(currentVersion()).toMatch(/^\d+\.\d+/);
  });
});

const SIGNER = 'ab'.repeat(32);
const APK_HASH = 'cd'.repeat(32);
const WINDOWS_HASH = 'ef'.repeat(32);

function updateManifest(version = '1.0.1', versionCode = 2) {
  const tag = `v${version}`;
  return {
    schemaVersion: 1,
    product: 'Planner',
    tag,
    version,
    platforms: {
      android: {
        channel: 'direct-apk',
        applicationId: 'com.notmtn.planner',
        versionName: version,
        versionCode,
        signingCertificateSha256: SIGNER,
        asset: {
          fileName: 'app-release.apk',
          downloadUrl: `https://github.com/Not-MTN/Planner/releases/download/${tag}/app-release.apk`,
          sizeBytes: 1024,
          sha256: APK_HASH,
        },
      },
      windows: {
        appId: 'com.notmtn.planner',
        version,
        installer: {
          fileName: 'Planner-windows.exe',
          downloadUrl: `https://github.com/Not-MTN/Planner/releases/download/${tag}/Planner-windows.exe`,
          sizeBytes: 2048,
          sha256: WINDOWS_HASH,
        },
      },
    },
  };
}

function installedAndroid(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: 'com.notmtn.planner',
    versionName: '1.0.0',
    versionCode: 1,
    signingCertificateSha256: SIGNER,
    installerPackageName: 'com.android.chrome',
    ...overrides,
  };
}

describe('planner-update.json validation', () => {
  it('accepts only the stable release assets with the fixed package identities and checksums', () => {
    expect(parseUpdateManifest(updateManifest())).toMatchObject({
      version: '1.0.1',
      android: {
        platform: 'android',
        versionCode: 2,
        signingCertificateSha256: SIGNER,
        downloadUrl: 'https://github.com/Not-MTN/Planner/releases/download/v1.0.1/app-release.apk',
      },
      windows: {
        platform: 'windows',
        appId: 'com.notmtn.planner',
        downloadUrl: 'https://github.com/Not-MTN/Planner/releases/download/v1.0.1/Planner-windows.exe',
      },
    });
  });

  it('rejects changed IDs, malformed hashes, oversized assets and redirected URLs', () => {
    const badId = structuredClone(updateManifest()) as { platforms: { android: { applicationId: string } } };
    badId.platforms.android.applicationId = 'com.other.planner';
    expect(parseUpdateManifest(badId)).toBeNull();

    const badHash = structuredClone(updateManifest()) as { platforms: { windows: { installer: { sha256: string } } } };
    badHash.platforms.windows.installer.sha256 = 'not-a-hash';
    expect(parseUpdateManifest(badHash)).toBeNull();

    const tooLarge = structuredClone(updateManifest()) as { platforms: { android: { asset: { sizeBytes: number } } } };
    tooLarge.platforms.android.asset.sizeBytes = 512 * 1024 * 1024 + 1;
    expect(parseUpdateManifest(tooLarge)).toBeNull();

    const outsideHost = structuredClone(updateManifest()) as { platforms: { windows: { installer: { downloadUrl: string } } } };
    outsideHost.platforms.windows.installer.downloadUrl = 'https://example.com/Planner-windows.exe';
    expect(parseUpdateManifest(outsideHost)).toBeNull();
  });
});

describe('platform update eligibility', () => {
  it('offers Android only when package, signer, semver and versionCode all allow an in-place update', () => {
    const manifest = updateManifest();
    expect(checkUpdateFromManifest({
      platform: 'android',
      installedVersion: '1.0.0',
      installedAndroid: installedAndroid(),
      manifest,
      storage: storage(),
    })).toMatchObject({ status: 'available', version: '1.0.1', offer: { platform: 'android', versionCode: 2 } });

    expect(checkUpdateFromManifest({
      platform: 'android',
      installedVersion: '1.0.0',
      installedAndroid: installedAndroid({ installerPackageName: 'com.android.vending' }),
      manifest,
      storage: storage(),
    })).toMatchObject({ status: 'not-applicable', reason: 'store-managed' });

    expect(checkUpdateFromManifest({
      platform: 'android',
      installedVersion: '1.0.0',
      installedAndroid: installedAndroid({ signingCertificateSha256: 'ff'.repeat(32) }),
      manifest,
      storage: storage(),
    })).toMatchObject({ status: 'not-applicable', reason: 'signing-mismatch' });

    expect(checkUpdateFromManifest({
      platform: 'android',
      installedVersion: '1.0.0',
      installedAndroid: installedAndroid({ versionCode: 2 }),
      manifest,
      storage: storage(),
    }).status).toBe('unavailable');

    expect(checkUpdateFromManifest({
      platform: 'android',
      installedVersion: '1.0.0',
      installedAndroid: installedAndroid(),
      manifest,
      storage: storage({ 'planner-update-dismissed': '1.0.1' }),
      ignoreDismissal: true,
    })).toMatchObject({ status: 'available', version: '1.0.1' });
  });

  it('offers the Windows installer, stays quiet for current versions and persists dismissal', () => {
    const manifest = updateManifest();
    expect(checkUpdateFromManifest({ platform: 'windows', installedVersion: '1.0.0', manifest, storage: storage() }))
      .toMatchObject({ status: 'available', version: '1.0.1', offer: { platform: 'windows', fileName: 'Planner-windows.exe' } });
    expect(checkUpdateFromManifest({ platform: 'windows', installedVersion: '1.0.1', manifest, storage: storage() }))
      .toMatchObject({ status: 'current', version: null });
    expect(checkUpdateFromManifest({
      platform: 'windows',
      installedVersion: '1.0.0',
      manifest,
      storage: storage({ 'planner-update-dismissed': '1.0.1' }),
    })).toMatchObject({ status: 'dismissed', version: '1.0.1' });
  });
});
