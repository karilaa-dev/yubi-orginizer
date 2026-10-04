import { DISPLAY_KEY as LEGACY_DISPLAY_KEY, STORAGE_KEY as LEGACY_CONFIG_KEY, TEMPLATES, defaultConfig, parseConfig, validateConfig } from './config';
import { appendLayer, projectLayers } from './layers';
import type { HolderConfig, TemplateId, TrayLayer } from './types';

/* ───────────────────────── Storage keys ───────────────────────── */

/** One localStorage entry per project: `${PROJECT_KEY_PREFIX}${id}` → ProjectRecord JSON. */
export const PROJECT_KEY_PREFIX = 'yubi-orginizer.project.v1:';
/** localStorage: id of the project most recently opened or edited in any window. */
export const LAST_PROJECT_KEY = 'yubi-orginizer.last-project.v1';
/** sessionStorage: id of the project open in this tab, so a reload/update reopens it. */
export const TAB_PROJECT_KEY = 'yubi-orginizer.open-project.v1';
export const DISPLAY_KEY = 'yubi-orginizer.display.v1';
export const MIGRATION_KEY = 'yubi-orginizer.migration.v1';
/** Written by Keyform / yubikey-organizer builds. Read-only: never modified or removed. */
export const LEGACY_KEYS = {
  projects: 'keyform.projects.v1',
  draft: 'keyform.draft.v1',
  activeProject: 'keyform.active-project.v1',
  config: LEGACY_CONFIG_KEY,
  display: LEGACY_DISPLAY_KEY,
} as const;

export const MAX_PROJECT_NAME = 80;
/** Deleted projects stay restorable ("Recently deleted") for this long. */
export const DELETED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** When storage is full, tombstones older than this are purged to make room (keeps undo toasts working). */
export const QUOTA_PURGE_GRACE_MS = 60_000;

/* ───────────────────────── Types ───────────────────────── */

export type ProjectStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key'> & { readonly length: number };
export type SessionAccess = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface ProjectRecord {
  version: 1;
  id: string;
  name: string;
  /** True while the name is a generated default ("Inventory tray 2"); it then follows organizer-type changes. */
  autoName: boolean;
  createdAt: string;
  /** Last configuration edit. Renames, deletes and restores do not change it. */
  updatedAt: string;
  /** Configuration revision; +1 on every config write. Used to detect edits from another window. */
  rev: number;
  /** Set when moved to "Recently deleted"; purged after DELETED_RETENTION_MS. */
  deletedAt?: string;
  config: HolderConfig;
}
export interface ProjectProblem { key: string; message: string }
export interface ProjectList { projects: ProjectRecord[]; deleted: ProjectRecord[]; problems: ProjectProblem[] }
export interface MigrationReport {
  /** False when nothing changed in the legacy keys since the last run. */
  ran: boolean;
  imported: ProjectRecord[];
  problems: { source: string; message: string }[];
  /** The project that matches the old "Continue last project" state, when known. */
  lastProjectId?: string;
}
export interface DisplayPrefs {
  showKeys: boolean;
  /** 'system' follows prefers-color-scheme; only an explicit toggle stores light/dark. */
  theme: 'light' | 'dark' | 'system';
  quality: 'high' | 'low';
  /** Open settings groups per organizer type. A missing entry means "use first-run defaults". */
  openGroups: Partial<Record<TemplateId, string[]>>;
  /** One-time hints that were already shown or dismissed. */
  seen: { orbitHint: boolean; dockNotice: boolean; offlineReady: boolean; autosaveIntro: boolean };
}
export interface BrowserStorage { local: ProjectStorage; session?: SessionAccess; persistent: boolean }

export type ProjectErrorCode = 'invalid' | 'corrupt' | 'missing' | 'deleted' | 'conflict' | 'quota' | 'unavailable';
export class ProjectStoreError extends Error {
  readonly code: ProjectErrorCode;
  /** The stored record, for 'conflict' and 'deleted', and for 'quota' from deleteProject(). */
  readonly current?: ProjectRecord;
  constructor(code: ProjectErrorCode, message: string, current?: ProjectRecord) {
    super(message);
    this.name = 'ProjectStoreError';
    this.code = code;
    this.current = current;
  }
}
const MESSAGES = {
  corrupt: 'A saved project could not be read. Existing data has been kept.',
  missing: 'This project no longer exists.',
  deleted: 'This project was deleted.',
  conflict: 'This project was changed in another window.',
  quota: "Browser storage is full, so this change wasn't saved. Save a project file (.json) to keep it, then delete projects you no longer need.",
  deleteQuota: "Browser storage is full, so this project couldn't be moved to Recently deleted. Nothing was deleted.",
  migrationQuota: "Browser storage is full, so some projects from the previous version weren't moved yet. This will be retried next time.",
  unavailable: 'Browser storage is unavailable, so this project could not be saved.',
} as const;

/* ───────────────────────── Small helpers ───────────────────────── */

const ID = /^[\w-]{1,80}$/;
export const projectKey = (id: string): string => PROJECT_KEY_PREFIX + id;
const iso = (date: Date): string => date.toISOString();
const isDate = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const time = (value: string): number => Date.parse(value);
/** Both sides are validateConfig() output, whose key order is fixed. */
const sameConfig = (a: HolderConfig, b: HolderConfig): boolean => JSON.stringify(a) === JSON.stringify(b);

/** FNV-1a 32-bit + length. Change detection and deterministic ids only — not security. */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36) + text.length.toString(36);
}

export function isQuotaError(error: unknown): boolean {
  const e = error as { name?: unknown; code?: unknown } | null;
  return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014);
}

function valid(config: unknown): HolderConfig {
  try { return validateConfig(config); } catch (error) { throw new ProjectStoreError('invalid', (error as Error).message); }
}

/** Collapses whitespace/control characters; 1–80 characters. */
export function normalizeProjectName(value: unknown): string {
  // eslint-disable-next-line no-control-regex
  const name = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > MAX_PROJECT_NAME) throw new ProjectStoreError('invalid', `Enter a project name with 1–${MAX_PROJECT_NAME} characters.`);
  return name;
}
const withSuffix = (base: string, suffix: string): string => `${base.slice(0, MAX_PROJECT_NAME - suffix.length).trimEnd()}${suffix}`;
function nextFreeName(base: string, taken: Iterable<string>): string {
  const used = new Set(Array.from(taken, name => name.toLocaleLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? base : withSuffix(base, ` ${n}`);
    if (!used.has(candidate.toLocaleLowerCase())) return candidate;
  }
}
/** "Inventory tray", then "Inventory tray 2", "Inventory tray 3"… (smallest free number). */
export function defaultProjectName(template: TemplateId, taken: Iterable<string>): string {
  return nextFreeName(TEMPLATES.find(t => t.id === template)?.name ?? 'Organizer', taken);
}
const liveNames = (storage: ProjectStorage, exceptId?: string): string[] =>
  listProjects(storage).projects.filter(p => p.id !== exceptId).map(p => p.name);
export function suggestProjectName(storage: ProjectStorage, template: TemplateId): string {
  return defaultProjectName(template, liveNames(storage));
}

/* ───────────────────────── Record I/O ───────────────────────── */

function parseRecord(id: string, raw: string): ProjectRecord {
  try {
    const d = JSON.parse(raw) as Record<string, unknown> | null;
    if (!ID.test(id) || !d || typeof d !== 'object' || Array.isArray(d) || d.version !== 1 || d.id !== id
      || typeof d.name !== 'string' || normalizeProjectName(d.name) !== d.name || typeof d.autoName !== 'boolean'
      || !isDate(d.createdAt) || !isDate(d.updatedAt) || !Number.isSafeInteger(d.rev) || (d.rev as number) < 1
      || (d.deletedAt !== undefined && !isDate(d.deletedAt))) throw new Error();
    return {
      version: 1, id, name: d.name, autoName: d.autoName, createdAt: d.createdAt, updatedAt: d.updatedAt, rev: d.rev as number,
      ...(d.deletedAt !== undefined ? { deletedAt: d.deletedAt as string } : {}),
      config: validateConfig(d.config),
    };
  } catch { throw new ProjectStoreError('corrupt', MESSAGES.corrupt); }
}

/** Throws 'corrupt' (never repairs or replaces the stored value); undefined when absent. */
export function getProject(storage: Pick<Storage, 'getItem'>, id: string): ProjectRecord | undefined {
  if (!ID.test(id)) return undefined;
  const raw = storage.getItem(projectKey(id));
  return raw === null ? undefined : parseRecord(id, raw);
}
function requireLive(storage: ProjectStorage, id: string): ProjectRecord {
  const record = getProject(storage, id);
  if (!record) throw new ProjectStoreError('missing', MESSAGES.missing);
  if (record.deletedAt) throw new ProjectStoreError('deleted', MESSAGES.deleted, record);
  return record;
}

/** Single setItem per operation. Quota → purge old tombstones (never `record` itself) and retry once. */
function writeRecord(storage: ProjectStorage, record: ProjectRecord, now: Date): ProjectRecord {
  const key = projectKey(record.id), raw = JSON.stringify(record);
  try { storage.setItem(key, raw); return record; } catch (error) {
    let failure = error;
    if (isQuotaError(error) && purgeDeletedProjects(storage, now, QUOTA_PURGE_GRACE_MS, record.id) > 0) {
      try { storage.setItem(key, raw); return record; } catch (retry) { failure = retry; }
    }
    const quota = isQuotaError(failure);
    throw new ProjectStoreError(quota ? 'quota' : 'unavailable', quota ? MESSAGES.quota : MESSAGES.unavailable);
  }
}

function storedIds(storage: ProjectStorage): string[] {
  const ids: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null && key.startsWith(PROJECT_KEY_PREFIX)) ids.push(key.slice(PROJECT_KEY_PREFIX.length));
  }
  return ids;
}
const byRecent = (a: ProjectRecord, b: ProjectRecord): number =>
  time(b.updatedAt) - time(a.updatedAt) || time(b.createdAt) - time(a.createdAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** Never throws for bad entries: unreadable ones are reported in `problems` and left untouched. */
export function listProjects(storage: ProjectStorage): ProjectList {
  const list: ProjectList = { projects: [], deleted: [], problems: [] };
  for (const id of storedIds(storage)) {
    const raw = storage.getItem(projectKey(id));
    if (raw === null) continue;
    try { const record = parseRecord(id, raw); (record.deletedAt ? list.deleted : list.projects).push(record); }
    catch (error) { list.problems.push({ key: projectKey(id), message: (error as Error).message }); }
  }
  list.projects.sort(byRecent);
  list.deleted.sort((a, b) => time(b.deletedAt!) - time(a.deletedAt!));
  return list;
}

/* ───────────────────────── Project operations ───────────────────────── */

/** Omit `name` for a generated default name that follows organizer-type changes. */
export function createProject(storage: ProjectStorage, input: { config: unknown; name?: string }, now = new Date()): ProjectRecord {
  const config = valid(input.config);
  const autoName = input.name === undefined;
  const name = autoName ? defaultProjectName(config.template, liveNames(storage)) : normalizeProjectName(input.name);
  const stamp = iso(now);
  return writeRecord(storage, { version: 1, id: crypto.randomUUID(), name, autoName, createdAt: stamp, updatedAt: stamp, rev: 1, config }, now);
}

export interface UpdateOptions {
  /** Revision the caller's edit is based on; a different stored rev throws 'conflict' with `current`. */
  baseRev?: number;
  /** false for automatic migrations (e.g. legacy lid text) so the list order does not change. */
  touch?: boolean;
  now?: Date;
}
/** No write (and no storage event) when the config is unchanged. */
export function updateProjectConfig(storage: ProjectStorage, id: string, config: unknown, options: UpdateOptions = {}): ProjectRecord {
  const next = valid(config);
  const current = requireLive(storage, id);
  if (options.baseRev !== undefined && current.rev !== options.baseRev) throw new ProjectStoreError('conflict', MESSAGES.conflict, current);
  if (sameConfig(current.config, next)) return current;
  const now = options.now ?? new Date();
  const name = current.autoName && next.template !== current.config.template ? defaultProjectName(next.template, liveNames(storage, id)) : current.name;
  return writeRecord(storage, { ...current, name, config: next, rev: current.rev + 1, updatedAt: options.touch === false ? current.updatedAt : iso(now) }, now);
}

export function renameProject(storage: ProjectStorage, id: string, name: string, now = new Date()): ProjectRecord {
  const clean = normalizeProjectName(name);
  const current = requireLive(storage, id);
  if (current.name === clean && !current.autoName) return current;
  return writeRecord(storage, { ...current, name: clean, autoName: false }, now);
}

/** "Desk tray copy", "Desk tray copy 2"… */
export function duplicateProject(storage: ProjectStorage, id: string, now = new Date()): ProjectRecord {
  const source = requireLive(storage, id);
  const stamp = iso(now);
  return writeRecord(storage, {
    version: 1, id: crypto.randomUUID(), name: nextFreeName(withSuffix(source.name, ' copy'), liveNames(storage)), autoName: false,
    createdAt: stamp, updatedAt: stamp, rev: 1, config: structuredClone(source.config),
  }, now);
}

/* ───────────────────────── Matching tray layers ───────────────────────── */

const LAYER_SUFFIX = /\s+[–-]\s+layer\s+(\d+)$/i;
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** "Desk" → "Desk – layer 2"; "Desk – layer 2" → "Desk – layer 3". Never chains suffixes. */
export function matchingLayerName(sourceName: string, taken: Iterable<string>): string {
  const base = sourceName.replace(LAYER_SUFFIX, '').trim() || sourceName.trim();
  const own = LAYER_SUFFIX.exec(sourceName);
  const pattern = new RegExp(`^${escapeRegExp(base)}\\s+[–-]\\s+layer\\s+(\\d+)$`, 'i');
  let highest = own ? Number(own[1]) : 1;
  for (const name of taken) { const match = pattern.exec(name); if (match) highest = Math.max(highest, Number(match[1])); }
  return withSuffix(base, ` – layer ${highest + 1}`);
}

export interface MatchingLayerResult {
  source: ProjectRecord;
  layer: TrayLayer;
  layerIndex: number;
  previousSourceConfig: HolderConfig;
}
/** Add a matching tray to the same project in a single revision-checked storage write. */
export function createMatchingLayer(
  storage: ProjectStorage, sourceId: string,
  options: { footprint: { width: number; depth: number }; name?: string; sourceIndex?: number },
  now = new Date(),
): MatchingLayerResult {
  const source = requireLive(storage, sourceId);
  const previousSourceConfig = structuredClone(source.config);
  const next = appendLayer(source.config, options.sourceIndex ?? projectLayers(source.config).length - 1, options);
  const updated = updateProjectConfig(storage, source.id, next, { baseRev: source.rev, now });
  const layers = projectLayers(updated.config);
  return { source: updated, layer: layers.at(-1)!, layerIndex: layers.length - 1, previousSourceConfig };
}

/**
 * Soft delete. Keep the returned record for the Undo toast → restoreProject(storage, record.id).
 * The tombstone is slightly larger than the record, so it can't be written when storage is full:
 * that throws 'quota' with `current`, and nothing changes. removeProject() can then free the space.
 */
export function deleteProject(storage: ProjectStorage, id: string, now = new Date()): ProjectRecord {
  const current = requireLive(storage, id);
  try { return writeRecord(storage, { ...current, deletedAt: iso(now) }, now); } catch (error) {
    if (error instanceof ProjectStoreError && error.code === 'quota') throw new ProjectStoreError('quota', MESSAGES.deleteQuota, current);
    throw error;
  }
}

/**
 * Removes a project (live or deleted) right away, skipping "Recently deleted". For when storage is
 * too full for deleteProject(): it frees the project's own space. Undo → reinsertProject(storage, record).
 */
export function removeProject(storage: ProjectStorage, id: string): ProjectRecord {
  const current = getProject(storage, id);
  if (!current) throw new ProjectStoreError('missing', MESSAGES.missing);
  storage.removeItem(projectKey(id));
  return current;
}

/** Undo for removeProject(): writes the record back as a live project. No write when it is already back. */
export function reinsertProject(storage: ProjectStorage, record: ProjectRecord, now = new Date()): ProjectRecord {
  const current = getProject(storage, record.id);
  if (current) return current.deletedAt ? restoreProject(storage, record.id, now) : current;
  const { deletedAt: _deletedAt, ...restored } = record;
  return writeRecord(storage, restored, now);
}

export function restoreProject(storage: ProjectStorage, id: string, now = new Date()): ProjectRecord {
  const current = getProject(storage, id);
  if (!current) throw new ProjectStoreError('missing', MESSAGES.missing);
  if (!current.deletedAt) return current;
  const { deletedAt: _deletedAt, ...restored } = current;
  return writeRecord(storage, restored, now);
}

/** Removes a project that is already in "Recently deleted". Returns false otherwise. */
export function deleteProjectForever(storage: ProjectStorage, id: string): boolean {
  const current = getProject(storage, id);
  if (!current?.deletedAt) return false;
  storage.removeItem(projectKey(id));
  return true;
}

/** Removes tombstones older than `olderThanMs`. Unreadable entries are never removed. */
export function purgeDeletedProjects(storage: ProjectStorage, now = new Date(), olderThanMs = DELETED_RETENTION_MS, keepId?: string): number {
  let removed = 0;
  for (const id of storedIds(storage)) {
    if (id === keepId) continue;
    let record: ProjectRecord | undefined;
    try { record = getProject(storage, id); } catch { continue; }
    if (record?.deletedAt && now.getTime() - time(record.deletedAt) >= olderThanMs) {
      try { storage.removeItem(projectKey(id)); removed++; } catch { /* keep it */ }
    }
  }
  return removed;
}

/* ───────────────────────── Import / export ───────────────────────── */

function nameFromFile(fileName?: string): string | undefined {
  const stem = (fileName ?? '').replace(/^.*[\\/]/, '').replace(/\.json$/i, '').replace(/\.(yubi-orginizer|keyform)$/i, '');
  if (!stem || stem.toLowerCase() === 'project' || TEMPLATES.some(t => t.id === stem)) return undefined;
  try { return normalizeProjectName(stem); } catch { return undefined; }
}
/** Always a new project. Name: embedded "name" → file name → default name. */
export function importProject(storage: ProjectStorage, text: string, fileName?: string, now = new Date()): ProjectRecord {
  let config: HolderConfig;
  try { config = parseConfig(text); } catch (error) { throw new ProjectStoreError('invalid', (error as Error).message); }
  let name: string | undefined;
  try {
    const embedded = (JSON.parse(text) as { name?: unknown }).name;
    if (embedded !== undefined) name = normalizeProjectName(typeof embedded === 'string' ? embedded.slice(0, MAX_PROJECT_NAME) : embedded);
  } catch { /* fall back to the file name */ }
  return createProject(storage, { config, name: name ?? nameFromFile(fileName) }, now);
}

/* ───────────────────────── Last-opened project ───────────────────────── */

export function rememberOpenProject(local: ProjectStorage, session: SessionAccess | undefined, id: string): void {
  try { session?.setItem(TAB_PROJECT_KEY, id); } catch { /* non-critical */ }
  try { if (local.getItem(LAST_PROJECT_KEY) !== id) local.setItem(LAST_PROJECT_KEY, id); } catch { /* non-critical */ }
}
export function forgetOpenProject(session: SessionAccess | undefined): void {
  try { session?.removeItem(TAB_PROJECT_KEY); } catch { /* non-critical */ }
}
/** This tab's project (reload / update) → last opened anywhere → most recently edited. */
export function resolveStartupProject(local: ProjectStorage, session?: SessionAccess): { project: ProjectRecord; reason: 'tab' | 'last' | 'recent' } | undefined {
  const live = (id: string | null | undefined): ProjectRecord | undefined => {
    if (!id) return undefined;
    try { const record = getProject(local, id); return record && !record.deletedAt ? record : undefined; } catch { return undefined; }
  };
  let tabId: string | null = null;
  try { tabId = session?.getItem(TAB_PROJECT_KEY) ?? null; } catch { /* ignore */ }
  const fromTab = live(tabId);
  if (fromTab) return { project: fromTab, reason: 'tab' };
  const fromLast = live(local.getItem(LAST_PROJECT_KEY));
  if (fromLast) return { project: fromLast, reason: 'last' };
  const recent = listProjects(local).projects[0];
  return recent ? { project: recent, reason: 'recent' } : undefined;
}

/* ───────────────────────── Display preferences ───────────────────────── */

/** Lazy migration: new key, else the legacy key; never throws; never writes. */
export function readDisplayPrefs(storage: Pick<Storage, 'getItem'>): DisplayPrefs {
  const parse = (key: string): Record<string, unknown> | undefined => {
    try {
      const raw = storage.getItem(key);
      const data = raw === null ? undefined : JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
    } catch { return undefined; }
  };
  const d = parse(DISPLAY_KEY) ?? parse(LEGACY_KEYS.display) ?? {};
  const openGroups: DisplayPrefs['openGroups'] = {};
  const groups = d.openGroups && typeof d.openGroups === 'object' && !Array.isArray(d.openGroups) ? d.openGroups as Record<string, unknown> : {};
  for (const t of TEMPLATES) {
    const list = groups[t.id];
    if (Array.isArray(list) && list.length <= 16 && list.every(v => typeof v === 'string' && /^[a-z]{1,32}$/.test(v))) openGroups[t.id] = [...new Set(list as string[])];
  }
  const seen = d.seen && typeof d.seen === 'object' && !Array.isArray(d.seen) ? d.seen as Record<string, unknown> : {};
  return {
    showKeys: d.showKeys !== false, theme: d.theme === 'light' || d.theme === 'dark' ? d.theme : 'system', quality: d.quality === 'low' ? 'low' : 'high',
    openGroups,
    seen: { orbitHint: seen.orbitHint === true, dockNotice: seen.dockNotice === true, offlineReady: seen.offlineReady === true, autosaveIntro: seen.autosaveIntro === true },
  };
}
export function writeDisplayPrefs(storage: Pick<Storage, 'setItem'>, prefs: DisplayPrefs): boolean {
  try { storage.setItem(DISPLAY_KEY, JSON.stringify(prefs)); return true; } catch { return false; }
}

/* ───────────────────────── Browser storage access ───────────────────────── */

export type MemoryStorage = ProjectStorage & { clear(): void };
export function createMemoryStorage(): MemoryStorage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    key: index => [...map.keys()][index] ?? null,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => { map.set(String(key), String(value)); },
    removeItem: key => { map.delete(key); },
    clear: () => { map.clear(); },
  };
}
/** Falls back to memory (persistent: false) when storage access is blocked. A full quota is still persistent. */
export function openBrowserStorage(): BrowserStorage {
  let local: ProjectStorage | undefined, session: SessionAccess | undefined;
  try { local = window.localStorage; local.getItem(MIGRATION_KEY); } catch { local = undefined; }
  try { session = window.sessionStorage; session.getItem(TAB_PROJECT_KEY); } catch { session = undefined; }
  return local ? { local, session, persistent: true } : { local: createMemoryStorage(), session, persistent: false };
}

/* ───────────────────────── Legacy migration ───────────────────────── */

interface MigrationMarker {
  version: 1;
  firstRunAt: string;
  lastRunAt: string;
  /** Legacy key → fingerprint of its raw value when last fully processed ('-' = absent). */
  sources: Record<string, string>;
  /** Legacy items already handled: `p:<id>:<fp>`, `d:<fp>`, `c:<fp>`. */
  seen: string[];
  /** Every project id migration has created, so deleted-then-purged projects are never re-imported. */
  importedIds: string[];
  /** Legacy keys with data that could not be read when last processed (kept untouched). See legacyProblemKeys(). */
  unreadable?: string[];
}
const SOURCES = [LEGACY_KEYS.projects, LEGACY_KEYS.draft, LEGACY_KEYS.config, LEGACY_KEYS.activeProject] as const;
type Source = (typeof SOURCES)[number];

function parseMarker(raw: string): MigrationMarker {
  const d = JSON.parse(raw);
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(s => typeof s === 'string');
  if (!d || typeof d !== 'object' || d.version !== 1 || !isDate(d.firstRunAt) || !isDate(d.lastRunAt)
    || !d.sources || typeof d.sources !== 'object' || Array.isArray(d.sources) || !Object.values(d.sources).every(s => typeof s === 'string')
    || !strings(d.seen) || !strings(d.importedIds)) throw new Error();
  if (d.unreadable !== undefined && !strings(d.unreadable)) delete d.unreadable; // optional; never blocks migration
  return d as MigrationMarker;
}

/**
 * Legacy keys that migration could not fully read and kept untouched, while they still exist:
 * the Projects page offers them as raw data on every start, not only the one that found the problem.
 */
export function legacyProblemKeys(storage: ProjectStorage): string[] {
  let marker: MigrationMarker;
  try {
    const raw = storage.getItem(MIGRATION_KEY);
    if (raw === null) return [];
    marker = parseMarker(raw);
  } catch { return []; }
  return (marker.unreadable ?? []).filter(key => { try { return storage.getItem(key) !== null; } catch { return false; } });
}
const legacyId = (id: string): string => (ID.test(id) ? id : `keyform-${fingerprint(id)}`);
const safeName = (value: unknown, fallback: string): string => {
  try { return normalizeProjectName(typeof value === 'string' ? value.slice(0, MAX_PROJECT_NAME) : value); } catch { return fallback; }
};
function isBlank(config: HolderConfig): boolean {
  return config.slots.length === 0 && sameConfig(config, validateConfig({ ...defaultConfig(), slots: [], template: config.template }));
}

/**
 * Copies Keyform / yubikey-organizer data into the new per-project keys. Never writes legacy keys.
 * Cheap no-op when the legacy keys are unchanged since the last run (fingerprint check), so it is
 * safe to call on every start: an old build still open in another tab keeps being picked up.
 */
export function migrateLegacyStorage(storage: ProjectStorage, now = new Date()): MigrationReport {
  const report: MigrationReport = { ran: false, imported: [], problems: [] };
  let marker: MigrationMarker | undefined;
  const markerRaw = storage.getItem(MIGRATION_KEY);
  if (markerRaw !== null) {
    try { marker = parseMarker(markerRaw); } catch {
      report.problems.push({ source: MIGRATION_KEY, message: 'The storage upgrade record could not be read, so projects from the previous version were not imported again. Existing data has been kept.' });
      return report;
    }
  }
  const raw = {} as Record<Source, string | null>, prints = {} as Record<Source, string>;
  for (const key of SOURCES) {
    raw[key] = storage.getItem(key);
    prints[key] = raw[key] === null ? '-' : fingerprint(raw[key]!) + (/"traySet"\s*:/.test(raw[key]!) ? ':layers' : '');
  }
  const changed = (key: Source): boolean => marker?.sources[key] !== prints[key];
  if (!SOURCES.some(changed)) return report;
  report.ran = true;

  const firstRun = !marker;
  const seen = new Set(marker?.seen), importedIds = new Set(marker?.importedIds), retry = new Set<Source>(), unreadable = new Set<Source>();
  const existing = listProjects(storage);
  const byConfig = new Map([...existing.deleted, ...existing.projects].map(r => [JSON.stringify(r.config), r.id]));
  const names = existing.projects.map(p => p.name);
  const read = (id: string): ProjectRecord | undefined | 'corrupt' => { try { return getProject(storage, id); } catch { return 'corrupt'; } };
  const stamp = (value: unknown): string => (isDate(value) ? iso(new Date(value)) : iso(now));
  const record = (id: string, name: string, autoName: boolean, config: HolderConfig, createdAt: string, updatedAt: string): ProjectRecord =>
    ({ version: 1, id, name, autoName, createdAt, updatedAt, rev: 1, config });
  const write = (source: Source, item: string, next: ProjectRecord): boolean => {
    try { writeRecord(storage, next, now); } catch (error) {
      const full = error instanceof ProjectStoreError && error.code === 'quota';
      report.problems.push({ source, message: full ? MESSAGES.migrationQuota : (error as Error).message }); retry.add(source); return false;
    }
    seen.add(item); importedIds.add(next.id); byConfig.set(JSON.stringify(next.config), next.id); names.push(next.name); report.imported.push(next);
    return true;
  };
  /** Shared by the Keyform draft and the yubikey-organizer config. Returns the matching/created project id. */
  const adoptDraft = (source: Source, config: HolderConfig, opts: { ownerId?: string; owned: boolean; name: () => { name: string; autoName: boolean } }): string | undefined => {
    const serialized = JSON.stringify(config), item = `${source === LEGACY_KEYS.draft ? 'd' : 'c'}:${fingerprint(serialized)}`;
    if (seen.has(item)) return undefined;
    const owner = opts.ownerId ? read(opts.ownerId) : undefined;
    const ownerRecord = owner && owner !== 'corrupt' ? owner : undefined;
    const match = ownerRecord && sameConfig(ownerRecord.config, config) ? ownerRecord.id : byConfig.get(serialized);
    if (match) { seen.add(item); return match; }
    const owned = opts.owned && !!ownerRecord;
    if (!owned && isBlank(config)) { seen.add(item); return undefined; }
    const id = `${source === LEGACY_KEYS.draft ? 'keyform-draft' : 'legacy-draft'}-${fingerprint(serialized)}`;
    const target = read(id);
    if (target !== undefined || importedIds.has(id)) { seen.add(item); return target && target !== 'corrupt' ? id : undefined; }
    const { name, autoName } = owned ? { name: withSuffix(ownerRecord!.name, ' (unsaved changes)'), autoName: false } : opts.name();
    return write(source, item, record(id, name, autoName, config, iso(now), iso(now))) ? id : undefined;
  };

  // 1. Named Keyform projects: keep id, name and timestamps. Salvage entry by entry.
  const projectsKey = LEGACY_KEYS.projects;
  if (raw[projectsKey] !== null && changed(projectsKey)) {
    let entries: unknown[] = [];
    try {
      const data = JSON.parse(raw[projectsKey]!);
      if (!data || data.version !== 1 || !Array.isArray(data.projects)) throw new Error();
      entries = data.projects;
    } catch {
      unreadable.add(projectsKey);
      report.problems.push({ source: projectsKey, message: 'Saved projects from the previous version could not be read. They have been kept in this browser.' });
    }
    const used = new Set<string>();
    entries.forEach((entry, index) => {
      const e = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
      let config: HolderConfig;
      try { config = validateConfig(e.traySet === undefined ? e.config : { traySet: e.traySet }); } catch (error) {
        unreadable.add(projectsKey);
        report.problems.push({ source: projectsKey, message: `Saved project ${index + 1} could not be read (${(error as Error).message}). It has been kept in this browser.` });
        return;
      }
      let id = typeof e.id === 'string' && e.id ? legacyId(e.id) : `keyform-${index}`;
      if (used.has(id)) id = `${id.slice(0, 70)}-${index}`;
      used.add(id);
      const print = fingerprint(JSON.stringify(config)), item = `p:${id}:${print}`;
      if (seen.has(item)) return;
      const name = safeName(e.name, 'Imported project'), target = read(id);
      if (target === undefined && !importedIds.has(id)) { write(projectsKey, item, record(id, name, false, config, stamp(e.createdAt), stamp(e.updatedAt))); return; }
      // Repair an untouched import made before the prototype's traySet was understood.
      // Once edited, preserve both versions through the normal recovery path below.
      if (e.traySet !== undefined && target && target !== 'corrupt' && !target.deletedAt && target.rev === 1) {
        try {
          if (sameConfig(target.config, validateConfig(e.config))) {
            write(projectsKey, item, { ...target, config, rev: target.rev + 1 }); return;
          }
        } catch { /* A malformed old active config must not prevent recovery of its valid tray set. */ }
      }
      // Present from an interrupted first run, or unchanged: nothing to do.
      if (target && target !== 'corrupt' && (firstRun || sameConfig(target.config, config))) { seen.add(item); return; }
      // Changed by an older build after migration (or the target is unreadable): keep both versions.
      const copyId = `${id.slice(0, 64)}-${print}`;
      if (importedIds.has(copyId) || read(copyId) !== undefined) { seen.add(item); return; }
      write(projectsKey, item, record(copyId, withSuffix(name, ' (older version)'), false, config, stamp(e.createdAt), stamp(e.updatedAt)));
    });
  }

  // 2. Keyform draft: the editor state the old app would have reopened.
  const draftKey = LEGACY_KEYS.draft;
  let draftProject: string | undefined;
  if (raw[draftKey] !== null && changed(draftKey)) {
    try {
      const d = JSON.parse(raw[draftKey]!);
      if (!d || typeof d !== 'object' || Array.isArray(d) || d.version !== 1 || (d.projectId !== undefined && (typeof d.projectId !== 'string' || !d.projectId.trim()))) throw new Error();
      const config = validateConfig(d.traySet === undefined ? d.config : { traySet: d.traySet });
      draftProject = adoptDraft(draftKey, config, {
        ownerId: d.projectId === undefined ? undefined : legacyId(d.projectId), owned: true,
        name: () => ({ name: defaultProjectName(config.template, names), autoName: true }),
      });
    } catch {
      unreadable.add(draftKey);
      report.problems.push({ source: draftKey, message: 'Your last draft from the previous version could not be read. It has been kept in this browser.' });
    }
  }

  // 3. yubikey-organizer config (+ Keyform active-project hint). Superseded by the Keyform draft when both exist.
  const configKey = LEGACY_KEYS.config, activeKey = LEGACY_KEYS.activeProject;
  let configProject: string | undefined;
  if (raw[configKey] !== null && (changed(configKey) || changed(activeKey))) {
    let config: HolderConfig | undefined;
    try { config = parseConfig(raw[configKey]!); } catch {
      unreadable.add(configKey);
      report.problems.push({ source: configKey, message: 'An older saved organizer could not be read. It has been kept in this browser.' });
    }
    if (config) {
      const current = raw[draftKey] === null, active = raw[activeKey];
      configProject = adoptDraft(configKey, config, {
        ownerId: active ? legacyId(active) : undefined, owned: false,
        name: () => (current ? { name: defaultProjectName(config.template, names), autoName: true } : { name: 'Recovered draft', autoName: false }),
      });
      if (!current) configProject = undefined;
    }
  }
  if (retry.has(configKey)) retry.add(activeKey);

  report.lastProjectId = draftProject ?? configProject;
  if (firstRun && report.lastProjectId) {
    try { if (storage.getItem(LAST_PROJECT_KEY) === null) storage.setItem(LAST_PROJECT_KEY, report.lastProjectId); } catch { /* non-critical */ }
  }
  const sources: Record<string, string> = {};
  for (const key of SOURCES) sources[key] = retry.has(key) ? (marker?.sources[key] ?? 'retry') : prints[key];
  // Unreadable keys from earlier runs stay listed while they exist and were not processed again (unchanged).
  const processed = (key: Source): boolean => raw[key] !== null && (key === configKey ? changed(configKey) || changed(activeKey) : changed(key));
  for (const key of marker?.unreadable ?? []) {
    const source = SOURCES.find(k => k === key);
    if (source && raw[source] !== null && !processed(source)) unreadable.add(source);
  }
  const next: MigrationMarker = {
    version: 1, firstRunAt: marker?.firstRunAt ?? iso(now), lastRunAt: iso(now), sources, seen: [...seen], importedIds: [...importedIds],
    ...(unreadable.size ? { unreadable: [...unreadable] } : {}),
  };
  try { storage.setItem(MIGRATION_KEY, JSON.stringify(next)); } catch {
    report.problems.push({ source: MIGRATION_KEY, message: 'Browser storage is full. Moving older projects will be retried next time.' });
  }
  return report;
}

/* ───────────────────────── Open-project session (autosave + multi-window) ───────────────────────── */

export interface ProjectSessionEvents {
  /** After each successful write; update "Saved" status and the title (auto names can change). */
  onSaved?(record: ProjectRecord): void;
  /** quota / unavailable / corrupt. The edit stays pending in memory and is retried on the next edit/flush. */
  onError?(error: Error): void;
  /** Another window changed this project. Re-render from session.config / session.name. */
  onRemoteChange?(record: ProjectRecord, change: { configChanged: boolean; discardedLocalEdit: boolean }): void;
  /** Deleted (record) or removed/cleared (undefined) elsewhere. Writes pause; offer restore() / saveAsNew(). */
  onRemoteDelete?(record: ProjectRecord | undefined): void;
}
export interface ProjectSessionOptions { session?: SessionAccess; delayMs?: number; maxWaitMs?: number }

/**
 * The project open in the editor. A new, untouched project (`{ config }`) is not written until the
 * first edit or rename, so browsing organizer types never litters the project list.
 */
export class ProjectSession {
  readonly #storage: ProjectStorage;
  readonly #events: ProjectSessionEvents;
  readonly #session?: SessionAccess;
  readonly #delayMs: number;
  readonly #maxWaitMs: number;
  #record: ProjectRecord | undefined;
  #config: HolderConfig;
  #draftName: string | undefined;
  #suggested: { template: TemplateId; name: string } | undefined;
  #pending = false;
  #touch = false;
  #blocked: 'deleted' | 'missing' | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #firstPendingAt: number | undefined;

  constructor(storage: ProjectStorage, start: ProjectRecord | { config: HolderConfig; name?: string }, events: ProjectSessionEvents = {}, options: ProjectSessionOptions = {}) {
    this.#storage = storage; this.#events = events; this.#session = options.session;
    this.#delayMs = options.delayMs ?? 400; this.#maxWaitMs = options.maxWaitMs ?? 2000;
    if ('id' in start) {
      if (start.deletedAt) throw new ProjectStoreError('deleted', MESSAGES.deleted, start);
      this.#record = start; this.#config = start.config;
      rememberOpenProject(storage, this.#session, start.id);
    } else {
      this.#config = valid(start.config);
      this.#draftName = start.name === undefined ? undefined : normalizeProjectName(start.name);
    }
  }

  get id(): string | undefined { return this.#record?.id; }
  get record(): ProjectRecord | undefined { return this.#record; }
  get config(): HolderConfig { return this.#config; }
  get pending(): boolean { return this.#pending; }
  get persisted(): boolean { return this.#record !== undefined; }
  get blocked(): 'deleted' | 'missing' | undefined { return this.#blocked; }
  get name(): string {
    if (this.#record) return this.#record.name;
    if (this.#draftName) return this.#draftName;
    if (this.#suggested?.template !== this.#config.template) this.#suggested = { template: this.#config.template, name: suggestProjectName(this.#storage, this.#config.template) };
    return this.#suggested.name;
  }

  /** Validates synchronously (throws 'invalid'); the write is debounced (delayMs, at most maxWaitMs). */
  edit(config: HolderConfig, options: { touch?: boolean } = {}): void {
    this.#config = valid(config);
    this.#pending = true;
    this.#touch ||= options.touch !== false;
    const now = Date.now();
    this.#firstPendingAt ??= now;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { this.flush(); }, Math.max(0, Math.min(this.#delayMs, this.#firstPendingAt + this.#maxWaitMs - now)));
  }

  /** Synchronous write of the pending edit. True when nothing unsaved remains. Call on pagehide/hidden, before switching projects and before applying an app update. */
  flush(): boolean {
    this.#clearTimer();
    if (!this.#pending) return true;
    if (this.#blocked) { this.#events.onRemoteDelete?.(this.#blocked === 'deleted' ? this.#record : undefined); return false; }
    try {
      if (!this.#record) {
        if (!this.#touch) { this.#pending = false; return true; }
        this.#record = createProject(this.#storage, { config: this.#config, name: this.#draftName });
        rememberOpenProject(this.#storage, this.#session, this.#record.id);
      } else {
        this.#record = updateProjectConfig(this.#storage, this.#record.id, this.#config, { baseRev: this.#record.rev, touch: this.#touch });
        rememberOpenProject(this.#storage, this.#session, this.#record.id);
      }
      this.#pending = false; this.#touch = false;
      this.#events.onSaved?.(this.#record);
      return true;
    } catch (error) {
      if (error instanceof ProjectStoreError && error.code === 'conflict' && error.current) { this.#adopt(error.current, true); return true; }
      if (error instanceof ProjectStoreError && (error.code === 'deleted' || error.code === 'missing')) {
        this.#blocked = error.code;
        if (error.current) this.#record = error.current;
        this.#events.onRemoteDelete?.(error.current);
        return false;
      }
      this.#events.onError?.(error as Error);
      return false;
    }
  }

  /** Persists a new project immediately with this name. Throws 'invalid' / storage errors for inline display. */
  rename(name: string): ProjectRecord {
    const clean = normalizeProjectName(name);
    if (!this.#record) {
      this.#clearTimer();
      this.#record = createProject(this.#storage, { config: this.#config, name: clean });
      this.#pending = false; this.#touch = false;
      rememberOpenProject(this.#storage, this.#session, this.#record.id);
    } else {
      this.#record = renameProject(this.#storage, this.#record.id, clean);
    }
    this.#events.onSaved?.(this.#record);
    return this.#record;
  }

  /** After onRemoteDelete: bring the project back (or save a new one if it was removed) and write pending edits. */
  restore(): ProjectRecord {
    if (!this.#record || this.#blocked === 'missing') return this.saveAsNew();
    this.#record = restoreProject(this.#storage, this.#record.id);
    this.#blocked = undefined;
    if (this.#pending) this.flush();
    return this.#record;
  }

  saveAsNew(): ProjectRecord {
    this.#clearTimer();
    const record = createProject(this.#storage, { config: this.#config, name: this.name });
    this.#record = record; this.#blocked = undefined; this.#pending = false; this.#touch = false;
    rememberOpenProject(this.#storage, this.#session, record.id);
    this.#events.onSaved?.(record);
    return record;
  }

  /** Re-read from storage. Call from the 'storage' event, visibilitychange→visible and pageshow. */
  sync(): void {
    if (!this.#record) return;
    let current: ProjectRecord | undefined;
    try { current = getProject(this.#storage, this.#record.id); } catch (error) { this.#events.onError?.(error as Error); return; }
    if (!current) {
      if (this.#blocked !== 'missing') { this.#blocked = 'missing'; this.#events.onRemoteDelete?.(undefined); }
      return;
    }
    if (current.deletedAt) {
      if (this.#blocked !== 'deleted') { this.#blocked = 'deleted'; this.#record = current; this.#events.onRemoteDelete?.(current); }
      return;
    }
    const wasBlocked = this.#blocked !== undefined;
    this.#blocked = undefined;
    // First committed write wins: another window saved a newer config, so show it.
    if (current.rev !== this.#record.rev) { this.#adopt(current, this.#pending); return; }
    const renamed = current.name !== this.#record.name;
    this.#record = current;
    if (renamed || wasBlocked) this.#events.onRemoteChange?.(current, { configChanged: false, discardedLocalEdit: false });
    if (wasBlocked && this.#pending) this.flush();
  }

  handleStorageEvent(event: Pick<StorageEvent, 'key'>): void {
    if (this.#record && (event.key === null || event.key === projectKey(this.#record.id))) this.sync();
  }

  /** Flush and stop timers. Returns false if an edit could not be saved. */
  dispose(): boolean { const saved = this.flush(); this.#clearTimer(); return saved; }

  #adopt(record: ProjectRecord, discardedLocalEdit: boolean): void {
    this.#clearTimer();
    const configChanged = !sameConfig(record.config, this.#config);
    this.#record = record; this.#config = record.config; this.#pending = false; this.#touch = false; this.#blocked = undefined;
    this.#events.onRemoteChange?.(record, { configChanged, discardedLocalEdit });
  }
  #clearTimer(): void { clearTimeout(this.#timer); this.#timer = undefined; this.#firstPendingAt = undefined; }
}
