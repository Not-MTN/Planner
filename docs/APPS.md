# The Planner apps (Android, iOS, and the desktop builds)

The website, the Android app, the iPhone app and the desktop builds are the
**same code**. The mobile apps are Capacitor shells around the very same
`dist/` the website serves; the desktop apps are Electron shells around it.
Nothing is reimplemented per platform, and nothing about your planner data is
copied anywhere new: it lives in the app's own storage on the device,
encrypted, exactly as it does in a browser tab.

- Android: `android/` — APK for sideloading, Xiaomi GetApps, Samsung Galaxy
  Store, Huawei AppGallery, and an `.aab` for Google Play.
- iOS: `ios/` — an Xcode project for the App Store and TestFlight.
- Desktop: `desktop/` — see [DESKTOP.md](DESKTOP.md) for Windows, macOS and
  Linux installers.

---

## 1. Build one in three commands

```bash
npm install
npm run native:sync          # builds the web app and copies it into android/ + ios/
npx cap open android         # or: npm run android:open
```

`native:sync` prints exactly what it built:

```
  the app loads   its own bundled copy (offline, instant start)
  its API         none — this build is local-only …
```

That default is deliberate. A build with **no server address** is a fully
working offline planner: tasks, habits, goals, notes, timers, the calendar —
everything — with no account, no sign-in screen and no network. Accounts,
sync and AI need a server, and the next section is how you point the app at
yours.

| What you want | What to set | Result |
| --- | --- | --- |
| Offline planner, no accounts | nothing | The app is self-contained. Sign-in says the build has no server address. |
| Accounts, sync and AI, using your deployment | `PLANNER_APP_URL=https://your-app.example.com npm run native:sync` | The shell loads that deployment, exactly as the browser does. The device needs the network on first launch; after that the service worker keeps it working offline. |
| Offline-first app that still signs in | `PLANNER_API_ORIGIN=https://your-app.example.com npm run native:sync` | The app starts instantly from its bundled copy and sends `/api/*` to your deployment. Needs the server change in §2, and is what `PLANNER_APP_ORIGINS` exists for. |

Both variables are read by the build itself (`capacitor.config.ts` for where
the shell points, `vite.config.ts` for where the bundle sends its API calls),
so there is nothing to edit by hand and no second place to keep in step.

## 2. Server setup for the bundled-offline build

Only needed for the third row above. The packaged app is a **different origin**
from your deployment — `https://localhost` on Android, `capacitor://localhost`
on iOS, `app://planner` on the desktop — so the API has to be told those
origins are yours. Nothing is trusted unless you name it:

```bash
# Vercel → Project → Settings → Environment Variables, then redeploy
PLANNER_APP_ORIGINS=capacitor://localhost,https://localhost,app://planner
```

What that changes on the server, all of it in `src/server/appOrigins.ts`:

- Those origins may call the API cross-origin, with credentials, and pass the
  `Sec-Fetch-Site: cross-site` check that keeps other sites out.
- Responses carry `Access-Control-Allow-Origin: <that origin>` plus
  `Access-Control-Allow-Credentials: true` (never `*`), and preflights are
  answered.
- The session cookie is sent as `SameSite=None; Secure` **for those origins
  only**. Browser sessions stay `SameSite=Lax`.
- Entries must be bare origins: no path, no wildcard, no credentials. A typo
  cannot widen the API to the web — it just stops working, visibly.
- Everything else is unchanged: a browser request from another site is still
  refused, and a request without an `Origin` header is still treated as
  same-origin.

Two consequences worth knowing:

- **The API must be https.** `SameSite=None` without `Secure` is dropped by
  every WebView, which would look like "sign-in worked, then I was signed
  out". The apps keep the cookie `Lax` on an http API instead of pretending.
- **Passkeys work in the browser, not in the shells.** WebAuthn is bound to
  the origin that created the credential, and the shell's origin is not your
  domain. The password and recovery-code paths work normally in the apps.

If requests from the app come back `403 Cross-origin requests are not
allowed.`, this variable is missing or misspelled for that environment — that
is the whole check.

**What the app itself sees.** In a shell the browser never shows that 403: the
response carries no `Access-Control-Allow-Origin`, so `fetch` rejects and
JavaScript is left with a bare network error. The app asks one extra question
before naming the failure (`src/auth/reachability.ts` — a `no-cors` request
that settles whether anything answered at all), so a missing `PLANNER_APP_ORIGINS`
is reported as *"this server refuses requests from the app's own origin"* on the
sign-in screens and on the gate, with the setting named, instead of "check your
connection". Add the variable, redeploy, and **the app you already installed
starts signing in — nothing has to be reinstalled or rebuilt.**

Until it is set, a downloaded app is not dead: it opens a first screen that
offers sign-in or the offline planner, rather than silently behaving like a
local-only build.

### Prove it in one command

```bash
npm run check:deployment -- https://your-app.example.com
```

That asks the deployment the same questions a phone would — is the site there,
is the API there, does it allow each of the three shell origins, does the
preflight answer — and prints the exact fix when one is missing. Run it after
changing the variable; it exits non-zero, so it also works as a release gate.
`PLANNER_API_ORIGIN=https://… npm run check:deployment` without the argument
does the same thing.

The dev server applies the identical CORS layer, so you can check before you
deploy:

```bash
PLANNER_APP_ORIGINS=capacitor://localhost,https://localhost,app://planner npm run dev
# in another terminal:
npm run check:deployment -- http://localhost:5173
```

## 3. Links that open the app (deep links)

A guardian's QR code carries an ordinary web address —
`https://your-app.example.com/#/panels?invite=plnr-…` — because the student
scanning it may not have installed anything yet. When they *have* installed it,
the same address should open the app, not a browser tab. Both platforms do that
by asking your domain which app owns its links, which is why this is a server
setting as much as an app setting:

| Platform | What it fetches | What must be true |
| --- | --- | --- |
| Android | `https://your-app/.well-known/assetlinks.json` | Lists package `com.notmtn.planner` and the SHA-256 fingerprint of the certificate that signed the installed APK. |
| iPhone / iPad | `https://your-app/.well-known/apple-app-site-association` | Lists `TEAMID.com.notmtn.planner`, and the App ID has **Associated Domains** enabled in the Apple Developer portal. |

Both files are written by the ordinary build — `npm run build` ends with
`scripts/deep-link-files.mjs` — from environment variables on the deployment
that serves them (Vercel: Project → Settings → Environment Variables, then
redeploy):

```bash
ANDROID_SIGNING_CERT_SHA256=AA:BB:…          # the release certificate fingerprint
IOS_TEAM_ID=AB12CD34EF                       # your Apple Developer team id
PLANNER_LINK_HOST=your-app.example.com       # optional: printed in the build log
```

The Android value is the same one the Apps workflow already pins as a
repository variable, and it takes a comma-separated list: add your debug
certificate (`keytool -list -v -keystore ~/.android/debug.keystore -alias
androiddebugkey -storepass android`) so a locally installed APK can be tested
against the same domain. Neither file is written for a build that was not given
these values, and nothing else about the app changes.

Then check it, against the live deployment:

```bash
npm run check:deployment -- https://your-app.example.com
```

The last two lines of that report are about these files
(`PLANNER_REQUIRE_DEEP_LINKS=1` makes a failure fail the run). Both platforms
fetch them **without redirects** and want `Content-Type: application/json` —
`vercel.json` sets both, and the check fails loudly if a host serves the
extensionless Apple file as a download instead.

### What the app does with a link

`src/shared/deepLinks.ts` listens for `appUrlOpen`, and reads `getLaunchUrl()`
for the case where the link *started* the app. Either way the address becomes a
route through the ordinary hash router, so nothing is granted by arriving this
way: a scanned invite opens the student panel with the code filled in, and
linking still takes a press.

`planner://` (the custom scheme) also works, with no domain and no verification.
It is the fallback for a build served entirely from the device — and for a
deployment that has not set the two files up yet.

### When it does not work

- **Android.** `adb shell pm get-app-links com.notmtn.planner` says whether the
  domain is `verified`. Turning it on by hand for a test —
  `adb shell pm set-app-links --package com.notmtn.planner 0 all your-app.example.com` —
  is a debugging step, not a fix: verification has to pass on its own.
- **iOS.** Apple caches its copy of the association file. Toggling the app's
  Developer settings or reinstalling the app re-fetches it; waiting is also
  legitimate (the cache is not permanent).
- **The app's own origin.** In a bundled (`PLANNER_API_ORIGIN`) build the app is
  served from `https://localhost`, so the *link* has to point at the deployment,
  not at the app. That address is baked in at build time and shown in the
  `npm run native:sync` summary as `its links`.

## 4. Android

### Build and run

```bash
npm run native:sync -- android
npx cap open android          # opens Android Studio
```

From the command line instead:

```bash
cd android
./gradlew assembleDirectDebug                           # sideload/debug APK
./gradlew assembleDirectRelease bundlePlayRelease      # direct APK + Play AAB
```

The `direct` and `play` product flavors share the same permanent package ID
and signing config. Only `src/direct/AndroidManifest.xml` requests
`REQUEST_INSTALL_PACKAGES` for the user-started sideload updater; the Play AAB
contains no such permission, and Play remains responsible for its own updates.
The CI job copies the direct flavor to `app-release.apk` (the stable website
and updater name) and the Play flavor to `app-play-release.aab`. Gradle's
variant outputs are under `outputs/apk/direct/release/` and
`outputs/bundle/playRelease/`.

- **Requirements:** JDK 21 and the Android SDK (Android Studio installs both).
  `minSdkVersion 24` (Android 7), `targetSdkVersion 36`.
- **Permissions:** `INTERNET`, microphone (`RECORD_AUDIO`), and notifications
  (`POST_NOTIFICATIONS` on Android 13+). The microphone prompt appears only when
  someone starts voice input; the notification prompt appears only when they
  turn reminders on. The app never requests broad photo/storage access: Android's
  system Photo Picker grants access only to the picture the person taps. The
  direct-APK flavor declares package-install access only for the updater and
  opens Android's “install unknown apps” setting only after someone taps
  **Install**; the Play flavor does not include that permission. No location,
  contacts, or camera permission is requested.
- **Package name:** `com.notmtn.planner` in `android/app/build.gradle`. Change
  it *before* your first store upload — after that it is permanent.

### Release signing

A release build is signed with your upload key when `android/keystore.properties`
exists, and with the debug key when it does not (so a locally built release APK
is still installable for testing):

```properties
# android/keystore.properties  — never commit this file
storeFile=keystore/release.jks
storePassword=…
keyAlias=…
keyPassword=…
```

```bash
keytool -genkey -v -keystore android/app/keystore/release.jks \
  -keyalg RSA -keysize 4096 -validity 10000 -alias upload
```

For CI, add these repository secrets and the workflow writes the same files
itself: `ANDROID_KEYSTORE_BASE64` (`base64 -w0 release.jks`),
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD`.
Also add the repository variable `ANDROID_SIGNING_CERT_SHA256`, the public
certificate fingerprint printed by the helper below. The workflow verifies the
APK against that pin and carries the verified fingerprint forward in the update
feed so later releases can prove signing continuity.

A branch/manual build may use the debug key for testing. **A public version-tag
release stops before building if the permanent signing key or fingerprint is
missing, and later releases are rejected if their signer differs from the
verified update feed.** The first permanent-key release bootstraps that lineage.
The earlier `v1.0.0` and `v1.0.1` test releases were built with per-run CI debug
keys, so only those two known tags are excluded from this first bootstrap; no
other old or future release is ignored. Existing installs of those test APKs
cannot be upgraded in place with a different key. Keep any planner data on a
test install intact and use a separate device for testing the permanent-key
build; never uninstall just to work around a signature mismatch.

Generate the keystore once, keep it, and use it for every direct APK release.
It cannot be regenerated later without breaking updates for everyone who
already installed the app. One command does all of it:

```bash
npm run android:keystore
```

It creates `android/app/keystore/release.jks` and `android/keystore.properties`
(both git-ignored), then prints the four secret values and the
`ANDROID_SIGNING_CERT_SHA256` fingerprint. Add the secrets under **Settings →
Secrets and variables → Actions → Secrets** and the fingerprint under
**Variables**. The base64 is also written to a file so a long string does not
have to be copied out of a terminal. It refuses to overwrite an existing key
unless you pass `--force`, because replacing one strands every installed copy.

If the key already exists, print its fingerprint without changing it:

```bash
npm run android:keystore -- --fingerprint
```

Run key generation on your own machine, not in CI: it is your key, and the
point of the script is that nothing has to be sent anywhere.

### Where to publish

| Store | What to upload | Notes |
| --- | --- | --- |
| Google Play | `app-play-release.aab` | Play App Signing; your keystore becomes the *upload* key. This flavor leaves update delivery to Play and does not request package-install permission. |
| Xiaomi GetApps, Samsung Galaxy Store, Huawei AppGallery, Amazon | `app-play-release.aab` or `app-release.apk` | The AAB has the Play-safe manifest; `app-release.apk` is the direct/sideload build. One APK covers Xiaomi/Redmi/POCO, Samsung, Pixel and Huawei phones; nothing here uses Google Play Services. |
| Your own site / GitHub releases | `app-release.apk` | Direct/sideload flavor. Android asks for “install unknown apps” only if the user chooses **Install** inside Planner; CI attaches the APK to each release. |
| F-Droid | source build | F-Droid builds it themselves from the repository; the app has no proprietary dependencies. |

Version numbers come from `versionCode` / `versionName` in
`android/app/build.gradle` for local builds. Tagged releases require a stable
`vMAJOR.MINOR.PATCH` tag: `v1.2.0` produces `versionName 1.2.0`, while
`versionCode` is the monotonically increasing Apps workflow run number. The
release gate checks that the APK actually contains that package ID and code.
A store upload made by hand needs `versionCode` bumped yourself; it must never
repeat. Google Play re-signs Play-delivered APKs with its Play App Signing key;
the in-app APK update path is for direct/sideloaded APK installs signed with
this repository's permanent key. Play-managed installs should continue to update
through Play.

## 5. iOS

### Build and run

```bash
npm run native:sync -- ios
npx cap open ios              # opens Xcode
```

### Permission prompts and privacy

The iOS usage descriptions are in `ios/App/App/Info.plist`. Microphone and
speech-recognition permission are requested only after the person starts voice
input. Notification permission is requested only when they turn reminders on.
Photo Library access is reached only after they tap **Add a plan picture**;
the picker returns only their selection, not a scan of the library. No permission
prompt is shown on install or app launch. These flows need no location,
contacts, or camera access.

- Signing: select your team in Xcode → App target → **Signing & Capabilities**.
  `PRODUCT_BUNDLE_IDENTIFIER` is `com.notmtn.planner`; `MARKETING_VERSION` is
  `1.0` (in `ios/App/App.xcodeproj/project.pbxproj`).
- TestFlight / App Store: Product → Archive → Distribute App. That needs an
  Apple Developer Program membership ($99/year). Nothing in the repository can
  do it for you, and the CI workflow deliberately stops at an **unsigned**
  archive.
- Requirements: macOS with Xcode 16+. `ios/` uses Swift Package Manager, so
  CocoaPods is not needed.

An honest note about App Review: a shell that only wraps a website can be
rejected under guideline 4.2 ("minimum functionality"). This app is not that —
it works with no network at all, keeps its data on the device, and has the
planner's real UI — but a reviewer may still ask. When submitting, describe it
as an offline-first planner that syncs through the user's own server, and
mention the offline behaviour in the review notes.

## 6. Regenerating icons and splash screens

The native artwork is committed in `android/` and `ios/`. If you change the
logo, regenerate from `resources/` (which came from `public/icon-512.png`):

```bash
npx @capacitor/assets generate --android --ios
```

`resources/icon-foreground.png` is the sprout on transparency for Android's
adaptive icon, `resources/icon-background.png` is the paper-coloured layer,
`resources/icon.png` is the full-bleed 1024² icon for iOS, and
`resources/splash*.png` are the 2732² splash screens (light and dark).

## 7. Releases from CI

`.github/workflows/apps.yml` builds everything on demand (Actions → Apps → Run
workflow) and for valid stable `vMAJOR.MINOR.PATCH` tags, attaching the files
to that release (a malformed `v*` tag fails its release-contract gate):

- Windows `.exe`, macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`/`.rpm`
- Android `.apk` and `.aab`
- iOS `.xcarchive.zip` and the packaged `.app.zip` (unsigned)
- `planner-update.json`, the versioned Android/Windows updater contract

### Every build checks the deployment first

The `preflight` job runs before the builds and asks the deployment whether it
accepts the origins the apps run from — the same questions
`npm run check:deployment` asks. Only when `PLANNER_API_ORIGIN` is set, because
an offline-only build has no server to be refused by.

- Deployment answers and refuses the app origins → **the build fails**, with the
  exact `PLANNER_APP_ORIGINS` value and where to put it in the run summary. A
  build that produces an app which cannot sign in is not a build worth having.
- Deployment cannot be reached → **a warning**, and the build continues. An
  outage or a wrong address says nothing either way, and it must not fail
  somebody's work.
- Everything answers → nothing to see.

This runs on CI rather than locally because CI can reach the deployment. It is
also the only moment the two halves — a server that must allow the apps, and
apps about to be built — are known together.

### Artifact names are a public interface

The website downloads the builds itself: each button on the landing page links
to `https://github.com/Not-MTN/Planner/releases/latest/download/<file>`, the
address GitHub keeps pointing at the newest release that has that file. It is
written once and survives every future release — **provided the file name never
changes**. So:

- **no version number in an artifact name.** `Planner-1.2.0-windows-x64.exe`
  would break every button on the site at the next release. The names are
  `Planner-windows.exe`, `Planner-macos-<arch>.dmg`, `Planner-linux-<arch>.*`,
  `app-release.apk`, and the update-feed file `planner-update.json`; the version
  lives in package metadata and the release tag, not in these asset names.
- **The website-button names are listed in `src/marketing/downloads.ts`.**
  Rename an installer in `desktop/electron-builder.yml` or the APK in `apps.yml`
  and update that list too. `planner-update.json` is the separate updater feed,
  generated by `scripts/create-update-manifest.mjs` and required by the release
  upload step.
- `npm run check:downloads` asks the live release whether every website download
  still exists, and the release job runs it right after uploading — so a mismatch
  fails the build that created it, not a visitor's click.

Windows is deliberately a single installer for both architectures:
electron-builder only produces a separate installer per architecture when the
artifact name asks for `${arch}`, and nothing about a visitor's browser reliably
says whether their PC is x64 or ARM. macOS cannot be solved the same way, so it
ships both and the site names them after the chip: an Intel Mac cannot run an
Apple-silicon build at all.

Where the builds point is decided in this order, first match wins:

1. the `api_origin` input when you run the workflow by hand,
2. the repository variable `PLANNER_API_ORIGIN` (Settings → Secrets and
   variables → Actions → Variables),
3. the `API_ORIGIN` default near the top of `apps.yml` — currently the
   deployment this repository ships for, so a tagged build is a real
   online-and-offline app without any setup,
4. otherwise an empty value, which builds a **local-only** app: the planner
   works, sign-in and sync have nowhere to go.

`APP_URL` (load a deployment in the shell instead of the bundled copy) follows
the same order with the `app_url` input and `PLANNER_APP_URL`.

So a build made by pushing a tag is an offline-first app pointed at the
deployment in step 3, and one of the two things below is all you need to change
that.

Tagged builds are versioned from the tag: `v1.2.0` produces a Windows app
version of 1.2.0 with the stable public installer name `Planner-windows.exe`,
an Android `versionName` of 1.2.0 with the run number as `versionCode`, and the
same 1.2.0 in the iOS archive. The installer names stay stable across releases;
the version lives in package metadata and the release tag. Write the tag as
`vMAJOR.MINOR.PATCH` — `v1.2.0`, not `v1.2` — because desktop installers need
a full semantic version.

Version-tag jobs also run `scripts/validate-release-contract.mjs`. It locks the
Android package ID and Windows `appId`, protects the NSIS app-data setting, and
requires the Android signing secrets plus the pinned certificate fingerprint.
The Android job verifies the APK's actual package, `versionCode`, and signing
certificate. During first-feed bootstrap it compares against prior stable APKs,
excluding only the known test-only `v1.0.0` and `v1.0.1` releases signed with
per-run debug keys; later releases compare against the prior verified signer in
the feed. A mismatch fails the release instead of publishing an APK that could
not replace an installed copy.

## 8. Updates

### Release contract (Phase 1)

Every stable version-tag release now includes the fixed-name feed
`planner-update.json` at
`https://github.com/Not-MTN/Planner/releases/latest/download/planner-update.json`.
It records the schema and app version, stable Android package ID and
`versionCode`, the Android signing-certificate SHA-256, and the exact APK URL,
size and SHA-256. It also records the stable Windows `appId`, NSIS installer
URL, size and SHA-256. The per-version asset URLs avoid a race if a newer
release appears while a download is in progress.

The manifest intentionally covers **direct APK installs on Android** and
Windows installers only. Google Play updates Play-installed copies itself;
iOS/App Store updates are deferred. Android still shows the system install
confirmation for a downloaded sideloaded APK. The app is replaced in place
only when its Android package and signing identity match; it must never
uninstall first. Windows keeps the same Electron `appId`, and the NSIS config
keeps app data when uninstalling, so a normal update does not reset the planner.

The release workflow blocks a tag unless the permanent Android keystore and
`ANDROID_SIGNING_CERT_SHA256` Actions variable are configured. It verifies the
built APK's actual package, version code and certificate, compares its signer
with previously released APKs, and checksums the APK and Windows installer
before writing the feed. This prevents accidentally publishing an update that
Android would reject and protects the local data of installed copies.

### Packaged startup, download and install flow (Phases 2–3)

The `/app` startup screen checks the account/session, connection, installed
version and update feed together. The update check never delays opening the
installed/local planner. Its result moves into shared startup state and then to
the planner's update notice, which shows download progress and verification.
On packaged Android/Windows builds, **Update now** downloads and verifies the
release in-app before handing it to the platform installer. A refresh control in
the phone app bar and **Settings → App → Check for updates** force a fresh check
(including releases previously dismissed with **Later**) and start that same
in-app update flow when a release is found.

Windows and direct-APK Android builds read the stable `planner-update.json`
contract; they do not treat an arbitrary newer GitHub tag as an installable
update. Every asset has an exact stable filename, per-release URL, declared
size and SHA-256. Downloads are bounded, hashed and checked against those
values before an installer is allowed to run.

On **Android**, the app checks the installed package ID, current signing
certificate, installer source, `versionName` and monotonic `versionCode` before
offering an APK. Play-installed copies are left to Google Play. For an eligible
direct install, **Update now** (or an explicit manual check that finds a newer
release) downloads the APK to the app's private cache, verifies its package,
version, signer and checksum off the UI thread, then opens Android's own package
installer to ask for confirmation. If Android requires “install unknown apps”
access, Planner opens that system setting as part of the user-started update.
After an accepted update the new Planner is reopened; cancellation leaves the
current app usable. No uninstall, data wipe or setup reset is part of the flow.

On **Windows**, the Electron main process validates the release feed and
installer request, downloads into a temporary directory, and checks the exact
size and SHA-256 before the UI can launch the NSIS installer. The same stable
Electron app ID and per-user install path are retained, NSIS does not delete
Planner's user-data directory, and the updated app is opened when installation
finishes.

Google Play remains responsible for Play-managed Android installs. iOS and
App Store updates are deferred. In any packaged app, no network, a blocked
feed or a malformed response means “we do not know”: startup continues with the
installed version and does not interrupt offline use. Browser tabs continue to
update themselves through the service worker and do not use the native updater.

## 9. What the shells do not do yet

Named plainly, because each one is a real feature and none of them is hidden:

- **Reminders inside the apps** use `@capacitor/local-notifications` on both
  Android and iOS. After the person enables reminders and grants notification
  permission, Planner replaces the device schedule with upcoming events, timed
  tasks, and the optional morning digest (up to 60 notices from the next 31
  days). The OS can deliver them while Planner is closed; no server or special
  exact-alarm permission is needed. Disabling reminders cancels the pending
  schedule. The same settings show in-app reminders as a fallback if OS
  notifications are unavailable.
- **Web Push subscriptions** are a browser/PWA feature; they are separate from
  the on-device reminder schedule in the mobile shells.
- **Feature-gated access:** voice input requests microphone and speech
  recognition only when started. **Add a plan picture** opens the system photo
  picker only after an explicit tap; Android grants access to the chosen image,
  and iOS may show its Photo Library prompt then. No permission is requested at
  install or app startup.
- **Passkeys** (see §2).
- **Deep links** are set up on the app side and documented in §3. What is left
  is the part only a deployment can do: serving the two association files, and
  for iOS having the Associated Domains capability enabled on the App ID. Until
  then a link opens in the browser, which still works.
- **Biometric unlock is shipped**, and it is part of this repository rather than
  a plugin package: `android/app/src/main/java/com/notmtn/planner/PlannerBiometricPlugin.java`
  and `ios/App/App/PlannerBiometricPlugin.swift` are registered by the shells
  (`MainActivity` on Android, `PlannerBridgeViewController` in
  `ios/App/App/SceneDelegate.swift` on iOS). Turning it on in **Settings →
  Account** hands the vault key to the Android Keystore / iOS Keychain behind
  `setUserAuthenticationRequired` / `.biometryCurrentSet`, so the platform's own
  face or fingerprint check is what releases it — Planner never sees a
  fingerprint, and nothing biometric leaves the device. Three consequences
  worth knowing:
    - It is off by default, and turning it on needs the password once: the key
      is only in memory right after a password unlock. On the same device it
      replaces the silent "keep this device signed in" copy, because a phone
      that opens with a face should not also open without one.
    - Re-enrolling a face or fingerprint, or changing the password, retires the
      stored key (`invalidated`). The app says so and asks for the password
      rather than trying again.
    - Turning the setting off, or signing out, deletes it. Locking the planner
      keeps it — that is the point of the feature.
  The Android build adds `androidx.biometric` (see `android/variables.gradle`);
  iOS needs no extra dependency, only the `NSFaceIDUsageDescription` entry
  already in `Info.plist`. Store/privacy wording is at the end of §10.

Everything else — the entire planner — works, because it is the same code.

## 10. Store listing copy, ready to paste

**Title:** Planner — calm daily planning
**Short description (Play, ≤80):** Tasks, habits, goals and notes — encrypted, offline-first, no account needed.
**Subtitle (App Store, ≤30):** Calm, private daily planning
**Full description:**

> Planner is a calm, local-first planner for your day, your week and the days
> ahead: tasks, habits, goals, notes, a weekly review and a focus timer, in one
> quiet place.
>
> Everything is saved on your device and works with no network at all. Notes
> and attachments never leave it. If you want your phone and laptop in step,
> switch on end-to-end encrypted sync — the server only ever holds ciphertext,
> and there are no accounts to create unless you want one.
>
> Persian and English, light and dark, phone, tablet and desktop.
>
> In the phone apps you can open it with Face ID or your fingerprint instead of
> typing your password. That key stays on your device, and signing out removes
> it.

**Keywords (App Store):** planner,tasks,habits,goals,notes,offline,private,encrypted,calendar,focus
**Category:** Productivity

**Privacy notes for the store questionnaires (Apple App Privacy / Play Data
Safety and, on Apple, the Face ID usage reason):**

- Planner does not collect, store or transmit biometric data. Face ID, Touch ID
  and fingerprint matching happens in the operating system; what the app
  receives after a successful check is its own vault key.
- The optional biometric unlock keeps that key in the platform's protected
  store (Android Keystore / iOS Keychain) on that device only. It is off by
  default, can be turned off in Settings at any time, and is deleted when the
  person signs out.
- `NSFaceIDUsageDescription` in `ios/App/App/Info.plist` is deliberately worded
  for the prompt Apple shows: *Planner uses Face ID to open your planner
  without typing your password.*
