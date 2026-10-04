/** Generate a real WASM inventory-tray-and-lid fixture, then validate the actual 3MF output.
 * node --import tsx scripts/validate-3mf.ts [--native=artifacts/3mf-native-roundtrip.3mf]
 * Native roundtrip command (isolated settings, no slicing/printer communication):
 * BambuStudio --datadir /tmp/keyform-bambu-3mf-check --arrange 1 --export-3mf
 *   /absolute/artifacts/3mf-native-roundtrip.3mf /absolute/artifacts/inventory-tray-example.3mf
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { build3mf, THREE_MF_PRINT_SETTINGS } from '../src/three-mf';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { createServer } from 'vite';
import { defaultConfig } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import type { HolderConfig, ProjectGeometry } from '../src/types';

const artifact = 'artifacts/inventory-tray-example.3mf';
const source = 'current inventory_tray generator';
await mkdir('artifacts', { recursive: true });
const vite = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject } = await vite.ssrLoadModule('/src/geometry/index.ts') as { buildProject(config: HolderConfig): ProjectGeometry };
await vite.close();
const config = defaultConfig(); config.template = 'inventory_tray'; config.slots = config.slots.slice(0, 1); config.options.tray.lid = true;
const project = buildProject(config);
// Use stable part IDs as names in the native roundtrip checks below.
const parts = project.parts.map(part => ({ ...part, name: part.id }));
project.parts = parts;
const meshes = new Map<string, ArrayBuffer>();
for (const part of parts) {
  const { stl } = await renderScadInNode(part.scad);
  assert.ok(stl); inspectPrintableMesh(stl); meshes.set(part.id, stl);
}
assert.equal(parts.length, 2, 'The inventory-tray fixture has a tray and a lid');
const output = build3mf(project, meshes);
await writeFile(artifact, output);
const entries = unzipSync(output);
const model = strFromU8(entries['3D/3dmodel.model']);
assert.match(model, /unit="millimeter"/);
assert.equal(entries['Metadata/project_settings.config'], undefined, 'Recommendations are per object only');

function attributes(tag: string): Record<string, string> {
  return Object.fromEntries([...tag.matchAll(/([\w_]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}
const itemTransforms = new Map([...model.matchAll(/<item\b([^>]*)\/>/g)].map((m) => {
  const attr = attributes(m[1]);
  return [attr.objectid, attr.transform.split(' ').map(Number)] as const;
}));
const checks = [...model.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)].map((object, index) => {
  const objectAttr = attributes(object[1]);
  const vertices = [...object[2].matchAll(/<vertex\b([^>]*)\/>/g)].map((match) => {
    const a = attributes(match[1]);
    return [Number(a.x), Number(a.y), Number(a.z)];
  });
  const triangles = [...object[2].matchAll(/<triangle\b([^>]*)\/>/g)].map((match) => {
    const a = attributes(match[1]);
    return [Number(a.v1), Number(a.v2), Number(a.v3)];
  });
  const reconstructed = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(reconstructed);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) => triangle.forEach((vertex, v) => {
    assert.ok(vertices[vertex], 'Triangle index references an existing vertex');
    vertices[vertex].forEach((coordinate, axis) => view.setFloat32(84 + t * 50 + 12 + v * 12 + axis * 4, coordinate, true));
  }));
  const inspection = inspectPrintableMesh(reconstructed);
  const original = inspectPrintableMesh(meshes.get(parts[index].id)!);
  assert.deepEqual(inspection, original, '3MF indexing preserves the source STL surface exactly');
  const transform = itemTransforms.get(objectAttr.id)!;
  assert.deepEqual(transform.slice(0, 9), [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(transform[11], 0);
  return { id: parts[index].id, ...inspection, buildTranslation: transform.slice(9) };
});
assert.equal(checks.length, parts.length);
for (let i = 0; i < checks.length; i++) for (let j = i + 1; j < checks.length; j++) {
  const a = checks[i]; const b = checks[j];
  assert.ok([0, 1].some((axis) => a.max[axis] + a.buildTranslation[axis] + 9.99 <= b.min[axis] + b.buildTranslation[axis] || b.max[axis] + b.buildTranslation[axis] + 9.99 <= a.min[axis] + a.buildTranslation[axis]), 'Build objects have at least 10 mm separation');
}

const nativePath = process.argv.find((arg) => arg.startsWith('--native='))?.slice('--native='.length);
let native: object | undefined;
if (nativePath) {
  const nativeBytes = await readFile(nativePath);
  const nativeEntries = unzipSync(nativeBytes);
  const nativeModel = strFromU8(nativeEntries['3D/3dmodel.model']);
  const application = nativeModel.match(/<metadata name="Application">([^<]*)<\/metadata>/)?.[1];
  assert.ok(application?.startsWith('BambuStudio-'), 'Native proof is a Bambu Studio re-export');
  const settings = strFromU8(nativeEntries['Metadata/model_settings.config']);
  const imported = [...settings.matchAll(/<object\b[^>]*>([\s\S]*?)<\/object>/g)].map((object) => {
    const objectOnly = object[1].split('<part')[0];
    const metadata = Object.fromEntries([...objectOnly.matchAll(/<metadata\b([^>]*)\/>/g)].map((match) => {
      const a = attributes(match[1]); return [a.key, a.value];
    }));
    for (const [key, value] of Object.entries(THREE_MF_PRINT_SETTINGS)) assert.equal(metadata[key], value);
    const meshStats = attributes(object[1].match(/<mesh_stat\b([^>]*)\/>/)![1]);
    for (const key of ['edges_fixed', 'degenerate_facets', 'facets_removed', 'facets_reversed', 'backwards_edges']) assert.equal(meshStats[key], '0', `Native import ${metadata.name}: ${key}`);
    const matchingMesh = checks.find((mesh) => mesh.id === metadata.name);
    assert.ok(matchingMesh);
    assert.equal(Number(meshStats.face_count), matchingMesh.triangles);
    return { name: metadata.name, sparse_infill_density: metadata.sparse_infill_density, wall_generator: metadata.wall_generator, brim_type: metadata.brim_type, meshStats };
  });
  assert.deepEqual(imported.map((object) => object.name).sort(), parts.map((part) => part.id).sort());
  native = { application, artifact: nativePath, bytes: nativeBytes.length, sha256: createHash('sha256').update(nativeBytes).digest('hex'), objects: imported };
}
const report = {
  artifact, source, bytes: output.length, sha256: createHash('sha256').update(output).digest('hex'),
  members: Object.keys(entries), settings: THREE_MF_PRINT_SETTINGS,
  settingsScope: 'Bambu Studio / OrcaSlicer per-object overrides. No printer or filament preset is embedded. Global defaults may remain unchanged.',
  meshes: checks, native,
  references: [
    'https://github.com/bambulab/BambuStudio/blob/master/src/libslic3r/Format/bbs_3mf.cpp',
    'https://github.com/OrcaSlicer/OrcaSlicer/blob/main/src/libslic3r/Format/bbs_3mf.cpp',
    'https://github.com/OrcaSlicer/OrcaSlicer/wiki/quality_settings_wall_generator',
    'https://github.com/3MFConsortium/spec_core/blob/master/3MF%20Core%20Specification.md',
  ],
};
await writeFile('artifacts/3mf-validation.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ artifact, bytes: output.length, meshes: checks.length, nativeObjectsVerified: native ? parts.length : 0 }));
