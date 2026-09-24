import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { renderScadInNode } from '../src/runtime/node-render';
import type { KeyType } from '../src/types';

const types: KeyType[] = ['A', 'C', 'AN', 'CN', 'CK', 'CI'];
const components = ['body', 'connector', 'touch'] as const;
type Component = typeof components[number];
type KeySourceBuilder = (type: KeyType, component: Component) => string;

// Use Vite's module loader because calibrated source imports use its ?raw syntax.
const server = await createServer({
  configFile: false,
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false },
  appType: 'custom',
  logLevel: 'error',
});
let buildKeyScad: KeySourceBuilder;
try {
  const module = await server.ssrLoadModule('/src/geometry/index.ts');
  if (typeof module.buildKeyScad !== 'function') throw new Error('The key source builder is unavailable.');
  buildKeyScad = module.buildKeyScad as KeySourceBuilder;
} finally {
  await server.close();
}

const output = resolve('public/keys');
await mkdir(output, { recursive: true });
const assets: { file: string; sha256: string; triangles: number; bytes: number }[] = [];

for (const type of types) {
  for (const component of components) {
    const scad = buildKeyScad(type, component);
    const result = await renderScadInNode(scad);
    if (!result.stl) throw new Error(`The ${type} ${component} reference is empty.`);
    const bytes = new Uint8Array(result.stl);
    const file = `${type}-${component}.stl`;
    const triangles = new DataView(result.stl).getUint32(80, true);
    await writeFile(resolve(output, file), bytes);
    assets.push({ file, sha256: createHash('sha256').update(bytes).digest('hex'), triangles, bytes: bytes.byteLength });
    console.log(`${file}: ${triangles} triangles, ${bytes.byteLength} bytes`);
  }
}

await writeFile(resolve(output, 'manifest.json'), JSON.stringify({
  version: 1,
  purpose: 'Display references only. Never combine these meshes with printable exports.',
  units: 'millimeters',
  coordinates: 'X centered; Y follows the original nominal silhouette from 0 to key length; Z centered on thickness.',
  materials: {
    body: 'dark polymer',
    connector: 'dark polymer for A and AN; silver metal for C, CN, CK, and CI',
    touch: 'gold touch contacts and exposed pads',
  },
  generator: '@lofcz/openscad-wasm@0.0.2 with Manifold',
  assets,
}, null, 2) + '\n');
console.log(`Generated ${assets.length} local reference meshes (${assets.reduce((sum, asset) => sum + asset.bytes, 0)} bytes).`);
