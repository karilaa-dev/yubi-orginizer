import type { HolderConfig, KeyType, Slot, TemplateId } from './types';

export const KEY_TYPES: KeyType[] = ['A', 'C', 'AN', 'CN', 'CK', 'CI'];
export const KEY_CATALOG: Record<KeyType, { name: string; short: string; connector: string }> = {
  A: { name: 'YubiKey 5 NFC', short: '5 NFC', connector: 'USB-A · NFC' },
  C: { name: 'YubiKey 5C NFC', short: '5C NFC', connector: 'USB-C · NFC' },
  AN: { name: 'YubiKey 5 Nano', short: '5 Nano', connector: 'USB-A · Nano' },
  CN: { name: 'YubiKey 5C Nano', short: '5C Nano', connector: 'USB-C · Nano' },
  CK: { name: 'YubiKey 5C', short: '5C', connector: 'USB-C' },
  CI: { name: 'YubiKey 5Ci', short: '5Ci', connector: 'USB-C · Lightning' },
};
export const TEMPLATES: { id: TemplateId; name: string; description: string; icon: string; warning?: string }[] = [
  { id: 'inventory_tray', name: 'Inventory tray', description: 'Flat pockets with finger access', icon: 'tray' },
  { id: 'desktop_dock', name: 'Desktop dock', description: 'Upright sockets in a solid base', icon: 'dock', warning: 'Desktop dock fit is still being refined. Keys may sit too tight or too loose in their sockets, so print a small dock with one key before a full organizer.' },
];
// Saved projects and imports from retired organizer types keep their keys and
// open as inventory trays instead of making the whole project list unreadable.
const RETIRED_TEMPLATES = ['modular_rail', 'grid_organizer', 'travel_case', 'key_fit_tester', 'interface_tests'];
export const MAX_SLOTS = 48;
/** Front text (tray front edge, dock front) size: percent of the largest text that fits the wall.
 * Projects saved without it keep the original size (3.1 mm, smaller only when it doesn't fit). */
export const FRONT_TEXT_PERCENT = { min: 20, max: 100, tray: 50, dock: 30 } as const;
export const STORAGE_KEY = 'yubikey-organizer.project.v1';
export const DISPLAY_KEY = 'yubikey-organizer.display.v1';
export function createSlot(type: KeyType): Slot {
  return { id: crypto.randomUUID(), type, label: KEY_CATALOG[type].short, occupied: true };
}
export function defaultConfig(): HolderConfig {
  return {
    version: 1, template: 'inventory_tray', slots: KEY_TYPES.map(createSlot), labels: true, labelSize: 2.7,
    options: {
      // New designs start at the minimum spacing; projects keep what they saved.
      dock: { columns: 0, spacing: 22, rowSpacing: 18, edgeMargin: 12, depthMargin: 18, height: 13, title: 'KEY DOCK', titlePercent: FRONT_TEXT_PERCENT.dock },
      tray: { columns: 0, spacing: 24, rowGap: 2, margin: 5, height: 8.6, scoop: 'default', retention: false, connection: 'none', slideDirection: 'left', sideText: '', sideTextPercent: FRONT_TEXT_PERCENT.tray, lid: false, lidStyle: 'regular', lidText: '', lidTextSize: 6, lidTextPercent: 100, lidTextRotation: 0, footprint: null },
    },
  };
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value as Record<string, unknown>;
}
function bool(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be on or off.`);
  return value;
}
function number(value: unknown, name: string, min: number, max: number, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${name} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
  }
  return value;
}
function choice<T extends string>(value: unknown, allowed: readonly T[], name: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`${name} is not supported.`);
  return value as T;
}
export function validateText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length > max) throw new Error(`${name} must be at most ${max} characters.`);
  if (!/^[\u0020-\u024f\u0370-\u052f]*$/u.test(value)) throw new Error(`${name} supports Latin, Greek, and Cyrillic letters, numbers, and punctuation.`);
  return value;
}
export function validateConfig(value: unknown): HolderConfig {
  const c = object(value, 'Project');
  if (c.version !== 1) throw new Error('This project version is not supported. Expected version 1.');
  const o = object(c.options, 'Options');
  const d = object(o.dock, 'Dock options');
  const t = object(o.tray, 'Tray options');
  const footprint = t.footprint == null ? null : object(t.footprint, 'Locked tray dimensions');
  const rotation = t.lidTextRotation === undefined ? undefined : number(t.lidTextRotation, 'Lid text rotation', 0, 270, true);
  if (rotation !== undefined && rotation % 90 !== 0) throw new Error('Lid text rotation must be 0, 90, 180, or 270 degrees.');
  // Keep each supported interface distinct. Retired actuated locks retain the
  // established snap-fit migration; never silently convert a saved joint to H20.
  const oldStackable = t.stackable === undefined ? false : bool(t.stackable, 'Stackable tray');
  const oldLocking = t.locking === undefined ? false : bool(t.locking, 'Tray locking');
  const oldConnection = t.connection === undefined
    ? (oldStackable || (oldLocking && t.lid === true) ? 'snap_fit' : 'none')
    : choice(t.connection, ['none', 'stackable', 'slide_lock', 'snap_fit', 'h20_slide_v7'], 'Tray connection');
  const connection = oldConnection === 'slide_lock' ? 'snap_fit' : oldConnection;
  if (t.lockStyle !== undefined) choice(t.lockStyle, ['button', 'side_clips', 'captive_button'], 'Tray lock mechanism');
  const template = typeof c.template === 'string' && RETIRED_TEMPLATES.includes(c.template) ? 'inventory_tray' : c.template;
  if (!Array.isArray(c.slots) || c.slots.length > MAX_SLOTS) throw new Error(`A project may contain up to ${MAX_SLOTS} keys.`);
  const ids = new Set<string>();
  const slots = c.slots.map((v, i): Slot => {
    const s = object(v, `Key ${i + 1}`);
    if (typeof s.id !== 'string' || !/^[\w-]{1,80}$/.test(s.id) || ids.has(s.id)) throw new Error('Key IDs must be unique, non-empty letters, numbers, or hyphens.');
    ids.add(s.id);
    return { id: s.id, type: choice(s.type, KEY_TYPES, 'Key type'), label: validateText(s.label, 'Key label', 18), occupied: bool(s.occupied, 'Key visibility') };
  });
  return {
    version: 1,
    template: choice(template, TEMPLATES.map(t => t.id), 'Template'), slots, labels: bool(c.labels, 'Labels'),
    labelSize: number(c.labelSize === undefined ? 2.7 : c.labelSize, 'Key label size', 1.5, 4),
    options: {
      dock: {
        columns: number(d.columns, 'Dock columns', 0, 6, true), spacing: number(d.spacing, 'Dock spacing', 22, 40),
        rowSpacing: number(d.rowSpacing === undefined ? 45 : d.rowSpacing, 'Dock row spacing', 18, 70),
        edgeMargin: number(d.edgeMargin === undefined ? 18 : d.edgeMargin, 'Dock side margin', 12, 40),
        depthMargin: number(d.depthMargin === undefined ? 22.5 : d.depthMargin, 'Dock depth margin', 18, 45),
        height: number(d.height, 'Dock height', 11, 25), title: validateText(d.title, 'Dock title', 32),
        ...(d.titlePercent !== undefined ? { titlePercent: number(d.titlePercent, 'Dock title percentage', FRONT_TEXT_PERCENT.min, FRONT_TEXT_PERCENT.max) } : {}),
      },
      tray: {
        columns: number(t.columns, 'Tray columns', 0, 6, true), spacing: number(t.spacing, 'Tray spacing', 24, 42),
        rowGap: number(t.rowGap === undefined ? 4 : t.rowGap, 'Space between tray rows', 2, 40),
        margin: number(t.margin, 'Tray margin', 5, 20), height: number(t.height === undefined ? 8.6 : t.height, 'Tray height', 8.6, 20),
        scoop: choice(t.scoop, ['small', 'default', 'large'], 'Finger scoop'),
        // Projects saved before the option existed were printed with retention tabs.
        retention: bool(t.retention === undefined ? true : t.retention, 'Key retention'),
        connection,
        slideDirection: choice(t.slideDirection === undefined ? 'left' : t.slideDirection, ['left', 'right', 'front', 'back'], 'Slide-lock direction'),
        sideText: validateText(t.sideText === undefined ? '' : t.sideText, 'Side text', 32),
        ...(t.sideTextPercent !== undefined ? { sideTextPercent: number(t.sideTextPercent, 'Side text percentage', FRONT_TEXT_PERCENT.min, FRONT_TEXT_PERCENT.max) } : {}),
        lid: bool(t.lid === undefined ? false : t.lid, 'Tray lid'),
        lidStyle: choice(t.lidStyle === undefined ? 'regular' : t.lidStyle, ['regular', 'minimal'], 'Tray lid style'),
        lidText: validateText(t.lidText === undefined ? '' : t.lidText, 'Tray lid text', 32),
        lidTextSize: number(t.lidTextSize === undefined ? 6 : t.lidTextSize, 'Tray lid text size', 2, 100),
        // Keep legacy millimeter sizing until the renderer reports its exact
        // percentage from the bundled font. No approximate font migration.
        ...(t.lidTextPercent !== undefined ? { lidTextPercent: number(t.lidTextPercent, 'Lid text percentage', 0.1, 100) } : {}),
        ...(rotation !== undefined ? { lidTextRotation: rotation as 0 | 90 | 180 | 270 } : {}),
        footprint: footprint ? { width: number(footprint.width, 'Tray width', 20, 1000), depth: number(footprint.depth, 'Tray depth', 20, 6000) } : null,
      },
    },
  };
}
export function parseConfig(text: string): HolderConfig {
  if (text.length > 256_000) throw new Error('This file is too large for an organizer configuration.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('This file is not valid JSON. Choose an exported organizer project.'); }
  return validateConfig(value);
}
export function serializeConfig(config: HolderConfig): string { return JSON.stringify(validateConfig(config), null, 2) + '\n'; }
export function moveSlot(config: HolderConfig, from: number, to: number): HolderConfig {
  if (from < 0 || to < 0 || from >= config.slots.length || to >= config.slots.length || from === to) return config;
  const next = structuredClone(config);
  const [slot] = next.slots.splice(from, 1);
  next.slots.splice(to, 0, slot);
  return next;
}
