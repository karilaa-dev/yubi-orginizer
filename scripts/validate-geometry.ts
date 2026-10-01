import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer } from 'vite';
import { defaultConfig, KEY_TYPES, TEMPLATES } from '../src/config';
import type { HolderConfig, PartSpec, ProjectGeometry, Vec3 } from '../src/types';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh, type MeshInspection } from '../src/runtime/mesh-check';

// Vite resolves the same ?raw research imports used by the browser application.
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
});
const geometry = await server.ssrLoadModule('/src/geometry/index.ts') as {
  buildProject(config: HolderConfig): ProjectGeometry;
  buildTraySnapTest(): ProjectGeometry;
  buildTrayH20Test(): ProjectGeometry;
};
await server.close();

type RenderedPart = { part: PartSpec; mesh: MeshInspection; stl: ArrayBuffer };
const report: { scenario: string; part: string; triangles: number; volume: number; collinearTriangles: number; components: number }[] = [];
let intersectionChecks = 0;
const filter = process.argv.find((argument) => argument.startsWith('--filter='))?.slice('--filter='.length);

function transform(point: Vec3, part: PartSpec): Vec3 {
  // Part rotations are radians, matching the Three.js preview contract.
  const [rx, ry, rz] = part.rotation;
  let [x, y, z] = point;
  [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
  [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
  [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
  return [x + part.position[0], y + part.position[1], z + part.position[2]];
}

function worldBounds(rendered: RenderedPart): { min: Vec3; max: Vec3 } {
  const corners: Vec3[] = [];
  for (const x of [rendered.mesh.min[0], rendered.mesh.max[0]]) {
    for (const y of [rendered.mesh.min[1], rendered.mesh.max[1]]) {
      for (const z of [rendered.mesh.min[2], rendered.mesh.max[2]]) corners.push(transform([x, y, z], rendered.part));
    }
  }
  return {
    min: [0, 1, 2].map((axis) => Math.min(...corners.map((p) => p[axis]))) as Vec3,
    max: [0, 1, 2].map((axis) => Math.max(...corners.map((p) => p[axis]))) as Vec3,
  };
}

function signedVolume(buffer: ArrayBuffer): number {
  const data = new DataView(buffer);
  let volume = 0;
  for (let t = 0; t < data.getUint32(80, true); t++) {
    const p = Array.from({ length: 3 }, (_, v) => [0, 1, 2].map((axis) => data.getFloat32(84 + 50 * t + 12 + v * 12 + axis * 4, true)));
    const [a, b, c] = p;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return volume;
}

async function checkIntersections(parts: RenderedPart[], scenario: string): Promise<void> {
  const bounds = parts.map(worldBounds);
  for (let a = 0; a < parts.length; a++) for (let b = a + 1; b < parts.length; b++) {
    if ([0, 1, 2].some((axis) => Math.min(bounds[a].max[axis], bounds[b].max[axis]) - Math.max(bounds[a].min[axis], bounds[b].min[axis]) < 0.001)) continue;
    const place = (part: PartSpec, file: string) => `translate(${JSON.stringify(part.position)}) rotate(${JSON.stringify(part.rotation.map((r) => r * 180 / Math.PI))}) import("${file}");`;
    const result = await renderScadInNode(`intersection() { ${place(parts[a].part, '/a.stl')} ${place(parts[b].part, '/b.stl')} }`, {
      allowEmpty: true,
      files: { '/a.stl': new Uint8Array(parts[a].stl), '/b.stl': new Uint8Array(parts[b].stl) },
    });
    intersectionChecks++;
    // OpenSCAD may export coincident contact surfaces as a zero-volume STL.
    const overlap = result.stl ? Math.abs(signedVolume(result.stl)) : 0;
    assert.ok(overlap < 0.00001, `${scenario}: assembled ${parts[a].part.id} intersects ${parts[b].part.id} by ${overlap} mm³`);
  }
}

async function checkParts(scenario: string, parts: PartSpec[], intersections = false): Promise<void> {
  if (filter && !scenario.includes(filter)) return;
  assert.ok(parts.length > 0, `${scenario}: no printable parts`);
  assert.equal(new Set(parts.map((part) => part.id)).size, parts.length, `${scenario}: duplicate part IDs`);
  const rendered: RenderedPart[] = [];
  for (const part of parts) {
    const result = await renderScadInNode(part.scad);
    assert.ok(result.stl, `${scenario}/${part.id}: no STL`);
    let mesh: MeshInspection;
    try { mesh = inspectPrintableMesh(result.stl); }
    catch (error) { throw new Error(`${scenario}/${part.id}: ${String(error)}\n${result.logs.join('\n')}`); }
    rendered.push({ part, mesh, stl: result.stl });
    report.push({ scenario, part: part.id, triangles: mesh.triangles, volume: Number(mesh.volume.toFixed(3)), collinearTriangles: mesh.collinearTriangles, components: mesh.components });
  }
  if (intersections) await checkIntersections(rendered, scenario);
  console.log(`PASS ${scenario}: ${parts.length} printable part(s)`);
}

const started = performance.now();
for (const template of TEMPLATES) {
  const all = defaultConfig();
  all.template = template.id;
  await checkParts(`${template.id}/all-six`, geometry.buildProject(all).parts, true);
  for (const type of KEY_TYPES) {
    const single = structuredClone(all);
    single.slots = [{ id: 'single', type, label: type, occupied: true }];
    await checkParts(`${template.id}/single-${type}`, geometry.buildProject(single).parts);
  }
  const duplicate = structuredClone(all);
  duplicate.slots = [...all.slots, ...all.slots.map((slot) => ({ ...slot, id: `${slot.id}-again` }))];
  duplicate.labels = false;
  await checkParts(`${template.id}/repeated-six-no-labels`, geometry.buildProject(duplicate).parts);
}

const labels = defaultConfig();
labels.template = 'desktop_dock';
labels.slots = [{ id: 'escaped', type: 'C', label: 'a"\\();$%ΩЖ', occupied: true }];
labels.options.dock.title = '";cube(999); // ΩЖ';
await checkParts('escaped-unicode-labels', geometry.buildProject(labels).parts);

await checkParts('tray-snap-test', geometry.buildTraySnapTest().parts, true);
await checkParts('tray-h20-test', geometry.buildTrayH20Test().parts, true);

// Opt-in high-capacity regression run: the default suite already exercises all
// templates, every individual key, and repetitions.
if (process.argv.includes('--stress')) {
  for (const template of TEMPLATES) {
    const config = defaultConfig();
    config.template = template.id;
    config.slots = Array.from({ length: 48 }, (_, i) => ({ id: `stress-${i}`, type: KEY_TYPES[i % KEY_TYPES.length], label: `${i + 1}`, occupied: true }));
    config.labels = false;
    await checkParts(`${template.id}/48-keys`, geometry.buildProject(config).parts);
  }
}

assert.ok(report.length > 0, `No validation scenarios matched ${filter ?? 'the requested run'}.`);
const summary = { status: 'passed', filter: filter ?? null, renderedParts: report.length, intersectionChecks, seconds: Number(((performance.now() - started) / 1000).toFixed(1)) };
const reportPath = process.argv.find((argument) => argument.startsWith('--report='))?.slice('--report='.length);
if (reportPath) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify({ ...summary, results: report }, null, 2) + '\n');
}
console.log(JSON.stringify({ ...summary, ...(reportPath ? { reportPath } : {}) }, null, 2));
