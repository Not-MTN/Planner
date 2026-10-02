/**
 * The parts of the desktop app that are plain logic, kept apart from Electron
 * so they can be tested without a display, a download or a running app:
 * which file a request maps to, what headers it gets, and whether a URL is
 * this app or the outside world.
 *
 * `main.cjs` is the only consumer.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Trim and drop trailing slashes; `''` when there is nothing usable. */
function normalizeAddress(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * The origin of a URL, built from its parts.
 *
 * `new URL(...).origin` is "null" for a custom scheme such as `app://` outside
 * Chromium — and Chromium is exactly where it matters. Composing protocol and
 * host gives the same answer for http(s) and a correct one for `app://`.
 */
function originOf(value) {
  try {
    const url = new URL(value);
    if (!url.host) return null;
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

/** True when `value` belongs to the app the window is currently showing. */
function isInternal(value, appOrigin, scheme = 'app') {
  if (!isHttpUrl(value) && !value.startsWith(`${scheme}://`)) return false;
  const origin = originOf(value);
  return origin !== null && origin === appOrigin;
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.webmanifest': return 'application/manifest+json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.gif': return 'image/gif';
    case '.ico': return 'image/x-icon';
    case '.woff2': return 'font/woff2';
    case '.woff': return 'font/woff';
    case '.ttf': return 'font/ttf';
    case '.txt': return 'text/plain; charset=utf-8';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

/**
 * The policy the bundled copy runs under, mirroring vercel.json's for the
 * deployment. `apiOrigin` is the deployment's address when this build was
 * configured with one.
 */
function contentSecurityPolicy(apiOrigin = '') {
  // api.github.com is where the app asks whether a newer release exists
  // (src/shared/updates.ts). Nothing is sent there but the request itself.
  const connect = [
    "'self'",
    normalizeAddress(apiOrigin),
    'https://api.open-meteo.com',
    'https://geocoding-api.open-meteo.com',
    'https://api.github.com',
  ]
    .filter(Boolean)
    .join(' ');
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src ${connect}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self'",
  ].join('; ');
}

/**
 * `/app`, `/login`, `/recover` … have no file of their own, so a path with no
 * extension resolves to index.html — the same rule the Android and iOS shells
 * use. A path with an extension that is not there is a genuine 404, and a path
 * that tries to climb out of the bundle is refused.
 *
 * Returns an absolute file path, or null when nothing should be served.
 */
function resolveRequestedFile(pathname, webRoot) {
  const root = path.resolve(webRoot);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    decoded = pathname;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) return null;
  if (candidate === root) return path.join(root, 'index.html');
  try {
    if (fs.statSync(candidate).isFile()) return candidate;
  } catch {
    /* not a file — maybe a route */
  }
  if (path.extname(candidate)) return null;
  const shell = path.join(root, 'index.html');
  return fs.existsSync(shell) ? shell : null;
}

module.exports = { contentType, contentSecurityPolicy, isHttpUrl, isInternal, normalizeAddress, originOf, resolveRequestedFile };
