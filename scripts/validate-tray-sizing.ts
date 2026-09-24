import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { defaultConfig } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { readLegacyLidSize } from '../src/text-size';
import type { HolderConfig, ProjectGeometry } from '../src/types';

await mkdir('artifacts', { recursive: true });

const vite = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject, inventoryTrayLayout, trayStackPitch } = await vite.ssrLoadModule('/src/geometry/index.ts') as { buildProject(c: HolderConfig): ProjectGeometry; inventoryTrayLayout(c: HolderConfig): { width: number; depth: number; height: number }; trayStackPitch(h: number, r: boolean): number };
const { library } = await vite.ssrLoadModule('/src/geometry/library.ts') as { library: string };
await vite.close();
const checks: object[] = [];
function info(stl: ArrayBuffer) {
  const d = new DataView(stl), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; let signed = 0;
  for (let t = 0; t < d.getUint32(80, true); t++) {
    const [a, b, c] = [0, 1, 2].map(v => [0, 1, 2].map(i => d.getFloat32(96 + t * 50 + v * 12 + i * 4, true)));
    for (const p of [a, b, c]) for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], p[i]); max[i] = Math.max(max[i], p[i]); }
    signed += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return { min, max, volume: Math.abs(signed), size: max.map((v, i) => v - min[i]) };
}
async function render(source: string) {
  const r = await renderScadInNode(source); assert.ok(r.stl); inspectPrintableMesh(r.stl); return r.stl;
}
async function clear(name: string, source: string, files: Record<string, Uint8Array>) {
  const r = await renderScadInNode(source, { files, allowEmpty: true }); const v = r.stl ? info(r.stl).volume : 0;
  assert.ok(v < .00001, `${name}: ${v} mm³`); checks.push({ name, intersectionMm3: v });
}
for (const connection of ['snap_fit'] as const) {
  const five = defaultConfig(); five.template = 'inventory_tray'; five.slots = five.slots.slice(0, 5);
  Object.assign(five.options.tray, { columns: 3, connection, lid: true, lidText: 'Layer', lidTextPercent: 70 });
  const original = inventoryTrayLayout(five);
  five.options.tray.footprint = { width: original.width, depth: original.depth };
  const two = structuredClone(five); two.slots = two.slots.slice(0, 2);
  const a = buildProject(five), b = buildProject(two);
  assert.deepEqual(a.dimensions, b.dimensions); assert.equal(a.parts[1].scad, b.parts[1].scad);
  const A = await render(a.parts[0].scad), B = await render(b.parts[0].scad), lid = await render(b.parts[1].scad);
  for (const stl of [A, B, lid]) for (let i = 0; i < 2; i++) assert.ok(Math.abs(info(stl).size[i] - a.dimensions[i]) < .001);
  const files = { '/a.stl': new Uint8Array(A), '/b.stl': new Uint8Array(B), '/lid.stl': new Uint8Array(lid) };
  const pitch = trayStackPitch(inventoryTrayLayout(five).height, five.options.tray.retention);
  for (const [lower, upper] of [['a', 'b'], ['b', 'a']]) await clear(`${connection}/${lower}-under-${upper}`, `intersection(){import("/${lower}.stl");translate([0,0,${pitch}])import("/${upper}.stl");}`, files);
  await clear(`${connection}/lid`, `intersection(){import("/b.stl");translate(${JSON.stringify(b.parts[1].position)})rotate(${JSON.stringify(b.parts[1].rotation.map(r => r * 180 / Math.PI))})import("/lid.stl");}`, files);
  checks.push({ name: `${connection}/matching-five-and-two-key-parts`, dimensions: a.dimensions, parts: [A, B, lid].map(stl => inspectPrintableMesh(stl)) });
  console.log('PASS matching layers', connection);
}
for (const base of ['inventory_tray_lid_percent', 'tray_snap_lid']) {
  const blank = await render(`${library}${base}(100,65,"",100,0);`);
  const files = { '/blank.stl': new Uint8Array(blank) };
  for (const angle of [0, 90, 180, 270]) {
    const sizes: number[][] = [];
    for (const percentage of [50, 100]) {
      const stl = await render(`${library}${base}(100,65,"Keys ΩЖ",${percentage},${angle});`);
      const ink = await renderScadInNode('difference(){import("/blank.stl");import("/text.stl");}', { files: { ...files, '/text.stl': new Uint8Array(stl) } }); assert.ok(ink.stl);
      const measured = info(ink.stl); sizes.push(measured.size);
      assert.ok(measured.min[0] >= -44.001 && measured.max[0] <= 44.001 && measured.min[1] >= -26.501 && measured.max[1] <= 26.501);
      if (percentage === 100) assert.ok(Math.min(Math.abs(88 - measured.size[0]), Math.abs(53 - measured.size[1])) < .002);
      checks.push({ name: `${base}/${angle}deg/${percentage}percent`, inkBounds: measured });
    }
    for (let i = 0; i < 2; i++) assert.ok(Math.abs(sizes[0][i] * 2 - sizes[1][i]) < .002);
  }
  console.log('PASS percentages and rotations', base);
}
for (const [width, depth, oldSize, text] of [[100, 65, 6, 'Legacy'], [77, 67.3, 66, 'Ключи'], [29, 65, 100, 'Keys']] as const) {
  const legacy = await renderScadInNode(`${library}inventory_tray_lid(${width},${depth},${JSON.stringify(text)},${oldSize});`); assert.ok(legacy.stl);
  const conversion = legacy.logs.map(readLegacyLidSize).find(Boolean); assert.ok(conversion, legacy.logs.join('\n'));
  const current = await render(`${library}inventory_tray_lid_percent(${width},${depth},${JSON.stringify(text)},${conversion.percent},${conversion.rotation});`);
  const diff = await renderScadInNode('union(){difference(){import("/old.stl");import("/new.stl");}difference(){import("/new.stl");import("/old.stl");}}', { files: { '/old.stl': new Uint8Array(legacy.stl), '/new.stl': new Uint8Array(current) }, allowEmpty: true });
  const v = diff.stl ? info(diff.stl).volume : 0; assert.ok(v < .03, `Legacy conversion changed ${v} mm³`);
  checks.push({ name: `legacy-${oldSize}`, conversion, symmetricDifferenceMm3: v });
}
await writeFile('artifacts/tray-sizing-validation.json', JSON.stringify({ status: 'passed', librarySha256: createHash('sha256').update(library).digest('hex'), checks }, null, 2));
console.log('PASS', checks.length, 'manufacturing and text checks');
