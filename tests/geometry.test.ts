import { describe, expect, it } from 'vitest';
import { Matrix4, Euler, Vector3 } from 'three';
import { defaultConfig, isTestTemplate, KEY_TYPES, TEMPLATES } from '../src/config';
import { buildFitTests, buildKeyScad, buildProject, inventoryTrayLayout, inventoryTraySupports, keyDimensions, trayRetentionSpec, trayStackPitch, TRAY_STACK } from '../src/geometry';
import { calibratedLibrary, TRAY_LID } from '../src/geometry/library';
import { TRAY_SNAP } from '../src/geometry/tray-snap';
import profiles from '../src/geometry/profiles/profiles.scad?raw';
import usbC from '../src/geometry/profiles/calibrated_usb_c.scad?raw';
import type { HolderConfig, KeyType } from '../src/types';

const holderTemplates = TEMPLATES.filter((template) => !isTestTemplate(template.id));

function sampleConfig(): HolderConfig {
  const config = defaultConfig();
  config.slots = KEY_TYPES.map((type, i) => ({ id: `sample-${i}`, type, label: type, occupied: true }));
  return config;
}

function sourceCall(source: string): { module: string; args: unknown[] } {
  const last = source.trim().split('\n').at(-1)!;
  const match = /^(\w+)\((.*)\);$/.exec(last)!;
  return { module: match[1], args: JSON.parse(`[${match[2]}]`) as unknown[] };
}

function repeated(count: number, type: KeyType = 'C'): HolderConfig {
  const config = sampleConfig();
  config.slots = Array.from({ length: count }, (_, i) => ({ id: `slot-${i}`, type, label: `Key ${i + 1}`, occupied: true }));
  return config;
}

describe('accepted key fit geometry', () => {
  it('embeds the recovered polygons and final USB-C modules without rescaling or extra clearance', () => {
    expect(calibratedLibrary.startsWith(profiles)).toBe(true);
    expect(calibratedLibrary).toContain(usbC.split('// Examples, separated for preview:')[0]);
    expect(calibratedLibrary).not.toContain('translate([-7,0,0])');
    const scad = buildProject(sampleConfig()).parts[0].scad;
    expect(calibratedLibrary).not.toContain('scale(');
    expect(scad).toContain('linear_extrude(pocket_d(k)+0.15) polygon(body_pts(k))');
    expect(scad).toContain('a_socket(k,socket_d(k))');
    expect(scad).toContain('w=8.300, t=2.560, depth=6.600');
    expect(scad).toContain('w=8.290, t=2.500, depth=4.200');
  });

  it('retains the corrected A socket and the chosen original 5Ci outline', () => {
    const bounds = (name: string) => {
      const match = new RegExp(`^${name} = (\\[.*\\]);$`, 'm').exec(profiles)!;
      const points = JSON.parse(match[1]) as [number, number][];
      return [0, 1].map((axis) => Math.max(...points.map((p) => p[axis])) - Math.min(...points.map((p) => p[axis])));
    };
    expect(bounds('plug_A')[0]).toBeCloseTo(12.06, 4);
    expect(bounds('plug_A')[1]).toBeCloseTo(3.27, 4);
    expect(bounds('plug_AN')).toEqual([12.166, 3.028]);
    expect(bounds('body_CI')[0]).toBeCloseTo(12.96398, 5);
    expect(bounds('body_CI')[1]).toBe(41.6);
  });
  it('uses identical desktop socket geometry for 5C NFC, 5C, and 5Ci while retaining distinct key references', () => {
    const projects = (['C', 'CK', 'CI'] as const).map((type) => {
      const config = repeated(1, type);
      config.labels = false;
      config.options.dock.title = '';
      return buildProject(config);
    });
    expect(new Set(projects.map((p) => p.parts[0].scad)).size).toBe(1);
    expect(projects.map((p) => p.keys[0].type)).toEqual(['C', 'CK', 'CI']);
    expect(sourceCall(projects[0].parts[0].scad).args[0]).toEqual(['C']);
  });
});

describe('parametric projects', () => {
  it.each(holderTemplates)('$id supports empty, single, repeated and maximum-size selections', ({ id }) => {
    for (const count of [0, 1, 7, 48]) {
      const config = repeated(count);
      config.template = id;
      const project = buildProject(config);
      expect(project.keys).toHaveLength(count);
      expect(new Set(project.parts.map((p) => p.id)).size).toBe(project.parts.length);
      expect(new Set(project.keys.map((k) => k.slotId)).size).toBe(count);
      expect(project.dimensions.every(Number.isFinite)).toBe(true);
      if (!count) expect(project.parts).toHaveLength(0);
      else expect(project.parts.length).toBeGreaterThan(0);
      for (const key of project.keys) expect(project.parts.some((p) => p.id === key.partId)).toBe(true);
    }
  });

  it.each(holderTemplates)('$id reserves unoccupied slots but never prints reference keys', ({ id }) => {
    const config = sampleConfig();
    config.template = id;
    const full = buildProject(config);
    config.slots[0].occupied = false;
    const sparse = buildProject(config);
    expect(sparse.parts.map((p) => p.scad)).toEqual(full.parts.map((p) => p.scad));
    expect(sparse.keys.map((k) => k.slotId)).not.toContain(config.slots[0].id);
    for (const p of full.parts) {
      expect(p.scad).not.toContain('illustrative_key');
      expect(p.scad).not.toContain('key_model(');
    }
  });

  it('keeps default dock dimensions and expands to balanced rows', () => {
    expect(buildProject(sampleConfig()).dimensions).toEqual([166, 45, 13.35]);
    const p = buildProject(repeated(7));
    expect(p.dimensions).toEqual([114, 90, 13.35]);
    expect(new Set(p.keys.map((k) => k.position.join(','))).size).toBe(7);
  });
  it('resizes dock margins and rows without changing socket depths', () => {
    const config = sampleConfig();
    Object.assign(config.options.dock, { columns: 3, spacing: 40, rowSpacing: 70, edgeMargin: 40, depthMargin: 45, height: 25 });
    const project = buildProject(config);
    expect(project.dimensions).toEqual([160, 160, 25.35]);
    const { args } = sourceCall(project.parts[0].scad);
    expect(args[2]).toEqual([[-40, -32], [0, -32], [40, -32], [-40, 38], [0, 38], [40, 38]]);
    expect(project.keys[0].position[2]).toBe(25 - 8.5);
    expect(project.parts[0].scad).toContain('w=8.300, t=2.560, depth=6.600');
  });
  it('allows compact 18 mm dock rows while retaining saved spacing and the 45 mm default', () => {
    const config = sampleConfig();
    Object.assign(config.options.dock, { columns: 3, spacing: 22, rowSpacing: 18, edgeMargin: 12, depthMargin: 18, height: 11 });
    const compact = buildProject(config);
    expect(compact.dimensions).toEqual([68, 54, 11.35]);
    expect(sourceCall(compact.parts[0].scad).args[2]).toEqual([[-22, -6], [0, -6], [22, -6], [-22, 12], [0, 12], [22, 12]]);
    expect(compact.keys[0].position[2]).toBe(2.5);
    config.options.dock.rowSpacing = 28;
    expect(buildProject(config).dimensions[1]).toBe(64);
    expect(defaultConfig().options.dock.rowSpacing).toBe(45);
  });
  it('adjusts tray outer dimensions and case clearance around an unchanged set of pockets', () => {
    const config = sampleConfig();
    config.template = 'inventory_tray';
    Object.assign(config.options.tray, { columns: 3, spacing: 42, rowSpacing: 110, margin: 20, height: 20 });
    const tray = buildProject(config);
    expect(tray.dimensions.slice(0, 2)).toEqual([143, 153.6]);
    expect(tray.dimensions[2]).toBeCloseTo(21.25);
    expect(sourceCall(tray.parts[0].scad).args[5]).toBe(20);
    expect(tray.keys[3].position[2]).toBeCloseTo(20 - 6.6 + 3.5);
    config.template = 'travel_case';
    config.options.case.headroom = 15;
    const container = buildProject(config);
    expect(container.dimensions.slice(0, 2)).toEqual([151, 224]);
    expect(container.dimensions[2]).toBeCloseTo(43.8);
    const lid = container.parts.find((p) => p.id === 'case-lid')!;
    const insert = container.parts.find((p) => p.id === 'case-insert')!;
    expect(lid.position[2] - 4.9 - (insert.position[2] + 20 + 0.4)).toBeCloseTo(16.1);
    expect(sourceCall(insert.scad).args[5]).toBe(20);
  });
  it('changes rail end margins without changing cartridge spacing or their sliding interfaces', () => {
    const config = sampleConfig(); config.template = 'modular_rail';
    const normal = buildProject(config);
    config.options.rail.endMargin = 30;
    const wider = buildProject(config);
    expect(wider.dimensions[0] - normal.dimensions[0]).toBe(50);
    expect(wider.parts.slice(1)).toEqual(normal.parts.slice(1));
    expect(wider.keys).toEqual(normal.keys);
    expect(sourceCall(wider.parts[0].scad).args[2]).toBe(30);
  });
  it('raises grid storage while preserving its footprint, feet, and key insertion depths', () => {
    const config = sampleConfig(); config.template = 'grid_organizer';
    const normal = buildProject(config);
    config.options.grid.extraHeight = 15;
    const taller = buildProject(config);
    expect(taller.dimensions.slice(0, 2)).toEqual(normal.dimensions.slice(0, 2));
    expect(taller.dimensions[2] - normal.dimensions[2]).toBeCloseTo(15);
    taller.keys.forEach((key, i) => expect(key.position[2] - normal.keys[i].position[2]).toBeCloseTo(15));
    taller.parts.forEach((part) => expect(sourceCall(part.scad).args[6]).toBe(15));
  });

  it('safely encodes custom text and supports individually blank labels', () => {
    const config = repeated(1);
    config.slots[0].label = 'a"\\();$%ΩЖ';
    config.options.dock.title = '";cube(999);//';
    const call = sourceCall(buildProject(config).parts[0].scad);
    expect((call.args[1] as string[])[0]).toBe(config.slots[0].label);
    expect(call.args[6]).toBe(config.options.dock.title);
    config.slots[0].label = '';
    expect(sourceCall(buildProject(config).parts[0].scad).args[1]).toEqual(['']);
    config.labels = false;
    expect(sourceCall(buildProject(config).parts[0].scad).args[1]).toEqual(['']);
    expect(sourceCall(buildProject(config).parts[0].scad).args[6]).toBe(config.options.dock.title);
    config.template = 'travel_case';
    expect(sourceCall(buildProject(config).parts.find((p) => p.id === 'case-lid')!.scad).args[2]).toBe(config.options.case.title);
  });

  it('separates printable rail cartridges from their assembled offsets', () => {
    const config = sampleConfig();
    config.template = 'modular_rail';
    const p = buildProject(config);
    expect(p.parts).toHaveLength(7);
    expect(p.parts[0].position).toEqual([0, 0, 0]);
    expect(p.parts.slice(1).every((part) => part.position[2] === 3)).toBe(true);
    expect(sourceCall(p.parts[1].scad).module).toBe('cartridge');
    expect(p.parts[0].scad).toContain('translate([0,y,7.4])');
    expect(p.parts[1].scad).toContain('slab(25.6,28.4,3,1.4)');
  });

  it('provides a closed, non-exploded case with a positive lid/insert clearance', () => {
    const config = sampleConfig();
    config.template = 'travel_case';
    const p = buildProject(config);
    const lid = p.parts.find((part) => part.id === 'case-lid')!;
    const insert = p.parts.find((part) => part.id === 'case-insert')!;
    expect(lid.rotation).toEqual([Math.PI, 0, 0]);
    expect(lid.position[2] - 4.9).toBeCloseTo(12.5);
    expect(lid.position[2] - 4.9 - (insert.position[2] + 8.6 + 0.4)).toBeGreaterThan(1);
    expect(sourceCall(lid.scad).module).toBe('case_lid');
    expect(p.dimensions).toEqual([172, 84, 17.4]);
  });

  it.each(['mixed', 'upright', 'flat'] as const)('packs the %s grid into independent 2×2 tiles with the approved capacities', (mode) => {
    const config = repeated(48);
    config.template = 'grid_organizer';
    config.options.grid.mode = mode;
    config.slots.forEach((s, i) => { s.type = KEY_TYPES[i % KEY_TYPES.length]; });
    const p = buildProject(config);
    expect(p.keys).toHaveLength(48);
    for (const part of p.parts) {
      const { args } = sourceCall(part.scad);
      expect(args[3]).toBe(2);
      expect(args[4]).toBe(2);
      expect((args[0] as string[]).length).toBeLessThanOrEqual(args[5] ? 2 : 4);
      expect(part.scad).toContain('grid_ring(35.6,0.8,0,x,y)');
      expect(part.scad).toContain('grid_ring(41.5,3.75,4.75,x,y)');
    }
  });
});

describe('inventory tray retention, stacking, and layer text', () => {
  it('packs rows using a real edge gap and the keys in each row', () => {
    const config = sampleConfig(); config.template = 'inventory_tray';
    Object.assign(config.options.tray, { columns: 3, rowGap: 2 });
    const compact = inventoryTrayLayout(config);
    expect(compact.rows).toHaveLength(2);
    expect(compact.rows[1].minY - compact.rows[0].maxY).toBeCloseTo(2);
    expect(compact.depth).toBeCloseTo(121.6);
    config.options.tray.rowGap = 12;
    const spaced = inventoryTrayLayout(config);
    expect(spaced.depth - compact.depth).toBeCloseTo(10);
    expect(spaced.rows[1].minY - spaced.rows[0].maxY).toBeCloseTo(12);
    expect(spaced.width).toEqual(compact.width);
  });

  it('lets Nano rows shrink and reserves finger access and printed label room', () => {
    const config = repeated(4, 'CN'); config.template = 'inventory_tray';
    Object.assign(config.options.tray, { columns: 2, rowGap: 2, scoop: 'small' });
    const withLabels = inventoryTrayLayout(config);
    expect(withLabels.depth).toBeLessThan(60);
    config.labels = false;
    const withoutLabels = inventoryTrayLayout(config);
    expect(withoutLabels.depth).toBeLessThan(withLabels.depth);
    expect(withoutLabels.rows[1].minY - withoutLabels.rows[0].maxY).toBeCloseTo(2);
    for (const row of withoutLabels.rows) expect(row.back).toBeGreaterThanOrEqual(9.4);
  });

  it.each(KEY_TYPES)('expands %s inventory finger access while keeping case scoops and pocket floors unchanged', (type) => {
    const config = repeated(2, type); config.template = 'inventory_tray'; config.labels = false;
    Object.assign(config.options.tray, { columns: 1, rowGap: 2 });
    const inventoryDepths: number[] = [];
    let caseDimensions: number[] | undefined;
    let caseKeys: ReturnType<typeof buildProject>['keys'] | undefined;
    for (const [scoop, inventoryRadius, caseRadius] of [['small', 5, 4], ['default', 6, 5], ['large', 7, 6]] as const) {
      config.options.tray.scoop = scoop; config.template = 'inventory_tray';
      const layout = inventoryTrayLayout(config), project = buildProject(config);
      expect(layout.scoopRadius).toBe(inventoryRadius);
      expect(sourceCall(project.parts[0].scad).args[6]).toBe(inventoryRadius);
      for (const row of layout.rows) expect(row.back - keyDimensions[type].pocketLength / 2).toBeCloseTo(inventoryRadius);
      expect(layout.rows[1].minY - layout.rows[0].maxY).toBeCloseTo(2);
      expect(layout.height - (keyDimensions[type].thickness - 0.4)).toBeGreaterThanOrEqual(2);
      inventoryDepths.push(layout.depth);

      config.template = 'travel_case';
      const container = buildProject(config);
      expect(sourceCall(container.parts.find((part) => part.id === 'case-insert')!.scad).args[6]).toBe(caseRadius);
      if (caseDimensions) {
        expect(container.dimensions).toEqual(caseDimensions);
        expect(container.keys).toEqual(caseKeys);
      }
      caseDimensions = container.dimensions; caseKeys = container.keys;
    }
    // Each of the two rows gains 1 mm of finger-access depth per size step.
    expect(inventoryDepths[1] - inventoryDepths[0]).toBeCloseTo(2);
    expect(inventoryDepths[2] - inventoryDepths[1]).toBeCloseTo(2);
  });

  it('keeps compact inventory row gaps independent of travel-case pitch', () => {
    const config = sampleConfig(); config.template = 'travel_case';
    config.options.tray.columns = 3;
    const before = buildProject(config);
    config.options.tray.rowGap = 2;
    expect(buildProject(config)).toEqual(before);
    config.options.tray.rowSpacing = 100;
    expect(buildProject(config).dimensions[1]).toBeGreaterThan(before.dimensions[1]);
    config.template = 'inventory_tray';
    const inventory = buildProject(config);
    config.options.tray.rowSpacing = 66;
    expect(buildProject(config)).toEqual(inventory);
  });

  it('defaults to integral retention, preserving seated key positions and the original footprint', () => {
    const config = sampleConfig(); config.template = 'inventory_tray';
    const retained = buildProject(config);
    expect(sourceCall(retained.parts[0].scad)).toMatchObject({ module: 'inventory_tray' });
    expect(sourceCall(retained.parts[0].scad).args.slice(8, 12)).toEqual([true, false, '', []]);
    expect(retained.dimensions[2]).toBeCloseTo(9.85);
    config.options.tray.retention = false;
    const plain = buildProject(config);
    expect(plain.dimensions[2]).toBeCloseTo(8.95);
    expect(plain.dimensions.slice(0, 2)).toEqual(retained.dimensions.slice(0, 2));
    expect(plain.keys).toEqual(retained.keys);
    expect(sourceCall(plain.parts[0].scad).args.slice(0, 8)).toEqual(sourceCall(retained.parts[0].scad).args.slice(0, 8));
  });

  it.each(KEY_TYPES)('keeps %s capture above the seated body, with independent stack clearance', (type) => {
    const spec = trayRetentionSpec(type);
    expect(spec.cavityHalfWidth).toBeGreaterThan(spec.bodyHalfWidth);
    // Nominal body top is h+0.4. Interpolate the new ramp at that body edge.
    const reach = spec.pocketHalfWidth + 0.5 - spec.bodyHalfWidth + 0.2;
    const bodyEdgeUnderside = 0.75 - 0.2 * 0.7 / reach;
    expect(bodyEdgeUnderside).toBeGreaterThan(0.475);
    expect(spec.peakHeight).toBe(1.25);
    const config = repeated(1, type); config.template = 'inventory_tray'; config.labels = false;
    expect(buildProject(config).dimensions[2]).toBeCloseTo(8.6 + spec.peakHeight);
    config.options.tray.lid = true;
    const stacked = buildProject(config);
    expect(stacked.dimensions[2]).toBeCloseTo(12.5);
    expect(trayStackPitch(8.6) - (8.6 + spec.peakHeight)).toBeCloseTo(0.25);
  });

  it('seats unlocked lids on perimeter lips with a near-flush exterior seam at arbitrary heights', () => {
    expect(TRAY_STACK.grooveDepth).toBeLessThan(2);
    expect(TRAY_STACK.tongueHeight).toBeLessThan(TRAY_STACK.grooveDepth);
    expect(TRAY_STACK.tongueOuterInset - TRAY_STACK.grooveOuterInset).toBeCloseTo(0.3);
    expect(TRAY_STACK.grooveInnerInset - TRAY_STACK.tongueInnerInset).toBeCloseTo(0.3);
    for (const height of [8.6, 14, 20]) {
      const config = sampleConfig(); config.template = 'inventory_tray';
      Object.assign(config.options.tray, { height, connection: 'none', lid: true, retention: false });
      expect(trayStackPitch(height, false)).toBeCloseTo(height + 1);
      expect(trayStackPitch(height, false) - height - 0.7).toBeCloseTo(0.3);
      expect(buildProject(config).dimensions[2]).toBeCloseTo(height + 1 + TRAY_LID.thickness);
    }
  });

  it('adds exactly one central bearing pillar to the current four-column tray', () => {
    const config = sampleConfig(); config.template = 'inventory_tray';
    Object.assign(config.options.tray, { columns: 4, spacing: 24, rowGap: 2, connection: 'none', lid: true });
    expect(inventoryTraySupports(config)).toEqual([[0, 2]]);
    expect(sourceCall(buildProject(config).parts[0].scad).args[11]).toEqual([[0, 2]]);
    config.options.tray.lid = false;
    expect(inventoryTraySupports(config)).toEqual([]);
    config.options.tray.lid = true;
    config.options.tray.columns = 6;
    expect(inventoryTraySupports(config)).toEqual([]);
  });

  it('keeps support pillars sparse on large trays without changing pockets or layout', () => {
    const config = repeated(48); config.template = 'inventory_tray';
    Object.assign(config.options.tray, { columns: 6, rowGap: 4, connection: 'none', lid: true });
    const supports = inventoryTraySupports(config);
    expect(supports.length).toBeGreaterThan(1);
    expect(supports.length).toBeLessThanOrEqual(3);
    for (let i = 0; i < supports.length; i++) for (let j = i + 1; j < supports.length; j++) {
      expect(Math.hypot(supports[i][0] - supports[j][0], supports[i][1] - supports[j][1])).toBeGreaterThanOrEqual(90);
    }
    const layout = inventoryTrayLayout(config), keys = buildProject(config).keys;
    config.options.tray.lid = false;
    expect(inventoryTrayLayout(config)).toEqual(layout);
    expect(buildProject(config).keys).toEqual(keys);
  });

  it('engraves safely encoded layer names independently of key labels and limits their length', () => {
    const config = sampleConfig(); config.template = 'inventory_tray'; config.labels = false;
    config.options.tray.sideText = 'Layer "A" \\ ();$ ΩЖ';
    expect(sourceCall(buildProject(config).parts[0].scad).args[10]).toBe(config.options.tray.sideText);
    config.options.tray.sideText = 'L'.repeat(40);
    expect(sourceCall(buildProject(config).parts[0].scad).args[10]).toBe('L'.repeat(32));
  });

  it('does not apply inventory features to the travel case insert or any other organizer', () => {
    for (const template of holderTemplates.filter((t) => t.id !== 'inventory_tray')) {
      const config = sampleConfig(); config.template = template.id;
      Object.assign(config.options.tray, { retention: false, connection: 'none', sideText: '' });
      const plain = buildProject(config);
      Object.assign(config.options.tray, { retention: true, connection: 'snap_fit', sideText: 'Layer 3' });
      expect(buildProject(config)).toEqual(plain);
    }
  });
});

describe('illustrative keys and fit pieces', () => {
  it.each(KEY_TYPES)('%s uses the correct connector end when placed upright', (type) => {
    const config = repeated(1, type);
    const { keys } = buildProject(config);
    const k = keys[0];
    const d = keyDimensions[type];
    const highEnd = ['AN', 'CN', 'CK', 'CI'].includes(type);
    const tip = new Vector3(0, highEnd ? d.length : 0, 0)
      .applyMatrix4(new Matrix4().makeRotationFromEuler(new Euler(...k.rotation, 'XYZ')))
      .add(new Vector3(...k.position));
    expect(tip.z).toBeCloseTo(13 - d.socketDepth, 6);
    expect(tip.x).toBeCloseTo(0, 6);
    expect(tip.y).toBeCloseTo(3, 6);
    expect(buildKeyScad(type, 'body')).toContain(`k=${JSON.stringify(type)};`);
  });

  it('exports only the enclosure snap-fit alongside the other interface tests', () => {
    const p = buildFitTests();
    expect(p.parts).toHaveLength(7);
    expect(p.keys).toHaveLength(0);
    expect(p.parts.map((part) => sourceCall(part.scad).module)).toEqual(['grid_fit_test', 'rail_base', 'cartridge', 'lid_fit_base', 'lid_fit_lid', 'tray_snap_coupon_lower', 'tray_snap_lid']);
  });
  it.each([
    ['grid', 1, [41.5, 41.5, 7]], ['rail', 2, [36, 36, 16.6]], ['lid', 2, [24, 24, 17.4]], ['tray_snap', 2, [TRAY_SNAP.couponWidth, TRAY_SNAP.couponDepth, TRAY_SNAP.couponHeight + TRAY_SNAP.gap + TRAY_SNAP.lidThickness]], ['all', 7, [215.75 + TRAY_SNAP.couponWidth / 2, Math.max(41.5, TRAY_SNAP.couponDepth), Math.max(17.4, TRAY_SNAP.couponHeight + TRAY_SNAP.gap + TRAY_SNAP.lidThickness)]],
  ] as const)('generates only the %s interface pieces and reports their real assembly dimensions', (kind, count, dimensions) => {
    const config = sampleConfig(); config.template = 'interface_tests'; config.slots = [];
    config.options.interfaceTests.kind = kind;
    const p = buildProject(config);
    expect(p.parts).toHaveLength(count);
    expect(p.keys).toHaveLength(0);
    expect(p.dimensions).toEqual(dimensions);
    expect(p).toEqual(buildFitTests(kind));
  });
  it.each(['A', 'C', 'AN', 'CN'] as const)('creates a labeled %s socket calibration coupon without slots or reference keys', (profile) => {
    const config = sampleConfig(); config.template = 'key_fit_tester'; config.slots = [];
    config.options.tester = { profile, startOffset: -0.1, step: 0.1, samples: 3 };
    const p = buildProject(config);
    expect(p.parts).toHaveLength(1);
    expect(p.keys).toHaveLength(0);
    const call = sourceCall(p.parts[0].scad);
    expect(call.module).toBe('key_fit_tester');
    expect(call.args.slice(0, 3)).toEqual([profile, [-0.1, 0, 0.1], ['-0.10', '0.00', '+0.10']]);
    expect(p.dimensions.slice(0, 2)).toEqual([68, 28]);
    expect(p.dimensions[2]).toBeCloseTo(keyDimensions[profile].socketDepth + 3.35);
    config.labels = false;
    expect(buildProject(config).parts[0].scad).toBe(p.parts[0].scad);
  });
  it('keeps the zero specimen exact and labels the full five-sample offset range', () => {
    const config = sampleConfig(); config.template = 'key_fit_tester'; config.slots = [];
    config.options.tester = { profile: 'C', startOffset: 0.3, step: 0.2, samples: 5 };
    const p = buildProject(config);
    expect(sourceCall(p.parts[0].scad).args[1]).toEqual([0.3, 0.5, 0.7, 0.9, 1.1]);
    expect(p.dimensions[0]).toBe(112);
    expect(p.parts[0].scad).toContain('if(abs(fit_offset)<0.000000001) socket_cut(k,top)');
    expect(calibratedLibrary).not.toContain('scale(');
    config.options.tester = { profile: 'AN', startOffset: -0.1, step: 0.123, samples: 3 };
    expect(sourceCall(buildProject(config).parts[0].scad).args[2]).toEqual(['-0.10', '+0.023', '+0.146']);
  });
});
