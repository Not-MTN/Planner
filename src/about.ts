/**
 * Tiny pub-sub for the "Why Planner?" sheet (the app's about/value page).
 * Kept parallel to tour.ts's replay bus so any surface can open it without
 * prop drilling: sidebar, More sheet, Settings, and the tour's last step.
 */

const aboutListeners = new Set<() => void>();

/** Ask the shell to open the Why Planner sheet. */
export function requestAbout(): void {
  aboutListeners.forEach((listener) => listener());
}

export function onAboutRequest(listener: () => void): () => void {
  aboutListeners.add(listener);
  return () => aboutListeners.delete(listener);
}
