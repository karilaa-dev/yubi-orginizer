import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPLY_TIMEOUT_MS, AUTO_APPLY_WINDOW_MS, MIN_CHECK_GAP_MS, PEER_IDLE_MS, UPDATE_INTERVAL_MS, createPwa,
  type PwaEnvironment, type PwaHooks, type PwaStatus,
} from '../src/pwa';
import { offlineStatusText } from '../src/ui/app-help';

class FakeWorker extends EventTarget {
  messages: unknown[] = [];
  constructor(public state: ServiceWorkerState = 'installing') { super(); }
  postMessage(message: unknown) { this.messages.push(message); }
  setState(state: ServiceWorkerState) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}

class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  updates = 0;
  onUpdate: () => Promise<void> = async () => {};
  async update() { this.updates++; await this.onUpdate(); }
  /** Simulates the browser finding and installing a new worker. */
  install(worker = new FakeWorker()) {
    this.installing = worker;
    this.dispatchEvent(new Event('updatefound'));
    return worker;
  }
  finishInstall(worker: FakeWorker, controlled: boolean) {
    this.installing = null;
    if (controlled) { this.waiting = worker; worker.setState('installed'); return; }
    worker.setState('installed');
    this.active = worker; worker.setState('activating'); worker.setState('activated');
  }
}

class FakeContainer extends EventTarget {
  registration = new FakeRegistration();
  registers = 0;
  constructor(public controller: FakeWorker | null) { super(); }
  async register() {
    this.registers++;
    const reg = this.registration;
    // Like the browser: a new registration resolves with an installing worker,
    // then updatefound is dispatched in a later task.
    if (!reg.active && !reg.waiting && !reg.installing) {
      reg.installing = new FakeWorker();
      setTimeout(() => reg.dispatchEvent(new Event('updatefound')), 0);
    }
    return reg;
  }
  /** The waiting worker takes control of every tab (skipWaiting). */
  activateWaiting() {
    const worker = this.registration.waiting!;
    this.registration.waiting = null;
    this.registration.active = worker;
    this.controller = worker;
    worker.setState('activating');
    this.dispatchEvent(new Event('controllerchange'));
    worker.setState('activated');
  }
}

class FakeChannel extends EventTarget {
  peer?: FakeChannel;
  postMessage(data: unknown) {
    const target = this.peer;
    setTimeout(() => target?.dispatchEvent(Object.assign(new Event('message'), { data })), 0);
  }
}

class FakeStorage {
  map = new Map<string, string>();
  getItem(key: string) { return this.map.get(key) ?? null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
}

interface Harness {
  container: FakeContainer; env: PwaEnvironment; hooks: PwaHooks & { statuses: PwaStatus[] };
  win: EventTarget; doc: EventTarget & { visibilityState: DocumentVisibilityState; readyState: DocumentReadyState };
  nav: { onLine: boolean }; reload: ReturnType<typeof vi.fn>; beforeUpdate: ReturnType<typeof vi.fn>;
}

function harness(options: { controlled?: boolean; readyState?: DocumentReadyState; channel?: FakeChannel; session?: FakeStorage } = {}): Harness {
  const controlled = options.controlled ?? true;
  const container = new FakeContainer(controlled ? new FakeWorker('activated') : null);
  if (controlled) container.registration.active = container.controller;
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState, readyState: options.readyState ?? 'complete' as DocumentReadyState });
  const nav = { onLine: true };
  const reload = vi.fn();
  const beforeUpdate = vi.fn((_automatic: boolean) => true);
  const statuses: PwaStatus[] = [];
  const hooks = { statuses, onStatus: (s: PwaStatus) => statuses.push(s), onOfflineReady: vi.fn(), beforeUpdate, onError: vi.fn() };
  const env: PwaEnvironment = {
    container: container as unknown as ServiceWorkerContainer,
    swUrl: '/sw.js', scope: '/',
    window: Object.assign(win, {
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms) as unknown as number,
      clearTimeout: (id: number) => clearTimeout(id),
      setInterval: (cb: () => void, ms: number) => setInterval(cb, ms) as unknown as number,
    }),
    document: doc, navigator: nav, channel: options.channel, session: options.session,
    reload, now: () => Date.now(),
  };
  return { container, env, hooks, win, doc, nav, reload, beforeUpdate };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
const latest = (h: Harness) => h.hooks.statuses.at(-1)!;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('PWA lifecycle', () => {
  it('does nothing without service worker support', async () => {
    const h = harness();
    const pwa = createPwa({ ...h.env, container: undefined }, h.hooks);
    await pwa.applyUpdate(); await pwa.checkForUpdate();
    expect(pwa.status).toMatchObject({ supported: false, offlineReady: false, updateReady: false });
    expect(h.container.registers).toBe(0);
  });

  it('registers after load on a first visit and reports offline readiness once', async () => {
    const h = harness({ controlled: false, readyState: 'interactive' });
    createPwa(h.env, h.hooks);
    await settle();
    expect(h.container.registers).toBe(0);
    h.win.dispatchEvent(new Event('load'));
    await settle();
    expect(h.container.registers).toBe(1);
    const worker = h.container.registration.installing!;
    h.container.registration.finishInstall(worker, false);
    // clientsClaim: the first worker takes control of this page; not an update.
    h.container.controller = worker;
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(latest(h)).toMatchObject({ offlineReady: true, updateReady: false });
    expect(h.hooks.onOfflineReady).toHaveBeenCalledTimes(1);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('applies an update waiting at startup before the user interacts (refresh = update)', async () => {
    const h = harness();
    h.container.registration.waiting = new FakeWorker('installed');
    createPwa(h.env, h.hooks);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.beforeUpdate).toHaveBeenCalledWith(true);
    expect(h.container.registration.waiting!.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    h.container.activateWaiting();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('applies an update found by the startup check while the page is untouched', async () => {
    const h = harness();
    const reg = h.container.registration;
    reg.onUpdate = async () => { const w = reg.install(); setTimeout(() => reg.finishInstall(w, true), 2000); };
    createPwa(h.env, h.hooks);
    await settle();
    expect(reg.updates).toBe(1);
    await vi.advanceTimersByTimeAsync(2500);
    expect(reg.waiting!.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('only offers the update after the user has interacted', async () => {
    const h = harness();
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    h.win.dispatchEvent(new Event('pointerdown'));
    const reg = h.container.registration;
    const worker = reg.install();
    reg.finishInstall(worker, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(latest(h)).toMatchObject({ updateReady: true, applying: false });
    expect(worker.messages).toEqual([]);
    await pwa.applyUpdate();
    expect(h.beforeUpdate).toHaveBeenCalledWith(false);
    expect(latest(h).applying).toBe(true);
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    h.container.activateWaiting();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('keeps the page when state cannot be saved', async () => {
    const h = harness();
    h.beforeUpdate.mockReturnValue(false);
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    h.win.dispatchEvent(new Event('keydown'));
    const worker = h.container.registration.install();
    h.container.registration.finishInstall(worker, true);
    await pwa.applyUpdate();
    expect(worker.messages).toEqual([]);
    expect(latest(h)).toMatchObject({ updateReady: true, applying: false });
    await vi.advanceTimersByTimeAsync(APPLY_TIMEOUT_MS * 2);
    expect(h.reload).not.toHaveBeenCalled();
  });

  it('reloads other tabs when a new worker takes control, without saving their state', async () => {
    const h = harness();
    createPwa(h.env, h.hooks);
    await settle();
    h.win.dispatchEvent(new Event('input'));
    h.container.registration.waiting = new FakeWorker('installed');
    h.container.activateWaiting();
    expect(h.beforeUpdate).not.toHaveBeenCalled();
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('falls back to a reload when activation never reports', async () => {
    const h = harness();
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    h.win.dispatchEvent(new Event('pointerdown'));
    h.container.registration.waiting = new FakeWorker('installed');
    await pwa.applyUpdate();
    await vi.advanceTimersByTimeAsync(APPLY_TIMEOUT_MS);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('checks periodically and on visibility, throttled, and never while offline', async () => {
    const h = harness();
    const reg = h.container.registration;
    createPwa(h.env, h.hooks);
    await settle();
    expect(reg.updates).toBe(1);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reg.updates).toBe(1); // within MIN_CHECK_GAP_MS of the startup check
    await vi.advanceTimersByTimeAsync(MIN_CHECK_GAP_MS);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(reg.updates).toBe(2);
    h.nav.onLine = false;
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS * 2);
    h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(reg.updates).toBe(2);
    h.win.dispatchEvent(new Event('offline'));
    expect(latest(h).online).toBe(false);
    h.nav.onLine = true;
    h.win.dispatchEvent(new Event('online'));
    await settle();
    expect(reg.updates).toBe(3);
    expect(latest(h).online).toBe(true);
  });

  it('ignores failed update checks', async () => {
    const h = harness();
    h.container.registration.onUpdate = async () => { throw new TypeError('Failed to update a ServiceWorker'); };
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    await expect(pwa.checkForUpdate()).resolves.toBeUndefined();
    expect(latest(h)).toMatchObject({ offlineReady: true, updateReady: false });
    expect(h.hooks.onError).not.toHaveBeenCalled();
  });

  it('registers again when an interrupted first installation removed the registration', async () => {
    const h = harness({ controlled: false });
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    expect(h.container.registers).toBe(1);
    const worker = h.container.registration.installing!;
    h.container.registration.installing = null;
    worker.setState('redundant');
    await pwa.checkForUpdate();
    expect(h.container.registers).toBe(2);
  });

  it('does not reload a visible tab that is in use when another tab refreshes', async () => {
    const a = new FakeChannel(), b = new FakeChannel();
    a.peer = b; b.peer = a;
    const busy = harness({ channel: a });
    createPwa(busy.env, busy.hooks);
    await settle();
    busy.win.dispatchEvent(new Event('pointerdown'));
    const fresh = harness({ channel: b });
    fresh.container.registration.waiting = new FakeWorker('installed');
    createPwa(fresh.env, fresh.hooks);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fresh.container.registration.waiting.messages).toEqual([]);
    expect(latest(fresh)).toMatchObject({ updateReady: true, deferredToPeer: true });
  });

  it('lets a refresh apply the update once the other visible tab has been idle for a while', async () => {
    const a = new FakeChannel(), b = new FakeChannel();
    a.peer = b; b.peer = a;
    const idle = harness({ channel: a });
    createPwa(idle.env, idle.hooks);
    await settle();
    idle.win.dispatchEvent(new Event('pointerdown'));
    await vi.advanceTimersByTimeAsync(PEER_IDLE_MS + 1);
    const fresh = harness({ channel: b });
    fresh.container.registration.waiting = new FakeWorker('installed');
    createPwa(fresh.env, fresh.hooks);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fresh.container.registration.waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(latest(fresh)).toMatchObject({ applying: true, deferredToPeer: false });
  });

  it('does not repeat an automatic update that did not take effect', async () => {
    const session = new FakeStorage();
    const first = harness({ session });
    first.container.registration.waiting = new FakeWorker('installed');
    createPwa(first.env, first.hooks);
    await vi.advanceTimersByTimeAsync(APPLY_TIMEOUT_MS);
    expect(first.reload).toHaveBeenCalledTimes(1); // timeout fallback
    const second = harness({ session });
    second.container.registration.waiting = new FakeWorker('installed');
    createPwa(second.env, second.hooks);
    await vi.advanceTimersByTimeAsync(1000);
    expect(second.container.registration.waiting.messages).toEqual([]);
    expect(latest(second).updateReady).toBe(true);
  });

  it('allows the next automatic update once the previous one took effect', async () => {
    const session = new FakeStorage();
    const first = harness({ session });
    first.container.registration.waiting = new FakeWorker('installed');
    createPwa(first.env, first.hooks);
    await vi.advanceTimersByTimeAsync(500);
    first.container.activateWaiting();
    // The reloaded page runs the new version; a second deploy arrives seconds later.
    const second = harness({ session });
    const reg = second.container.registration;
    createPwa(second.env, second.hooks);
    await settle();
    const worker = reg.install();
    reg.finishInstall(worker, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('settles quickly when nothing is waiting, and stays pending while an automatic update applies', async () => {
    const idle = harness();
    const a = createPwa(idle.env, idle.hooks);
    let settledA = false; void a.settled.then(() => { settledA = true; });
    await settle();
    expect(settledA).toBe(true);
    const busy = harness();
    busy.container.registration.waiting = new FakeWorker('installed');
    const b = createPwa(busy.env, busy.hooks);
    let settledB = false; void b.settled.then(() => { settledB = true; });
    await vi.advanceTimersByTimeAsync(500);
    expect(latest(busy).applying).toBe(true);
    expect(settledB).toBe(false);
    const uncontrolled = harness({ controlled: false, readyState: 'interactive' });
    const c = createPwa(uncontrolled.env, uncontrolled.hooks);
    let settledC = false; void c.settled.then(() => { settledC = true; });
    await settle();
    expect(settledC).toBe(true);
  });

  it('only offers an update found long after load on a visible, untouched page, and applies it once the tab is hidden', async () => {
    const h = harness();
    createPwa(h.env, h.hooks);
    await settle();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_WINDOW_MS + 1);
    const reg = h.container.registration;
    const worker = reg.install();
    expect(latest(h).downloading).toBe(true);
    reg.finishInstall(worker, true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(latest(h)).toMatchObject({ downloading: false, updateReady: true, applying: false });
    expect(worker.messages).toEqual([]);
    h.doc.visibilityState = 'hidden';
    h.doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(500);
    expect(h.beforeUpdate).toHaveBeenCalledWith(true);
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('applies an update found late in a hidden, untouched tab', async () => {
    const h = harness();
    h.doc.visibilityState = 'hidden';
    createPwa(h.env, h.hooks);
    await settle();
    await vi.advanceTimersByTimeAsync(AUTO_APPLY_WINDOW_MS * 3);
    const reg = h.container.registration;
    const worker = reg.install();
    reg.finishInstall(worker, true);
    await vi.advanceTimersByTimeAsync(500);
    expect(worker.messages).toEqual([{ type: 'SKIP_WAITING' }]);
  });

  it('reloads a hard-refreshed (uncontrolled) page when a newer worker claims it', async () => {
    const h = harness({ controlled: false });
    const reg = h.container.registration;
    reg.active = new FakeWorker('activated'); // the worker that served this site before the hard refresh
    createPwa(h.env, h.hooks);
    await settle();
    expect(latest(h)).toMatchObject({ offlineReady: true, updateReady: false });
    const worker = reg.install();
    expect(latest(h).downloading).toBe(true);
    reg.finishInstall(worker, false); // no controlled clients: activates at once
    h.container.controller = worker;
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.beforeUpdate).toHaveBeenCalledWith(true);
    expect(h.reload).toHaveBeenCalledTimes(1);
    expect(h.hooks.onOfflineReady).not.toHaveBeenCalled();
  });

  it('offers Update when a newer worker claims an uncontrolled page whose latest edit could not be saved', async () => {
    const h = harness({ controlled: false });
    h.container.registration.active = new FakeWorker('activated');
    h.beforeUpdate.mockReturnValue(false);
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    h.win.dispatchEvent(new Event('pointerdown'));
    h.container.controller = new FakeWorker('activated');
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.beforeUpdate).toHaveBeenCalledWith(false);
    expect(h.reload).not.toHaveBeenCalled();
    expect(latest(h).updateReady).toBe(true);
    h.container.registration.install().setState('redundant'); // a later check that found nothing
    expect(latest(h).updateReady).toBe(true); // keeps the button
    h.beforeUpdate.mockReturnValue(true);
    await pwa.applyUpdate();
    expect(latest(h).applying).toBe(true);
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a worker claims the page before it registered', async () => {
    const h = harness({ controlled: false, readyState: 'interactive' });
    createPwa(h.env, h.hooks);
    await settle();
    expect(h.container.registers).toBe(0);
    h.container.controller = new FakeWorker('activated');
    h.container.dispatchEvent(new Event('controllerchange'));
    expect(h.reload).toHaveBeenCalledTimes(1);
  });

  it('reports a refused registration and does not retry a SecurityError', async () => {
    const h = harness({ controlled: false });
    h.container.register = async () => { h.container.registers++; throw new DOMException('The user denied permission to use Service Worker.', 'SecurityError'); };
    const pwa = createPwa(h.env, h.hooks);
    let settled = false; void pwa.settled.then(() => { settled = true; });
    await settle();
    expect(h.hooks.onError).toHaveBeenCalledTimes(1);
    expect(settled).toBe(true);
    expect(latest(h)).toMatchObject({ supported: true, offlineReady: false, registrationFailed: true });
    expect(offlineStatusText(latest(h), false)).toBe("Offline use isn't available in this browser.");
    h.win.dispatchEvent(new Event('online'));
    await pwa.checkForUpdate();
    expect(h.container.registers).toBe(1);
  });

  it('registers again after a failed registration when asked or when the connection returns', async () => {
    const h = harness({ controlled: false });
    const register = FakeContainer.prototype.register;
    let failing = true;
    h.container.register = async () => {
      if (!failing) return register.call(h.container);
      h.container.registers++;
      throw new TypeError('Failed to fetch');
    };
    const pwa = createPwa(h.env, h.hooks);
    await settle();
    expect(latest(h).registrationFailed).toBe(true);
    await vi.advanceTimersByTimeAsync(UPDATE_INTERVAL_MS);
    expect(h.container.registers).toBe(1); // never on the timer
    await pwa.checkForUpdate(); // still failing
    expect(h.container.registers).toBe(2);
    expect(latest(h).registrationFailed).toBe(true);
    failing = false;
    h.win.dispatchEvent(new Event('online'));
    await settle();
    expect(h.container.registers).toBe(3);
    expect(latest(h).registrationFailed).toBe(false);
  });
});

