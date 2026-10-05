import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ANDROID_FILE,
  APPLE_FILE,
  DEFAULT_APP_ID,
  WELL_KNOWN_DIR,
  appSiteAssociation,
  assetLinks,
  normalizeFingerprint,
  normalizeFingerprints,
  normalizeHost,
  normalizeTeamId,
} from './deep-link-files.mjs';

const RELEASE = '1F:2A:3B:4C:5D:6E:7F:80:91:A2:B3:C4:D5:E6:F7:08:19:2A:3B:4C:5D:6E:7F:80:91:A2:B3:C4:D5:E6:F7:08';
const DEBUG = 'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99';

const script = new URL('./deep-link-files.mjs', import.meta.url).pathname;
const made = [];

function run(env) {
  const dir = mkdtempSync(join(tmpdir(), 'planner-links-'));
  made.push(dir);
  const result = spawnSync(process.execPath, [script, '--dir', dir], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });
  return { ...result, dir };
}

afterEach(() => {
  while (made.length > 0) rmSync(made.pop(), { recursive: true, force: true });
});

describe('the fingerprints Android compares', () => {
  it('accepts a fingerprint however it was written, and writes one form', () => {
    expect(normalizeFingerprint(RELEASE)).toBe(RELEASE);
    expect(normalizeFingerprint(RELEASE.replace(/:/g, ''))).toBe(RELEASE);
    expect(normalizeFingerprint(RELEASE.toLowerCase())).toBe(RELEASE);
    expect(normalizeFingerprint('  ' + RELEASE.replace(/:/g, ' ') + ' ')).toBe(RELEASE);
  });

  it('refuses anything that is not a SHA-256 certificate digest', () => {
    // A truncated paste, a signature (not a certificate) or a fingerprint for
    // another key would silently make the file do nothing, so none is written.
    expect(normalizeFingerprint('')).toBe('');
    expect(normalizeFingerprint('1F:2A:3B')).toBe('');
    expect(normalizeFingerprint(RELEASE.replace(/../, 'ZZ'))).toBe('');
    expect(normalizeFingerprints('nonsense')).toEqual([]);
  });

  it('keeps a release and a debug certificate side by side', () => {
    expect(normalizeFingerprints(`${RELEASE}, ${DEBUG}`)).toEqual([RELEASE, DEBUG]);
  });
});

describe('the host the files describe', () => {
  it('reads a bare host or a full address', () => {
    expect(normalizeHost('app.example.com')).toBe('app.example.com');
    expect(normalizeHost('https://app.example.com/')).toBe('app.example.com');
    expect(normalizeHost('https://app.example.com:8443')).toBe('app.example.com:8443');
  });

  it('refuses what is not a host', () => {
    expect(normalizeHost('')).toBe('');
    expect(normalizeHost('not a host')).toBe('');
    expect(normalizeHost('https://')).toBe('');
    expect(normalizeHost('https:')).toBe('');
    // A single label is not something a phone can verify a link against.
    expect(normalizeHost('localhost')).toBe('');
  });

  it('takes a team id only in the shape Apple issues', () => {
    expect(normalizeTeamId('ab12cd34ef')).toBe('AB12CD34EF');
    expect(normalizeTeamId('AB12CD34E')).toBe('');
    expect(normalizeTeamId('AB12CD34EF5')).toBe('');
  });
});

describe('what the files say', () => {
  it('names the app and its certificates, and asks to handle every link', () => {
    expect(assetLinks(DEFAULT_APP_ID, [RELEASE])).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'com.notmtn.planner',
          sha256_cert_fingerprints: [RELEASE],
        },
      },
    ]);
  });

  it('answers the two paths the app is reachable at, for the team', () => {
    expect(appSiteAssociation(DEFAULT_APP_ID, 'AB12CD34EF')).toEqual({
      applinks: {
        details: [
          {
            appIDs: ['AB12CD34EF.com.notmtn.planner'],
            components: [{ '/': '/' }, { '/': '/app' }],
          },
        ],
      },
    });
  });
});

describe('writing them into a build', () => {
  it('writes both files when both identities are configured', () => {
    const result = run({
      ANDROID_SIGNING_CERT_SHA256: RELEASE.toLowerCase().replace(/:/g, ''),
      IOS_TEAM_ID: 'ab12cd34ef',
    });
    expect(result.status).toBe(0);
    const android = JSON.parse(readFileSync(join(result.dir, WELL_KNOWN_DIR, ANDROID_FILE), 'utf8'));
    expect(android[0].target.sha256_cert_fingerprints).toEqual([RELEASE]);
    const apple = JSON.parse(readFileSync(join(result.dir, WELL_KNOWN_DIR, APPLE_FILE), 'utf8'));
    expect(apple.applinks.details[0].appIDs).toEqual(['AB12CD34EF.com.notmtn.planner']);
    // The file Apple asks for has no extension, so it cannot be served as JSON
    // by its name alone — vercel.json sets the content type for it.
    expect(existsSync(join(result.dir, WELL_KNOWN_DIR, `${APPLE_FILE}.json`))).toBe(false);
  });

  it('writes only what it can, and says what is missing', () => {
    const result = run({ ANDROID_SIGNING_CERT_SHA256: RELEASE });
    expect(result.status).toBe(0);
    expect(existsSync(join(result.dir, WELL_KNOWN_DIR, ANDROID_FILE))).toBe(true);
    expect(existsSync(join(result.dir, WELL_KNOWN_DIR, APPLE_FILE))).toBe(false);
    expect(result.stdout).toContain('IOS_TEAM_ID');
  });

  it('is a no-op, not a failure, for a build with no identity at all', () => {
    // An offline build and a deployment nobody has pointed the apps at both
    // look like this. The app works; only the link-opening does not.
    const result = run({});
    expect(result.status).toBe(0);
    expect(existsSync(join(result.dir, WELL_KNOWN_DIR))).toBe(false);
    expect(result.stdout).toContain('deep links stay off');
  });
});
