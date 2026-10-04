import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { unzipSync, strFromU8 } from 'fflate';
import { defaultConfig } from '../src/config';
import { appendLayer } from '../src/layers';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { build3mf } from '../src/three-mf';
import type { HolderConfig, ProjectGeometry, TrayConnection } from '../src/types';

const server = await createServer({ configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject, compactTray } = await server.ssrLoadModule('/src/geometry/index.ts') as { buildProject(c: HolderConfig): ProjectGeometry; compactTray(c: HolderConfig): HolderConfig };
const { buildTraySet } = await server.ssrLoadModule('/src/geometry/layers.ts') as { buildTraySet(c: HolderConfig): ProjectGeometry };
await server.close();
const report: unknown[] = [];
const cache = new Map<string, ArrayBuffer>();
await mkdir('artifacts/tray-layers', { recursive: true });

async function check(name: string, project: ProjectGeometry) {
  const meshes = new Map<string, ArrayBuffer>();
  for (const part of project.parts) {
    let stl = cache.get(part.scad);
    if (!stl) {
      const result = await renderScadInNode(part.scad);
      assert.ok(result.stl, `${name}/${part.id}: empty output`);
      assert.ok(!result.logs.some(l => /WARNING:|ERROR:/.test(l)), result.logs.join('\n'));
      stl = result.stl; cache.set(part.scad, stl);
    }
    const mesh = inspectPrintableMesh(stl);
    assert.equal(mesh.components, 1, `${name}/${part.id}: disconnected printed features`);
    assert.ok(Math.abs(mesh.min[2]) < .001, 'Print must rest on Z=0');
    meshes.set(part.id, stl);
    report.push({ scenario: name, part: part.id, ...mesh });
    await writeFile(`artifacts/tray-layers/${name}-${part.id}.stl`, new Uint8Array(stl));
    console.log(`PASS ${name}/${part.id}: ${mesh.triangles} triangles, ${mesh.volume.toFixed(1)} mm³`);
  }
  const file = build3mf(project, meshes);
  const xml = strFromU8(unzipSync(file)['3D/3dmodel.model']);
  assert.equal((xml.match(/<object /g) ?? []).length, project.parts.length);
  await writeFile(`artifacts/tray-layers/${name}.3mf`, file);
}

for (const connection of ['none', 'stackable', 'snap_fit', 'h20_slide_v7'] as TrayConnection[]) {
  const c = defaultConfig();
  c.slots.forEach((s, i) => { s.rotation = i % 2 ? 90 : 0; });
  Object.assign(c.options.tray, { columns: 3, retention: true, connection, scoop: 'large' });
  if (connection === 'snap_fit') c.options.tray.height = 10;
  await check(`mixed-${connection}`, buildProject(c));
}
const c = defaultConfig();
c.slots = c.slots.slice(0, 2); c.slots[1].rotation = 90;
Object.assign(c.options.tray, { footprint: { width: 120, depth: 90 }, connection: 'h20_slide_v7', lid: true });
const set = appendLayer(c, 0, { footprint: c.options.tray.footprint! });
await check('two-layer-empty-top', buildTraySet(set));
const compact = compactTray(defaultConfig());
await check('compact-mixed-keys', buildProject(compact));
Object.assign(compact.options.tray, { connection: 'h20_slide_v7', lid: true, retention: true });
const autoSet = appendLayer(compact, 0, { footprint: { width: 80, depth: 80 } });
autoSet.layers![0].config.slots = defaultConfig().slots.slice(0, 3);
autoSet.layers![0].config.slots[0].rotation = 90;
autoSet.layers![0].config.options.tray.columns = 1;
await check('automatic-size-compact-set', buildTraySet(autoSet));
await writeFile('artifacts/tray-layers/report.json', JSON.stringify(report, null, 2));
console.log(`Verified ${report.length} printable meshes and their 3MF objects.`);
