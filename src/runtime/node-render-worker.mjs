// Node-only verification worker. The web application imports render.worker.ts.
import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import createOpenSCAD from '@lofcz/openscad-wasm';
import { addFonts } from '@lofcz/openscad-wasm/fonts';

const logs = [];
try {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('@lofcz/openscad-wasm/package.json'));
  const binary = await readFile(join(root, 'openscad.wasm'));
  const instance = await createOpenSCAD({
    noInitialRun: true,
    print: (line) => logs.push(line),
    printErr: (line) => logs.push(line),
    instantiateWasm(imports, done) {
      WebAssembly.instantiate(binary, imports).then((result) => done(result.instance));
      return {};
    },
  });
  addFonts(instance);
  for (const [path, bytes] of Object.entries(workerData.files ?? {})) {
    instance.FS.writeFile(path, bytes);
  }
  instance.FS.writeFile('/input.scad', workerData.scad);
  const exit = instance.callMain([
    '/input.scad', '--enable=textmetrics', '--backend', 'Manifold', '--export-format', 'binstl', '-o', '/out.stl',
  ]);
  if (workerData.allowEmpty && logs.some((line) => line.includes('Current top level object is empty.')) && !logs.some((line) => /^ERROR:/.test(line))) {
    parentPort.postMessage({ stl: null, logs });
  } else {
    if (exit !== 0) throw new Error(`OpenSCAD exited with code ${exit}`);
    const stl = new Uint8Array(instance.FS.readFile('/out.stl', { encoding: 'binary' })).buffer;
    parentPort.postMessage({ stl, logs }, [stl]);
  }
} catch (error) {
  parentPort.postMessage({ error: error instanceof Error ? error.message : String(error), logs });
}
