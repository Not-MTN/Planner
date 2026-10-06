#!/usr/bin/env node
/**
 * The two files that let a link open the installed app.
 *
 *   npm run build                     writes them into dist/.well-known/ when
 *                                     the build knows the app's identity
 *   node scripts/deep-link-files.mjs --dir dist
 *
 * A guardian's QR code carries an ordinary web address, so a phone has to be
 * told that this address belongs to the app before it will hand the link over:
 *
 *   Android   /.well-known/assetlinks.json          — package + signing certificate
 *   iOS       /.well-known/apple-app-site-association — team + bundle identifier
 *
 * Both files are served from the deployment's own domain (they must be, they
 * describe *that* domain) and both are deployed by the ordinary build. So this
 * runs at the end of `npm run build`, after Vite has written `dist/`, and takes
 * what it needs from the environment:
 *
 *   PLANNER_LINK_HOST               the domain the links live on. Optional here:
 *                                   the file's contents do not name it, the
 *                                   address it is served from does. It is read
 *                                   so the run can say which domain it is for.
 *   ANDROID_SIGNING_CERT_SHA256     the release certificate fingerprint, or a
 *                                   comma-separated list. Read from the same
 *                                   repository variable the Apps workflow
 *                                   already pins.
 *   IOS_TEAM_ID                     the Apple Developer team id (10 characters).
 *   PLANNER_APP_ID                  the application id, if you changed it.
 *
 * Nothing is written for a piece that was not configured, and that is not a
 * build failure: an offline build, or a deployment nobody has pointed the apps
 * at yet, is a real state of the world. `npm run check:deployment` is what
 * proves the live files are there and correct.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_APP_ID = 'com.notmtn.planner';
export const WELL_KNOWN_DIR = '.well-known';
export const ANDROID_FILE = 'assetlinks.json';
export const APPLE_FILE = 'apple-app-site-association';

/** `AA:BB:cc` → `AA:BB:CC`: Android compares fingerprints byte by byte. */
export function normalizeFingerprint(value) {
  const hex = String(value ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 64 || /[^0-9A-F]/.test(hex)) return '';
  return hex.match(/.{2}/g).join(':');
}

/** One or many fingerprints, however they were separated, in order. */
export function normalizeFingerprints(value) {
  return String(value ?? '')
    .split(/[\s,;]+/)
    .map(normalizeFingerprint)
    .filter(Boolean);
}

/**
 * `https://app.example.com/` → `app.example.com`; '' when it is not a public
 * host. A domain phones can verify has at least one dot, so a bare word (or a
 * half-typed `https://`) is a typo, not a host.
 */
export function normalizeHost(value) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return '';
  const bare = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{2,5})?$/i.test(bare)) return '';
  try {
    return new URL(`https://${bare}`).host;
  } catch {
    return '';
  }
}

/** A team id is ten upper-case alphanumerics; anything else is a typo. */
export function normalizeTeamId(value) {
  const trimmed = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(trimmed) ? trimmed : '';
}

/**
 * assetlinks.json — "this app is the one that handles links on this domain".
 * A debug certificate belongs in the same list; a build signed by either can
 * claim the domain, which is what makes a locally installed APK testable.
 */
export function assetLinks(appId, fingerprints) {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: appId,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

/**
 * apple-app-site-association — the two paths the app answers, for the team.
 * `/` is where an invite lands and `/app` is where the planner lives; neither
 * carries data, so neither needs a query or fragment rule (iOS matches the
 * path only, and a hash never reaches the server at all).
 */
export function appSiteAssociation(appId, teamId) {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${appId}`],
          components: [{ '/': '/' }, { '/': '/app' }],
        },
      ],
    },
  };
}

function report(lines) {
  console.log('\n── deep links ─────────────────────────────────────────────────');
  for (const line of lines) console.log(`  ${line}`);
  console.log('───────────────────────────────────────────────────────────────');
}

function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const target = resolve(dirIndex >= 0 ? args[dirIndex + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'dist'));
  const appId = (process.env.PLANNER_APP_ID ?? '').trim() || DEFAULT_APP_ID;
  const host = normalizeHost(process.env.PLANNER_LINK_HOST);
  const fingerprints = normalizeFingerprints(process.env.ANDROID_SIGNING_CERT_SHA256);
  const teamId = normalizeTeamId(process.env.IOS_TEAM_ID);

  const written = [];
  const skipped = [];

  if (fingerprints.length > 0) {
    const file = join(target, WELL_KNOWN_DIR, ANDROID_FILE);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(assetLinks(appId, fingerprints), null, 2)}\n`, 'utf8');
    written.push(`${WELL_KNOWN_DIR}/${ANDROID_FILE} — Android, ${appId}, ${fingerprints.length} certificate${fingerprints.length === 1 ? '' : 's'}`);
  } else {
    skipped.push('Android: set ANDROID_SIGNING_CERT_SHA256 (the same value the Apps workflow pins)');
  }

  if (teamId) {
    const file = join(target, WELL_KNOWN_DIR, APPLE_FILE);
    mkdirSync(dirname(file), { recursive: true });
    // No extension is intentional: Apple asks for this exact filename, and
    // vercel.json serves it as JSON (see the headers there).
    writeFileSync(file, `${JSON.stringify(appSiteAssociation(appId, teamId), null, 2)}\n`, 'utf8');
    written.push(`${WELL_KNOWN_DIR}/${APPLE_FILE} — iPhone / iPad, ${teamId}.${appId}`);
  } else {
    skipped.push('iPhone / iPad: set IOS_TEAM_ID (your Apple Developer team id)');
  }

  report([
    host ? `for links on ${host}` : 'for links on the domain this is deployed to',
    ...written.map((line) => `✓ ${line}`),
    ...skipped.map((line) => `· not written — ${line}`),
    ...(written.length > 0
      ? ['these files have to be served from that domain, so the deployment builds them too']
      : ['deep links stay off until one of these is set; the app itself is unaffected']),
  ]);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();
