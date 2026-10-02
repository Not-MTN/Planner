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
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  contentType,
  contentSecurityPolicy,
  isHttpUrl,
  isInternal: isInternalUrl,
  normalizeAddress,
  resolveRequestedFile,
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

let mainWindow = null;

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
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
