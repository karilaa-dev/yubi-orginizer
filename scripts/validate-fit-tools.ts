import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Euler, Matrix4, Vector3 } from 'three';
import { defaultConfig } from '../src/config';
import type { HolderConfig, ProjectGeometry, SocketProfile } from '../src/types';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh, type MeshInspection } from '../src/runtime/mesh-check';

const server = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject, buildFitTests, keyDimensions } = await server.ssrLoadModule('/src/geometry/index.ts') as {
  buildProject(c: HolderConfig): ProjectGeometry;
  buildFitTests(kind?: 'all' | 'grid' | 'rail' | 'lid' | 'tray_snap'): ProjectGeometry;
  keyDimensions: Record<SocketProfile, { socketDepth: number }>;
};
const { scadCall, library } = await server.ssrLoadModule('/src/geometry/library.ts') as { scadCall(name: string, args: unknown[]): string; library: string };
await server.close();

function zHits(buffer: ArrayBuffer, x: number, y: number): number[] {
  const data = new DataView(buffer), hits: number[] = [];
  for (let i = 0; i < data.getUint32(80, true); i++) {
    const [a, b, c] = Array.from({ length: 3 }, (_, v) => [0, 1, 2].map((axis) => data.getFloat32(84 + 50 * i + 12 + 12 * v + 4 * axis, true)));
    const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(d) < 1e-10) continue;
    const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
    const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
    if (u >= -1e-6 && v >= -1e-6 && u + v <= 1 + 1e-6) hits.push(u * a[2] + v * b[2] + (1 - u - v) * c[2]);
  }
  return hits;
}

const results: { scenario: string; triangles: number; volume: number; components: number }[] = [];
let floorChecks = 0;
let baselineEqualityChecks = 0;
let dimensionalOffsetChecks = 0;
async function render(source: string, scenario: string, printable = true) {
  const result = await renderScadInNode(source);
  assert.ok(result.stl);
  let mesh: MeshInspection;
  try { mesh = inspectPrintableMesh(result.stl, printable); }
  catch (error) { throw new Error(`${scenario}: ${String(error)}`, { cause: error }); }
  results.push({ scenario, triangles: mesh.triangles, volume: Number(mesh.volume.toFixed(4)), components: mesh.components });
  return { stl: result.stl, mesh };
}

for (const profile of ['A', 'C', 'AN', 'CN'] as const) {
  for (const setting of [
    { name: 'baseline', startOffset: -0.1, step: 0.1, samples: 3 },
    { name: 'tight-limit', startOffset: -0.3, step: 0.05, samples: 5 },
    { name: 'loose-limit', startOffset: 0.3, step: 0.2, samples: 5 },
  ] as const) {
    const c = defaultConfig(); c.template = 'key_fit_tester'; c.slots = [];
    c.options.tester = { profile, startOffset: setting.startOffset, step: setting.step, samples: setting.samples };
    const project = buildProject(c);
    assert.equal(project.keys.length, 0);
    const rendered = await render(project.parts[0].scad, `${profile}/${setting.name}`);
    for (let i = 0; i < setting.samples; i++) {
      const hits = zHits(rendered.stl, (i - (setting.samples - 1) / 2) * 22, 3);
      assert.ok(hits.some((z) => Math.abs(z - 3) < 0.001), `${profile}/${setting.name}: socket floor differs from 3mm`);
      floorChecks++;
    }
  }
  const original = await render(scadCall('socket_cut', [profile, 13]), `${profile}/original-cutter`, false);
  const zero = await render(scadCall('offset_socket_cut', [profile, 13, 0]), `${profile}/zero-cutter`, false);
  assert.deepEqual(new Uint8Array(zero.stl), new Uint8Array(original.stl), `${profile}: zero changes accepted geometry`);
  baselineEqualityChecks++;
  for (const offset of [-0.3, 1.1]) {
    const shifted = await render(scadCall('offset_socket_cut', [profile, 13, offset]), `${profile}/cutter-offset-${offset}`, false);
    for (const axis of [0, 1]) {
      const expected = original.mesh.max[axis] - original.mesh.min[axis] + 2 * offset;
      assert.ok(Math.abs(shifted.mesh.max[axis] - shifted.mesh.min[axis] - expected) < 0.002, `${profile}: offset is not per-side XY`);
      dimensionalOffsetChecks++;
    }
    assert.ok(Math.abs(shifted.mesh.min[2] - (13 - keyDimensions[profile].socketDepth)) < 0.001);
    assert.ok(Math.abs(shifted.mesh.max[2] - original.mesh.max[2]) < 0.001);
  }
  console.log(`PASS ${profile}: three coupons, fixed depth, exact zero, per-side offsets`);
}

const interfaceMeshes = new Map<string, MeshInspection>();
const interfaceSources = new Map<string, string>();
for (const p of buildFitTests().parts) {
  const r = await render(p.scad, `interfaces/${p.id}`);
  interfaceMeshes.set(p.id, r.mesh); interfaceSources.set(p.id, p.scad);
}
for (const kind of ['grid', 'rail', 'lid', 'tray_snap', 'all'] as const) {
  const project = buildFitTests(kind), vertices: Vector3[] = [];
  for (const p of project.parts) {
    assert.equal(p.scad, interfaceSources.get(p.id));
    const bounds = interfaceMeshes.get(p.id)!;
    const rotation = new Matrix4().makeRotationFromEuler(new Euler(...p.rotation, 'XYZ'));
    for (const x of [bounds.min[0], bounds.max[0]]) for (const y of [bounds.min[1], bounds.max[1]]) for (const z of [bounds.min[2], bounds.max[2]]) {
      vertices.push(new Vector3(x, y, z).applyMatrix4(rotation).add(new Vector3(...p.position)));
    }
  }
  for (const axis of [0, 1, 2]) {
    const coordinates = vertices.map((v) => v.getComponent(axis));
    assert.ok(Math.abs(Math.max(...coordinates) - Math.min(...coordinates) - project.dimensions[axis]) < 0.001, `${kind}: incorrect displayed dimensions`);
  }
}
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/fit-tools-validation.json', JSON.stringify({ status: 'passed', librarySha256: createHash('sha256').update(library).digest('hex'), command: 'node --import tsx scripts/validate-fit-tools.ts', renderedParts: results.length, floorChecks, baselineEqualityChecks, dimensionalOffsetChecks, interfaceDimensionChecks: 5, results }, null, 2) + '\n');
console.log(`PASS ${results.length} renders; ${floorChecks} socket floors; ${baselineEqualityChecks} byte-identical baselines; all interface selections have verified dimensions`);
