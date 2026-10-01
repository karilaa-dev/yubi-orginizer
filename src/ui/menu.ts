/**
 * One shared action menu (#app-menu). Uses popover="auto" (top layer, light dismiss)
 * where supported and falls back to a non-modal <dialog> (Safari < 17).
 * role=menu with roving focus: Arrow keys, Home/End, type-ahead; Esc and Tab close
 * it and return focus to the trigger. At ≤760 px it is shown as a bottom action sheet.
 */
import './shared.css';
import { esc } from './dom';
import { icon } from '../icons';

export interface MenuItem {
  label: string;
  /** An icons.ts name ("copy") or raw SVG markup. */
  icon?: string;
  run?(): void;
  /** Stays focusable (aria-disabled) so its hint can be read. */
  disabled?: boolean;
  /** One line under the label, e.g. why the item is disabled. */
  hint?: string;
  danger?: boolean;
  separatorBefore?: boolean;
}

const SHEET_QUERY = '(max-width: 760px)';
/** A click on the trigger right after it light-dismissed its own menu should leave the menu closed. */
const RETOGGLE_MS = 350;
const EDGE = 8;
const GAP = 4;

let host: HTMLElement | undefined;
let menu: HTMLElement | undefined;
let title: HTMLElement | undefined;
let usePopover = false;
let trigger: HTMLElement | undefined;
let current: readonly MenuItem[] = [];
let closingByApi = false;
let lastDismissed: { trigger: HTMLElement; at: number } | undefined;

const supportsPopover = (): boolean => typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;
const itemButtons = (): HTMLButtonElement[] => (menu ? [...menu.querySelectorAll<HTMLButtonElement>('.menu-item')] : []);

function ensureHost(): HTMLElement {
  if (host?.isConnected) return host;
  usePopover = supportsPopover();
  const el: HTMLElement = document.createElement(usePopover ? 'div' : 'dialog');
  el.id = 'app-menu';
  el.className = 'menu-popover';
  if (usePopover) el.setAttribute('popover', 'auto');
  el.innerHTML = '<p class="menu-title" aria-hidden="true"></p><div class="menu" role="menu"></div>';
  document.body.append(el);
  el.addEventListener('click', onClick);
  el.addEventListener('keydown', onKeydown);
  // beforetoggle fires synchronously on light dismiss (outside click, Esc), before the trigger's click.
  if (usePopover) {
    el.addEventListener('beforetoggle', event => {
      if ((event as ToggleEvent).newState === 'closed' && !closingByApi) dismissed(el.contains(document.activeElement));
    });
  }
  host = el;
  menu = el.querySelector<HTMLElement>('.menu')!;
  title = el.querySelector<HTMLElement>('.menu-title')!;
  return el;
}

function isOpen(): boolean {
  if (!host) return false;
  return usePopover ? host.matches(':popover-open') : (host as HTMLDialogElement).open;
}

function itemMarkup(item: MenuItem, index: number): string {
  const glyph = item.icon ? (item.icon.trimStart().startsWith('<') ? item.icon : icon(item.icon)) : '';
  const hintId = `app-menu-hint-${index}`;
  const hint = item.hint ? `<span class="menu-hint" id="${hintId}">${esc(item.hint)}</span>` : '';
  return `${item.separatorBefore && index > 0 ? '<hr class="menu-separator">' : ''}`
    + `<button type="button" role="menuitem" tabindex="-1" class="menu-item${item.danger ? ' danger' : ''}" data-index="${index}"`
    + ` aria-label="${esc(item.label)}"${item.hint ? ` aria-describedby="${hintId}"` : ''}${item.disabled ? ' aria-disabled="true"' : ''}>`
    + `${glyph}<span class="menu-text"><span class="menu-label">${esc(item.label)}</span>${hint}</span></button>`;
}

function position(): void {
  if (!host || !trigger) return;
  const sheet = window.matchMedia(SHEET_QUERY).matches;
  host.classList.toggle('is-sheet', sheet);
  host.style.removeProperty('top');
  host.style.removeProperty('left');
  if (sheet) return;
  const anchor = trigger.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  const maxLeft = window.innerWidth - box.width - EDGE;
  // Right-aligned to the trigger (⋯ buttons sit at the end of a row), else left-aligned.
  let left = anchor.right - box.width;
  if (left < EDGE) left = anchor.left;
  left = Math.max(EDGE, Math.min(left, maxLeft));
  let top = anchor.bottom + GAP;
  if (top + box.height > window.innerHeight - EDGE && anchor.top - GAP - box.height >= EDGE) top = anchor.top - GAP - box.height;
  top = Math.max(EDGE, Math.min(top, window.innerHeight - box.height - EDGE));
  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(top)}px`;
}

function onViewportChange(event: Event): void {
  if (!trigger || !host) return;
  if (event.type === 'scroll' && host.contains(event.target as Node)) return;
  if (host.classList.contains('is-sheet') && event.type === 'scroll') return;
  const r = trigger.getBoundingClientRect();
  if (!trigger.isConnected || r.bottom < 0 || r.top > window.innerHeight) closeMenu(false);
  else position();
}

/** A tap on the action sheet's scrim only closes the sheet; the click must not reach the page below. */
function swallowNextClick(): void {
  const stop = (event: Event): void => { event.preventDefault(); event.stopPropagation(); };
  document.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', stop, true), 800);
}

function onOutsidePointer(event: PointerEvent): void {
  if (!host || !trigger || host.contains(event.target as Node)) return;
  if (host.classList.contains('is-sheet')) swallowNextClick();
  if (usePopover) return; // popover="auto" light-dismisses by itself (see beforetoggle)
  const t = trigger;
  closeMenu(false);
  if (t.contains(event.target as Node)) lastDismissed = { trigger: t, at: performance.now() };
}

function listen(on: boolean): void {
  if (on) {
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    document.addEventListener('pointerdown', onOutsidePointer, true);
  } else {
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    document.removeEventListener('pointerdown', onOutsidePointer, true);
  }
}

/** Cleanup shared by every way of closing. */
function finish(restoreFocus: boolean): void {
  const t = trigger;
  if (!t) return;
  trigger = undefined;
  current = [];
  listen(false);
  t.setAttribute('aria-expanded', 'false');
  if (restoreFocus && t.isConnected) t.focus();
}

function dismissed(restoreFocus: boolean): void {
  if (trigger) lastDismissed = { trigger, at: performance.now() };
  finish(restoreFocus);
}

export function openMenu(target: HTMLElement, items: readonly MenuItem[], label: string): void {
  if (typeof document === 'undefined' || !items.length) return;
  const recent = lastDismissed;
  lastDismissed = undefined;
  if (recent?.trigger === target && performance.now() - recent.at < RETOGGLE_MS) return;
  if (isOpen()) {
    const same = trigger === target;
    closeMenu(same);
    if (same) return;
  }
  const el = ensureHost();
  trigger = target;
  current = items;
  menu!.setAttribute('aria-label', label);
  title!.textContent = label;
  menu!.innerHTML = items.map(itemMarkup).join('');
  if (!target.hasAttribute('aria-haspopup')) target.setAttribute('aria-haspopup', 'menu');
  target.setAttribute('aria-expanded', 'true');
  if (usePopover) el.showPopover(); else (el as HTMLDialogElement).show();
  position();
  listen(true);
  const buttons = itemButtons();
  (buttons.find(b => b.getAttribute('aria-disabled') !== 'true') ?? buttons[0])?.focus();
}

export function closeMenu(restoreFocus = true): void {
  if (!host || !trigger) return;
  closingByApi = true;
  try {
    if (usePopover) { if (host.matches(':popover-open')) host.hidePopover(); }
    else (host as HTMLDialogElement).close();
  } finally { closingByApi = false; }
  finish(restoreFocus);
}

/** True while the shared menu is open (optionally: for this trigger). */
export function isMenuOpen(forTrigger?: HTMLElement): boolean {
  return isOpen() && !!trigger && (!forTrigger || forTrigger === trigger);
}

function onClick(event: MouseEvent): void {
  const button = (event.target as Element).closest<HTMLButtonElement>('.menu-item');
  if (!button) return;
  const item = current[Number(button.dataset.index)];
  if (!item || item.disabled) return;
  closeMenu(true);
  item.run?.();
}

function onKeydown(event: KeyboardEvent): void {
  const buttons = itemButtons();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const focusAt = (i: number): void => { buttons[(i + buttons.length) % buttons.length]?.focus(); };
  switch (event.key) {
    case 'ArrowDown': focusAt(index + 1); break;
    case 'ArrowUp': focusAt(index < 0 ? -1 : index - 1); break;
    case 'Home': focusAt(0); break;
    case 'End': focusAt(-1); break;
    case 'Escape': closeMenu(true); event.stopPropagation(); break;
    case 'Tab': closeMenu(true); break;
    default: {
      // Type-ahead: jump to the next item whose label starts with the typed character.
      if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || !/\S/.test(event.key)) return;
      const key = event.key.toLocaleLowerCase();
      for (let step = 1; step <= buttons.length; step++) {
        const candidate = buttons[(index + step) % buttons.length];
        if (candidate.getAttribute('aria-label')?.toLocaleLowerCase().startsWith(key)) { candidate.focus(); break; }
      }
    }
  }
  event.preventDefault();
}
