import { Worker } from 'node:worker_threads';
import { removeCollapsedTriangles } from './stl';

export interface NodeRenderOptions {
  allowEmpty?: boolean;
  files?: Record<string, Uint8Array>;
  timeoutMs?: number;
}

export interface NodeRenderResult {
  stl: ArrayBuffer | null;
  logs: string[];
}

/** Real WASM render, isolated so each verification releases its linear memory. */
export function renderScadInNode(scad: string, options: NodeRenderOptions = {}): Promise<NodeRenderResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./node-render-worker.mjs', import.meta.url), {
      workerData: { scad, files: options.files, allowEmpty: options.allowEmpty },
      execArgv: [],
    });
    let finished = false;
    const finish = (error?: Error, result?: NodeRenderResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      void worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const timeout = setTimeout(() => finish(new Error('OpenSCAD verification exceeded its time limit.')), options.timeoutMs ?? 120_000);
    worker.on('error', (error) => finish(error));
    worker.on('exit', (code) => {
      if (!finished) finish(new Error(`OpenSCAD worker exited before returning a model (code ${code}).`));
    });
    worker.on('message', (message: NodeRenderResult & { error?: string }) => {
      if (message.error) {
        finish(new Error(`${message.error}\n${message.logs.join('\n')}`));
        return;
      }
      try {
        if (message.stl !== null) message.stl = removeCollapsedTriangles(message.stl);
        else if (!options.allowEmpty) throw new Error('Unexpected empty model.');
        finish(undefined, message);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}
