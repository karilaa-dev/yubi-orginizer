/**
 * The editor view (#editor): one open project (ProjectSession), the Keys and Tray/Dock settings
 * tabs, the 3D preview with model generation, and the Add keys / Download / filament dialogs.
 *
 * Every edit goes through changed(): validate, hand the config to the session (autosave), render
 * what the change requires, sync derived state in place, then regenerate the model.
 */
import { MAX_SLOTS, TEMPLATES, createSlot, defaultConfig, moveSlot, validateConfig } from '../config';
import { DOWNLOAD_READY_EVENT, downloadFile, downloadParts, downloadProject, partFileName, trayConnectionInstructions, type DownloadReadyDetail } from '../export';
import { estimateFilament } from '../filament';
import { buildProject, inventoryTrayLayout, trayFootprintError } from '../geometry';
import { icon } from '../icons';
import { OrganizerPreview } from '../preview';
import { ProjectSession, ProjectStoreError, type BrowserStorage, type DisplayPrefs, type ProjectRecord, type ProjectSessionEvents } from '../projects';
import type { PwaStatus } from '../pwa';
import { renderScad } from '../runtime';
import { keyLabelMillimeters, readLegacyLidSize } from '../text-size';
import { build3mf } from '../three-mf';
import type { HolderConfig, KeyType, ProjectGeometry, TemplateId } from '../types';
import { openDialog } from './app-dialogs';
import { filamentDetailMarkup } from './app-help';
import { esc } from './dom';
import { captureFocus, clearFieldError, controlInputs, fieldErrorText, restoreFocus, showFieldError } from './editor-fields';
import { catalogMarkup, catalogTotalText, dropIndex, isKeysControl, keysPanelMarkup, reinsertSlot, removeOneOfType, removedMessage } from './editor-keys';
import { settingsPanelMarkup, snapFitRangeError, syncSettingsPanel, withConnection, withTemplate, type SyncMemory } from './editor-settings';
import {
  FAILED_TEXT, OFFLINE_SETUP_TEXT, STALE_STATES, createErrorAnnouncer, downloadButtonState, downloadDialogStatus, fileSizeText, formatNote,
  generationLabel, gramsText, isOfflineSetupFailure, isZipDownload, mobileStatusText, partSelectValue, preparingLabel, previewOverlay,
  primaryDownloadLabel, printTip, type DownloadFormat, type EditorStatus, type PreviewState,
} from './editor-status';
import { closeMenu, isMenuOpen, openMenu, type MenuItem } from './menu';
import { deleteWithUndo, duplicateFromEditor, matchingLayerAvailability, openMatchingLayerDialog, requestPersistentStorage, type ProjectActionsDeps } from './project-actions';
import { DEFAULT_OPEN_GROUPS, groupOfControl, traySettingsState } from './settings-model';
import { toast } from './toast';

export type Panel = 'keys' | 'settings';
export type RenderScope = 'none' | 'keys' | 'settings' | 'all';
/** Restored after an update reload (sessionStorage yubi-orginizer.ui.v1). */
export interface UiState { panel: Panel; panelScroll: number; windowScroll: number }

export interface EditorEnv {
  store: BrowserStorage;
  prefs(): DisplayPrefs;
  savePrefs(): void;
  pwaStatus(): PwaStatus;
  /** The first render waits for the service worker's startup check (bounded). */
  bootGate: Promise<unknown>;
  actions: ProjectActionsDeps;
  /** The project was created, renamed or replaced: sync the URL and the document title. */
  onProjectChange(): void;
  /** Autosave started (true) or stopped (false) failing for the open project. */
  onSaveProblem?(failing: boolean): void;
  openHelp(sectionId?: string): void;
}

export interface Editor {
  readonly session: ProjectSession | undefined;
  open(start: ProjectRecord | { config: HolderConfig }, options?: { ui?: UiState }): void;
  close(): void;
  openKeyDialog(): void;
  focusHeading(): void;
  /** Writes pending edits now. False if the latest edit could not be saved. */
  flush(): boolean;
  stopGeneration(): void;
  uiState(): UiState | undefined;
  handleStorageEvent(event: StorageEvent): void;
  sync(): void;
  applyPrefs(): void;
  setTheme(theme: 'light' | 'dark'): void;
  saveShortcut(): void;
  documentTitle(): string;
}

const MESH_CACHE_SIZE = 30;
const DEBOUNCE_MS = 450;
const READY_CHIP_MS = 2000;
/** A range error of a number field appears after this pause in typing (or at once on blur/Enter). */
const TYPING_ERROR_MS = 800;

/** Markup of the editor view, inserted by the shell into <main>. */
export function editorMarkup(): string {
  const toggle = (id: string, iconName: string, text: string, extra = '') =>
    `<button type="button" class="button preview-toggle" id="${id}" aria-pressed="true"${extra}>${icon(iconName)}<span class="toggle-text">${text}</span></button>`;
  const view = (id: string, iconName: string, label: string) =>
    `<button type="button" class="icon-button" data-view="${id}" title="${label}" aria-label="${label}">${icon(iconName)}</button>`;
  return `<section id="editor" class="editor" hidden>
    <div class="editor-bar">
      <button type="button" class="back-link" data-action="home" aria-label="All projects">${icon('back')}<span class="back-text">Projects</span></button>
      <h1 id="project-title" class="project-title" tabindex="-1"></h1>
      <span id="save-state" class="save-state"></span>
      <span class="editor-bar-end">
        <button type="button" id="project-menu" class="icon-button" aria-label="Project actions" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>
        <button type="button" id="download" class="button primary download-button" data-action="download">${icon('download')}<span class="download-label">Download</span></button>
      </span>
    </div>
    <p id="rename-error" class="field-error rename-error" role="alert" hidden></p>
    <div id="remote-banner" class="callout warn remote-banner" hidden></div>
    <div class="workspace">
      <aside class="controls-panel" aria-label="Organizer design">
        <div class="panel-tabs" role="tablist" aria-label="Organizer design">
          <button type="button" id="keys-tab" role="tab" aria-selected="true" aria-controls="keys-panel">Keys <span id="key-count" class="tab-count">0</span></button>
          <button type="button" id="settings-tab" role="tab" aria-selected="false" aria-controls="settings-panel" tabindex="-1">Tray settings</button>
        </div>
        <div class="panel-body">
          <div id="keys-panel" class="tab-panel" role="tabpanel" aria-labelledby="keys-tab"></div>
          <div id="settings-panel" class="tab-panel" role="tabpanel" aria-labelledby="settings-tab" hidden></div>
        </div>
      </aside>
      <section id="preview-card" class="preview-card" data-state="empty" aria-label="3D preview">
        <div class="preview-top">
          <div id="generation-status" class="status-chip" hidden></div>
          <div class="preview-actions">
            ${toggle('show-keys', 'eye', 'Keys', ' title="Show the keys in the preview. They aren\'t printed."')}
            ${toggle('explode', 'layers', 'Explode', ' hidden title="Separate the parts in the preview"')}
            ${toggle('preview-quality', 'sparkle', 'High quality', ' title="Turn off to save battery. The printed model doesn\'t change."')}
          </div>
        </div>
        <div id="viewer" class="viewer"></div>
        <div id="preview-overlay" class="preview-overlay" hidden></div>
        <p id="orbit-hint" class="orbit-hint" hidden></p>
        <div class="preview-bottom">
          <div class="view-tools" role="group" aria-label="Camera views">
            ${view('iso', 'cube', 'Isometric view')}${view('top', 'grid', 'Top view')}${view('front', 'dock', 'Front view')}<span class="view-separator" aria-hidden="true"></span>
            <button type="button" class="icon-button" data-action="camera-reset" title="Fit to view" aria-label="Fit to view">${icon('expand')}</button>
          </div>
          <div class="preview-metrics">
            <span id="dimensions" class="dimensions"></span>
            <button type="button" id="filament-estimate" class="estimate-button" data-action="filament-info" hidden>${icon('filament')}<span id="filament-value"></span></button>
          </div>
        </div>
      </section>
    </div>
    <div id="mobile-bar" class="mobile-bar">
      <span id="mobile-status" class="mobile-status"></span>
      <button type="button" id="download-mobile" class="button primary download-button" data-action="download">${icon('download')}<span class="download-label">Download</span></button>
    </div>
    <p id="model-announcer" class="sr-only" role="status" aria-live="polite"></p>
    <p id="reorder-announcer" class="sr-only" role="status" aria-live="polite"></p>
  </section>`;
}

/** Validation messages as shown next to a field. */
function errorText(error: unknown): string {
  return fieldErrorText((error instanceof Error && error.message) || 'Enter a valid value.');
}

const renameErrorText = (error: unknown): string =>
  (error instanceof ProjectStoreError && error.code === 'quota' ? "Couldn't save the name. Browser storage is full." : errorText(error));

const element = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
};
const isShown = (el: Element | null | undefined): el is HTMLElement => !!el && (el as HTMLElement).getClientRects().length > 0;
const templateName = (id: TemplateId): string => TEMPLATES.find(t => t.id === id)?.name ?? 'Organizer';

/** Clears, then sets, so repeating the same text is announced again. */
function announce(region: HTMLElement, text: string): void {
  region.textContent = '';
  requestAnimationFrame(() => { region.textContent = text; });
}

export function createEditor(env: EditorEnv): Editor {
  const root = element('editor');
  const keysPanel = element('keys-panel'), settingsPanel = element('settings-panel');
  const panelBody = root.querySelector<HTMLElement>('.panel-body')!;
  const controlsPanel = root.querySelector<HTMLElement>('.controls-panel')!;
  const keysTab = element<HTMLButtonElement>('keys-tab'), settingsTab = element<HTMLButtonElement>('settings-tab');
  const keyCount = element('key-count');
  const titleEl = element('project-title'), saveStateEl = element('save-state');
  const renameError = element('rename-error'), remoteBanner = element('remote-banner');
  const projectMenuButton = element<HTMLButtonElement>('project-menu');
  const downloadButtons = [element<HTMLButtonElement>('download'), element<HTMLButtonElement>('download-mobile')];
  const mobileStatus = element('mobile-status');
  const card = element('preview-card'), viewer = element('viewer'), chip = element('generation-status');
  const overlay = element('preview-overlay'), orbitHint = element('orbit-hint');
  const showKeysButton = element<HTMLButtonElement>('show-keys'), explodeButton = element<HTMLButtonElement>('explode');
  const qualityButton = element<HTMLButtonElement>('preview-quality');
  const dimensions = element('dimensions'), filamentButton = element<HTMLButtonElement>('filament-estimate'), filamentValue = element('filament-value');
  const modelAnnouncer = element('model-announcer'), reorderAnnouncer = element('reorder-announcer');
  const keyDialog = element<HTMLDialogElement>('key-dialog'), keySearch = element<HTMLInputElement>('key-search');
  const catalog = element('key-catalog'), catalogTotal = element('catalog-total');
  const downloadDialog = element<HTMLDialogElement>('download-dialog'), partField = element('download-part-field');
  const partSelect = element<HTMLSelectElement>('download-part'), formatNoteEl = element('format-note');
  const downloadFileButton = element<HTMLButtonElement>('download-file'), downloadFileLabel = element('download-file-label');
  const downloadResult = element('download-result'), trayTip = element('tray-print-tip'), dockTip = element('dock-print-tip');
  const downloadStateEl = element('download-state'), downloadAnnouncer = element('download-announcer');
  const assemblyNotes = element<HTMLDetailsElement>('assembly-notes'), lockTip = element('tray-lock-tip');
  const filamentDialog = element<HTMLDialogElement>('filament-dialog'), filamentDetail = element('filament-detail');

  const compactQuery = window.matchMedia('(max-width: 760px)');
  const fineQuery = window.matchMedia('(pointer: fine)');
  const coarseQuery = window.matchMedia('(pointer: coarse)');

  let preview: OrganizerPreview | undefined;
  try { preview = new OrganizerPreview(viewer); }
  catch (error) {
    viewer.innerHTML = '<div class="viewer-unavailable">3D preview needs WebGL. You can still generate and download models.</div>';
    console.error(error);
  }
  viewer.addEventListener('preview-warning', event => toast((event as CustomEvent<string>).detail));

  /* ───────────── State ───────────── */

  let session: ProjectSession | undefined;
  let config: HolderConfig = { ...defaultConfig(), slots: [] };
  let panel: Panel = 'keys';
  const panelScroll: Record<Panel, number> = { keys: 0, settings: 0 };
  let exploded = true;
  let openToken = 0, displayedToken = -1;
  let revision = 0, readyRevision = -1;
  let controller: AbortController | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let chipTimer: ReturnType<typeof setTimeout> | undefined;
  let currentProject: ProjectGeometry | undefined;
  let meshes = new Map<string, ArrayBuffer>();
  let previewState: PreviewState = 'empty';
  let failureMessage = '';
  let progress = { index: 0, total: 0, label: '' };
  let estimate = '';
  let mobileHtml = '';
  let downloadStateHtml = '';
  let saveError: Error | undefined;
  let renaming = false;
  let renderedName: string | undefined;
  let dragging: string | undefined;
  let discarding = false;
  const inputErrors = new Map<string, string>();
  /** Range errors of number fields the user is still typing in: not shown or counted yet. */
  const pendingErrors = new Map<string, string>();
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  const memory: SyncMemory = { errorGroups: new Set() };
  const meshCache = new Map<string, ArrayBuffer>();
  const lidMetricCache = new Map<string, NonNullable<ReturnType<typeof readLegacyLidSize>>>();
  const openGroups = new Map<TemplateId, Set<string>>();

  const tooSmall = (): boolean => config.slots.length > 0 && trayFootprintError(config) !== undefined;
  const errorCount = (): number => inputErrors.size + (tooSmall() ? 1 : 0);
  const status = (): EditorStatus => ({
    keys: config.slots.length, errors: errorCount(), state: previewState,
    unsaved: !!session && (!!saveError || !!session.blocked),
  });

  /** Model announcements go into the Download dialog while it is open: everything outside a modal is inert. */
  const announceModel = (text: string): void => announce(downloadDialog.open ? downloadAnnouncer : modelAnnouncer, text);
  /** The first blocking setting error, spoken once typing pauses (the field error and overlay are not live). */
  const errorAnnouncer = createErrorAnnouncer(announceModel, DEBOUNCE_MS);

  function openGroupsFor(template: TemplateId): Set<string> {
    let open = openGroups.get(template);
    if (!open) {
      open = new Set(env.prefs().openGroups[template] ?? DEFAULT_OPEN_GROUPS[template]);
      openGroups.set(template, open);
    }
    return open;
  }

  /* ───────────── Session events ───────────── */

  const events: ProjectSessionEvents = {
    onSaved: () => {
      if (saveError) env.onSaveProblem?.(false);
      saveError = undefined;
      renderTitle();
      renderSaveState();
      env.onProjectChange();
      requestPersistentStorage(env.store);
    },
    onError: error => {
      if (!session) return; // the final flush in close() reports its own toast
      const first = !saveError;
      saveError = error;
      renderSaveState();
      if (first) { toast(error.message); env.onSaveProblem?.(true); }
    },
    onRemoteChange: (_record, change) => {
      if (!session) return;
      if (!session.blocked) hideRemoteBanner();
      if (change.configChanged) {
        config = session.config;
        inputErrors.clear();
        clearPendingErrors();
        memory.errorGroups.clear();
        update('all');
        invalidate();
      }
      renderTitle();
      renderSaveState();
      env.onProjectChange();
      if (change.discardedLocalEdit) toast('This project was changed in another window. Showing the latest version.');
    },
    onRemoteDelete: record => { if (session) showRemoteBanner(record ? 'deleted' : 'removed'); },
  };

  /* ───────────── Change pipeline ───────────── */

  function changed(next: HolderConfig, options: { render?: RenderScope; touch?: boolean } = {}): void {
    const s = session;
    if (!s) return;
    const touch = options.touch ?? true;
    config = validateConfig(next);
    s.edit(config, { touch });
    // A new project is created on its first real edit; onSaved then switches the URL to #/p/<id>.
    if (!s.persisted && touch) s.flush();
    update(options.render ?? 'none');
    invalidate();
  }

  function update(render: RenderScope): void {
    const focus = render === 'none' ? undefined : captureFocus(root);
    if (render === 'keys' || render === 'all') renderKeys();
    if (render === 'settings' || render === 'all') renderSettings();
    if (render === 'all') { renderTitle(); renderDownloadTips(); }
    syncSettingsState();
    renderTabs();
    renderDownloadState();
    if (focus) restoreFocus(root, focus);
  }

  function renderKeys(): void {
    for (const id of [...inputErrors.keys()]) if (isKeysControl(id)) inputErrors.delete(id);
    for (const id of [...pendingErrors.keys()]) if (isKeysControl(id)) pendingErrors.delete(id);
    if (!pendingErrors.size) clearTimeout(pendingTimer);
    keysPanel.innerHTML = keysPanelMarkup(config, { draggable: fineQuery.matches });
  }

  function renderSettings(): void {
    const sameType = settingsPanel.dataset.template === config.template;
    // Re-rendering the same organizer type (lock/grow/fit size, snap-fit replacement, Undo) keeps
    // what the user typed into other fields that failed validation, with its error.
    const typed: { id: string; message: string; values: string[] }[] = [];
    if (sameType) {
      for (const [id, message] of pendingErrors) if (!isKeysControl(id)) inputErrors.set(id, message);
      for (const [id, message] of inputErrors) {
        const inputs = controlInputs(settingsPanel, id);
        if (isKeysControl(id) || !inputs.length || inputs.some(i => i.type === 'radio' || i.type === 'checkbox')) continue;
        typed.push({ id, message, values: inputs.map(i => i.value) });
      }
    }
    for (const id of [...pendingErrors.keys()]) if (!isKeysControl(id)) pendingErrors.delete(id);
    if (!pendingErrors.size) clearTimeout(pendingTimer);
    for (const id of [...inputErrors.keys()]) if (!isKeysControl(id)) inputErrors.delete(id);
    if (!sameType) memory.errorGroups.clear();
    // Re-rendering the same organizer type keeps the groups the user has open right now
    // (including ones opened for an error); a new project or type uses the saved state.
    const current = sameType
      ? new Set([...settingsPanel.querySelectorAll<HTMLElement>('details.group[open]')].map(d => d.dataset.group!))
      : undefined;
    const scroll = panelBody.scrollTop;
    settingsPanel.innerHTML = settingsPanelMarkup(config, { open: current ?? openGroupsFor(config.template), dockNotice: !env.prefs().seen.dockNotice });
    settingsPanel.dataset.template = config.template;
    if (current) panelBody.scrollTop = scroll;
    const restored: HTMLInputElement[] = [];
    for (const { id, message, values } of typed) {
      const inputs = controlInputs(settingsPanel, id);
      if (inputs.length !== values.length) continue;
      inputs.forEach((input, i) => { input.value = values[i]; });
      inputErrors.set(id, message);
      showFieldError(settingsPanel, id, message);
      restored.push(inputs.find(i => i.type === 'number') ?? inputs[0]);
    }
    // The new settings may accept (or reject differently) what was typed, e.g. a snap-fit
    // minimum no longer applies: re-check once this render has finished.
    if (restored.length) queueMicrotask(() => { for (const input of restored) if (input.isConnected) updateOption(input); });
  }

  /** Replaces updateTrayLockReadouts() / updateTraySizeReadout(): everything derived from the config. */
  function syncSettingsState(): void {
    syncSettingsPanel(settingsPanel, config, inputErrors, memory);
    const instructions = session ? trayConnectionInstructions(config).join(' ') : '';
    const helpText = document.getElementById('tray-lock-help-text');
    if (helpText) { helpText.textContent = instructions; helpText.hidden = !instructions; }
    lockTip.textContent = instructions;
    assemblyNotes.hidden = !instructions;
  }

  function renderTabs(): void {
    keyCount.textContent = String(config.slots.length);
    settingsTab.textContent = config.template === 'desktop_dock' ? 'Dock settings' : 'Tray settings';
    for (const [tab, id] of [[keysTab, 'keys'], [settingsTab, 'settings']] as const) {
      const active = panel === id;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    }
    keysPanel.hidden = panel !== 'keys';
    settingsPanel.hidden = panel !== 'settings';
  }

  /* ───────────── Tabs and scroll ───────────── */

  const desktopLayout = (): boolean => !compactQuery.matches;
  /** Mobile: the page scroll position at which the tabs stick under the preview. */
  const stickAnchor = (): number => controlsPanel.getBoundingClientRect().top + window.scrollY - card.getBoundingClientRect().height;

  function currentScroll(): number {
    return desktopLayout() ? panelBody.scrollTop : Math.max(0, window.scrollY - stickAnchor());
  }

  function switchPanel(next: Panel): void {
    if (next === panel) return;
    panelScroll[panel] = currentScroll();
    panel = next;
    renderTabs();
    const saved = panelScroll[next];
    if (desktopLayout()) panelBody.scrollTop = saved;
    else {
      const anchor = stickAnchor();
      if (window.scrollY > anchor) window.scrollTo({ top: anchor + saved });
    }
  }

  const tabs = root.querySelector<HTMLElement>('.panel-tabs')!;
  tabs.addEventListener('click', event => {
    const tab = (event.target as Element).closest<HTMLElement>('[role="tab"]');
    if (tab) switchPanel(tab === keysTab ? 'keys' : 'settings');
  });
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next: Panel = event.key === 'Home' ? 'keys' : event.key === 'End' ? 'settings' : panel === 'keys' ? 'settings' : 'keys';
    switchPanel(next);
    (next === 'keys' ? keysTab : settingsTab).focus();
  });

  /* ───────────── Title, save state, rename, remote banner ───────────── */

  function renderTitle(): void {
    if (renaming || !session) return;
    const name = session.name;
    if (name === renderedName && titleEl.firstElementChild) return;
    renderedName = name;
    titleEl.innerHTML = `<button type="button" class="title-button" data-action="rename" title="Rename">`
      + `<span class="title-text">${esc(name)}</span>${icon('edit', 'title-icon')}</button>`;
  }

  function renderSaveState(): void {
    const s = session;
    let tone = '', html = '';
    if (s && s.persisted && !env.store.persistent) {
      tone = 'warn';
      html = `${icon('alert')}<span class="save-text">Not saved · storage blocked</span>`;
    } else if (s && (saveError || s.blocked)) {
      tone = 'error';
      html = `${icon('alert')}<span class="save-text">Not saved</span><button type="button" class="text-button" data-action="backup">Save project file</button>`;
    } else if (s?.persisted) {
      tone = 'ok';
      html = `${icon('check')}<span class="save-text">Saved</span>`;
    }
    if (saveStateEl.dataset.tone !== tone || saveStateEl.innerHTML !== html) {
      saveStateEl.dataset.tone = tone;
      saveStateEl.innerHTML = html;
    }
    renderDownloadState(); // the mobile bar shows "Not saved" too
  }

  function startRename(): void {
    if (!session) return;
    if (renaming) { titleEl.querySelector('input')?.focus(); return; }
    renaming = true;
    renameError.hidden = true;
    titleEl.innerHTML = `<input id="project-name-input" class="title-input" type="text" maxlength="80" autocomplete="off" spellcheck="false" aria-label="Project name" value="${esc(session.name)}"/>`;
    const input = titleEl.querySelector('input')!;
    input.focus();
    input.select();
  }

  /** Enter/blur commit, Esc cancels; a blank or unchanged name reverts silently. */
  function finishRename(commit: boolean, refocus: boolean): void {
    if (!renaming) return;
    const input = titleEl.querySelector<HTMLInputElement>('#project-name-input');
    const value = input?.value.trim() ?? '';
    renaming = false;
    renderedName = undefined;
    let error = '';
    if (commit && session && value && value !== session.name) {
      try { session.rename(value); }
      catch (e) { error = renameErrorText(e); }
    }
    renderTitle();
    env.onProjectChange();
    renameError.textContent = error;
    renameError.hidden = !error;
    if (refocus) titleEl.querySelector<HTMLElement>('button')?.focus();
  }

  titleEl.addEventListener('keydown', event => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.key === 'Enter') { event.preventDefault(); finishRename(true, true); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finishRename(false, true); }
  });
  titleEl.addEventListener('focusout', event => {
    if (event.target instanceof HTMLInputElement) finishRename(true, false);
  });

  function showRemoteBanner(kind: 'deleted' | 'removed'): void {
    // flush() reports the block again on every blocked save: rebuild and announce only when it first appears.
    if (remoteBanner.hidden || remoteBanner.dataset.kind !== kind) {
      const text = kind === 'deleted' ? 'This project was deleted in another window.' : 'This project was removed in another window.';
      remoteBanner.dataset.kind = kind;
      remoteBanner.innerHTML = `${icon('alert')}<span class="callout-text">${text}</span><span class="callout-actions">`
        + (kind === 'deleted' ? '<button type="button" class="button secondary compact" data-action="remote-restore">Restore</button>' : '')
        + '<button type="button" class="button secondary compact" data-action="remote-save-new">Save as new project</button></span>';
      remoteBanner.hidden = false;
      // The banner is not a live region and scrolls out of view on phones: the toast is both.
      const owner = session;
      const action = kind === 'deleted' ? 'restore' : 'save-new';
      toast(`${text} Changes aren't being saved.`, {
        action: { label: kind === 'deleted' ? 'Restore' : 'Save as new project', run: () => { if (session === owner) remoteAction(action); } },
      });
    }
    renderSaveState();
  }

  function hideRemoteBanner(): void {
    remoteBanner.hidden = true;
    delete remoteBanner.dataset.kind;
    remoteBanner.replaceChildren();
  }

  function remoteAction(action: 'restore' | 'save-new'): void {
    if (!session) return;
    try { if (action === 'restore') session.restore(); else session.saveAsNew(); }
    catch (error) { toast(errorText(error)); return; }
    hideRemoteBanner();
    renderedName = undefined;
    renderTitle();
    renderSaveState();
    env.onProjectChange();
    titleEl.focus();
  }

  /* ───────────── Settings: inputs ───────────── */

  /** `live`: an 'input' event of a number field, i.e. the user may still be typing. */
  function updateOption(input: HTMLInputElement, live = false): void {
    if (!session) return;
    const field = input.dataset.option!;
    const next = structuredClone(config);
    const numberOf = (text: string): number => (text.trim() ? Number(text) : NaN);
    if (field === 'labels') next.labels = input.checked;
    else if (field === 'labelSize') next.labelSize = input.value.trim() ? keyLabelMillimeters(Number(input.value)) : NaN;
    else if (field === 'tray.sizeLocked') {
      const fixed = input.type === 'radio' ? input.value === 'fixed' : input.checked;
      const t = inventoryTrayLayout(config);
      next.options.tray.footprint = fixed ? { width: t.width || 80, depth: t.depth || 80 } : null;
    } else if (field === 'tray.width' || field === 'tray.depth') {
      if (!next.options.tray.footprint) return;
      next.options.tray.footprint[field === 'tray.width' ? 'width' : 'depth'] = numberOf(input.value);
    } else {
      const [section, name] = field.split('.') as [keyof HolderConfig['options'], string];
      const numeric = input.type === 'range' || input.type === 'number' || input.hasAttribute('data-numeric');
      const value = input.type === 'checkbox' ? input.checked : numeric ? numberOf(input.value) : input.value;
      (next.options[section] as unknown as Record<string, unknown>)[name] = value;
    }
    try {
      if (field === 'labelSize' && (!Number.isFinite(next.labelSize) || next.labelSize < 1.5 || next.labelSize > 4)) throw new Error('Label size must be between 37.5% and 100%.');
      const snapError = snapFitRangeError(next, field);
      if (snapError) throw new Error(snapError);
      validateConfig(next);
    } catch (error) {
      const message = errorText(error);
      if (live && input.type === 'number' && !inputErrors.has(field)) {
        // Typing "30" passes through "3": show the range error after a pause or on blur/Enter.
        // Generation waits meanwhile, so no model is made for the value being replaced.
        pendingErrors.set(field, message);
        controller?.abort();
        clearTimeout(debounce);
        clearTimeout(pendingTimer);
        pendingTimer = setTimeout(surfacePendingErrors, TYPING_ERROR_MS);
        return;
      }
      pendingErrors.delete(field);
      inputErrors.set(field, message);
      showFieldError(root, field, message);
      syncSettingsState();
      invalidate();
      return;
    }
    pendingErrors.delete(field);
    if (!pendingErrors.size) clearTimeout(pendingTimer);
    inputErrors.delete(field);
    clearFieldError(root, field);
    const previous = config, owner = session;
    const replacedSnap = field === 'tray.connection' && previous.options.tray.connection === 'snap_fit' && next.options.tray.connection !== 'snap_fit';
    if (field === 'tray.lid' && next.options.tray.lid && !previous.options.tray.lid) setExploded(true);
    changed(next, { render: replacedSnap ? 'settings' : field === 'labels' ? 'keys' : 'none' });
    // Keep the other input of the same option (number ↔ range) in step.
    for (const other of root.querySelectorAll<HTMLInputElement>(`[data-option="${field}"]`)) {
      if (other === input || other.type === 'radio' || other.type === 'checkbox') continue;
      other.value = input.value;
    }
    if (replacedSnap) {
      toast('Replaced snap-fit.', {
        action: {
          label: 'Undo',
          run: () => {
            // Only the connection goes back: keys and settings edited since the replacement stay.
            if (session !== owner || config.options.tray.connection === 'snap_fit') return;
            changed(withConnection(config, 'snap_fit'), { render: 'settings' });
            focusAfterUndo('[data-option="tray.connection"]:checked');
          },
        },
      });
    }
  }

  /** Shows the range errors of number fields that were held back while typing. */
  function surfacePendingErrors(): void {
    clearTimeout(pendingTimer);
    if (!pendingErrors.size) return;
    for (const [field, message] of pendingErrors) {
      inputErrors.set(field, message);
      showFieldError(root, field, message);
    }
    pendingErrors.clear();
    syncSettingsState();
    invalidate();
  }

  function clearPendingErrors(): void {
    pendingErrors.clear();
    clearTimeout(pendingTimer);
  }

  function switchTemplate(template: TemplateId): void {
    if (!session || template === config.template) return;
    const previousTemplate = config.template, owner = session;
    setExploded(true);
    changed(withTemplate(config, template), { render: 'all' });
    toast(`Switched to ${templateName(template)}.`, {
      action: {
        label: 'Undo',
        run: () => {
          // Only the type goes back: keys added and settings changed since the switch stay.
          if (session !== owner || config.template !== template) return;
          setExploded(true);
          changed(withTemplate(config, previousTemplate), { render: 'all' });
          focusAfterUndo('[data-template-switch]:checked');
        },
      },
    });
  }

  /** After a toast Undo the focused toast button is gone: move focus to the control the Undo restored. */
  function focusAfterUndo(selector: string): void {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return; // e.g. Ctrl+Z in the editor: update() kept focus
    const target = settingsPanel.querySelector<HTMLElement>(selector);
    const summary = target?.closest('details')?.querySelector<HTMLElement>(':scope > summary'); // its group is collapsed
    if (isShown(target)) target.focus();
    else if (isShown(summary)) summary.focus();
    else (panel === 'settings' ? settingsTab : keysTab).focus();
  }

  function setFootprint(kind: 'lock' | 'grow' | 'auto'): void {
    if (!session || config.template !== 'inventory_tray') return;
    const next = structuredClone(config);
    const layout = inventoryTrayLayout(config);
    if (kind === 'lock') next.options.tray.footprint = { width: layout.width, depth: layout.depth };
    else if (kind === 'grow') {
      const grow = traySettingsState(config).size.grow;
      if (!grow) return;
      next.options.tray.footprint = { width: grow.width, depth: grow.depth };
    } else next.options.tray.footprint = null;
    // The button sets the size, replacing whatever was typed there; other typed fields keep their values.
    for (const id of ['tray.sizeLocked', 'tray.width', 'tray.depth']) { inputErrors.delete(id); pendingErrors.delete(id); }
    const fromOverlay = overlay.contains(document.activeElement);
    changed(next, { render: 'settings' });
    // The button that was used is gone now: move focus to what it affected.
    const target = kind === 'lock' ? settingsPanel.querySelector<HTMLElement>('[data-action="new-layer"]')
      : kind === 'grow' ? settingsPanel.querySelector<HTMLElement>('#tray\\.width')
      : settingsPanel.querySelector<HTMLElement>('[data-option="tray.sizeLocked"]:checked');
    if (isShown(target)) target.focus();
    else if (fromOverlay) card.querySelector<HTMLElement>('.preview-canvas')?.focus();
  }

  function newLayer(): void {
    if (!session) return;
    if (!session.persisted) {
      try { session.saveAsNew(); } catch (error) { toast(errorText(error)); return; }
    }
    openMatchingLayerDialog(session.id!, env.actions);
  }

  function dismissDockNotice(): void {
    const prefs = env.prefs();
    prefs.seen.dockNotice = true;
    env.savePrefs();
    settingsPanel.querySelector('#dock-notice')?.remove();
    settingsPanel.querySelector<HTMLElement>('[data-template-switch]:checked')?.focus();
  }

  /** Download "Fix N settings" and the overlay's Show: go to the first problem. */
  function focusFirstError(): void {
    surfacePendingErrors();
    const key = inputErrors.keys().next().value ?? (tooSmall() ? 'tray.width' : undefined);
    if (!key) return;
    if (isKeysControl(key)) {
      switchPanel('keys');
      const el = key.startsWith('label-') ? document.getElementById(key)
        : keysPanel.querySelector<HTMLElement>(`input[type="number"][data-option="${key}"]`) ?? keysPanel.querySelector<HTMLElement>(`[data-option="${key}"]`);
      el?.focus();
      return;
    }
    switchPanel('settings');
    const group = groupOfControl(config.template, key);
    const details = group ? settingsPanel.querySelector<HTMLDetailsElement>(`[data-group="${group}"]`) : null;
    if (details) details.open = true;
    const el = settingsPanel.querySelector<HTMLElement>(`input[type="number"][data-option="${key}"]`)
      ?? settingsPanel.querySelector<HTMLElement>(`[data-option="${key}"]:checked`)
      ?? settingsPanel.querySelector<HTMLElement>(`input[type="range"][data-option="${key}"]`)
      ?? settingsPanel.querySelector<HTMLElement>(`[data-option="${key}"]`);
    el?.focus();
  }

  settingsPanel.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.option && ['range', 'number', 'text'].includes(input.type)) updateOption(input, input.type === 'number');
  });
  settingsPanel.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.hasAttribute('data-template-switch')) { if (input.checked) switchTemplate(input.value as TemplateId); return; }
    // A number field commits on blur/Enter: show a range error held back while typing.
    if (input.type === 'number') { if (pendingErrors.has(input.dataset.option ?? '')) surfacePendingErrors(); return; }
    if (input.dataset.option && !['range', 'text'].includes(input.type)) updateOption(input);
  });
  // Open groups are remembered per organizer type, only when the user toggles them.
  settingsPanel.addEventListener('click', event => {
    const summary = (event.target as Element).closest('summary');
    const details = summary?.parentElement;
    if (!(details instanceof HTMLDetailsElement) || !details.dataset.group) return;
    const template = config.template;
    requestAnimationFrame(() => {
      const open = openGroupsFor(template);
      if (details.open) open.add(details.dataset.group!); else open.delete(details.dataset.group!);
      const prefs = env.prefs();
      prefs.openGroups = { ...prefs.openGroups, [template]: [...open] };
      env.savePrefs();
    });
  });

  /* ───────────── Keys: labels, reorder, remove ───────────── */

  function updateLabel(input: HTMLInputElement): void {
    if (!session) return;
    const next = structuredClone(config);
    const slot = next.slots.find(s => s.id === input.dataset.label);
    if (!slot) return;
    slot.label = input.value;
    try { validateConfig(next); } catch (error) {
      const message = errorText(error);
      inputErrors.set(input.id, message);
      showFieldError(keysPanel, input.id, message);
      syncSettingsState();
      invalidate();
      return;
    }
    inputErrors.delete(input.id);
    clearFieldError(keysPanel, input.id);
    changed(next);
  }

  function moveKey(from: number, to: number): void {
    const count = config.slots.length;
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return;
    changed(moveSlot(config, from, to), { render: 'keys' });
    announce(reorderAnnouncer, `Moved to position ${to + 1} of ${count}.`);
  }

  function removeKey(id: string): void {
    const index = config.slots.findIndex(s => s.id === id);
    if (index < 0 || !session) return;
    const slot = config.slots[index], owner = session;
    const neighbour = config.slots[index + 1]?.id ?? config.slots[index - 1]?.id;
    changed({ ...config, slots: config.slots.filter(s => s.id !== id) }, { render: 'keys' });
    const target = neighbour ? keysPanel.querySelector<HTMLElement>(`[data-remove="${neighbour}"]`) : keysPanel.querySelector<HTMLElement>('[data-action="add"]');
    target?.focus();
    toast(removedMessage(slot), { action: { label: 'Undo', run: () => undoRemove(owner, slot, index) } });
  }

  function undoRemove(owner: ProjectSession, slot: HolderConfig['slots'][number], index: number): void {
    if (session !== owner) return;
    changed(reinsertSlot(config, slot, index), { render: 'keys' });
    if (keyDialog.open) { renderCatalog(); catalogTotal.textContent = catalogTotalText(config.slots.length); return; }
    const restored = keysPanel.querySelector<HTMLElement>(`[data-remove="${slot.id}"]`);
    if (isShown(restored)) restored.focus();
  }

  keysPanel.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.label) updateLabel(input);
    else if (input.dataset.option && ['range', 'number'].includes(input.type)) updateOption(input, input.type === 'number');
  });
  keysPanel.addEventListener('change', event => {
    const input = event.target as HTMLInputElement;
    if (input.dataset.option && input.type === 'checkbox') updateOption(input);
    else if (input.type === 'number' && pendingErrors.has(input.dataset.option ?? '')) surfacePendingErrors();
  });
  keysPanel.addEventListener('keydown', event => {
    const target = event.target as HTMLElement;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    const handle = target.closest<HTMLElement>('[data-reorder]');
    const label = target.matches('.key-label') && event.altKey && !event.ctrlKey && !event.metaKey ? target : undefined;
    const id = handle?.dataset.reorder ?? (label as HTMLInputElement | undefined)?.dataset.label;
    if (!id || (!handle && !label)) return;
    event.preventDefault();
    const from = config.slots.findIndex(s => s.id === id);
    moveKey(from, from + (event.key === 'ArrowUp' ? -1 : 1));
  });

  // HTML5 drag and drop (fine pointers); the drop line shows above or below the target row.
  const clearDropMarks = () => keysPanel.querySelectorAll('.drop-before, .drop-after, .dragging').forEach(el => el.classList.remove('drop-before', 'drop-after', 'dragging'));
  keysPanel.addEventListener('dragstart', event => {
    const target = event.target as Element;
    const row = target.closest<HTMLElement>('[data-slot]');
    if (!row || target.matches('input')) return;
    dragging = row.dataset.slot;
    event.dataTransfer?.setData('text/plain', dragging!);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    row.classList.add('dragging');
  });
  keysPanel.addEventListener('dragover', event => {
    const row = (event.target as Element).closest<HTMLElement>('[data-slot]');
    if (!dragging || !row) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const rect = row.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    if (row.classList.contains(after ? 'drop-after' : 'drop-before')) return;
    keysPanel.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'));
    row.classList.add(after ? 'drop-after' : 'drop-before');
  });
  keysPanel.addEventListener('drop', event => {
    const row = (event.target as Element).closest<HTMLElement>('[data-slot]');
    if (dragging && row) {
      event.preventDefault();
      const from = config.slots.findIndex(s => s.id === dragging);
      const target = config.slots.findIndex(s => s.id === row.dataset.slot);
      const after = row.classList.contains('drop-after');
      clearDropMarks();
      if (from >= 0 && target >= 0 && from !== target) moveKey(from, dropIndex(from, target, after));
    }
    dragging = undefined;
  });
  keysPanel.addEventListener('dragend', () => { dragging = undefined; clearDropMarks(); });

  /* ───────────── Add keys dialog ───────────── */

  function renderCatalog(): void {
    catalog.innerHTML = catalogMarkup(config, keySearch.value);
  }

  function openKeyDialog(): void {
    if (!session) return;
    keySearch.value = '';
    catalogTotal.textContent = catalogTotalText(config.slots.length);
    renderCatalog();
    catalog.scrollTop = 0;
    openDialog(keyDialog, () => keysPanel.querySelector<HTMLElement>('[data-action="add"]') ?? titleEl);
    // On touch screens, don't open the keyboard over the list.
    if (!coarseQuery.matches) keySearch.focus();
  }

  /** Re-renders the counts and keeps focus on the stepper that was used (or its sibling). */
  function refreshCatalog(...selectors: string[]): void {
    renderCatalog();
    for (const selector of selectors) {
      const button = catalog.querySelector<HTMLButtonElement>(selector);
      if (button && !button.disabled) { button.focus(); return; }
    }
    keyDialog.querySelector<HTMLElement>('.dialog-footer [data-action="close-dialog"]')?.focus();
  }

  function addKey(type: KeyType): void {
    if (!session || config.slots.length >= MAX_SLOTS) return;
    changed({ ...config, slots: [...config.slots, createSlot(type)] }, { render: 'keys' });
    catalogTotal.textContent = catalogTotalText(config.slots.length, { verb: 'Added', type });
    refreshCatalog(`[data-add-type="${type}"]`, `[data-remove-type="${type}"]`);
  }

  function removeKeyOfType(type: KeyType): void {
    if (!session) return;
    const result = removeOneOfType(config, type);
    if (!result) return;
    const owner = session;
    changed(result.config, { render: 'keys' });
    catalogTotal.textContent = catalogTotalText(config.slots.length, { verb: 'Removed', type });
    refreshCatalog(`[data-remove-type="${type}"]`, `[data-add-type="${type}"]`);
    if (result.custom) {
      toast(removedMessage(result.slot), { action: { label: 'Undo', run: () => undoRemove(owner, result.slot, result.index) } });
    }
  }

  keySearch.addEventListener('input', renderCatalog);
  keyDialog.addEventListener('click', event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('[data-add-type], [data-remove-type]');
    if (!button || button.disabled) return;
    if (button.dataset.addType) addKey(button.dataset.addType as KeyType);
    else removeKeyOfType(button.dataset.removeType as KeyType);
  });

  /* ───────────── Preview and generation ───────────── */

  function setExploded(value: boolean): void {
    exploded = value;
    preview?.setExploded(value);
    explodeButton.setAttribute('aria-pressed', String(value));
  }

  function invalidate(): void {
    revision++;
    readyRevision = -1;
    controller?.abort();
    clearTimeout(debounce);
    errorAnnouncer.cancel();
    downloadResult.hidden = true;
    filamentButton.hidden = true;
    estimate = '';
    if (!session) return;
    if (inputErrors.size) {
      setPreviewState('invalid');
      errorAnnouncer.schedule(inputErrors.values().next().value!);
      return;
    }
    if (tooSmall()) {
      setPreviewState('too-small');
      errorAnnouncer.schedule(traySettingsState(config).size.readout);
      return;
    }
    errorAnnouncer.reset(); // a fixed error is spoken again if it comes back
    if (!config.slots.length) {
      currentProject = undefined;
      meshes = new Map();
      displayedToken = -1;
      dimensions.textContent = '';
      explodeButton.hidden = true;
      setPreviewState('empty');
      return;
    }
    progress = { index: 0, total: 0, label: '' };
    setPreviewState('generating');
    debounce = setTimeout(() => void generate(), DEBOUNCE_MS);
  }

  function setPreviewState(state: PreviewState, message = ''): void {
    const hadFocus = previewHasFocus();
    previewState = state;
    failureMessage = message;
    renderPreview();
    renderDownloadState();
    if (downloadDialog.open) renderDownloadDialog();
    // Resume / Try again / Cancel may have been replaced or hidden while focused.
    if (hadFocus && !previewHasFocus()) focusPreviewFallback();
  }

  function previewHasFocus(): boolean {
    const active = document.activeElement;
    return !!active && (overlay.contains(active) || chip.contains(active)) && isShown(active);
  }

  /** The overlay's first action, else the preview itself (never the chip's Cancel: another Enter would cancel again). */
  function focusPreviewFallback(): void {
    const target = [overlay.querySelector<HTMLElement>('.overlay-actions button'), card.querySelector<HTMLElement>('.preview-canvas'), ...downloadButtons]
      .find(isShown) ?? titleEl;
    target.focus({ preventScroll: true });
  }

  function renderChip(): void {
    clearTimeout(chipTimer);
    if (previewState === 'generating') {
      const text = progress.total ? progress.label : 'Updating model…';
      const current = chip.querySelector('.chip-text');
      if (chip.dataset.mode === 'generating' && current) current.textContent = text;
      else {
        chip.dataset.mode = 'generating';
        chip.innerHTML = `<span class="spinner" aria-hidden="true"></span><span class="chip-text">${esc(text)}</span><button type="button" class="text-button" data-action="cancel">Cancel</button>`;
      }
      chip.classList.remove('is-fading');
      chip.hidden = false;
    } else if (previewState === 'ready') {
      chip.dataset.mode = 'ready';
      chip.innerHTML = `${icon('check')}<span class="chip-text">Ready</span>`;
      chip.classList.remove('is-fading');
      chip.hidden = false;
      chipTimer = setTimeout(() => {
        chip.classList.add('is-fading');
        chipTimer = setTimeout(() => { chip.hidden = true; }, 400);
      }, READY_CHIP_MS);
    } else {
      chip.dataset.mode = '';
      chip.hidden = true;
    }
  }

  function renderPreview(): void {
    const state = previewState;
    card.dataset.state = state;
    const hasModel = displayedToken !== -1;
    const foreign = displayedToken !== openToken;
    card.toggleAttribute('data-stale', hasModel && (STALE_STATES.has(state) || (state === 'generating' && foreign)));
    viewer.style.visibility = state === 'empty' ? 'hidden' : '';
    renderChip();
    const size = state === 'too-small' ? traySettingsState(config).size : undefined;
    const model = previewOverlay(state, {
      errors: errorCount(), message: failureMessage,
      required: size && { width: size.requiredWidth, depth: size.requiredDepth },
      grow: size?.grow ?? undefined,
    });
    const html = model ? `<div class="overlay-card${model.tone === 'error' ? ' is-error' : ''}">${icon(model.icon, 'overlay-icon')}<p class="overlay-text">${esc(model.text)}</p>`
      + `<div class="overlay-actions">${model.actions.map(a => `<button type="button" class="button ${a.primary ? 'primary' : 'secondary'}" data-action="${a.action}">`
        + `${a.action === 'add' ? icon('plus') : ''}${esc(a.label)}</button>`).join('')}</div></div>` : '';
    if (overlay.innerHTML !== html) overlay.innerHTML = html;
    overlay.hidden = !model;
    renderOrbitHint();
  }

  function renderOrbitHint(): void {
    const show = !!preview && !env.prefs().seen.orbitHint && previewState !== 'empty' && !!session;
    orbitHint.hidden = !show;
    if (show) orbitHint.textContent = coarseQuery.matches ? 'Drag to rotate · Pinch to zoom' : 'Drag to rotate · Scroll to zoom';
  }

  coarseQuery.addEventListener('change', renderOrbitHint);
  viewer.addEventListener('pointerdown', () => {
    const prefs = env.prefs();
    if (prefs.seen.orbitHint) return;
    prefs.seen.orbitHint = true;
    env.savePrefs();
    renderOrbitHint();
  });

  function renderDownloadState(): void {
    const s = status();
    const state = downloadButtonState(s);
    for (const button of downloadButtons) {
      button.setAttribute('aria-disabled', String(state.blocked));
      button.dataset.download = state.action;
      const label = button.querySelector('.download-label')!;
      if (label.textContent !== state.label) label.textContent = state.label;
    }
    const text = mobileStatusText(s, estimate);
    mobileStatus.dataset.state = s.unsaved ? 'failed' : s.errors ? 'invalid' : previewState;
    // "Ready · ≈ 24 g": the estimate opens the filament details, as on the desktop preview.
    const html = text.endsWith(estimate) && estimate && previewState === 'ready'
      ? `${esc(text.slice(0, -estimate.length))}<button type="button" class="text-button mobile-estimate" data-action="filament-info" aria-label="Estimated filament ${esc(estimate)}. Details">${esc(estimate)}</button>`
      : esc(text);
    if (mobileHtml !== html) { mobileHtml = html; mobileStatus.innerHTML = html; }
  }

  async function generate(): Promise<void> {
    const jobRevision = revision;
    await env.bootGate;
    if (env.pwaStatus().applying || revision !== jobRevision || !session) return;
    controller?.abort();
    const abort = new AbortController();
    controller = abort;
    const stale = () => abort.signal.aborted || revision !== jobRevision;
    const token = openToken;
    const generated = new Map<string, ArrayBuffer>();
    let legacyLid: ReturnType<typeof readLegacyLidSize>;
    try {
      const project = buildProject(config);
      if (!project.parts.length) throw new Error('Add a key to create your organizer.');
      for (let i = 0; i < project.parts.length; i++) {
        const part = project.parts[i];
        progress = { index: i, total: project.parts.length, label: generationLabel(part.name, i, project.parts.length) };
        renderChip();
        if (downloadDialog.open) renderDownloadDialog();
        let bytes = meshCache.get(part.scad);
        if (part.id === 'tray-lid') legacyLid = lidMetricCache.get(part.scad);
        if (!bytes) {
          bytes = await renderScad(part.scad, {
            jobId: `${jobRevision}-${i}`, revision: jobRevision, partId: part.id, signal: abort.signal,
            onLog: line => { if (part.id === 'tray-lid') legacyLid = readLegacyLidSize(line) ?? legacyLid; },
          });
          if (stale()) return;
          if (meshCache.size >= MESH_CACHE_SIZE) {
            const oldest = meshCache.keys().next().value!;
            meshCache.delete(oldest);
            lidMetricCache.delete(oldest);
          }
          meshCache.set(part.scad, bytes);
          if (part.id === 'tray-lid' && legacyLid) lidMetricCache.set(part.scad, legacyLid);
        }
        generated.set(part.id, bytes);
      }
      if (stale()) return;
      // Older projects store lid text in millimetres. The first lid render reports the exact
      // percentage; store it without counting as an edit (no new project, no "Edited" change).
      const tray = config.options.tray;
      if (config.template === 'inventory_tray' && tray.lid && tray.lidTextPercent === undefined) {
        const migration = legacyLid ?? (!tray.lidText.trim() ? { percent: 100, rotation: 0 as const } : undefined);
        if (migration) {
          const next = structuredClone(config);
          next.options.tray.lidTextPercent = migration.percent;
          next.options.tray.lidTextRotation = migration.rotation;
          changed(next, { render: 'settings', touch: false });
          return;
        }
      }
      try { await preview?.setProject(project, generated, abort.signal); }
      catch (error) {
        if (stale()) return;
        console.error(error);
        toast('Model ready. Some reference keys could not be displayed.');
      }
      if (stale()) return;
      currentProject = project;
      meshes = generated;
      displayedToken = token;
      preview?.setShowKeys(env.prefs().showKeys);
      preview?.setExploded(exploded);
      readyRevision = jobRevision;
      dimensions.innerHTML = `${project.dimensions.map(n => n.toFixed(1).replace(/\.0$/, '')).join(' <i>×</i> ')} <small>mm</small>`;
      renderFilament(generated);
      fillPartOptions(project);
      explodeButton.hidden = project.parts.length < 2;
      setPreviewState('ready');
      announceModel(downloadDialog.open ? `Model ready. ${primaryDownloadLabel(selectedFormat(), project.parts.length, partSelect.value || undefined)} is available.` : 'Model ready.');
    } catch (error) {
      if (stale()) return;
      console.error(error);
      const message = (error instanceof Error && error.message) || FAILED_TEXT;
      if (isOfflineSetupFailure(message, env.pwaStatus(), navigator.onLine)) {
        setPreviewState('offline-setup');
        announceModel(OFFLINE_SETUP_TEXT);
      } else {
        setPreviewState('failed', message);
        announceModel(message);
      }
    }
  }

  function renderFilament(generated: Map<string, ArrayBuffer>): void {
    try {
      const result = estimateFilament(generated.values());
      estimate = gramsText(result.grams);
      filamentValue.textContent = estimate;
      filamentButton.setAttribute('aria-label', `Estimated filament ${estimate}. Details`);
      filamentButton.title = 'Estimated filament · 5% infill';
      filamentDetail.innerHTML = filamentDetailMarkup(result.grams, result.meters);
      filamentButton.hidden = false;
    } catch (error) {
      console.warn(error);
      estimate = '';
      filamentButton.hidden = true;
    }
  }

  function cancelGeneration(): void {
    controller?.abort();
    clearTimeout(debounce);
    setPreviewState('paused');
    overlay.querySelector<HTMLElement>('[data-action="retry"]')?.focus();
  }

  /* ───────────── Download ───────────── */

  const selectedFormat = (): DownloadFormat => (downloadDialog.querySelector<HTMLInputElement>('input[name="format"]:checked')?.value ?? '3mf') as DownloadFormat;

  function fillPartOptions(project: ProjectGeometry): void {
    const value = partSelectValue(partSelect.value, partSelect.options.length, project.parts.map(p => p.id));
    partSelect.innerHTML = (project.parts.length > 1 ? `<option value="">All ${project.parts.length} parts</option>` : '')
      + project.parts.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    partSelect.value = value;
  }

  function renderDownloadTips(): void {
    const tip = printTip(config);
    trayTip.innerHTML = tip ? `${icon('info')}<span>${esc(tip)}</span>` : '';
    trayTip.hidden = !tip;
    dockTip.hidden = config.template !== 'desktop_dock';
  }

  function renderDownloadDialog(): void {
    const parts = currentProject?.parts ?? [];
    partField.hidden = parts.length < 2;
    const format = selectedFormat();
    const partId = partSelect.value || undefined;
    const note = formatNote(format, isZipDownload(format, parts.length, partId));
    formatNoteEl.textContent = note;
    formatNoteEl.hidden = !note;
    const ready = readyRevision === revision && !!currentProject;
    downloadFileButton.disabled = !ready;
    downloadFileLabel.textContent = previewState === 'generating' ? preparingLabel(progress) : primaryDownloadLabel(format, parts.length, partId);
    // Why the button is disabled, with Try again: the preview overlay is behind the modal.
    const problem = downloadDialogStatus(previewState, failureMessage);
    const html = problem ? `${icon(problem.icon)}<span class="callout-text">${esc(problem.text)}</span><span class="callout-actions">`
      + problem.actions.map(a => `<button type="button" class="button secondary compact" data-action="${a.action}">${esc(a.label)}</button>`).join('') + '</span>' : '';
    if (downloadStateHtml !== html) { downloadStateHtml = html; downloadStateEl.innerHTML = html; }
    downloadStateEl.classList.toggle('error', problem?.tone === 'error');
    downloadStateEl.classList.toggle('warn', previewState === 'offline-setup');
    downloadStateEl.hidden = !problem;
  }

  function openDownloadDialog(): void {
    if (!session) return;
    session.flush();
    downloadResult.hidden = true;
    renderDownloadTips();
    renderDownloadDialog();
    openDialog(downloadDialog, () => downloadButtons.find(b => isShown(b)));
  }

  function onDownloadButton(): void {
    surfacePendingErrors(); // normally done on blur already
    switch (downloadButtonState(status()).action) {
      case 'add': openKeyDialog(); break;
      case 'fix': focusFirstError(); break;
      case 'retry': overlay.querySelector<HTMLElement>('[data-action="retry"]')?.focus(); break;
      case 'open': openDownloadDialog(); break;
    }
  }

  function downloadSelected(): void {
    if (readyRevision !== revision || !currentProject || !session) return;
    session.flush();
    const partId = partSelect.value || undefined;
    const format = selectedFormat();
    try {
      if (format === '3mf') {
        const bytes = build3mf(currentProject, meshes, { partId, title: session.name });
        downloadFile(partFileName(session.name, currentProject, config.template, '3mf', partId), bytes.buffer as ArrayBuffer, 'model/3mf');
      } else downloadParts(format, config, currentProject, meshes, partId, session.name);
    } catch (error) {
      downloadResult.hidden = false;
      downloadResult.textContent = errorText(error);
    }
  }

  function exportFile(): void {
    if (!session) return;
    session.flush();
    downloadProject(config, session.name);
  }

  downloadFileButton.addEventListener('click', downloadSelected);
  downloadDialog.addEventListener('change', event => {
    if ((event.target as Element).matches('input[name="format"], #download-part')) { downloadResult.hidden = true; renderDownloadDialog(); }
  });
  downloadDialog.addEventListener('click', event => {
    const target = event.target as Element;
    if (target.closest('[data-action="backup"]')) exportFile();
    else if (target.closest('#download-state [data-action="retry"]')) {
      invalidate();
      // Try again is hidden while generating; the progress shows on the (disabled) Download button.
      const active = document.activeElement;
      if (!active || !downloadDialog.contains(active) || !isShown(active)) downloadDialog.querySelector<HTMLElement>('input[name="format"]:checked')?.focus();
    }
  });
  // downloadFile() reports each generated file, so a blocked automatic download can be saved by hand.
  window.addEventListener(DOWNLOAD_READY_EVENT, event => {
    const { name, url, byteLength } = (event as CustomEvent<DownloadReadyDetail>).detail;
    const lead = document.createElement('span');
    lead.textContent = "Didn't start? ";
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.textContent = `Save ${name} (${fileSizeText(byteLength)})`;
    downloadResult.replaceChildren(lead, link);
    downloadResult.hidden = false;
  });

  /* ───────────── Project menu ───────────── */

  function openProjectMenu(): void {
    const s = session;
    if (!s) return;
    const items: MenuItem[] = [{ label: 'Rename', icon: 'edit', run: startRename }];
    if (s.persisted) {
      items.push({ label: 'Duplicate', icon: 'copy', run: () => duplicateFromEditor(env.actions) });
      if (config.template === 'inventory_tray') {
        const layer = matchingLayerAvailability(config);
        items.push({ label: 'New matching layer', icon: 'layers', disabled: !layer.available, hint: layer.reason, run: newLayer });
      }
    }
    items.push({ label: 'Save project file (.json)', icon: 'file', run: exportFile });
    if (s.persisted) items.push({ label: 'Delete project', icon: 'trash', danger: true, separatorBefore: true, run: () => deleteWithUndo(s.id!, env.actions) });
    else items.push({ label: 'Discard', icon: 'trash', danger: true, separatorBefore: true, run: () => { discarding = true; env.actions.goHome(); discarding = false; } });
    openMenu(projectMenuButton, items, 'Project actions');
  }

  /* ───────────── Clicks ───────────── */

  root.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('button, a');
    if (!target || !root.contains(target) || (target as HTMLButtonElement).disabled) return;
    if (target === projectMenuButton) { openProjectMenu(); return; }
    if (target === showKeysButton) {
      const prefs = env.prefs();
      prefs.showKeys = !prefs.showKeys;
      env.savePrefs();
      applyPrefs();
      return;
    }
    if (target === explodeButton) { setExploded(!exploded); return; }
    if (target === qualityButton) {
      const prefs = env.prefs();
      prefs.quality = prefs.quality === 'high' ? 'low' : 'high';
      env.savePrefs();
      applyPrefs();
      return;
    }
    if (target.dataset.view) { preview?.setView(target.dataset.view as 'iso' | 'top' | 'front'); return; }
    if (target.dataset.move) {
      const [from, to] = target.dataset.move.split(',').map(Number);
      moveKey(from, to);
      return;
    }
    if (target.dataset.occupied) {
      changed({ ...config, slots: config.slots.map(s => (s.id === target.dataset.occupied ? { ...s, occupied: !s.occupied } : s)) }, { render: 'keys' });
      return;
    }
    if (target.dataset.remove) { removeKey(target.dataset.remove); return; }
    switch (target.dataset.action) {
      case 'home': env.actions.goHome(); break;
      case 'rename': startRename(); break;
      case 'download': onDownloadButton(); break;
      case 'backup': exportFile(); break;
      case 'add': openKeyDialog(); break;
      case 'show-error': focusFirstError(); break;
      case 'lock-footprint': setFootprint('lock'); break;
      case 'grow-footprint': setFootprint('grow'); break;
      case 'auto-footprint': setFootprint('auto'); break;
      case 'new-layer': newLayer(); break;
      case 'help-stacking': env.openHelp('help-stacking'); break;
      case 'dismiss-dock-notice': dismissDockNotice(); break;
      case 'retry': invalidate(); break;
      case 'cancel': cancelGeneration(); break;
      case 'camera-reset': preview?.resetCamera(); break;
      case 'filament-info': openDialog(filamentDialog); break;
      case 'remote-restore': remoteAction('restore'); break;
      case 'remote-save-new': remoteAction('save-new'); break;
    }
  });

  /* ───────────── Display preferences ───────────── */

  function applyPrefs(): void {
    const prefs = env.prefs();
    preview?.setShowKeys(prefs.showKeys);
    showKeysButton.setAttribute('aria-pressed', String(prefs.showKeys));
    preview?.setQuality(prefs.quality);
    qualityButton.setAttribute('aria-pressed', String(prefs.quality === 'high'));
    if (prefs.seen.dockNotice) settingsPanel.querySelector('#dock-notice')?.remove();
    openGroups.clear();
    renderOrbitHint();
  }

  // The quality toggle is icon-only on small screens.
  const syncCompactLabels = () => {
    if (compactQuery.matches) qualityButton.setAttribute('aria-label', 'High-quality preview');
    else qualityButton.removeAttribute('aria-label');
  };
  compactQuery.addEventListener('change', syncCompactLabels);
  syncCompactLabels();
  applyPrefs();

  /* ───────────── Open / close ───────────── */

  function open(start: ProjectRecord | { config: HolderConfig }, options: { ui?: UiState } = {}): void {
    close();
    openToken++;
    session = new ProjectSession(env.store.local, start, events, { session: env.store.session });
    config = session.config;
    panel = options.ui?.panel ?? 'keys';
    panelScroll.keys = panelScroll.settings = 0;
    inputErrors.clear();
    clearPendingErrors();
    errorAnnouncer.reset();
    memory.errorGroups.clear();
    if (saveError) env.onSaveProblem?.(false);
    saveError = undefined;
    renaming = false;
    renderedName = undefined;
    renameError.hidden = true;
    hideRemoteBanner();
    setExploded(true);
    currentProject = undefined;
    meshes = new Map();
    readyRevision = -1;
    dimensions.textContent = '';
    explodeButton.hidden = true;
    partSelect.innerHTML = '';
    panelBody.scrollTop = 0;
    settingsPanel.dataset.template = '';
    update('all');
    renderSaveState();
    invalidate();
    const ui = options.ui;
    if (ui) {
      requestAnimationFrame(() => {
        if (desktopLayout()) panelBody.scrollTop = ui.panelScroll;
        window.scrollTo({ top: ui.windowScroll });
      });
    }
  }

  function close(): void {
    if (!session) return;
    const s = session;
    const pendingName = renaming ? titleEl.querySelector<HTMLInputElement>('#project-name-input')?.value.trim() ?? '' : '';
    renaming = false;
    renderedName = undefined;
    // Detach first: close() runs while the URL already shows the next route (Back/Forward, another
    // project), so onSaved from the rename or the final flush must not sync the URL to this project.
    session = undefined;
    controller?.abort();
    clearTimeout(debounce);
    clearTimeout(chipTimer);
    clearPendingErrors();
    errorAnnouncer.cancel();
    revision++;
    readyRevision = -1;
    if (pendingName && pendingName !== s.name) {
      try { s.rename(pendingName); } catch (error) { toast(renameErrorText(error)); }
    }
    // A failed final save (storage full, project deleted elsewhere) would otherwise drop the edit silently.
    if (!s.dispose() && !discarding) {
      toast(`Your latest change to “${s.name}” couldn't be saved.`, { action: { label: 'Save project file', run: () => downloadProject(s.config, s.name) } });
    }
    if (isMenuOpen(projectMenuButton)) closeMenu(false);
    const helpText = document.getElementById('tray-lock-help-text');
    if (helpText) helpText.hidden = true;
  }

  return {
    get session() { return session; },
    open,
    close,
    openKeyDialog,
    focusHeading: () => titleEl.focus(),
    // pagehide, hidden and app updates: an open rename is committed too (unload fires no blur).
    flush: () => { if (renaming) finishRename(true, false); return session?.flush() ?? true; },
    stopGeneration: () => { controller?.abort(); clearTimeout(debounce); },
    uiState: () => (session ? { panel, panelScroll: currentScroll(), windowScroll: window.scrollY } : undefined),
    handleStorageEvent: event => session?.handleStorageEvent(event),
    sync: () => session?.sync(),
    applyPrefs,
    setTheme: theme => preview?.setTheme(theme),
    saveShortcut: () => {
      if (!session) return;
      session.flush();
      toast('yubi-orginizer saves automatically.');
    },
    documentTitle: () => (session ? `${session.name} — yubi-orginizer` : 'yubi-orginizer'),
  };
}
