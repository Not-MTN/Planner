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
  the page's own notification API). Reminders while the app is closed would
  need a background service or a tray process — not implemented, and not
  pretended otherwise.
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

## Turning off sign-in entirely

If you want the desktop app to be a strictly local planner with no server
anywhere, build with nothing set (`npm run desktop:dist`) and leave
`PLANNER_APP_ORIGINS` unset on the server. The app then has no API origin in
its bundle, never contacts anything, and says so on the sign-in screen instead
of failing with a network error.
