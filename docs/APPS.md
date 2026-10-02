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

## 3. Android

### Build and run

```bash
npm run native:sync -- android
npx cap open android          # opens Android Studio
```

From the command line instead:

```bash
cd android
./gradlew assembleDebug                 # installable debug APK
./gradlew assembleRelease bundleRelease # signed release APK + Play bundle
```

Outputs land in `android/app/build/outputs/apk/release/` and
`android/app/build/outputs/bundle/release/`.

- **Requirements:** JDK 21 and the Android SDK (Android Studio installs both).
  `minSdkVersion 24` (Android 7), `targetSdkVersion 36`.
- **Permissions:** `INTERNET` only. No location, no contacts, no camera. The
  microphone is used through the WebView for the voice features, and Android
  asks at that moment.
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
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
Without them the workflow still builds, signed with the debug key.

### Where to publish

| Store | What to upload | Notes |
| --- | --- | --- |
| Google Play | `app-release.aab` | Play App Signing; your keystore becomes the *upload* key. |
| Xiaomi GetApps, Samsung Galaxy Store, Huawei AppGallery, Amazon | the same `.aab` or `.apk` | They accept the identical build. One APK covers Xiaomi/Redmi/POCO, Samsung, Pixel and Huawei phones; nothing here uses Google Play Services, so it works on Huawei/Honor devices with no Play store. |
| Your own site / GitHub releases | `app-release.apk` | Sideloading requires "install unknown apps" on the device; the CI workflow attaches the APK to each release so a download link always exists. |
| F-Droid | source build | F-Droid builds it themselves from the repository; the app has no proprietary dependencies. |

Version numbers come from `versionCode` / `versionName` in
`android/app/build.gradle` (both `1` by default). The Apps workflow overrides
them on a version tag: tag `v1.2.0` builds `versionName 1.2.0`, and
`versionCode` becomes the workflow run number, which always increases — so a
tagged build can go straight to Play without editing anything. A store upload
made by hand needs `versionCode` bumped yourself; it must never repeat.

## 4. iOS

### Build and run

```bash
npm run native:sync -- ios
npx cap open ios              # opens Xcode
```

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

## 5. Regenerating icons and splash screens

The native artwork is committed in `android/` and `ios/`. If you change the
logo, regenerate from `resources/` (which came from `public/icon-512.png`):

```bash
npx @capacitor/assets generate --android --ios
```

`resources/icon-foreground.png` is the sprout on transparency for Android's
adaptive icon, `resources/icon-background.png` is the paper-coloured layer,
`resources/icon.png` is the full-bleed 1024² icon for iOS, and
`resources/splash*.png` are the 2732² splash screens (light and dark).

## 6. Releases from CI

`.github/workflows/apps.yml` builds everything on demand (Actions → Apps → Run
workflow) and on every `v*` tag, attaching the files to that release:

- Windows `.exe`, macOS `.dmg`/`.zip`, Linux `.AppImage`/`.deb`/`.rpm`
- Android `.apk` and `.aab`
- iOS `.xcarchive.zip` and the packaged `.app.zip` (unsigned)

### Artifact names are a public interface

The website downloads the builds itself: each button on the landing page links
to `https://github.com/Not-MTN/Planner/releases/latest/download/<file>`, the
address GitHub keeps pointing at the newest release that has that file. It is
written once and survives every future release — **provided the file name never
changes**. So:

- **no version number in an artifact name.** `Planner-1.2.0-windows-x64.exe`
  would break every button on the site at the next release. The names are
  `Planner-windows.exe`, `Planner-macos-<arch>.dmg`, `Planner-linux-<arch>.*`
  and `app-release.apk`, and the version lives on the release, not in the file.
- **the names are listed in `src/marketing/downloads.ts`.** Rename an artifact
  in `desktop/electron-builder.yml` (or change the APK's name in `apps.yml`) and
  you have to change it there too.
- `npm run check:downloads` asks the live release whether every one of those
  names still exists, and the release job runs it right after uploading — so a
  mismatch fails the build that created it, not a visitor's click.

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

Tagged builds are versioned from the tag: `v1.2.0` produces
`Planner-1.2.0-windows-x64.exe`, an Android `versionName` of 1.2.0 with the run
number as `versionCode`, and the same 1.2.0 in the iOS archive. Installer and
bundle file names carry the version, so nothing has to be renamed before an
upload. Write the tag as `vMAJOR.MINOR.PATCH` — `v1.2.0`, not `v1.2` — because
the desktop installers need a full semantic version.

## 7. What the shells do not do yet

Named plainly, because each one is a real feature and none of them is hidden:

- **Reminders inside the apps.** The reminder engine runs while the app is
  open and shows a system notification. Real scheduled notifications while the
  app is closed need `@capacitor/local-notifications` (Android and iOS), which
  is the next step. In a browser tab, Web Push already covers this.
- **Web Push subscriptions** (`Settings → Notifications`) are a browser
  feature; the setting is inert inside a shell because there is no push
  endpoint.
- **Passkeys** (see §2).
- **Deep links.** A guardian's QR code opens `https://your-app/#/panels?invite=…`
  in a browser. Opening that link straight into the installed app needs
  universal links (iOS) and app links (Android), plus a file on your domain.
- **Biometric unlock** (`@capacitor/biometric-*`) instead of typing the
  password each launch.

Everything else — the entire planner — works, because it is the same code.

## 8. Store listing copy, ready to paste

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

**Keywords (App Store):** planner,tasks,habits,goals,notes,offline,private,encrypted,calendar,focus
**Category:** Productivity
