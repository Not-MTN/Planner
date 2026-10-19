/**
 * The desktop app: the same Planner, in a window of its own.
 *
 * Two modes, both decided by `config.json` (written at build time by
 * scripts/desktop-prepare.mjs):
 *
 *   appUrl set      → the window loads the deployed Planner. Accounts, sync
 *                     and AI work exactly as they do in a browser, and the
 *                     app needs the network on first launch.
 *   appUrl unset    → the window loads the copy of the app shipped inside the
 *                     installer, over the privileged `app://planner` scheme
 *                     (a secure context, so the encrypted vault and WebCrypto
 *                     work). With `apiOrigin` set, the app reaches the
 *                     deployment's `/api/*` from there; without it the app is
 *                     local-only, which is a perfectly good way to use it.
 *
 * What the main process owns: the window, the menu, where links open, which
 * permissions the page may have, and where its own files live. It never
 * touches the user's planner data.
 */
'use strict';

const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, nativeTheme, net, protocol, session, shell } = require('electron');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');
const {
  DEFAULT_PREFERENCES,
  PREFERENCES_FILE,
  contentType,
  contentSecurityPolicy,
  dueReminders,
  isHttpUrl,
  isInternal: isInternalUrl,
  isTrustedUpdateUrl,
  msUntilNext,
  normalizeAddress,
  normalizePreferences,
  normalizeReminderSchedule,
  resolveRequestedFile,
  validateWindowsOffer,
  windowsOfferFromManifest,
  WINDOWS_UPDATE_MANIFEST_URL,
} = require('./lib.cjs');

const SCHEME = 'app';
const AUTHORITY = 'planner';
const APP_ID = 'com.notmtn.planner';
const RELEASES_URL = 'https://github.com/Not-MTN/Planner/releases/latest';
const GUIDE_URL = 'https://github.com/Not-MTN/Planner#readme';
const WEB_ROOT = path.join(__dirname, 'dist');
const LOCAL_ORIGIN = `${SCHEME}://${AUTHORITY}`;

/** Build-time settings, with environment overrides for development. */
function readConfig() {
  let file = {};
  try {
    file = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
  } catch {
    file = {};
  }
  return {
    appUrl: normalizeAddress(process.env.PLANNER_APP_URL || file.appUrl),
    apiOrigin: normalizeAddress(process.env.PLANNER_API_ORIGIN || file.apiOrigin),
    devServer: normalizeAddress(process.env.PLANNER_DEV_URL || ''),
  };
}

const config = readConfig();

/** The origin the window is showing: the deployment, or the bundled copy. */
function appOrigin() {
  const address = config.devServer || config.appUrl;
  if (!address) return LOCAL_ORIGIN;
  try {
    return new URL(address).origin;
  } catch {
    return LOCAL_ORIGIN;
  }
}

/** Is this URL the app the window is showing, rather than the outside world? */
function isInternal(value) {
  return isInternalUrl(value, appOrigin(), SCHEME);
}

let mainWindow = null;
let currentWindowsOffer = null;
let downloadedWindowsInstaller = null;
let windowsDownloadInProgress = false;
let windowsDownloadPaused = false;
let windowsDownloadCanceled = false;
let windowsDownloadAbort = null;
let windowsDownloadOffer = null;
let windowsDownloadPartialPath = null;
let windowsDownloadBytesReceived = 0;

function assertUpdateSender(event) {
  const frameUrl = event.senderFrame?.url ?? '';
  if (!mainWindow || event.sender !== mainWindow.webContents || !isInternal(frameUrl)) {
    throw new Error('The update request did not come from Planner.');
  }
  if (process.platform !== 'win32' || !app.isPackaged) {
    throw new Error('In-app updates are available only in the installed Windows app.');
  }
}

function sameWindowsOffer(left, right) {
  if (!left || !right) return false;
  return left.version === right.version
    && left.downloadUrl === right.downloadUrl
    && left.sizeBytes === right.sizeBytes
    && left.sha256 === right.sha256;
}

async function limitedResponseText(response, maxBytes) {
  if (!response.body) throw new Error('The update service returned an empty response.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new Error('The update feed is unexpectedly large.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size).toString('utf8');
}

async function fetchWindowsUpdateManifest() {
  if (process.platform !== 'win32' || !app.isPackaged) {
    throw new Error('The Windows update feed is available only in the installed app.');
  }
  currentWindowsOffer = null;
  const response = await net.fetch(WINDOWS_UPDATE_MANIFEST_URL, {
    headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
  });
  if (!response.ok) throw new Error(`The update feed returned HTTP ${response.status}.`);
  if (response.url && !isTrustedUpdateUrl(response.url)) throw new Error('The update feed redirected to an untrusted host.');
  const manifest = JSON.parse(await limitedResponseText(response, 128 * 1024));
  const offer = windowsOfferFromManifest(manifest);
  if (!offer) throw new Error('The Windows update feed does not match Planner’s release contract.');
  currentWindowsOffer = offer;
  return manifest;
}

async function sha256File(filePath) {
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return digest.digest('hex');
}

/**
 * Pull down only what changed.
 *
 * An in-app update has always cost the whole installer again — around 90 MB of
 * Electron that did not move, to deliver the few hundred kilobytes that did.
 * Every NSIS installer electron-builder produces carries a blockmap: the file
 * cut into blocks with a checksum on each. The one already installed is sitting
 * on this machine, so the new installer can be assembled locally out of the
 * blocks it shares with it plus the handful that differ, fetched as HTTP ranges.
 *
 * The division of responsibility is deliberate. The verified release manifest
 * still decides *whether* there is an update and *which* bytes are trustworthy;
 * electron-updater only decides *how* they arrive. The assembled file is checked
 * against the SHA-256 from that manifest before anything is offered to the
 * installer, so a differential that produced the wrong bytes is caught and the
 * caller falls back to downloading the whole file. Slower, never wrong.
 *
 * Returns null when a differential download is not possible here — no packaged
 * install to diff against, no blockmap published, no network support for ranges
 * — which is a reason to fall back, not an error to surface.
 */
async function downloadWindowsInstallerDifferentially(event, offer) {
  if (!app.isPackaged) return null;
  let NsisUpdater = null;
  try {
    ({ NsisUpdater } = require('electron-updater'));
  } catch {
    // Not bundled into this build: the full download still works.
    return null;
  }

  const updater = new NsisUpdater({
    provider: 'github',
    owner: 'Not-MTN',
    repo: 'Planner',
  });
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  // Planner runs its own NSIS invocation so the install path and relaunch stay
  // as they are; electron-updater only owes us the bytes.
  updater.disableWebInstaller = true;
  updater.logger = null;

  updater.on('download-progress', (progress) => {
    if (event.sender.isDestroyed() || !progress) return;
    event.sender.send('planner:update-progress', {
      bytesReceived: Math.round(progress.transferred ?? 0),
      totalBytes: Math.round(progress.total ?? offer.sizeBytes),
      speedBps: Number.isFinite(progress.bytesPerSecond) ? Math.round(progress.bytesPerSecond) : null,
    });
  });

  let files;
  try {
    files = await updater.downloadUpdate();
  } catch (error) {
    // Range requests refused, blockmap missing, cache gone: fall back quietly.
    console.warn('[planner] differential update unavailable, falling back:', error && error.message);
    return null;
  }

  const file = Array.isArray(files) ? files[0] : null;
  if (!file) return null;
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile()) return null;
  // The assembled installer must be byte-for-byte what the verified feed named.
  const digest = await sha256File(file);
  if (digest !== offer.sha256) {
    await fs.promises.rm(file, { force: true }).catch(() => {});
    return null;
  }

  // Keep the file where the rest of the updater expects it.
  const directory = path.join(app.getPath('temp'), 'Planner-update');
  const finalPath = path.join(directory, `${offer.version}-${offer.sha256}.exe`);
  await fs.promises.mkdir(directory, { recursive: true });
  if (path.resolve(file) !== path.resolve(finalPath)) {
    await fs.promises.rm(finalPath, { force: true }).catch(() => {});
    await fs.promises.rename(file, finalPath).catch(async () => {
      await fs.promises.copyFile(file, finalPath);
      await fs.promises.rm(file, { force: true }).catch(() => {});
    });
  }

  downloadedWindowsInstaller = { ...offer, path: finalPath };
  if (!event.sender.isDestroyed()) {
    event.sender.send('planner:update-progress', {
      bytesReceived: offer.sizeBytes,
      totalBytes: offer.sizeBytes,
      speedBps: null,
    });
  }
  return { ready: true, differential: true };
}

async function downloadWindowsInstaller(event, untrustedOffer) {
  assertUpdateSender(event);
  const offer = validateWindowsOffer(untrustedOffer);
  if (!offer || !sameWindowsOffer(offer, currentWindowsOffer)) {
    throw new Error('The requested installer does not match the latest verified update feed.');
  }
  // Allow re-entry when a previous download was paused — it will resume via Range.
  if (windowsDownloadInProgress && !windowsDownloadPaused) {
    throw new Error('An update download is already in progress.');
  }
  windowsDownloadInProgress = true;
  windowsDownloadPaused = false;
  windowsDownloadCanceled = false;
  windowsDownloadOffer = offer;

  const directory = path.join(app.getPath('temp'), 'Planner-update');
  const finalPath = path.join(directory, `${offer.version}-${offer.sha256}.exe`);
  const partialPath = `${finalPath}.part`;
  windowsDownloadPartialPath = partialPath;
  fs.mkdirSync(directory, { recursive: true });

  // If a verified final already exists, skip the download.
  try {
    const finalStat = await fs.promises.stat(finalPath);
    if (finalStat.isFile() && finalStat.size === offer.sizeBytes) {
      const finalHash = await sha256File(finalPath);
      if (finalHash === offer.sha256) {
        downloadedWindowsInstaller = { ...offer, path: finalPath };
        windowsDownloadInProgress = false;
        return { ready: true };
      }
    }
  } catch {}

  // Only the blocks that changed, if this machine can supply the rest.
  try {
    const differential = await downloadWindowsInstallerDifferentially(event, offer);
    if (differential) {
      windowsDownloadInProgress = false;
      return { ready: true, differential: true };
    }
  } catch (error) {
    console.warn('[planner] differential update failed, downloading in full:', error && error.message);
  }

  // Determine resume offset from any existing partial.
  let startBytes = 0;
  try {
    const st = await fs.promises.stat(partialPath);
    if (st.isFile() && st.size > 0 && st.size < offer.sizeBytes) startBytes = st.size;
    else if (st.isFile() && st.size >= offer.sizeBytes) {
      // Stale or over-sized partial — verify before discarding; otherwise start over.
      if (st.size === offer.sizeBytes) {
        const h = await sha256File(partialPath).catch(() => null);
        if (h === offer.sha256) {
          await fs.promises.rm(finalPath, { force: true }).catch(() => {});
          await fs.promises.rename(partialPath, finalPath).catch(() => {});
          downloadedWindowsInstaller = { ...offer, path: finalPath };
          windowsDownloadInProgress = false;
          return { ready: true };
        }
      }
      await fs.promises.rm(partialPath, { force: true }).catch(() => {});
      startBytes = 0;
    }
  } catch {
    startBytes = 0;
  }

  // Prepare hash — if resuming, feed the existing bytes first.
  const digest = createHash('sha256');
  if (startBytes > 0) {
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(partialPath, { start: 0, end: startBytes - 1 });
      stream.on('data', (chunk) => digest.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
  }

  windowsDownloadAbort = new AbortController();
  const signal = windowsDownloadAbort.signal;
  let bytesReceived = startBytes;
  let lastProgressAt = 0;
  let lastSpeedAt = Date.now();
  let lastSpeedBytes = startBytes;
  let speedBps = null;

  const sendProgress = (force = false) => {
    const now = Date.now();
    const elapsed = (now - lastSpeedAt) / 1000;
    if (elapsed >= 0.35 || force || bytesReceived === offer.sizeBytes) {
      const delta = bytesReceived - lastSpeedBytes;
      const instant = elapsed > 0 ? delta / elapsed : 0;
      if (speedBps == null) speedBps = instant;
      else if (delta > 0) speedBps = speedBps * 0.55 + instant * 0.45;
      lastSpeedAt = now;
      lastSpeedBytes = bytesReceived;
    }
    windowsDownloadBytesReceived = bytesReceived;
    if (!event.sender.isDestroyed()) {
      if (force || now - lastProgressAt > 180 || bytesReceived === offer.sizeBytes) {
        lastProgressAt = now;
        event.sender.send('planner:update-progress', {
          bytesReceived,
          totalBytes: offer.sizeBytes,
          speedBps: speedBps != null && Number.isFinite(speedBps) ? Math.round(speedBps) : null,
        });
      }
    }
  };

  // Initial progress so the bar jumps to the resumed offset immediately.
  sendProgress(true);

  try {
    const headers = { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' };
    if (startBytes > 0) headers.Range = `bytes=${startBytes}-`;
    const response = await net.fetch(offer.downloadUrl, { headers, signal });
    // Handle Range support
    if (startBytes > 0 && response.status === 200) {
      // Server ignored Range — discard partial and restart from 0.
      await fs.promises.rm(partialPath, { force: true }).catch(() => {});
      windowsDownloadAbort = null;
      windowsDownloadInProgress = false;
      // recurse as a fresh download (will not have partial now)
      return downloadWindowsInstaller(event, offer);
    }
    if (startBytes > 0 && response.status !== 206 && response.status !== 200) {
      throw new Error(`The installer download returned HTTP ${response.status}.`);
    }
    if (!response.ok || !response.body) throw new Error(`The installer download returned HTTP ${response.status}.`);
    if (response.url && !isTrustedUpdateUrl(response.url)) throw new Error('The installer redirected to an untrusted host.');
    const declaredSize = Number(response.headers.get('content-length'));
    // For 206, content-length is the remaining bytes; for 200 it's total.
    const expectedRemaining = offer.sizeBytes - startBytes;
    if (Number.isFinite(declaredSize) && declaredSize > 0) {
      if (response.status === 206 && declaredSize !== expectedRemaining) {
        // tolerate mismatched range length but ensure we don't exceed total
        if (declaredSize > expectedRemaining) throw new Error('The installer size does not match the update feed.');
      } else if (response.status === 200 && declaredSize !== offer.sizeBytes) {
        throw new Error('The installer size does not match the update feed.');
      }
    }

    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        if (signal.aborted) {
          callback(new Error(signal.reason || 'aborted'));
          return;
        }
        bytesReceived += chunk.length;
        if (bytesReceived > offer.sizeBytes) {
          callback(new Error('The installer is larger than the update feed declares.'));
          return;
        }
        digest.update(chunk);
        sendProgress(false);
        callback(null, chunk);
      },
    });

    const writeFlags = startBytes > 0 ? 'a' : 'wx';
    // If appending, ensure file exists; if wx and file exists we already handled partial.
    const out = fs.createWriteStream(partialPath, { flags: writeFlags });
    await pipeline(Readable.fromWeb(response.body), progress, out);

    // Final flush of progress
    sendProgress(true);

    if (bytesReceived !== offer.sizeBytes) throw new Error('The installer download ended before the expected size.');
    const hex = digest.digest('hex');
    if (hex !== offer.sha256) throw new Error('The installer checksum does not match the update feed.');
    await fs.promises.rm(finalPath, { force: true }).catch(() => {});
    await fs.promises.rename(partialPath, finalPath);
    downloadedWindowsInstaller = { ...offer, path: finalPath };
    windowsDownloadOffer = null;
    windowsDownloadPartialPath = null;
    return { ready: true };
  } catch (error) {
    const isAbort = signal.aborted || (error && (error.name === 'AbortError' || String(error.message).toLowerCase().includes('aborted')));
    if (windowsDownloadPaused && isAbort) {
      // Paused — keep the partial for resume.
      return { paused: true };
    }
    if (windowsDownloadCanceled && isAbort) {
      await fs.promises.rm(partialPath, { force: true }).catch(() => {});
      windowsDownloadOffer = null;
      windowsDownloadPartialPath = null;
      return { canceled: true };
    }
    // Network / transient error — keep partial so the next attempt resumes.
    // Only delete on validation errors (size/sha mismatch) which throw with specific messages.
    const msg = error instanceof Error ? error.message : String(error);
    const isValidation = msg.includes('checksum') || msg.includes('larger than') || msg.includes('ended before');
    if (isValidation) {
      await fs.promises.rm(partialPath, { force: true }).catch(() => {});
      windowsDownloadOffer = null;
      windowsDownloadPartialPath = null;
    } else {
      // keep partial and offer for resume; ensure progress reflects current bytes
      sendProgress(true);
    }
    throw error;
  } finally {
    windowsDownloadAbort = null;
    // Don't clear inProgress if we are paused — the download is still considered active and resumption will reuse the same slot.
    if (!windowsDownloadPaused || windowsDownloadCanceled) {
      windowsDownloadInProgress = false;
      if (windowsDownloadCanceled) {
        windowsDownloadPaused = false;
        windowsDownloadCanceled = false;
      }
    } else if (windowsDownloadPaused) {
      // keep inProgress true so a second concurrent download is still blocked
    } else {
      windowsDownloadInProgress = false;
    }
  }
}

async function installWindowsUpdate(event, untrustedOffer) {
  assertUpdateSender(event);
  const offer = validateWindowsOffer(untrustedOffer);
  if (!offer || !sameWindowsOffer(offer, currentWindowsOffer) || !sameWindowsOffer(offer, downloadedWindowsInstaller)) {
    throw new Error('Download and verify the update before installing it.');
  }
  const file = downloadedWindowsInstaller.path;
  const stat = await fs.promises.stat(file).catch(() => null);
  if (!stat?.isFile() || stat.size !== offer.sizeBytes || await sha256File(file) !== offer.sha256) {
    downloadedWindowsInstaller = null;
    throw new Error('The downloaded installer failed its final integrity check.');
  }

  // NSIS upgrades the same per-user installation (never uninstall first). The
  // installer keeps the app's userData directory and reopens Planner when done
  // (electron-builder.yml: nsis.runAfterFinish: true). The app must be fully
  // closed before the installer replaces the executable, so give the spawn a
  // moment to settle before quitting. A detached installer survives the quit
  // and launches the new version — no manual reopen required.
  const installer = spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    installer.once('spawn', resolve);
    installer.once('error', reject);
  });
  installer.unref();
  // 800 ms is enough for the detached process to be re-parented on Windows;
  // the previous 350 ms occasionally quit before the OS had adopted the child,
  // leaving a finished install with no window and a user who had to click
  // the desktop icon again — which, before the second-instance fix above,
  // did nothing while the tray icon was still hidden.
  setTimeout(() => {
    quitting = true;
    app.quit();
  }, 800);
  return { started: true };
}

// ── Where the window keeps its size and place ──────────────────────────────

function stateFile() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function readWindowState() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (typeof state.width === 'number' && typeof state.height === 'number') return state;
  } catch {
    /* first run */
  }
  return { width: 1180, height: 820 };
}

function saveWindowState(win) {
  try {
    const bounds = win.getNormalBounds();
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(bounds));
  } catch {
    /* a window that cannot remember its size is not a reason to crash */
  }
}

// ── Staying in the background, and reminders (docs/DESKTOP.md §9) ──────────

/**
 * Closing the window hides Planner instead of quitting it, so reminders keep
 * arriving; the tray icon brings it back and quitting is always a menu item
 * away. This lives in the app's own preferences file, not in the planner
 * vault: it describes this installation, not the planner.
 */
function preferencesFile() {
  return path.join(app.getPath('userData'), PREFERENCES_FILE);
}

let preferences = { ...DEFAULT_PREFERENCES };
let quitting = false;
let tray = null;
/** The page's reminder schedule, newest sync wins. */
let reminderSchedule = [];
let reminderTimer = null;

function loadPreferences() {
  try {
    preferences = normalizePreferences(JSON.parse(fs.readFileSync(preferencesFile(), 'utf8')));
  } catch {
    preferences = { ...DEFAULT_PREFERENCES };
  }
  return preferences;
}

function savePreferences(next) {
  preferences = normalizePreferences(next);
  try {
    fs.mkdirSync(path.dirname(preferencesFile()), { recursive: true });
    fs.writeFileSync(preferencesFile(), JSON.stringify(preferences));
  } catch {
    /* a preference that cannot be written still holds for this session */
  }
  broadcastPreferences();
  return preferences;
}

function broadcastPreferences() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('planner:preferences-changed', preferences);
  }
}

function showWindow() {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return win;
}

function trayImage() {
  const file = path.join(__dirname, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) return nativeImage.createEmpty();
  return process.platform === 'darwin' ? image.resize({ width: 18, height: 18 }) : image.resize({ width: 16, height: 16 });
}

function buildTray() {
  if (tray) return;
  try {
    tray = new Tray(trayImage());
  } catch {
    // A headless session (CI, a container) has no tray to show; background
    // mode still works, there is just no icon to click.
    return;
  }
  const refresh = () => {
    if (!tray) return;
    tray.setToolTip(preferences.background ? 'Planner — reminders on' : 'Planner');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Planner', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Keep running when the window closes',
        type: 'checkbox',
        checked: preferences.background,
        click: (item) => { savePreferences({ ...preferences, background: item.checked }); refresh(); },
      },
      { type: 'separator' },
      { label: 'Quit Planner', click: () => { quitting = true; app.quit(); } },
    ]));
  };
  refresh();
  tray.on('click', () => showWindow());
}

function destroyTray() {
  if (!tray) return;
  tray.destroy();
  tray = null;
}

/**
 * Fire everything that is due, then wait for the next one.
 *
 * Timers do not survive a sleeping machine, so the guard below is a real one:
 * whatever happens, each fire recomputes the wait from the schedule's own
 * timestamps rather than trusting an interval to have kept time.
 */
function scheduleReminders() {
  if (reminderTimer) {
    clearTimeout(reminderTimer);
    reminderTimer = null;
  }
  const now = Date.now();
  for (const reminder of dueReminders(reminderSchedule, now)) {
    notify(reminder);
    reminderSchedule = reminderSchedule.filter((entry) => entry.key !== reminder.key);
  }
  const wait = msUntilNext(reminderSchedule, Date.now());
  if (wait === null) return;
  // setTimeout overflows past ~24.8 days; `msUntilNext` never returns more than
  // the horizon, but clamp anyway so a bad schedule cannot fire immediately.
  reminderTimer = setTimeout(scheduleReminders, Math.min(Math.max(wait, 250), 12 * 60 * 60 * 1000));
}

function notify(reminder) {
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({ title: reminder.title, body: reminder.body, silent: false });
    notification.on('click', () => showWindow());
    notification.show();
  } catch {
    /* a failed notification must never take the app down */
  }
}

/** The one-time explanation that a close button did not quit the app. */
function explainBackground() {
  if (preferences.backgroundExplained) return;
  savePreferences({ ...preferences, backgroundExplained: true });
  if (!Notification.isSupported()) return;
  try {
    const notification = new Notification({
      title: 'Planner is still running',
      body: 'Reminders keep arriving while the window is closed. Quit from the tray icon, or turn this off in Settings → App.',
    });
    notification.on('click', () => showWindow());
    notification.show();
  } catch {
    /* the setting is already saved; the notice is a courtesy */
  }
}

// ── The bundled app, served the way a web server would ─────────────────────

/**
 * Serve `app://planner/...` out of the bundle. `/app`, `/login` and the other
 * routes resolve to index.html (see lib.cjs), exactly as they do in the
 * Android and iOS shells, and every response carries the same shape of policy
 * the deployment sends.
 */
function registerAppProtocol() {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = resolveRequestedFile(url.pathname, WEB_ROOT);
    if (!file) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Type', contentType(file));
    if (file.endsWith('.html')) headers.set('Content-Security-Policy', contentSecurityPolicy(config.apiOrigin));
    headers.set('Cache-Control', 'no-store');
    return new Response(response.body, { status: response.status, headers });
  });
}

// ── Links, permissions, navigation ─────────────────────────────────────────

function openExternally(value) {
  if (isHttpUrl(value)) void shell.openExternal(value);
}

function hardenSession() {
  const ses = session.defaultSession;
  // Nothing but the app itself may ask for a device: the microphone backs the
  // voice features, notifications back the reminders, and the rest is denied.
  const allowed = new Set(['media', 'notifications']);
  ses.setPermissionRequestHandler((_contents, permission, callback, details) => {
    const requesting = details?.requestingUrl ?? '';
    callback(allowed.has(permission) && isInternal(requesting));
  });
  ses.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    return allowed.has(permission) && isInternal(requestingOrigin);
  });
  // No page in this app needs a camera, a location or a USB device.
  ses.setDevicePermissionHandler(() => false);
}

// ── The window ─────────────────────────────────────────────────────────────

function createWindow() {
  const state = readWindowState();
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 360,
    minHeight: 520,
    title: 'Planner',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171410' : '#F5F0E7',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      // The planner is a web app; it never needs a second renderer.
      webviewTag: false,
    },
  });

  mainWindow = win;

  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    saveWindowState(win);
    // The close button means "hide" while background mode is on: the process
    // has to outlive the window for reminders to keep arriving. Quit is always
    // available — the tray menu, and File → Quit when the window is open.
    if (quitting || !preferences.background) return;
    event.preventDefault();
    win.hide();
    explainBackground();
  });
  win.on('closed', () => {
    mainWindow = null;
  });

  // Links to the outside world open in the user's browser, not in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isInternal(url)) return;
    event.preventDefault();
    openExternally(url);
  });
  // A failed load should say what happened instead of showing a white window.
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted */) return;
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        title: 'Planner could not open',
        message: `The app could not be loaded (${description}).`,
        detail: [
          url,
          '',
          'If this copy is set up to load a deployment, check that the address is reachable.',
          'The bundled copy works offline: build with no PLANNER_APP_URL and the app starts from what is inside the installer.',
        ].join('\n'),
        buttons: ['Retry', 'Quit'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) win.reload();
        else app.quit();
      });
  });

  const target = config.devServer || config.appUrl || `${LOCAL_ORIGIN}/app`;
  void win.loadURL(target);
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        // "Close" hides the window when background mode is on, so quitting has
        // its own labelled item rather than relying on the close button.
        { label: 'Close window', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.close() },
        ...(isMac ? [] : [{ label: 'Quit Planner', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } }]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      role: 'help',
      submenu: [
        { label: 'Check for updates', click: () => openExternally(RELEASES_URL) },
        { label: 'Planner guide', click: () => openExternally(GUIDE_URL) },
        { type: 'separator' },
        {
          label: 'About Planner',
          click: () => {
            void dialog.showMessageBox({
              type: 'info',
              title: 'About Planner',
              message: `Planner ${app.getVersion()}`,
              detail: [
                'A calm, local-first planner. Your data stays on this device, encrypted, unless you switch on sync.',
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              ].join('\n'),
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Start-up ───────────────────────────────────────────────────────────────

// Must run before `app.whenReady()`: the bundled app is served from a custom
// scheme, which has to be declared privileged to count as a secure context
// (WebCrypto — and so the encrypted vault — depends on that).
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
  },
]);

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Clicking the desktop shortcut while Planner is hidden in the tray must
  // bring the window back — otherwise the app looks like it failed to open.
  app.on('second-instance', () => {
    showWindow();
  });

  app.whenReady().then(() => {
    registerAppProtocol();
    hardenSession();
    buildMenu();
    // The two calls the preload exposes. Both are checked here, in the main
    // process, because the page is not trusted to police itself.
    ipcMain.handle('planner:app-version', () => app.getVersion());
    ipcMain.handle('planner:open-external', (_event, url) => {
      if (typeof url === 'string' && isHttpUrl(url)) void shell.openExternal(url);
      return true;
    });
    ipcMain.handle('planner:preferences-get', () => preferences);
    ipcMain.handle('planner:preferences-set', (_event, patch) => {
      const next = patch && typeof patch === 'object' ? { ...preferences, ...patch } : preferences;
      const saved = savePreferences(next);
      if (saved.background) buildTray();
      else destroyTray();
      return saved;
    });
    ipcMain.handle('planner:reminders-set', (_event, schedule) => {
      reminderSchedule = normalizeReminderSchedule(schedule);
      scheduleReminders();
      return { scheduled: reminderSchedule.length };
    });
    ipcMain.handle('planner:update-manifest', async (event) => {
      assertUpdateSender(event);
      return fetchWindowsUpdateManifest();
    });
    ipcMain.handle('planner:update-download', (event, offer) => downloadWindowsInstaller(event, offer));
    ipcMain.handle('planner:update-install', (event, offer) => installWindowsUpdate(event, offer));
    ipcMain.handle('planner:update-pause', async (event) => {
      assertUpdateSender(event);
      if (!windowsDownloadInProgress || windowsDownloadPaused) throw new Error('No active download to pause.');
      windowsDownloadPaused = true;
      windowsDownloadAbort?.abort();
      // Give the pipeline a tick to notice the abort and keep the partial.
      await new Promise((r) => setTimeout(r, 60));
      if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send('planner:update-progress', { bytesReceived: windowsDownloadBytesReceived, totalBytes: windowsDownloadOffer?.sizeBytes ?? null, speedBps: null }); } catch {}
      }
      return { paused: true };
    });
    ipcMain.handle('planner:update-resume', async (event) => {
      assertUpdateSender(event);
      if (!windowsDownloadPaused || !windowsDownloadOffer) throw new Error('No paused download to resume.');
      windowsDownloadPaused = false;
      // The actual resume happens when the renderer re-calls downloadUpdate with the same offer.
      // We just unblock the slot so the next download can re-enter and use Range.
      windowsDownloadInProgress = false;
      windowsDownloadAbort = null;
      return { resumed: true };
    });
    ipcMain.handle('planner:update-cancel', async (event) => {
      assertUpdateSender(event);
      if (!windowsDownloadInProgress && !windowsDownloadPaused) throw new Error('No download to cancel.');
      windowsDownloadCanceled = true;
      windowsDownloadPaused = false;
      windowsDownloadAbort?.abort();
      const p = windowsDownloadPartialPath || (windowsDownloadOffer ? path.join(app.getPath('temp'), 'Planner-update', `${windowsDownloadOffer.version}-${windowsDownloadOffer.sha256}.exe.part`) : null);
      await new Promise((r) => setTimeout(r, 60));
      if (p) await fs.promises.rm(p, { force: true }).catch(() => {});
      windowsDownloadOffer = null;
      windowsDownloadPartialPath = null;
      windowsDownloadInProgress = false;
      windowsDownloadAbort = null;
      windowsDownloadPaused = false;
      windowsDownloadCanceled = false;
      windowsDownloadBytesReceived = 0;
      return { canceled: true };
    });
    loadPreferences();
    if (preferences.background) buildTray();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
      else showWindow();
    });
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('window-all-closed', () => {
    // With background mode on the window may close while the process stays;
    // the tray icon is the way back in. Otherwise this is an ordinary quit.
    if (preferences.background && !quitting) return;
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    if (reminderTimer) clearTimeout(reminderTimer);
    reminderTimer = null;
    destroyTray();
  });
}
