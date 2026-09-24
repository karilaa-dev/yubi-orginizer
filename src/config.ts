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
export const TEMPLATES: { id: TemplateId; name: string; description: string; icon: string }[] = [
  { id: 'desktop_dock', name: 'Desktop dock', description: 'Upright sockets in a solid base', icon: 'dock' },
  { id: 'modular_rail', name: 'Cartridge rail', description: 'Sliding, individual key holders', icon: 'rail' },
  { id: 'inventory_tray', name: 'Inventory tray', description: 'Flat pockets with finger access', icon: 'tray' },
  { id: 'grid_organizer', name: 'Gridfinity organizer', description: 'Modular 2 × 2 storage tiles', icon: 'grid' },
  { id: 'travel_case', name: 'Travel case', description: 'Removable insert and lift-off lid', icon: 'case' },
  { id: 'key_fit_tester', name: 'Key fit tester', description: 'Compare USB socket fits before printing', icon: 'usb' },
  { id: 'interface_tests', name: 'Mechanical fit tests', description: 'Rail, lid, tray lock, and Gridfinity tests', icon: 'ruler' },
];
export const isTestTemplate = (template: TemplateId): boolean => template === 'key_fit_tester' || template === 'interface_tests';
export const SOCKET_PROFILES = [
  { id: 'A', name: 'USB-A', models: '5 NFC · Security Key NFC' },
  { id: 'C', name: 'USB-C', models: '5C NFC · 5C · 5Ci · Security Key C NFC' },
  { id: 'AN', name: 'USB-A Nano', models: '5 Nano' },
  { id: 'CN', name: 'USB-C Nano', models: '5C Nano' },
] as const;
export const MAX_SLOTS = 48;
export const STORAGE_KEY = 'yubikey-organizer.project.v1';
export const DISPLAY_KEY = 'yubikey-organizer.display.v1';
export function createSlot(type: KeyType): Slot {
  return { id: crypto.randomUUID(), type, label: KEY_CATALOG[type].short, occupied: true };
}
export function defaultConfig(): HolderConfig {
  return {
    version: 1, template: 'desktop_dock', slots: KEY_TYPES.map(createSlot), labels: true, labelSize: 2.7,
    options: {
      dock: { columns: 0, spacing: 26, rowSpacing: 45, edgeMargin: 18, depthMargin: 22.5, height: 13, title: 'KEY DOCK' },
      rail: { mountingHoles: true, endMargin: 5 },
      tray: { columns: 0, spacing: 27, rowSpacing: 76, rowGap: 4, margin: 5, height: 8.6, scoop: 'default', retention: true, connection: 'none', sideText: '', lid: false, lidText: '', lidTextSize: 6, lidTextPercent: 100, lidTextRotation: 0, footprint: null },
      grid: { mode: 'mixed', extraHeight: 0 },
      case: { headroom: 0, title: 'SECURITY KEYS' },
      tester: { profile: 'C', startOffset: -0.1, step: 0.1, samples: 3 },
      interfaceTests: { kind: 'all' },
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
  const r = object(o.rail, 'Rail options');
  const t = object(o.tray, 'Tray options');
  const footprint = t.footprint == null ? null : object(t.footprint, 'Locked tray dimensions');
  const rotation = t.lidTextRotation === undefined ? undefined : number(t.lidTextRotation, 'Lid text rotation', 0, 270, true);
  if (rotation !== undefined && rotation % 90 !== 0) throw new Error('Lid text rotation must be 0, 90, 180, or 270 degrees.');
  // Preserve enabled connections from retired projects using the current joint.
  const oldStackable = t.stackable === undefined ? false : bool(t.stackable, 'Stackable tray');
  const oldLocking = t.locking === undefined ? false : bool(t.locking, 'Tray locking');
  const oldConnection = t.connection === undefined
    ? (oldStackable || (oldLocking && t.lid === true) ? 'snap_fit' : 'none')
    : choice(t.connection, ['none', 'stackable', 'slide_lock', 'snap_fit'], 'Tray connection');
  const connection = oldConnection === 'none' ? 'none' : 'snap_fit';
  if (t.lockStyle !== undefined) choice(t.lockStyle, ['button', 'side_clips', 'captive_button'], 'Tray lock mechanism');
  const g = object(o.grid, 'Grid options');
  const k = object(o.case, 'Case options');
  const tester = o.tester === undefined ? { profile: 'C', startOffset: -0.1, step: 0.1, samples: 3 } : object(o.tester, 'Fit tester options');
  const interfaces = o.interfaceTests === undefined ? { kind: 'all' } : object(o.interfaceTests, 'Mechanical test options');
  const samples = number(tester.samples, 'Fit sample count', 3, 5, true);
  if (samples !== 3 && samples !== 5) throw new Error('Choose three or five fit samples.');
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
    template: choice(c.template, TEMPLATES.map(t => t.id), 'Template'), slots, labels: bool(c.labels, 'Labels'),
    labelSize: number(c.labelSize === undefined ? 2.7 : c.labelSize, 'Key label size', 1.5, 4),
    options: {
      dock: {
        columns: number(d.columns, 'Dock columns', 0, 6, true), spacing: number(d.spacing, 'Dock spacing', 22, 40),
        rowSpacing: number(d.rowSpacing === undefined ? 45 : d.rowSpacing, 'Dock row spacing', 18, 70),
        edgeMargin: number(d.edgeMargin === undefined ? 18 : d.edgeMargin, 'Dock side margin', 12, 40),
        depthMargin: number(d.depthMargin === undefined ? 22.5 : d.depthMargin, 'Dock depth margin', 18, 45),
        height: number(d.height, 'Dock height', 11, 25), title: validateText(d.title, 'Dock title', 32),
      },
      rail: { mountingHoles: bool(r.mountingHoles, 'Mounting holes'), endMargin: number(r.endMargin === undefined ? 5 : r.endMargin, 'Rail end margin', 5, 30) },
      tray: {
        columns: number(t.columns, 'Tray columns', 0, 6, true), spacing: number(t.spacing, 'Tray spacing', 24, 42),
        rowSpacing: number(t.rowSpacing === undefined ? 66 + 2 * number(t.margin, 'Tray margin', 5, 20) : t.rowSpacing, 'Tray row spacing', 66, 110),
        rowGap: number(t.rowGap === undefined ? 4 : t.rowGap, 'Space between tray rows', 2, 40),
        margin: number(t.margin, 'Tray margin', 5, 20), height: number(t.height === undefined ? 8.6 : t.height, 'Tray height', 8.6, 20),
        scoop: choice(t.scoop, ['small', 'default', 'large'], 'Finger scoop'),
        retention: bool(t.retention === undefined ? true : t.retention, 'Key retention'),
        connection,
        sideText: validateText(t.sideText === undefined ? '' : t.sideText, 'Side text', 32),
        lid: bool(t.lid === undefined ? false : t.lid, 'Tray lid'),
        lidText: validateText(t.lidText === undefined ? '' : t.lidText, 'Tray lid text', 32),
        lidTextSize: number(t.lidTextSize === undefined ? 6 : t.lidTextSize, 'Tray lid text size', 2, 100),
        // Keep legacy millimeter sizing until the renderer reports its exact
        // percentage from the bundled font. No approximate font migration.
        ...(t.lidTextPercent !== undefined ? { lidTextPercent: number(t.lidTextPercent, 'Lid text percentage', 0.1, 100) } : {}),
        ...(rotation !== undefined ? { lidTextRotation: rotation as 0 | 90 | 180 | 270 } : {}),
        footprint: footprint ? { width: number(footprint.width, 'Tray width', 20, 1000), depth: number(footprint.depth, 'Tray depth', 20, 6000) } : null,
      },
      grid: { mode: choice(g.mode, ['mixed', 'upright', 'flat'], 'Grid storage mode'), extraHeight: number(g.extraHeight === undefined ? 0 : g.extraHeight, 'Grid extra height', 0, 15) },
      case: { headroom: number(k.headroom, 'Case headroom', 0, 15), title: validateText(k.title, 'Lid title', 32) },
      tester: {
        profile: choice(tester.profile, ['A', 'C', 'AN', 'CN'], 'USB socket profile'),
        startOffset: number(tester.startOffset, 'First fit offset', -0.3, 0.3),
        step: number(tester.step, 'Fit offset step', 0.05, 0.2), samples,
      },
      interfaceTests: { kind: choice(interfaces.kind === 'tray_lock' || interfaces.kind === 'tray_clips' || interfaces.kind === 'tray_captive' ? 'tray_snap' : interfaces.kind, ['all', 'rail', 'lid', 'grid', 'tray_snap'], 'Mechanical test') },
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
