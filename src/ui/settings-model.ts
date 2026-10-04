/**
 * Pure, DOM-free description of the Size tab and the Tray settings / Dock settings tab: groups,
 * sections, order, visibility, disabled state, minimums, one-line hints and collapsed-group
 * summaries. The editor renders markup from TRAY_GROUPS / DOCK_GROUPS and SIZE_SECTIONS once
 * and then applies traySettingsState() / dockSettingsState() in place after every change.
 */
import { defaultConfig } from '../config';
import { dockLayout, inventoryTrayLayout } from '../geometry';
import { traySetLayout } from '../geometry/layers';
import { projectKeyCount, projectLayers } from '../layers';
import { H20_V7 } from '../geometry/tray-h20';
import { TRAY_SNAP } from '../geometry/tray-snap';
import { TRAY_SLIDE_DIRECTIONS, traySlideDirection } from '../tray-slide';
import type { HolderConfig, TemplateId, TrayConnection } from '../types';

export type Panel = 'keys' | 'size' | 'settings' | 'layers';
export type TrayGroupId = 'stacking' | 'lid' | 'pockets';
export type DockGroupId = 'text';
export type GroupId = TrayGroupId | DockGroupId;
export type SizeSectionId = 'size' | 'spacing';

export const TRAY_CONTROLS = [
  'tray.columns', 'tray.spacing', 'tray.rowGap',
  'tray.connection', 'tray.slideDirection',
  'tray.lidStyle', 'tray.lidText', 'tray.lidTextPercent', 'tray.lidTextRotation',
  'tray.sizeLocked', 'tray.width', 'tray.depth', 'tray.height', 'tray.margin',
  'tray.scoop', 'tray.retention', 'tray.sideText', 'tray.sideTextPercent',
] as const;
export type TrayControlId = (typeof TRAY_CONTROLS)[number];
export const DOCK_CONTROLS = ['dock.columns', 'dock.spacing', 'dock.rowSpacing', 'dock.height', 'dock.edgeMargin', 'dock.depthMargin', 'dock.title', 'dock.titlePercent'] as const;
export type DockControlId = (typeof DOCK_CONTROLS)[number];

export interface GroupDefinition<G extends string, C extends string> { id: G; title: string; controls: readonly C[] }
/** Tray settings tab. */
export const TRAY_GROUPS: readonly GroupDefinition<TrayGroupId, TrayControlId>[] = [
  { id: 'stacking', title: 'Stacking', controls: ['tray.connection', 'tray.slideDirection'] },
  { id: 'lid', title: 'Lid', controls: ['tray.lidStyle', 'tray.lidText', 'tray.lidTextPercent', 'tray.lidTextRotation'] },
  { id: 'pockets', title: 'Pockets & text', controls: ['tray.scoop', 'tray.retention', 'tray.sideText', 'tray.sideTextPercent'] },
];
/** Dock settings tab. */
export const DOCK_GROUPS: readonly GroupDefinition<DockGroupId, DockControlId>[] = [
  { id: 'text', title: 'Text', controls: ['dock.title', 'dock.titlePercent'] },
];
/** Size tab: the outside size on top, spacing below. */
export const SIZE_SECTIONS: Record<TemplateId, readonly GroupDefinition<SizeSectionId, string>[]> = {
  inventory_tray: [
    { id: 'size', title: 'Size', controls: ['tray.sizeLocked', 'tray.width', 'tray.depth', 'tray.height'] },
    { id: 'spacing', title: 'Spacing', controls: ['tray.spacing', 'tray.rowGap', 'tray.margin'] },
  ],
  desktop_dock: [
    { id: 'size', title: 'Size', controls: ['dock.height'] },
    { id: 'spacing', title: 'Spacing', controls: ['dock.spacing', 'dock.rowSpacing', 'dock.edgeMargin', 'dock.depthMargin'] },
  ],
};
/** Used until the user opens or closes a group for that organizer type. */
export const DEFAULT_OPEN_GROUPS: Record<TemplateId, readonly GroupId[]> = {
  inventory_tray: ['stacking', 'lid'],
  desktop_dock: ['text'],
};

/** Per-key label errors belong to the Keys tab; print settings belong to Settings. */
export const isKeysControl = (id: string): boolean =>
  id.startsWith('label-');

/** The tab that shows a control. */
export function panelOfControl(template: TemplateId, control: string): Panel {
  if (isKeysControl(control)) return 'keys';
  if (template === 'inventory_tray' && TRAY_GROUPS.find(g => g.id === 'stacking')!.controls.includes(control as TrayControlId)) return 'layers';
  return SIZE_SECTIONS[template].some(s => s.controls.includes(control)) ? 'size' : 'settings';
}

/** The settings group that holds a data-option id, or undefined (Keys and Size tab controls). */
export function groupOfControl(template: TemplateId, control: string): GroupId | undefined {
  const groups: readonly GroupDefinition<GroupId, string>[] = template === 'inventory_tray' ? TRAY_GROUPS : DOCK_GROUPS;
  return groups.find(g => g.controls.includes(control))?.id;
}

/** Another saved tray whose width and depth were copied (Size › Footprint › Match project). */
export interface FootprintMatch { id: string; name: string; width: number; depth: number }
/** 'choosing': Match project is selected but no project is picked yet. */
export type MatchState = FootprintMatch | 'choosing' | undefined;
export type FootprintChoice = 'fit' | 'fixed' | 'match';

/** The Footprint segment to show. A matched size stays "Match project" until it is changed. */
export function footprintChoice(config: HolderConfig, match: MatchState): FootprintChoice {
  const footprint = config.options.tray.footprint;
  if (match === 'choosing') return 'match';
  if (!footprint) return 'fit';
  return match && footprint.width === match.width && footprint.depth === match.depth ? 'match' : 'fixed';
}

export const FRONT_TEXT_NOTE = "Engraved into the front wall, so it won't print perfectly crisp. Larger text reads better.";
export const RETENTION_NOTE = 'Not tested yet: keys may sit too tight or too loose. Print a one-key tray first, ideally in PETG.';

export function trayMinimumMargin(config: HolderConfig): number {
  if (config.template !== 'inventory_tray') return 5;
  return config.options.tray.connection === 'snap_fit' ? TRAY_SNAP.margin : config.options.tray.connection === 'h20_slide_v7' ? H20_V7.edgeMargin : 5;
}
export function trayMinimumHeight(config: HolderConfig): number {
  return config.template === 'inventory_tray' && config.options.tray.connection === 'snap_fit' ? TRAY_SNAP.minimumHeight : 8.6;
}

export interface ControlState { visible: boolean; disabled: boolean; hint: string; min?: number }
export interface GroupState<G extends string> { id: G; title: string; summary: string; modified: boolean; error: boolean }
export interface TraySettingsState {
  groups: GroupState<TrayGroupId>[];
  controls: Record<TrayControlId, ControlState>;
  /** Only when the current value is the retired snap_fit connection: render its option card, checked. */
  legacySnapFit: boolean;
  /** Extra line on the selected connection card ('' for none). */
  connectionNote: string;
  /** Replaces the Style control while a snap-fit lid is on ('' otherwise). */
  lidStyleNote: string;
  stacking: {
    /** connection !== 'none' */
    stacked: boolean;
    /** Callout text under Stacking ('' when not stacked). */
    callout: string;
    /** Label of the "fix size" button, or null when it must not be shown. */
    lockLabel: string | null;
  };
  size: {
    fixed: boolean; choice: FootprintChoice; width: number; depth: number; height: number; requiredWidth: number; requiredDepth: number;
    tooSmall: boolean;
    /** One line under Footprint (fit readout, requirement or error). */
    readout: string;
    /** Grow-to-fit target for the error action, or null. */
    grow: { width: number; depth: number; label: string } | null;
  };
}
export interface DockSettingsState {
  groups: GroupState<DockGroupId>[];
  controls: Record<DockControlId, ControlState>;
  /** Size tab readout: the footprint the spacing and margins make. */
  size: { readout: string };
}

export const CONNECTION_OPTIONS: readonly { value: TrayConnection; title: string; description: string }[] = [
  { value: 'none', title: 'Standalone', description: 'A single tray.' },
  { value: 'stackable', title: 'Stackable', description: 'Rims keep layers aligned. Lift to separate.' },
  { value: 'h20_slide_v7', title: 'Slide-lock', description: 'Pins lock layers. Slide to release.' },
  { value: 'snap_fit', title: 'Snap-fit (from an older version)', description: 'Kept as saved. Choosing another type replaces it.' },
];

/** Segment labels for Slide direction, e.g. "← Left". */
export const SLIDE_DIRECTION_OPTIONS = TRAY_SLIDE_DIRECTIONS.map(d => ({ value: d.id, label: d.label.split(' ').reverse().join(' ') }));

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const quote = (text: string, max: number): string => { const t = text.trim(); return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`; };

function state(visible: boolean, hint = '', disabled = false, min?: number): ControlState {
  return { visible, disabled: visible && disabled, hint: visible ? hint : '', ...(min !== undefined ? { min } : {}) };
}

export function traySettingsState(config: HolderConfig, errors: ReadonlySet<string> = new Set(), match?: MatchState, project: HolderConfig = config): TraySettingsState {
  const t = config.options.tray, d = defaultConfig().options.tray;
  const layout = { ...inventoryTrayLayout(config), ...traySetLayout(project) };
  const hasKeys = projectKeyCount(project) > 0;
  const many = projectLayers(project).length > 1;
  const snap = t.connection === 'snap_fit', h20 = t.connection === 'h20_slide_v7', stacked = t.connection !== 'none';
  const lidText = t.lidText.trim().length > 0;
  const legacyLidSize = t.lidTextPercent === undefined;
  const fixed = t.footprint !== null;
  const choice = footprintChoice(config, match);
  const tooSmall = layout.tooSmall;
  const width = layout.width, depth = layout.depth, rw = layout.requiredWidth, rd = layout.requiredDepth;
  const direction = traySlideDirection(t.slideDirection);

  const controls: Record<TrayControlId, ControlState> = {
    'tray.columns': state(true), 'tray.spacing': state(true), 'tray.rowGap': state(true),
    'tray.connection': state(true),
    'tray.slideDirection': state(h20, 'Seen from above. Front is the front-text edge. Use the same direction on every layer.'),
    'tray.lidStyle': state(t.lid && !snap, t.lidStyle === 'minimal' ? 'Thin ribbed panel. Uses less filament.' : h20 ? 'Rounded border with thumb grips.' : 'Solid panel.'),
    'tray.lidText': state(t.lid),
    'tray.lidTextPercent': state(t.lid && lidText, legacyLidSize ? 'Available after the preview updates.' : '', legacyLidSize),
    'tray.lidTextRotation': state(t.lid && lidText, '', legacyLidSize),
    'tray.sizeLocked': state(true),
    'tray.width': state(choice === 'fixed'), 'tray.depth': state(choice === 'fixed'),
    'tray.height': state(true, snap ? `At least ${fmt(TRAY_SNAP.minimumHeight)} mm for snap-fit.` : '', false, trayMinimumHeight(config)),
    'tray.margin': state(true, snap ? `At least ${fmt(TRAY_SNAP.margin)} mm for snap-fit.` : '', false, trayMinimumMargin(config)),
    'tray.scoop': state(true),
    'tray.retention': state(true, RETENTION_NOTE),
    'tray.sideText': state(true),
    'tray.sideTextPercent': state(t.sideText.trim().length > 0, FRONT_TEXT_NOTE),
  };

  const grow = tooSmall ? { width: Math.max(width, rw), depth: Math.max(depth, rd), label: '' } : null;
  if (grow) grow.label = `Use ${fmt(grow.width)} × ${fmt(grow.depth)} mm`;
  const matched = match && match !== 'choosing' && choice === 'match' ? match : undefined;
  const readout = choice === 'match' && !matched ? 'Choose a tray to copy its width and depth.'
    : !fixed
    ? (hasKeys ? `${fmt(width)} × ${fmt(depth)} mm, fits ${many ? 'all layers' : 'your keys'}` : 'Add keys to see the size.')
    : tooSmall ? `Too small. ${hasKeys ? 'These keys need' : 'This connection needs'} at least ${fmt(rw)} × ${fmt(rd)} mm.`
    : matched ? `${fmt(width)} × ${fmt(depth)} mm, same as ${quote(matched.name, 28)}.`
    : hasKeys ? `Keys need at least ${fmt(rw)} × ${fmt(rd)} mm.` : '';

  const connectionTitle = { none: 'Standalone', stackable: 'Stackable', h20_slide_v7: `Slide-lock · ${SLIDE_DIRECTION_OPTIONS.find(o => o.value === direction.id)!.label}`, snap_fit: 'Snap-fit (older version)' }[t.connection];
  const lidSummary = !t.lid ? 'No lid' : `${snap ? 'Snap-fit lid' : t.lidStyle === 'minimal' ? 'Minimal lid' : 'Regular lid'}${lidText ? ` · ${quote(t.lidText, 16)}` : ''}`;
  const scoopName = { small: 'Small', default: 'Standard', large: 'Large' }[t.scoop];
  const pocketsSummary = `${scoopName} scoop · ${t.retention ? 'Tabs' : 'No tabs'}${t.sideText.trim() ? ` · ${quote(t.sideText, 14)}` : ''}`;

  const summaries: Record<TrayGroupId, string> = {
    stacking: connectionTitle,
    lid: lidSummary,
    pockets: pocketsSummary,
  };
  const modified: Record<TrayGroupId, boolean> = {
    stacking: t.connection !== d.connection || (h20 && t.slideDirection !== d.slideDirection),
    lid: t.lid !== d.lid || t.lidStyle !== d.lidStyle || t.lidText !== d.lidText || (t.lidTextPercent ?? 100) !== 100 || (t.lidTextRotation ?? 0) !== 0,
    pockets: t.scoop !== d.scoop || t.retention !== d.retention || t.sideText !== d.sideText || (t.sideTextPercent ?? d.sideTextPercent) !== d.sideTextPercent,
  };
  const groups = TRAY_GROUPS.map(g => ({
    id: g.id, title: g.title, summary: summaries[g.id], modified: modified[g.id],
    error: g.controls.some(c => errors.has(c)),
  }));

  return {
    groups, controls,
    legacySnapFit: snap,
    connectionNote: h20 ? 'Adds a 13 mm border on the two locking edges.' : '',
    lidStyleNote: t.lid && snap ? 'Snap-fit lids use a fixed design.' : '',
    stacking: {
      stacked,
      callout: !stacked ? '' : many ? `Every layer uses ${fmt(width)} × ${fmt(depth)} mm. Change the shared footprint in Size.` : fixed ? `Every layer uses ${fmt(width)} × ${fmt(depth)} mm.` : 'New layers share this footprint. Fit to keys sizes the whole set.',
      lockLabel: stacked && !fixed && hasKeys && !many ? `Fix size at ${fmt(width)} × ${fmt(depth)} mm` : null,
    },
    size: { fixed, choice, width, depth, height: layout.height, requiredWidth: rw, requiredDepth: rd, tooSmall, readout, grow },
  };
}

export function dockSettingsState(config: HolderConfig, errors: ReadonlySet<string> = new Set()): DockSettingsState {
  const o = config.options.dock, d = defaultConfig().options.dock;
  const summaries: Record<DockGroupId, string> = {
    text: o.title.trim() ? quote(o.title, 20) : 'No text',
  };
  const modified: Record<DockGroupId, boolean> = {
    text: o.title !== d.title || (o.titlePercent ?? d.titlePercent) !== d.titlePercent,
  };
  const controls = Object.fromEntries(DOCK_CONTROLS.map(c => [c, state(true)])) as Record<DockControlId, ControlState>;
  controls['dock.titlePercent'] = state(o.title.trim().length > 0, FRONT_TEXT_NOTE);
  const dock = dockLayout(config);
  return {
    groups: DOCK_GROUPS.map(g => ({ id: g.id, title: g.title, summary: summaries[g.id], modified: modified[g.id], error: g.controls.some(c => errors.has(c)) })),
    controls,
    size: { readout: config.slots.length ? `${fmt(dock.width)} × ${fmt(dock.depth)} mm. Spacing and margins set the size.` : 'Add keys to see the size.' },
  };
}
