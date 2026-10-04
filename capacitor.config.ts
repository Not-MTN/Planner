/**
 * The native shells (Android, iOS) that wrap the Planner web app.
 *
 * Two ways to ship a phone app, chosen by one environment variable:
 *
 *   PLANNER_APP_URL set      → the shell loads that URL. The whole app —
 *                             accounts, sync, AI — is same-origin with the
 *                             server, so nothing else needs configuring.
 *                             (Requires the device to be online the first time;
 *                             the service worker then keeps it working offline.)
 *
 *   PLANNER_APP_URL unset    → the shell loads the bundled `dist/` copy, so it
 *                             starts instantly and works offline with no network
 *                             at all. Accounts, sync and AI need the API origin:
 *                             build with PLANNER_API_ORIGIN and add the shell
 *                             origins to PLANNER_APP_ORIGINS on the server
 *                             (see docs/APPS.md).
 *
 * `npm run native:sync` fills both in from the environment; open this file by
 * hand only when changing something the script does not cover.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const appUrl = (process.env.PLANNER_APP_URL ?? '').trim().replace(/\/+$/, '');

const config: CapacitorConfig = {
  appId: 'com.notmtn.planner',
  appName: 'Planner',
  webDir: 'dist',
  // Matches the manifest and the app's own paper background, so the hand-off
  // from splash to first paint has no flash of a different colour.
  backgroundColor: '#F5F0E7',
  android: {
    // Local assets are served over https://localhost by the WebView: a secure
    // context, which WebCrypto (the encrypted vault) requires.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  ios: {
    contentInset: 'always',
    // Same reason as Android: keep every origin the app talks to on https.
    limitsNavigationsToAppBoundDomains: false,
  },
  server: appUrl
    ? {
        url: appUrl,
        cleartext: false,
        androidScheme: 'https',
      }
    : {
        androidScheme: 'https',
        iosScheme: 'capacitor',
      },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      launchAutoHide: true,
      backgroundColor: '#F5F0E7FF',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'DEFAULT',
      overlaysWebView: false,
    },
    LocalNotifications: {
      presentationOptions: ['banner', 'list', 'sound'],
    },
  },
};

export default config;
