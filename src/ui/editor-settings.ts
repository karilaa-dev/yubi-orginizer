/**
 * Size tab (#size-panel) and Tray settings / Dock settings tab (#settings-panel).
 *
 * `sizePanelMarkup()` renders the Size and Spacing sections from SIZE_SECTIONS;
 * `settingsPanelMarkup()` renders the <details> groups from TRAY_GROUPS / DOCK_GROUPS
 * (the organizer-type switch is at the top of the Keys tab: `organizerTypeMarkup()`). After every change `syncSettingsPanel()` applies the pure
 * settings model in place to both tabs: visibility, disabled
 * state, minimums, hints, summaries, modified dots, error marks and the Stacking / Size
 * readouts. Values the user is typing are kept.
 */
import { FRONT_TEXT_PERCENT, TEMPLATES } from '../config';
import { frontTextFit, inventoryTrayLayout } from '../geometry';
import { icon } from '../icons';
import { keyLabelPercent } from '../text-size';
import type { HolderConfig, TemplateId, TrayConnection } from '../types';
import { esc, fmt } from './dom';
import {
  clearFieldError, fieldNotes, inlineSegmentedField, inlineSliderField, numberField, numberValue, segmentedField, setControlValue, setHint,
  sliderField, switchField, textSettingField,
} from './editor-fields';
import {
  CONNECTION_OPTIONS, DOCK_GROUPS, SIZE_SECTIONS, SLIDE_DIRECTION_OPTIONS, TRAY_GROUPS, dockSettingsState, footprintChoice, traySettingsState,
  trayMinimumHeight, trayMinimumMargin,
  type ControlState, type DockSettingsState, type FootprintMatch, type GroupId, type GroupState, type MatchState, type TraySettingsState,
} from './settings-model';

export const DOCK_NOTICE = 'Dock fit is still being tuned. Print a one-key dock first.';
export const ORGANIZER_TYPE_LOCK_HINT = 'Projects with multiple tray layers must use Inventory tray. Remove extra trays to change the organizer type.';

export const COLUMN_OPTIONS = [0, 1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: n === 0 ? 'Auto' : String(n) }));

export interface SettingsMarkupOptions {
  /** Groups rendered open. */
  open: ReadonlySet<string>;
  lid?: boolean;
}

function group(id: GroupId, title: string, open: boolean, body: string): string {
  return `<details class="group" data-group="${id}"${open ? ' open' : ''}>
    <summary><span class="group-title"><span class="modified-dot" hidden></span>${esc(title)}<span class="sr-only group-sr"></span></span>`
    + `<span class="group-summary" data-summary="${id}"><span class="sr-only">, </span><span class="summary-text"></span></span>`
    + `<span class="group-error" aria-hidden="true" hidden>!</span>${icon('down', 'group-chevron')}</summary>
    <div class="group-body">${body}</div>
  </details>`;
}

function organizerType(template: TemplateId): string {
  const options = TEMPLATES.map(t => {
    const badge = t.id === 'desktop_dock' ? '<span class="badge">Beta</span>' : '';
    const checked = t.id === template ? ' checked' : '';
    return `<label><input type="radio" name="organizer-type" value="${t.id}" data-template-switch${checked}/>`
      + `<span>${icon(t.icon)}${esc(t.name)}${badge}</span></label>`;
  }).join('');
  return `<fieldset class="segmented-field type-field"><legend>Organizer type</legend><div class="segmented">${options}</div></fieldset>`;
}

export function trayGroups(config: HolderConfig, open: ReadonlySet<string>, panel: 'settings' | 'layers' | 'lid' = 'settings'): string {
  const t = config.options.tray;
  const connections = CONNECTION_OPTIONS.filter(o => o.value !== 'snap_fit' || t.connection === 'snap_fit');
  const cards = connections.map(o => {
    const checked = t.connection === o.value ? ' checked' : '';
    const note = o.value === 'h20_slide_v7' ? '<small class="option-note" id="connection-note" hidden></small>' : '';
    return `<label class="option-card${o.value === 'snap_fit' ? ' is-legacy' : ''}"><input type="radio" name="tray-connection" value="${o.value}" data-option="tray.connection"${checked}/>`
      + `<span class="option-title">${esc(o.title)}</span><small>${esc(o.description)}</small>${note}</label>`;
  }).join('');

  const frontSize = frontTextSizeField('tray.sideTextPercent', config);
  const bodies: Record<string, string> = {
    stacking: `<fieldset class="option-cards" data-control="tray.connection" aria-describedby="hint-tray.connection error-tray.connection"><legend>Connection</legend>${cards}${fieldNotes('tray.connection')}</fieldset>`
      + segmentedField({
        id: 'tray.slideDirection', legend: 'Slide direction', options: SLIDE_DIRECTION_OPTIONS, value: t.slideDirection, className: 'direction-field',
        hintExtra: ' <button type="button" class="text-button inline-link" data-action="help-stacking">How to assemble</button>',
      })
      + `<div id="stacking-callout" class="callout stacking-callout" hidden>${icon('layers')}<div class="callout-body"><p id="stacking-callout-text"></p>
          <div class="callout-actions"><button type="button" class="button secondary compact" data-action="lock-footprint" hidden></button>`
      + `<button type="button" class="button secondary compact" data-action="new-layer">${icon('plus')}New matching layer</button></div></div></div>`,
    lid: segmentedField({ id: 'tray.lidStyle', legend: 'Style', options: [{ value: 'regular', label: 'Regular' }, { value: 'minimal', label: 'Minimal' }], value: t.lidStyle })
      + '<p id="lid-style-note" class="field-hint" hidden></p>'
      + textSettingField({ id: 'tray.lidText', label: 'Lid text', value: t.lidText },
        inlineSliderField({ id: 'tray.lidTextPercent', label: 'Size', spoken: 'Lid text size', value: t.lidTextPercent ?? 100, min: 0.1, max: 100, step: 0.1, unit: '%', disabled: t.lidTextPercent === undefined })
        + inlineSegmentedField({ id: 'tray.lidTextRotation', legend: 'Rotation', spoken: 'Lid text rotation', options: [0, 90, 180, 270].map(r => ({ value: r, label: `${r}°` })), value: t.lidTextRotation ?? 0, numeric: true })),
    pockets: segmentedField({ id: 'tray.scoop', legend: 'Finger scoop', options: [{ value: 'small', label: 'Small' }, { value: 'default', label: 'Standard' }, { value: 'large', label: 'Large' }], value: t.scoop })
      + switchField({ id: 'tray.retention', label: 'Retention tabs', checked: t.retention, badge: 'Untested' })
      + textSettingField({ id: 'tray.sideText', label: 'Front text', value: t.sideText }, frontSize),
  };
  return TRAY_GROUPS.filter(g => panel === 'layers' ? g.id === 'stacking' : panel === 'lid' ? g.id === 'lid' : g.id === 'pockets')
    .map(g => group(g.id, g.title, open.has(g.id), bodies[g.id])).join('');
}

/** Front text Size: percent of the largest text that fits the front wall. */
const frontTextSizeField = (id: string, config: HolderConfig): string => inlineSliderField({
  id, label: 'Size', spoken: 'Front text size', value: frontTextFit(config).percent,
  min: FRONT_TEXT_PERCENT.min, max: FRONT_TEXT_PERCENT.max, step: 1, unit: '%',
});

function dockGroups(config: HolderConfig, open: ReadonlySet<string>): string {
  const d = config.options.dock;
  const bodies: Record<string, string> = {
    text: textSettingField({ id: 'dock.title', label: 'Front text', value: d.title }, frontTextSizeField('dock.titlePercent', config)),
  };
  return DOCK_GROUPS.map(g => group(g.id, g.title, open.has(g.id), bodies[g.id])).join('');
}

export interface SizeMarkupOptions {
  /** Size › Footprint › Match project state. */
  match: MatchState;
  /** Other saved trays whose width and depth can be copied. */
  candidates: readonly FootprintMatch[];
}

const section = (id: string, title: string, body: string): string =>
  `<section class="size-section" data-section="${id}" aria-labelledby="section-${id}"><h3 id="section-${id}" class="section-title">${esc(title)}</h3>${body}</section>`;

const FOOTPRINT_OPTIONS = [{ value: 'fit', label: 'Fit to keys' }, { value: 'fixed', label: 'Fixed size' }, { value: 'match', label: 'Match project' }];

function matchField(options: SizeMarkupOptions): string {
  const selected = options.match && options.match !== 'choosing' ? options.match.id : '';
  const items = options.candidates.map(c => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>${esc(c.name)} · ${fmt(c.width)} × ${fmt(c.depth)} mm</option>`).join('');
  const empty = options.candidates.length ? 'Choose a tray…' : 'No other trays on this device yet';
  return `<div class="field match-field" data-match hidden><label for="match-project">Copy width and depth from</label>`
    + `<select id="match-project"${options.candidates.length ? '' : ' disabled'}><option value=""${selected ? '' : ' selected'}>${empty}</option>${items}</select></div>`;
}

/** Size tab: outside size on top, spacing below. */
export function sizePanelMarkup(config: HolderConfig, options: SizeMarkupOptions): string {
  const titles = Object.fromEntries(SIZE_SECTIONS[config.template].map(s => [s.id, s.title]));
  if (config.template === 'desktop_dock') {
    const d = config.options.dock;
    return section('size', titles.size, '<p id="dock-size-readout" class="size-readout"></p>'
        + sliderField({ id: 'dock.height', label: 'Base height', value: d.height, min: 11, max: 25, step: 0.5 }))
      + section('spacing', titles.spacing, sliderField({ id: 'dock.spacing', label: 'Column spacing', value: d.spacing, min: 22, max: 40, step: 0.5 })
        + sliderField({ id: 'dock.rowSpacing', label: 'Row spacing', value: d.rowSpacing, min: 18, max: 70, step: 0.5 })
        + sliderField({ id: 'dock.edgeMargin', label: 'Side margin', value: d.edgeMargin, min: 12, max: 40, step: 0.5 })
        + sliderField({ id: 'dock.depthMargin', label: 'Front & back margin', value: d.depthMargin, min: 18, max: 45, step: 0.5 }));
  }
  const t = config.options.tray;
  const layout = inventoryTrayLayout(config);
  const minHeight = trayMinimumHeight(config), minMargin = trayMinimumMargin(config);
  return section('size', titles.size, segmentedField({
        id: 'tray.sizeLocked', legend: 'Footprint', options: FOOTPRINT_OPTIONS, value: footprintChoice(config, options.match),
        className: 'footprint-field', after: '<p id="tray-size-readout" class="size-readout"></p>',
      })
      + matchField(options)
      // The size readout says what the keys need, and why the size is an error when it is too small.
      + `<div class="dimension-fields">${numberField({ id: 'tray.width', label: 'Width', value: layout.width || 80, min: 20, max: 1000, step: 0.01, describedBy: 'tray-size-readout' })}`
      + `${numberField({ id: 'tray.depth', label: 'Depth', value: layout.depth || 80, min: 20, max: 6000, step: 0.01, describedBy: 'tray-size-readout' })}</div>`
      + '<button type="button" id="grow-footprint" class="button secondary compact grow-button" data-action="grow-footprint" hidden></button>'
      + '<p class="field-hint">Width, depth and height apply to every tray layer.</p>'
      + sliderField({ id: 'tray.height', label: 'Height', value: Math.max(t.height, minHeight), min: minHeight, max: 20, step: 0.1 }))
    + section('spacing', titles.spacing, sliderField({ id: 'tray.spacing', label: 'Column spacing', value: t.spacing, min: 24, max: 42, step: 0.5 })
      + sliderField({ id: 'tray.rowGap', label: 'Row spacing', value: t.rowGap, min: 2, max: 40, step: 0.5 })
      + sliderField({ id: 'tray.margin', label: 'Edge margin', value: Math.max(t.margin, minMargin), min: minMargin, max: 20, step: 0.5 }));
}

/** Organizer type switch, and the dock notice (dock only, until dismissed). Top of the Keys tab. */
export function organizerTypeMarkup(template: TemplateId, dockNotice: boolean): string {
  const notice = template === 'desktop_dock' && dockNotice
    ? `<div id="dock-notice" class="callout warn dock-notice">${icon('alert')}<span class="callout-text">${DOCK_NOTICE}</span>`
      + '<button type="button" class="button quiet compact" data-action="dismiss-dock-notice">Got it</button></div>'
    : '';
  return organizerType(template) + notice;
}

export function settingsPanelMarkup(config: HolderConfig, options: SettingsMarkupOptions): string {
  const dock = config.template === 'desktop_dock';
  if (options.lid) return `<div class="groups">${trayGroups(config, new Set([...options.open, 'lid']), 'lid')}</div>`;
  const columns = dock ? config.options.dock.columns : config.options.tray.columns;
  const columnsId = dock ? 'dock.columns' : 'tray.columns';
  return `<div class="panel-section layout-settings">
    ${inlineSegmentedField({ id: columnsId, legend: 'Columns', options: COLUMN_OPTIONS, value: columns, numeric: true, className: 'columns-field' })}
    <div class="text-setting">
      ${switchField({ id: 'labels', label: 'Print labels', checked: config.labels })}
      <div class="text-options label-size"${config.labels ? '' : ' hidden'}>${inlineSliderField({ id: 'labelSize', label: 'Size', spoken: 'Label size', value: keyLabelPercent(config.labelSize), min: 37.5, max: 100, step: 2.5, unit: '%' })}</div>
      <p id="labels-off-note" class="field-hint"${config.labels ? ' hidden' : ''}>Labels won't be printed.</p>
    </div>
  </div><div class="groups">${dock ? dockGroups(config, options.open) : trayGroups(config, options.open)}</div>`;
}

/* ───────────── In-place sync ───────────── */

/** The value a control shows for `config` (used to reset inputs whose invalid edit was discarded). */
export function controlValue(config: HolderConfig, id: string): string | number | boolean | undefined {
  if (id === 'tray.sizeLocked') return config.options.tray.footprint ? 'fixed' : 'fit';
  if (id === 'tray.width' || id === 'tray.depth') {
    const layout = inventoryTrayLayout(config);
    return (id === 'tray.width' ? layout.width : layout.depth) || 80;
  }
  if (id === 'tray.lidTextPercent') return config.options.tray.lidTextPercent ?? 100;
  if (id === 'tray.lidTextRotation') return config.options.tray.lidTextRotation ?? 0;
  if (id === 'tray.sideTextPercent' || id === 'dock.titlePercent') return frontTextFit(config).percent;
  if (id === 'tray.height') return Math.max(config.options.tray.height, trayMinimumHeight(config));
  if (id === 'tray.margin') return Math.max(config.options.tray.margin, trayMinimumMargin(config));
  const [section, name] = id.split('.');
  const options = config.options[section as keyof HolderConfig['options']] as unknown as Record<string, unknown> | undefined;
  const value = options?.[name];
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : undefined;
}

const isFocused = (root: ParentNode, id: string): boolean => {
  const active = document.activeElement as HTMLElement | null;
  return !!active && active.dataset.option === id && root.contains(active);
};

export interface SyncMemory {
  /** Groups that already had an error at the last sync; they auto-open only when an error appears. */
  errorGroups: Set<string>;
}

/**
 * Applies the settings model to the rendered panel. Errors of controls that are hidden or
 * disabled are dropped from `errors` (and their inputs reset), so they never block generation.
 */
export function syncSettingsPanel(root: HTMLElement, config: HolderConfig, errors: Map<string, string>, memory: SyncMemory, match?: MatchState, project: HolderConfig = config): TraySettingsState | DockSettingsState {
  const compute = () => config.template === 'inventory_tray'
    ? traySettingsState(config, new Set(errors.keys()), match, project)
    : dockSettingsState(config, new Set(errors.keys()));
  let state = compute();
  const controls = state.controls as Record<string, ControlState>;

  let dropped = false;
  for (const [id, control] of Object.entries(controls)) {
    const wrap = root.querySelector<HTMLElement>(`[data-control="${id}"]`);
    if (wrap) wrap.hidden = !control.visible;
    for (const input of root.querySelectorAll<HTMLInputElement>(`[data-option="${id}"]`)) {
      input.disabled = control.disabled;
      if (control.min !== undefined && (input.type === 'number' || input.type === 'range')) input.min = String(control.min);
    }
    setHint(root, id, control.hint);
    if ((!control.visible || control.disabled) && errors.has(id)) {
      errors.delete(id);
      clearFieldError(root, id);
      const value = controlValue(config, id);
      if (value !== undefined) setControlValue(root, id, value);
      dropped = true;
    }
  }
  if (dropped) state = compute();

  // Keep derived values current unless the user is typing in that field.
  // (A project saved without a front text percentage shows the one that matches its size.)
  const derived = config.template === 'inventory_tray' ? ['tray.height', 'tray.margin', 'tray.width', 'tray.depth', 'tray.sideTextPercent'] : ['dock.titlePercent'];
  for (const id of derived) {
    if (errors.has(id) || isFocused(root, id)) continue;
    const value = 'stacking' in state && id === 'tray.width' ? state.size.width : 'stacking' in state && id === 'tray.depth' ? state.size.depth : controlValue(config, id);
    if (typeof value !== 'number') continue;
    for (const input of root.querySelectorAll<HTMLInputElement>(`[data-option="${id}"]`)) {
      if (input !== document.activeElement && input.value !== numberValue(value)) input.value = numberValue(value);
    }
  }

  syncGroups(root, state.groups, memory);
  if ('stacking' in state) syncTray(root, state, errors);
  else {
    const readout = root.querySelector<HTMLElement>('#dock-size-readout');
    if (readout) readout.textContent = state.size.readout;
  }
  return state;
}

function syncGroups(root: HTMLElement, groups: readonly GroupState<string>[], memory: SyncMemory): void {
  for (const g of groups) {
    const details = root.querySelector<HTMLDetailsElement>(`[data-group="${g.id}"]`);
    if (!details) continue;
    const text = details.querySelector<HTMLElement>('.summary-text');
    if (text && text.textContent !== g.summary) text.textContent = g.summary;
    details.querySelector<HTMLElement>('.modified-dot')!.hidden = !g.modified;
    details.querySelector<HTMLElement>('.group-error')!.hidden = !g.error;
    details.classList.toggle('has-error', g.error);
    details.querySelector<HTMLElement>('.group-sr')!.textContent = `${g.modified ? ' (changed)' : ''}${g.error ? ', has an error' : ''}`;
    if (g.error && !memory.errorGroups.has(g.id)) details.open = true;
    if (g.error) memory.errorGroups.add(g.id); else memory.errorGroups.delete(g.id);
  }
}

function syncTray(root: HTMLElement, state: TraySettingsState, errors: ReadonlyMap<string, string>): void {
  const note = root.querySelector<HTMLElement>('#connection-note');
  if (note) { note.textContent = state.connectionNote; note.hidden = !state.connectionNote; }

  const lidNote = root.querySelector<HTMLElement>('#lid-style-note');
  if (lidNote) { lidNote.textContent = state.lidStyleNote; lidNote.hidden = !state.lidStyleNote; }

  const callout = root.querySelector<HTMLElement>('#stacking-callout');
  if (callout) {
    callout.hidden = !state.stacking.stacked;
    root.querySelector<HTMLElement>('#stacking-callout-text')!.textContent = state.stacking.callout;
    const lock = callout.querySelector<HTMLButtonElement>('[data-action="lock-footprint"]')!;
    lock.hidden = state.stacking.lockLabel === null;
    lock.textContent = state.stacking.lockLabel ?? '';
  }

  // Grow, Undo and other windows change the footprint: the segment follows the config.
  for (const radio of root.querySelectorAll<HTMLInputElement>('[data-option="tray.sizeLocked"]')) {
    if (!errors.has('tray.sizeLocked')) radio.checked = radio.value === state.size.choice;
  }
  const match = root.querySelector<HTMLElement>('[data-match]');
  if (match) match.hidden = state.size.choice !== 'match';

  const readout = root.querySelector<HTMLElement>('#tray-size-readout');
  if (readout) {
    readout.textContent = state.size.readout;
    readout.hidden = !state.size.readout;
    readout.classList.toggle('error', state.size.tooSmall);
  }
  // A too-small fixed size is an error of Width and Depth ("Fix 1 setting" focuses Width).
  for (const id of ['tray.width', 'tray.depth']) {
    const input = root.querySelector<HTMLInputElement>(`input[type="number"][data-option="${id}"]`);
    if (!input) continue;
    if (state.size.tooSmall) input.setAttribute('aria-invalid', 'true');
    else if (!errors.has(id)) input.removeAttribute('aria-invalid'); // keep the field's own input error
  }
  const grow = root.querySelector<HTMLButtonElement>('#grow-footprint');
  if (grow) {
    grow.hidden = !state.size.grow;
    grow.textContent = state.size.grow?.label ?? '';
  }
}

/* ───────────── Validation ───────────── */

/** Snap-fit raises the Height and Edge margin minimums; validateConfig() only knows the general range. */
export function snapFitRangeError(config: HolderConfig, field: string): string | undefined {
  const outOfRange = (v: number, min: number): boolean => !Number.isFinite(v) || v < min || v > 20;
  const minHeight = trayMinimumHeight(config), minMargin = trayMinimumMargin(config);
  if (field === 'tray.height' && minHeight > 8.6 && outOfRange(config.options.tray.height, minHeight)) return `Height must be between ${fmt(minHeight)} and 20 mm for snap-fit.`;
  if (field === 'tray.margin' && minMargin > 5 && outOfRange(config.options.tray.margin, minMargin)) return `Edge margin must be between ${fmt(minMargin)} and 20 mm for snap-fit.`;
  return undefined;
}

/* ───────────── Undo ───────────── */

/** Undo of an organizer type switch: only the type goes back; keys and settings edited since stay. */
export const withTemplate = (config: HolderConfig, template: TemplateId): HolderConfig => ({ ...config, template });

/** Undo of "Replaced snap-fit.": only the connection goes back (geometry clamps height and margin to its minimums). */
export function withConnection(config: HolderConfig, connection: TrayConnection): HolderConfig {
  const next = structuredClone(config);
  next.options.tray.connection = connection;
  return next;
}
