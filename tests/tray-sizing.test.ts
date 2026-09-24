import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig, serializeConfig, validateConfig } from '../src/config';
import { buildProject, inventoryTrayLayout, trayFootprintError } from '../src/geometry';
import { readDraft, writeDraft } from '../src/projects';
import { keyLabelMillimeters, keyLabelPercent, readLegacyLidSize } from '../src/text-size';

function example() {
  const c = defaultConfig(); c.template = 'inventory_tray'; c.slots = c.slots.slice(0, 5);
  Object.assign(c.options.tray, { columns: 3, connection: 'snap_fit', lid: true });
  return c;
}
describe('locked tray footprint', () => {
  it('keeps five-key and two-key layers and lids the same size without moving their sockets by scaling', () => {
    const c = example(), before = buildProject(c), t = inventoryTrayLayout(c);
    c.options.tray.footprint = { width: t.width, depth: t.depth };
    expect(buildProject(c)).toEqual(before);
    c.slots = c.slots.slice(0, 2);
    const locked = buildProject(c), lockedLayout = inventoryTrayLayout(c);
    expect(locked.dimensions).toEqual(before.dimensions);
    expect(locked.parts[1]).toEqual(before.parts[1]);
    c.options.tray.footprint = null;
    expect(buildProject(c).dimensions[0]).toBeLessThan(locked.dimensions[0]);
    expect(buildProject(c).dimensions[1]).toBeLessThan(locked.dimensions[1]);
    expect(inventoryTrayLayout(c).xy).toEqual(lockedLayout.xy);
  });
  it('blocks manufacturing an undersized footprint and recovers when enlarged', () => {
    const c = example(); c.options.tray.footprint = { width: 29, depth: 30 };
    expect(trayFootprintError(c)).toContain('need at least');
    expect(() => buildProject(c)).toThrow('Increase the locked tray dimensions');
    c.options.tray.footprint = { width: 200, depth: 200 };
    expect(trayFootprintError(c)).toBeUndefined();
    expect(buildProject(c).dimensions.slice(0, 2)).toEqual([200, 200]);
  });
  it('preserves a lock through empty selections, text edits and local/configuration round trips', () => {
    const c = example(), store = new Map<string, string>();
    c.options.tray.footprint = { width: 170, depth: 130 };
    c.slots = []; c.options.tray.lidTextPercent = 50; c.options.tray.lidTextRotation = 270;
    expect(parseConfig(serializeConfig(c))).toEqual(c);
    writeDraft({ getItem: k => store.get(k) ?? null, setItem: (k, v) => { store.set(k, v); } }, c);
    expect(readDraft({ getItem: k => store.get(k) ?? null, setItem: () => {} })?.config).toEqual(c);
    expect(inventoryTrayLayout(c)).toMatchObject({ width: 170, depth: 130 });
  });
  it('does not change other organizer dimensions', () => {
    const c = example();
    for (const template of ['desktop_dock', 'travel_case', 'grid_organizer', 'modular_rail'] as const) {
      c.template = template; c.options.tray.footprint = null; const before = buildProject(c);
      c.options.tray.footprint = { width: 300, depth: 400 };
      expect(buildProject(c)).toEqual(before);
    }
  });
  it.each([{}, [], false, '100', { width: 0, depth: 90 }, { width: 90, depth: Infinity }, { width: 90, depth: '100' }])('rejects malformed locked dimensions %j', footprint => {
    const c = example(); Object.assign(c.options.tray, { footprint });
    expect(() => validateConfig(c)).toThrow();
  });
});
describe('percentage text and rotation', () => {
  it.each([1.5, 2.7, 3, 4])('keeps existing key-label manufacturing dimensions %s', size => {
    expect(keyLabelMillimeters(keyLabelPercent(size))).toBeCloseTo(size);
  });
  it.each([0, 90, 180, 270] as const)('round trips %s degree lid text independently of pockets', rotation => {
    const c = example(), before = buildProject(c);
    Object.assign(c.options.tray, { lidTextPercent: 50, lidTextRotation: rotation });
    expect(parseConfig(serializeConfig(c))).toEqual(c);
    const after = buildProject(c);
    expect(after.parts[0]).toEqual(before.parts[0]);
    expect(after.dimensions).toEqual(before.dimensions);
    expect(after.keys).toEqual(before.keys);
    expect(after.parts[1].scad.trim().split('\n').at(-1)).toContain(`,50,${rotation});`);
  });
  it('keeps old millimeter sizing until actual font metrics are available', () => {
    const c = example(); delete c.options.tray.lidTextPercent; delete c.options.tray.lidTextRotation;
    expect(validateConfig(c).options.tray.lidTextPercent).toBeUndefined();
    expect(buildProject(c).parts[1].scad.trim().split('\n').at(-1)).toContain(',6);');
    expect(readLegacyLidSize('ECHO: "KEYFORM_LID_TEXT", [64.6523, 90]')).toEqual({ percent: 64.6523, rotation: 90 });
    expect(readLegacyLidSize('ECHO: "KEYFORM_LID_TEXT", [999, 25]')).toBeUndefined();
    expect(readLegacyLidSize('WARNING: missing font')).toBeUndefined();
  });
  it.each([0, 100.1, NaN, null, '50'])('rejects invalid percentages %s', lidTextPercent => {
    const c = example(); Object.assign(c.options.tray, { lidTextPercent });
    expect(() => validateConfig(c)).toThrow();
  });
  it.each([-90, 45, 360, null, '90'])('rejects unsupported rotation %s', lidTextRotation => {
    const c = example(); Object.assign(c.options.tray, { lidTextRotation });
    expect(() => validateConfig(c)).toThrow();
  });
});
