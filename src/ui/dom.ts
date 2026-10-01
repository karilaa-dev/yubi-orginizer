/** Small DOM-free helpers shared by the Projects page, toasts, menus and the editor. */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapes text for use inside string-template markup (element content and quoted attributes). */
export const esc = (s: string): string => s.replace(/[&<>"']/g, c => ESCAPES[c]);

/** "1 key", "6 keys". */
export const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Millimetre values: rounded to 2 decimals, trailing zeros dropped ("66.8", "118"). */
export const fmt = (n: number): string => String(Math.round(n * 100) / 100);

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
let formatter: Intl.RelativeTimeFormat | undefined;

/**
 * "just now", "5 minutes ago", "2 hours ago", "yesterday", "3 days ago";
 * anything older than 30 days is shown as a date (toLocaleDateString()).
 * Future timestamps (clock skew between devices) read as "just now".
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return '';
  const elapsed = now.getTime() - then;
  if (elapsed < MINUTE) return 'just now';
  formatter ??= new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (elapsed < HOUR) return formatter.format(-Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return formatter.format(-Math.floor(elapsed / HOUR), 'hour');
  if (elapsed <= 30 * DAY) return formatter.format(-Math.floor(elapsed / DAY), 'day');
  return new Date(then).toLocaleDateString();
}

/** True for inputs where Ctrl/Cmd+Z must keep its native text-undo meaning. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const el = target as HTMLElement;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color'].includes((el as HTMLInputElement).type);
}

/**
 * The Latin letter of a Ctrl/Cmd shortcut. Uses event.key on Latin layouts (so AZERTY and Dvorak
 * users press the labelled key) and falls back to the physical key (event.code) on non-Latin
 * layouts, where event.key is the layout's own letter (Cyrillic "я" on the Z key, Greek…).
 */
export function shortcutLetter(event: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const key = (event.key ?? '').toLowerCase();
  if (/^[a-z]$/.test(key)) return key;
  const physical = /^Key([A-Z])$/.exec(event.code ?? '');
  return physical ? physical[1].toLowerCase() : key;
}
