/** Rebuild the compact production cutter from the accepted 7B motion envelope.
 * Run: node --import tsx scripts/build-c-nano-pry-7b.ts
 * If the approved sample is present, also compare the complete pocket below
 * its deck. A Boolean returning empty is accepted only with clean render logs. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { Vector3 } from 'three';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { renderScadInNode, type NodeRenderOptions } from '../src/runtime/node-render';
import type { Vec3 } from '../src/types';

const output = 'artifacts/c-nano-pry-7b-integration';
const profilePath = 'src/geometry/profiles/c-nano-pry-7b.scad';
const approvedPath = 'artifacts/c-nano-pry-refinements/c-nano-pry-7B.stl';
const clearance = 0.2, guard = 0.001, segments = 32, maxAngle = 20;
const receipts: Record<string, unknown>[] = [];
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
await mkdir(output, { recursive: true });

async function render(name: string, scad: string, options: NodeRenderOptions = {}) {
  const result = await renderScadInNode(scad, options);
  const errors = result.logs.filter(line => /\bERROR\b|CGAL error|assertion violation|failed with error|not valid|Unable to|Can't open import|can't open file/i.test(line));
  receipts.push({ name, scadSha256: hash(scad), logs: result.logs, passed: errors.length === 0 });
  await writeFile(`${output}/renderer-receipts.json`, JSON.stringify(receipts, null, 2) + '\n');
  assert.equal(errors.length, 0, `${name}: ${errors.join('\n')}`);
  return result.stl;
}

async function loadGeometry() {
  const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true, include: [] },
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { buildKeyScad } = await server.ssrLoadModule('/src/geometry/keys.ts') as { buildKeyScad(type: 'CN', component?: 'all' | 'body'): string };
    const { library } = await server.ssrLoadModule('/src/geometry/library.ts') as { library: string };
    return { buildKeyScad, library };
  } finally { await server.close(); }
}

function meshData(mesh: ArrayBuffer) {
  const data = new DataView(mesh), points: Vec3[] = [], faces: number[][] = [], indices = new Map<string, number>();
  for (let t = 0; t < data.getUint32(80, true); t++) {
    const face: number[] = [];
    for (let v = 0; v < 3; v++) {
      const p = [0, 1, 2].map(a => data.getFloat32(96 + t * 50 + v * 12 + a * 4, true)) as Vec3;
      const name = p.join(',');
      let index = indices.get(name);
      if (index === undefined) { index = points.length; indices.set(name, index); points.push(p); }
      face.push(index);
    }
    faces.push(face.reverse()); // OpenSCAD faces wind opposite to STL triangles.
  }
  return { points, faces };
}

function sweep(bodyPoints: Vec3[]) {
  const radius = (clearance + guard) / Math.cos(Math.PI / segments), cells: string[] = [];
  // Convex vertex sums are equivalent to an XY Minkowski offset per motion
  // cell. Unlike nonconvex minkowski(), this does not trigger CGAL decomposition
  // failures. The 0.001 mm guard exceeds the 1-degree chord sag (<0.0004 mm).
  for (let start = 0; start < maxAngle; start++) {
    const cloud: Vector3[] = [];
    for (const angle of [start, start + 1]) {
      const theta = angle * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta);
      for (const [x, y, z] of bodyPoints) for (let i = 0; i < segments; i++) for (const up of [-guard, 12 + guard]) {
        const phi = i * 2 * Math.PI / segments;
        cloud.push(new Vector3(x + radius * Math.cos(phi), y * c - (z + 3.5) * s - 5.05 + radius * Math.sin(phi),
          2 + y * s + (z + 3.5) * c + up));
      }
    }
    const hull = new ConvexGeometry(cloud), attribute = hull.getAttribute('position');
    const points: number[][] = [], indices = new Map<string, number>(), faces: number[][] = [];
    for (let t = 0; t < attribute.count; t += 3) {
      const face: number[] = [];
      for (let v = 0; v < 3; v++) {
        const p = [attribute.getX(t + v), attribute.getY(t + v), attribute.getZ(t + v)], name = p.join(',');
        let index = indices.get(name);
        if (index === undefined) { index = points.length; indices.set(name, index); points.push(p); }
        face.push(index);
      }
      faces.push(face.reverse());
    }
    hull.dispose();
    cells.push(`polyhedron(points=${JSON.stringify(points)},faces=${JSON.stringify(faces)},convexity=10);`);
  }
  return `intersection(){union(){${cells.join('\n')}}translate([-7,-8.2,2])cube([14,6.61716,6.75]);}`;
}

function volume(mesh: ArrayBuffer | null) {
  if (!mesh) return 0;
  const data = new DataView(mesh); let sum = 0;
  for (let t = 0; t < data.getUint32(80, true); t++) {
    const [a, b, c] = [0, 1, 2].map(v => [0, 1, 2].map(i => data.getFloat32(96 + t * 50 + v * 12 + i * 4, true)));
    sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(sum);
}

const { buildKeyScad } = await loadGeometry();
const bodyScad = buildKeyScad('CN', 'body');
const body = await render('live nominal CN body', bodyScad); assert.ok(body);
const expandedScad = sweep(meshData(body).points);
const cutter = await render('union and clip the accepted sweep', expandedScad); assert.ok(cutter);
const cutterInspection = inspectPrintableMesh(cutter, false);
const { points, faces } = meshData(cutter);
const profile = `// Generated by scripts/build-c-nano-pry-7b.ts; do not hand edit.\n` +
  `// Accepted 7B: 0..20 degree pry, 0.20 mm XY clearance + 0.001 mm guard.\n` +
  `// Datum: nominal deck Z=8.6, body floor Z=2, pivot [0,-5.05,2].\n` +
  `// Source body SCAD sha256: ${hash(bodyScad)}\n` +
  `// Source body STL sha256: ${hash(new Uint8Array(body))}\n` +
  `// Union STL sha256: ${hash(new Uint8Array(cutter))}\n` +
  `// Frozen union: ${points.length} vertices, ${faces.length} triangles; no scaling.\n` +
  `module cn_pry_7b_profile() {\n  polyhedron(points=${JSON.stringify(points)},\n    faces=${JSON.stringify(faces)},convexity=10);\n}\n`;
await writeFile(profilePath, profile);
await writeFile(`${output}/rear-cutter.stl`, new Uint8Array(cutter));

const frozen = await render('frozen production polyhedron', `${profile}\ncn_pry_7b_profile();`); assert.ok(frozen);
const files = { '/sweep.stl': new Uint8Array(cutter), '/frozen.stl': new Uint8Array(frozen) };
const frozenDifference = volume(await render('frozen cutter symmetric difference', 'union(){difference(){import("/sweep.stl");import("/frozen.stl");}difference(){import("/frozen.stl");import("/sweep.stl");}}', { files, allowEmpty: true }));
assert.ok(frozenDifference < 1e-5, `Frozen cutter changed volume by ${frozenDifference} mm3`);

const report: Record<string, unknown> = { passed: true, clearanceMm: clearance, maxPryAngleDegrees: maxAngle, cutterInspection,
  profileBytes: Buffer.byteLength(profile), expandedBytes: Buffer.byteLength(expandedScad),
  profileSha256: hash(profile), bodyScadSha256: hash(bodyScad), bodyStlSha256: hash(new Uint8Array(body)),
  cutterStlSha256: hash(new Uint8Array(cutter)), frozenSymmetricDifferenceMm3: frozenDifference };
try {
  await access(approvedPath);
  const approved = await readFile(approvedPath);
  const { library } = await loadGeometry();
  const couponScad = `${library}\n$fn=96;difference(){slab(40,40,8.6,3);body_cut("CN",8.6);cn_connector_grip(8.6);}`;
  const coupon = await render('production pocket validation coupon', couponScad); assert.ok(coupon);
  report.couponInspection = inspectPrintableMesh(coupon);
  await writeFile(`${output}/production-coupon.stl`, new Uint8Array(coupon));
  const comparison = await render('approved 7B below-deck symmetric difference', 'intersection(){translate([-20,-20,.001])cube([40,40,8.598]);union(){difference(){import("/approved.stl");import("/production.stl");}difference(){import("/production.stl");import("/approved.stl");}}}',
    { files: { '/approved.stl': new Uint8Array(approved), '/production.stl': new Uint8Array(coupon) }, allowEmpty: true });
  report.approvedCouponSymmetricDifferenceMm3 = volume(comparison);
  report.approvedStlSha256 = hash(approved);
  report.productionCouponSha256 = hash(new Uint8Array(coupon));
  assert.ok(volume(comparison) < 1e-5, `Production pocket differs from approved 7B by ${volume(comparison)} mm3`);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  report.approvedCouponComparison = 'Skipped: optional approved sample artifact is absent.';
}
await writeFile(`${output}/build-validation.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
