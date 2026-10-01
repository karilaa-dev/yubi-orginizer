/**
 * The single app toast (#toast, role=status, aria-live=polite).
 * One toast at a time: a new toast replaces the current one. It hides after 6 s,
 * or 10 s when it has an action, and the timer pauses while the toast is hovered
 * or contains focus. The region is created on first use (or reuses an existing
 * #toast element) and moves into an open modal dialog so its action stays clickable.
 */
import './shared.css';
import { esc } from './dom';

export interface ToastAction {
  label: string;
  run(): void;
  /**
   * May Ctrl/Cmd+Z run this action (runToastAction)? Defaults to true only for "Undo", so the
   * shortcut never opens, navigates or reloads. A function is asked when the shortcut is pressed.
   * The button itself always runs the action.
   */
  shortcut?: boolean | (() => boolean);
}

const DEFAULT_MS = 6_000;
const ACTION_MS = 10_000;
/** After hover/focus leaves, a toast stays at least this long. */
const RESUME_MIN_MS = 2_000;
/** A live region that was just inserted needs a moment before screen readers announce changes in it. */
const FRESH_REGION_DELAY_MS = 60;

interface Current { action?: ToastAction; remaining: number; startedAt: number; timer?: ReturnType<typeof setTimeout> }

let region: HTMLElement | undefined;
let current: Current | undefined;
let showTimer: ReturnType<typeof setTimeout> | undefined;
let hovered = false;

function wire(el: HTMLElement): void {
  el.addEventListener('pointerenter', () => { hovered = true; pause(); });
  el.addEventListener('pointerleave', () => { hovered = false; if (!el.contains(document.activeElement)) resume(); });
  el.addEventListener('focusin', pause);
  el.addEventListener('focusout', event => {
    if (!el.contains(event.relatedTarget as Node | null) && !hovered) resume();
  });
  el.addEventListener('click', event => {
    if ((event.target as Element).closest('.toast-action')) runCurrent();
  });
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.stopPropagation(); hideToast(); }
  });
}

/** Creates (or adopts) the #toast live region. Call early at boot so the first toast is announced reliably. */
export function ensureToastRegion(): HTMLElement {
  if (region?.isConnected) return region;
  const el = document.getElementById('toast') ?? document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.removeAttribute('hidden');
  el.replaceChildren();
  if (!el.isConnected) document.body.append(el);
  if (el !== region) wire(el);
  region = el;
  return el;
}

function topModalDialog(): HTMLDialogElement | undefined {
  try {
    const open = document.querySelectorAll<HTMLDialogElement>('dialog:modal');
    return open.length ? open[open.length - 1] : undefined;
  } catch { return undefined; } // :modal is not supported
}

/** Content outside a modal dialog is inert, so the toast lives inside the top dialog while one is open. Returns true when moved. */
function place(el: HTMLElement): boolean {
  const host: HTMLElement = topModalDialog() ?? document.body;
  if (el.parentElement === host) return false;
  host.append(el);
  if (host instanceof HTMLDialogElement) {
    host.addEventListener('close', () => { if (el.parentElement === host) document.body.append(el); }, { once: true });
  }
  return true;
}

function startTimer(ms: number): void {
  if (!current) return;
  clearTimeout(current.timer);
  current.remaining = ms;
  current.startedAt = Date.now();
  current.timer = setTimeout(hideToast, ms);
}

function pause(): void {
  if (!current?.timer) return;
  clearTimeout(current.timer);
  current.timer = undefined;
  current.remaining -= Date.now() - current.startedAt;
}

function resume(): void {
  if (!current || current.timer || !region?.firstChild) return;
  startTimer(Math.max(current.remaining, RESUME_MIN_MS));
}

export function toast(message: string, options: { action?: ToastAction; duration?: number } = {}): void {
  if (typeof document === 'undefined') return;
  clearTimeout(showTimer);
  if (current) clearTimeout(current.timer);
  const existed = !!region?.isConnected;
  const el = ensureToastRegion();
  const moved = place(el);
  const duration = options.duration ?? (options.action ? ACTION_MS : DEFAULT_MS);
  const entry: Current = { action: options.action, remaining: duration, startedAt: 0 };
  current = entry;
  const action = options.action ? `<button type="button" class="toast-action">${esc(options.action.label)}</button>` : '';
  const show = (): void => {
    if (current !== entry) return;
    el.innerHTML = `<div class="toast-surface"><span class="toast-message">${esc(message)}</span>${action}</div>`;
    if (hovered || el.contains(document.activeElement)) return; // paused until the pointer or focus leaves
    startTimer(duration);
  };
  if (!existed || moved) { el.replaceChildren(); showTimer = setTimeout(show, FRESH_REGION_DELAY_MS); } else show();
}

/** True when Ctrl/Cmd+Z may run `action` (see ToastAction.shortcut). */
export function toastShortcutAllowed(action: ToastAction): boolean {
  const allowed = action.shortcut ?? action.label === 'Undo';
  try { return typeof allowed === 'function' ? allowed() : allowed; } catch { return false; }
}

/** A toast with an action (Undo, Open…) is showing. */
export function hasActionToast(): boolean {
  // No DOM check: the toast briefly leaves the page while it moves into or out of a dialog.
  return !!current?.action;
}

/** Hides the toast and runs its action (the action button). True if an action ran. */
function runCurrent(): boolean {
  const action = current?.action;
  if (!action || !region?.firstChild) return false;
  hideToast();
  action.run();
  return true;
}

/**
 * Ctrl/Cmd+Z: runs the visible toast's action only when it allows the shortcut (Undo; see
 * ToastAction.shortcut) and hides the toast. True if an action ran. A toast left behind a modal
 * dialog (shown before the dialog opened) is inert there, so the shortcut leaves it alone.
 */
export function runToastAction(): boolean {
  const action = current?.action;
  if (!action || !region?.firstChild || !toastShortcutAllowed(action)) return false;
  const modal = topModalDialog();
  if (modal && !modal.contains(region)) return false;
  return runCurrent();
}

export function hideToast(): void {
  clearTimeout(showTimer);
  if (current) clearTimeout(current.timer);
  current = undefined;
  region?.replaceChildren();
}
