import type { RenderIdentity, RenderRequest, RenderResponse } from './protocol';

export interface RenderOptions extends RenderIdentity {
  signal?: AbortSignal;
  onLog?: (line: string) => void;
}

const RENDER_TIMEOUT_MS = 120_000;

/** Each render owns a fresh runtime; termination also interrupts synchronous WASM. */
export function renderScad(scad: string, options: RenderOptions): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const abortError = () => new DOMException('Rendering cancelled.', 'AbortError');
    if (options.signal?.aborted) {
      reject(abortError());
      return;
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      reject(error);
      return;
    }
    let finished = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, stl?: ArrayBuffer) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(stl!);
    };
    const abort = () => finish(abortError());
    timer = setTimeout(() => finish(new Error('Rendering took longer than two minutes. Try fewer keys or a simpler configuration.')), RENDER_TIMEOUT_MS);
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<RenderResponse>) => {
      const message = event.data;
      if (
        message.jobId !== options.jobId || message.revision !== options.revision ||
        message.partId !== options.partId
      ) return;
      if (message.type === 'log') {
        options.onLog?.(message.line);
      } else if (message.type === 'error') {
        finish(new Error(message.message));
      } else if (message.type === 'result') {
        if (!(message.stl instanceof ArrayBuffer)) {
          finish(new Error('The renderer returned an invalid model.'));
        } else {
          finish(undefined, message.stl);
        }
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error(event.message || 'The renderer could not start. Check that the app is available offline, or reconnect and reload.'));
    };
    worker.onmessageerror = () => finish(new Error('The renderer could not transfer the generated model.'));
    const request: RenderRequest = {
      type: 'render', scad,
      jobId: options.jobId, revision: options.revision, partId: options.partId,
    };
    try {
      worker.postMessage(request);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export { validateBinaryStl } from './stl';
export type { RenderRequest, RenderResponse } from './protocol';
