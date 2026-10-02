import { describe, expect, it, vi } from 'vitest';
import { currentVersion, dismissedVersion, dismissVersion, findUpdate, isNewer, latestVersion, parseVersion } from './updates';

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
