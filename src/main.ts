/**
 * App shell: header, routing between Projects and the editor, storage start-up, display
 * preferences (theme), the PWA update/offline lifecycle and Help.
 *
 * Start-up: open storage → migrate legacy data → purge old tombstones → render the shell →
 * start the service worker lifecycle → show the route (no hash resumes the last project).
 */
import './style.css';
import { defaultConfig } from './config';
import { icon } from './icons';
import {
  DISPLAY_KEY, forgetOpenProject, getProject, legacyProblemKeys as keptLegacyKeys, MIGRATION_KEY, migrateLegacyStorage, openBrowserStorage,
  purgeDeletedProjects, readDisplayPrefs, resolveStartupProject, restoreProject, writeDisplayPrefs, type MigrationReport, type ProjectRecord,
} from './projects';
import { startPwa, type PwaStatus } from './pwa';
import { parseRoute, routeHash, sameRoute, type Route } from './router';
import { closeAllDialogs, installDialogHandlers, openDialog } from './ui/app-dialogs';
import { filamentDialogMarkup, helpDialogMarkup, isIosDevice, isStandalone, offlineStatusText, updateCheckText } from './ui/app-help';
import { isTextEntry, shortcutLetter } from './ui/dom';
import { createEditor, editorMarkup, type Panel, type UiState } from './ui/editor';
import { downloadDialogMarkup, keyDialogMarkup } from './ui/editor-download';
import { closeMenu } from './ui/menu';
import { requestPersistentStorage, type ProjectActionsDeps } from './ui/project-actions';
import { createProjectsView } from './ui/projects-view';
import { ensureToastRegion, hasActionToast, runToastAction, toast } from './ui/toast';

/** Last `__BUILD_ID__` this browser ran, to say "Updated…" once after an update. */
const BUILD_KEY = 'yubi-orginizer.build.v1';
/** sessionStorage: the editor tab and scroll, restored after a reload within UI_MAX_AGE_MS. */
const UI_KEY = 'yubi-orginizer.ui.v1';
const UI_MAX_AGE_MS = 30_000;
/** `--bg` of each theme, for the browser's theme-color. */
const THEME_COLORS = { light: '#f5f6f4', dark: '#10171b' } as const;

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const messageOf = (error: unknown): string => (error instanceof Error && error.message) || 'Something went wrong.';

/* ───────────── Storage ───────────── */

const store = openBrowserStorage();
let migration: MigrationReport = { ran: false, imported: [], problems: [] };
try { migration = migrateLegacyStorage(store.local); } catch (error) { console.error(error); }
try { purgeDeletedProjects(store.local); } catch (error) { console.error(error); }
let prefs = readDisplayPrefs(store.local);
/** Display preferences are written only when the user changes one. */
const savePrefs = (): void => { writeDisplayPrefs(store.local, prefs); };

/* ───────────── Shell ───────────── */

byId('app').innerHTML = `
<header class="app-header">
  <div class="header-inner">
    <button type="button" class="brand" id="brand" data-action="home" aria-label="yubi-orginizer — all projects">
      <img src="${import.meta.env.BASE_URL}icon.svg" width="24" height="24" alt=""/><span class="wordmark">yubi<span class="brand-dash">-</span>orginizer</span>
    </button>
    <div class="header-actions">
      <span id="offline-state" class="pill pill-offline" role="note" hidden>${icon('cloudOff')}<span class="pill-text">Offline</span></span>
      <button type="button" id="update-app" class="pill pill-update" hidden>${icon('reset')}<span class="pill-text">Update</span></button>
      <button type="button" id="install" class="button quiet install-button" data-action="install" hidden>${icon('download')}Install app</button>
      <button type="button" id="theme-toggle" class="icon-button"></button>
      <button type="button" id="help-button" class="icon-button" data-action="help" aria-label="Help" title="Help">${icon('help')}</button>
    </div>
  </div>
</header>
<main id="main" class="page">
  <section id="projects-page" class="projects-page" hidden></section>
  ${editorMarkup()}
</main>
${keyDialogMarkup()}
${downloadDialogMarkup()}
${helpDialogMarkup({ version: __APP_VERSION__, time: __BUILD_TIME__, commit: __COMMIT_SHA__, commitUrl: __COMMIT_URL__ })}
${filamentDialogMarkup()}`;

installDialogHandlers();
ensureToastRegion();
const editorRoot = byId('editor');
const projectsPage = byId('projects-page');

/* ───────────── PWA ───────────── */

let pwaStatus: PwaStatus = {
  supported: false, offlineReady: false, downloading: false, updateReady: false, applying: false, online: navigator.onLine,
  registrationFailed: false, deferredToPeer: false,
};
let updateAnyway = false;
let updateToastShown = false;
let updateToastTimer: ReturnType<typeof setTimeout> | undefined;
let checkRequested = false, checking = false;
let deferredInstall: InstallPrompt | undefined;
/** An update reload was approved (saved, or "Update anyway"), so the unload guard stays quiet. */
let leavingForUpdate = false;

function renderPwaStatus(): void {
  const s = pwaStatus;
  const offline = byId('offline-state');
  offline.hidden = !s.supported || s.online;
  const offlineTitle = s.offlineReady ? "You're offline. Everything still works on this device."
    : s.registrationFailed ? "You're offline. Offline use isn't available in this browser, so some parts may not load."
      : "Some parts of the app haven't downloaded yet. Connect to finish setup.";
  offline.querySelector('.pill-text')!.textContent = s.offlineReady || s.registrationFailed ? 'Offline' : 'Offline · not ready';
  // Phones show the pill as an icon only: data-ready=false carries the "not ready" warning there.
  offline.dataset.ready = String(s.offlineReady || s.registrationFailed);
  offline.title = offlineTitle;
  offline.setAttribute('aria-label', offlineTitle);

  const update = byId<HTMLButtonElement>('update-app');
  update.hidden = !(s.updateReady || s.applying);
  update.disabled = s.applying;
  update.querySelector('.pill-text')!.textContent = s.applying ? 'Updating…' : 'Update';
  update.setAttribute('aria-label', s.applying ? 'Updating yubi-orginizer…' : 'Update yubi-orginizer to the new version. Your work is saved.');
  update.title = 'Update yubi-orginizer to the new version. Your work is saved.';

  // A waiting update the page could not apply by itself: say so once, after a moment.
  if (s.updateReady && !s.applying) {
    if (!updateToastShown && !updateToastTimer) updateToastTimer = setTimeout(showUpdateToast, 1000);
  } else if (!s.updateReady) {
    updateToastShown = false;
    clearTimeout(updateToastTimer);
    updateToastTimer = undefined;
  }
  renderHelpStatus();
}

function showUpdateToast(): void {
  updateToastTimer = undefined;
  if (!pwaStatus.updateReady || pwaStatus.applying || updateToastShown) return;
  // Never replace a toast that offers Undo (or another action); the Update button is already showing.
  if (hasActionToast()) { updateToastTimer = setTimeout(showUpdateToast, 1000); return; }
  updateToastShown = true;
  const message = pwaStatus.deferredToPeer
    ? 'A new version is ready. Another yubi-orginizer window is in use. Select Update to update both. Your work is saved.'
    : isStandalone() ? 'A new version is ready. Select Update, or close and reopen the app. Your work is saved.'
      : 'A new version is ready. Refresh the page or select Update. Your work is saved.';
  toast(message, { action: { label: 'Update now', run: () => void pwa.applyUpdate() } });
}

function renderHelpStatus(): void {
  const standalone = isStandalone();
  byId('offline-help-status').textContent = offlineStatusText(pwaStatus, standalone);
  byId('help-install').hidden = !deferredInstall || standalone;
  byId('ios-install-note').hidden = !isIosDevice() || standalone || !!deferredInstall;
  const line = byId('update-check-status');
  const s = { ...pwaStatus, online: navigator.onLine };
  line.textContent = checkRequested || s.updateReady || s.applying ? updateCheckText(s, checking) : '';
  byId('help-dialog').querySelector<HTMLElement>('[data-action="update-now"]')!.hidden = !s.updateReady || s.applying;
}

function saveUiState(): void {
  const ui = editor.uiState();
  try {
    if (ui) store.session?.setItem(UI_KEY, JSON.stringify({ at: Date.now(), id: editor.session?.id, ...ui }));
    else store.session?.removeItem(UI_KEY);
  } catch { /* non-critical */ }
}

let uiChecked = false;
/** The saved tab and scroll, only for the first project opened after a reload, and only if recent. */
function takeUiState(id: string): UiState | undefined {
  if (uiChecked) return undefined;
  uiChecked = true;
  try {
    const data = JSON.parse(store.session?.getItem(UI_KEY) ?? 'null') as Partial<UiState & { at: number; id: string }> | null;
    if (!data || data.id !== id || typeof data.at !== 'number' || Date.now() - data.at > UI_MAX_AGE_MS) return undefined;
    const panel: Panel = data.panel === 'settings' || data.panel === 'size' ? data.panel : 'keys';
    const number = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { panel, panelScroll: number(data.panelScroll), windowScroll: number(data.windowScroll) };
  } catch { return undefined; }
}

const pwa = startPwa({
  onStatus: status => { pwaStatus = status; renderPwaStatus(); },
  onOfflineReady: () => {
    if (prefs.seen.offlineReady) return;
    prefs.seen.offlineReady = true;
    savePrefs();
    toast('yubi-orginizer now works offline.');
  },
  beforeUpdate: automatic => {
    const saved = editor.flush();
    if (!saved && !automatic && !updateAnyway) {
      toast("Couldn't save your latest change. Save a project file first, or update anyway.", {
        action: { label: 'Update anyway', run: () => { updateAnyway = true; void pwa.applyUpdate(); } },
      });
      return false;
    }
    editor.stopGeneration();
    saveUiState();
    leavingForUpdate = true;
    return true;
  },
  onError: error => console.error(error),
});
if (import.meta.env.VITE_PWA_E2E === '1') (window as unknown as { __pwa: typeof pwa }).__pwa = pwa;

/** The first model render waits (at most 500 ms) until no automatic update is about to reload the page. */
const bootGate = Promise.race([pwa.settled, new Promise<void>(resolve => setTimeout(resolve, 500))]);

async function checkForUpdates(): Promise<void> {
  checkRequested = true;
  checking = navigator.onLine;
  renderHelpStatus();
  try { await pwa.checkForUpdate(); } finally { checking = false; renderHelpStatus(); }
}

async function install(): Promise<void> {
  const prompt = deferredInstall;
  if (!prompt) return;
  deferredInstall = undefined;
  renderInstall();
  try { await prompt.prompt(); await prompt.userChoice; } catch (error) { console.warn(error); }
}

function renderInstall(): void {
  byId('install').hidden = !deferredInstall || isStandalone();
  renderHelpStatus();
}

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstall = event as InstallPrompt;
  renderInstall();
});
window.addEventListener('appinstalled', () => { deferredInstall = undefined; renderInstall(); });

/* ───────────── Help ───────────── */

function openHelp(sectionId?: string): void {
  renderHelpStatus();
  const dialog = byId<HTMLDialogElement>('help-dialog');
  openDialog(dialog);
  const section = sectionId ? document.getElementById(sectionId) : null;
  if (section) {
    section.scrollIntoView({ block: 'start' });
    section.focus({ preventScroll: true });
  }
}

/* ───────────── Routing ───────────── */

let displayed: Route | undefined;
let pendingOpen: { addKeys?: boolean } | undefined;
let routeToasted = false;

const actions: ProjectActionsDeps = {
  store,
  session: () => editor.session,
  open: (id, options) => {
    // Re-read the open project when an action changed it in storage (e.g. Undo of a matching layer).
    if (editor.session?.id === id) editor.sync();
    navigate(routeHash({ view: 'project', id }), options);
  },
  goHome: () => navigate(routeHash({ view: 'home' })),
  refreshList: () => { if (!projectsPage.hidden) projectsView.render(); },
};

const editor = createEditor({
  store,
  prefs: () => prefs,
  savePrefs,
  pwaStatus: () => pwaStatus,
  bootGate,
  actions,
  openHelp,
  onSaveProblem: failing => setUnloadGuard(failing),
  onProjectChange: () => {
    const session = editor.session;
    if (!session) return;
    if (session.id) {
      const route: Route = { view: 'project', id: session.id };
      if (!sameRoute(parseRoute(location.hash), route)) history.replaceState(history.state, '', routeHash(route));
      displayed = route;
    }
    if (!editorRoot.hidden) document.title = editor.documentTitle();
  },
});

/** Legacy keys migration could not fully move (kept untouched; this start or an earlier one): Projects offers them as raw data. */
function legacyProblemKeys(): string[] {
  let kept: string[] = [];
  try { kept = keptLegacyKeys(store.local); } catch { /* storage unavailable */ }
  const keys = new Set([...kept, ...migration.problems.map(p => p.source).filter(key => key !== MIGRATION_KEY)]);
  return [...keys].filter(key => { try { return store.local.getItem(key) !== null; } catch { return false; } });
}

const projectsView = createProjectsView(projectsPage, {
  ...actions,
  newProject: template => navigate(routeHash({ view: 'new', template })),
  legacyProblemKeys,
});

/** In-app navigation: pushes a history entry and shows the route at once (hashchange then finds it shown). */
function navigate(hash: string, options?: { addKeys?: boolean }): void {
  pendingOpen = options;
  if (location.hash !== hash) location.hash = hash;
  showRoute();
}

function readLiveProject(id: string): ProjectRecord | undefined {
  let record: ProjectRecord | undefined;
  try { record = getProject(store.local, id); } catch (error) { toast(messageOf(error)); routeToasted = true; return undefined; }
  if (record && !record.deletedAt) return record;
  routeToasted = true;
  if (record) {
    toast(`“${record.name}” was deleted.`, {
      action: {
        label: 'Restore',
        shortcut: true, // reverses a delete, like Undo
        run: () => {
          try { restoreProject(store.local, id); } catch (error) { toast(messageOf(error)); return; }
          navigate(routeHash({ view: 'project', id }));
        },
      },
    });
  } else toast("That project isn't on this device anymore.");
  return undefined;
}

function showEditor(): void {
  projectsPage.hidden = true;
  editorRoot.hidden = false;
  document.body.dataset.view = 'editor';
  document.title = editor.documentTitle();
}

function showProjects(): void {
  editorRoot.hidden = true;
  projectsPage.hidden = false;
  document.body.dataset.view = 'projects';
  projectsView.render();
}

function showRoute(initial = false): void {
  const options = pendingOpen;
  pendingOpen = undefined;
  let route = parseRoute(location.hash);
  if (route.view === 'none') {
    // No hash (e.g. the installed app's start URL): this tab's project, the last opened one, or the most recent.
    const start = resolveStartupProject(store.local, store.session);
    route = start ? { view: 'project', id: start.project.id } : { view: 'home' };
    history.replaceState(history.state, '', routeHash(route));
  }
  if (displayed && sameRoute(route, displayed)) {
    if (options?.addKeys && route.view !== 'home') editor.openKeyDialog();
    return;
  }
  closeMenu(false);
  closeAllDialogs();
  let addKeys = false;
  if (route.view === 'project') {
    const record = readLiveProject(route.id);
    if (record) {
      if (editor.session?.id !== record.id) editor.open(record, { ui: takeUiState(record.id) });
      addKeys = !!options?.addKeys;
      showEditor();
      displayed = route;
    } else {
      route = { view: 'home' };
      history.replaceState(history.state, '', routeHash(route));
    }
  } else if (route.view === 'new') {
    editor.open({ config: { ...defaultConfig(), slots: [], template: route.template } });
    addKeys = true;
    showEditor();
    displayed = route;
  }
  if (route.view === 'home') {
    editor.close();
    forgetOpenProject(store.session);
    showProjects();
    displayed = route;
  }
  if (!initial) {
    const heading = route.view === 'home' ? document.getElementById('projects-title') : null;
    if (heading) heading.focus(); else if (route.view !== 'home') editor.focusHeading();
  }
  if (addKeys) editor.openKeyDialog();
}

window.addEventListener('hashchange', () => showRoute());

/* ───────────── Theme ───────────── */

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const resolvedTheme = (): 'light' | 'dark' => (prefs.theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : prefs.theme);

function applyTheme(): void {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  const toggle = byId('theme-toggle');
  const label = theme === 'dark' ? 'Use light theme' : 'Use dark theme';
  toggle.innerHTML = icon(theme === 'dark' ? 'sun' : 'moon');
  toggle.setAttribute('aria-label', label);
  toggle.title = label;
  // Following the system: each media-specific meta keeps its own colour. Explicit: both use the chosen theme.
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const own = (meta.media ?? '').includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light;
    meta.content = prefs.theme === 'system' ? own : THEME_COLORS[theme];
  }
  editor.setTheme(theme);
}
darkQuery.addEventListener('change', () => { if (prefs.theme === 'system') applyTheme(); });

/* ───────────── Global events ───────────── */

document.addEventListener('click', event => {
  const target = (event.target as Element).closest<HTMLElement>('button, a');
  if (!target || editorRoot.contains(target) || projectsPage.contains(target) || (target as HTMLButtonElement).disabled) return;
  if (target.id === 'theme-toggle') {
    prefs.theme = resolvedTheme() === 'dark' ? 'light' : 'dark';
    savePrefs();
    applyTheme();
    return;
  }
  if (target.id === 'update-app') { void pwa.applyUpdate(); return; }
  switch (target.dataset.action) {
    case 'home': navigate(routeHash({ view: 'home' })); break;
    case 'help': openHelp(); break;
    case 'install': void install(); break;
    case 'check-updates': void checkForUpdates(); break;
    case 'update-now': void pwa.applyUpdate(); break;
  }
});

document.addEventListener('keydown', event => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
  const key = shortcutLetter(event);
  // Ctrl/Cmd+Z runs the toast's Undo (never Open, Update…); text fields keep their own undo.
  if (key === 'z' && !isTextEntry(event.target)) {
    if (runToastAction()) event.preventDefault();
  } else if (key === 's' && !editorRoot.hidden && editor.session) {
    event.preventDefault();
    editor.saveShortcut();
  }
});

window.addEventListener('storage', event => {
  if (event.key === DISPLAY_KEY || event.key === null) {
    prefs = readDisplayPrefs(store.local);
    applyTheme();
    editor.applyPrefs();
  }
  editor.handleStorageEvent(event);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { editor.flush(); saveUiState(); }
  else editor.sync();
});
window.addEventListener('pagehide', () => { editor.flush(); saveUiState(); });
// Reloading, closing or leaving while the latest edit can't be saved: let the browser ask first.
// Registered only while autosave is failing, so pages stay eligible for the back/forward cache.
function guardUnsavedEdits(event: BeforeUnloadEvent): void {
  if (leavingForUpdate || !editor.session?.pending || editor.flush()) return;
  event.preventDefault();
  event.returnValue = '';
}
function setUnloadGuard(failing: boolean): void {
  if (failing) window.addEventListener('beforeunload', guardUnsavedEdits);
  else window.removeEventListener('beforeunload', guardUnsavedEdits);
}
window.addEventListener('pageshow', event => { if (event.persisted) editor.sync(); });

/* ───────────── Start ───────────── */

applyTheme();
renderPwaStatus();

/** PROD: after an update reload, say so once. */
function updatedMessage(): string | undefined {
  if (!import.meta.env.PROD) return undefined;
  let previous: string | null = null;
  try {
    previous = store.local.getItem(BUILD_KEY);
    if (previous !== __BUILD_ID__) store.local.setItem(BUILD_KEY, __BUILD_ID__);
  } catch { /* non-critical */ }
  return previous && previous !== __BUILD_ID__ ? 'Updated to the latest version. Your projects are unchanged.' : undefined;
}

const updated = updatedMessage();
showRoute(true);
requestPersistentStorage(store);
if (!routeToasted) {
  // Migration problems are reported only on this start, so no other start-up toast may hide them.
  const problems = migration.problems.length;
  const kept = problems === 1 ? " One older item couldn't be moved and has been kept in this browser."
    : problems ? ` ${problems} older items couldn't be moved and have been kept in this browser.` : '';
  const seeProjects = { label: 'See projects', run: () => navigate(routeHash({ view: 'home' })) };
  // Projects lists the kept legacy data (Download raw data).
  const offer = problems && legacyProblemKeys().length ? { action: seeProjects } : {};
  if (updated) toast(`${updated}${kept}`, offer);
  else if (migration.ran && migration.imported.length && !prefs.seen.autosaveIntro) {
    prefs.seen.autosaveIntro = true;
    savePrefs();
    toast(`Your organizers now save automatically. Find them all under Projects.${kept}`, { action: seeProjects });
  } else if (problems) toast(problems === 1 ? migration.problems[0].message : kept.trim(), offer);
}
