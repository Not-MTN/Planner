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

const { app, BrowserWindow, Menu, dialog, ipcMain, nativeTheme, net, protocol, session, shell } = require('electron');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { pathToFileURL } = require('node:url');
const {
  contentType,
  contentSecurityPolicy,
  isHttpUrl,
  isInternal: isInternalUrl,
  isTrustedUpdateUrl,
  normalizeAddress,
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

async function downloadWindowsInstaller(event, untrustedOffer) {
  assertUpdateSender(event);
  const offer = validateWindowsOffer(untrustedOffer);
  if (!offer || !sameWindowsOffer(offer, currentWindowsOffer)) {
    throw new Error('The requested installer does not match the latest verified update feed.');
  }
  if (windowsDownloadInProgress) throw new Error('An update download is already in progress.');
  windowsDownloadInProgress = true;

  const directory = path.join(app.getPath('temp'), 'Planner-update');
  const finalPath = path.join(directory, `${offer.version}-${offer.sha256}.exe`);
  const partialPath = `${finalPath}.part`;
  fs.mkdirSync(directory, { recursive: true });
  await fs.promises.rm(partialPath, { force: true });

  try {
    const response = await net.fetch(offer.downloadUrl, {
      headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' },
    });
    if (!response.ok || !response.body) throw new Error(`The installer download returned HTTP ${response.status}.`);
    if (response.url && !isTrustedUpdateUrl(response.url)) throw new Error('The installer redirected to an untrusted host.');
    const declaredSize = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize !== offer.sizeBytes) {
      throw new Error('The installer size does not match the update feed.');
    }

    const digest = createHash('sha256');
    let bytesReceived = 0;
    let lastProgressAt = 0;
    const progress = new Transform({
      transform(chunk, _encoding, callback) {
        bytesReceived += chunk.length;
        if (bytesReceived > offer.sizeBytes) {
          callback(new Error('The installer is larger than the update feed declares.'));
          return;
        }
        digest.update(chunk);
        const now = Date.now();
        if (now - lastProgressAt > 120 || bytesReceived === offer.sizeBytes) {
          lastProgressAt = now;
          if (!event.sender.isDestroyed()) {
            event.sender.send('planner:update-progress', { bytesReceived, totalBytes: offer.sizeBytes });
          }
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), progress, fs.createWriteStream(partialPath, { flags: 'wx' }));
    if (bytesReceived !== offer.sizeBytes) throw new Error('The installer download ended before the expected size.');
    if (digest.digest('hex') !== offer.sha256) throw new Error('The installer checksum does not match the update feed.');
    await fs.promises.rm(finalPath, { force: true });
    await fs.promises.rename(partialPath, finalPath);
    downloadedWindowsInstaller = { ...offer, path: finalPath };
    return { ready: true };
  } catch (error) {
    await fs.promises.rm(partialPath, { force: true });
    throw error;
  } finally {
    windowsDownloadInProgress = false;
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
  // installer keeps the app's userData directory and reopens Planner when done.
  const installer = spawn(file, ['/S'], { detached: true, stdio: 'ignore', windowsHide: true });
  await new Promise((resolve, reject) => {
    installer.once('spawn', resolve);
    installer.once('error', reject);
  });
  installer.unref();
  setTimeout(() => app.quit(), 350);
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
  win.on('close', () => saveWindowState(win));
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
      submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
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
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
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
    ipcMain.handle('planner:update-manifest', async (event) => {
      assertUpdateSender(event);
      return fetchWindowsUpdateManifest();
    });
    ipcMain.handle('planner:update-download', (event, offer) => downloadWindowsInstaller(event, offer));
    ipcMain.handle('planner:update-install', (event, offer) => installWindowsUpdate(event, offer));
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
