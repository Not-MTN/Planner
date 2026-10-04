#!/usr/bin/env node
/**
 * Create the Android upload key, and print exactly what to paste into GitHub.
 *
 *   npm run android:keystore
 *
 * Why this exists: without this key, the APK a release publishes is signed with
 * a debug key, and Android generates that key per machine. CI builds on a fresh
 * machine every time, so each release would be signed with a different key —
 * and Android refuses to install an app whose signature does not match the one
 * already on the phone. Every release would strand everyone who installed the
 * last one, and they would have to uninstall first (which deletes their planner
 * data on that device unless it was synced).
 *
 * Run this once, on your own machine, then keep the file it creates. It is the
 * app's identity: if it is lost, no future release can update an installed app.
 * That is also why this script generates the key locally and never sends it
 * anywhere — you paste the four values into GitHub yourself.
 *
 * The same key can be reused for Google Play: Play App Signing keeps its own
 * key for distribution and this becomes the *upload* key.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const force = args.includes('--force');
const printFingerprint = args.includes('--fingerprint');
const keytoolFlag = args.indexOf('--keytool');
const keytool = (keytoolFlag !== -1 ? args[keytoolFlag + 1] : process.env.PLANNER_KEYTOOL) || 'keytool';

const ALIAS = process.env.ANDROID_KEY_ALIAS || 'upload';
const KEYSTORE = join(root, 'android', 'app', 'keystore', 'release.jks');
const PROPERTIES = join(root, 'android', 'keystore.properties');
const BASE64_FILE = join(root, 'android', 'app', 'keystore', 'release.jks.base64.txt');
const VALIDITY_DAYS = 10000;

/** A password that is long, random, and free of characters shells mangle. */
function generatePassword() {
  return randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

function readGradleProperties() {
  try {
    return Object.fromEntries(
      readFileSync(PROPERTIES, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim() && !line.trim().startsWith('#'))
        .map((line) => {
          const separator = line.indexOf('=');
          return separator < 0 ? [line.trim(), ''] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        }),
    );
  } catch {
    return {};
  }
}

function certificateFingerprint(password, alias) {
  const certificate = execFileSync(
    keytool,
    ['-exportcert', '-keystore', KEYSTORE, '-alias', alias, '-storepass', password],
    { stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return createHash('sha256').update(certificate).digest('hex').toUpperCase().match(/.{2}/g).join(':');
}

if (printFingerprint) {
  if (!existsSync(KEYSTORE)) fail(`No Android signing keystore found at ${KEYSTORE.replace(root + '/', '')}.`);
  const properties = readGradleProperties();
  if (!properties.storePassword || !properties.keyAlias) {
    fail(`Could not read storePassword and keyAlias from ${PROPERTIES.replace(root + '/', '')}.`);
  }
  try {
    console.log(`ANDROID_SIGNING_CERT_SHA256=${certificateFingerprint(properties.storePassword, properties.keyAlias)}`);
  } catch (error) {
    fail(`Could not read the signing certificate: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exit(0);
}

if (existsSync(KEYSTORE) && !force) {
  fail(
    `${KEYSTORE} already exists.\n` +
      '  That is your app\'s signing key — reusing it is what lets an installed app update.\n' +
      '  Run with --force only if you are deliberately starting over (every installed copy\n' +
      '  of the app would then need to be uninstalled and reinstalled).',
  );
}

// keytool ships with the JDK. Android Studio installs one; `npm run native:sync`
// needs it anyway, so if it is missing the Android build is not set up yet.
try {
  execFileSync(keytool, ['-help'], { stdio: 'ignore' });
} catch {
  fail(
    `Could not run \`${keytool}\`.\n` +
      '  It ships with the JDK (Android Studio includes one). Install a JDK 17 or newer,\n' +
      '  or point at one you have: npm run android:keystore -- --keytool /path/to/keytool',
  );
}

// PKCS12 keeps one password for the store and the key inside it — keytool
// refuses two — and Android's Gradle plugin expects them to match as well.
const password = generatePassword();

mkdirSync(dirname(KEYSTORE), { recursive: true });

console.log('\nCreating the upload key (this takes a moment — RSA 4096)…\n');
try {
  execFileSync(
    keytool,
    [
      '-genkeypair',
      '-v',
      '-keystore', KEYSTORE,
      '-alias', ALIAS,
      '-keyalg', 'RSA',
      '-keysize', '4096',
      '-validity', String(VALIDITY_DAYS),
      '-storetype', 'PKCS12',
      '-storepass', password,
      '-keypass', password,
      '-dname', 'CN=Planner, OU=Planner, O=Planner, L=Planner, ST=Planner, C=FI',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
} catch (error) {
  fail(`keytool failed: ${error instanceof Error ? error.message : String(error)}`);
}

// Gradle reads this file; both paths are git-ignored.
writeFileSync(
  PROPERTIES,
  [
    '# Read by android/app/build.gradle. Never commit this file.',
    'storeFile=keystore/release.jks',
    `storePassword=${password}`,
    `keyAlias=${ALIAS}`,
    `keyPassword=${password}`,
    '',
  ].join('\n'),
  { mode: 0o600 },
);

// A file, not just terminal output: the base64 is long, and copying it out of a
// terminal is where people lose half of it.
const base64 = readFileSync(KEYSTORE).toString('base64');
writeFileSync(BASE64_FILE, `${base64}\n`, { mode: 0o600 });
const fingerprint = certificateFingerprint(password, ALIAS);

const rule = '─'.repeat(68);
console.log(`
✓ Upload key created
    ${KEYSTORE.replace(root + '/', '')}
    android/keystore.properties   (Gradle reads this; both are git-ignored)

${rule}
Add these four repository secrets and one repository variable, then tag a release:
  GitHub → Settings → Secrets and variables → Actions
${rule}

ANDROID_KEYSTORE_BASE64
${base64}

ANDROID_KEYSTORE_PASSWORD
${password}

ANDROID_KEY_ALIAS
${ALIAS}

ANDROID_KEY_PASSWORD
${password}

ANDROID_SIGNING_CERT_SHA256 (repository variable, not a secret)
${fingerprint}

${rule}

The base64 is also in android/app/keystore/release.jks.base64.txt, so you can
open it in an editor instead of copying it out of the terminal.

⚠  Back up android/app/keystore/release.jks somewhere safe, right now.
   It is the app's identity. If you lose it, no future release can be installed
   over one somebody already has — and nothing can recover it.
`);
