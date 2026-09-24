import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderScad } from '../src/runtime';
import type { RenderResponse } from '../src/runtime/protocol';
import { removeCollapsedTriangles, validateBinaryStl } from '../src/runtime/stl';

function binaryTriangle(): ArrayBuffer {
  const buffer = new ArrayBuffer(134);
  const view = new DataView(buffer);
  view.setUint32(80, 1, true);
  view.setFloat32(84 + 24, 1, true);
  view.setFloat32(84 + 40, 1, true);
  return buffer;
}

describe('binary STL validation', () => {
  it('accepts a binary header that starts with solid', () => {
    const stl = binaryTriangle();
    new Uint8Array(stl).set(new TextEncoder().encode('solid binary header'));
    expect(validateBinaryStl(stl)).toBe(1);
  });
  it('rejects empty and truncated output', () => {
    expect(() => validateBinaryStl(new ArrayBuffer(0))).toThrow('incomplete');
    expect(() => validateBinaryStl(new ArrayBuffer(84))).toThrow('empty');
    expect(() => validateBinaryStl(binaryTriangle().slice(0, 133))).toThrow('triangle count');
  });
  it('rejects infinite and NaN coordinates', () => {
    for (const value of [Infinity, NaN]) {
      const stl = binaryTriangle();
      new DataView(stl).setFloat32(100, value, true);
      expect(() => validateBinaryStl(stl)).toThrow('invalid coordinate');
    }
  });
  it('removes only collapsed triangles and preserves nonzero faces byte for byte', () => {
    const original = binaryTriangle();
    const combined = new Uint8Array(184);
    combined.set(new Uint8Array(original));
    new DataView(combined.buffer).setUint32(80, 2, true);
    const clean = removeCollapsedTriangles(combined.buffer);
    expect(new Uint8Array(clean)).toEqual(new Uint8Array(original));
    expect(removeCollapsedTriangles(original)).toBe(original);
  });
  it('preserves distinct collinear vertices that connect neighboring edges', () => {
    const stl = new ArrayBuffer(134);
    const data = new DataView(stl);
    data.setUint32(80, 1, true);
    data.setFloat32(84 + 24 + 8, 1, true);
    data.setFloat32(84 + 36 + 8, 2, true);
    expect(removeCollapsedTriangles(stl)).toBe(stl);
  });
});

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: { data: RenderResponse }) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  emit(response: RenderResponse) { this.onmessage?.({ data: response }); }
}

const identity = { jobId: 'render-1', revision: 3, partId: 'body' };

describe('render lifecycle', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('ignores a stale response and terminates after the matching result', async () => {
    const promise = renderScad('cube(10);', identity);
    const worker = FakeWorker.instances[0];
    const stl = binaryTriangle();
    worker.emit({ ...identity, revision: 2, type: 'result', stl });
    expect(worker.terminate).not.toHaveBeenCalled();
    worker.emit({ ...identity, type: 'result', stl });
    await expect(promise).resolves.toBe(stl);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a running worker and permits a fresh subsequent render', async () => {
    const controller = new AbortController();
    const promise = renderScad('cube(10);', { ...identity, signal: controller.signal });
    const rejection = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    controller.abort();
    await rejection;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    const retry = renderScad('cube(20);', identity);
    const stl = binaryTriangle();
    FakeWorker.instances[1].emit({ ...identity, type: 'result', stl });
    await expect(retry).resolves.toBe(stl);
  });
  it('does not start a runtime for an already cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(renderScad('cube(10);', { ...identity, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeWorker.instances).toHaveLength(0);
  });
  it('releases the worker and timeout after a render error', async () => {
    const promise = renderScad('invalid;', identity);
    const rejection = expect(promise).rejects.toThrow('syntax error');
    FakeWorker.instances[0].emit({ ...identity, type: 'error', message: 'syntax error' });
    await rejection;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('terminates an unresponsive runtime after two minutes', async () => {
    const promise = renderScad('cube(10);', identity);
    const rejection = expect(promise).rejects.toThrow('two minutes');
    await vi.advanceTimersByTimeAsync(120_000);
    await rejection;
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledOnce();
  });
});
