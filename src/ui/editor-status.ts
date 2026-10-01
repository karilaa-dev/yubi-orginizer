/**
 * Pure status model for the editor: preview states and their overlay card, the Download
 * button states (shared by #download and #download-mobile), the mobile bar text and the
 * Download dialog labels. DOM-free so it can be unit-tested.
 */
import { fmt, plural } from './dom';
import type { HolderConfig } from '../types';

export type PreviewState = 'empty' | 'generating' | 'ready' | 'invalid' | 'too-small' | 'paused' | 'failed' | 'offline-setup';

/** States that keep the previous model on screen, dimmed. */
export const STALE_STATES: ReadonlySet<PreviewState> = new Set(['invalid', 'too-small', 'paused', 'failed', 'offline-setup']);

export const OFFLINE_SETUP_TEXT = "The model engine hasn't finished downloading. Connect to the internet once to finish setup.";
export const FAILED_TEXT = "Couldn't generate the model.";

export interface EditorStatus {
  keys: number;
  /** Input errors plus the footprint error. */
  errors: number;
  state: PreviewState;
  /** The latest edit could not be saved (storage error, or the project was deleted in another window). */
  unsaved?: boolean;
}

export const fixLabel = (errors: number): string => `Fix ${plural(errors, 'setting')}`;

export type DownloadAction = 'add' | 'fix' | 'retry' | 'open';
export interface DownloadButtonState { label: string; blocked: boolean; action: DownloadAction }

/** Blocked buttons stay focusable (aria-disabled) and lead to the problem. */
export function downloadButtonState(s: EditorStatus): DownloadButtonState {
  if (!s.keys) return { label: 'Add keys to download', blocked: true, action: 'add' };
  if (s.errors) return { label: fixLabel(s.errors), blocked: true, action: 'fix' };
  if (s.state === 'failed' || s.state === 'paused' || s.state === 'offline-setup') return { label: 'Download', blocked: true, action: 'retry' };
  return { label: 'Download', blocked: false, action: 'open' };
}

/** Text next to Download in the mobile bar. */
export function mobileStatusText(s: EditorStatus, estimate = ''): string {
  // The save state is off-screen on phones, so an unsaved project says so here first.
  if (s.unsaved) return 'Not saved';
  if (!s.keys) return 'Add keys to start';
  if (s.errors) return fixLabel(s.errors);
  switch (s.state) {
    case 'ready': return estimate ? `Ready · ${estimate}` : 'Ready';
    case 'paused': return 'Paused';
    case 'failed': case 'offline-setup': return "Couldn't generate";
    default: return 'Generating…';
  }
}

export interface OverlayAction { label: string; action: string; primary?: boolean }
export interface OverlayModel { text: string; icon: string; actions: OverlayAction[]; tone?: 'error' }

/** The centred card on the preview, or undefined when the model itself is the content. */
export function previewOverlay(
  state: PreviewState,
  detail: { errors?: number; required?: { width: number; depth: number }; grow?: { width: number; depth: number }; message?: string } = {},
): OverlayModel | undefined {
  switch (state) {
    case 'empty':
      return { icon: 'plus', text: 'Add keys to start', actions: [{ label: 'Add keys', action: 'add', primary: true }] };
    case 'invalid': {
      const n = Math.max(1, detail.errors ?? 1);
      return { icon: 'alert', tone: 'error', text: `Fix ${plural(n, 'setting')} to update the model.`, actions: [{ label: 'Show', action: 'show-error', primary: true }] };
    }
    case 'too-small': {
      const mm = (s?: { width: number; depth: number }): string => (s ? `${fmt(s.width)} × ${fmt(s.depth)} mm` : '');
      return {
        icon: 'alert', tone: 'error', text: `Too small. These keys need at least ${mm(detail.required)}.`,
        actions: [{ label: `Use ${mm(detail.grow ?? detail.required)}`, action: 'grow-footprint', primary: true }, { label: 'Fit to keys', action: 'auto-footprint' }],
      };
    }
    case 'paused':
      return { icon: 'info', text: 'Paused.', actions: [{ label: 'Resume', action: 'retry', primary: true }] };
    case 'failed':
      return { icon: 'alert', tone: 'error', text: detail.message || FAILED_TEXT, actions: [{ label: 'Try again', action: 'retry', primary: true }] };
    case 'offline-setup':
      return { icon: 'cloudOff', text: OFFLINE_SETUP_TEXT, actions: [{ label: 'Try again', action: 'retry', primary: true }] };
    default:
      return undefined;
  }
}

/** The Download dialog's status line while the model can't be prepared (the overlay behind the modal is out of reach). */
export function downloadDialogStatus(state: PreviewState, message = ''): OverlayModel | undefined {
  return state === 'paused' || state === 'failed' || state === 'offline-setup' ? previewOverlay(state, { message }) : undefined;
}

/**
 * Speaks a blocking error (invalid setting, too-small footprint) once the user pauses, so
 * intermediate keystrokes stay quiet. The same text is not repeated until reset() (the error cleared).
 */
export function createErrorAnnouncer(speak: (text: string) => void, delayMs: number): { schedule(text: string): void; cancel(): void; reset(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let spoken = '';
  return {
    schedule(text) {
      clearTimeout(timer);
      timer = setTimeout(() => { if (text && text !== spoken) { spoken = text; speak(text); } }, delayMs);
    },
    cancel() { clearTimeout(timer); },
    reset() { clearTimeout(timer); spoken = ''; },
  };
}

/** "Generating tray lid (2/2)…" for multi-part projects, "Generating desktop dock…" otherwise. */
export function generationLabel(partName: string, index: number, total: number): string {
  const name = partName.toLowerCase();
  return total > 1 ? `Generating ${name} (${index + 1}/${total})…` : `Generating ${name}…`;
}

/**
 * A failed render maps to "finish setup" while the model engine is not cached yet and the network is the likely cause.
 * Never when the service worker could not register: setup would not finish by connecting.
 */
export function isOfflineSetupFailure(
  message: string, pwa: { supported: boolean; offlineReady: boolean; registrationFailed?: boolean }, online: boolean,
): boolean {
  if (pwa.registrationFailed) return false;
  return pwa.supported && !pwa.offlineReady && (!online || /fetch|network|load/i.test(message));
}

/** "≈ 8.4 g", "≈ 24 g". */
export const gramsText = (grams: number): string => `≈ ${grams < 10 ? grams.toFixed(1) : Math.round(grams)} g`;

/** "12 KB", "1.4 MB". */
export const fileSizeText = (bytes: number): string =>
  bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;

/* ───────────── Download dialog ───────────── */

export type DownloadFormat = '3mf' | 'stl' | 'scad';

/** STL and SCAD with several parts selected download as one ZIP. */
export const isZipDownload = (format: DownloadFormat, partCount: number, partId?: string): boolean =>
  format !== '3mf' && !partId && partCount > 1;

export function primaryDownloadLabel(format: DownloadFormat, partCount: number, partId?: string): string {
  if (isZipDownload(format, partCount, partId)) return 'Download ZIP';
  return `Download ${format.toUpperCase()}`;
}

/**
 * The Parts select value after the part list is rebuilt. Only a part the user picked in a
 * multi-part list is kept (while it exists); a one-part list's implicit value is not a choice,
 * so going from one part to several selects "All N parts" ('').
 */
export function partSelectValue(previous: string, previousOptions: number, partIds: readonly string[]): string {
  if (partIds.length < 2) return partIds[0] ?? '';
  return previousOptions > 1 && previous && partIds.includes(previous) ? previous : '';
}

/** "Preparing… 1/2" while the model is generating. */
export function preparingLabel(progress: { index: number; total: number }): string {
  return progress.total ? `Preparing… ${Math.min(progress.index + 1, progress.total)}/${progress.total}` : 'Preparing…';
}

export function formatNote(format: DownloadFormat, zip: boolean): string {
  if (format === '3mf') return 'Open as a project in your slicer to keep these settings.';
  return zip ? 'Several parts download as one ZIP.' : '';
}

/** One-line material tip for trays ('' for none). */
export function printTip(config: HolderConfig): string {
  if (config.template !== 'inventory_tray') return '';
  const tray = config.options.tray;
  if (tray.connection === 'h20_slide_v7') return 'Use the same material as your H20 reference. Pins up, lid flat side down, no supports in the receivers.';
  if (tray.connection === 'snap_fit') return 'Print in PLA or PLA Matte and keep the perimeter channels clear.';
  if (tray.retention) return 'Print in PETG so the retention tabs can flex.';
  return '';
}
