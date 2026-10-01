/**
 * Service-worker lifecycle for yubi-orginizer (offline-first, prompt-style updates).
 *
 * The generated worker (vite-plugin-pwa `generateSW`, registerType `prompt`) waits
 * after installing a new version until a page posts `{ type: 'SKIP_WAITING' }`.
 * This module decides when to send that message:
 *
 * - A page the user has not touched yet applies a waiting update by itself, so a
 *   refresh ends on the new version without a click. "Untouched" means no
 *   pointerdown / keydown / input / wheel since load, and either the tab is hidden
 *   or it loaded less than AUTO_APPLY_WINDOW_MS ago.
 * - Once the user has interacted, the update is only reported (`updateReady`) so
 *   the UI can show an Update button; `applyUpdate()` saves state and reloads.
 * - A visible tab that was used in the last few minutes (PEER_IDLE_MS) in another
 *   window blocks automatic updates (BroadcastChannel probe), so opening a second
 *   window never reloads the first; an idle one does not block a refresh forever.
 * - Updates are checked on start, every 15 minutes while visible, when the tab
 *   becomes visible and when the connection returns. Failures are ignored, so the
 *   cached version keeps working offline.
 * - Every controlled tab reloads when a new worker takes control. A page never
 *   keeps running old code against the new precache, which no longer contains
 *   the old hashed render worker or WASM chunks. The same applies to a page that
 *   was uncontrolled at load while a worker was already active (hard refresh):
 *   only this page's own first installation takes control without a reload.
 */

export interface PwaStatus {
  /** A service worker is used (production build in a supporting browser). */
  supported: boolean;
  /** The app shell, CAD runtime and reference meshes are cached on this device. */
  offlineReady: boolean;
  /** A newer version is downloading in the background (not the first install). */
  downloading: boolean;
  /** A new version is installed and waiting for `applyUpdate()`. */
  updateReady: boolean;
  /** The update is being applied; the page reloads shortly. */
  applying: boolean;
  /** Best-effort connectivity (`navigator.onLine`). Never gate features on it. */
  online: boolean;
  /** The service worker could not be registered in this page session (for example, site data is blocked). */
  registrationFailed: boolean;
  /** A refresh did not apply the waiting update because another visible window is in use. */
  deferredToPeer: boolean;
}

export interface PwaHooks {
  /** Called on every status change, and once synchronously on start. */
  onStatus(status: PwaStatus): void;
  /** The first installation finished; the app now works without a connection. */
  onOfflineReady?(): void;
  /**
   * Persist state and stop work before reloading into the new version.
   * `automatic` is true when the page is untouched since loading.
   * Return false to cancel (for example, when the latest edit could not be saved).
   */
  beforeUpdate(automatic: boolean): boolean;
  onError?(error: unknown): void;
}

export interface PwaController {
  readonly status: PwaStatus;
  /**
   * Resolves once the startup check knows no automatic update is being applied
   * (immediately when unsupported or uncontrolled). Never rejects. Stays pending
   * while an automatic update is applying, because the page is about to reload.
   * Callers should race it with a short timeout.
   */
  readonly settled: Promise<void>;
  /** Save state, activate the waiting version and reload. No-op without an update. */
  applyUpdate(): Promise<void>;
  /** Check the server for a new version now (ignored while offline). */
  checkForUpdate(): Promise<void>;
}

type Listener = (event: any) => void;
interface Listenable {
  addEventListener(type: string, listener: Listener, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: Listener, options?: boolean | EventListenerOptions): void;
}

/** Browser surface used by the lifecycle; replaced by fakes in unit tests. */
export interface PwaEnvironment {
  container?: ServiceWorkerContainer;
  swUrl: string;
  scope: string;
  window: Listenable & {
    setTimeout(callback: () => void, ms: number): number;
    clearTimeout(id: number): void;
    setInterval(callback: () => void, ms: number): number;
  };
  document: Listenable & { readonly visibilityState: DocumentVisibilityState; readonly readyState: DocumentReadyState };
  navigator: { readonly onLine: boolean };
  /** Per-tab storage that survives reloads (sessionStorage); guards against reload loops. */
  session?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  /** Cross-tab coordination; optional because BroadcastChannel may be missing. */
  channel?: Listenable & { postMessage(message: unknown): void };
  reload(): void;
  /** Wall-clock milliseconds (Date.now). */
  now(): number;
}

export const UPDATE_INTERVAL_MS = 15 * 60_000;
export const MIN_CHECK_GAP_MS = 60_000;
export const APPLY_TIMEOUT_MS = 8_000;
export const PEER_REPLY_MS = 250;
/** A visible tab counts as "in use" (and blocks other tabs' automatic updates) this long after its last interaction. */
export const PEER_IDLE_MS = 3 * 60_000;
/** An automatic update is attempted at most once per tab in this period. */
export const AUTO_RETRY_MS = 60_000;
/** A visible, untouched page applies updates by itself only this soon after loading. */
export const AUTO_APPLY_WINDOW_MS = 60_000;
export const AUTO_APPLY_KEY = 'yubi-orginizer.pwa-auto-update';
export const PWA_CHANNEL = 'yubi-orginizer:pwa';
const INTERACTION_EVENTS = ['pointerdown', 'keydown', 'input', 'wheel'];
const SKIP_WAITING = { type: 'SKIP_WAITING' };

type CheckReason = 'startup' | 'interval' | 'visible' | 'online' | 'manual';
type PeerMessage = { type: 'probe'; id: string } | { type: 'busy'; id: string };

export function createPwa(env: PwaEnvironment, hooks: PwaHooks): PwaController {
  const { container } = env;
  const status: PwaStatus = {
    supported: Boolean(container), offlineReady: false, downloading: false, updateReady: false, applying: false,
    online: env.navigator.onLine !== false, registrationFailed: false, deferredToPeer: false,
  };
  const set = (patch: Partial<PwaStatus>) => {
    const next = { ...status, ...patch };
    if ((Object.keys(next) as (keyof PwaStatus)[]).every(key => next[key] === status[key])) return;
    Object.assign(status, next);
    hooks.onStatus({ ...status });
  };
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
  const noop = async () => {};
  hooks.onStatus({ ...status });
  if (!container) {
    resolveSettled();
    return { get status() { return { ...status }; }, settled, applyUpdate: noop, checkForUpdate: noop };
  }
  const sw = container;

  let registration: ServiceWorkerRegistration | undefined;
  // A page loaded through the worker is "controlled". The first installation
  // claims an uncontrolled page (clientsClaim); later controller changes are updates.
  let controlled = Boolean(sw.controller);
  // An uncontrolled page (first visit, hard refresh) is not running an outdated version at load.
  if (!controlled) resolveSettled();
  const loadedAt = env.now();
  let interacted = false, lastInteraction = Number.NEGATIVE_INFINITY, reloading = false, autoApplying = false;
  // Tell this page's own first installation apart from a newer worker claiming an uncontrolled page.
  let registerStarted = false;
  let activeAtStart: boolean | undefined;
  /** A newer worker claimed this page but beforeUpdate() refused the reload: Update reloads it. */
  let staleAfterClaim = false;
  /** False after a SecurityError (blocked site data): registering again in this page cannot succeed. */
  let retryRegister = true;
  let autoRun: Promise<void> | undefined;
  let checking: Promise<void> | undefined;
  let lastCheck = Number.NEGATIVE_INFINITY;

  const reload = () => {
    if (reloading) return;
    reloading = true;
    env.reload();
  };
  const fail = (error: unknown) => hooks.onError?.(error);
  const readSession = () => { try { return env.session?.getItem(AUTO_APPLY_KEY); } catch { return undefined; } };
  const writeSession = (value?: string) => {
    try { if (value === undefined) env.session?.removeItem(AUTO_APPLY_KEY); else env.session?.setItem(AUTO_APPLY_KEY, value); }
    catch { /* Storage can be unavailable. */ }
  };
  const markOfflineReady = (firstInstall: boolean) => {
    if (status.offlineReady) return;
    set({ offlineReady: true });
    if (firstInstall) hooks.onOfflineReady?.();
  };

  const markInteracted = () => { interacted = true; lastInteraction = env.now(); };
  for (const type of INTERACTION_EVENTS) env.window.addEventListener(type, markInteracted, { capture: true, passive: true });
  const mayAutoApply = () => !interacted
    && (env.document.visibilityState === 'hidden' || env.now() - loadedAt < AUTO_APPLY_WINDOW_MS);

  /** True when another visible tab is in use, so an automatic update would reload it. */
  const peerIsBusy = () => new Promise<boolean>(resolve => {
    const channel = env.channel;
    if (!channel) { resolve(false); return; }
    const id = Math.random().toString(36).slice(2);
    const done = (busy: boolean) => {
      channel.removeEventListener('message', onMessage);
      env.window.clearTimeout(timer);
      resolve(busy);
    };
    const onMessage = (event: MessageEvent<PeerMessage>) => { if (event.data?.type === 'busy' && event.data.id === id) done(true); };
    channel.addEventListener('message', onMessage);
    const timer = env.window.setTimeout(() => done(false), PEER_REPLY_MS);
    channel.postMessage({ type: 'probe', id } satisfies PeerMessage);
  });
  env.channel?.addEventListener('message', (event: MessageEvent<PeerMessage>) => {
    if (event.data?.type === 'probe' && interacted && env.document.visibilityState === 'visible'
      && env.now() - lastInteraction < PEER_IDLE_MS) {
      env.channel!.postMessage({ type: 'busy', id: event.data.id } satisfies PeerMessage);
    }
  });

  const applyUpdate = async (automatic = false): Promise<void> => {
    if (status.applying || reloading) return;
    const waiting = registration?.waiting;
    if (!waiting && !staleAfterClaim) { set({ updateReady: false, deferredToPeer: false }); return; }
    let proceed = false;
    try { proceed = hooks.beforeUpdate(automatic); } catch (error) { fail(error); }
    if (!proceed) return;
    set({ applying: true });
    // Already controlled by the new version (see controllerchange): reloading is enough.
    if (!waiting) { reload(); return; }
    waiting.postMessage(SKIP_WAITING);
    // controllerchange normally reloads first. If activation stalls, reloading still
    // converges: the next untouched page load applies the waiting worker again.
    env.window.setTimeout(reload, APPLY_TIMEOUT_MS);
  };

  const autoApply = async () => {
    if (autoApplying || status.applying || reloading) return;
    autoApplying = true;
    try {
      // If an automatic update did not take effect moments ago (for example, the
      // worker never activated), offer the button instead of reloading in a loop.
      const last = Number(readSession() ?? 0);
      if (env.now() - last < AUTO_RETRY_MS) return;
      if (await peerIsBusy()) { set({ deferredToPeer: true }); return; }
      if (!mayAutoApply()) return;
      writeSession(String(env.now()));
      await applyUpdate(true);
    } finally { autoApplying = false; }
  };

  const evaluateWaiting = () => {
    // Only a controlled page runs an older version than the waiting worker.
    const ready = staleAfterClaim || Boolean(registration?.waiting && sw.controller);
    set(ready ? { updateReady: true } : { updateReady: false, deferredToPeer: false });
    // Nothing waiting means the last automatic update (if any) took effect.
    if (!ready) writeSession();
    else if (mayAutoApply()) autoRun = autoApply();
  };

  const tracked = new WeakSet<ServiceWorker>();
  const track = (worker: ServiceWorker) => {
    if (tracked.has(worker)) return;
    tracked.add(worker);
    if (sw.controller || activeAtStart) set({ downloading: true });
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'redundant') { set({ downloading: false }); evaluateWaiting(); }
      else if (worker.state === 'activated') markOfflineReady(true);
    });
  };

  const watch = (reg: ServiceWorkerRegistration) => {
    activeAtStart ??= Boolean(reg.active || reg.waiting);
    reg.addEventListener('updatefound', () => { if (reg.installing) track(reg.installing); });
    if (reg.installing) track(reg.installing);
    // An activated worker has completed its precache.
    if (reg.active) markOfflineReady(false);
    evaluateWaiting();
  };

  const register = async () => {
    registerStarted = true;
    const next = await sw.register(env.swUrl, { scope: env.scope });
    if (next !== registration) { registration = next; watch(next); }
  };

  const check = (reason: CheckReason): Promise<void> => {
    if (reloading || status.applying || env.navigator.onLine === false) return Promise.resolve();
    if (checking) return checking;
    const reg = registration;
    // Without a registration, only a failed one that may still succeed is tried again (never on the timer).
    if (!reg && (!status.registrationFailed || !retryRegister || reason === 'interval')) return Promise.resolve();
    if (reg?.installing) return Promise.resolve();
    const now = env.now();
    if (reason === 'visible' && now - lastCheck < MIN_CHECK_GAP_MS) return Promise.resolve();
    lastCheck = now;
    const run = async () => {
      if (!reg) {
        try { await register(); } catch (error) { retryRegister = !isSecurityError(error); throw error; }
        set({ registrationFailed: false });
      } else if (!reg.active && !reg.waiting) {
        // A first installation interrupted by a lost connection removes the
        // registration; registering again resumes it. Otherwise fetch sw.js.
        await register();
      } else await reg.update();
    };
    // Offline, server unavailable or sw.js missing: keep the cached version.
    // `finally` runs asynchronously, after `checking` is assigned.
    checking = run().catch(() => {}).finally(() => { checking = undefined; });
    return checking;
  };

  sw.addEventListener('controllerchange', () => {
    if (!controlled) {
      controlled = true;
      // This page's own first installation: the page already runs the version that took control.
      const firstInstall = registerStarted && activeAtStart === false;
      markOfflineReady(firstInstall);
      if (firstInstall) return;
      // A newer worker claimed a page that was uncontrolled at load (hard refresh, or a claim before
      // this page registered). Reload like any update, unless the latest edit could not be saved.
      let proceed = false;
      try { proceed = hooks.beforeUpdate(!interacted); } catch (error) { fail(error); }
      if (!proceed) { staleAfterClaim = true; set({ updateReady: true }); return; }
    }
    reload();
  });
  env.window.addEventListener('online', () => { set({ online: true }); void check('online'); });
  env.window.addEventListener('offline', () => set({ online: false }));
  env.document.addEventListener('visibilitychange', () => {
    if (env.document.visibilityState === 'visible') void check('visible');
    // Leaving an untouched tab with an update waiting: apply it out of sight.
    else if (status.updateReady && !interacted) void autoApply();
  });
  env.window.setInterval(() => { if (env.document.visibilityState === 'visible') void check('interval'); }, UPDATE_INTERVAL_MS);

  const start = async () => {
    try { await register(); } catch (error) {
      fail(error);
      retryRegister = !isSecurityError(error);
      set({ registrationFailed: true });
      resolveSettled();
      return;
    }
    await autoRun;
    if (!status.applying) resolveSettled();
    void check('startup');
  };
  // A controlled page loads from the cache, so registering early costs no
  // bandwidth. On a first visit, wait for load so precaching does not compete.
  if (controlled || env.document.readyState === 'complete') void start();
  else env.window.addEventListener('load', () => void start(), { once: true });

  return {
    get status() { return { ...status }; },
    settled,
    applyUpdate: () => applyUpdate(false),
    checkForUpdate: () => check('manual'),
  };
}

/** Starts the lifecycle in the browser. Development builds have no service worker. */
export function startPwa(hooks: PwaHooks): PwaController {
  const supported = import.meta.env.PROD && typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const base = import.meta.env.BASE_URL;
  return createPwa({
    container: supported ? navigator.serviceWorker : undefined,
    swUrl: `${base}sw.js`,
    scope: base,
    window,
    document,
    navigator,
    channel: supported && typeof BroadcastChannel === 'function' ? new BroadcastChannel(PWA_CHANNEL) : undefined,
    session: sessionStorageOrUndefined(),
    reload: () => location.reload(),
    now: () => Date.now(),
  }, hooks);
}

/** Blocked site data or cookies: registering again in this page cannot succeed. */
function isSecurityError(error: unknown): boolean {
  return (error as { name?: unknown } | null)?.name === 'SecurityError';
}

function sessionStorageOrUndefined(): Storage | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; } catch { return undefined; }
}
