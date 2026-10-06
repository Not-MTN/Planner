# Planner for Windows, macOS and Linux

The desktop app is the same Planner, in a window of its own, installed like any
other program: a Start-menu shortcut on Windows, an Applications entry on macOS,
and an AppImage, `.deb` or `.rpm` on Linux. It is built with Electron from
`desktop/`, and it ships whatever `npm run build` produced — the identical
bundle the website serves.

```bash
npm install
npm install --prefix desktop     # Electron, once
npm run desktop:dev              # build + start the app here and now
npm run desktop:dist             # build the installers into desktop/release/
PLANNER_API_ORIGIN=https://your-app.example.com npm run desktop:dist
```

`npm run desktop:dist -- --win` (or `--mac`, `--linux`, `--dir`) narrows the
build; `npm run desktop:pack` produces an unpacked app directory for a quick
look. `PLANNER_VERSION_NAME=1.2.0 npm run desktop:dist` sets the packaged app
version (the Apps workflow passes the release tag automatically). Installer
filenames remain fixed for stable download links.

Packaging never publishes. `desktop-build.mjs` passes `--publish never` on
purpose: on a git tag electron-builder publishes on its own when the app's
`package.json` names a repository, and then fails the build asking for a GitHub
token. Uploading is a separate, deliberate step — the Apps workflow collects
the files and the release job attaches them.

## Two ways to run it

`npm run desktop:dist` writes `desktop/config.json`, and the app reads it at
start-up. One variable decides which kind of app you get:

| Build | What happens | Good for |
| --- | --- | --- |
| nothing set | The window loads the copy inside the installer, over the app's own `app://planner` origin. No network needed, ever. | A local-first planner. Sign-in, sync and AI have no server to talk to, and the app says so plainly. |
| `PLANNER_API_ORIGIN=https://your-app.example.com` | Same bundled copy, instant start, but `/api/*` goes to your deployment — cookies included. Requires `PLANNER_APP_ORIGINS` on the server (see [APPS.md](APPS.md) §2). | The default recommendation for a public download. |
| `PLANNER_APP_URL=https://your-app.example.com` | The window loads that deployment, exactly like a browser. | A kiosk-style install, or when you would rather the app always be the newest version. |

The origin is a **secure context** in all three cases (`app://` is registered as
a privileged scheme), which WebCrypto needs — so the encrypted vault, IndexedDB
and the whole planner work identically to the website.

## What the app does and does not do

- Its own window, a normal menu (reload, zoom, full screen, About), window size
  and position remembered between launches.
- Links to the outside world open in your **browser**, never inside the app.
- One instance at a time: launching Planner again focuses the window you have.
- Permissions are granted to the app itself only: the microphone (for the voice
  features) and notifications (for reminders). Camera, location, USB and the
  rest are denied.
- The bundled copy is served with the same shape of Content-Security-Policy the
  deployment sends, so `connect-src` allows your API origin and the weather
  service and nothing else.
- Reminders fire while the app is running (a normal system notification, using
  the page's own notification API), and — with **background mode** on — while
  the window is closed too. See §9.
- Packaged **Windows** builds check `planner-update.json` at startup. When a
  newer release exists, the app downloads the fixed-name installer, checks its
  declared size and SHA-256, then offers the NSIS in-place update. NSIS keeps
  the per-user app data and reopens Planner. Offline or invalid feed checks do
  not block startup. macOS and Linux automatic updates are not implemented.

`desktop/main.cjs` is the main process: window, menu, protocol, links,
permissions and the Windows updater. It never reads, migrates or deletes your
planner data. The page gets a narrow preload bridge for the app version,
external links, update-feed checks, verified installer downloads, progress and
install launch; update requests are revalidated in the main process.

## What each build produces

| Target | Files |
| --- | --- |
| Windows | `Planner-windows.exe` — one NSIS installer for x64 and arm64, with a per-user install, a directory choice and a Start-menu shortcut. The package version changes with the release tag; the public filename stays fixed. |
| macOS | `Planner-macos-x64.dmg` / `…-arm64.dmg` plus matching `.zip` files. The filename stays fixed by architecture; in-app updates are deferred. |
| Linux | `Planner-linux-x64.AppImage`, `.deb`, `.rpm` (ARM builds for AppImage and deb). In-app updates are deferred. |

## Keeping the installers small

An installer is two things: the Electron runtime and the app. The runtime is
roughly 90 MB and it is not ours — every Electron app pays it. The part this
repository controls is the payload beside it, `dist/`, which is **4.1 MB**
(measured with `npm run size:report`; it was 4.7 MB). It is packed whole into
every installer, and into the Android APK.

What trims it without touching a pixel anyone can see:

- **`compression: maximum`** in `desktop/electron-builder.yml`. LZMA at its
  slowest setting, applied to the archive inside every installer. It is worth
  several megabytes of download and costs build minutes, which is why the Apps
  workflow gives the desktop job a 45-minute timeout.
- **`dmg.format: ULMO`** — an LZMA disk image, typically ~30% smaller than the
  zlib one electron-builder defaults to. It mounts a few seconds slower and
  needs macOS 10.15, which Electron itself already requires.
- **`electronLanguages: [en, fa]`** — Chromium ships a translation pack for
  every language it knows; only these two are kept.
- **Icons, recompressed losslessly.** The four PNGs in `public/` are rewritten
  with a better zlib strategy: 42% smaller, and `compare -metric AE` reports
  zero differing pixels. Nothing to review, because nothing changed.
- **No dead weight.** Files nothing references (`mkt-guardian.jpg`,
  `mkt-student.jpg`, `logo-full.png`, `logo-full-dark.png`) are deleted rather
  than copied into every build.

To see where the payload goes, and to catch a regression:

```bash
npm run build && npm run size:report            # where the megabytes are
npm run size:report -- --check 5                # fail above a 5 MB payload
npm run check:bundle-budget                     # what a browser downloads, per chunk
```

The last one is a different measurement: `size:report` weighs the payload an
installer carries, while `check:bundle-budget` weighs what the browser actually
fetches — the entry script and stylesheet out of `index.html` plus every chunk,
gzipped, against a committed baseline in `scripts/bundle-budget.json`. A chunk
may not grow more than 10% without `npm run check:bundle-budget -- --update` in a
commit that says why, and the `limits` in that file are hard caps CI enforces on
every build (`security.yml`). The baseline is keyed by module — Vite's
`.vite/manifest.json`, enabled in `vite.config.ts` for exactly this — because
filenames carry a content hash that changes on every edit.

The remaining artwork in `public/img/` is byte-for-byte the original photography.
WebP is the next 1.6 MB and it was tried and undone: converting those files and
sizing them to what the layout renders brings the payload to 2.9 MB, but the
saving is a re-encode plus a resize, which is a real loss (37–42 dB PSNR, and
the marketing shots end up at 1.07× the page width instead of 1.23× — soft on a
Retina screen). If a release ever needs the megabytes more than the fidelity,
that is the trade to make; measure it with `npm run size:report` before and
after so the cost is written down.

## Signing, and what users will see without it

- **Windows:** an unsigned installer shows SmartScreen's "Windows protected your
  PC" until the file earns reputation. An EV or OV code-signing certificate
  removes it: set `CSC_LINK` (or `WIN_CSC_LINK`) and `CSC_KEY_PASSWORD` before
  building. `electron-builder.yml` already builds an installer suitable for
  signing.
- **macOS:** an unsigned `.dmg` needs a right-click → Open, and `hardenedRuntime`
  is on so notarisation works once you have credentials. Set `CSC_LINK`,
  `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and
  `APPLE_TEAM_ID` (in CI, as secrets) and electron-builder signs and notarises.
- **Linux:** no signing story to worry about; `.deb`/`.rpm` install per-user or
  system-wide as the user prefers.

## Releases from CI

`.github/workflows/apps.yml` builds all three platforms on GitHub's runners —
`npm install --prefix desktop`, then `npm run desktop:dist -- --<target>` — and
attaches the installers to the release on a `v*` tag. That is also the only
place the packaging is exercised end to end: Electron's own binaries cannot be
downloaded in every sandbox, so the repository's checks cover `desktop/lib.cjs`
by unit test and parse-check `main.cjs`/`preload.cjs` with `node --check`.

## Files

| Path | What it is |
| --- | --- |
| `desktop/main.cjs` | The main process: window, menu, `app://` protocol, permissions, IPC. |
| `desktop/preload.cjs` | Narrow page bridge: platform/version, external links, and Windows update checks/download/install progress. |
| `desktop/lib.cjs` | Tested helpers: route → file, content types, CSP, origin checks. |
| `desktop/electron-builder.yml` | Installer configuration for the three platforms. |
| `desktop/build/` | App icons (`icon.ico`, `icon.icns`, `icon.png`, 1024² source). |
| `desktop/dist/` | The web build, copied in. Generated; git-ignored. |
| `desktop/release/` | The installers. Generated; git-ignored. |
| `desktop/config.json` | Written at build time from the two environment variables. |
| `scripts/desktop-build.mjs` | `npm run desktop:dist` — build, copy, package. |
| `scripts/desktop-prepare.mjs` | Copy `dist/` → `desktop/dist/`, write `config.json`. |
| `scripts/report-sizes.mjs` | `npm run size:report` — weigh the payload and the finished installers. |

## Turning off sign-in entirely

If you want the desktop app to be a strictly local planner with no server
anywhere, build with nothing set (`npm run desktop:dist`) and leave
`PLANNER_APP_ORIGINS` unset on the server. The app then has no API origin in
its bundle, never contacts anything, and says so on the sign-in screen instead
of failing with a network error.

## 9. Background mode and reminders with the window closed

Closing the window usually means quitting. In Planner it means "keep my
reminders coming": the window hides, the process stays, and a tray icon is the
way back in.

- **Setting.** Settings → App → *Keep running when the window is closed*. On by
  default, because a close button that silently stops reminders is a worse
  surprise than a tray icon. It is stored in the app's own preferences file
  (`desktop-preferences.json` next to `window-state.json`), never in the planner
  vault — it describes this installation, not your planner.
- **Getting back in.** The tray icon's menu has *Open Planner*, the same
  background switch, and *Quit Planner*. The File menu has *Close window* and
  *Quit Planner* separately. Changing the switch in either place updates the
  other, because the main process owns the value and broadcasts it.
- **The first time**, a single notification explains that Planner is still
  running and how to quit. It is not repeated.
- **Reminders** are computed by the page exactly as they are for the phone
  shells — events and timed tasks with their lead time, habits at their own
  times, and the morning summary if it is on — and handed to the main process
  through IPC. The main process fires a normal system notification at each
  time, and clicking one brings the window back. Task, event and habit names
  stay on the machine: this is an in-process call, not an upload.
- **When background mode is off**, closing the window quits and reminders only
  arrive while the app is open — which is what the settings screen says.

Nothing here changes the browser or the phone apps: `src/desktop.ts` is a no-op
unless `window.plannerDesktop` exists.
