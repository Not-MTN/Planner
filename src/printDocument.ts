/**
 * Printing, without letting the app walk onto the page.
 *
 * A report is printed from a window of its own. Printing the app itself would
 * drag its sidebar, colours and navigation onto paper, and there is no way to
 * ask a stylesheet to keep some of it. A separate document has no such problem:
 * it is a page first and a screen second, and the browser's own print dialogue
 * does the rest — including "save as PDF".
 *
 * Returns false when the window could not be opened, which normally means
 * pop-ups are blocked. Callers must handle that rather than doing nothing: a
 * button that appears to work and prints nothing is worse than no button.
 */
export function printDocument(html: string): boolean {
  if (typeof window === 'undefined') return false;
  const win = window.open('', '_blank', 'noopener,noreferrer');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
  return true;
}
