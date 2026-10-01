/**
 * The Projects page (#projects-page): first-run screen, project cards, card menus,
 * inline rename, import/export, Recently deleted and storage banners.
 * All handlers are delegated on the root; render() rebuilds the markup and restores focus.
 */
import './shared.css';
import './projects-view.css';
import { defaultConfig, TEMPLATES } from '../config';
import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { downloadFile, projectsArchive, projectsArchiveName } from '../export';
import { inventoryTrayLayout, keyDimensions } from '../geometry';
import { icon, keyIcon } from '../icons';
import {
  createProject, deleteProjectForever, importProject, listProjects, PROJECT_KEY_PREFIX, renameProject, restoreProject,
  type ProjectList, type ProjectRecord, type ProjectStorage,
} from '../projects';
import { traySlideDirection } from '../tray-slide';
import type { HolderConfig, TemplateId, TraySlideDirection } from '../types';
import { esc, fmt, isTextEntry, plural, relativeTime, shortcutLetter } from './dom';
import { closeMenu, isMenuOpen, openMenu, type MenuItem } from './menu';
import {
  confirmAction, deleteWithUndo, duplicateInList, exportProjectFile, highlightInList, matchingLayerAvailability,
  openMatchingLayerDialog, requestPersistentStorage, takeListHints, type ProjectActionsDeps,
} from './project-actions';
import { SLIDE_DIRECTION_OPTIONS } from './settings-model';
import { runToastAction, toast } from './toast';

export interface ProjectsViewDeps extends ProjectActionsDeps {
  /** Navigates to #/new/<template>. */
  newProject(template: TemplateId): void;
  /** Older (legacy) storage keys that could not be moved to projects; kept, and offered as raw data. */
  legacyProblemKeys?(): string[];
}
export interface ProjectsView {
  /** Idempotent. Keeps focus where it was inside the page; never grabs focus on its own. */
  render(): void;
}

const MAX_IMPORT_BYTES = 256_000;
/** Export all (.zip) backups: compressed size and number of project files. */
const MAX_ARCHIVE_BYTES = 16_000_000;
const MAX_ARCHIVE_FILES = 500;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const SEARCH_THRESHOLD = 8;
const DOCK_GLYPHS = 10;
const SLOT_WIDTH = 18.6;
const RAW_DATA_FILE = 'yubi-orginizer-unreadable-data.json';

const quoted = (text: string): string => `“${text}”`;
const messageOf = (error: unknown): string => (error instanceof Error && error.message) || 'Something went wrong.';
const templateName = (id: TemplateId): string => TEMPLATES.find(t => t.id === id)?.name ?? 'Organizer';
const slideArrow = (direction: TraySlideDirection): string =>
  SLIDE_DIRECTION_OPTIONS.find(o => o.value === traySlideDirection(direction).id)?.label.split(' ')[0] ?? '';

/* ───────────── Pure helpers (unit-tested) ───────────── */

/** Card meta line and chips. Trays: "Inventory tray · 6 keys · 118 × 96 mm" (size with keys or a fixed size); docks: "Desktop dock · 4 keys". */
export function projectCardInfo(record: ProjectRecord): { meta: string; chips: string[] } {
  const config = record.config;
  const keys = plural(config.slots.length, 'key');
  if (config.template !== 'inventory_tray') return { meta: `${templateName(config.template)} · ${keys}`, chips: [] };
  const tray = config.options.tray;
  const meta = [templateName(config.template), keys];
  if (config.slots.length > 0 || tray.footprint) {
    const layout = inventoryTrayLayout(config);
    meta.push(`${fmt(layout.width)} × ${fmt(layout.depth)} mm`);
  }
  const chips: string[] = [];
  if (tray.connection === 'stackable') chips.push('Stackable');
  if (tray.connection === 'h20_slide_v7') chips.push(`Slide-lock ${slideArrow(tray.slideDirection)}`);
  if (tray.connection === 'snap_fit') chips.push('Snap-fit');
  if (tray.lid) chips.push('Lid');
  if (tray.footprint) chips.push('Fixed size');
  return { meta: meta.join(' · '), chips };
}

function emptyThumbnail(kind: 'tray' | 'dock', size = { width: 96, depth: 64 }): string {
  const { width: w, depth: d } = size;
  return `<span class="thumb-empty"><svg class="thumb" viewBox="${fmt(-w / 2 - 2)} ${fmt(-d / 2 - 2)} ${fmt(w + 4)} ${fmt(d + 4)}" aria-hidden="true" focusable="false">`
    + `<rect class="thumb-footprint is-empty" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" rx="3"/></svg>${icon(kind)}</span>`;
}

/**
 * Schematic thumbnail drawn from the config (no raster, no storage).
 * Trays: footprint plus one rect per slot (hidden-in-preview slots dashed). Docks: up to 10 key glyphs, then "+N".
 */
export function projectThumbnail(config: HolderConfig): string {
  if (config.template === 'desktop_dock') {
    if (!config.slots.length) return emptyThumbnail('dock');
    const extra = config.slots.length - DOCK_GLYPHS;
    return `<span class="thumb-dock">${config.slots.slice(0, DOCK_GLYPHS).map(s => keyIcon(s.type)).join('')}`
      + `${extra > 0 ? `<span class="thumb-more">+${extra}</span>` : ''}</span>`;
  }
  if (!config.slots.length) return emptyThumbnail('tray', config.options.tray.footprint ?? undefined);
  const layout = inventoryTrayLayout(config);
  const w = layout.width, d = layout.depth;
  const slots = config.slots.map((slot, i) => {
    const [x, y] = layout.xy[i];
    const h = keyDimensions[slot.type].pocketLength;
    return `<rect class="thumb-slot${slot.occupied ? '' : ' is-hidden'}" x="${fmt(x - SLOT_WIDTH / 2)}" y="${fmt(-y - h / 2)}" width="${SLOT_WIDTH}" height="${fmt(h)}" rx="1.5"/>`;
  }).join('');
  return `<svg class="thumb thumb-tray" viewBox="${fmt(-w / 2 - 2)} ${fmt(-d / 2 - 2)} ${fmt(w + 4)} ${fmt(d + 4)}" aria-hidden="true" focusable="false">`
    + `<rect class="thumb-footprint" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" rx="3"/>${slots}</svg>`;
}

/** No live projects, nothing in Recently deleted and nothing unreadable. */
export function isFirstRun(list: ProjectList): boolean {
  return !list.projects.length && !list.deleted.length && !list.problems.length;
}

/** "Imported “Desk”.", "Imported 3 projects.", "Couldn't import “bad.json”: …", "Imported 2 projects. Couldn't import “bad.json”." */
export function importSummary(imported: readonly { name: string }[], failed: readonly { file: string; message: string }[]): string {
  const done = imported.length === 1 ? `Imported ${quoted(imported[0].name)}.` : imported.length ? `Imported ${imported.length} projects.` : '';
  if (!failed.length) return done;
  const names = failed.length === 1 ? quoted(failed[0].file)
    : failed.length === 2 ? `${quoted(failed[0].file)} and ${quoted(failed[1].file)}` : `${failed.length} files`;
  if (imported.length) return `${done} Couldn't import ${names}.`;
  const same = failed.every(f => f.message === failed[0].message);
  return same ? `Couldn't import ${names}: ${failed[0].message}` : `Couldn't import ${names}.`;
}

async function isZipFile(file: File): Promise<boolean> {
  if (/\.zip$/i.test(file.name)) return true;
  try {
    const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
    return ZIP_MAGIC.every((byte, i) => head[i] === byte);
  } catch { return false; }
}

export interface ImportResult {
  imported: ProjectRecord[];
  failed: { file: string; message: string }[];
  /** How many of the chosen files were ZIP backups. */
  archives: number;
}

/** Imports project files (.json) and Export all backups (.zip). Never throws: failures are listed per file. */
export async function importProjectFiles(storage: ProjectStorage, files: readonly File[]): Promise<ImportResult> {
  const result: ImportResult = { imported: [], failed: [], archives: 0 };
  const add = (text: string, fileName: string): void => {
    try { result.imported.push(importProject(storage, text, fileName)); } catch (error) { result.failed.push({ file: fileName, message: messageOf(error) }); }
  };
  for (const file of files) {
    if (await isZipFile(file)) {
      result.archives++;
      if (file.size > MAX_ARCHIVE_BYTES) { result.failed.push({ file: file.name, message: 'Choose a backup smaller than 16 MB.' }); continue; }
      const tooLarge: string[] = [];
      let count = 0, skipped = 0;
      let entries: Unzipped;
      try {
        entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
          filter: entry => {
            if (!/\.json$/i.test(entry.name) || entry.name.startsWith('__MACOSX/')) return false;
            if (entry.originalSize > MAX_IMPORT_BYTES) { tooLarge.push(entry.name); return false; }
            if (count >= MAX_ARCHIVE_FILES) { skipped++; return false; }
            count++;
            return true;
          },
        });
      } catch { result.failed.push({ file: file.name, message: 'This ZIP file could not be read.' }); continue; }
      const names = Object.keys(entries);
      if (!names.length && !tooLarge.length) { result.failed.push({ file: file.name, message: 'This ZIP has no organizer project files.' }); continue; }
      for (const name of tooLarge) result.failed.push({ file: name.split('/').pop() || name, message: 'Choose a project file smaller than 256 KB.' });
      for (const name of names) add(strFromU8(entries[name]), name.split('/').pop() || name);
      if (skipped) result.failed.push({ file: file.name, message: `Only the first ${MAX_ARCHIVE_FILES} project files can be imported at once.` });
      continue;
    }
    if (file.size > MAX_IMPORT_BYTES) { result.failed.push({ file: file.name, message: 'Choose a project file smaller than 256 KB.' }); continue; }
    let text: string;
    try { text = await file.text(); } catch (error) { result.failed.push({ file: file.name, message: messageOf(error) }); continue; }
    add(text, file.name);
  }
  return result;
}

function isIosBrowserTab(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/* ───────────── View ───────────── */

export function createProjectsView(root: HTMLElement, deps: ProjectsViewDeps): ProjectsView {
  const content = document.createElement('div');
  content.className = 'projects-view';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.id = 'project-file';
  fileInput.accept = '.json,application/json,.zip,application/zip';
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.tabIndex = -1;
  root.replaceChildren(content, fileInput);

  // Actions started here re-render this view directly (and consume highlight/focus hints).
  const actions: ProjectActionsDeps = {
    get store() { return deps.store; },
    session: () => deps.session(),
    open: (id, options) => deps.open(id, options),
    goHome: () => deps.goHome(),
    refreshList: () => render(),
  };

  let list: ProjectList = { projects: [], deleted: [], problems: [] };
  let query = '';
  let deletedOpen = false;
  let rename: { id: string; value: string; error?: string; select?: boolean } | undefined;
  let focusAfter: string | undefined;
  let rendering = false;
  let committing = false;

  const store = () => deps.store.local;
  const legacyKeys = (): string[] => { try { return deps.legacyProblemKeys?.() ?? []; } catch { return []; } };
  const visible = (): boolean => root.isConnected && !root.hidden && root.getClientRects().length > 0;
  const openSelector = (id: string): string => `[data-open="${id}"]`;

  /* ── Markup ── */

  function cardMarkup(record: ProjectRecord, now: Date, highlight: boolean): string {
    const { meta, chips } = projectCardInfo(record);
    const thumb = `<span class="card-thumb" aria-hidden="true">${projectThumbnail(record.config)}</span>`;
    if (rename?.id === record.id) {
      return `<li class="project-card is-renaming" data-project="${record.id}"><div class="card-rename">${thumb}
        <input id="card-rename-input" class="card-name-input" type="text" maxlength="80" autocomplete="off" value="${esc(rename.value)}"
          aria-label="Project name" aria-describedby="card-rename-error"${rename.error ? ' aria-invalid="true"' : ''}/>
        <p class="field-error" id="card-rename-error" role="alert"${rename.error ? '' : ' hidden'}>${esc(rename.error ?? '')}</p>
        <span class="card-meta">${esc(meta)}</span></div></li>`;
    }
    const edited = relativeTime(record.updatedAt, now);
    const label = `Open ${record.name}, ${templateName(record.config.template)}, ${plural(record.config.slots.length, 'key')}, edited ${edited}`;
    return `<li class="project-card${highlight ? ' is-new' : ''}" data-project="${record.id}">
      <button type="button" class="card-open" data-open="${record.id}" aria-label="${esc(label)}">${thumb}
        <span class="card-name">${esc(record.name)}</span>
        <span class="card-meta">${esc(meta)}</span>
        <span class="card-chips">${chips.map(c => `<span class="chip">${esc(c)}</span>`).join('')}</span>
        <span class="card-time">Edited ${esc(edited)}</span>
      </button>
      <button type="button" class="icon-button card-menu" data-card-menu="${record.id}" aria-label="${esc(`Actions for ${record.name}`)}" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button>
    </li>`;
  }

  function gridMarkup(highlight: ReadonlySet<string>): string {
    const now = new Date();
    if (!list.projects.length) {
      return `<p class="projects-empty">${list.deleted.length ? 'No projects. Restore one from Recently deleted, or start a new one.' : 'No projects yet.'}</p>`;
    }
    const q = query.trim().toLocaleLowerCase();
    const shown = q ? list.projects.filter(p => p.name.toLocaleLowerCase().includes(q)) : list.projects;
    if (!shown.length) return `<p class="projects-empty" role="status">No projects match ${esc(quoted(query.trim()))}.</p>`;
    return `<ul class="project-grid" aria-label="Projects">${shown.map(p => cardMarkup(p, now, highlight.has(p.id))).join('')}</ul>`;
  }

  function bannersMarkup(): string {
    const banners: string[] = [];
    if (!deps.store.persistent) {
      banners.push(`<div class="callout warn projects-banner" role="note">${icon('alert')}<span>This browser is blocking storage, so projects disappear when you close this tab. Save project files to keep your work.</span></div>`);
    }
    const n = list.problems.length;
    const legacy = legacyKeys().length > 0;
    if (n || legacy) {
      const unreadable = n === 1 ? "1 saved project couldn't be read. It has been kept in this browser." : n ? `${n} saved projects couldn't be read. They have been kept in this browser.` : '';
      const older = !legacy ? '' : n ? "Some data from an older version couldn't be moved either." : "Some data from an older version couldn't be moved to Projects. It has been kept in this browser.";
      const text = [unreadable, older].filter(Boolean).join(' ');
      banners.push(`<div class="callout warn projects-banner" role="note">${icon('alert')}<span>${text}</span>`
        + `<button type="button" class="button secondary mini" data-projects-action="raw-data">${icon('download')}Download raw data</button></div>`);
    }
    return banners.join('');
  }

  function firstRunMarkup(): string {
    const card = (id: TemplateId, description: string, badge = ''): string =>
      `<button type="button" class="type-card type-${id}" data-new="${id}"><span class="type-visual">${icon(TEMPLATES.find(t => t.id === id)?.icon ?? 'cube')}</span>`
      + `<span class="type-name">${esc(templateName(id))}${badge}${icon('chevron')}</span><span class="type-description">${esc(description)}</span></button>`;
    return `<section class="first-run">
      <h1 id="projects-title" tabindex="-1">Design a YubiKey organizer</h1>
      <p class="first-run-lead">Pick a style to start. Everything runs in your browser and works offline.</p>
      ${bannersMarkup()}
      <div class="type-grid">
        ${card('inventory_tray', 'Flat pockets for many keys. Stackable, with an optional lid.')}
        ${card('desktop_dock', 'Upright sockets in a solid base.', ' <span class="badge">Beta</span>')}
      </div>
      <p class="first-run-links">
        <button type="button" class="text-button" data-projects-action="example">Start from an example</button>
        <span aria-hidden="true">·</span>
        <button type="button" class="text-button" data-projects-action="import">Import a project file</button>
      </p>
    </section>`;
  }

  function projectsMarkup(highlight: ReadonlySet<string>): string {
    const { projects, deleted } = list;
    const tile = (id: TemplateId, label: string, badge = ''): string =>
      `<button type="button" class="new-tile" data-new="${id}" aria-label="New ${label}">`
      + `${icon(TEMPLATES.find(t => t.id === id)?.icon ?? 'cube')}<span class="new-tile-name">${esc(templateName(id))}${badge}</span>${icon('plus', 'new-tile-plus')}</button>`;
    const search = projects.length > SEARCH_THRESHOLD
      ? `<div class="projects-search">${icon('search')}<input type="search" id="project-search" placeholder="Search projects" aria-label="Search projects" autocomplete="off" value="${esc(query)}"/></div>`
      : '';
    const safariNote = isIosBrowserTab()
      ? '<p>Safari may clear this data after 7 days without a visit, so export or save project files to keep your designs. A Home Screen app keeps its own projects, separate from Safari: import your files there.</p>' : '';
    const now = new Date();
    const deletedRows = deleted.map(r => `<li class="deleted-row">
        <span class="deleted-name">${esc(r.name)}</span>
        <span class="deleted-time">Deleted ${esc(relativeTime(r.deletedAt!, now))}</span>
        <span class="deleted-actions">
          <button type="button" class="button secondary mini" data-projects-action="restore" data-id="${r.id}" aria-label="${esc(`Restore ${r.name}`)}">Restore</button>
          <button type="button" class="button quiet danger mini" data-projects-action="forever" data-id="${r.id}" aria-label="${esc(`Delete ${r.name} forever`)}">Delete forever</button>
        </span></li>`).join('');
    return `<header class="projects-header">
        <h1 id="projects-title" tabindex="-1">Projects</h1>
        <button type="button" class="button secondary" data-projects-action="import">${icon('upload')}Import</button>
      </header>
      ${bannersMarkup()}
      <section class="projects-new" aria-labelledby="projects-new-title">
        <h2 id="projects-new-title" class="projects-section-title">New</h2>
        <div class="new-tiles">${tile('inventory_tray', 'inventory tray')}${tile('desktop_dock', 'desktop dock (Beta)', ' <span class="badge">Beta</span>')}</div>
      </section>
      ${search}
      <div id="project-results" class="project-results">${gridMarkup(highlight)}</div>
      <footer class="projects-footer">
        <div class="projects-footer-text"><p>Saved in this browser only. Export all or save project files to back up; Import restores them.</p>${safariNote}</div>
        ${projects.length ? `<button type="button" class="button secondary" data-projects-action="export-all">${icon('download')}Export all (.zip)</button>` : ''}
      </footer>
      ${deleted.length ? `<details class="recently-deleted"${deletedOpen ? ' open' : ''}>
        <summary>${icon('down')}<span>Recently deleted (${deleted.length})</span></summary>
        <ul class="deleted-list">${deletedRows}</ul>
        <p class="field-hint">Deleted projects are removed for good after 30 days.</p>
      </details>` : ''}`;
  }

  /* ── Rendering and focus ── */

  /** A selector that finds the same control after a re-render. */
  function focusKey(el: Element | null): string | undefined {
    if (!el || !content.contains(el)) return undefined;
    for (const attr of ['data-open', 'data-card-menu', 'data-new']) {
      const value = el.getAttribute(attr);
      if (value !== null) return `[${attr}="${value}"]`;
    }
    const action = el.getAttribute('data-projects-action');
    if (action) {
      const id = el.getAttribute('data-id');
      return id ? `[data-projects-action="${action}"][data-id="${id}"]` : `[data-projects-action="${action}"]`;
    }
    if (el.id) return `#${el.id}`;
    if (el.matches('.recently-deleted > summary')) return '.recently-deleted > summary';
    return undefined;
  }

  function render(): void {
    const openTrigger = content.querySelector<HTMLElement>('[data-card-menu][aria-expanded="true"]');
    if (openTrigger && isMenuOpen(openTrigger)) closeMenu(false);
    const active = document.activeElement;
    const previous = focusKey(active);
    const caret = active instanceof HTMLInputElement && content.contains(active) ? [active.selectionStart, active.selectionEnd] as const : undefined;

    list = listProjects(store());
    if (rename && !list.projects.some(p => p.id === rename!.id)) rename = undefined;
    if (list.projects.length <= SEARCH_THRESHOLD) query = '';
    const hints = takeListHints();
    const firstRun = isFirstRun(list);

    rendering = true;
    try { content.innerHTML = firstRun ? firstRunMarkup() : projectsMarkup(hints.highlight); } finally { rendering = false; }
    root.dataset.view = firstRun ? 'first-run' : 'projects';
    if (!root.hidden) document.title = firstRun ? 'yubi-orginizer' : 'Projects — yubi-orginizer';

    const target = hints.focus ? openSelector(hints.focus) : focusAfter ?? previous;
    focusAfter = undefined;
    const el = target ? content.querySelector<HTMLElement>(target) : null;
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement) {
      if (el.id === 'card-rename-input' && rename?.select) { el.select(); rename.select = false; }
      else if (caret && target === previous) el.setSelectionRange(caret[0], caret[1]);
    }
  }

  function renderGrid(): void {
    const results = content.querySelector<HTMLElement>('#project-results');
    if (results) results.innerHTML = gridMarkup(new Set());
  }

  /* ── Rename on a card ── */

  function startRename(id: string): void {
    const record = list.projects.find(p => p.id === id);
    if (!record) return;
    rename = { id, value: record.name, select: true };
    focusAfter = '#card-rename-input';
    render();
  }

  /** Leaves rename mode. After a blur the user's new focus target is kept instead. */
  function stopRename(id: string, refocus = true): void {
    rename = undefined;
    if (refocus) { focusAfter = openSelector(id); render(); return; }
    // A blur commit runs between mousedown and mouseup. Rebuild only this card: a full render
    // would replace the button being pressed, and its click would be lost.
    list = listProjects(store());
    const card = content.querySelector(`[data-project="${id}"]`);
    const record = list.projects.find(p => p.id === id);
    if (card && record) card.outerHTML = cardMarkup(record, new Date(), false); else render();
  }

  /** Enter or blur commits; a blank or unchanged name reverts silently. */
  function commitRename(fromBlur: boolean): void {
    const current = rename;
    if (!current || committing || rendering) return;
    committing = true;
    try {
      const value = current.value.trim();
      const record = list.projects.find(p => p.id === current.id);
      if (!value || !record || value === record.name) { stopRename(current.id, !fromBlur); return; }
      try {
        const session = deps.session();
        if (session?.id === current.id) session.rename(value); else renameProject(store(), current.id, value);
      } catch (error) {
        if (fromBlur) { toast(messageOf(error)); stopRename(current.id, false); return; } // never trap focus in the input
        rename = { ...current, error: messageOf(error) };
        focusAfter = '#card-rename-input';
        render();
        return;
      }
      stopRename(current.id, !fromBlur);
    } finally { committing = false; }
  }

  /* ── Card menu and actions ── */

  function deleteCard(id: string): void {
    const ids = [...content.querySelectorAll<HTMLElement>('[data-open]')].map(b => b.dataset.open!);
    const at = ids.indexOf(id);
    const next = ids[at + 1] ?? ids[at - 1];
    focusAfter = next ? openSelector(next) : '[data-new="inventory_tray"]';
    deleteWithUndo(id, actions);
    focusAfter = undefined;
  }

  function openCardMenu(trigger: HTMLElement, id: string): void {
    const record = list.projects.find(p => p.id === id);
    if (!record) return;
    const items: MenuItem[] = [
      { label: 'Open', icon: 'folder', run: () => deps.open(id) },
      { label: 'Rename', icon: 'edit', run: () => startRename(id) },
      { label: 'Duplicate', icon: 'copy', run: () => duplicateInList(id, actions) },
    ];
    if (record.config.template === 'inventory_tray') {
      const layer = matchingLayerAvailability(record.config);
      items.push({ label: 'New matching layer', icon: 'layers', disabled: !layer.available, hint: layer.reason, run: () => openMatchingLayerDialog(id, actions) });
    }
    items.push(
      { label: 'Save project file (.json)', icon: 'file', run: () => exportProjectFile(id, actions) },
      { label: 'Delete', icon: 'trash', danger: true, separatorBefore: true, run: () => deleteCard(id) },
    );
    openMenu(trigger, items, `Actions for ${record.name}`);
  }

  async function importFiles(files: File[]): Promise<void> {
    const { imported, failed, archives } = await importProjectFiles(store(), files);
    if (!imported.length && !failed.length) return;
    if (imported.length) requestPersistentStorage(deps.store);
    const message = importSummary(imported, failed);
    // A single project file opens; a backup with one project is listed like any other import.
    if (files.length === 1 && !archives && imported.length === 1) { deps.open(imported[0].id); toast(message); return; }
    highlightInList(...imported.map(r => r.id));
    render();
    toast(message);
  }

  function startExample(): void {
    let record: ProjectRecord;
    try { record = createProject(store(), { config: defaultConfig(), name: 'Example tray' }); } catch (error) { toast(messageOf(error)); return; }
    deps.open(record.id);
  }

  function exportAll(): void {
    deps.session()?.flush();
    const projects = listProjects(store()).projects;
    if (!projects.length) return;
    downloadFile(projectsArchiveName(), projectsArchive(projects).buffer as ArrayBuffer, 'application/zip');
  }

  function downloadRawData(): void {
    const data: Record<string, string | null> = {};
    for (const problem of listProjects(store()).problems) data[problem.key] = store().getItem(problem.key);
    for (const key of legacyKeys()) data[key] = store().getItem(key);
    downloadFile(RAW_DATA_FILE, `${JSON.stringify(data, null, 2)}\n`, 'application/json');
  }

  function restore(id: string): void {
    try { restoreProject(store(), id); } catch (error) { toast(messageOf(error)); return; }
    highlightInList(id);
    focusAfter = openSelector(id);
    render();
  }

  async function deleteForever(id: string): Promise<void> {
    const record = list.deleted.find(r => r.id === id);
    if (!record) return;
    const confirmed = await confirmAction({ title: `Delete ${quoted(record.name)} forever?`, body: "This can't be undone.", confirmLabel: 'Delete forever', danger: true });
    if (!confirmed) return;
    const rows = list.deleted.map(r => r.id);
    const at = rows.indexOf(id);
    try { deleteProjectForever(store(), id); } catch (error) { toast(messageOf(error)); return; }
    const next = rows[at + 1] ?? rows[at - 1];
    // Next row; else the footer button next to where the section was; else the heading.
    focusAfter = next ? `[data-projects-action="restore"][data-id="${next}"]`
      : list.projects.length ? '[data-projects-action="export-all"]' : '#projects-title';
    render();
  }

  function runAction(action: string, id: string | undefined): void {
    switch (action) {
      case 'import': fileInput.click(); break;
      case 'example': startExample(); break;
      case 'export-all': exportAll(); break;
      case 'raw-data': downloadRawData(); break;
      case 'restore': if (id) restore(id); break;
      case 'forever': if (id) void deleteForever(id); break;
    }
  }

  /* ── Events ── */

  root.addEventListener('click', event => {
    const target = (event.target as Element).closest<HTMLElement>('[data-new], [data-open], [data-card-menu], [data-projects-action]');
    if (!target || !content.contains(target)) return;
    if (target.dataset.new) deps.newProject(target.dataset.new as TemplateId);
    else if (target.dataset.open) deps.open(target.dataset.open);
    else if (target.dataset.cardMenu) openCardMenu(target, target.dataset.cardMenu);
    else if (target.dataset.projectsAction) runAction(target.dataset.projectsAction, target.dataset.id);
  });

  root.addEventListener('input', event => {
    const input = event.target as HTMLInputElement;
    if (input.id === 'project-search') { query = input.value; renderGrid(); }
    else if (input.id === 'card-rename-input' && rename) { rename.value = input.value; }
  });

  root.addEventListener('keydown', event => {
    const input = event.target as HTMLElement;
    if (input.id === 'card-rename-input') {
      if (event.key === 'Enter') { event.preventDefault(); commitRename(false); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (rename) stopRename(rename.id); }
      return;
    }
    if (input.id === 'project-search' && event.key === 'Escape' && query) {
      event.preventDefault(); (input as HTMLInputElement).value = ''; query = ''; renderGrid(); return;
    }
    // Ctrl/Cmd+Z runs the toast's Undo (outside text fields, which keep native undo).
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && shortcutLetter(event) === 'z' && !isTextEntry(event.target)) {
      if (runToastAction()) { event.preventDefault(); event.stopPropagation(); }
    }
  });

  // Deferred so the newly focused element is known (and kept) when the list re-renders.
  root.addEventListener('focusout', event => {
    if ((event.target as HTMLElement).id !== 'card-rename-input') return;
    setTimeout(() => { if (document.activeElement?.id !== 'card-rename-input') commitRename(true); });
  });

  // <details> toggle does not bubble.
  root.addEventListener('toggle', event => {
    const details = event.target as HTMLElement;
    if (details instanceof HTMLDetailsElement && details.classList.contains('recently-deleted')) deletedOpen = details.open;
  }, true);

  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    fileInput.value = '';
    if (files.length) void importFiles(files);
  });

  // Other windows: re-render on any project change while the page is visible. Relative times refresh on return.
  window.addEventListener('storage', event => {
    if ((event.key === null || event.key.startsWith(PROJECT_KEY_PREFIX)) && visible()) render();
  });
  // Reload, tab close or a hidden tab (which may be discarded): unload fires no blur, so commit an open rename.
  const commitOpenRename = (): void => { if (rename) commitRename(false); };
  window.addEventListener('pagehide', commitOpenRename);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) commitOpenRename();
    else if (visible() && !rename) render();
  });

  return { render };
}
