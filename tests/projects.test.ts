import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config';
import { ACTIVE_PROJECT_KEY, DRAFT_KEY, PROJECTS_KEY, readDraft, readProjects, saveProject, writeDraft } from '../src/projects';
import { STORAGE_KEY } from '../src/config';
import { searchKeys } from '../src/catalog';

function storage() {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
}
describe('local projects', () => {
  it('persists multiple independent projects and edits the selected project in place', () => {
    const s = storage(); const config = defaultConfig();
    const first = saveProject(s, config, ' Desk ');
    config.slots.reverse(); config.template = 'travel_case';
    const second = saveProject(s, config, 'Travel');
    expect(readProjects(s)).toHaveLength(2);
    expect(readProjects(s).find(p => p.id === first.id)?.config.template).toBe('desktop_dock');
    const updated = saveProject(s, config, 'Desk v2', first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(readProjects(s).find(p => p.id === second.id)?.name).toBe('Travel');
    expect(readProjects(s).find(p => p.id === first.id)?.config).toEqual(config);
  });
  it('does not replace a corrupt library, invalid project, or missing saved project', () => {
    const s = storage(); s.setItem(PROJECTS_KEY, '{bad');
    expect(() => saveProject(s, defaultConfig(), 'Desk')).toThrow('Existing data has been kept');
    expect(s.getItem(PROJECTS_KEY)).toBe('{bad');
    const clean = storage(); const p = saveProject(clean, defaultConfig(), 'Desk'); const before = clean.getItem(PROJECTS_KEY);
    expect(() => saveProject(clean, { ...p.config, version: 2 } as never, 'Desk', p.id)).toThrow();
    expect(() => saveProject(clean, p.config, 'Desk', 'missing')).toThrow('no longer exists');
    expect(clean.getItem(PROJECTS_KEY)).toBe(before);
  });
  it('reports denied storage rather than reporting success', () => {
    expect(() => saveProject({ getItem: () => null, setItem: () => { throw new Error(); } }, defaultConfig(), 'Desk')).toThrow('could not be saved');
  });
  it('retains the connection and enclosure snap-fit tester in named projects and owned drafts', () => {
    const s = storage(), config = defaultConfig(); config.template = 'inventory_tray';
    Object.assign(config.options.tray, { connection: 'snap_fit', lid: true, lidText: 'Tray "Ω"' });
    const project = saveProject(s, config, 'Locking tray');
    config.options.tray.connection = 'none'; config.options.tray.lid = false;
    config.options.interfaceTests.kind = 'tray_snap';
    saveProject(s, config, project.name, project.id); writeDraft(s, config, project.id);
    expect(readProjects(s)[0].config).toEqual(config);
    expect(readDraft(s)).toEqual({ version: 1, config, projectId: project.id });
    expect(readDraft(s)?.config.options.tray).toMatchObject({ connection: 'none', lid: false });
  });
  it('saves a snap-fit tray and its fit test without changing a separate plain project', () => {
    const s = storage(), plain = defaultConfig(); plain.template = 'inventory_tray';
    Object.assign(plain.options.tray, { connection: 'none', lid: true });
    const original = saveProject(s, plain, 'Plain tray');
    const snap = structuredClone(plain); snap.options.tray.connection = 'snap_fit';
    snap.options.interfaceTests.kind = 'tray_snap'; snap.slots.reverse();
    const added = saveProject(s, snap, 'Snap tray'); writeDraft(s, snap, added.id);
    expect(readProjects(s).find(p => p.id === original.id)?.config).toEqual(plain);
    expect(readProjects(s).find(p => p.id === added.id)?.config).toEqual(snap);
    expect(readDraft(s)).toEqual({ version: 1, config: snap, projectId: added.id });
  });
  it.each(['button', 'side_clips'])('migrates %s in named projects and drafts while preserving saved layout and raw records', lockStyle => {
    const s = storage(), old = JSON.parse(JSON.stringify(defaultConfig())); old.template = 'inventory_tray';
    old.slots.reverse(); old.slots[0].label = 'Archive';
    Object.assign(old.options.tray, { connection: 'slide_lock', lockStyle, footprint: { width: 100, depth: 150 }, lid: true, height: 8.6 });
    Object.assign(old.options.interfaceTests, { kind: lockStyle === 'button' ? 'tray_lock' : 'tray_clips' });
    const project = { id: 'legacy-lock', name: 'Locking tray', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z', config: old };
    const projectsRaw = JSON.stringify({ version: 1, projects: [project] });
    const draftRaw = JSON.stringify({ version: 1, config: old, projectId: project.id });
    s.setItem(PROJECTS_KEY, projectsRaw); s.setItem(DRAFT_KEY, draftRaw);
    const { lockStyle: _retiredStyle, ...tray } = old.options.tray;
    const expected = { ...old, options: { ...old.options, tray: { ...tray, connection: 'snap_fit' }, interfaceTests: { kind: 'tray_snap' } } };
    expect(readProjects(s)[0].config).toEqual(expected);
    expect(readDraft(s)).toEqual({ version: 1, config: expected, projectId: project.id });
    expect(s.getItem(PROJECTS_KEY)).toBe(projectsRaw); expect(s.getItem(DRAFT_KEY)).toBe(draftRaw);
  });
  it('migrates pre-lock stacking projects and drafts and leaves their stored records intact', () => {
    const s = storage(), old = JSON.parse(JSON.stringify(defaultConfig()));
    old.template = 'inventory_tray'; old.options.tray.lid = true; old.options.tray.stackable = true;
    delete old.options.tray.connection;
    const project = { id: 'legacy-tray', name: 'Tray', createdAt: '2026-09-22T00:00:00Z', updatedAt: '2026-09-22T00:00:00Z', config: old };
    const projectsRaw = JSON.stringify({ version: 1, projects: [project] });
    const draftRaw = JSON.stringify({ version: 1, config: old, projectId: project.id });
    s.setItem(PROJECTS_KEY, projectsRaw); s.setItem(DRAFT_KEY, draftRaw);
    const migrated = readProjects(s)[0].config;
    const { stackable, ...rest } = old.options.tray;
    expect(migrated.options.tray).toEqual({ ...rest, connection: 'snap_fit' });
    expect(readDraft(s)).toEqual({ version: 1, config: migrated, projectId: project.id });
    expect(s.getItem(PROJECTS_KEY)).toBe(projectsRaw); expect(s.getItem(DRAFT_KEY)).toBe(draftRaw);
  });
  it('rejects malformed lock settings before overwriting a saved project or its draft', () => {
    const s = storage(), config = defaultConfig();
    const project = saveProject(s, config, 'Tray'); writeDraft(s, config, project.id);
    const projectsRaw = s.getItem(PROJECTS_KEY), draftRaw = s.getItem(DRAFT_KEY);
    Object.assign(config.options.tray, { connection: 'invalid' });
    expect(() => saveProject(s, config, project.name, project.id)).toThrow('Tray connection');
    expect(() => writeDraft(s, config, project.id)).toThrow('Tray connection');
    expect(s.getItem(PROJECTS_KEY)).toBe(projectsRaw); expect(s.getItem(DRAFT_KEY)).toBe(draftRaw);
  });
});

describe('atomic draft ownership', () => {
  it('stores configuration and its named-project owner in one record', () => {
    const s = storage();
    const config = defaultConfig();
    config.slots[0].occupied = false;
    const written = writeDraft(s, config, 'project-desk');
    expect(JSON.parse(s.getItem(DRAFT_KEY)!)).toEqual({ version: 1, config, projectId: 'project-desk' });
    expect(readDraft(s)).toEqual(written);
    expect(s.getItem(ACTIVE_PROJECT_KEY)).toBeNull();
    config.slots.reverse();
    expect(readDraft(s)?.config).toEqual(written.config);
  });

  it('supports an unnamed draft without inheriting a previous owner', () => {
    const s = storage();
    writeDraft(s, defaultConfig(), 'old-owner');
    const blank = { ...defaultConfig(), slots: [] };
    writeDraft(s, blank);
    expect(readDraft(s)).toEqual({ version: 1, config: blank });
    expect(JSON.parse(s.getItem(DRAFT_KEY)!)).not.toHaveProperty('projectId');
  });

  it('returns undefined without a new record and never guesses ownership from legacy keys', () => {
    const s = storage();
    s.setItem(STORAGE_KEY, JSON.stringify(defaultConfig()));
    s.setItem(ACTIVE_PROJECT_KEY, 'unrelated-project');
    expect(readDraft(s)).toBeUndefined();
    writeDraft(s, defaultConfig(), 'actual-owner');
    expect(readDraft(s)?.projectId).toBe('actual-owner');
  });

  it('keeps the old config/owner together when switching projects hits a storage failure', () => {
    const s = storage();
    const desk = defaultConfig();
    const travel = { ...defaultConfig(), template: 'travel_case' as const };
    writeDraft(s, desk, 'desk');
    const previous = s.getItem(DRAFT_KEY);
    let calls = 0;
    const denied = { getItem: s.getItem, setItem: (_key: string, _value: string) => { calls++; throw new Error('Quota exceeded'); } };
    expect(() => writeDraft(denied, travel, 'travel')).toThrow('This draft could not be saved');
    expect(calls).toBe(1);
    expect(s.getItem(DRAFT_KEY)).toBe(previous);
    // A stale separate pointer from an older app must not reassign this draft.
    s.setItem(ACTIVE_PROJECT_KEY, 'travel');
    expect(readDraft(s)).toEqual({ version: 1, config: desk, projectId: 'desk' });
    writeDraft(s, travel, 'travel');
    expect(readDraft(s)).toEqual({ version: 1, config: travel, projectId: 'travel' });
  });

  it('rejects invalid configuration or ownership before changing the existing record', () => {
    const s = storage();
    writeDraft(s, defaultConfig(), 'desk');
    const previous = s.getItem(DRAFT_KEY);
    expect(() => writeDraft(s, { ...defaultConfig(), version: 2 } as never, 'desk')).toThrow();
    for (const owner of ['', '   ', null, 42, {}]) {
      expect(() => writeDraft(s, defaultConfig(), owner as never)).toThrow('project ID');
      expect(s.getItem(DRAFT_KEY)).toBe(previous);
    }
  });

  it('reports malformed or unsupported saved drafts without deleting them', () => {
    const s = storage();
    for (const raw of ['', '{bad', 'null', JSON.stringify({ version: 2, config: defaultConfig() }), JSON.stringify({ version: 1, config: defaultConfig(), projectId: '' })]) {
      s.setItem(DRAFT_KEY, raw);
      expect(() => readDraft(s)).toThrow('Existing data has been kept');
      expect(s.getItem(DRAFT_KEY)).toBe(raw);
    }
  });
});
describe('key search', () => {
  it('finds shared form-factor names, FIPS variants and connectors', () => {
    expect(searchKeys('Security Key C NFC')).toEqual(['C']);
    expect(searchKeys('5Ci FIPS')).toEqual(['CI']);
    expect(searchKeys('USB C Nano')).toEqual(['CN']);
    expect(searchKeys('unavailable key')).toEqual([]);
    expect(searchKeys('')).toHaveLength(6);
  });
});
