import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { defaultConfig, KEY_CATALOG, KEY_TYPES } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import type { HolderConfig, KeyType, PartSpec, ProjectGeometry } from '../src/types';

// Focused checks for the four pry recesses, lid text sizing, and sideways
// exploded placement. Existing organizer/label matrices remain separate.
// Run: node --import tsx scripts/validate-lid-options.ts
const server = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject, inventoryTrayLayout, inventoryTraySupports, trayStackPitch, keyDimensions } = await server.ssrLoadModule('/src/geometry/index.ts') as {
  buildProject(c: HolderConfig): ProjectGeometry;
  inventoryTrayLayout(c: HolderConfig): { width: number; depth: number };
  inventoryTraySupports(c: HolderConfig): [number, number][];
  trayStackPitch(h: number, retention?: boolean): number;
  keyDimensions: Record<KeyType, { thickness: number }>;
};
const { library, TRAY_LID } = await server.ssrLoadModule('/src/geometry/library.ts') as {
  library: string;
  TRAY_LID: { thickness: number; engravingDepth: number; notchDepth: number; notchHeight: number; notchRadius: number; textInset: number };
};
await server.close();
const output = 'artifacts/lid-options-validation.json';
const started = performance.now(), cache = new Map<string, ArrayBuffer>();
const results: object[] = [], probes: object[] = [], scaling: { requested: number; width: number; height: number }[] = [];
const hash = (source: string) => createHash('sha256').update(source).digest('hex');
let renders = 0, notchSamples = 0;
function points(data: DataView, i: number): number[][] { return Array.from({ length: 3 }, (_, v) => [0, 1, 2].map((a) => data.getFloat32(96 + i * 50 + v * 12 + a * 4, true))); }
function bounds(stl: ArrayBuffer) {
  const data = new DataView(stl), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.getUint32(80, true); i++) for (const point of points(data, i)) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis], point[axis]); max[axis] = Math.max(max[axis], point[axis]); }
  return { min, max };
}
function volume(stl: ArrayBuffer | null) {
  if (!stl) return 0;
  const data = new DataView(stl); let sum = 0;
  for (let i = 0; i < data.getUint32(80, true); i++) { const [a, b, c] = points(data, i); sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; }
  return Math.abs(sum);
}
function zHits(stl: ArrayBuffer, x: number, y: number) {
  const data = new DataView(stl), hits: number[] = [];
  for (let i = 0; i < data.getUint32(80, true); i++) {
    const [a, b, c] = points(data, i), denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) hits.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
  }
  return [...new Set(hits.map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => a - b);
}
async function mesh(source: string) {
  let stl = cache.get(source);
  if (!stl) { const result = await renderScadInNode(source); assert.ok(result.stl); stl = result.stl; cache.set(source, stl); renders++; }
  return stl;
}
async function check(name: string, source: string, files: Record<string, Uint8Array> = {}, engagement = false) {
  const result = await renderScadInNode(source, { allowEmpty: true, files }), amount = volume(result.stl);
  assert.ok(engagement ? amount > 0.0001 : amount < 0.00001, `${name}: unexpected volume ${amount} mm³`);
  probes.push({ name, expected: engagement ? 'engagement' : 'empty', volumeMm3: amount });
  return amount;
}
function place(part: PartSpec, dz = 0) { return `translate(${JSON.stringify([part.position[0], part.position[1], part.position[2] + dz])}) rotate(${JSON.stringify(part.rotation.map((r) => r * 180 / Math.PI))}) import("/lid.stl");`; }
function occupiedKeys(project: ProjectGeometry) {
  return `union(){${project.keys.map((key) => `translate(${JSON.stringify(key.position)}) rotate(${JSON.stringify(key.rotation.map((r) => r * 180 / Math.PI))}) translate([0,0,${-keyDimensions[key.type].thickness / 2}]) linear_extrude(${keyDimensions[key.type].thickness + 0.075}) polygon(nominal_pts(${JSON.stringify(key.type)}));`).join('\n')}}`;
}
function config(types: readonly KeyType[], size: number, text: string): HolderConfig {
  const c = defaultConfig(); c.template = 'inventory_tray'; c.labels = types.length > 1;
  // This suite retains coverage of imported legacy millimeter-sized lids.
  // Percentage/rotation and locked layers are exercised in validate-tray-sizing.ts.
  delete c.options.tray.lidTextPercent; delete c.options.tray.lidTextRotation;
  c.slots = types.map((type, i) => ({ id: `key-${i}`, type, label: KEY_CATALOG[type].short, occupied: true }));
  Object.assign(c.options.tray, { columns: 4, spacing: 24, rowGap: 2, margin: 5, height: 8.6, scoop: types.length > 1 ? 'default' : 'small', retention: true, connection: 'none', lid: true, lidText: text, lidTextSize: size });
  return c;
}
async function validate(c: HolderConfig, scenario: string) {
  const project = buildProject(c), layout = inventoryTrayLayout(c);
  assert.equal(project.parts.length, 2);
  const lid = project.parts.find((part) => part.id === 'tray-lid')!, tray = project.parts.find((part) => part.id === 'tray')!;
  const lidStl = await mesh(lid.scad), trayStl = await mesh(tray.scad);
  const lidInfo = inspectPrintableMesh(lidStl), trayInfo = inspectPrintableMesh(trayStl);
  assert.ok(Math.abs(lidInfo.max[2] - TRAY_LID.thickness) < 0.001);
  const blank = await mesh(`${library}\ninventory_tray_lid(${layout.width},${layout.depth},"",${c.options.tray.lidTextSize});`);
  inspectPrintableMesh(blank);
  const files = { '/lid.stl': new Uint8Array(lidStl), '/tray.stl': new Uint8Array(trayStl), '/blank.stl': new Uint8Array(blank) };
  const ink = await renderScadInNode('difference(){import("/blank.stl");import("/lid.stl");}', { files }); assert.ok(ink.stl);
  const inkBounds = bounds(ink.stl);
  assert.ok(inkBounds.min[0] >= -layout.width / 2 + TRAY_LID.textInset - 0.001 && inkBounds.max[0] <= layout.width / 2 - TRAY_LID.textInset + 0.001, `${scenario}: lid lettering exceeds its width`);
  assert.ok(inkBounds.min[1] >= -layout.depth / 2 + TRAY_LID.textInset - 0.001 && inkBounds.max[1] <= layout.depth / 2 - TRAY_LID.textInset + 0.001, `${scenario}: lid lettering exceeds its depth`);
  assert.ok(Math.abs(inkBounds.min[2]) < 0.001 && Math.abs(inkBounds.max[2] - TRAY_LID.engravingDepth) < 0.001);
  if (scenario.startsWith('regular-size-')) scaling.push({ requested: c.options.tray.lidTextSize, width: inkBounds.max[0] - inkBounds.min[0], height: inkBounds.max[1] - inkBounds.min[1] });
  const notchEvidence: object[] = [], webMasks: string[] = [];
  for (const [side, nx, ny] of [['right', 1, 0], ['left', -1, 0], ['back', 0, 1], ['front', 0, -1]] as const) {
    const point = (inset: number, tangent = 0) => [nx ? nx * (layout.width / 2 - inset) : tangent, ny ? ny * (layout.depth / 2 - inset) : tangent];
    const top = (inset: number, tangent = 0) => { const [x, y] = point(inset, tangent), hits = zHits(blank, x, y); assert.ok(hits.length); notchSamples++; return hits[hits.length - 1]; };
    const near = top(0.4), inside = top(TRAY_LID.notchDepth - 0.01), behind = top(TRAY_LID.notchDepth + 0.01), web = top(0.95), groove = top(1.8), curved = top(0.4, 2), outside = top(0.4, 3.3);
    assert.ok(Math.abs(near - (TRAY_LID.thickness - TRAY_LID.notchHeight)) < 0.001 && Math.abs(inside - near) < 0.001, `${scenario}/${side}: notch height/depth is wrong`);
    assert.ok(Math.abs(behind - TRAY_LID.thickness) < 0.001 && Math.abs(web - TRAY_LID.thickness) < 0.001, `${scenario}/${side}: pry cut breaches the locating-groove wall`);
    assert.ok(Math.abs(groove - 0.7) < 0.001, `${scenario}/${side}: locating groove changed`);
    assert.ok(curved > 1.65 && curved < 1.9 && Math.abs(outside - TRAY_LID.thickness) < 0.001, `${scenario}/${side}: pry recess is not the expected rounded shape`);
    const [wx, wy] = point(0.95);
    webMasks.push(`translate([${wx},${wy},1.2]) cube([${nx ? 0.298 : 7.998},${ny ? 0.298 : 7.998},2.398],center=true);`);
    notchEvidence.push({ side, sampledNotchHeightMm: TRAY_LID.thickness - near, depthBracketMm: [TRAY_LID.notchDepth - 0.01, TRAY_LID.notchDepth + 0.01], intactWebTopMm: web, grooveFloorMm: groove });
  }
  await check(`${scenario}/continuous-web-between-pry-cuts-and-groove`, `difference(){union(){${webMasks.join('\n')}}import("/blank.stl");}`, files);
  await check(`${scenario}/engraving-keeps-center-panel`, `${library}\ndifference(){translate([0,0,0.351]) linear_extrude(2.048) rr(${layout.width - 7},${layout.depth - 7},0.5);import("/lid.stl");}`, files);
  await check(`${scenario}/closed-no-interference`, `intersection(){import("/tray.stl");${place(lid)}}`, files);
  await check(`${scenario}/rim-bearing-contact`, `intersection(){import("/tray.stl");${place(lid, -0.01)}}`, files, true);
  await check(`${scenario}/populated-key-clearance`, `${library}\nintersection(){${place(lid)}${occupiedKeys(project)}}`, files);
  const pitch = trayStackPitch(c.options.tray.height, c.options.tray.retention), supports = inventoryTraySupports(c);
  for (const [x, y] of [[layout.width / 4, -layout.depth / 2 + 0.7], [layout.width / 4, layout.depth / 2 - 0.7], [-layout.width / 2 + 0.7, layout.depth / 4], [layout.width / 2 - 0.7, layout.depth / 4], ...supports]) {
    const lower = zHits(trayStl, x, y), upper = zHits(lidStl, x, -y);
    assert.ok(Math.abs(lower[lower.length - 1] - pitch) < 0.001 && Math.abs(lid.position[2] - upper[upper.length - 1] - pitch) < 0.001, `${scenario}: bearing surface does not meet the lid`);
  }
  if (supports.length) {
    const contact = await check(`${scenario}/complete-pillar-bearing-area`, `${library}\nintersection(){tray_stack_pillars(${JSON.stringify(supports)},${c.options.tray.height},${pitch-c.options.tray.height});import("/tray.stl");${place(lid, -0.01)}}`, files, true);
    const expected = supports.length * 24 * 1.5 ** 2 * Math.sin(Math.PI / 24) * 0.01;
    assert.ok(Math.abs(contact - expected) < 0.0002 * supports.length);
  }
  const explodedX = lid.position[0] + lid.explode[0], explodedY = lid.position[1] + lid.explode[1];
  const gapX = Math.abs(explodedX) - layout.width, gapY = Math.abs(explodedY) - layout.depth;
  assert.ok(Math.max(gapX, gapY) > 0, `${scenario}: default exploded lid still covers the organizer from above`);
  results.push({ scenario, requestedTextSizeMm: c.options.tray.lidTextSize, dimensionsMm: [layout.width, layout.depth], scadSha256: hash(lid.scad), lid: lidInfo, tray: trayInfo, textBoundsMm: inkBounds, notchEvidence, supportXYMm: supports, explodedFootprintGapMm: Math.max(gapX, gapY), assemblyPositionMm: lid.position, explodeOffsetMm: lid.explode });
  console.log(`PASS ${scenario}: four measured pry cuts; text inside ${layout.width} × ${layout.depth} mm lid`);
}

try {
  for (const size of [2, 6, 10]) await validate(config(KEY_TYPES, size, 'Keys'), `regular-size-${size}`);
  for (const size of [2, 6, 10]) await validate(config(['CN'], size, size === 10 ? 'Ǘ' : 'K'), `small-CN-size-${size}`);
  await validate(config(['AN'], 10, `${'W'.repeat(30)}ΩЖ`), 'small-AN-wide-unicode');
  await validate(config(KEY_TYPES, 10, 'WMЖЩǄѼ'.repeat(5) + 'ΩЖ'), 'regular-wide-unicode');
  for (const columns of [1, 6]) {
    const c = config(KEY_TYPES, 10, `${'W'.repeat(30)}ΩЖ`);
    Object.assign(c.options.tray, { columns, spacing: 42, rowGap: 40, margin: 20, height: 20, scoop: 'large' });
    await validate(c, `extreme-${columns === 1 ? 'deep' : 'wide'}`);
  }
  const baseline = scaling.find((row) => row.requested === 2)!;
  for (const row of scaling) for (const axis of ['width', 'height'] as const) assert.ok(Math.abs(row[axis] - baseline[axis] * row.requested / 2) < 0.01, 'Actual unconstrained engraving does not follow requested text size');
  for (const [types, text] of [[KEY_TYPES, 'FPR Keys'], [['CI'], 'Keys'], [['CN'], 'Ǘ'], [KEY_TYPES, 'WMЖЩǄѼ'.repeat(5) + 'ΩЖ']] as const) {
    await validate(config(types, 100, text), 'fill-lid-' + text.slice(0, 8));
    const last = results.at(-1) as { dimensionsMm: number[]; textBoundsMm: { min: number[]; max: number[] } };
    const gaps = [0, 1].map(i => last.dimensionsMm[i] - 2 * TRAY_LID.textInset - (last.textBoundsMm.max[i] - last.textBoundsMm.min[i]));
    assert.ok(Math.min(...gaps.map(Math.abs)) < .02, 'Fill lid must reach one actual printable text boundary');
  }
  const explicit = config(KEY_TYPES, 6, 'Keys'), legacy = structuredClone(explicit);
  delete (legacy.options.tray as Partial<HolderConfig['options']['tray']>).lidTextSize;
  assert.deepEqual(buildProject(legacy), buildProject(explicit), 'Omitted old-project lid text size does not retain the 6 mm default');
  probes.push({ name: 'requested-text-size-applies-to-actual-engraving', measured: scaling, legacyDefaultSourceAndPlacementUnchanged: true });
  await mkdir('artifacts', { recursive: true });
  await writeFile(output, JSON.stringify({ status: 'passed', command: 'node --import tsx scripts/validate-lid-options.ts', seconds: (performance.now() - started) / 1000, librarySha256: hash(library), renders, notchSamples, results, probes, limitation: 'Geometry and assembly clearances are verified; physical printing remains untested.' }, null, 2) + '\n');
  console.log(`PASS ${results.length} lid scenarios, ${renders} renders, ${notchSamples} notch samples, ${probes.length} checks. ${output}`);
} catch (error) {
  await mkdir('artifacts', { recursive: true });
  await writeFile(output, JSON.stringify({ status: 'failed', error: String(error), librarySha256: hash(library), renders, notchSamples, results, probes }, null, 2) + '\n');
  throw error;
}
