/**
 * Project actions shared by the editor (⋯ menu, Stacking callout) and the Projects page:
 * duplicate, delete with Undo, save a project file, and New matching layer (with its dialog).
 * WS4 implements ProjectActionsDeps over its router and editor session.
 */
import './shared.css';
import { downloadProject } from '../export';
import { MAX_LAYERS } from '../config';
import { projectLayers } from '../layers';
import { traySetLayout } from '../geometry/layers';
import { icon } from '../icons';
import {
  createMatchingLayer, deleteProject, duplicateProject, getProject, listProjects,
  ProjectStoreError, reinsertProject, removeProject, restoreProject, updateProjectConfig,
  type BrowserStorage, type MatchingLayerResult, type ProjectRecord, type ProjectSession,
} from '../projects';
import type { HolderConfig } from '../types';
import { esc, fmt } from './dom';
import { traySettingsState } from './settings-model';
import { toast } from './toast';

export interface ProjectActionsDeps {
  store: BrowserStorage;
  /** The editor session in this tab, if any. */
  session(): ProjectSession | undefined;
  /** Navigates to #/p/<id>; WS4 disposes the previous session. */
  open(id: string, options?: { addKeys?: boolean; layer?: number }): void;
  goHome(): void;
  /** Re-renders the Projects page if it is visible. */
  refreshList(): void;
}

const quoted = (name: string): string => `“${name}”`;
const messageOf = (error: unknown): string => (error instanceof Error && error.message) || 'Something went wrong.';
const GONE = "That project isn't on this device anymore.";

/* ───────────── Hints for the next Projects render ───────────── */

const hints: { highlight: Set<string>; focus?: string } = { highlight: new Set() };
/** Cards to highlight (new copies, imports) and a card to focus (Undo) on the next Projects render. Consumed once. */
export function takeListHints(): { highlight: ReadonlySet<string>; focus?: string } {
  const taken = { highlight: new Set(hints.highlight), focus: hints.focus };
  hints.highlight.clear();
  hints.focus = undefined;
  return taken;
}
export function highlightInList(...ids: string[]): void { for (const id of ids) hints.highlight.add(id); }

/* ───────────── Persistent storage (best effort) ───────────── */

let persistRequested = false;
/** Asks the browser to keep this site's data, once: when running installed, or once there are 2+ projects. */
export function requestPersistentStorage(store: BrowserStorage): void {
  if (persistRequested || !store.persistent || typeof navigator === 'undefined') return;
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!standalone && listProjects(store.local).projects.length < 2) return;
  persistRequested = true;
  navigator.storage?.persist?.().catch(() => undefined);
}

/* ───────────── Dialog helpers ───────────── */

const dialogHeading = (id: string, title: string): string =>
  `<div class="dialog-heading"><h2 id="${id}">${esc(title)}</h2>`
  + `<button type="button" class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>`;

/** A lazily created dialog appended to <body>. Backdrop clicks and the close button also work without WS4's delegated handler. */
function projectDialog(id: string): HTMLDialogElement {
  const existing = document.getElementById(id);
  if (existing instanceof HTMLDialogElement) return existing;
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = 'dialog small-dialog';
  dialog.addEventListener('click', event => {
    if ((event.target as Element).closest('[data-action="close-dialog"]')) { dialog.close(); return; }
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

/** Confirm dialog (#confirm-dialog). Resolves true only for the confirm button; Cancel, Esc, ✕ and backdrop resolve false. */
export function confirmAction(options: { title: string; body: string; confirmLabel: string; danger?: boolean }): Promise<boolean> {
  const dialog = projectDialog('confirm-dialog');
  dialog.setAttribute('aria-labelledby', 'confirm-dialog-title');
  dialog.setAttribute('aria-describedby', 'confirm-dialog-body');
  dialog.innerHTML = `${dialogHeading('confirm-dialog-title', options.title)}
    <form method="dialog" class="project-dialog-body">
      <p id="confirm-dialog-body">${esc(options.body)}</p>
      <div class="dialog-footer">
        <button type="submit" class="button secondary" value="cancel" autofocus>Cancel</button>
        <button type="submit" class="button ${options.danger ? 'secondary danger' : 'primary'}" value="confirm">${esc(options.confirmLabel)}</button>
      </div>
    </form>`;
  dialog.returnValue = '';
  return new Promise(resolve => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
    dialog.showModal();
  });
}

/* ───────────── New matching layer ───────────── */

export function matchingLayerAvailability(config: HolderConfig): { available: boolean; reason?: string } {
  if (config.template !== 'inventory_tray') return { available: false, reason: 'Matching layers are only available for inventory trays.' };
  const tray = config.options.tray;
  if (projectLayers(config).length >= MAX_LAYERS) return { available: false, reason: `${MAX_LAYERS} layers max.` };
  if (tray.footprint === null && projectLayers(config).every(l => l.config.slots.length === 0)) return { available: false, reason: 'Add keys first.' };
  return { available: true };
}

function footprintOf(config: HolderConfig): { width: number; depth: number } {
  const layout = traySetLayout(config);
  return { width: layout.width, depth: layout.depth };
}

function readLive(deps: ProjectActionsDeps, id: string): ProjectRecord | undefined {
  let record: ProjectRecord | undefined;
  try { record = getProject(deps.store.local, id); } catch (error) { toast(messageOf(error)); return undefined; }
  if (!record || record.deletedAt) { toast(GONE); return undefined; }
  return record;
}

/** Opens #layer-dialog for a saved tray. On create: opens the layer with Add keys and offers Undo. */
export function openMatchingLayerDialog(sourceId: string, deps: ProjectActionsDeps, sourceIndex?: number): void {
  const open = deps.session();
  // The layer copies the saved source: a latest edit that can't be saved (already reported) would be missing.
  if (open?.id === sourceId && !open.flush()) {
    toast('Your latest change couldn’t be saved, so a matching layer can’t be made yet. Free up browser storage, then try again.');
    return;
  }
  const source = readLive(deps, sourceId);
  if (!source) return;
  const layers = projectLayers(source.config);
  const index = sourceIndex ?? layers.length - 1;
  const selected = layers[index].config;
  const availability = matchingLayerAvailability(source.config);
  if (!availability.available) { toast(availability.reason!); return; }

  const tray = selected.options.tray;
  const { width, depth } = footprintOf(source.config);
  const size = `${fmt(width)} × ${fmt(depth)} mm`;
  const connection = traySettingsState(selected).groups.find(g => g.id === 'stacking')?.summary ?? '';
  const suggested = `Layer ${layers.length + 1}`;
  const hasLid = layers.at(-1)!.config.options.tray.lid;

  const dialog = projectDialog('layer-dialog');
  dialog.setAttribute('aria-labelledby', 'layer-dialog-title');
  dialog.setAttribute('aria-describedby', 'layer-dialog-summary');
  dialog.innerHTML = `${dialogHeading('layer-dialog-title', 'New matching layer')}
    <form class="project-dialog-body" novalidate>
      <p id="layer-dialog-summary">Adds an empty tray to ${esc(quoted(source.name))}: shared size (${size}) and connection (${esc(connection)}), minimum spacing and retention tabs off.</p>
      ${tray.footprint === null ? `<p class="field-hint">Fit to keys adjusts every tray to fit the contents of all layers.</p>` : ''}
      <label class="field" for="layer-name">Name<input id="layer-name" name="name" type="text" maxlength="80" autocomplete="off" value="${esc(suggested)}"/></label>
      ${hasLid ? '<p class="field-hint">The lid stays above the new tray at the top of the stack.</p>' : ''}
      <p class="inline-error" id="layer-error" role="alert" hidden></p>
      <div class="dialog-footer">
        <button type="button" class="button secondary" data-layer-cancel>Cancel</button>
        <button type="submit" class="button primary">Create layer</button>
      </div>
    </form>`;

  const form = dialog.querySelector('form')!;
  const nameInput = dialog.querySelector<HTMLInputElement>('#layer-name')!;
  const errorLine = dialog.querySelector<HTMLElement>('#layer-error')!;
  dialog.querySelector('[data-layer-cancel]')!.addEventListener('click', () => dialog.close());
  nameInput.addEventListener('input', () => { errorLine.hidden = true; nameInput.removeAttribute('aria-invalid'); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    let result: MatchingLayerResult;
    try {
      // Re-read: the footprint must be the source's size at the moment the layer is created.
      const current = getProject(deps.store.local, sourceId);
      if (!current || current.deletedAt) throw new Error(GONE);
      result = createMatchingLayer(deps.store.local, sourceId, { footprint: footprintOf(projectLayers(current.config)[index].config), sourceIndex: index, name: nameInput.value.trim() || suggested });
    } catch (error) {
      errorLine.textContent = messageOf(error);
      errorLine.hidden = false;
      nameInput.setAttribute('aria-invalid', 'true');
      nameInput.focus();
      return;
    }
    dialog.close();
    deps.open(result.source.id, { addKeys: true, layer: result.layerIndex });
    requestPersistentStorage(deps.store);
    toast(`Created ${quoted(result.layer.name)}.${hasLid ? ' The lid stays on top.' : ''}`, {
      // Add keys opens on the new layer: once keys were added, Ctrl/Cmd+Z must not undo the whole layer.
      action: { label: 'Undo', run: () => undoMatchingLayer(result, deps), shortcut: () => layerUntouched(result, deps) },
    });
  });

  dialog.showModal();
  nameInput.select();
}

/** Undo is offered only while no later edit would be lost. */
function layerUntouched(result: MatchingLayerResult, deps: ProjectActionsDeps): boolean {
  if (deps.session()?.id === result.source.id && deps.session()?.pending) return false;
  try {
    const stored = getProject(deps.store.local, result.source.id);
    return !!stored && !stored.deletedAt && stored.rev === result.source.rev;
  } catch { return false; }
}

export function undoMatchingLayer(result: MatchingLayerResult, deps: ProjectActionsDeps): void {
  if (deps.session()?.id === result.source.id && !deps.session()!.flush()) return;
  try {
    updateProjectConfig(deps.store.local, result.source.id, result.previousSourceConfig, { baseRev: result.source.rev });
  } catch (error) {
    toast(error instanceof ProjectStoreError && error.code === 'conflict'
      ? 'The tray set changed after the layer was added, so Undo was skipped.' : messageOf(error));
    return;
  }
  deps.open(result.source.id);
}

/* ───────────── Duplicate, delete, save file ───────────── */

/** Editor ⋯ › Duplicate: flush, copy, open the copy. */
export function duplicateFromEditor(deps: ProjectActionsDeps): void {
  const session = deps.session();
  const originalId = session?.id;
  if (!session || !originalId) return;
  if (!session.flush()) return; // onError / onRemoteDelete already reported why
  let copy: ProjectRecord;
  try { copy = duplicateProject(deps.store.local, originalId); } catch (error) { toast(messageOf(error)); return; }
  deps.open(copy.id);
  requestPersistentStorage(deps.store);
  toast(`You're now editing ${quoted(copy.name)}.`, { action: { label: 'Back to original', run: () => deps.open(originalId) } });
}

/** Card ⋯ › Duplicate: the copy is listed first and highlighted. */
export function duplicateInList(id: string, deps: ProjectActionsDeps): void {
  const session = deps.session();
  if (session?.id === id) session.flush();
  let copy: ProjectRecord;
  try { copy = duplicateProject(deps.store.local, id); } catch (error) { toast(messageOf(error)); return; }
  highlightInList(copy.id);
  deps.refreshList();
  requestPersistentStorage(deps.store);
  toast(`Duplicated as ${quoted(copy.name)}.`, { action: { label: 'Open', run: () => deps.open(copy.id) } });
}

/**
 * Soft delete with an Undo toast. The open project's session is flushed, then the app goes home
 * (the editor disposes the session). When storage is too full for Recently deleted, asks to delete permanently.
 */
export function deleteWithUndo(id: string, deps: ProjectActionsDeps): void {
  const session = deps.session();
  const wasOpen = !!session && session.id === id;
  // Flush first so the tombstone (and Undo) keeps the latest edits.
  const saved = !wasOpen || session!.flush();
  let record: ProjectRecord;
  try { record = deleteProject(deps.store.local, id); } catch (error) {
    if (error instanceof ProjectStoreError && error.code === 'quota' && error.current) void deletePermanently(error.current, deps, saved);
    else toast(messageOf(error));
    return;
  }
  // Leaving the editor disposes the session. Disposing here, after a failed flush, would report the delete as one from another window.
  if (wasOpen) deps.goHome(); else deps.refreshList();
  toast(`Deleted ${quoted(record.name)}.${saved ? '' : " Its latest change couldn't be saved."}`, {
    action: {
      label: 'Undo',
      run: () => {
        try { restoreProject(deps.store.local, id); } catch (error) { toast(messageOf(error)); return; }
        if (wasOpen) { deps.open(id); return; }
        hints.focus = id;
        deps.refreshList();
      },
    },
  });
}

/** Storage is too full for Recently deleted: after confirming, removes the project right away (freeing its space). Undo writes it back. */
async function deletePermanently(record: ProjectRecord, deps: ProjectActionsDeps, saved: boolean): Promise<void> {
  const confirmed = await confirmAction({
    title: `Delete ${quoted(record.name)} permanently?`,
    body: `Browser storage is full, so it can't go to Recently deleted.${saved ? '' : " Its latest change wasn't saved and will be lost."}`,
    confirmLabel: 'Delete permanently',
    danger: true,
  });
  if (!confirmed) return;
  const { id } = record;
  const wasOpen = deps.session()?.id === id;
  // Leave the editor first, so its final save doesn't report the removal as one from another window.
  if (wasOpen) deps.goHome();
  let removed: ProjectRecord;
  try { removed = removeProject(deps.store.local, id); } catch (error) { toast(messageOf(error)); return; }
  deps.refreshList();
  toast(`Deleted ${quoted(removed.name)} permanently.`, {
    action: {
      label: 'Undo',
      run: () => {
        try { reinsertProject(deps.store.local, removed); } catch (error) { toast(messageOf(error)); return; }
        if (wasOpen) { deps.open(id); return; }
        hints.focus = id;
        deps.refreshList();
      },
    },
  });
}

/** Saves `<name>.yubi-orginizer.json`. Uses the live editor state when the project is open in this tab. */
export function exportProjectFile(id: string, deps: ProjectActionsDeps): void {
  const session = deps.session();
  if (session?.id === id) { session.flush(); downloadProject(session.config, session.name); return; }
  const record = readLive(deps, id);
  if (record) downloadProject(record.config, record.name);
}
