/// <reference types="vite/client" />

// App Badging API (Chromium/Edge/Safari 16.4+ partial)
interface Navigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}
