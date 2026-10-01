import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { defaultConfig, KEY_TYPES, TEMPLATES } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import type { HolderConfig, KeyType, PartSpec, ProjectGeometry } from '../src/types';

// Reproduces the size-boundary matrix first executed inline during implementation.
// Run: node --import tsx scripts/validate-size-controls.ts
const server = await createServer({
  configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const { buildProject, keyDimensions } = await server.ssrLoadModule('/src/geometry/index.ts') as {
  buildProject(config: HolderConfig): ProjectGeometry;
  keyDimensions: Record<KeyType, { length: number }>;
};
await server.close();

function trianglePoints(data: DataView, index: number): number[][] {
  return Array.from({ length: 3 }, (_, vertex) => [0, 1, 2].map((axis) => data.getFloat32(84 + 50 * index + 12 + 12 * vertex + 4 * axis, true)));
}

/** Vertical ray intersections with the actual triangle surface, in millimetres. */
function zHits(buffer: ArrayBuffer, x: number, y: number): number[] {
  const data = new DataView(buffer);
  const hits: number[] = [];
  for (let i = 0; i < data.getUint32(80, true); i++) {
    const [a, b, c] = trianglePoints(data, i);
    const denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(denominator) < 1e-10) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / denominator;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / denominator;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) hits.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
  }
  return [...new Set(hits.map((z) => Math.round(z * 1e4) / 1e4))].sort((a, b) => a - b);
}

const scenarios: { scenario: string; renderedParts: number; dimensionsMm: number[]; status: 'passed' }[] = [];
const floors: { scenario: string; part: string; expectedFloorMm: number; toleranceMm: number; status: 'passed' }[] = [];
let renderedParts = 0;

for (const limit of ['min', 'max'] as const) for (const template of TEMPLATES) {
  const config = defaultConfig();
  config.template = template.id;
  config.slots = KEY_TYPES.map((type, i) => ({ id: `key-${i}`, type, label: type, occupied: true }));
  Object.assign(config.options.dock, limit === 'min'
    ? { columns: 3, spacing: 22, rowSpacing: 18, edgeMargin: 12, depthMargin: 18, height: 11 }
    : { columns: 3, spacing: 40, rowSpacing: 70, edgeMargin: 40, depthMargin: 45, height: 25 });
  Object.assign(config.options.tray, limit === 'min'
    ? { columns: 3, spacing: 24, margin: 5, height: 8.6, scoop: 'large' }
    : { columns: 3, spacing: 42, margin: 20, height: 20, scoop: 'large' });
  const project = buildProject(config);
  const rendered: { part: PartSpec; stl: ArrayBuffer }[] = [];
  for (const part of project.parts) {
    const result = await renderScadInNode(part.scad);
    assert.ok(result.stl);
    inspectPrintableMesh(result.stl);
    rendered.push({ part, stl: result.stl });
    renderedParts++;
  }
  const scenario = `${limit}/${template.id}`;
  if (config.template === 'desktop_dock') {
    const key = project.keys[0];
    const floor = config.options.dock.height - 8.5;
    const hits = zHits(rendered[0].stl, key.position[0], key.position[1]);
    assert.ok(hits.some((z) => Math.abs(z - floor) < 0.001), `${scenario}: incorrect socket floor ${hits}`);
    assert.ok(floor >= 2.5);
    floors.push({ scenario, part: 'dock', expectedFloorMm: floor, toleranceMm: 0.001, status: 'passed' });
  }
  if (config.template === 'inventory_tray') {
    const entry = rendered.find((r) => r.part.id === 'tray')!;
    const key = project.keys.find((k) => k.type === 'CN')!;
    const floor = config.options.tray.height - 6.6;
    const hits = zHits(entry.stl, key.position[0], key.position[1] + keyDimensions.CN.length / 2);
    assert.ok(hits.some((z) => Math.abs(z - floor) < 0.001), `${scenario}: incorrect pocket floor ${hits}`);
    assert.ok(floor >= 1.999);
    floors.push({ scenario, part: 'tray', expectedFloorMm: Number(floor.toFixed(4)), toleranceMm: 0.001, status: 'passed' });
  }
  scenarios.push({ scenario, renderedParts: rendered.length, dimensionsMm: project.dimensions.map((n) => Number(n.toFixed(4))), status: 'passed' });
  console.log(`PASS ${scenario}: ${rendered.length} watertight connected parts; dimensions ${project.dimensions.join('×')}`);
}

let reference: Uint8Array | undefined;
for (const type of ['C', 'CK', 'CI'] as const) {
  const config = defaultConfig();
  config.template = 'desktop_dock';
  config.slots = [{ id: 'same', type, label: '', occupied: true }];
  config.labels = false;
  config.options.dock.title = '';
  const result = await renderScadInNode(buildProject(config).parts[0].scad);
  assert.ok(result.stl);
  const bytes = new Uint8Array(result.stl);
  if (reference) assert.deepEqual(bytes, reference);
  else reference = bytes;
  renderedParts++;
}

const output = 'artifacts/size-controls-validation.json';
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({
  status: 'passed', command: 'node --import tsx scripts/validate-size-controls.ts',
  renderedParts, boundaryPartsChecked: 4, socketEquivalenceRenders: 3, meshFloorChecks: floors.length,
  checks: ['watertight boundary meshes', 'positive volume', 'single connected component', 'printable Z=0', 'actual mesh cavity floors', 'byte-identical C/CK/CI desktop STL'],
  scenarios, floors, socketEquivalence: { types: ['C', 'CK', 'CI'], labels: false, title: '', byteIdentical: true },
}, null, 2) + '\n');
console.log(`PASS ${renderedParts} renders, ${floors.length} floor probes, identical C/CK/CI STLs. Report: ${output}`);
