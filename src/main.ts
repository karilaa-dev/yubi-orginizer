import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { KEY_CATALOG, MAX_SLOTS, STORAGE_KEY, DISPLAY_KEY, TEMPLATES, SOCKET_PROFILES, isTestTemplate, createSlot, defaultConfig, moveSlot, parseConfig, serializeConfig, validateConfig } from './config';
import { MATCHING_MODELS, searchKeys } from './catalog';
import { ACTIVE_PROJECT_KEY, readDraft, writeDraft, readProjects, saveProject, type LocalProject } from './projects';
import { icon, keyIcon } from './icons';
import { buildProject, inventoryTrayLayout, trayFootprintError } from './geometry';
import { TRAY_SNAP } from './geometry/tray-snap';
import { keyLabelMillimeters, keyLabelPercent, readLegacyLidSize } from './text-size';
import { OrganizerPreview } from './preview';
import { renderScad } from './runtime';
import { downloadFile, downloadParts, downloadProject, TRAY_SNAP_INSTRUCTIONS, trayConnectionInstructions, type DownloadReadyDetail } from './export';
import { build3mf } from './three-mf';
import { estimateFilament } from './filament';
import { fitOffsets, formatFitOffset } from './fit-options';
import type { HolderConfig, KeyType, ProjectGeometry, TemplateId } from './types';

const $ = <T extends Element = HTMLElement>(s: string): T => document.querySelector<T>(s)!;
const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const blankConfig = (): HolderConfig => ({ ...defaultConfig(), slots: [] });
let config = blankConfig(), loadError = '', hasDraft = false;
let activeProject: LocalProject | undefined;
let showKeys = true, exploded = true, editor = false;
let theme: 'light' | 'dark' = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
let quality: 'high' | 'low' = 'high';
try {
  const draft = readDraft(localStorage);
  const raw = draft ? undefined : localStorage.getItem(STORAGE_KEY);
  if (draft) { config = draft.config; hasDraft = true; }
  else if (raw) { config = parseConfig(raw); hasDraft = true; }
  const prefs = JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}');
  showKeys = prefs.showKeys !== false;
  if (prefs.theme === 'light' || prefs.theme === 'dark') theme = prefs.theme;
  if (prefs.quality === 'low') quality = 'low';
  editor = prefs.editor === true && hasDraft;
  const projects = readProjects(localStorage);
  if (draft?.projectId) activeProject = projects.find(p => p.id === draft.projectId);
  else if (!draft && raw) {
    // Legacy draft/owner writes were separate. Only restore ownership when the
    // saved configuration also matches, to avoid overwriting another project.
    activeProject = projects.find(p => p.id === localStorage.getItem(ACTIVE_PROJECT_KEY) && serializeConfig(p.config) === serializeConfig(config));
  }
} catch (error) { loadError = (error as Error).message || 'Your saved draft could not be loaded.'; }
let panel: 'keys' | 'customize' = 'keys';
let revision = 0, readyRevision = -1;
let controller: AbortController | undefined;
let debounce: ReturnType<typeof setTimeout> | undefined;
let currentProject: ProjectGeometry | undefined;
let meshes = new Map<string, ArrayBuffer>();
let deferredInstall: (Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }) | undefined;
let dragging: string | undefined, toastTimer: ReturnType<typeof setTimeout>;
const lidMetricCache = new Map<string, NonNullable<ReturnType<typeof readLegacyLidSize>>>();
const meshCache = new Map<string, ArrayBuffer>(), inputErrors = new Map<string, string>();
const templateName = () => TEMPLATES.find(t => t.id === config.template)!.name;
const typeCards = (mode: 'new' | 'switch', tests = false) => TEMPLATES.filter(t => isTestTemplate(t.id) === tests).map((t, i) => `<button class="type-card type-${i}" data-template="${t.id}" data-mode="${mode}"><span class="type-visual">${icon(t.icon)}</span><span class="type-name">${t.name}${icon('chevron')}</span><span class="type-description">${t.description}</span></button>`).join('');
const dialogHeading = (title: string) => `<div class="dialog-heading"><h2>${title}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div>`;
const trayLockInstructions = TRAY_SNAP_INSTRUCTIONS;

document.documentElement.dataset.theme = theme;
$('#app').innerHTML = `
<header class="app-header"><div class="header-inner"><button class="brand" data-action="home" aria-label="Keyform home"><img src="${import.meta.env.BASE_URL}icon.svg" width="30" height="30" alt=""/>keyform<span>.</span></button><div class="header-actions"><span id="offline-state">${icon('shield')}<span>Local workspace</span></span><button class="button quiet" data-action="projects">${icon('folder')}<span>Projects</span></button><button class="button quiet" id="install" hidden>${icon('download')}Install</button><button class="icon-button" id="theme-toggle" aria-label="Switch theme">${icon('moon')}</button><button class="icon-button" data-action="help" aria-label="Fit and printing information">${icon('info')}</button></div></div></header>
<main class="page">
  <section id="start-page"><div class="start-heading"><span class="step-label">01 / ORGANIZER</span><h1>Choose an organizer.</h1><p>Next, add your keys and set the size.</p></div><div class="type-grid">${typeCards('new')}</div><div class="fit-chooser"><h2>Fit testing</h2><div class="type-grid test-grid">${typeCards('new', true)}</div></div><button id="resume-draft" class="button secondary resume" data-action="resume" hidden>${icon('back')}Continue last project</button></section>
  <section id="editor" hidden>
    <div class="editor-heading"><div><h1 id="project-title">Untitled organizer</h1></div><div class="project-actions"><button class="button secondary" data-action="save">${icon('file')}Save project</button><button class="button primary download-main" id="download" disabled>${icon('download')}Download</button></div></div>
    <div class="workspace"><aside class="controls-panel"><button class="organizer-select" data-action="change-type" aria-label="Change organizer type"><span id="organizer-icon" class="organizer-icon"></span><span id="template-label"></span>${icon('down')}</button><div class="panel-tabs" role="tablist" aria-label="Design controls"><button id="keys-tab" role="tab" aria-controls="control-content" data-panel="keys">Your keys <span id="key-count">0</span></button><button id="customize-tab" role="tab" aria-controls="control-content" data-panel="customize">${icon('settings')}Size & layout</button></div><div id="control-content" role="tabpanel"></div><div class="panel-footer"><span id="save-state">Draft on this device</span></div></aside>
    <div class="preview-column"><section class="preview-card" aria-label="3D organizer preview"><div class="preview-top"><span id="preview-title"></span><div class="preview-actions"><button class="button preview-toggle" id="show-keys" aria-pressed="true">${icon('eye')}Keys</button><button class="button preview-toggle" id="explode" aria-pressed="false" hidden>${icon('layers')}Explode</button><label class="quality-label"><span class="sr-only">Preview quality</span><select id="preview-quality" aria-label="Preview quality"><option value="high">High quality</option><option value="low">Low quality</option></select></label></div></div><div id="viewer"></div><div id="empty-preview" hidden>${icon('plus')}<h2>Add your first key</h2><button class="button primary" data-action="add">${icon('plus')}Add key</button></div><div class="view-tools" aria-label="Camera controls"><button class="icon-button" data-view="iso" title="Isometric view" aria-label="Isometric view">${icon('cube')}</button><button class="icon-button" data-view="top" title="Top view" aria-label="Top view">${icon('grid')}</button><button class="icon-button" data-view="front" title="Front view" aria-label="Front view">${icon('dock')}</button><span></span><button class="icon-button" data-action="camera-reset" title="Fit to view" aria-label="Fit to view">${icon('expand')}</button></div><div class="preview-bottom"><div class="preview-metrics"><span id="dimensions">No keys selected</span><button id="filament-estimate" class="estimate-button" data-action="filament-info" aria-label="Filament estimate details" hidden>${icon('filament')}<span id="filament-value"></span></button></div><span class="orbit-hint">Drag to orbit · Scroll to zoom</span></div></section><div class="preview-status"><div id="generation-status" role="status" aria-live="polite"></div></div><div id="render-error" class="render-error" role="alert" hidden></div></div></div>
  </section>
</main>
<dialog id="type-dialog" class="dialog wide-dialog">${dialogHeading('Change organizer')}<div class="type-grid">${typeCards('switch')}</div><div class="fit-chooser"><h3>Fit testing</h3><div class="type-grid test-grid">${typeCards('switch', true)}</div></div></dialog>
<dialog id="key-dialog" class="dialog">${dialogHeading('Add keys')}<label class="search-field">${icon('search')}<input type="search" id="key-search" placeholder="Search model or connector" aria-label="Search keys" autocomplete="off"/></label><div id="key-catalog" class="key-catalog"></div><div class="dialog-footer"><span id="added-message" role="status" aria-live="polite"></span><button class="button primary" data-action="close-dialog">Done</button></div></dialog>
<dialog id="projects-dialog" class="dialog">${dialogHeading('Your projects')}<div id="project-list"></div><div class="dialog-footer"><button class="button secondary" data-action="import">${icon('upload')}Import JSON</button><button class="button primary" data-action="new">${icon('plus')}New project</button></div><p class="storage-note">Saved in this browser. Clearing site data removes local projects.</p></dialog>
<dialog id="save-dialog" class="dialog small-dialog">${dialogHeading('Save project')}<form id="save-form"><label class="field" for="project-name">Project name<input id="project-name" name="name" required maxlength="80" autocomplete="off"/></label><p id="save-error" class="inline-error" role="alert" hidden></p><div class="dialog-footer"><span>Saved on this device</span><button class="button primary" type="submit">Save</button></div></form></dialog>
<dialog id="download-dialog" class="dialog">${dialogHeading('Download your organizer')}<div class="print-settings"><span>Recommended print settings</span><div><strong>5% <small>infill</small></strong><strong>Arachne <small>walls</small></strong><strong>100% <small>scale</small></strong></div></div><label class="field" for="download-part">Parts<select id="download-part"></select></label><fieldset class="format-options"><legend class="sr-only">File format</legend><label><input type="radio" name="format" value="3mf" checked/><span class="format-tag">3MF</span><span><strong>Print project</strong><small>5% infill + Arachne for Bambu Studio / OrcaSlicer</small></span></label><label><input type="radio" name="format" value="stl"/><span class="format-tag">STL</span><span><strong>3D model</strong><small>Set infill and walls in your slicer</small></span></label><label><input type="radio" name="format" value="scad"/><span class="format-tag">SCAD</span><span><strong>Editable source</strong><small>Open and customize in OpenSCAD</small></span></label></fieldset><p class="storage-note" id="tray-print-tip" hidden>Use PETG for flexible key-retention tabs. Keep the supplied print orientation and leave movement slots free of supports.</p><p class="storage-note" id="tray-lock-tip" hidden>${trayLockInstructions}</p><p class="storage-note" id="format-note">Open 3MF as a project to keep print settings. Choose your printer and filament in the slicer.</p><div class="dialog-footer"><button class="text-button" data-action="backup">Project JSON backup</button><button class="button primary" id="download-file">${icon('download')}Download file</button></div><div id="download-result" class="download-result" role="status" hidden></div></dialog>
<dialog id="help-dialog" class="dialog">${dialogHeading('Fit & printing')}<div class="help-content"><h3>Print at 100% scale</h3><p>Models use millimeters. Each part rests flat on the print bed. Preview keys and colors are not included.</p><h3>Check the fit</h3><p>Key sockets preserve the calibrated research. The inventory 5Ci pocket adds local clearance for its projecting side contacts; both connector ends now accept USB-C, so the key fits either way. Its floor depth stays unchanged. Check this revised fit with your key before printing a full tray.</p><p>Print the rail, lid, tray lock, or Gridfinity fit pieces before making a full organizer. New mechanical interfaces still need physical validation.</p><p>Choose Key fit tester or Mechanical fit tests in the organizer selector.</p><section id="tray-lock-help" hidden><h3>Tray connection</h3><p id="tray-lock-help-text">${trayLockInstructions}</p></section><h3>Local projects & offline use</h3><p>Edits autosave in this browser. Save a named project to keep multiple organizers. JSON backups are optional. Once “Available offline” appears, editing and downloads work without an internet connection.</p><h3>Preview quality</h3><p>Low quality disables shadows and reduces resolution to save graphics power. The printable model is unchanged.</p></div></dialog>
<dialog id="filament-dialog" class="dialog small-dialog">${dialogHeading('Estimated filament')}<div id="filament-detail" class="help-content"></div></dialog>
<div id="update-banner" class="update-banner" hidden><span>An app update is ready.</span><button class="button primary" id="update-app">Save & update</button><button class="icon-button" data-action="dismiss-update" aria-label="Dismiss update">${icon('close')}</button></div><div id="toast" class="toast" role="status" aria-live="polite" hidden></div><input id="project-file" type="file" accept=".json,application/json" hidden/>
`;

let preview: OrganizerPreview | undefined;
try { preview = new OrganizerPreview($('#viewer')); preview.setShowKeys(showKeys); preview.setTheme(theme); preview.setQuality(quality); }
catch (error) { $('#viewer').innerHTML = '<div class="viewer-unavailable">3D preview needs WebGL. You can still generate and download models.</div>'; console.error(error); }
$('#viewer').addEventListener('preview-warning', event => toast((event as CustomEvent<string>).detail));
const downloadResult = $('#download-result');
window.addEventListener('keyform:download-ready', event => {
  const { name, url, byteLength } = (event as CustomEvent<DownloadReadyDetail>).detail;
  downloadResult.hidden = false; downloadResult.replaceChildren();
  const message = document.createElement('span'); message.textContent = `File ready · ${byteLength > 1048576 ? `${(byteLength / 1048576).toFixed(1)} MB` : `${Math.ceil(byteLength / 1024)} KB`}`;
  const link = document.createElement('a'); link.href = url; link.download = name; link.textContent = `Save ${name}`;
  downloadResult.append(message, link);
});
function toast(message: string): void { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 6000); }
function preferences(): void { try { localStorage.setItem(DISPLAY_KEY, JSON.stringify({ showKeys, theme, quality, editor })); } catch { /* Rendering is independent of storage. */ } }
function applyDisplay(): void { document.documentElement.dataset.theme = theme; $('#theme-toggle').innerHTML = icon(theme === 'dark' ? 'sun' : 'moon'); $('#theme-toggle').setAttribute('aria-label', theme === 'dark' ? 'Use light theme' : 'Use dark theme'); $<HTMLSelectElement>('#preview-quality').value = quality; preview?.setTheme(theme); preview?.setQuality(quality); }
function saveDraft(): boolean {
  try {
    writeDraft(localStorage, config, activeProject?.id); hasDraft = true;
    if (activeProject) activeProject = saveProject(localStorage, config, activeProject.name, activeProject.id);
    $('#save-state').innerHTML = `${icon('check')}${activeProject ? 'Project saved locally' : 'Draft saved locally'}`;
    return true;
  } catch (error) { $('#save-state').textContent = 'Could not save locally'; toast((error as Error).message); return false; }
}
function setActive(project?: LocalProject): void { activeProject = project; }
function showPage(editing: boolean): void { editor = editing; $('#start-page').hidden = editing; $('#editor').hidden = !editing; $('#resume-draft').hidden = !hasDraft; preferences(); }
function changed(next: HolderConfig, rerender = true): void { config = validateConfig(next); saveDraft(); if (rerender) renderControls(); else { updateTestReadouts(); updateTrayLockReadouts(); updateTraySizeReadout(); } invalidate(); }
function enterProject(next: HolderConfig, project?: LocalProject): void { setActive(project); config = validateConfig(next); panel = 'keys'; exploded = true; preview?.setExploded(true); showPage(true); saveDraft(); renderControls(); invalidate(); }
function sizeField(id: string, label: string, value: number, min: number, max: number, step = 0.5, disabled = false, unit = 'mm'): string {
  return `<div class="field size-field"><label for="${id}">${label}<span class="number-wrap"><input id="${id}" type="number" data-option="${id}" min="${min}" max="${max}" step="${unit === '%' ? 'any' : step}" value="${value}" inputmode="decimal" ${disabled ? 'disabled' : ''}/><span>${unit}</span></span></label><input aria-label="${label} slider" type="range" data-option="${id}" min="${min}" max="${max}" step="${step}" value="${value}" ${disabled ? 'disabled' : ''}/></div>`;
}
function columns(id: string, value: number): string { return `<div class="field"><label for="${id}">Columns</label><select id="${id}" data-option="${id}" data-numeric>${[0, 1, 2, 3, 4, 5, 6].map(n => `<option value="${n}" ${n === value ? 'selected' : ''}>${n === 0 ? 'Automatic (up to 6)' : n}</option>`).join('')}</select></div>`; }
function textField(id: string, label: string, value: string, disabled = false): string { return `<div class="field"><label for="${id}">${label}</label><input id="${id}" data-option="${id}" type="text" maxlength="32" value="${esc(value)}" placeholder="None" ${disabled ? 'disabled' : ''}/></div>`; }
function toggle(id: string, label: string, checked: boolean, disabled = false): string { return `<label class="toggle-row" for="${id}"><span>${label}</span><input id="${id}" type="checkbox" data-option="${id}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}/><span class="switch" aria-hidden="true"></span></label>`; }
function trayConnectionControl(): string {
  return `<fieldset class="connection-field"><legend>Tray connection</legend><div class="connection-options">${([['none', 'None'], ['snap_fit', 'Enclosure snap-fit']] as const).map(([value, name]) => `<label><input type="radio" name="tray-connection" data-option="tray.connection" value="${value}" ${config.options.tray.connection === value ? 'checked' : ''}/><span>${name}</span></label>`).join('')}</div><p class="field-hint" id="tray-lock-hint"></p></fieldset>`;
}
function labelControls(): string { return toggle('labels', 'Print key labels', config.labels) + sizeField('labelSize', 'Key label size', keyLabelPercent(config.labelSize), 37.5, 100, 2.5, false, '%') + '<p class="field-hint">Long labels shrink to fit.</p>'; }

function trayDimensionField(axis: 'width' | 'depth', value: number, max: number): string {
  return `<div class="field"><label for="tray.${axis}">Tray ${axis}</label><span class="number-wrap"><input id="tray.${axis}" type="number" data-option="tray.${axis}" min="20" max="${max}" step="0.01" value="${value}" inputmode="decimal"/><span>mm</span></span></div>`;
}
function traySizeControl(): string {
  const t = inventoryTrayLayout(config), locked = config.options.tray.footprint;
  return `<section class="tray-size-controls">${toggle('tray.sizeLocked', 'Lock tray dimensions', !!locked)}<p class="field-hint">${locked ? 'Keeps this footprint when keys change. Use the same width, depth and connection for each layer.' : 'Lock the current width and depth to make matching layers.'}</p><div id="tray-dimensions" ${locked ? '' : 'hidden'}>${trayDimensionField('width', t.width || 80, 1000)}${trayDimensionField('depth', t.depth || 80, 6000)}</div><p class="field-hint" id="tray-size-hint"></p></section>`;
}
function updateTraySizeReadout(): void {
  const hint = document.getElementById('tray-size-hint');
  if (!hint || config.template !== 'inventory_tray') return;
  const t = inventoryTrayLayout(config), error = trayFootprintError(config);
  hint.textContent = error ?? (config.options.tray.footprint ? `Required by this layout: ${t.requiredWidth} × ${t.requiredDepth} mm` : `Current footprint: ${t.width} × ${t.depth} mm`);
  hint.classList.toggle('dimension-error', !!error);
}
function projectSummary(project: HolderConfig): string {
  if (project.template === 'key_fit_tester') return `${SOCKET_PROFILES.find(p => p.id === project.options.tester.profile)!.name} · ${project.options.tester.samples} samples`;
  if (project.template === 'interface_tests') return project.options.interfaceTests.kind === 'all' ? 'All mechanical tests' : `${{ grid: 'Gridfinity', lid: 'Lid', rail: 'Rail', tray_snap: 'Enclosure snap-fit' }[project.options.interfaceTests.kind]} fit test`;
  return `${project.slots.length} keys`;
}
function renderTestControls(): void {
  if (config.template === 'key_fit_tester') {
    const t = config.options.tester;
    $('#control-content').innerHTML = `<div class="customize-content test-controls"><h3>USB socket</h3><div class="socket-profiles" role="group" aria-label="USB socket profile">${SOCKET_PROFILES.map(p => `<button class="socket-profile" data-socket-profile="${p.id}" aria-pressed="${p.id === t.profile}">${keyIcon(p.id)}<span>${p.name}</span></button>`).join('')}</div><p id="tester-models" class="field-hint">${SOCKET_PROFILES.find(p => p.id === t.profile)!.models}</p><div class="field"><label for="tester.samples">Samples</label><select id="tester.samples" data-option="tester.samples" data-numeric>${[3, 5].map(n => `<option value="${n}" ${t.samples === n ? 'selected' : ''}>${n} sockets</option>`).join('')}</select></div>${sizeField('tester.startOffset', 'First offset', t.startOffset, -0.3, 0.3, 0.05)}<div class="field"><label for="tester.step">Offset step</label><select id="tester.step" data-option="tester.step" data-numeric>${[...new Set([0.05, 0.1, 0.15, 0.2, t.step])].sort((a, b) => a - b).map(n => `<option value="${n}" ${Math.abs(t.step - n) < 1e-6 ? 'selected' : ''}>${Number(n.toFixed(4))} mm</option>`).join('')}</select></div><div id="sample-offsets" class="sample-offsets" aria-label="Socket offsets"></div><p class="field-hint tester-hint">0 = calibrated · − tighter · + looser<br/>Offsets are per side and apply only to this tester.</p></div>`;
  } else {
    const kind = config.options.interfaceTests.kind;
    $('#control-content').innerHTML = `<div class="customize-content test-controls"><h3>Mechanical interface</h3><div class="field"><label for="interfaceTests.kind">Test pieces</label><select id="interfaceTests.kind" data-option="interfaceTests.kind">${([['all', 'All interfaces'], ['rail', 'Rail & cartridge'], ['lid', 'Case & lid'], ['grid', 'Gridfinity foot'], ['tray_snap', 'Enclosure snap-fit']] as const).map(([value, label]) => `<option value="${value}" ${value === kind ? 'selected' : ''}>${label}</option>`).join('')}</select></div><p id="interface-description" class="field-hint"></p></div>`;
  }
  updateTestReadouts();
}
function updateTestReadouts(): void {
  if (config.template === 'key_fit_tester' && document.getElementById('sample-offsets')) {
    const t = config.options.tester;
    $('#sample-offsets').innerHTML = fitOffsets(t).map(value => {
      return `<span class="${value === 0 ? 'baseline' : ''}">${formatFitOffset(value)}<small>mm</small></span>`;
    }).join('');
  }
  if (config.template === 'interface_tests' && document.getElementById('interface-description')) $('#interface-description').textContent = {
    all: 'Print small samples to check the rail, lift-off lid, enclosure snap-fit, and Gridfinity baseplate fit.',
    rail: 'Slide the cartridge into the open rail end to check running clearance.',
    lid: 'Check how the lid corner seats over the case rim.',
    grid: 'Check the 1 × 1 foot in your Gridfinity baseplate.',
    tray_snap: 'Press the shells together until the rim hooks click. Lift gently at an edge to release. Test the fit before printing a full tray.',
  }[config.options.interfaceTests.kind];
}
function trayMinimumMargin(project: HolderConfig): number {
  return project.template === 'inventory_tray' && project.options.tray.connection === 'snap_fit' ? TRAY_SNAP.margin : 5;
}
function trayMinimumHeight(project: HolderConfig): number {
  if (project.template === 'inventory_tray' && project.options.tray.connection === 'snap_fit') return TRAY_SNAP.minimumHeight;
  return 8.6;
}
function trayConnectionName(project: HolderConfig): string { return project.options.tray.connection === 'snap_fit' ? 'Enclosure snap-fit' : 'Tray'; }
function updateTrayLockReadouts(): void {
  const minimumHeight = trayMinimumHeight(config);
  document.querySelectorAll<HTMLInputElement>('[data-option="tray.height"]').forEach(input => {
    input.min = String(minimumHeight);
    if (input !== document.activeElement && !inputErrors.has('tray.height')) input.value = String(Math.max(config.options.tray.height, minimumHeight));
  });
  const heightHint = document.getElementById('tray-height-hint');
  if (heightHint) {
    heightHint.hidden = config.options.tray.height >= minimumHeight;
    heightHint.textContent = `${trayConnectionName(config)} requires at least ${minimumHeight} mm tray height to support the mechanism.`;
  }
  const hint = document.getElementById('tray-lock-hint');
  if (hint) hint.textContent = {
    none: 'No tray-to-tray connection.',
    snap_fit: 'Four solid rim catches engage the matching skirt. Press together to close; lift one edge at the notch to open. Print the PLA fit sample first.',
  }[config.options.tray.connection];
  const instructions = trayConnectionInstructions(config);
  $('#tray-lock-help').hidden = !instructions.length; $('#tray-lock-tip').hidden = !instructions.length;
  $('#tray-lock-help-text').textContent = instructions.join(' ');
  $('#tray-lock-tip').textContent = instructions.join(' ');
}
function renderFilament(generated: Map<string, ArrayBuffer>): void {
  const estimate = estimateFilament(generated.values());
  $('#filament-value').textContent = `≈ ${estimate.grams.toFixed(1)} g PLA`;
  $('#filament-estimate').title = 'Approximate filament use · 5% infill';
  $('#filament-estimate').hidden = false;
  $('#filament-detail').innerHTML = `<p class="estimate-total">≈ ${estimate.grams.toFixed(1)} g <span>· ${estimate.meters.toFixed(2)} m</span></p><p>All printable parts · PLA · 1.75 mm filament</p><p>5% infill, two 0.42 mm walls, 0.2 mm layers, and four top/bottom layers.</p><p>Estimated from the model surface and volume. Supports, brim, and purge are excluded. Check your slicer for the final amount.</p>`;
}
function renderControls(): void {
  inputErrors.clear(); $('#key-count').textContent = String(config.slots.length);
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach(el => { const active = el.dataset.panel === panel; el.setAttribute('aria-selected', String(active)); el.tabIndex = active ? 0 : -1; });
  $('#control-content').setAttribute('aria-labelledby', `${panel}-tab`);
  $('#template-label').textContent = templateName(); $('#organizer-icon').innerHTML = icon(TEMPLATES.find(t => t.id === config.template)!.icon); $('#project-title').textContent = activeProject?.name ?? (isTestTemplate(config.template) ? 'Untitled fit test' : 'Untitled organizer');
  $('#preview-title').textContent = templateName();
  $('.panel-tabs').hidden = isTestTemplate(config.template); $('#show-keys').hidden = isTestTemplate(config.template);
  $('#control-content').setAttribute('role', isTestTemplate(config.template) ? 'region' : 'tabpanel');
  if (isTestTemplate(config.template)) { $('#control-content').removeAttribute('aria-labelledby'); $('#control-content').setAttribute('aria-label', 'Fit test settings'); } else $('#control-content').removeAttribute('aria-label');
  $('#show-keys').setAttribute('aria-pressed', String(showKeys)); $('#explode').setAttribute('aria-pressed', String(exploded));
  if (isTestTemplate(config.template)) { renderTestControls(); updateTrayLockReadouts(); return; }
  if (panel === 'keys') {
    $('#control-content').innerHTML = `${config.slots.length ? '<div class="key-label-control">' + labelControls() + '</div>' : ''}<div class="key-list" aria-label="Selected keys">${config.slots.map((slot, i) => `<div class="key-row ${!slot.occupied ? 'key-hidden' : ''}" draggable="true" data-slot="${slot.id}"><span class="drag-handle" aria-hidden="true">${icon('grip')}</span>${keyIcon(slot.type)}<div class="key-row-main"><span class="key-model-name">${KEY_CATALOG[slot.type].name}${!slot.occupied ? ' · Hidden' : ''}</span><label class="key-label-caption" for="label-${slot.id}">Printed label</label><input id="label-${slot.id}" class="key-label" data-label="${slot.id}" value="${esc(slot.label)}" maxlength="18" placeholder="None" aria-label="Printed label for key ${i + 1}, ${KEY_CATALOG[slot.type].name}"/></div><div class="row-actions"><button class="icon-button mini" data-move="${i},${i - 1}" ${i === 0 ? 'disabled' : ''} aria-label="Move key ${i + 1} up">${icon('up')}</button><button class="icon-button mini" data-move="${i},${i + 1}" ${i === config.slots.length - 1 ? 'disabled' : ''} aria-label="Move key ${i + 1} down">${icon('down')}</button><button class="icon-button mini" data-occupied="${slot.id}" aria-label="${slot.occupied ? 'Hide' : 'Show'} key ${i + 1}" title="${slot.occupied ? 'Hide key, keep pocket' : 'Show reference key'}">${icon(slot.occupied ? 'eye' : 'eyeOff')}</button><button class="icon-button mini delete-key" data-remove="${slot.id}" aria-label="Remove key ${i + 1}">${icon('close')}</button></div></div>`).join('') || '<div class="empty-keys">No keys yet</div>'}</div><div class="add-key-wrap"><button class="button add-key-button" data-action="add" ${config.slots.length >= MAX_SLOTS ? 'disabled' : ''}>${icon('plus')}Add key</button></div>`;
  } else {
    const o = config.options; let controls = '';
    if (config.template === 'desktop_dock') controls = columns('dock.columns', o.dock.columns) + sizeField('dock.spacing', 'Column spacing', o.dock.spacing, 22, 40) + sizeField('dock.rowSpacing', 'Row spacing', o.dock.rowSpacing, 18, 70) + sizeField('dock.edgeMargin', 'Side margin', o.dock.edgeMargin, 12, 40) + sizeField('dock.depthMargin', 'Front & back margin', o.dock.depthMargin, 18, 45) + sizeField('dock.height', 'Base height', o.dock.height, 11, 25) + textField('dock.title', 'Front title', o.dock.title);
    if (config.template === 'modular_rail') controls = sizeField('rail.endMargin', 'Rail end margin', o.rail.endMargin, 5, 30) + toggle('rail.mountingHoles', 'Mounting holes', o.rail.mountingHoles);
    if (config.template === 'inventory_tray' || config.template === 'travel_case') {
      const minHeight = trayMinimumHeight(config);
      controls = columns('tray.columns', o.tray.columns) + sizeField('tray.spacing', 'Column spacing', o.tray.spacing, 24, 42) + (config.template === 'inventory_tray' ? sizeField('tray.rowGap', 'Space between rows', o.tray.rowGap, 2, 40) : sizeField('tray.rowSpacing', 'Row spacing', o.tray.rowSpacing, 66, 110)) + sizeField('tray.margin', 'Outer margin', Math.max(o.tray.margin, trayMinimumMargin(config)), trayMinimumMargin(config), 20) + sizeField('tray.height', config.template === 'travel_case' ? 'Insert height' : 'Tray height', Math.max(o.tray.height, minHeight), minHeight, 20, 0.1) + '<p class="field-hint" id="tray-height-hint" hidden></p>' + `<div class="field"><label for="tray.scoop">Finger access</label><select id="tray.scoop" data-option="tray.scoop">${['small', 'default', 'large'].map(s => `<option value="${s}" ${s === o.tray.scoop ? 'selected' : ''}>${s === 'default' ? 'Standard' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></div>`;
    }
    if (config.template === 'inventory_tray') controls = traySizeControl() + toggle('tray.retention', 'Key retention', o.tray.retention) + '<p class="field-hint">Small tabs help hold keys in their pockets.</p>' + trayConnectionControl() + toggle('tray.lid', 'Lid', o.tray.lid) + textField('tray.lidText', 'Lid text', o.tray.lidText, !o.tray.lid) + lidTextSizeControl() + textField('tray.sideText', 'Side text', o.tray.sideText) + controls;
    if (config.template === 'travel_case') controls += sizeField('case.headroom', 'Extra lid headroom', o.case.headroom, 0, 15) + textField('case.title', 'Lid text', o.case.title);
    if (config.template === 'grid_organizer') controls = `<div class="field"><label for="grid.mode">Storage style</label><select id="grid.mode" data-option="grid.mode">${['mixed', 'upright', 'flat'].map(s => `<option value="${s}" ${s === o.grid.mode ? 'selected' : ''}>${s === 'mixed' ? 'Mixed' : s === 'upright' ? 'All upright' : 'All flat'}</option>`).join('')}</select></div>` + sizeField('grid.extraHeight', 'Extra tile height', o.grid.extraHeight, 0, 15) + '<p class="field-hint">2 × 2 tiles. More keys add tiles.</p>';
    $('#control-content').innerHTML = `<div class="customize-content">${controls}${labelControls()}</div>`;
  }
  updateTrayLockReadouts(); updateTraySizeReadout();
}
function renderCatalog(): void {
  const matches = searchKeys($<HTMLInputElement>('#key-search').value);
  $('#key-catalog').innerHTML = matches.map(type => `<button class="catalog-key" data-add-type="${type}" ${config.slots.length >= MAX_SLOTS ? 'disabled' : ''}>${keyIcon(type)}<span><strong>${KEY_CATALOG[type].name} <span class="matching-models">/ ${MATCHING_MODELS[type].join(' / ')}</span></strong><small>${KEY_CATALOG[type].connector}</small></span><span class="catalog-plus">${icon('plus')}</span></button>`).join('') || '<p class="empty-keys">No matching keys</p>';
}
function disableExports(): void { $<HTMLButtonElement>('#download').disabled = true; $<HTMLButtonElement>('#download-file').disabled = true; downloadResult.hidden = true; }
function invalidate(): void {
  revision++; readyRevision = -1; controller?.abort(); clearTimeout(debounce); disableExports(); $('#render-error').hidden = true; $('#filament-estimate').hidden = true;
  if (inputErrors.size) { $('#generation-status').hidden = true; $('#render-error').hidden = false; $('#render-error').textContent = [...inputErrors.values()][0]; return; }
  const footprintError = trayFootprintError(config);
  if (footprintError) { $('#generation-status').hidden = true; $('#render-error').hidden = false; $('#render-error').textContent = footprintError; return; }
  if (!config.slots.length && !isTestTemplate(config.template)) { $('#generation-status').hidden = true; $('#empty-preview').hidden = false; $('#viewer').style.visibility = 'hidden'; $('#dimensions').textContent = 'No keys selected'; $('#explode').hidden = true; currentProject = undefined; return; }
  $('#empty-preview').hidden = true; $('#viewer').style.visibility = 'visible'; status('Updating model…'); debounce = setTimeout(() => void generate(), 450);
}
function status(text: string, done = false): void { $('#generation-status').hidden = false; $('#generation-status').classList.toggle('complete', done); $('#generation-status').innerHTML = `${done ? icon('check') : '<span class="spinner"></span>'}<span>${esc(text)}</span>${done ? '' : '<button class="text-button" data-action="cancel">Cancel</button>'}`; }
async function generate(): Promise<void> {
  const jobRevision = revision; controller?.abort(); const abort = new AbortController(); controller = abort;
  const generated = new Map<string, ArrayBuffer>();
  let legacyLid: ReturnType<typeof readLegacyLidSize>;
  try {
    const project = buildProject(config);
    if (!project.parts.length) throw new Error('Add a key to create your organizer.');
    for (let i = 0; i < project.parts.length; i++) {
      const part = project.parts[i]; status(`Generating ${project.parts.length > 1 ? `${i + 1}/${project.parts.length} · ` : ''}${part.name.toLowerCase()}…`);
      let bytes = meshCache.get(part.scad);
      if (part.id === 'tray-lid') legacyLid = lidMetricCache.get(part.scad);
      if (!bytes) { bytes = await renderScad(part.scad, { jobId: `${jobRevision}-${i}`, revision: jobRevision, partId: part.id, signal: abort.signal, onLog: line => { if (part.id === 'tray-lid') legacyLid = readLegacyLidSize(line) ?? legacyLid; } }); if (abort.signal.aborted || revision !== jobRevision) return; if (meshCache.size >= 30) { const oldest = meshCache.keys().next().value!; meshCache.delete(oldest); lidMetricCache.delete(oldest); } meshCache.set(part.scad, bytes); if (part.id === 'tray-lid' && legacyLid) lidMetricCache.set(part.scad, legacyLid); }
      generated.set(part.id, bytes);
    }
    if (abort.signal.aborted || revision !== jobRevision) return;
    if (config.template === 'inventory_tray' && config.options.tray.lid && config.options.tray.lidTextPercent === undefined) {
      const migration = legacyLid ?? (!config.options.tray.lidText.trim() ? { percent: 100, rotation: 0 as const } : undefined);
      if (migration) {
        const next = structuredClone(config);
        next.options.tray.lidTextPercent = migration.percent;
        next.options.tray.lidTextRotation = migration.rotation;
        changed(next); return;
      }
    }
    try { await preview?.setProject(project, generated, abort.signal); }
    catch (error) { if (abort.signal.aborted || revision !== jobRevision) return; console.error(error); toast('Model ready. Some reference keys could not be displayed.'); }
    if (abort.signal.aborted || revision !== jobRevision) return;
    currentProject = project; meshes = generated; preview?.setShowKeys(showKeys); preview?.setExploded(exploded); readyRevision = jobRevision;
    $('#dimensions').innerHTML = `${project.dimensions.map(n => n.toFixed(1).replace(/\.0$/, '')).join(' <i>×</i> ')} <small>mm</small>`;
    renderFilament(generated);
    $('#download-part').innerHTML = `${project.parts.length > 1 ? `<option value="">All ${project.parts.length} parts</option>` : ''}${project.parts.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}`;
    $<HTMLButtonElement>('#download').disabled = false; $<HTMLButtonElement>('#download-file').disabled = false; $('#explode').hidden = project.parts.length < 2;
    status('Ready', true);
  } catch (error) { if (abort.signal.aborted || revision !== jobRevision) return; $('#generation-status').hidden = true; $('#render-error').hidden = false; $('#render-error').innerHTML = `<span>${esc((error as Error).message || 'Model generation failed.')}</span><button class="text-button" data-action="retry">Try again</button>`; console.error(error); }
}
function openProjects(): void {
  try { const projects = readProjects(localStorage); $('#project-list').innerHTML = projects.map(p => `<button class="project-row" data-open-project="${esc(p.id)}">${icon(TEMPLATES.find(t => t.id === p.config.template)!.icon)}<span><strong>${esc(p.name)}</strong><small>${projectSummary(p.config)} · ${new Date(p.updatedAt).toLocaleDateString()}</small></span>${icon('chevron')}</button>`).join('') || '<p class="empty-keys">No saved projects yet</p>'; }
  catch (error) { $('#project-list').textContent = (error as Error).message; }
  $<HTMLDialogElement>('#projects-dialog').showModal();
}
function closeDialogs(): void { document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(d => d.close()); }
function switchPanel(next: typeof panel): void { if (isTestTemplate(config.template)) return; const invalid = inputErrors.size > 0; panel = next; renderControls(); $('#control-content').scrollTop = 0; if (invalid) invalidate(); }

document.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('button'); if (!target || target.hasAttribute('disabled')) return;
  if (target.dataset.template) {
    closeDialogs();
    if (target.dataset.mode === 'new') enterProject({ ...blankConfig(), template: target.dataset.template as TemplateId });
    else {
      if (target.dataset.template !== config.template) { exploded = true; preview?.setExploded(true); }
      changed({ ...config, template: target.dataset.template as TemplateId });
    }
    return;
  }
  if (target.dataset.socketProfile) { const next = structuredClone(config); next.options.tester.profile = target.dataset.socketProfile as typeof next.options.tester.profile; changed(next); $<HTMLButtonElement>(`[data-socket-profile="${next.options.tester.profile}"]`).focus(); return; }
  if (target.dataset.panel) { switchPanel(target.dataset.panel as typeof panel); return; }
  if (target.dataset.addType) { if (config.slots.length >= MAX_SLOTS) return; const type = target.dataset.addType as KeyType; changed({ ...config, slots: [...config.slots, createSlot(type)] }); $('#added-message').textContent = `${KEY_CATALOG[type].short} added · ${config.slots.length} ${config.slots.length === 1 ? 'key' : 'keys'}`; renderCatalog(); $<HTMLButtonElement>(`[data-add-type="${type}"]`).focus(); return; }
  if (target.dataset.remove) { changed({ ...config, slots: config.slots.filter(s => s.id !== target.dataset.remove) }); return; }
  if (target.dataset.move) { const [from, to] = target.dataset.move.split(',').map(Number); const slotId = config.slots[from].id; changed(moveSlot(config, from, to)); const row = $(`[data-slot="${slotId}"]`); const direction = to > from ? 'down' : 'up'; row.querySelector<HTMLButtonElement>(`[aria-label="Move key ${to + 1} ${direction}"]:not(:disabled)`)?.focus(); return; }
  if (target.dataset.occupied) { changed({ ...config, slots: config.slots.map(s => s.id === target.dataset.occupied ? { ...s, occupied: !s.occupied } : s) }); return; }
  if (target.dataset.view) { preview?.setView(target.dataset.view as 'iso' | 'top' | 'front'); return; }
  if (target.dataset.openProject) { try { const project = readProjects(localStorage).find(p => p.id === target.dataset.openProject); if (project) { closeDialogs(); enterProject(project.config, project); } } catch (error) { toast((error as Error).message); } return; }
  switch (target.dataset.action) {
    case 'rotate-lid-text': {
      const next = structuredClone(config);
      next.options.tray.lidTextRotation = (((next.options.tray.lidTextRotation ?? 0) + 90) % 360) as 0 | 90 | 180 | 270;
      changed(next); document.querySelector<HTMLButtonElement>('[data-action="rotate-lid-text"]')?.focus(); break;
    }
    case 'add': $<HTMLInputElement>('#key-search').value = ''; $('#added-message').textContent = ''; renderCatalog(); $<HTMLDialogElement>('#key-dialog').showModal(); $<HTMLInputElement>('#key-search').focus(); break;
    case 'close-dialog': target.closest('dialog')?.close(); break;
    case 'home': showPage(false); break;
    case 'new': closeDialogs(); showPage(false); break;
    case 'resume': showPage(true); renderControls(); invalidate(); break;
    case 'change-type': $<HTMLDialogElement>('#type-dialog').showModal(); break;
    case 'projects': openProjects(); break;
    case 'help': $<HTMLDialogElement>('#help-dialog').showModal(); break;
    case 'import': $<HTMLInputElement>('#project-file').click(); break;
    case 'save': $<HTMLInputElement>('#project-name').value = activeProject?.name ?? templateName(); $('#save-error').hidden = true; $<HTMLDialogElement>('#save-dialog').showModal(); $<HTMLInputElement>('#project-name').select(); break;
    case 'backup': downloadProject(config); break;
    case 'camera-reset': preview?.resetCamera(); break;
    case 'filament-info': $<HTMLDialogElement>('#filament-dialog').showModal(); break;
    case 'cancel': controller?.abort(); clearTimeout(debounce); $('#generation-status').hidden = true; $('#render-error').hidden = false; $('#render-error').innerHTML = '<span>Generation paused.</span><button class="text-button" data-action="retry">Generate model</button>'; break;
    case 'retry': invalidate(); break;
    case 'dismiss-update': $('#update-banner').hidden = true; break;
  }
});
$('#key-search').addEventListener('input', renderCatalog);
$('#save-form').addEventListener('submit', event => {
  event.preventDefault();
  try { const project = saveProject(localStorage, config, $<HTMLInputElement>('#project-name').value, activeProject?.id); setActive(project); saveDraft(); $('#project-title').textContent = project.name; $<HTMLDialogElement>('#save-dialog').close(); toast('Project saved on this device.'); }
  catch (error) { $('#save-error').hidden = false; $('#save-error').textContent = (error as Error).message; }
});
function lidTextSizeControl(): string {
  const t = config.options.tray;
  return sizeField('tray.lidTextPercent', 'Lid text size', Number((t.lidTextPercent ?? 100).toFixed(3)), .1, 100, .1, !t.lid || t.lidTextPercent === undefined, '%') + `<div class="text-rotation"><button class="button secondary" data-action="rotate-lid-text" ${!t.lid || t.lidTextPercent === undefined ? 'disabled' : ''}>${icon('rotate')}Rotate text 90°</button><output aria-label="Lid text rotation">${t.lidTextRotation ?? 0}°</output></div>`;
}
function updateOption(input: HTMLInputElement | HTMLSelectElement): void {
  const next = structuredClone(config), field = input.dataset.option!;
  if (field === 'labels') next.labels = (input as HTMLInputElement).checked;
  else if (field === 'labelSize') next.labelSize = input.value.trim() ? keyLabelMillimeters(Number(input.value)) : NaN;
  else if (field === 'tray.sizeLocked') {
    const t = inventoryTrayLayout(config);
    next.options.tray.footprint = (input as HTMLInputElement).checked ? { width: t.width || 80, depth: t.depth || 80 } : null;
  } else if (field === 'tray.width' || field === 'tray.depth') {
    if (!next.options.tray.footprint) return;
    next.options.tray.footprint[field === 'tray.width' ? 'width' : 'depth'] = input.value.trim() ? Number(input.value) : NaN;
  }
  else { const [section, name] = field.split('.'); const value = input.type === 'checkbox' ? (input as HTMLInputElement).checked : ['range', 'number'].includes(input.type) || input.hasAttribute('data-numeric') ? (input.value.trim() ? Number(input.value) : NaN) : input.value; (next.options[section as keyof typeof next.options] as unknown as Record<string, unknown>)[name] = value; }
  try {
    if (field === 'labelSize' && (!Number.isFinite(next.labelSize) || next.labelSize < 1.5 || next.labelSize > 4)) throw new Error('Key label size must be between 37.5% and 100%.');
    if (field === 'tray.height' && trayMinimumHeight(next) > 8.6 && next.options.tray.height < trayMinimumHeight(next)) throw new Error(`${trayConnectionName(next)} requires at least ${trayMinimumHeight(next)} mm tray height.`);
    validateConfig(next); inputErrors.delete(field); input.setCustomValidity('');
    if (field === 'tray.lid') {
      document.querySelectorAll<HTMLInputElement>('[data-option="tray.lidText"], [data-option="tray.lidTextPercent"]').forEach(control => {
        control.disabled = !next.options.tray.lid || (control.dataset.option === 'tray.lidTextPercent' && next.options.tray.lidTextPercent === undefined);
        if (!next.options.tray.lid) {
          // Disabled fields must not trap invalid, unsaved edits.
          inputErrors.delete(control.dataset.option!); control.setCustomValidity('');
          control.value = control.dataset.option === 'tray.lidText' ? next.options.tray.lidText : String(next.options.tray.lidTextPercent ?? 100);
        }
      });
      if (next.options.tray.lid && !config.options.tray.lid) {
        exploded = true; preview?.setExploded(true); $('#explode').setAttribute('aria-pressed', 'true');
      }
    }
    changed(next, field === 'tray.sizeLocked');
    updateTraySizeReadout();
    const rotate = document.querySelector<HTMLButtonElement>('[data-action="rotate-lid-text"]');
    if (rotate) rotate.disabled = !next.options.tray.lid || next.options.tray.lidTextPercent === undefined;
    document.querySelectorAll<HTMLInputElement>('[data-option]').forEach(other => { if (other !== input && other.dataset.option === field) { if (other.type === 'radio') other.checked = other.value === input.value; else other.value = input.value; other.setCustomValidity(''); } });
  }
  catch (error) { const message = (error as Error).message; inputErrors.set(field, message); input.setCustomValidity(message); invalidate(); }
}
document.addEventListener('input', event => {
  const input = event.target as HTMLInputElement;
  if (input.dataset.label) { const next = structuredClone(config); next.slots.find(s => s.id === input.dataset.label)!.label = input.value; try { validateConfig(next); inputErrors.delete(input.id); input.setCustomValidity(''); changed(next, false); } catch (error) { const message = (error as Error).message; inputErrors.set(input.id, message); input.setCustomValidity(message); invalidate(); } }
  if (input.dataset.option && ['range', 'number', 'text'].includes(input.type)) updateOption(input);
});
document.addEventListener('change', event => { const input = event.target as HTMLInputElement; if (input.dataset.option && !['range', 'number', 'text'].includes(input.type)) updateOption(input); });
document.addEventListener('dragstart', event => { const row = (event.target as Element).closest<HTMLElement>('[data-slot]'); if (!row || (event.target as Element).matches('input')) return; dragging = row.dataset.slot; event.dataTransfer?.setData('text/plain', dragging!); if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'; row.classList.add('dragging'); });
document.addEventListener('dragover', event => { if (dragging && (event.target as Element).closest('[data-slot]')) event.preventDefault(); });
document.addEventListener('drop', event => { const row = (event.target as Element).closest<HTMLElement>('[data-slot]'); if (dragging && row) { event.preventDefault(); changed(moveSlot(config, config.slots.findIndex(s => s.id === dragging), config.slots.findIndex(s => s.id === row.dataset.slot))); } dragging = undefined; });
document.addEventListener('dragend', () => { dragging = undefined; document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging')); });
document.querySelectorAll<HTMLDialogElement>('dialog').forEach(dialog => dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } }));
$('.panel-tabs').addEventListener('keydown', event => { const e = event as KeyboardEvent; if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return; e.preventDefault(); switchPanel(panel === 'keys' ? 'customize' : 'keys'); $(`#${panel}-tab`).focus(); });
$('#project-file').addEventListener('change', async event => { const input = event.target as HTMLInputElement, file = input.files?.[0]; if (!file) return; try { if (file.size > 256000) throw new Error('Choose an organizer project smaller than 256 KB.'); const next = parseConfig(await file.text()); closeDialogs(); enterProject(next); toast('Project imported. Save it to your local projects.'); } catch (error) { toast((error as Error).message); } finally { input.value = ''; } });
$('#show-keys').addEventListener('click', () => { showKeys = !showKeys; preview?.setShowKeys(showKeys); $('#show-keys').setAttribute('aria-pressed', String(showKeys)); preferences(); });
$('#explode').addEventListener('click', () => { exploded = !exploded; preview?.setExploded(exploded); $('#explode').setAttribute('aria-pressed', String(exploded)); });
$('#theme-toggle').addEventListener('click', () => { theme = theme === 'dark' ? 'light' : 'dark'; applyDisplay(); preferences(); });
$('#preview-quality').addEventListener('change', () => { quality = $<HTMLSelectElement>('#preview-quality').value as typeof quality; preview?.setQuality(quality); preferences(); });
$('#download').addEventListener('click', () => {
  if (readyRevision !== revision || !currentProject) return;
  const enclosure = (config.template === 'inventory_tray' && config.options.tray.connection === 'snap_fit') || currentProject.parts.some(p => p.id.startsWith('fit-tray-snap-'));
  const tip = $('#tray-print-tip');
  tip.hidden = !(enclosure || (config.template === 'inventory_tray' && config.options.tray.retention));
  tip.textContent = enclosure
    ? `Use PLA or PLA Matte for the enclosure snap-fit. Keep the supplied print orientation and perimeter channels clear.`
    : 'Use PETG for flexible key-retention tabs. Keep the supplied print orientation and leave movement slots free of supports.';
  downloadResult.hidden = true; $<HTMLDialogElement>('#download-dialog').showModal();
});
$('#download-file').addEventListener('click', () => {
  if (readyRevision !== revision || !currentProject) return;
  try { const partId = $<HTMLSelectElement>('#download-part').value || undefined; const format = $<HTMLInputElement>('input[name="format"]:checked').value;
    if (format === '3mf') { const bytes = build3mf(currentProject, meshes, { partId }); downloadFile(`${partId ?? config.template}.3mf`, bytes.buffer as ArrayBuffer, 'model/3mf'); }
    else downloadParts(format as 'stl' | 'scad', config, currentProject, meshes, partId);
  } catch (error) { downloadResult.hidden = false; downloadResult.textContent = (error as Error).message; }
});
document.querySelectorAll<HTMLInputElement>('input[name="format"]').forEach(input => input.addEventListener('change', () => { downloadResult.hidden = true; $('#format-note').textContent = input.value === '3mf' ? 'Open 3MF as a project to keep print settings. Choose your printer and filament in the slicer.' : 'Multiple parts download together as a ZIP. Preview keys are excluded.'; }));
$('#download-part').addEventListener('change', () => { downloadResult.hidden = true; });
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredInstall = event as typeof deferredInstall; $('#install').hidden = false; });
$('#install').addEventListener('click', async () => { if (deferredInstall) { await deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = undefined; $('#install').hidden = true; } });
window.addEventListener('appinstalled', () => { $('#install').hidden = true; });
const offlineReady = () => { $('#offline-state').innerHTML = `${icon('offline')}<span>Available offline</span>`; };
const updateSW = registerSW({ onOfflineReady: offlineReady, onNeedRefresh() { $('#update-banner').hidden = false; }, onRegisterError(error) { console.error(error); $('#offline-state').innerHTML = `${icon('info')}<span>Offline setup unavailable</span>`; } });
$('#update-app').addEventListener('click', async () => { if (!saveDraft()) return; controller?.abort(); await updateSW(true); });
if ('serviceWorker' in navigator && import.meta.env.PROD) void navigator.serviceWorker.ready.then(registration => { if (registration.active && navigator.serviceWorker.controller) offlineReady(); });
applyDisplay(); showPage(editor); renderControls(); if (editor) invalidate();
if (hasDraft) $('#save-state').innerHTML = `${icon('check')}${activeProject ? 'Project saved locally' : 'Draft saved locally'}`;
if (loadError) toast(loadError);
