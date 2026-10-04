import { describe, expect, it } from 'vitest';
import { createSlot, defaultConfig, MAX_LAYERS, parseConfig, validateConfig } from '../src/config';
import { appendLayer, moveLayer, projectLayers, removeLayer, replaceLayer, withLayers } from '../src/layers';
import { buildProject, compactTray, inventoryTrayLayout, traySlotEnvelope, trayStackPitch } from '../src/geometry';
import { buildTraySet, buildTrayItem, traySetItems, selectTrayParts, traySetLayout, resolvedTrayLayers } from '../src/geometry/layers';
import { projectFileText } from '../src/export';
import { createMemoryStorage, createProject, duplicateProject, fingerprint, getProject, importProject, LEGACY_KEYS, MIGRATION_KEY, migrateLegacyStorage, ProjectSession } from '../src/projects';
import type { HolderConfig } from '../src/types';

function tray(): HolderConfig {
  const c = defaultConfig();
  c.slots = [createSlot('A'), createSlot('C'), createSlot('CN'), createSlot('CI')];
  c.slots[1].rotation = 90;
  c.slots[3].rotation = 90;
  Object.assign(c.options.tray, { footprint: { width: 230, depth: 130 }, connection: 'stackable', lid: true });
  return c;
}
function set(): HolderConfig {
  return appendLayer(tray(), 0, { footprint: { width: 230, depth: 130 }, duplicate: true });
}

describe('tray set persistence', () => {
  it('opens old files as one layer and round-trips an entire set through JSON, storage, duplicate and import', () => {
    expect(projectLayers(defaultConfig())).toHaveLength(1);
    const project = set(), store = createMemoryStorage();
    const saved = createProject(store, { config: project, name: 'Keys' });
    expect(getProject(store, saved.id)!.config).toEqual(project);
    expect(parseConfig(projectFileText(project))).toEqual(project);
    expect(importProject(store, projectFileText(project, 'Keys')).config).toEqual(project);
    expect(duplicateProject(store, saved.id).config).toEqual(project);
    expect(project.layers![0].config.slots[1].rotation).toBe(90);
    expect(project.options.tray.lid).toBe(false);
    expect(project.layers![0].config.options.tray.lid).toBe(true);
  });
  it('keeps unrelated layer edits when autosaving and handles a remote edit to the whole set', () => {
    const store = createMemoryStorage(), record = createProject(store, { config: set() });
    const a = new ProjectSession(store, record), b = new ProjectSession(store, record);
    const upper = structuredClone(projectLayers(a.config)[1].config);
    upper.slots[0].label = 'Backup';
    a.edit(replaceLayer(a.config, 1, upper)); a.flush(); b.sync();
    const lower = structuredClone(projectLayers(b.config)[0].config);
    lower.slots[1].rotation = 0;
    b.edit(replaceLayer(b.config, 0, lower)); b.flush(); a.sync();
    expect(a.config.layers![0].config.slots[0].label).toBe('Backup');
    expect(a.config.slots[1].rotation).toBe(0);
    a.dispose(); b.dispose();
  });
  it('shares frame edits but keeps keys, labels and other layer settings independent', () => {
    const project = set(), next = structuredClone(projectLayers(project)[1].config);
    next.options.tray.footprint = { width: 240, depth: 140 };
    next.options.tray.connection = 'h20_slide_v7'; next.options.tray.slideDirection = 'back';
    next.options.tray.height = 12; next.slots[0].label = 'Upper';
    const changed = replaceLayer(project, 1, next);
    expect(changed.options.tray).toMatchObject({ footprint: { width: 240, depth: 140 }, connection: 'h20_slide_v7', slideDirection: 'back', height: 12 });
    expect(changed.slots[0].label).not.toBe('Upper');
    expect(project.options.tray.connection).toBe('stackable');
    const reordered = withLayers(projectLayers(changed).reverse());
    expect(reordered.slots[0].label).toBe('Upper');
    expect(reordered.layerName).toBe('Layer 2');
    expect(withLayers(projectLayers(reordered).slice(1)).layers).toBeUndefined();
  });
  it('rejects nested, invalid, over-limit and dock layers without losing them silently', () => {
    const c = set();
    const bad = (config: unknown) => ({ ...c, layers: [{ name: 'Bad', config }] });
    expect(() => validateConfig(bad(c))).toThrow('another tray set');
    expect(() => validateConfig(bad({ ...tray(), template: 'desktop_dock' }))).toThrow('only available');
    expect(() => validateConfig({ ...c, layers: Array(MAX_LAYERS).fill(c.layers![0]) })).toThrow('layers');
    expect(() => validateConfig({ ...c, layers: [{ ...c.layers![0], name: ' ' }] })).toThrow('layer name');
    expect(() => withLayers([])).toThrow('at least one');
  });
  it('preserves every tray in prototype traySet files and storage migration', () => {
    const original = set(), layers = projectLayers(original);
    const legacy = { version: 1, config: layers[1].config, traySet: { activeLayerId: 'upper', layers: layers.map((l, i) => ({ ...l, id: i ? 'upper' : 'lower' })) } };
    expect(parseConfig(JSON.stringify(legacy))).toEqual(original);
    const store = createMemoryStorage();
    const raw = JSON.stringify({ version: 1, projects: [{ ...legacy, id: 'old', name: 'Old set' }] });
    store.setItem(LEGACY_KEYS.projects, raw);
    migrateLegacyStorage(store);
    expect(getProject(store, 'old')!.config).toEqual(original);
    expect(store.getItem(LEGACY_KEYS.projects)).toBe(raw);
    expect(migrateLegacyStorage(store).ran).toBe(false);
  });
  it('repairs an untouched earlier single-tray import without duplicating the project', () => {
    const store = createMemoryStorage(), config = tray();
    const saved = createProject(store, { config, name: 'Prototype' });
    const full = set();
    const legacy = { ...saved, traySet: { layers: projectLayers(full) } };
    const raw = JSON.stringify({ version: 1, projects: [legacy] });
    store.setItem(LEGACY_KEYS.projects, raw);
    store.setItem(MIGRATION_KEY, JSON.stringify({ version: 1, firstRunAt: saved.createdAt, lastRunAt: saved.updatedAt,
      sources: { [LEGACY_KEYS.projects]: fingerprint(raw), [LEGACY_KEYS.draft]: '-', [LEGACY_KEYS.config]: '-', [LEGACY_KEYS.activeProject]: '-' }, seen: [], importedIds: [saved.id] }));
    const result = migrateLegacyStorage(store);
    expect(result.imported.map(p => p.id)).toEqual([saved.id]);
    expect(getProject(store, saved.id)!.config).toEqual(full);
  });
});

describe('set geometry', () => {
  it('lays more than three trays and the lid in one nonoverlapping row without altering printable solids', () => {
    let project = set();
    for (let i = 0; i < 3; i++) project = appendLayer(project, 0, { footprint: { width: 230, depth: 130 }, duplicate: true });
    const geometry = buildTraySet(project);
    const layers = resolvedTrayLayers(project);
    const positions = geometry.parts.map(part => part.position.map((v, i) => v + part.explode[i]));
    expect(positions.map(p => p[1])).toEqual(Array(6).fill(0));
    for (let i = 1; i < positions.length; i++) expect(positions[i][0] - positions[i - 1][0]).toBeGreaterThan(230);
    for (const [i, layer] of layers.entries()) {
      const local = buildProject(layer.config);
      for (const part of local.parts) expect(geometry.parts.find(p => p.id === `layer-${i + 1}-${part.id}`)?.scad).toBe(part.scad);
    }
  });
  it('keeps printable parts separate, positions all layers and makes keys follow their own tray when exploded', () => {
    const c = set(), g = buildTraySet(c), lower = buildProject(projectLayers(c)[0].config);
    expect(g.parts.map(p => p.id)).toEqual(['layer-1-tray', 'layer-2-tray', 'layer-2-tray-lid']);
    expect(g.parts[0].scad).toBe(lower.parts[0].scad);
    expect(g.parts[1].position[2]).toBe(trayStackPitch(c.options.tray.height, c.options.tray.retention));
    expect(new Set(g.keys.map(k => k.slotId)).size).toBe(8);
    for (const k of g.keys) expect(g.parts.some(p => p.id === k.partId)).toBe(true);
    for (const p of g.parts.filter(p => p.id.endsWith('-tray'))) expect(p.position[2] + p.explode[2]).toBe(0);
    expect(buildProject(projectLayers(c)[1].config).parts).toHaveLength(2);
  });
  it('renders an empty fixed layer and identifies the layer that cannot fit', () => {
    const c = appendLayer(tray(), 0, { footprint: { width: 230, depth: 130 } });
    expect(buildTraySet(c).parts).toHaveLength(3);
    c.layers![0].config.slots = [createSlot('C')];
    c.slots = [];
    c.options.tray.footprint = { width: 20, depth: 20 };
    expect(() => buildTraySet(c)).toThrow('Layer 2: These keys');
  });
  it('rejects a connector frame that is too small even before keys are added', () => {
    const c = defaultConfig(); c.slots = [];
    Object.assign(c.options.tray, { connection: 'h20_slide_v7', footprint: { width: 20, depth: 20 } });
    expect(() => buildProject(c)).toThrow('This tray connection needs at least 40 × 28 mm');
  });
});

describe('lid stays above the tray stack', () => {
  const lidSettings = { lid: true, lidStyle: 'minimal' as const, lidText: 'TOP', lidTextSize: 8, lidTextPercent: 65, lidTextRotation: 90 as const };
  const withLid = () => {
    const c = set();
    Object.assign(c.layers![0].config.options.tray, lidSettings);
    return c;
  };
  const expectTopLid = (config: HolderConfig) => {
    const layers = projectLayers(config);
    expect(layers.map(layer => layer.config.options.tray.lid)).toEqual(layers.map((_, i) => i === layers.length - 1));
    expect(layers.at(-1)!.config.options.tray).toMatchObject(lidSettings);
  };

  it('reorders trays without losing their contents, shared size, or top lid', () => {
    const original = appendLayer(withLid(), 0, { footprint: { width: 230, depth: 130 }, duplicate: true });
    const before = structuredClone(original), layers = projectLayers(original);
    for (let from = 0; from < 3; from++) for (let to = 0; to < 3; to++) {
      const moved = moveLayer(original, from, to);
      const expected = [...layers]; expected.splice(to, 0, expected.splice(from, 1)[0]);
      const actual = projectLayers(parseConfig(projectFileText(moved)));
      expect(actual.map(l => [l.name, l.config.slots])).toEqual(expected.map(l => [l.name, l.config.slots]));
      expect(actual.map(l => l.config.options.tray.footprint)).toEqual(layers.map(l => l.config.options.tray.footprint));
      expectTopLid(moved);
    }
    expect(moveLayer(original, 0, -1)).toBe(original);
    expect(moveLayer(original, 2, 3)).toBe(original);
    expect(original).toEqual(before);
  });

  it('keeps the complete lid on top when any tray is moved, added or duplicated', () => {
    const original = withLid(), before = structuredClone(original);
    const reordered = withLayers(projectLayers(original).reverse());
    expect(reordered.layerName).toBe('Layer 2');
    expectTopLid(reordered);
    for (const duplicate of [false, true]) for (const source of [0, 1]) {
      const added = appendLayer(reordered, source, { footprint: { width: 230, depth: 130 }, duplicate });
      expect(projectLayers(added)).toHaveLength(3);
      expectTopLid(added);
      expectTopLid(parseConfig(projectFileText(added)));
    }
    expect(original).toEqual(before);
  });

  it('retains the lid after removing either tray, with storage and undo preserving it', () => {
    const original = withLid(), before = structuredClone(original);
    for (const index of [0, 1]) {
      const store = createMemoryStorage(), record = createProject(store, { config: original });
      const session = new ProjectSession(store, record);
      const removed = removeLayer(original, index);
      expect(projectLayers(removed)).toHaveLength(1);
      expectTopLid(removed);
      session.edit(removed); session.flush();
      expectTopLid(getProject(store, record.id)!.config);
      session.edit(original); session.flush();
      expect(getProject(store, record.id)!.config).toEqual(original);
      session.dispose();
    }
    expect(original).toEqual(before);
    expect(() => removeLayer(tray(), 0)).toThrow('at least one');
    expect(() => removeLayer(original, 5)).toThrow('no longer exists');
  });

  it('normalizes older files with a buried lid without adding another lid or losing text settings', () => {
    const old = withLid();
    Object.assign(old.options.tray, lidSettings);
    old.layers![0].config.options.tray.lid = false;
    delete old.options.tray.lidTextPercent;
    delete old.options.tray.lidTextRotation;
    const before = structuredClone(old), parsed = parseConfig(JSON.stringify(old));
    expect(parsed.options.tray.lid).toBe(false);
    expect(parsed.layers![0].config.options.tray).toMatchObject({ lid: true, lidStyle: 'minimal', lidText: 'TOP', lidTextSize: 8 });
    expect(parsed.layers![0].config.options.tray).not.toHaveProperty('lidTextPercent');
    expect(parsed.layers![0].config.options.tray).not.toHaveProperty('lidTextRotation');
    expect(parseConfig(projectFileText(parsed))).toEqual(parsed);
    expect(traySetItems(old).map(item => item.kind)).toEqual(['tray', 'tray', 'lid']);
    expect(old).toEqual(before);
    const multiple = withLid(); multiple.options.tray.lid = true; multiple.options.tray.lidText = 'Old lower lid';
    expectTopLid(validateConfig(multiple));
    expect(validateConfig(multiple).options.tray.lidText).toBe('Old lower lid');
  });

  it.each(['none', 'stackable', 'h20_slide_v7'] as const)('previews and exports exactly one top lid for %s after reordering', connection => {
    const original = withLid(); original.options.tray.connection = connection;
    const reordered = withLayers(projectLayers(original).reverse());
    const geometry = buildTraySet(reordered), top = projectLayers(reordered).at(-1)!.config;
    expect(geometry.parts.map(part => part.id)).toEqual(['layer-1-tray', 'layer-2-tray', 'layer-2-tray-lid']);
    const lid = geometry.parts[2], localLid = buildProject(top).parts.find(part => part.id === 'tray-lid')!;
    expect(lid.position[2]).toBeCloseTo(geometry.parts[1].position[2] + localLid.position[2]);
    expect(lid.position[2]).toBeGreaterThan(geometry.parts[1].position[2]);
    expect(lid.scad).toBe(localLid.scad);
    expect(buildTrayItem(reordered, 1, true).parts[0].scad).toBe(lid.scad);
  });
});

describe('mixed pocket rotation', () => {
  it('preserves default orientation, rejects invalid angles, and ignores flat rotation in docks', () => {
    const c = tray();
    expect(validateConfig(c).slots[1].rotation).toBe(90);
    expect(() => validateConfig({ ...c, slots: [{ ...c.slots[0], rotation: 45 }] })).toThrow('Key rotation');
    c.template = 'desktop_dock';
    const before = buildProject(c);
    c.slots.forEach(s => { s.rotation = 0; });
    expect(buildProject(c)).toEqual(before);
  });
  it('rotates reference keys about each pocket center and includes every angle in printable SCAD', () => {
    const c = tray(), t = inventoryTrayLayout(c), g = buildProject(c);
    expect(g.keys[1].rotation[2]).toBe(Math.PI / 2);
    expect(g.keys[1].position[0]).toBeCloseTo(t.xy[1][0] + 22.5);
    expect(g.keys[1].position[1]).toBeCloseTo(t.xy[1][1]);
    expect(g.parts[0].scad.split('\n').at(-2)).toContain('rotations=[0,90,0,90]');
  });
  it('reserves nonoverlapping envelopes and frame clearance for mixed types, labels, retention and row counts', () => {
    for (const columns of [1, 2, 3, 6]) for (const retention of [false, true]) for (const labelSize of [1.5, 4]) {
      const c = defaultConfig();
      c.slots = [...c.slots, ...c.slots.map(s => ({ ...s, id: s.id + '-2' }))];
      c.slots.forEach((s, i) => { s.rotation = i % 2 ? 90 : 0; });
      Object.assign(c.options.tray, { columns, retention, spacing: 24, scoop: 'large' }); c.labelSize = labelSize;
      const t = inventoryTrayLayout(c);
      const boxes = c.slots.map((s, i) => { const e = traySlotEnvelope(c, s); return { minX: t.xy[i][0] + e.minX, maxX: t.xy[i][0] + e.maxX, minY: t.xy[i][1] + e.minY, maxY: t.xy[i][1] + e.maxY }; });
      for (const [i, a] of boxes.entries()) {
        expect(a.minX).toBeGreaterThanOrEqual(-t.width / 2 + 5 - 1e-8);
        expect(a.maxX).toBeLessThanOrEqual(t.width / 2 - 5 + 1e-8);
        expect(a.minY).toBeGreaterThanOrEqual(-t.depth / 2 + 5 - 1e-8);
        expect(a.maxY).toBeLessThanOrEqual(t.depth / 2 - 5 + 1e-8);
        for (const b of boxes.slice(i + 1)) expect(a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY).toBe(true);
      }
    }
  });
});

describe('shared automatic footprint and compact packing', () => {
  it('fits every layer, including a blank tray, and keeps the automatic choice through JSON', () => {
    const c = defaultConfig(); c.slots = [createSlot('CN')]; c.options.tray.connection = 'h20_slide_v7';
    let project = appendLayer(c, 0, { footprint: { width: 80, depth: 80 } });
    const upper = projectLayers(project)[1].config;
    upper.slots = [createSlot('A'), createSlot('C'), createSlot('CI')];
    upper.options.tray.columns = 1;
    project = replaceLayer(project, 1, upper);
    project = appendLayer(project, 1, { footprint: { width: 80, depth: 80 } });
    const layout = traySetLayout(project), layers = resolvedTrayLayers(parseConfig(projectFileText(project)));
    expect(projectLayers(project).every(l => l.config.options.tray.footprint === null)).toBe(true);
    expect(layout.requiredDepth).toBeGreaterThan(180);
    expect(layers.map(l => l.config.options.tray.footprint)).toEqual(Array(3).fill({ width: layout.width, depth: layout.depth }));
    expect(buildTraySet(project).parts).toHaveLength(3);
    const smaller = structuredClone(projectLayers(project)[0].config);
    smaller.options.tray.footprint = { width: layout.width, depth: layout.depth - 10 };
    expect(traySetLayout(replaceLayer(project, 0, smaller)).tooSmall).toBe(true);
  });
  it('uses minimum defaults for a new layer and preserves selected settings only when duplicating', () => {
    const c = tray(); Object.assign(c.options.tray, { spacing: 40, rowGap: 30, margin: 18, retention: true });
    const blank = projectLayers(appendLayer(c, 0, { footprint: { width: 230, depth: 130 } }))[1].config;
    expect(blank.options.tray).toMatchObject({ spacing: 24, rowGap: 2, margin: 5, retention: false, connection: 'stackable', footprint: c.options.tray.footprint });
    const copy = projectLayers(appendLayer(c, 0, { footprint: { width: 230, depth: 130 }, duplicate: true }))[1].config;
    expect(copy.options.tray).toMatchObject({ spacing: 40, rowGap: 30, margin: 18, retention: true });
    expect(c.options.tray.lid).toBe(true);
  });
  it('uses the root frame for legacy inconsistent layer settings, including after reordering', () => {
    const c = set();
    c.layers![0].config.options.tray.footprint = null;
    c.layers![0].config.options.tray.connection = 'none';
    expect(projectLayers(c)[1].config.options.tray.footprint).toEqual(c.options.tray.footprint);
    expect(withLayers(projectLayers(c).reverse()).options.tray.connection).toBe('stackable');
  });
  it('reduces occupied area with mixed orientations and preserves every key and its label', () => {
    const c = defaultConfig();
    const before = inventoryTrayLayout(c), next = compactTray(c), after = inventoryTrayLayout(next);
    expect(after.requiredWidth * after.requiredDepth).toBeLessThan(before.requiredWidth * before.requiredDepth * .85);
    expect(new Set(next.slots.map(s => s.rotation ?? 0)).size).toBe(2);
    expect(next.slots.map(({ rotation, ...s }) => s)).toEqual(c.slots);
    expect(validateConfig(next)).toEqual(next);
    expect(buildProject(parseConfig(projectFileText(next))).parts[0].scad).toBe(buildProject(next).parts[0].scad);
  });
  it('keeps pockets, labels, scoops and retention clear for crowded rotated layouts', () => {
    for (const count of [6, 13, 48]) for (const retention of [false, true]) {
      const c = defaultConfig();
      c.slots = Array.from({ length: count }, (_, i) => createSlot(['A', 'C', 'AN', 'CN', 'CK', 'CI'][i % 6] as 'A'));
      Object.assign(c.options.tray, { arrangement: 'compact', retention, scoop: 'large' }); c.labelSize = 4;
      c.slots.forEach((s, i) => { s.rotation = i % 2 ? 90 : 0; });
      const t = inventoryTrayLayout(c);
      const boxes = c.slots.map((s, i) => { const e = traySlotEnvelope(c, s); return { x: t.xy[i][0] + e.minX, right: t.xy[i][0] + e.maxX, y: t.xy[i][1] + e.minY, back: t.xy[i][1] + e.maxY }; });
      for (const [i, a] of boxes.entries()) {
        expect(a.x + t.width / 2).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(t.width / 2 - a.right).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(a.y + t.depth / 2).toBeGreaterThanOrEqual(5 - 1e-7);
        expect(t.depth / 2 - a.back).toBeGreaterThanOrEqual(5 - 1e-7);
        for (const b of boxes.slice(i + 1)) expect(a.right + 2 <= b.x + 1e-7 || b.right + 2 <= a.x + 1e-7 || a.back + 2 <= b.y + 1e-7 || b.back + 2 <= a.y + 1e-7).toBe(true);
      }
    }
  });
});

describe('independent tray and lid items', () => {
  it('lists lids separately and isolates each preview without changing printable geometry', () => {
    const c = set(), before = structuredClone(c), full = buildTraySet(c);
    const items = traySetItems(c);
    expect(items.map(i => [i.id, i.kind, i.layerIndex])).toEqual([
      ['layer-1-tray', 'tray', 0], ['layer-2-tray', 'tray', 1], ['layer-2-tray-lid', 'lid', 1],
    ]);
    for (const item of items) {
      const view = buildTrayItem(c, item.layerIndex, item.kind === 'lid');
      expect(view.parts).toHaveLength(1);
      expect(view.parts[0].scad).toBe(full.parts.find(p => p.id === item.id)!.scad);
      expect(view.parts[0].explode).toEqual([0, 0, 0]);
      expect(view.keys.length).toBe(item.kind === 'lid' ? 0 : 4);
    }
    expect(c).toEqual(before);
    expect(traySetItems(tray()).map(i => i.id)).toEqual(['tray', 'tray-lid']);
  });
  it('selects nonadjacent trays or the lid alone without changing their shared footprint', () => {
    const c = set(), full = buildTraySet(c);
    const lid = selectTrayParts(full, new Set(['layer-2-tray-lid']));
    expect(lid.parts).toEqual([full.parts[2]]);
    expect(lid.keys).toEqual([]);
    const mixed = selectTrayParts(full, new Set(['layer-1-tray', 'layer-2-tray-lid']));
    expect(mixed.parts).toEqual([full.parts[0], full.parts[2]]);
    expect(mixed.keys.map(k => k.partId)).toEqual(Array(4).fill('layer-1-tray'));
    expect(selectTrayParts(full, new Set()).parts).toEqual([]);
    expect(selectTrayParts(full, new Set(full.parts.map(p => p.id)))).toEqual(full);
  });
});
