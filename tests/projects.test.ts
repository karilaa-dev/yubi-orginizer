import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig, parseConfig, validateConfig } from '../src/config';
import {
  DISPLAY_KEY, LAST_PROJECT_KEY, LEGACY_KEYS, MIGRATION_KEY, TAB_PROJECT_KEY, ProjectSession, ProjectStoreError,
  createMemoryStorage, createProject, deleteProject, deleteProjectForever, duplicateProject, getProject, importProject,
  legacyProblemKeys, listProjects, matchingLayerName, createMatchingLayer, migrateLegacyStorage, projectKey, purgeDeletedProjects, readDisplayPrefs,
  reinsertProject, removeProject, renameProject, resolveStartupProject, restoreProject, updateProjectConfig, writeDisplayPrefs,
  type MemoryStorage, type ProjectStorage,
} from '../src/projects';
import type { HolderConfig } from '../src/types';

const T0 = Date.parse('2026-09-29T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000);
const tray = (): HolderConfig => defaultConfig();
const dock = (): HolderConfig => ({ ...defaultConfig(), template: 'desktop_dock' });
const quota = () => new DOMException('The quota has been exceeded.', 'QuotaExceededError');

/** Memory storage that records writes and can fail setItem on demand. */
function instrumented(base: MemoryStorage = createMemoryStorage()) {
  let fail: ((key: string) => Error | undefined) | undefined;
  const writes: string[] = [];
  const storage: ProjectStorage = {
    get length() { return base.length; },
    key: i => base.key(i), getItem: k => base.getItem(k), removeItem: k => base.removeItem(k),
    setItem: (k, v) => { const error = fail?.(k); if (error) throw error; writes.push(k); base.setItem(k, v); },
  };
  return { storage, base, writes, failWith: (f?: (key: string) => Error | undefined) => { fail = f; } };
}
/** Memory storage with a size budget in UTF-16 code units of keys + values, as browsers count it. */
function limited(budget = Infinity) {
  const base = createMemoryStorage();
  const size = (k: string) => { const v = base.getItem(k); return v === null ? 0 : k.length + v.length; };
  const used = () => { let n = 0; for (let i = 0; i < base.length; i++) n += size(base.key(i)!); return n; };
  const storage: ProjectStorage = {
    get length() { return base.length; },
    key: i => base.key(i), getItem: k => base.getItem(k), removeItem: k => base.removeItem(k),
    setItem: (k, v) => { if (used() - size(k) + k.length + v.length > budget) throw quota(); base.setItem(k, v); },
  };
  return { storage, base, used, setBudget: (n: number) => { budget = n; } };
}
function snapshot(s: MemoryStorage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < s.length; i++) { const k = s.key(i)!; out[k] = s.getItem(k)!; }
  return out;
}
const legacy = (id: string, name: string, config: unknown, updatedAt = '2026-09-20T00:00:00Z') =>
  ({ id, name, createdAt: '2026-09-01T00:00:00Z', updatedAt, config });
const legacyList = (...projects: unknown[]) => JSON.stringify({ version: 1, projects });

describe('project records', () => {
  it('names new projects after the organizer type and numbers repeats with the smallest free number', () => {
    const s = createMemoryStorage();
    const a = createProject(s, { config: tray() }, at(0));
    const b = createProject(s, { config: tray() }, at(1));
    const d = createProject(s, { config: dock() }, at(2));
    expect([a.name, b.name, d.name]).toEqual(['Inventory tray', 'Inventory tray 2', 'Desktop dock']);
    deleteProject(s, a.id, at(3));
    expect(createProject(s, { config: tray() }, at(4)).name).toBe('Inventory tray');
    expect(listProjects(s).projects.map(p => p.name)).toEqual(['Inventory tray', 'Desktop dock', 'Inventory tray 2']);
  });

  it('lets generated names follow organizer-type changes but never renames a user-named project', () => {
    const s = createMemoryStorage();
    const auto = createProject(s, { config: tray() });
    const named = createProject(s, { config: tray(), name: '  Desk   drawer ' });
    expect(named.name).toBe('Desk drawer');
    expect(updateProjectConfig(s, auto.id, dock()).name).toBe('Desktop dock');
    expect(updateProjectConfig(s, named.id, dock()).name).toBe('Desk drawer');
    const renamed = renameProject(s, auto.id, 'Office');
    expect(renamed).toMatchObject({ name: 'Office', autoName: false, rev: 2 });
    expect(updateProjectConfig(s, auto.id, tray()).name).toBe('Office');
  });

  it('skips the write for unchanged configs and keeps list order for untouched automatic edits', () => {
    const { storage, writes } = instrumented();
    const p = createProject(storage, { config: tray() }, at(0));
    createProject(storage, { config: dock() }, at(1));
    writes.length = 0;
    expect(updateProjectConfig(storage, p.id, structuredClone(p.config), { now: at(2) })).toEqual(p);
    expect(writes).toEqual([]);
    const next = structuredClone(p.config); next.options.tray.lidTextPercent = 80;
    const silent = updateProjectConfig(storage, p.id, next, { touch: false, now: at(3) });
    expect(silent).toMatchObject({ rev: 2, updatedAt: p.updatedAt });
    expect(listProjects(storage).projects[0].config.template).toBe('desktop_dock');
  });

  it('validates every write and read and leaves stored data untouched on rejection', () => {
    const s = createMemoryStorage();
    const p = createProject(s, { config: tray() });
    const before = snapshot(s);
    const bad = structuredClone(p.config); Object.assign(bad.options.tray, { connection: 'invalid' });
    expect(() => updateProjectConfig(s, p.id, bad)).toThrow('Tray connection');
    expect(() => createProject(s, { config: { ...tray(), version: 2 } })).toThrow('version');
    for (const name of ['', '   ', 'x'.repeat(81)]) expect(() => renameProject(s, p.id, name)).toThrow('1–80 characters');
    expect(snapshot(s)).toEqual(before);
    expect(renameProject(s, p.id, 'Tab\there').name).toBe('Tab here');
  });

  it('reports a corrupt entry, keeps listing the others and never overwrites or purges it', () => {
    const s = createMemoryStorage();
    const ok = createProject(s, { config: tray() });
    for (const raw of ['{bad', 'null', JSON.stringify({ version: 1, id: 'other', name: 'x' })]) {
      s.setItem(projectKey('broken'), raw);
      const list = listProjects(s);
      expect(list.projects.map(p => p.id)).toEqual([ok.id]);
      expect(list.problems).toEqual([{ key: projectKey('broken'), message: expect.stringContaining('Existing data has been kept') }]);
      for (const op of [() => updateProjectConfig(s, 'broken', tray()), () => renameProject(s, 'broken', 'A'), () => duplicateProject(s, 'broken'), () => deleteProject(s, 'broken')]) {
        expect(op).toThrow(expect.objectContaining({ code: 'corrupt' }));
      }
      purgeDeletedProjects(s, at(10 ** 9), 0);
      expect(s.getItem(projectKey('broken'))).toBe(raw);
    }
  });

  it('duplicates into an independent copy with a numbered "copy" name', () => {
    const s = createMemoryStorage();
    const src = createProject(s, { config: tray(), name: 'Desk' }, at(0));
    const a = duplicateProject(s, src.id, at(1)), b = duplicateProject(s, src.id, at(2));
    expect([a.name, b.name]).toEqual(['Desk copy', 'Desk copy 2']);
    expect(a.config).toEqual(src.config); expect(a.id).not.toBe(src.id);
    const edited = structuredClone(a.config); edited.slots.reverse();
    updateProjectConfig(s, a.id, edited);
    expect(getProject(s, src.id)?.config).toEqual(src.config);
    expect(duplicateProject(s, createProject(s, { config: tray(), name: 'y'.repeat(80) }).id).name).toHaveLength(80);
  });

  it('soft-deletes with undo, keeps timestamps and purges only expired tombstones', () => {
    const s = createMemoryStorage();
    const p = createProject(s, { config: tray() }, at(0));
    const deleted = deleteProject(s, p.id, at(5));
    expect(listProjects(s)).toMatchObject({ projects: [], deleted: [{ id: p.id, deletedAt: at(5).toISOString() }] });
    expect(() => updateProjectConfig(s, p.id, dock())).toThrow(expect.objectContaining({ code: 'deleted' }));
    expect(restoreProject(s, deleted.id)).toEqual(p);
    deleteProject(s, p.id, at(5));
    expect(purgeDeletedProjects(s, at(6))).toBe(0);
    expect(purgeDeletedProjects(s, new Date(at(5).getTime() + 30 * 864e5))).toBe(1);
    expect(s.getItem(projectKey(p.id))).toBeNull();
    const live = createProject(s, { config: tray() });
    expect(deleteProjectForever(s, live.id)).toBe(false);
    expect(getProject(s, live.id)).toBeDefined();
  });

  it('surfaces a full or unavailable storage and frees space from old tombstones only', () => {
    const { storage, base, failWith } = instrumented();
    const old = createProject(storage, { config: tray() }, at(0));
    const recent = createProject(storage, { config: tray() }, at(0));
    const open = createProject(storage, { config: tray() }, at(0));
    deleteProject(storage, old.id, at(0)); deleteProject(storage, recent.id, at(100));
    let full = true;
    failWith(() => (full ? quota() : undefined));
    // Retry succeeds after the old tombstone is purged; the one deleted 10 s ago (still undoable) stays.
    storage.removeItem = k => { base.removeItem(k); full = false; };
    expect(updateProjectConfig(storage, open.id, dock(), { now: at(110) }).config.template).toBe('desktop_dock');
    expect(getProject(base, old.id)).toBeUndefined();
    expect(getProject(base, recent.id)?.deletedAt).toBeDefined();
    full = true;
    const before = snapshot(base);
    expect(() => updateProjectConfig(storage, open.id, tray(), { now: at(111) })).toThrow(expect.objectContaining({ code: 'quota', message: expect.stringContaining('storage is full') }));
    failWith(() => new Error('SecurityError'));
    expect(() => createProject(storage, { config: tray() })).toThrow(expect.objectContaining({ code: 'unavailable', message: expect.stringContaining('could not be saved') }));
    expect(snapshot(base)).toEqual(before);
  });

  it('lets a delete free space when storage is too full for its Recently deleted entry', () => {
    const { storage, base, used, setBudget } = limited();
    const open = createProject(storage, { config: tray(), name: 'Open' }, at(0));
    const other = createProject(storage, { config: tray(), name: 'Other' }, at(0));
    setBudget(used());
    const errors: Error[] = [];
    const session = new ProjectSession(storage, open, { onError: e => errors.push(e) });
    const edited = structuredClone(open.config); edited.slots[0].label = 'Much longer label';
    session.edit(edited);
    expect(session.flush()).toBe(false);
    expect(errors[0]).toMatchObject({ code: 'quota', message: expect.stringContaining('Save a project file (.json)') });
    expect(errors[0].message).not.toMatch(/JSON backup/);
    // The tombstone is larger than the record, so the soft delete fails too, without telling the user to delete.
    const before = snapshot(base);
    let failure: unknown;
    try { deleteProject(storage, other.id, at(1)); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'quota', message: expect.stringContaining('Recently deleted'), current: other });
    expect((failure as Error).message).not.toMatch(/delete projects/i);
    expect(snapshot(base)).toEqual(before);
    // Removing it right away frees its space, so the pending edit saves on the next flush.
    expect(removeProject(storage, other.id)).toEqual(other);
    expect(getProject(storage, other.id)).toBeUndefined();
    expect(listProjects(storage).deleted).toEqual([]);
    expect(session.flush()).toBe(true);
    expect(getProject(storage, open.id)?.config.slots[0].label).toBe('Much longer label');
    session.dispose();
  });

  it('puts a removed project back for Undo in the space it freed', () => {
    const { storage, used, setBudget } = limited();
    const p = createProject(storage, { config: tray(), name: 'Desk' }, at(0));
    setBudget(used());
    const removed = removeProject(storage, p.id);
    expect(reinsertProject(storage, removed, at(5))).toEqual(p);
    expect(listProjects(storage).projects.map(r => r.id)).toEqual([p.id]);
    expect(reinsertProject(storage, removed)).toEqual(p);            // already back: no write
    expect(() => removeProject(storage, 'gone')).toThrow(expect.objectContaining({ code: 'missing' }));

    const s = createMemoryStorage();
    const q = createProject(s, { config: tray() }, at(0));
    const tombstone = removeProject(s, deleteProject(s, q.id, at(1)).id);
    expect(tombstone.deletedAt).toBeDefined();
    expect(reinsertProject(s, tombstone)).toEqual(q);                // comes back live
    s.setItem(projectKey('broken'), '{');
    expect(() => removeProject(s, 'broken')).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(s.getItem(projectKey('broken'))).toBe('{');
  });

  it('never purges the tombstone it is trying to restore while making room', () => {
    const { storage, base, failWith } = instrumented();
    const p = createProject(storage, { config: tray() }, at(0));
    deleteProject(storage, p.id, at(0));
    failWith(() => quota());
    expect(() => restoreProject(storage, p.id, at(10 ** 6))).toThrow(expect.objectContaining({ code: 'quota' }));
    expect(getProject(base, p.id)?.deletedAt).toBeDefined();
  });
});

describe('import and export', () => {
  it('prefers an embedded name over the file name and ignores non-string names', () => {
    const s = createMemoryStorage();
    const c = tray(); c.slots[0].label = 'Ключі';
    const text = JSON.stringify({ name: 'Desk: "main" tray?', ...c });
    expect(parseConfig(text)).toEqual(c);
    expect(importProject(s, text, 'other.yubi-orginizer.json')).toMatchObject({ name: 'Desk: "main" tray?', autoName: false, config: c });
    expect(importProject(s, JSON.stringify({ name: 42, ...c }), 'Travel.yubi-orginizer.json').name).toBe('Travel');
  });
  it('names imports from the file name, falling back to a default name for generic Keyform exports', () => {
    const s = createMemoryStorage(), text = JSON.stringify(tray());
    expect(importProject(s, text, 'Travel kit.json').name).toBe('Travel kit');
    expect(importProject(s, text, 'inventory_tray.keyform.json')).toMatchObject({ name: 'Inventory tray', autoName: true });
    expect(importProject(s, text, 'project.keyform.json').name).toBe('Inventory tray 2');
    const before = snapshot(s);
    expect(() => importProject(s, '{bad', 'x.json')).toThrow('not valid JSON');
    expect(() => importProject(s, JSON.stringify({ ...tray(), slots: 'x' }))).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(snapshot(s)).toEqual(before);
  });
});

describe('startup and preferences', () => {
  it('reopens this tab’s project, then the last opened one, then the most recently edited', () => {
    const local = createMemoryStorage(), session = createMemoryStorage();
    expect(resolveStartupProject(local, session)).toBeUndefined();
    const a = createProject(local, { config: tray() }, at(0));
    const b = createProject(local, { config: tray() }, at(1));
    expect(resolveStartupProject(local, session)).toMatchObject({ project: { id: b.id }, reason: 'recent' });
    local.setItem(LAST_PROJECT_KEY, a.id);
    expect(resolveStartupProject(local, session)).toMatchObject({ project: { id: a.id }, reason: 'last' });
    session.setItem(TAB_PROJECT_KEY, b.id);
    expect(resolveStartupProject(local, session)).toMatchObject({ project: { id: b.id }, reason: 'tab' });
    deleteProject(local, b.id);
    local.setItem(projectKey(a.id), '{bad');
    expect(resolveStartupProject(local, session)).toBeUndefined();
  });
  it('reads new display prefs, falls back to the legacy key, tolerates garbage and never writes legacy', () => {
    const s = createMemoryStorage();
    expect(readDisplayPrefs(s)).toEqual({ showKeys: true, theme: 'system', quality: 'high', openGroups: {}, seen: { orbitHint: false, dockNotice: false, offlineReady: false, autosaveIntro: false } });
    s.setItem(LEGACY_KEYS.display, JSON.stringify({ showKeys: false, theme: 'dark', quality: 'low' }));
    expect(readDisplayPrefs(s)).toMatchObject({ showKeys: false, theme: 'dark', quality: 'low', openGroups: {} });
    writeDisplayPrefs(s, { ...readDisplayPrefs(s), showKeys: true, theme: 'light', quality: 'high', openGroups: { inventory_tray: ['layout', 'size'] }, seen: { orbitHint: true, dockNotice: false, offlineReady: false, autosaveIntro: false } });
    expect(readDisplayPrefs(s)).toMatchObject({ openGroups: { inventory_tray: ['layout', 'size'] }, seen: { orbitHint: true } });
    expect(readDisplayPrefs(s).theme).toBe('light');
    expect(JSON.parse(s.getItem(LEGACY_KEYS.display)!).theme).toBe('dark');
    s.setItem(DISPLAY_KEY, '[1]');
    expect(readDisplayPrefs(s).theme).toBe('dark');
  });
});

describe('legacy migration', () => {
  it('copies Keyform projects with ids, names, timestamps and config migrations, leaving legacy keys byte-identical', () => {
    const s = createMemoryStorage();
    const old = JSON.parse(JSON.stringify(tray()));
    Object.assign(old.options.tray, { connection: 'slide_lock', lockStyle: 'button', lid: true });
    const raw = legacyList(legacy('desk', 'Desk', old), legacy('d2', ' Travel ', dock(), '2026-09-25T00:00:00Z'));
    s.setItem(LEGACY_KEYS.projects, raw);
    const report = migrateLegacyStorage(s, at(0));
    expect(report).toMatchObject({ ran: true, problems: [] });
    expect(listProjects(s).projects.map(p => [p.id, p.name, p.updatedAt])).toEqual([
      ['d2', 'Travel', '2026-09-25T00:00:00.000Z'], ['desk', 'Desk', '2026-09-20T00:00:00.000Z'],
    ]);
    expect(getProject(s, 'desk')?.config).toEqual(validateConfig(old));
    expect(getProject(s, 'desk')?.config.options.tray.connection).toBe('snap_fit');
    expect(s.getItem(LEGACY_KEYS.projects)).toBe(raw);
  });

  it('is idempotent and never re-imports a migrated project the user deleted, even after purge', () => {
    const { storage, base, writes } = instrumented();
    base.setItem(LEGACY_KEYS.projects, legacyList(legacy('desk', 'Desk', tray())));
    migrateLegacyStorage(storage, at(0));
    writes.length = 0;
    expect(migrateLegacyStorage(storage, at(1)).ran).toBe(false);
    expect(writes).toEqual([]);
    deleteProject(storage, 'desk', at(2));
    purgeDeletedProjects(storage, at(10 ** 8));
    expect(getProject(storage, 'desk')).toBeUndefined();
    // Even if some other legacy key changes and forces a re-scan, the purged project stays gone.
    base.setItem(LEGACY_KEYS.display, '{}');
    base.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: { ...tray(), slots: [] } }));
    expect(migrateLegacyStorage(storage, at(3)).imported).toEqual([]);
    expect(listProjects(storage).projects).toEqual([]);
  });

  it('does not re-run or report again when the marker is unreadable', () => {
    const s = createMemoryStorage();
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('desk', 'Desk', tray())));
    s.setItem(MIGRATION_KEY, '{bad');
    const problems = migrateLegacyStorage(s).problems;
    expect(problems[0].source).toBe(MIGRATION_KEY);
    expect(problems[0].message).not.toMatch(/keyform/i);
    expect(listProjects(s).projects).toEqual([]);
    expect(s.getItem(MIGRATION_KEY)).toBe('{bad');
  });

  it('continues an owned draft that matches its project without creating a copy', () => {
    const s = createMemoryStorage(), c = tray();
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('desk', 'Desk', c)));
    s.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: c, projectId: 'desk' }));
    const report = migrateLegacyStorage(s, at(0));
    expect(report.imported.map(p => p.id)).toEqual(['desk']);
    expect(report.lastProjectId).toBe('desk');
    expect(resolveStartupProject(s)?.project.id).toBe('desk');
  });

  it('keeps an owned draft with unsaved changes as its own project and leaves the named project unchanged', () => {
    const s = createMemoryStorage(), saved = tray(), draft = tray();
    draft.slots = saved.slots.slice(0, 2);
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('desk', 'Desk', saved)));
    s.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: draft, projectId: 'desk' }));
    const report = migrateLegacyStorage(s, at(0));
    const extra = report.imported.find(p => p.id !== 'desk')!;
    expect(extra).toMatchObject({ name: 'Desk (unsaved changes)', autoName: false, config: draft, updatedAt: at(0).toISOString() });
    expect(getProject(s, 'desk')?.config).toEqual(saved);
    expect(report.lastProjectId).toBe(extra.id);
  });

  it('turns an unowned draft into a default-named project unless it is blank or already saved', () => {
    const blank = createMemoryStorage();
    blank.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: { ...dock(), slots: [] } }));
    expect(migrateLegacyStorage(blank).imported).toEqual([]);

    const dup = createMemoryStorage(), c = tray();
    dup.setItem(LEGACY_KEYS.projects, legacyList(legacy('desk', 'Desk', c)));
    dup.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: c }));
    expect(migrateLegacyStorage(dup)).toMatchObject({ lastProjectId: 'desk', imported: [{ id: 'desk' }] });

    const fresh = createMemoryStorage();
    fresh.setItem(LEGACY_KEYS.projects, legacyList(legacy('t', 'Inventory tray', dock())));
    fresh.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: tray() }));
    const report = migrateLegacyStorage(fresh);
    expect(report.imported[1]).toMatchObject({ name: 'Inventory tray 2', autoName: true });
    expect(report.lastProjectId).toBe(report.imported[1].id);
  });

  it('migrates the yubikey-organizer config: bound when active-project matches, recovered when superseded', () => {
    const c = tray(); c.slots.reverse();
    const bound = createMemoryStorage();
    bound.setItem(LEGACY_KEYS.projects, legacyList(legacy('desk', 'Desk', c)));
    bound.setItem(LEGACY_KEYS.config, JSON.stringify(c)); bound.setItem(LEGACY_KEYS.activeProject, 'desk');
    expect(migrateLegacyStorage(bound)).toMatchObject({ lastProjectId: 'desk', imported: [{ id: 'desk' }] });

    const current = createMemoryStorage();
    current.setItem(LEGACY_KEYS.config, JSON.stringify(c)); current.setItem(LEGACY_KEYS.activeProject, 'gone');
    const r1 = migrateLegacyStorage(current);
    expect(r1.imported).toMatchObject([{ name: 'Inventory tray', autoName: true }]);
    expect(r1.lastProjectId).toBe(r1.imported[0].id);

    const superseded = createMemoryStorage();
    superseded.setItem(LEGACY_KEYS.config, JSON.stringify(c));
    superseded.setItem(LEGACY_KEYS.draft, JSON.stringify({ version: 1, config: dock() }));
    const r2 = migrateLegacyStorage(superseded);
    expect(r2.imported.map(p => p.name).sort()).toEqual(['Desktop dock', 'Recovered draft']);
    expect(getProject(superseded, r2.lastProjectId!)?.name).toBe('Desktop dock');
  });

  it('salvages valid entries, reports unreadable data once and keeps it byte-identical', () => {
    const s = createMemoryStorage();
    const bad = legacyList(legacy('ok', 'Ok', tray()), legacy('bad', 'Bad', { ...tray(), template: 'wall_mount' }));
    s.setItem(LEGACY_KEYS.projects, bad);
    s.setItem(LEGACY_KEYS.draft, '{bad');
    const first = migrateLegacyStorage(s);
    expect(first.imported.map(p => p.id)).toEqual(['ok']);
    expect(first.problems.map(p => p.source)).toEqual([LEGACY_KEYS.projects, LEGACY_KEYS.draft]);
    for (const problem of first.problems) expect(problem.message).not.toMatch(/keyform/i);
    expect(migrateLegacyStorage(s)).toMatchObject({ ran: false, problems: [] });
    expect(s.getItem(LEGACY_KEYS.projects)).toBe(bad); expect(s.getItem(LEGACY_KEYS.draft)).toBe('{bad');
  });

  it('remembers unreadable legacy keys across starts until they change or disappear', () => {
    const s = createMemoryStorage();
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('ok', 'Ok', tray()), legacy('bad', 'Bad', { ...tray(), template: 'wall_mount' })));
    s.setItem(LEGACY_KEYS.draft, '{bad');
    expect(legacyProblemKeys(s)).toEqual([]);
    migrateLegacyStorage(s, at(0));
    expect(legacyProblemKeys(s).sort()).toEqual([LEGACY_KEYS.draft, LEGACY_KEYS.projects].sort());
    expect(migrateLegacyStorage(s, at(1)).ran).toBe(false);
    s.setItem(LEGACY_KEYS.config, JSON.stringify(dock())); // another source changes: the unchanged ones stay listed
    migrateLegacyStorage(s, at(2));
    expect(legacyProblemKeys(s).sort()).toEqual([LEGACY_KEYS.draft, LEGACY_KEYS.projects].sort());
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('ok', 'Ok', tray())));   // fixed by an old tab
    s.removeItem(LEGACY_KEYS.draft);
    migrateLegacyStorage(s, at(3));
    expect(legacyProblemKeys(s)).toEqual([]);
  });

  it('picks up edits an old Keyform tab makes after migration without clobbering new edits', () => {
    const s = createMemoryStorage(), p = tray(), q = dock();
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('p', 'P', p), legacy('q', 'Q', q)));
    migrateLegacyStorage(s, at(0));
    const mine = structuredClone(p); mine.slots.pop();
    updateProjectConfig(s, 'p', mine);                                // edited in yubi-orginizer
    const theirs = structuredClone(q); theirs.options.dock.title = 'OLD TAB';
    const added = tray(); added.slots = added.slots.slice(0, 1);
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('p', 'P', p), legacy('q', 'Q', theirs), legacy('r', 'R', added)));
    const report = migrateLegacyStorage(s, at(1));
    expect(report.imported.map(r => r.name).sort()).toEqual(['Q (older version)', 'R']);
    expect(getProject(s, 'p')?.config).toEqual(mine);
    expect(getProject(s, 'q')?.config).toEqual(q);
    expect(migrateLegacyStorage(s, at(2)).ran).toBe(false);
  });

  it('retries only what failed when storage fills up mid-migration, without duplicates', () => {
    const { storage, base, failWith } = instrumented();
    base.setItem(LEGACY_KEYS.projects, legacyList(legacy('a', 'A', tray()), legacy('b', 'B', dock())));
    failWith(key => (key === projectKey('b') ? quota() : undefined));
    const first = migrateLegacyStorage(storage, at(0));
    expect(first.imported.map(p => p.id)).toEqual(['a']);
    expect(first.problems[0]).toMatchObject({ source: LEGACY_KEYS.projects, message: expect.stringContaining('previous version') });
    expect(first.problems[0].message).toMatch(/full.*retried/);
    failWith();
    const second = migrateLegacyStorage(storage, at(1));
    expect(second.imported.map(p => p.id)).toEqual(['b']);
    expect(listProjects(storage).projects.map(p => p.id).sort()).toEqual(['a', 'b']);
    expect(migrateLegacyStorage(storage, at(2)).ran).toBe(false);
  });

  it('maps unusual legacy ids deterministically', () => {
    const s = createMemoryStorage();
    s.setItem(LEGACY_KEYS.projects, legacyList(legacy('weird id/1', 'W', tray())));
    const [a] = migrateLegacyStorage(s).imported;
    expect(a.id).toMatch(/^keyform-[a-z0-9]+$/);
    s.removeItem(MIGRATION_KEY); // simulate a crash before the marker was written
    expect(migrateLegacyStorage(s).imported).toEqual([]);
    expect(listProjects(s).projects).toHaveLength(1);
  });
});

describe('project session', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('debounces writes, caps the wait and flushes synchronously', () => {
    vi.useFakeTimers({ now: T0 });
    const { storage, writes } = instrumented();
    const saved = vi.fn();
    const session = new ProjectSession(storage, createProject(storage, { config: tray() }), { onSaved: saved }, { delayMs: 400, maxWaitMs: 1000 });
    writes.length = 0;
    const c = structuredClone(session.config);
    for (let i = 0; i < 8; i++) { c.options.tray.spacing = 27 + i; session.edit(structuredClone(c)); vi.advanceTimersByTime(200); }
    expect(writes.filter(k => k.startsWith('yubi-orginizer.project')).length).toBe(1); // maxWait forced one write at 1000 ms, not 8
    c.options.tray.spacing = 40; session.edit(c);
    expect(session.pending).toBe(true);
    expect(session.flush()).toBe(true);
    expect(getProject(storage, session.id!)?.config.options.tray.spacing).toBe(40);
    expect(saved).toHaveBeenCalledTimes(2);
  });

  it('creates a new project lazily on the first real edit and remembers it for reloads', () => {
    vi.useFakeTimers({ now: T0 });
    const local = createMemoryStorage(), tab = createMemoryStorage();
    const session = new ProjectSession(local, { config: { ...tray(), slots: [] } }, {}, { session: tab });
    expect(session.name).toBe('Inventory tray');
    session.edit({ ...session.config, template: 'desktop_dock' }, { touch: false });
    session.flush();
    expect(listProjects(local).projects).toEqual([]);
    session.edit({ ...session.config, slots: tray().slots });
    vi.runAllTimers();
    expect(session.persisted).toBe(true);
    expect(getProject(local, session.id!)).toMatchObject({ name: 'Desktop dock', autoName: true });
    expect(resolveStartupProject(local, tab)).toMatchObject({ project: { id: session.id }, reason: 'tab' });
  });

  it('adopts newer edits from another window and lets the first committed write win', () => {
    const s = createMemoryStorage();
    const p = createProject(s, { config: tray() });
    const remote = vi.fn();
    const a = new ProjectSession(s, p, { onRemoteChange: remote }, { delayMs: 10_000 });
    const b = new ProjectSession(s, p);
    const bEdit = structuredClone(p.config); bEdit.options.tray.margin = 9;
    b.edit(bEdit); b.flush();
    a.handleStorageEvent({ key: projectKey(p.id) });
    expect(a.config.options.tray.margin).toBe(9);
    expect(remote).toHaveBeenLastCalledWith(expect.objectContaining({ rev: 2 }), { configChanged: true, discardedLocalEdit: false });
    // Both edit before either sees the other: A's later flush conflicts and shows B's saved version.
    const aEdit = structuredClone(a.config); aEdit.options.tray.margin = 12; a.edit(aEdit);
    const bEdit2 = structuredClone(b.config); bEdit2.options.tray.margin = 15; b.edit(bEdit2); b.flush();
    expect(a.flush()).toBe(true);
    expect(a.config.options.tray.margin).toBe(15);
    expect(remote).toHaveBeenLastCalledWith(expect.objectContaining({ rev: 3 }), { configChanged: true, discardedLocalEdit: true });
    a.dispose(); b.dispose();
  });

  it('pauses writes when the project is deleted elsewhere and restores or saves as new on request', () => {
    const s = createMemoryStorage();
    const p = createProject(s, { config: tray(), name: 'Desk' });
    const deleted = vi.fn();
    const session = new ProjectSession(s, p, { onRemoteDelete: deleted }, { delayMs: 10_000 });
    deleteProject(s, p.id);
    const c = structuredClone(p.config); c.slots.pop(); session.edit(c);
    expect(session.flush()).toBe(false);
    expect(deleted).toHaveBeenCalledWith(expect.objectContaining({ id: p.id, deletedAt: expect.any(String) }));
    expect(getProject(s, p.id)?.config).toEqual(p.config);
    session.restore();
    expect(getProject(s, p.id)).toEqual(expect.objectContaining({ config: c })); expect(getProject(s, p.id)?.deletedAt).toBeUndefined();
    s.removeItem(projectKey(p.id));
    session.handleStorageEvent({ key: null });
    expect(session.blocked).toBe('missing');
    const copy = session.saveAsNew();
    expect(copy).toMatchObject({ name: 'Desk', config: c });
    expect(copy.id).not.toBe(p.id);
  });

  it('keeps an edit pending when storage is full and saves it on the next flush', () => {
    const { storage, failWith } = instrumented();
    const p = createProject(storage, { config: tray() });
    const onError = vi.fn();
    const session = new ProjectSession(storage, p, { onError });
    failWith(() => quota());
    const c = structuredClone(p.config); c.labels = false; session.edit(c);
    expect(session.flush()).toBe(false);
    expect(onError).toHaveBeenCalledWith(expect.any(ProjectStoreError));
    expect(session.pending).toBe(true);
    failWith();
    expect(session.flush()).toBe(true);
    expect(getProject(storage, p.id)?.config.labels).toBe(false);
  });
});

describe('matching layers', () => {
  it('names layers without chaining suffixes', () => {
    expect(matchingLayerName('Desk', [])).toBe('Desk – layer 2');
    expect(matchingLayerName('Desk', ['Desk – layer 2', 'Desk - layer 4', 'Other – layer 9'])).toBe('Desk – layer 5');
    expect(matchingLayerName('Desk – layer 2', ['Desk', 'Desk – layer 2'])).toBe('Desk – layer 3');
    expect(matchingLayerName('A'.repeat(80), []).length).toBe(80);
  });
  it('keeps automatic sizing, shares stacking settings, starts with defaults and always keeps the lid on top', () => {
    const s = createMemoryStorage(), c = tray();
    Object.assign(c.options.tray, { connection: 'h20_slide_v7', slideDirection: 'front', lid: true, lidText: 'TOP', height: 10 });
    const source = createProject(s, { config: c, name: 'Desk' }, at(0));
    const { source: after, layer, previousSourceConfig } = createMatchingLayer(s, source.id, { footprint: { width: 118, depth: 96 } }, at(1));
    expect(previousSourceConfig).toEqual(c);
    expect(after.config.options.tray).toMatchObject({ footprint: null, lid: false, lidText: 'TOP' });
    expect(after.config.slots).toEqual(c.slots);
    expect(layer.name).toBe('Layer 2');
    expect(listProjects(s).projects).toHaveLength(1);
    expect(after.config.layers).toHaveLength(1);
    expect(layer.config.slots).toEqual([]);
    expect(layer.config.options.tray).toMatchObject({ connection: 'h20_slide_v7', slideDirection: 'front', height: 10, footprint: null, lid: true, lidText: 'TOP', spacing: 24, rowGap: 2, retention: false });
    const again = createMatchingLayer(s, source.id, { footprint: { width: 1, depth: 1 } }, at(2));
    expect(again.layer.name).toBe('Layer 3');
    expect(again.layer.config.options.tray).toMatchObject({ footprint: null, lid: true, lidText: 'TOP' });
    expect(getProject(s, source.id)?.config.layers?.[0].config.options.tray.lid).toBe(false);
  });
  it('keeps an already fixed footprint, refuses docks and leaves no layer behind when the source write fails', () => {
    const { storage, failWith } = instrumented();
    const c = tray(); c.options.tray.footprint = { width: 150, depth: 100 };
    const source = createProject(storage, { config: c, name: 'Fixed' });
    const r = createMatchingLayer(storage, source.id, { footprint: { width: 1, depth: 1 } });
    expect(r.layer.config.options.tray.footprint).toEqual({ width: 150, depth: 100 });
    expect(r.layer.config.options.tray.lid).toBe(false);
    const d = createProject(storage, { config: dock() });
    expect(() => createMatchingLayer(storage, d.id, { footprint: { width: 1, depth: 1 } })).toThrow('only available for inventory trays');
    const lidded = tray(); lidded.options.tray.lid = true;
    const p = createProject(storage, { config: lidded, name: 'Lid' });
    const before = listProjects(storage).projects.length;
    failWith(key => (key === projectKey(p.id) ? quota() : undefined));
    expect(() => createMatchingLayer(storage, p.id, { footprint: { width: 100, depth: 90 } })).toThrow(expect.objectContaining({ code: 'quota' }));
    failWith();
    expect(listProjects(storage).projects.length).toBe(before);
    expect(getProject(storage, p.id)?.config.options.tray.lid).toBe(true);
  });
});
