/**
 * "Is there a newer Planner than the one I am running?"
 *
 * The installed apps carry a copy of the planner inside them, so the service
 * worker update prompt the web app shows can never fire in a shell — the code
 * cannot change under it. The only honest thing to do is compare the version
 * this build was made from with the newest published release and, when the
 * release is newer, say so and offer the download.
 *
 * Everything here is deliberately quiet:
 *
 * - a failed check is not an error. No network, a blocked request, a rate
 *   limit, a malformed answer — all of them mean "we do not know", which is
 *   not something to interrupt anybody about. This app works offline; an
 *   update check that complains about the network when there is none would be
 *   worse than no check at all.
 * - the user is told once per version. Dismissing 1.2.0 keeps it quiet until
 *   1.3.0 exists, rather than on every launch.
 * - only a strictly newer release counts. A build made from a tag the release
 *   job has not published yet must not look like an update to itself.
 */

/** This build's version, defined by vite.config.ts from PLANNER_VERSION_NAME. */
declare const __APP_VERSION__: string;

export const RELEASES_API = 'https://api.github.com/repos/Not-MTN/Planner/releases/latest';
export const RELEASES_PAGE = 'https://github.com/Not-MTN/Planner/releases/latest';

/** Where "there is a newer version" was last dismissed. */
const DISMISSED_KEY = 'planner-update-dismissed';

/** `v1.2.3`, `1.2.3`, `1.2.3-beta.1` → `[1,2,3,'beta.1']`. Null if unusable. */
export function parseVersion(value: string | undefined | null): number[] | null {
  const cleaned = (value ?? '').trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const core = cleaned.split('+')[0];
  const [numbers, ...rest] = core.split('-');
  const parts = numbers.split('.');
  if (parts.some((part) => !/^\d+$/.test(part))) return null;
  const parsed = parts.map((part) => Number(part));
  // A hyphen means a pre-release, which sorts before the release it leads to:
  // 1.2.0-beta is older than 1.2.0, so it must not read as an update.
  return rest.length > 0 ? [...parsed, -1] : parsed;
}

/** Is `candidate` a newer release than `current`? False when either is unknown. */
export function isNewer(candidate: string | undefined | null, current: string | undefined | null): boolean {
  const next = parseVersion(candidate);
  const now = parseVersion(current);
  if (!next || !now) return false;
  const length = Math.max(next.length, now.length);
  for (let index = 0; index < length; index += 1) {
    // A missing part is zero: 1.2 and 1.2.0 are the same version.
    const a = next[index] ?? 0;
    const b = now[index] ?? 0;
    if (a !== b) return a > b;
  }
  return false;
}

/** The version this build was made from. Empty when the build did not say. */
export function currentVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
}

/** The newest published release's version, or null when it cannot be read. */
export async function latestVersion(fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const response = await fetcher(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { tag_name?: unknown; prerelease?: unknown; draft?: unknown };
    // A draft or pre-release is not something to send people to.
    if (body.draft === true || body.prerelease === true) return null;
    if (typeof body.tag_name !== 'string') return null;
    return parseVersion(body.tag_name) ? body.tag_name.replace(/^v/i, '') : null;
  } catch {
    return null;
  }
}

/** The version the reader has already waved away, if any. */
export function dismissedVersion(storage: Pick<Storage, 'getItem'> = localStorage): string {
  try {
    return storage.getItem(DISMISSED_KEY) ?? '';
  } catch {
    return '';
  }
}

export function dismissVersion(version: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(DISMISSED_KEY, version);
  } catch {
    /* a browser that cannot remember is not a reason to fail */
  }
}

/**
 * The newer version to tell the user about, or null to stay silent.
 * Never throws: an update check that can break the app is not worth having.
 */
export async function findUpdate(options: { fetcher?: typeof fetch; storage?: Storage } = {}): Promise<string | null> {
  const current = currentVersion();
  if (!current) return null;
  const latest = await latestVersion(options.fetcher ?? fetch);
  if (!latest || !isNewer(latest, current)) return null;
  if (dismissedVersion(options.storage ?? localStorage) === latest) return null;
  return latest;
}
