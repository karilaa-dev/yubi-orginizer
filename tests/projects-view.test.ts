import { strToU8, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import { createSlot, defaultConfig } from '../src/config';
import { projectFileText, projectsArchive } from '../src/export';
import {
  createMatchingLayer, createMemoryStorage, createProject, getProject, listProjects, projectKey, updateProjectConfig,
  type ProjectRecord, type ProjectStorage,
} from '../src/projects';
import type { HolderConfig } from '../src/types';
import { esc, relativeTime, shortcutLetter } from '../src/ui/dom';
import { matchingLayerAvailability, undoMatchingLayer, type ProjectActionsDeps } from '../src/ui/project-actions';
import { importProjectFiles, importSummary, isFirstRun, projectCardInfo, projectThumbnail } from '../src/ui/projects-view';
import { toastShortcutAllowed } from '../src/ui/toast';

const count = (text: string, needle: string): number => text.split(needle).length - 1;
function record(config: HolderConfig, name = 'Desk'): ProjectRecord {
  return { version: 1, id: 'p1', name, autoName: false, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z', rev: 1, config };
}
function dock(keys: number): HolderConfig {
  const c = defaultConfig(); c.template = 'desktop_dock';
  c.slots = Array.from({ length: keys }, (_, i) => createSlot(i % 2 ? 'A' : 'C'));
  return c;
}

describe('project thumbnails', () => {
  it('draws one pocket per tray slot inside a footprint viewBox with ±2 mm padding', () => {
    const c = defaultConfig();
    const svg = projectThumbnail(c);
    expect(count(svg, 'class="thumb-slot')).toBe(c.slots.length);
    expect(count(svg, 'thumb-footprint')).toBe(1);
    expect(svg).toContain('viewBox="-84 -35.4 168 70.8"'); // 164 × 66.8 mm
    expect(svg).not.toContain('is-hidden');
  });
  it('dashes slots that are hidden in the preview', () => {
    const c = defaultConfig(); c.slots[1].occupied = false; c.slots[4].occupied = false;
    const svg = projectThumbnail(c);
    expect(count(svg, 'class="thumb-slot')).toBe(6);
    expect(count(svg, 'thumb-slot is-hidden')).toBe(2);
  });
  it('shows a dashed footprint and the tray icon for a tray without keys', () => {
    const c = defaultConfig(); c.slots = [];
    const svg = projectThumbnail(c);
    expect(svg).toContain('thumb-footprint is-empty');
    expect(svg).not.toContain('thumb-slot');
    c.options.tray.footprint = { width: 120, depth: 90 };
    expect(projectThumbnail(c)).toContain('viewBox="-62 -47 124 94"');
  });
  it('caps dock glyphs at 10 and adds "+N"', () => {
    const many = projectThumbnail(dock(13));
    expect(count(many, 'key-illustration')).toBe(10);
    expect(many).toContain('+3');
    const ten = projectThumbnail(dock(10));
    expect(count(ten, 'key-illustration')).toBe(10);
    expect(ten).not.toContain('thumb-more');
    expect(projectThumbnail(dock(0))).toContain('is-empty');
  });
});

describe('project card info', () => {
  it('describes a fit-to-keys tray with its size and no chips', () => {
    expect(projectCardInfo(record(defaultConfig()))).toEqual({ meta: 'Inventory tray · 6 keys · 164 × 66.8 mm', chips: [] });
  });
  it('lists connection, lid and fixed-size chips', () => {
    const c = defaultConfig();
    Object.assign(c.options.tray, { connection: 'h20_slide_v7', slideDirection: 'front', lid: true, footprint: { width: 180, depth: 100 } });
    expect(projectCardInfo(record(c))).toEqual({ meta: 'Inventory tray · 6 keys · 180 × 100 mm', chips: ['Slide-lock ↓', 'Lid', 'Fixed size'] });
    c.options.tray.slideDirection = 'left';
    expect(projectCardInfo(record(c)).chips[0]).toBe('Slide-lock ←');
    c.options.tray.connection = 'stackable';
    expect(projectCardInfo(record(c)).chips).toEqual(['Stackable', 'Lid', 'Fixed size']);
    c.options.tray.connection = 'snap_fit';
    expect(projectCardInfo(record(c)).chips[0]).toBe('Snap-fit');
  });
  it('shows the size of an empty tray only when it is fixed', () => {
    const c = defaultConfig(); c.slots = [];
    expect(projectCardInfo(record(c)).meta).toBe('Inventory tray · 0 keys');
    c.options.tray.footprint = { width: 120, depth: 90 };
    expect(projectCardInfo(record(c)).meta).toBe('Inventory tray · 0 keys · 120 × 90 mm');
    c.slots = [createSlot('C')];
    expect(projectCardInfo(record(c)).meta).toBe('Inventory tray · 1 key · 120 × 90 mm');
  });
  it('describes docks by type and key count, ignoring tray options', () => {
    const c = dock(4); c.options.tray.lid = true; c.options.tray.connection = 'stackable';
    expect(projectCardInfo(record(c))).toEqual({ meta: 'Desktop dock · 4 keys', chips: [] });
  });
});

describe('matching layer availability', () => {
  it('is only offered for stacked trays that have a size', () => {
    expect(matchingLayerAvailability(dock(2)).available).toBe(false);
    const c = defaultConfig();
    expect(matchingLayerAvailability(c)).toEqual({ available: false, reason: 'Choose Stackable or Slide-lock first.' });
    c.options.tray.connection = 'h20_slide_v7';
    expect(matchingLayerAvailability(c)).toEqual({ available: true });
    c.slots = [];
    expect(matchingLayerAvailability(c)).toEqual({ available: false, reason: 'Add keys first.' });
    c.options.tray.footprint = { width: 120, depth: 90 };
    expect(matchingLayerAvailability(c)).toEqual({ available: true });
    c.options.tray.connection = 'stackable';
    expect(matchingLayerAvailability(c).available).toBe(true);
  });
});

describe('Projects page helpers', () => {
  it('formats edited times relative to now, with dates after 30 days', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    const ago = (ms: number): string => relativeTime(new Date(now.getTime() - ms).toISOString(), now);
    const minute = 60_000, hour = 60 * minute, day = 24 * hour;
    expect(ago(30_000)).toBe('just now');
    expect(ago(-5 * minute)).toBe('just now');
    expect(ago(minute)).toBe('1 minute ago');
    expect(ago(59 * minute)).toBe('59 minutes ago');
    expect(ago(2 * hour + 10 * minute)).toBe('2 hours ago');
    expect(ago(25 * hour)).toBe('yesterday');
    expect(ago(3 * day)).toBe('3 days ago');
    expect(ago(30 * day)).toBe('30 days ago');
    expect(ago(31 * day)).toBe(new Date(now.getTime() - 31 * day).toLocaleDateString());
    expect(relativeTime('not a date', now)).toBe('');
  });
  it('summarises import results', () => {
    expect(importSummary([{ name: 'Desk' }], [])).toBe('Imported “Desk”.');
    expect(importSummary([{ name: 'A' }, { name: 'B' }, { name: 'C' }], [])).toBe('Imported 3 projects.');
    expect(importSummary([], [{ file: 'bad.json', message: 'This file is not valid JSON.' }])).toBe('Couldn\'t import “bad.json”: This file is not valid JSON.');
    expect(importSummary([{ name: 'A' }, { name: 'B' }], [{ file: 'bad.json', message: 'x' }])).toBe('Imported 2 projects. Couldn\'t import “bad.json”.');
    expect(importSummary([], [{ file: 'a.json', message: 'x' }, { file: 'b.json', message: 'y' }])).toBe('Couldn\'t import “a.json” and “b.json”.');
  });
  it('shows the first-run screen only when nothing is stored', () => {
    expect(isFirstRun({ projects: [], deleted: [], problems: [] })).toBe(true);
    expect(isFirstRun({ projects: [], deleted: [record(defaultConfig())], problems: [] })).toBe(false);
    expect(isFirstRun({ projects: [], deleted: [], problems: [{ key: 'k', message: 'm' }] })).toBe(false);
  });
  it('escapes markup', () => {
    expect(esc('<b title="x">Tom & Jerry\'s</b>')).toBe('&lt;b title=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;');
  });
});

describe('keyboard shortcuts', () => {
  it('reads the Latin letter on Latin and non-Latin layouts', () => {
    expect(shortcutLetter({ key: 'z', code: 'KeyZ' })).toBe('z');
    expect(shortcutLetter({ key: 'Z', code: 'KeyZ' })).toBe('z');
    expect(shortcutLetter({ key: 'я', code: 'KeyZ' })).toBe('z'); // Russian
    expect(shortcutLetter({ key: 'ы', code: 'KeyS' })).toBe('s');
    expect(shortcutLetter({ key: 'z', code: 'KeyW' })).toBe('z'); // AZERTY: the key labelled Z
    expect(shortcutLetter({ key: 'w', code: 'KeyZ' })).toBe('w');
    expect(shortcutLetter({ key: 'Enter', code: 'Enter' })).toBe('enter');
  });
  it('lets Ctrl/Cmd+Z run only Undo-like toast actions', () => {
    const run = vi.fn();
    expect(toastShortcutAllowed({ label: 'Undo', run })).toBe(true);
    expect(toastShortcutAllowed({ label: 'Open', run })).toBe(false);
    expect(toastShortcutAllowed({ label: 'Update now', run })).toBe(false);
    expect(toastShortcutAllowed({ label: 'Restore', run, shortcut: true })).toBe(true);
    expect(toastShortcutAllowed({ label: 'Undo', run, shortcut: false })).toBe(false);
    expect(toastShortcutAllowed({ label: 'Undo', run, shortcut: () => false })).toBe(false);
    expect(toastShortcutAllowed({ label: 'Undo', run, shortcut: () => { throw new Error('x'); } })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('importing project files', () => {
  const tray = (name: string): { name: string; config: HolderConfig } => ({ name, config: defaultConfig() });
  const file = (parts: (string | Uint8Array)[], name: string): File => new File(parts as BlobPart[], name);

  it('imports every project in an Export all backup without opening one', async () => {
    const storage = createMemoryStorage();
    const archive = projectsArchive([tray('Desk'), tray('Travel'), tray('Spare')]);
    const result = await importProjectFiles(storage, [file([archive], 'yubi-orginizer-projects-2026-09-30.zip')]);
    expect(result.failed).toEqual([]);
    expect(result.archives).toBe(1);
    expect(result.imported.map(r => r.name).sort()).toEqual(['Desk', 'Spare', 'Travel']);
    expect(importSummary(result.imported, result.failed)).toBe('Imported 3 projects.');
    expect(listProjects(storage).projects).toHaveLength(3);
  });

  it('recognises a ZIP by its content and reports unusable archives', async () => {
    const storage = createMemoryStorage();
    const renamed = await importProjectFiles(storage, [file([projectsArchive([tray('Desk')])], 'backup.bin')]);
    expect(renamed.imported.map(r => r.name)).toEqual(['Desk']);
    const empty = await importProjectFiles(storage, [file([zipSync({ 'notes.txt': strToU8('hi') })], 'other.zip')]);
    expect(empty.failed).toEqual([{ file: 'other.zip', message: 'This ZIP has no organizer project files.' }]);
    const broken = await importProjectFiles(storage, [file(['not a zip'], 'broken.zip')]);
    expect(broken.failed).toEqual([{ file: 'broken.zip', message: 'This ZIP file could not be read.' }]);
    const mixed = await importProjectFiles(storage, [file([zipSync({
      'a/Desk.yubi-orginizer.json': strToU8(projectFileText(defaultConfig(), 'Desk 2')),
      '__MACOSX/a/._Desk.yubi-orginizer.json': strToU8('junk'),
      'bad.json': strToU8('{'),
    })], 'mixed.zip')]);
    expect(mixed.imported.map(r => r.name)).toEqual(['Desk 2']);
    expect(mixed.failed.map(f => f.file)).toEqual(['bad.json']);
  });

  it('still imports plain project files', async () => {
    const storage = createMemoryStorage();
    const result = await importProjectFiles(storage, [
      file([projectFileText(defaultConfig(), 'Desk')], 'Desk.yubi-orginizer.json'),
      file(['{'], 'bad.json'),
    ]);
    expect(result.archives).toBe(0);
    expect(result.imported.map(r => r.name)).toEqual(['Desk']);
    expect(result.failed.map(f => f.file)).toEqual(['bad.json']);
  });
});

describe('matching layer Undo', () => {
  function setup() {
    const storage = createMemoryStorage();
    const config = defaultConfig();
    config.options.tray.connection = 'stackable';
    const source = createProject(storage, { config, name: 'Desk' });
    const result = createMatchingLayer(storage, source.id, { footprint: { width: 164, depth: 66.8 }, moveLid: false });
    const open = vi.fn();
    const deps: ProjectActionsDeps = { store: { local: storage, persistent: true }, session: () => undefined, open, goHome: vi.fn(), refreshList: vi.fn() };
    return { storage, source, result, open, deps };
  }

  it('removes an untouched layer for good and reverts the source', () => {
    const { storage, source, result, open, deps } = setup();
    undoMatchingLayer(result, deps);
    expect(storage.getItem(projectKey(result.layer.id))).toBeNull();
    expect(getProject(storage, source.id)!.config).toEqual(result.previousSourceConfig);
    expect(open).toHaveBeenCalledWith(source.id);
  });

  it('keeps a layer that was changed after it was created in Recently deleted', () => {
    const { storage, source, result, open, deps } = setup();
    const edited = structuredClone(result.layer.config);
    edited.slots = [createSlot('C'), createSlot('A')];
    updateProjectConfig(storage, result.layer.id, edited);
    undoMatchingLayer(result, deps);
    const layer = getProject(storage, result.layer.id)!;
    expect(layer.deletedAt).toBeTruthy();
    expect(layer.config.slots).toHaveLength(2);
    expect(getProject(storage, source.id)!.config).toEqual(result.previousSourceConfig);
    expect(open).toHaveBeenCalledWith(source.id);
  });

  it('removes an untouched layer even when storage is too full for Recently deleted', () => {
    const base = createMemoryStorage();
    let full = false;
    const storage: ProjectStorage = {
      get length() { return base.length; },
      key: i => base.key(i), getItem: k => base.getItem(k), removeItem: k => base.removeItem(k),
      // Full: only writes that don't grow the stored value fit.
      setItem: (k, v) => {
        if (full && v.length > (base.getItem(k)?.length ?? 0)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        base.setItem(k, v);
      },
    };
    const config = defaultConfig();
    config.options.tray.connection = 'stackable';
    const source = createProject(storage, { config, name: 'Desk' });
    const result = createMatchingLayer(storage, source.id, { footprint: { width: 164, depth: 66.8 }, moveLid: false });
    full = true;
    const deps: ProjectActionsDeps = { store: { local: storage, persistent: true }, session: () => undefined, open: vi.fn(), goHome: vi.fn(), refreshList: vi.fn() };
    undoMatchingLayer(result, deps);
    expect(storage.getItem(projectKey(result.layer.id))).toBeNull();
    expect(getProject(storage, source.id)!.config).toEqual(result.previousSourceConfig);
  });

  it('skips Undo when the source changed after the layer was created', () => {
    const { storage, source, result, open, deps } = setup();
    const edited = structuredClone(result.source.config);
    edited.slots = edited.slots.slice(1);
    updateProjectConfig(storage, source.id, edited);
    undoMatchingLayer(result, deps);
    expect(getProject(storage, source.id)!.config).toEqual(edited);
    expect(getProject(storage, result.layer.id)!.deletedAt).toBeUndefined();
    expect(open).not.toHaveBeenCalled();
  });
});
