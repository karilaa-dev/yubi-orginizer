import { describe, expect, it } from 'vitest';
import { defaultConfig, KEY_TYPES, parseConfig, serializeConfig } from '../src/config';
import { buildFitTests, buildProject, inventoryTrayLayout, traySnapEnabled, trayStackGap } from '../src/geometry';
import { TRAY_SNAP } from '../src/geometry/tray-snap';

function tray() {
  const c = defaultConfig(); c.template = 'inventory_tray';
  c.slots = KEY_TYPES.map((type, i) => ({ id: `key-${i}`, type, label: type, occupied: true }));
  Object.assign(c.options.tray, { columns: 3, connection: 'snap_fit', lid: true });
  return c;
}

describe('integral snap-fit tray integration', () => {
  it('exports only the tray and lid with solid catches integral to the frame', () => {
    const c = tray(), p = buildProject(c), t = inventoryTrayLayout(c);
    expect(traySnapEnabled(c)).toBe(true);
    expect(p.parts.map(p => p.id)).toEqual(['tray', 'tray-lid']);
    expect(p.parts[1].position[2]).toBeCloseTo(t.height + trayStackGap(c.options.tray.retention));
    expect(p.parts[1].position[2] + p.parts[1].explode[2]).toBeCloseTo(0);
    expect(p.parts[1].explode[0]).toBeCloseTo(t.width + 8);
    c.options.tray.lid = false;
    expect(buildProject(c).parts.map(p => p.id)).toEqual(['tray']);
    c.slots = []; expect(buildProject(c).parts).toEqual([]);
  });
  it('round trips a matching footprint, labels and the new connection', () => {
    const c = tray(); const t = inventoryTrayLayout(c);
    c.options.tray.footprint = { width: t.width, depth: t.depth };
    const saved = parseConfig(serializeConfig(c));
    expect(buildProject(saved)).toEqual(buildProject(c));
    saved.slots = saved.slots.slice(0, 2);
    expect(buildProject(saved).dimensions.slice(0, 2)).toEqual([t.width, t.depth]);
    expect(inventoryTrayLayout(saved).height).toBe(t.height);
  });
  it('restores the same enclosure geometry after toggling its connection', () => {
    const c = tray(); c.options.tray.connection = 'snap_fit';
    const before = buildProject(c);
    c.options.tray.connection = 'none'; buildProject(c);
    c.options.tray.connection = 'snap_fit';
    expect(buildProject(c)).toEqual(before);
    expect(c.options.tray.height).toBe(8.6);
  });
  it.each(KEY_TYPES)('keeps the %s pocket position and reserves the full perimeter channel', type => {
    const c = tray(); c.slots = [{ id: 'single', type, label: '', occupied: true }];
    c.labels = false; c.options.tray.retention = false;
    const snap = inventoryTrayLayout(c);
    c.options.tray.connection = 'none'; const plain = inventoryTrayLayout(c);
    expect(snap.width).toBeGreaterThanOrEqual(18.6 + 2 * TRAY_SNAP.margin);
    expect(snap.depth).toBeGreaterThanOrEqual(TRAY_SNAP.minimumDepth);
    expect(snap.width).toBeGreaterThanOrEqual(plain.width);
    expect(snap.xy).toEqual(plain.xy);
    expect(snap.height).toBeGreaterThanOrEqual(TRAY_SNAP.minimumHeight);
  });
  it('provides an independent two-part fit test without any keys or loose actuators', () => {
    const p = buildFitTests('tray_snap');
    expect(p.keys).toEqual([]);
    expect(p.parts.map(p => p.id)).toEqual(['fit-tray-snap-lower', 'fit-tray-snap-upper']);
    expect(new Set(buildFitTests('all').parts.map(p => p.id)).size).toBe(7);
  });
});
