/**
 * Pure, DOM-free description of the Tray settings / Dock settings tabs: groups, order,
 * visibility, disabled state, minimums, one-line hints and collapsed-group summaries.
 * main.ts renders markup from TRAY_GROUPS / DOCK_GROUPS once and then applies
 * traySettingsState() / dockSettingsState() in place after every change.
 */
import { defaultConfig } from '../config';
import { inventoryTrayLayout, trayFootprintError } from '../geometry';
import { H20_V7 } from '../geometry/tray-h20';
import { TRAY_SNAP } from '../geometry/tray-snap';
import { TRAY_SLIDE_DIRECTIONS, traySlideDirection } from '../tray-slide';
import type { HolderConfig, TemplateId, TrayConnection } from '../types';

export type TrayGroupId = 'layout' | 'stacking' | 'lid' | 'size' | 'pockets';
export type DockGroupId = 'layout' | 'size' | 'text';
export type GroupId = TrayGroupId | DockGroupId;

export const TRAY_CONTROLS = [
  'tray.columns', 'tray.spacing', 'tray.rowGap',
  'tray.connection', 'tray.slideDirection',
  'tray.lid', 'tray.lidStyle', 'tray.lidText', 'tray.lidTextPercent', 'tray.lidTextRotation',
  'tray.sizeLocked', 'tray.width', 'tray.depth', 'tray.height', 'tray.margin',
  'tray.scoop', 'tray.retention', 'tray.sideText',
] as const;
export type TrayControlId = (typeof TRAY_CONTROLS)[number];
export const DOCK_CONTROLS = ['dock.columns', 'dock.spacing', 'dock.rowSpacing', 'dock.height', 'dock.edgeMargin', 'dock.depthMargin', 'dock.title'] as const;
export type DockControlId = (typeof DOCK_CONTROLS)[number];

export interface GroupDefinition<G extends string, C extends string> { id: G; title: string; controls: readonly C[] }
export const TRAY_GROUPS: readonly GroupDefinition<TrayGroupId, TrayControlId>[] = [
  { id: 'layout', title: 'Layout', controls: ['tray.columns', 'tray.spacing', 'tray.rowGap'] },
  { id: 'stacking', title: 'Stacking', controls: ['tray.connection', 'tray.slideDirection'] },
  { id: 'lid', title: 'Lid', controls: ['tray.lid', 'tray.lidStyle', 'tray.lidText', 'tray.lidTextPercent', 'tray.lidTextRotation'] },
  { id: 'size', title: 'Size', controls: ['tray.sizeLocked', 'tray.width', 'tray.depth', 'tray.height', 'tray.margin'] },
  { id: 'pockets', title: 'Pockets & text', controls: ['tray.scoop', 'tray.retention', 'tray.sideText'] },
];
export const DOCK_GROUPS: readonly GroupDefinition<DockGroupId, DockControlId>[] = [
  { id: 'layout', title: 'Layout', controls: ['dock.columns', 'dock.spacing', 'dock.rowSpacing'] },
  { id: 'size', title: 'Size', controls: ['dock.height', 'dock.edgeMargin', 'dock.depthMargin'] },
  { id: 'text', title: 'Text', controls: ['dock.title'] },
];
/** Used until the user opens or closes a group for that organizer type. */
export const DEFAULT_OPEN_GROUPS: Record<TemplateId, readonly GroupId[]> = {
  inventory_tray: ['layout', 'stacking'],
  desktop_dock: ['layout', 'size', 'text'],
};

/** The group that holds a data-option id, or undefined (e.g. key label inputs). */
export function groupOfControl(template: TemplateId, control: string): GroupId | undefined {
  const groups: readonly GroupDefinition<GroupId, string>[] = template === 'inventory_tray' ? TRAY_GROUPS : DOCK_GROUPS;
  return groups.find(g => g.controls.includes(control))?.id;
}

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
    fixed: boolean; width: number; depth: number; height: number; requiredWidth: number; requiredDepth: number;
    tooSmall: boolean;
    /** One line under Footprint (fit readout, requirement or error). */
    readout: string;
    /** Grow-to-fit target for the error action, or null. */
    grow: { width: number; depth: number; label: string } | null;
  };
}
export interface DockSettingsState { groups: GroupState<DockGroupId>[]; controls: Record<DockControlId, ControlState> }

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
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const columnsSummary = (columns: number, computed: number | undefined, spacing: number): string =>
  `${columns === 0 ? (computed ? `Auto · ${plural(computed, 'column')}` : 'Auto') : plural(columns, 'column')} · ${fmt(spacing)} mm`;

function state(visible: boolean, hint = '', disabled = false, min?: number): ControlState {
  return { visible, disabled: visible && disabled, hint: visible ? hint : '', ...(min !== undefined ? { min } : {}) };
}

export function traySettingsState(config: HolderConfig, errors: ReadonlySet<string> = new Set()): TraySettingsState {
  const t = config.options.tray, d = defaultConfig().options.tray;
  const layout = inventoryTrayLayout(config);
  const hasKeys = config.slots.length > 0;
  const snap = t.connection === 'snap_fit', h20 = t.connection === 'h20_slide_v7', stacked = t.connection !== 'none';
  const lidText = t.lidText.trim().length > 0;
  const legacyLidSize = t.lidTextPercent === undefined;
  const fixed = t.footprint !== null;
  const tooSmall = hasKeys && trayFootprintError(config) !== undefined;
  const width = layout.width, depth = layout.depth, rw = layout.requiredWidth, rd = layout.requiredDepth;
  const direction = traySlideDirection(t.slideDirection);

  const controls: Record<TrayControlId, ControlState> = {
    'tray.columns': state(true), 'tray.spacing': state(true), 'tray.rowGap': state(true),
    'tray.connection': state(true),
    'tray.slideDirection': state(h20, 'Seen from above. Front is the front-text edge. Use the same direction on every layer.'),
    'tray.lid': state(true, stacked ? 'On a stack, add the lid to the top layer only.' : ''),
    'tray.lidStyle': state(t.lid && !snap, t.lidStyle === 'minimal' ? 'Thin ribbed panel. Uses less filament.' : h20 ? 'Rounded border with thumb grips.' : 'Solid panel.'),
    'tray.lidText': state(t.lid),
    'tray.lidTextPercent': state(t.lid && lidText, legacyLidSize ? 'Available after the preview updates.' : '', legacyLidSize),
    'tray.lidTextRotation': state(t.lid && lidText, '', legacyLidSize),
    'tray.sizeLocked': state(true),
    'tray.width': state(fixed), 'tray.depth': state(fixed),
    'tray.height': state(true, snap ? `At least ${fmt(TRAY_SNAP.minimumHeight)} mm for snap-fit.` : '', false, trayMinimumHeight(config)),
    'tray.margin': state(true, snap ? `At least ${fmt(TRAY_SNAP.margin)} mm for snap-fit.` : '', false, trayMinimumMargin(config)),
    'tray.scoop': state(true),
    'tray.retention': state(true, 'Grip keys in place. Best printed in PETG.'),
    'tray.sideText': state(true),
  };

  const grow = tooSmall ? { width: Math.max(width, rw), depth: Math.max(depth, rd), label: '' } : null;
  if (grow) grow.label = `Use ${fmt(grow.width)} × ${fmt(grow.depth)} mm`;
  const readout = !fixed
    ? (hasKeys ? `${fmt(width)} × ${fmt(depth)} mm, fits your keys` : 'Add keys to see the size.')
    : tooSmall ? `Too small. These keys need at least ${fmt(rw)} × ${fmt(rd)} mm.`
    : hasKeys ? `Keys need at least ${fmt(rw)} × ${fmt(rd)} mm.` : '';

  const connectionTitle = { none: 'Standalone', stackable: 'Stackable', h20_slide_v7: `Slide-lock · ${SLIDE_DIRECTION_OPTIONS.find(o => o.value === direction.id)!.label}`, snap_fit: 'Snap-fit (older version)' }[t.connection];
  const lidSummary = !t.lid ? 'No lid' : `${snap ? 'Snap-fit lid' : t.lidStyle === 'minimal' ? 'Minimal lid' : 'Regular lid'}${lidText ? ` · ${quote(t.lidText, 16)}` : ''}`;
  const sizeSummary = tooSmall ? 'Too small for these keys'
    : `${fixed ? 'Fixed' : 'Fit to keys'} · ${hasKeys || fixed ? `${fmt(width)} × ${fmt(depth)} × ${fmt(layout.height)} mm` : `${fmt(layout.height)} mm high`}`;
  const scoopName = { small: 'Small', default: 'Standard', large: 'Large' }[t.scoop];
  const pocketsSummary = `${scoopName} scoop · ${t.retention ? 'Tabs' : 'No tabs'}${t.sideText.trim() ? ` · ${quote(t.sideText, 14)}` : ''}`;

  const summaries: Record<TrayGroupId, string> = {
    layout: columnsSummary(t.columns, hasKeys ? layout.columns : undefined, t.spacing),
    stacking: connectionTitle,
    lid: lidSummary,
    size: sizeSummary,
    pockets: pocketsSummary,
  };
  const modified: Record<TrayGroupId, boolean> = {
    layout: t.columns !== d.columns || t.spacing !== d.spacing || t.rowGap !== d.rowGap,
    stacking: t.connection !== d.connection || (h20 && t.slideDirection !== d.slideDirection),
    lid: t.lid !== d.lid || t.lidStyle !== d.lidStyle || t.lidText !== d.lidText || (t.lidTextPercent ?? 100) !== 100 || (t.lidTextRotation ?? 0) !== 0,
    size: fixed || t.height !== d.height || t.margin !== d.margin,
    pockets: t.scoop !== d.scoop || t.retention !== d.retention || t.sideText !== d.sideText,
  };
  const groups = TRAY_GROUPS.map(g => ({
    id: g.id, title: g.title, summary: summaries[g.id], modified: modified[g.id],
    error: g.controls.some(c => errors.has(c)) || (g.id === 'size' && tooSmall),
  }));

  return {
    groups, controls,
    legacySnapFit: snap,
    connectionNote: h20 ? 'Adds a 13 mm border on the two locking edges.' : '',
    lidStyleNote: t.lid && snap ? 'Snap-fit lids use a fixed design.' : '',
    stacking: {
      stacked,
      callout: !stacked ? '' : fixed ? `Every layer uses ${fmt(width)} × ${fmt(depth)} mm.` : 'Stacked layers must be the same size.',
      lockLabel: stacked && !fixed && hasKeys ? `Fix size at ${fmt(width)} × ${fmt(depth)} mm` : null,
    },
    size: { fixed, width, depth, height: layout.height, requiredWidth: rw, requiredDepth: rd, tooSmall, readout, grow },
  };
}

export function dockSettingsState(config: HolderConfig, errors: ReadonlySet<string> = new Set()): DockSettingsState {
  const o = config.options.dock, d = defaultConfig().options.dock;
  const summaries: Record<DockGroupId, string> = {
    layout: columnsSummary(o.columns, undefined, o.spacing),
    size: `Base ${fmt(o.height)} mm · margins ${fmt(o.edgeMargin)} / ${fmt(o.depthMargin)} mm`,
    text: o.title.trim() ? quote(o.title, 20) : 'No text',
  };
  const modified: Record<DockGroupId, boolean> = {
    layout: o.columns !== d.columns || o.spacing !== d.spacing || o.rowSpacing !== d.rowSpacing,
    size: o.height !== d.height || o.edgeMargin !== d.edgeMargin || o.depthMargin !== d.depthMargin,
    text: o.title !== d.title,
  };
  const controls = Object.fromEntries(DOCK_CONTROLS.map(c => [c, state(true)])) as Record<DockControlId, ControlState>;
  return {
    groups: DOCK_GROUPS.map(g => ({ id: g.id, title: g.title, summary: summaries[g.id], modified: modified[g.id], error: g.controls.some(c => errors.has(c)) })),
    controls,
  };
}
