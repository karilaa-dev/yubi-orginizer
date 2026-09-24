import createOpenSCAD from '@lofcz/openscad-wasm';
import { addFonts } from '@lofcz/openscad-wasm/fonts';
import type { RenderIdentity, RenderRequest, RenderResponse } from './protocol';
import { removeCollapsedTriangles } from './stl';

// Explicitly declare the small worker surface so this module does not need the
// conflicting DOM and WebWorker library declarations in the application's tsconfig.
declare const self: {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage(message: RenderResponse, transfer?: Transferable[]): void;
};

let started = false;

self.onmessage = (event) => {
  const request = event.data;
  if (started || request.type !== 'render') return;
  started = true;
  const identity: RenderIdentity = {
    jobId: request.jobId,
    revision: request.revision,
    partId: request.partId,
  };
  const log = (line: string) => self.postMessage({ ...identity, type: 'log', line });
  void (async () => {
    try {
      const instance = await createOpenSCAD({
        noInitialRun: true,
        print: log,
        printErr: log,
      });
      addFonts(instance);
      instance.FS.writeFile('/input.scad', request.scad);
      const code = instance.callMain([
        '/input.scad', '--enable=textmetrics', '--backend', 'Manifold',
        '--export-format', 'binstl', '-o', '/out.stl',
      ]);
      if (code !== 0) throw new Error(`OpenSCAD could not render this part (exit ${code}).`);
      const output = instance.FS.readFile('/out.stl', { encoding: 'binary' });
      // Copy out of the WASM filesystem before transferring ownership to the UI.
      const stl = removeCollapsedTriangles(new Uint8Array(output).buffer);
      self.postMessage({ ...identity, type: 'result', stl }, [stl]);
    } catch (error) {
      self.postMessage({
        ...identity,
        type: 'error',
        message: error instanceof Error ? error.message : `OpenSCAD failed: ${String(error)}`,
      });
    }
  })();
};
