import { describe, expect, it } from 'vitest';
import { defaultConfig, KEY_TYPES, parseConfig, serializeConfig } from '../src/config';
import { buildProject, buildTrayH20Test, inventoryTrayLayout, inventoryTraySupports, trayStackGap } from '../src/geometry';
import { H20_V7, h20V7Stations } from '../src/geometry/tray-h20';
import { readDraft, readProjects, saveProject, writeDraft } from '../src/projects';
import { TRAY_SLIDE_DIRECTIONS } from '../src/tray-slide';
import { trayConnectionInstructions } from '../src/export';

function tray() {
  const c = defaultConfig(); c.template = 'inventory_tray';
  Object.assign(c.options.tray, { connection: 'h20_slide_v7', lid: true, columns: 3 });
  return c;
}

describe('three tray types and H20 compatibility', () => {
  it.each(['none', 'stackable', 'h20_slide_v7', 'snap_fit'] as const)('preserves %s through JSON, drafts and named project copies', connection => {
    const c = tray(); c.options.tray.connection = connection;
    expect(parseConfig(serializeConfig(c))).toEqual(c);
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    writeDraft(store, c); expect(readDraft(store)?.config).toEqual(c);
    saveProject(store, c, 'Original'); saveProject(store, c, 'Copy');
    expect(readProjects(store).map(p => p.config)).toEqual([c, c]);
  });
  it('uses the original two-pin coupon datums and refuses degenerate datums', () => {
    expect(h20V7Stations(40, 28)).toEqual({ pins: [[-6, -7], [-6, 7]], guides: [[12, -7, 8], [12, 7, 8]] });
    for (const [w, d] of [[39.99, 28], [40, 27.99], [NaN, 30]]) expect(() => h20V7Stations(w, d)).toThrow();
    expect(buildTrayH20Test().parts).toHaveLength(2);
  });
  it('keeps stations and lids identical across different contents of a locked footprint', () => {
    const c = tray(); c.options.tray.footprint = { width: 160, depth: 180 };
    const before = buildProject(c); const stations = h20V7Stations(...before.dimensions.slice(0, 2) as [number, number]);
    c.slots = c.slots.slice(0, 1); c.slots[0].occupied = false; c.labels = false; c.options.tray.columns = 1;
    expect(buildProject(c).parts[1]).toEqual(before.parts[1]);
    expect(h20V7Stations(...buildProject(c).dimensions.slice(0, 2) as [number, number])).toEqual(stations);
  });
  it.each([true, false])('reserves storage and receiver webs with retention=%s', retention => {
    for (const type of KEY_TYPES) {
      const c = tray(); c.slots = c.slots.filter(s => s.type === type); c.labelSize = 4;
      Object.assign(c.options.tray, { retention, scoop: 'large', height: 8.6, margin: 5 });
      const t = inventoryTrayLayout(c), p = buildProject(c), seat = t.height + trayStackGap(retention);
      expect(t.width).toBeGreaterThanOrEqual(40);
      expect(t.depth).toBeGreaterThanOrEqual(28);
      expect(t.rows[0].minY + t.depth / 2).toBeGreaterThanOrEqual(13 - .005);
      expect(t.depth / 2 - t.rows[0].maxY).toBeGreaterThanOrEqual(13 - .005);
      expect(p.dimensions[2]).toBeCloseTo(seat + H20_V7.lidThickness);
      expect(p.parts[1].position[2]).toBeCloseTo(seat);
      expect(p.parts[1].rotation).toEqual([0, 0, 0]);
      expect(p.parts[1].position[2] + p.parts[1].explode[2]).toBeCloseTo(0);
      c.options.tray.lid = false;
      expect(buildProject(c).dimensions[2]).toBeCloseTo(seat + 4.2);
      c.options.tray.footprint = { width: t.requiredWidth - .01, depth: t.requiredDepth };
      expect(() => buildProject(c)).toThrow('need at least');
      c.options.tray.footprint.width += .02;
      expect(buildProject(c).parts).toHaveLength(1);
    }
  });
  it('keeps sparse supports outside both receiver bands', () => {
    const c = tray(); c.slots = Array.from({ length: 36 }, (_, i) => ({ ...c.slots[i % 6], id: `key-${i}` }));
    c.options.tray.rowGap = 12;
    const t = inventoryTrayLayout(c);
    for (const [, y] of inventoryTraySupports(c)) expect(Math.abs(y) + 2.1).toBeLessThanOrEqual(t.depth / 2 - H20_V7.margin);
    expect(h20V7Stations(t.width, t.depth).pins).toHaveLength(2);
    c.slots = [];
    expect(buildProject(c)).toEqual({ parts: [], keys: [], dimensions: [0, 0, 0] });
  });
  it('keeps non-stackable lid attachment, restores lift-off stacking and separates directions in print notes', () => {
    const c = tray(); c.options.tray.connection = 'none';
    const single = buildProject(c).parts[0].scad.trim().split('\n').at(-1);
    c.options.tray.connection = 'stackable';
    const stack = buildProject(c).parts[0].scad.trim().split('\n').at(-1);
    expect(single).toContain('true,false,'); expect(stack).toContain('true,true,');
    expect(trayConnectionInstructions(c).join(' ')).toContain('Lift straight up');
    c.options.tray.connection = 'h20_slide_v7';
    expect(trayConnectionInstructions(c).join(' ')).toContain('Slide right 6 mm before lifting');
  });
});

describe('slide direction', () => {
  it.each(TRAY_SLIDE_DIRECTIONS)('only reserves receiver space on the working edges for $id', direction => {
    const c = tray(); c.options.tray.slideDirection = direction.id;
    c.options.tray.margin = 5;
    const compact = inventoryTrayLayout(c), compactKeys = buildProject(c).keys;
    c.options.tray.margin = 13;
    const padded = inventoryTrayLayout(c);
    const vertical = direction.angle % 180 !== 0;
    expect(padded.width - compact.width).toBe(vertical ? 0 : 16);
    expect(padded.depth - compact.depth).toBeCloseTo(vertical ? 16 : 0);
    expect(buildProject(c).keys).toEqual(compactKeys);
    c.options.tray.margin = 5;
    c.options.tray.footprint = { width: padded.width, depth: padded.depth };
    expect(inventoryTrayLayout(c)).toMatchObject({ width: padded.width, depth: padded.depth });
  });
  it('defaults older projects to the existing leftward motion and rejects unknown directions', () => {
    const old = JSON.parse(serializeConfig(tray())); delete old.options.tray.slideDirection;
    expect(parseConfig(JSON.stringify(old)).options.tray.slideDirection).toBe('left');
    for (const value of ['up', 90, null, false]) {
      old.options.tray.slideDirection = value;
      expect(() => parseConfig(JSON.stringify(old))).toThrow('Slide-lock direction');
    }
  });
  it.each(TRAY_SLIDE_DIRECTIONS)('keeps $id geometry, matching lids, and saved projects consistent', direction => {
    const c = tray(); c.options.tray.footprint = { width: 180, depth: 210 };
    const keys = buildProject(c).keys;
    c.options.tray.slideDirection = direction.id;
    c.options.tray.lidText = 'Fixed text orientation'; c.options.tray.lidTextRotation = 90;
    const p = buildProject(c);
    expect(parseConfig(serializeConfig(c))).toEqual(c);
    expect(p.keys).toEqual(keys);
    const stations = h20V7Stations(180, 210, direction.id);
    expect(stations.pins).toHaveLength(2); expect(stations.guides).toHaveLength(2);
    expect(p.parts[0].scad.trim().split('\n').at(-1)).toContain(`,true,${direction.angle});`);
    expect(p.parts[1].scad.trim().split('\n').at(-1)).toContain(`,100,90,${direction.angle},"regular");`);
    expect(trayConnectionInstructions(c).join(' ')).toContain(`slide ${direction.lock} until flush`);
    delete c.options.tray.lidTextPercent;
    const legacy = buildProject(c).parts[1].scad.trim().split('\n').at(-1);
    expect(legacy).toContain('inventory_tray_h20_lid_legacy(');
    expect(legacy).toContain(`,6,${direction.angle},"regular");`);
    c.slots = c.slots.slice(0, 1);
    expect(buildProject(c).parts[1]).toEqual(buildProject({ ...c, slots: tray().slots }).parts[1]);
    const data = new Map<string, string>();
    const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
    writeDraft(store, c); saveProject(store, c, direction.label);
    expect(readDraft(store)?.config).toEqual(c); expect(readProjects(store)[0].config).toEqual(c);
  });
  it('rotates asymmetric rectangular stations as one interface', () => {
    expect(h20V7Stations(60, 80, 'front')).toEqual({ pins: [[23, -26], [-23, -26]], guides: [[23, 32, 8], [-23, 32, 8]] });
    expect(h20V7Stations(60, 80, 'back')).toEqual({ pins: [[-23, 26], [23, 26]], guides: [[-23, -32, 8], [23, -32, 8]] });
    expect(h20V7Stations(60, 80, 'right')).toEqual({ pins: [[16, 33], [16, -33]], guides: [[-22, 33, 8], [-22, -33, 8]] });
  });
  it('reserves side receivers beyond labels and retention slots without moving keys', () => {
    const c = tray(); c.slots = c.slots.slice(0, 1);
    const before = inventoryTrayLayout(c);
    c.options.tray.slideDirection = 'front';
    const after = inventoryTrayLayout(c);
    expect(after.xy).toEqual(before.xy);
    expect(after.width / 2 - 11.5).toBeGreaterThanOrEqual(13);
    c.options.tray.footprint = { width: before.width, depth: before.depth };
    expect(() => buildProject(c)).toThrow('need at least');
  });
  it.each(['none', 'stackable', 'snap_fit'] as const)('does not affect %s geometry', connection => {
    const c = tray(); c.options.tray.connection = connection;
    const before = buildProject(c); c.options.tray.slideDirection = 'back';
    expect(buildProject(c)).toEqual(before);
  });
});
