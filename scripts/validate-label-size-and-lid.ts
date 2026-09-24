import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { defaultConfig, KEY_CATALOG, KEY_TYPES } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import type { HolderConfig, KeyType, PartSpec, ProjectGeometry, TemplateId } from '../src/types';

// Actual exported geometry checks for scalable key labels and the optional
// inventory lid. Prior tray-mechanism evidence is retained in its own report.
// Run: node --import tsx scripts/validate-label-size-and-lid.ts [--filter=substring]
const server = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject, keyDimensions, keyLabelMetrics, inventoryTrayLayout, inventoryTraySupports, trayStackPitch } = await server.ssrLoadModule('/src/geometry/index.ts') as {
  buildProject(c: HolderConfig): ProjectGeometry;
  keyDimensions: Record<KeyType, { length: number; thickness: number; socketDepth: number }>;
  keyLabelMetrics(c: HolderConfig): { scale: number; halfHeight: number; edgeOffset: number };
  inventoryTrayLayout(c: HolderConfig): { xy: [number, number][]; width: number; depth: number; rows: { minY: number; maxY: number }[] };
  inventoryTraySupports(c: HolderConfig): [number, number][];
  trayStackPitch(height: number, retention?: boolean): number;
};
const { library } = await server.ssrLoadModule('/src/geometry/library.ts') as { library: string };
await server.close();
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const filter = process.argv.find((s) => s.startsWith('--filter='))?.slice(9);
const active = (name: string) => !filter || name.includes(filter);
const output = 'artifacts/label-size-and-lid-validation.json';
const results: object[] = [], probes: object[] = [];
const cache = new Map<string, ArrayBuffer>();
const started = performance.now();
let renders = 0, floorChecks = 0;

function points(data: DataView, i: number): number[][] {
  return Array.from({ length: 3 }, (_, v) => [0, 1, 2].map((axis) => data.getFloat32(96 + i * 50 + v * 12 + axis * 4, true)));
}
function volume(buffer: ArrayBuffer | null): number {
  if (!buffer) return 0;
  const data = new DataView(buffer); let sum = 0;
  for (let i = 0; i < data.getUint32(80, true); i++) {
    const [a, b, c] = points(data, i);
    sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(sum);
}
function zHits(buffer: ArrayBuffer, x: number, y: number): number[] {
  const data = new DataView(buffer), hits: number[] = [];
  for (let i = 0; i < data.getUint32(80, true); i++) {
    const [a, b, c] = points(data, i);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) hits.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
  }
  return [...new Set(hits.map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => a - b);
}
async function mesh(source: string) {
  let stl = cache.get(source);
  if (!stl) { const r = await renderScadInNode(source); assert.ok(r.stl); stl = r.stl; cache.set(source, stl); renders++; }
  return stl;
}
async function booleanProbe(name: string, source: string, files: Record<string, Uint8Array> = {}, engagement = false) {
  const { stl } = await renderScadInNode(source, { allowEmpty: true, files });
  const actual = volume(stl);
  assert.ok(engagement ? actual > 0.0001 : actual < 0.00001, `${name}: ${actual} mm³ ${engagement ? 'missing engagement' : 'unexpected material'}`);
  probes.push({ name, expected: engagement ? 'positive engagement' : 'empty', volumeMm3: actual });
  return actual;
}
function place(part: PartSpec, shape: string, dz = 0): string {
  return `translate(${JSON.stringify([part.position[0], part.position[1], part.position[2] + dz])}) rotate(${JSON.stringify(part.rotation.map((v) => v * 180 / Math.PI))}) {${shape}}`;
}
function occupiedKeys(project: ProjectGeometry): string {
  return `union(){${project.keys.map((key) => {
    const thickness = keyDimensions[key.type].thickness;
    return `translate(${JSON.stringify(key.position)}) rotate(${JSON.stringify(key.rotation.map((v) => v * 180 / Math.PI))}) translate([0,0,${-thickness / 2}]) linear_extrude(${thickness + 0.075}) polygon(nominal_pts(${JSON.stringify(key.type)}));`;
  }).join('\n')}}`;
}

/** Parse the actual exported call so the probe follows per-part layout and
 * width constraints, including the six independently printable cartridges. */
function call(part: PartSpec) {
  const last = part.scad.trim().split('\n').at(-1)!;
  const match = /^(\w+)\((.*)\);$/.exec(last); assert.ok(match, `Unrecognized part call: ${last}`);
  return { module: match[1], args: JSON.parse(`[${match[2]}]`) as any[] };
}
function keyLabels(part: PartSpec): { labels: string[]; top: number; blank: string; features: string } | null {
  const { module, args } = call(part);
  let types: string[], labels: string[], xy: [number, number][], top: number, scale: number, width: number, nominal: number, flat: boolean;
  if (module === 'dock') [types, labels, xy, top, scale, width, nominal, flat] = [args[0], args[1], args[2], args[5], args[7] ?? 1, 20, 2.55, false];
  else if (module === 'tray' || module === 'inventory_tray') [types, labels, xy, top, scale, width, nominal, flat] = [args[0], args[1], args[2], args[5], args[module === 'tray' ? 8 : 12] ?? 1, args[7], 2.7, true];
  else if (module === 'cartridge') [types, labels, xy, top, scale, width, nominal, flat] = [[args[0]], [args[1]], [[0, 0]], 13.6, args[2] ?? 1, 20, 2, false];
  else if (module === 'grid_tile') [types, labels, xy, top, scale, width, nominal, flat] = [args[0], args[1], args[2], (args[5] ? 13 : 15) + args[6], args[7] ?? 1, 32, 2.7, args[5]];
  else return null;
  const text = labels.map((label, i) => `label(${JSON.stringify(label)},${xy[i][0]},${xy[i][1]}-${flat ? 'flat' : 'upright'}_label_distance(${JSON.stringify(types[i])},${scale}),${top},${width},${nominal * scale});`);
  const features: string[] = [];
  if (module === 'inventory_tray') {
    if (args[8]) types.forEach((type, i) => features.push(`translate([${xy[i][0]},${xy[i][1]},0]) {tray_retention_relief(${JSON.stringify(type)},${top});tray_retention_lips(${JSON.stringify(type)},${top});}`));
    features.push(`tray_stack_pillars(${JSON.stringify(args[11] ?? [])},${top},tray_stack_gap(${JSON.stringify(args[8] ?? true)}));`);
  }
  const blankArgs = [...args]; blankArgs[1] = module === 'cartridge' ? '' : labels.map(() => '');
  return { labels: text, top, blank: `${library}\n${module}(${blankArgs.map((v) => JSON.stringify(v)).join(',')});`, features: features.join('\n') };
}

function config(template: TemplateId, size: number, stress = false): HolderConfig {
  const c = defaultConfig(); c.template = template; c.labelSize = size; c.labels = true;
  const text = ['W'.repeat(18), 'ǗӜΐgj', 'Ж'.repeat(18), 'WMЖЩǄѼ'.repeat(3), 'ÁÉÑŴȀİŶgj', '"\\ΩЖ'];
  c.slots = KEY_TYPES.map((type, i) => ({ id: `key-${i}`, type, label: stress ? text[i] : KEY_CATALOG[type].short, occupied: true }));
  Object.assign(c.options.dock, { columns: 3, spacing: 22, rowSpacing: 18, edgeMargin: 12, depthMargin: 18, height: 11, title: '' });
  Object.assign(c.options.tray, { columns: 3, spacing: 24, rowGap: 2, rowSpacing: 66, margin: 5, height: 8.6, scoop: 'large', retention: true, connection: 'none', sideText: '' });
  c.options.rail.endMargin = 5; c.options.grid.mode = 'mixed'; c.options.grid.extraHeight = 0; c.options.case.headroom = 0; c.options.case.title = '';
  return c;
}

async function projectChecks(c: HolderConfig, scenario: string) {
  const project = buildProject(c), rendered = new Map<string, ArrayBuffer>(), allLabels: string[] = [];
  if (c.template === 'inventory_tray') {
    const layout = inventoryTrayLayout(c);
    for (let i = 1; i < layout.rows.length; i++) assert.ok(Math.abs(layout.rows[i].minY - layout.rows[i - 1].maxY - c.options.tray.rowGap) < 1e-5, `${scenario}: scaled label rows violate the requested clear gap`);
  }
  for (const part of project.parts) {
    const stl = await mesh(part.scad), inspection = inspectPrintableMesh(stl); rendered.set(part.id, stl);
    const label = keyLabels(part);
    if (label) {
      const blank = await mesh(label.blank); inspectPrintableMesh(blank);
      const expectedInk = await mesh(`${library}\nunion(){${label.labels.join('\n')}}`);
      await booleanProbe(`${scenario}/${part.id}/actual-mesh-matches-requested-label-scale`, 'union(){difference(){import("/part.stl");union(){import("/blank.stl");import("/ink.stl");}}difference(){import("/ink.stl");import("/part.stl");}}', { '/part.stl': new Uint8Array(stl), '/blank.stl': new Uint8Array(blank), '/ink.stl': new Uint8Array(expectedInk) });
      await booleanProbe(`${scenario}/${part.id}/all-label-ink-supported`, `${library}\ndifference(){translate([0,0,-0.4]) union(){${label.labels.join('\n')}}import("/blank.stl");}`, { '/blank.stl': new Uint8Array(blank) });
      if (label.features) await booleanProbe(`${scenario}/${part.id}/labels-clear-tabs-and-pillars`, `${library}\nintersection(){union(){${label.labels.join('\n')}}union(){${label.features}}}`);
      allLabels.push(...label.labels.map((source) => place(part, source)));
      const partKeys = project.keys.filter((key) => key.partId === part.id);
      for (const key of partKeys) {
        const flat = Math.abs(key.rotation[0]) < 0.001;
        const expected = label.top - (flat ? keyDimensions[key.type].thickness - 0.4 : keyDimensions[key.type].socketDepth);
        const x = key.position[0] - part.position[0], y = key.position[1] - part.position[1] + (flat ? keyDimensions[key.type].length / 2 : 0);
        const hits = zHits(stl, x, y), blankHits = zHits(blank, x, y);
        assert.ok(hits.some((z) => Math.abs(z - expected) < 0.001), `${scenario}/${key.type}: calibrated cavity floor changed (${hits}, expected ${expected})`);
        assert.deepEqual(hits, blankHits, `${scenario}/${key.type}: key label changes the calibrated cavity surface`);
        if (c.template === 'inventory_tray' || c.template === 'travel_case') assert.ok(expected >= 1.999, `${scenario}: tray floor is thinner than 2 mm`);
        floorChecks++;
      }
    }
    results.push({ scenario, part: part.id, labelSizeMm: c.labelSize, scadSha256: hash(part.scad), ...inspection });
  }
  if (allLabels.length) {
    await booleanProbe(`${scenario}/labels-clear-occupied-key-envelopes`, `${library}\nintersection(){union(){${allLabels.join('\n')}}${occupiedKeys(project)}}`);
    const pairs: string[] = [];
    for (let i = 0; i < allLabels.length; i++) for (let j = i + 1; j < allLabels.length; j++) pairs.push(`intersection(){${allLabels[i]}${allLabels[j]}}`);
    await booleanProbe(`${scenario}/labels-clear-each-other`, `${library}\nunion(){${pairs.join('\n')}}`);
  }
  probes.push({ name: `${scenario}/label-layout`, requestedSizeMm: c.labelSize, metrics: keyLabelMetrics(c), ...(c.template === 'inventory_tray' ? { supportXYMm: inventoryTraySupports(c) } : {}) });
  console.log(`PASS ${scenario}: ${project.parts.length} printable parts`);
  return { project, rendered };
}

async function lidChecks(c: HolderConfig, scenario: string) {
  const { project, rendered } = await projectChecks(c, scenario);
  assert.equal(project.parts.length, 2);
  const tray = project.parts.find((part) => part.id === 'tray')!, lid = project.parts.find((part) => part.id === 'tray-lid')!;
  assert.ok(tray && lid);
  const trayStl = rendered.get(tray.id)!, lidStl = rendered.get(lid.id)!;
  const files = { '/tray.stl': new Uint8Array(trayStl), '/lid.stl': new Uint8Array(lidStl) };
  const layout = inventoryTrayLayout(c), h = c.options.tray.height, pitch = trayStackPitch(h, c.options.tray.retention);
  const assembly = (dz = 0) => place(lid, 'import("/lid.stl");', dz);
  assert.ok(Math.abs(lid.position[2] - pitch - 2.4) < 1e-6);
  assert.deepEqual(lid.rotation, [Math.PI, 0, 0]);
  await booleanProbe(`${scenario}/lid-fully-seated`, `intersection(){import("/tray.stl");${assembly()}}`, files);
  await booleanProbe(`${scenario}/lid-bearing-contact`, `intersection(){import("/tray.stl");${assembly(-0.01)}}`, files, true);
  await booleanProbe(`${scenario}/lid-clears-all-occupied-keys`, `${library}\nintersection(){${assembly()}${occupiedKeys(project)}}`, files);
  for (const x of [-0.1, 0.1]) await booleanProbe(`${scenario}/lid-registration-clearance-${x}`, `intersection(){import("/tray.stl");translate([${x},0,0]) ${assembly(0.001)}}`, files);
  await booleanProbe(`${scenario}/lid-registration-stops-excess-offset`, `intersection(){import("/tray.stl");translate([0.4,0,0]) ${assembly(0.001)}}`, files, true);
  const supportPoints = inventoryTraySupports(c);
  // Avoid the intentional fingernail notch at the middle of the front edge.
  const contactPoints = [[-layout.width / 2 + 0.7, 0], [layout.width / 2 - 0.7, 0], [0, layout.depth / 2 - 0.7], [layout.width / 4, -layout.depth / 2 + 0.7], ...supportPoints];
  const bearings = contactPoints.map(([x, y]) => {
    const lower = zHits(trayStl, x, y), upper = zHits(lidStl, x, -y);
    const lowerTop = lower[lower.length - 1], upperBottom = lid.position[2] - upper[upper.length - 1];
    assert.ok(Math.abs(lowerTop - pitch) < 0.001 && Math.abs(upperBottom - pitch) < 0.001, `${scenario}: a rim/pillar bearing has a gap or interference`);
    return { xy: [x, y], lowerTopMm: lowerTop, lidBottomMm: upperBottom };
  });
  if (supportPoints.length) {
    const contact = await booleanProbe(`${scenario}/lid-complete-pillar-top-contact`, `${library}\nintersection(){tray_stack_pillars(${JSON.stringify(supportPoints)},${h},${pitch-h});import("/tray.stl");${assembly(-0.01)}}`, files, true);
    const expected = supportPoints.length * 24 * 1.5 ** 2 * Math.sin(Math.PI / 24) * 0.01;
    assert.ok(Math.abs(contact - expected) < 0.0002 * supportPoints.length, `${scenario}: lid misses part of a support pillar`);
  }
  const underside = zHits(trayStl, layout.width / 2 - 1.8, 0)[0];
  assert.ok(Math.abs(underside - 0) < 0.001, `${scenario}: unlocked tray underside must remain flat`);
  const lidGroove = zHits(lidStl, layout.width / 2 - 1.8, 0);
  assert.ok(Math.abs(lidGroove[lidGroove.length - 1] - 0.7) < 0.001, `${scenario}: lid groove depth changed`);
  const { module, args } = call(lid), blankArgs = [...args]; blankArgs[2] = '';
  const blank = await mesh(`${library}\n${module}(${blankArgs.map((arg) => JSON.stringify(arg)).join(',')});`);
  const removed = volume(blank) - volume(lidStl);
  assert.ok(removed > 0.001, `${scenario}: lid text did not engrave`);
  assert.deepEqual(inspectPrintableMesh(blank).min, inspectPrintableMesh(lidStl).min);
  assert.deepEqual(inspectPrintableMesh(blank).max, inspectPrintableMesh(lidStl).max);
  // The full center panel above the 0.35 mm engraving must remain present;
  // 1 µm insets avoid coincident surface rounding in imported float32 STLs.
  await booleanProbe(`${scenario}/lid-center-panel-keeps-2.05mm`, `${library}\ndifference(){translate([0,0,0.351]) linear_extrude(2.048) rr(${layout.width - 7},${layout.depth - 7},0.5);import("/lid.stl");}`, files);
  probes.push({ name: `${scenario}/lid-contract`, printThicknessMm: 2.4, grooveDepthMm: 1.7, bearingPlaneMm: pitch, bearings, removedTextVolumeMm3: removed, baseUndersideAtGrooveMm: underside });
}

try {
  const templates = ['desktop_dock', 'inventory_tray', 'modular_rail', 'grid_organizer', 'travel_case'] as const;
  for (const template of templates) for (const size of [1.5, 2.7, 4]) {
    const scenario = `labels/${template}/${size}`;
    if (active(scenario)) await projectChecks(config(template, size), scenario);
  }
  for (const template of templates) {
    const scenario = `stress-labels/${template}`;
    if (active(scenario)) await projectChecks(config(template, 4, true), scenario);
  }
  for (const size of [1.5, 4]) {
    const scenario = `lid/unlocked/label-${size}`;
    if (!active(scenario)) continue;
    const c = config('inventory_tray', size, true);
    Object.assign(c.options.tray, { columns: 4, lid: true, lidText: size === 1.5 ? '"\\(); ΩЖ' : `${'W'.repeat(30)}ΩЖ` });
    await lidChecks(c, scenario);
  }
  for (const type of ['AN', 'CN'] as const) {
    const scenario = `lid/small-${type}`;
    if (!active(scenario)) continue;
    const c = config('inventory_tray', 4);
    c.slots = [{ id: 'nano', type, label: 'ǗӜΐgj', occupied: true }];
    Object.assign(c.options.tray, { lid: true, connection: 'none', scoop: 'small', lidText: 'W'.repeat(32) });
    await lidChecks(c, scenario);
  }
  if (active('legacy-default')) {
    for (const template of templates) {
      const c = config(template, 2.7), legacy = structuredClone(c);
      delete (legacy as Partial<HolderConfig>).labelSize;
      assert.deepEqual(buildProject(legacy), buildProject(c));
    }
    probes.push({ name: 'legacy-default', defaultMm: 2.7, allFiveProjectSourcesAndPlacementsIdentical: true });
  }
  assert.ok(results.length || probes.length, 'No matching scenarios');
  await mkdir('artifacts', { recursive: true });
  await writeFile(output, JSON.stringify({ status: 'passed', command: 'node --import tsx scripts/validate-label-size-and-lid.ts', filter: filter ?? null, seconds: (performance.now() - started) / 1000, librarySha256: hash(library), renders, floorChecks, results, probes, limitation: 'Actual geometry and fit clearances are checked; physical print fit remains untested.' }, null, 2) + '\n');
  console.log(`PASS ${renders} renders, ${floorChecks} floor probes, ${probes.length} geometry checks. ${output}`);
} catch (error) {
  await mkdir('artifacts', { recursive: true });
  await writeFile(output, JSON.stringify({ status: 'failed', filter: filter ?? null, error: String(error), librarySha256: hash(library), renders, floorChecks, results, probes }, null, 2) + '\n');
  throw error;
}
