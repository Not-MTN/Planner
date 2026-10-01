/**
 * The one way to hand the user a file.
 *
 * Two details matter, and both bit the three copies this replaces:
 *
 * - The link goes into the document before it is clicked. Firefox and Safari
 *   ignore a click on a detached anchor.
 * - The object URL is revoked a tick later, not straight after the click.
 *   Revoking in the same task cancels the download in Safari, which is exactly
 *   when a user is most likely to be exporting a backup they need.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
