/**
 * Native <dialog> helpers shared by the shell and the editor: a heading with a close button,
 * showModal() with focus returned to the trigger, and delegated handlers that close any dialog
 * (including ones created later by other modules) on a backdrop click or [data-action=close-dialog].
 */
import { icon } from '../icons';
import { esc } from './dom';

export function dialogHeading(id: string, title: string): string {
  return `<div class="dialog-heading"><h2 id="${id}">${esc(title)}</h2>`
    + `<button type="button" class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>`;
}

const isShown = (el: HTMLElement): boolean => el.isConnected && el.getClientRects().length > 0;

function modalOpen(): boolean {
  try { return !!document.querySelector('dialog:modal'); } catch { return !!document.querySelector('dialog[open]:not(#app-menu)'); }
}

/**
 * Opens `dialog` modally. When it closes, focus returns to the element that had it, or to
 * `fallback()` when that element is gone or hidden (e.g. a re-rendered row).
 */
export function openDialog(dialog: HTMLDialogElement, fallback?: () => HTMLElement | null | undefined): void {
  if (dialog.open) return;
  const trigger = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : undefined;
  dialog.showModal();
  dialog.addEventListener('close', () => {
    // Wait for the browser's own focus fixup, then correct it if needed.
    requestAnimationFrame(() => {
      if (modalOpen()) return;
      // Something else took focus on purpose (e.g. a toast action): leave it there.
      const active = document.activeElement;
      if (active && active !== document.body && active !== trigger && !dialog.contains(active)) return;
      const target = trigger && isShown(trigger) ? trigger : fallback?.();
      if (target && isShown(target)) target.focus({ preventScroll: true });
    });
  }, { once: true });
}

export function closeAllDialogs(): void {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(dialog => dialog.close());
}

/** Backdrop clicks and close buttons, for every dialog in the document. */
export function installDialogHandlers(): void {
  document.addEventListener('click', event => {
    const target = event.target as Element | null;
    if (!target) return;
    const close = target.closest('[data-action="close-dialog"]');
    if (close) { close.closest('dialog')?.close(); return; }
    if (!(target instanceof HTMLDialogElement) || !target.open) return;
    // A click on the dialog element itself outside its box is a backdrop click.
    // Keyboard-generated clicks report 0,0 and are ignored.
    if (event.clientX === 0 && event.clientY === 0) return;
    const r = target.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) target.close();
  });
}
