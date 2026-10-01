import { describe, expect, it } from 'vitest';
import { createSlot, defaultConfig, KEY_TYPES, moveSlot, parseConfig, serializeConfig, validateConfig } from '../src/config';
import { createMemoryStorage, createProject, getProject, LEGACY_KEYS, listProjects, migrateLegacyStorage, updateProjectConfig } from '../src/projects';

function sampleConfig() {
  const config = defaultConfig();
  config.slots = KEY_TYPES.map(createSlot);
  return config;
}

describe('portable configurations', () => {
  it('round trips all fields without losing repeated or reserved keys', () => {
    const c = sampleConfig();
    c.slots.push(createSlot('C'));
    c.slots[0].occupied = false;
    c.slots[1].label = 'A "quote" \\ key';
    expect(parseConfig(serializeConfig(c))).toEqual(c);
  });
  it('preserves slot identity and settings when reordering', () => {
    const c = sampleConfig();
    const moved = moveSlot(c, 0, 5);
    expect(moved.slots[5]).toEqual(c.slots[0]);
    expect(c.slots[0].type).toBe('A');
    expect(moved.options).toEqual(c.options);
  });
  it('supports an empty editor', () => { const c = sampleConfig(); c.slots = []; expect(validateConfig(c).slots).toEqual([]); });
  it.each(['none', 'snap_fit'] as const)('round trips the %s connection without obsolete mechanism fields', connection => {
    const c = sampleConfig(); c.template = 'inventory_tray'; c.options.tray.connection = connection;
    const parsed = parseConfig(serializeConfig(c));
    expect(parsed).toEqual(c);
    expect(parsed.options.tray).not.toHaveProperty('lockStyle');
  });
  it('rejects an unrecognized saved mechanism instead of changing the manufactured interface', () => {
    const c = sampleConfig();
    Object.assign(c.options.tray, { lockStyle: 'support_free' });
    expect(() => validateConfig(c)).toThrow('Tray lock mechanism');
  });
  it('migrates missing key-label size to the historical default without changing other settings', () => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.labels = false;
    old.slots[0].label = 'Caf\u00e9 \u03a9';
    delete old.labelSize;
    expect(validateConfig(old)).toEqual({ ...old, labelSize: 2.7 });
    expect(defaultConfig().labelSize).toBe(2.7);
    expect(parseConfig(serializeConfig(validateConfig(old))).labelSize).toBe(2.7);
  });
  it.each([1.5, 2.7, 3.2, 4])('round trips key-label size %s across every organizer and preserves disabled-label preferences', labelSize => {
    const c = sampleConfig(); c.labelSize = labelSize;
    for (const template of ['inventory_tray', 'desktop_dock'] as const) {
      c.template = template;
      for (const labels of [false, true]) {
        c.labels = labels;
        expect(parseConfig(serializeConfig(c))).toEqual(c);
      }
    }
    expect(moveSlot(c, 0, 3).labelSize).toBe(labelSize);
  });
  it('rejects invalid key-label size instead of defaulting or partially loading it', () => {
    for (const labelSize of [1.49, 4.01, 0, -2, NaN, Infinity, -Infinity, null, false, true, '', '2.7', [], {}]) {
      const c = sampleConfig();
      Object.assign(c, { labelSize });
      expect(() => validateConfig(c)).toThrow('Key label size');
    }
  });
  it.each([NaN, Infinity, 0, -3, 1000])('rejects unsafe socket support height %s', value => {
    const c = sampleConfig(); c.options.dock.height = value; expect(() => validateConfig(c)).toThrow();
  });
  it('rejects malformed data instead of partially loading it', () => {
    expect(() => parseConfig('{')).toThrow('valid JSON');
    expect(() => parseConfig('{"version":2}')).toThrow('version');
    const c = sampleConfig(); c.slots[1].id = c.slots[0].id;
    expect(() => validateConfig(c)).toThrow('unique');
  });
  it('rejects unsupported form factors and missing options', () => {
    const c = sampleConfig() as unknown as Record<string, unknown>;
    c.slots = [{ id: 'one', type: 'BIO', label: '', occupied: true }];
    expect(() => validateConfig(c)).toThrow('Key type');
    expect(() => validateConfig({ version: 1 })).toThrow('Options');
  });
  it('loads older version-1 files with their historical dimensions', () => {
    const old = JSON.parse(JSON.stringify(sampleConfig())) as { options: Record<string, Record<string, unknown>> };
    old.options.tray.margin = 17;
    for (const [group, fields] of [
      ['dock', ['rowSpacing', 'edgeMargin', 'depthMargin']],
      ['tray', ['height']],
    ] as const) for (const field of fields) delete old.options[group][field];
    const parsed = validateConfig(old);
    expect(parsed.version).toBe(1);
    expect(parsed.options.dock).toMatchObject({ rowSpacing: 45, edgeMargin: 18, depthMargin: 22.5 });
    expect(parsed.options.tray).toMatchObject({ height: 8.6, margin: 17 });
    expect(parseConfig(serializeConfig(parsed))).toEqual(parsed);
  });
  it('adds tray feature defaults to legacy projects while preserving saved settings', () => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.template = 'inventory_tray';
    old.options.tray.columns = 3;
    old.options.tray.margin = 12;
    old.options.tray.scoop = 'large';
    delete old.options.tray.retention;
    delete old.options.tray.connection;
    delete old.options.tray.sideText;
    const parsed = validateConfig(old);
    expect(parsed.options.tray).toMatchObject({
      columns: 3, margin: 12, scoop: 'large', retention: true, connection: 'none', sideText: '',
    });
    expect(parsed.slots).toEqual(old.slots);
    expect(parseConfig(serializeConfig(parsed))).toEqual(parsed);
    // New projects start without the untested retention tabs; projects saved before the option keep them.
    expect(defaultConfig().options.tray).toMatchObject({ retention: false, connection: 'none', sideText: '', sideTextPercent: 50 });
    // New designs start at the minimum spacing.
    expect(defaultConfig().options.tray).toMatchObject({ spacing: 24, rowGap: 2, margin: 5 });
    expect(defaultConfig().options.dock).toMatchObject({ spacing: 22, rowSpacing: 18, edgeMargin: 12, depthMargin: 18, titlePercent: 30 });
  });
  it('defaults a missing legacy row gap and drops the retired travel-case row pitch', () => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.options.tray.rowSpacing = 92;
    delete old.options.tray.rowGap;
    const parsed = validateConfig(old);
    expect(parsed.options.tray.rowGap).toBe(4);
    expect(parsed.options.tray).not.toHaveProperty('rowSpacing');
    expect(parseConfig(serializeConfig(parsed))).toEqual(parsed);
    expect(defaultConfig().options.tray).toMatchObject({ rowGap: 2 }); // new designs: minimum spacing
  });
  it.each([2, 4, 4.5, 40])('round trips explicit tray row gap %s', rowGap => {
    const c = sampleConfig();
    c.options.tray.rowGap = rowGap;
    expect(parseConfig(serializeConfig(c)).options.tray).toEqual(c.options.tray);
  });
  it('rejects malformed tray row gap instead of treating it as a default', () => {
    for (const rowGap of [null, false, true, NaN, Infinity, -Infinity, '', '4', [], {}]) {
      const c = sampleConfig();
      Object.assign(c.options.tray, { rowGap });
      expect(() => validateConfig(c)).toThrow();
    }
  });
  it.each([
    [false, false], [false, true], [true, false], [true, true],
  ])('preserves explicit tray retention=%s and stackable=%s', (retention, stackable) => {
    const c = sampleConfig();
    c.template = 'inventory_tray';
    Object.assign(c.options.tray, { retention, connection: stackable ? 'snap_fit' : 'none', sideText: 'Reserve' });
    expect(parseConfig(serializeConfig(c)).options.tray).toMatchObject({ retention, connection: stackable ? 'snap_fit' : 'none', sideText: 'Reserve' });
  });
  it.each(['retention', 'connection', 'sideText'] as const)('defaults a missing tray %s independently', field => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    Object.assign(old.options.tray, { retention: false, connection: 'snap_fit', sideText: 'Spare' });
    delete old.options.tray[field];
    const expected = { retention: false, connection: 'snap_fit', sideText: 'Spare' };
    const defaults = { retention: true, connection: 'none', sideText: '' };
    Object.assign(expected, { [field]: defaults[field] });
    expect(validateConfig(old).options.tray).toMatchObject(expected);
  });
  it.each(['retention', 'stackable'] as const)('rejects malformed tray %s instead of treating it as a default', field => {
    for (const value of [null, 0, 1, '', 'true', 'false', [], {}]) {
      const c = JSON.parse(JSON.stringify(sampleConfig()));
      c.options.tray[field] = value;
      expect(() => validateConfig(c)).toThrow();
    }
  });
  it('round trips quoted, escaped, and supported Unicode tray side text literally', () => {
    const c = sampleConfig();
    c.template = 'inventory_tray';
    const sideText = 'Caf\u00e9 "\u0391\u03a9" \\ \u041a\u043b\u044e\u0447\u0438';
    Object.assign(c.options.tray, { sideText });
    const parsed = parseConfig(serializeConfig(c));
    expect(parsed.options.tray).toMatchObject({ sideText });
    expect(parsed).toEqual(c);
  });
  it('rejects malformed or unsupported tray side text', () => {
    for (const sideText of [null, false, 42, [], {}, 'A'.repeat(33), 'Line\nBreak', 'Tab\tKey', '\u0000', '\u4fdd\u7ba1', '\ud83d\udd11']) {
      const c = JSON.parse(JSON.stringify(sampleConfig()));
      c.options.tray.sideText = sideText;
      expect(() => validateConfig(c)).toThrow();
    }
  });
  it('accepts blank and maximum-length tray side text', () => {
    for (const sideText of ['', 'A'.repeat(32)]) {
      const c = sampleConfig();
      Object.assign(c.options.tray, { sideText });
      expect(parseConfig(serializeConfig(c)).options.tray).toMatchObject({ sideText });
    }
  });
  it('defaults missing tray-lid fields without changing existing tray or dock settings', () => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.template = 'inventory_tray';
    old.options.tray.connection = 'snap_fit';
    old.options.tray.sideText = 'Existing tray';
    old.options.dock.title = 'Separate dock';
    delete old.options.tray.lid; delete old.options.tray.lidText; delete old.options.tray.lidTextSize;
    expect(validateConfig(old).options).toEqual({ ...old.options, tray: { ...old.options.tray, lid: false, lidText: '', lidTextSize: 6 } });
    expect(defaultConfig().options.tray).toMatchObject({ lid: false, lidText: '', lidTextSize: 6 });
    old.options.tray.lidText = 'Saved text';
    expect(validateConfig(old).options.tray).toMatchObject({ lid: false, lidText: 'Saved text' });
    old.options.tray.lid = true; delete old.options.tray.lidText;
    expect(validateConfig(old).options.tray).toMatchObject({ lid: true, lidText: '' });
  });
  it.each([
    [false, false, false, 'none'], [true, false, false, 'snap_fit'],
    [false, true, false, 'none'], [false, true, true, 'snap_fit'],
    [true, true, false, 'snap_fit'], [true, false, true, 'snap_fit'],
  ])('migrates old stackable=%s locking=%s lid=%s to %s', (stackable, locking, lid, connection) => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    delete old.options.tray.connection;
    Object.assign(old.options.tray, { stackable, locking, lid });
    const migrated = validateConfig(old);
    expect(migrated.options.tray.connection).toBe(connection);
    expect(migrated.options.tray).not.toHaveProperty('stackable');
    expect(migrated.options.tray).not.toHaveProperty('locking');
    expect(migrated.slots).toEqual(old.slots);
    expect(parseConfig(serializeConfig(migrated))).toEqual(migrated);
  });
  it.each(['none', 'snap_fit'] as const)('saves only the selected %s connection with lid on or off', connection => {
    for (const lid of [false, true]) {
      const c = sampleConfig(); Object.assign(c.options.tray, { connection, lid });
      expect(parseConfig(serializeConfig(c))).toEqual(c);
    }
  });
  it('toggles the enclosure snap-fit without changing saved dimensions, keys, or text', () => {
    const c = sampleConfig(); c.template = 'inventory_tray';
    Object.assign(c.options.tray, { height: 13, footprint: { width: 150, depth: 160 }, lid: true, lidText: 'Layer 2', lidTextRotation: 90 });
    c.slots.reverse(); c.slots[0].occupied = false; c.slots[1].label = 'Backup';
    for (const connection of ['snap_fit', 'none'] as const) {
      c.options.tray.connection = connection;
      expect(parseConfig(serializeConfig(c))).toEqual(c);
      expect(c.options.tray).not.toHaveProperty('lockStyle');
    }
  });
  it('rejects invalid connection choices and malformed legacy switches', () => {
    for (const connection of [null, false, true, '', 'pin_lock', [], {}]) {
      const c = sampleConfig(); Object.assign(c.options.tray, { connection });
      expect(() => validateConfig(c)).toThrow('Tray connection');
    }
    for (const locking of [null, 0, 1, '', 'true', 'false', [], {}]) {
      const c = sampleConfig(); Object.assign(c.options.tray, { locking });
      expect(() => validateConfig(c)).toThrow('Tray locking');
    }
  });
  it('uses the explicit connection instead of contradictory legacy flags', () => {
    const c = sampleConfig(); Object.assign(c.options.tray, { connection: 'none', stackable: true, locking: true, lid: true });
    expect(validateConfig(c).options.tray.connection).toBe('none');
  });
  it.each([false, true])('round trips tray lid=%s and quoted Unicode text independently of the dock title', lid => {
    const c = sampleConfig(); c.template = 'inventory_tray';
    Object.assign(c.options.tray, { lid, lidText: 'Caf\u00e9 "\u03a9" \\ \u041a\u043b\u044e\u0447\u0438', lidTextSize: 8.5 });
    c.options.dock.title = 'Dock title';
    expect(parseConfig(serializeConfig(c))).toEqual(c);
    c.template = 'desktop_dock';
    expect(parseConfig(serializeConfig(c))).toEqual(c);
  });
  it('accepts blank and maximum-length tray lid text', () => {
    for (const lidText of ['', 'A'.repeat(32)]) {
      const c = sampleConfig(); c.options.tray.lidText = lidText;
      expect(parseConfig(serializeConfig(c)).options.tray.lidText).toBe(lidText);
    }
  });
  it.each([2, 4.25, 6, 10, 40, 100])('round trips a %s mm tray-lid title independently of key labels', lidTextSize => {
    const c = sampleConfig(); c.template = 'inventory_tray'; c.labelSize = 1.5;
    Object.assign(c.options.tray, { lid: true, lidText: 'Label', lidTextSize });
    expect(parseConfig(serializeConfig(c))).toEqual(c);
  });
  it('migrates a missing lid text size without changing saved text, keys, or other options', () => {
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.template = 'inventory_tray'; old.labelSize = 4;
    Object.assign(old.options.tray, { lid: true, lidText: 'Existing lid', rowGap: 2, connection: 'snap_fit' });
    old.options.dock.title = 'Separate dock';
    delete old.options.tray.lidTextSize;
    expect(validateConfig(old)).toEqual({ ...old, options: { ...old.options, tray: { ...old.options.tray, lidTextSize: 6 } } });
  });
  it('rejects malformed tray-lid settings rather than silently defaulting them', () => {
    for (const lid of [null, 0, 1, '', 'true', 'false', [], {}]) {
      const c = sampleConfig(); Object.assign(c.options.tray, { lid });
      expect(() => validateConfig(c)).toThrow('Tray lid');
    }
    for (const lidText of [null, false, 42, [], {}, 'A'.repeat(33), 'Line\nBreak', '\u4fdd\u7ba1', '\ud83d\udd11']) {
      const c = sampleConfig(); Object.assign(c.options.tray, { lidText });
      expect(() => validateConfig(c)).toThrow('Tray lid text');
    }
    for (const lidTextSize of [null, false, true, '', '6', [], {}, NaN, Infinity, -Infinity, 1.99, 100.01]) {
      const c = sampleConfig(); Object.assign(c.options.tray, { lidTextSize });
      expect(() => validateConfig(c)).toThrow('Tray lid text size');
    }
  });
  it('preserves lid preferences in local projects even when the lid is disabled', () => {
    const storage = createMemoryStorage();
    const c = sampleConfig(); c.template = 'inventory_tray';
    Object.assign(c.options.tray, { lid: true, lidText: 'Spare "\u041a\u043b\u044e\u0447\u0438"', lidTextSize: 9.5 });
    const saved = createProject(storage, { config: c, name: 'Tray' });
    c.options.tray.lid = false;
    updateProjectConfig(storage, saved.id, c);
    const stored = getProject(storage, saved.id);
    expect(stored?.config).toEqual(c);
    expect(stored?.config.options.tray.lidText).toBe('Spare "\u041a\u043b\u044e\u0447\u0438"');
    expect(stored?.config.options.tray.lidTextSize).toBe(9.5);
    expect(listProjects(storage).projects.map(p => p.config)).toEqual([c]);
  });
  it('migrates pre-size local projects and owned drafts without changing their saved records', () => {
    const storage = createMemoryStorage();
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.template = 'inventory_tray'; old.options.tray.lid = true; old.options.tray.lidText = 'Saved lid';
    delete old.options.tray.lidTextSize;
    const project = { id: 'saved-tray', name: 'Tray', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z', config: old };
    const projectRaw = JSON.stringify({ version: 1, projects: [project] });
    const draftRaw = JSON.stringify({ version: 1, config: old, projectId: project.id });
    storage.setItem(LEGACY_KEYS.projects, projectRaw); storage.setItem(LEGACY_KEYS.draft, draftRaw);
    const expected = validateConfig(old);
    const report = migrateLegacyStorage(storage, new Date('2026-09-22T00:00:00Z'));
    expect(report.problems).toEqual([]);
    expect(report.lastProjectId).toBe(project.id);
    expect(getProject(storage, 'saved-tray')).toMatchObject({ name: 'Tray', createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z' });
    expect(getProject(storage, 'saved-tray')?.config).toEqual(expected);
    // The identical owned draft binds to the project instead of creating a second one.
    expect(listProjects(storage).projects.map(p => p.id)).toEqual(['saved-tray']);
    expect(expected.options.tray.lidTextSize).toBe(6);
    expect(storage.getItem(LEGACY_KEYS.projects)).toBe(projectRaw);
    expect(storage.getItem(LEGACY_KEYS.draft)).toBe(draftRaw);
    updateProjectConfig(storage, project.id, expected);
    expect(getProject(storage, 'saved-tray')?.config).toEqual(expected);
    expect(migrateLegacyStorage(storage).ran).toBe(false);
    expect(storage.getItem(LEGACY_KEYS.projects)).toBe(projectRaw);
    expect(storage.getItem(LEGACY_KEYS.draft)).toBe(draftRaw);
  });
  it.each(['modular_rail', 'grid_organizer', 'travel_case', 'key_fit_tester', 'interface_tests'])('opens a saved %s project as an inventory tray with its keys and settings', template => {
    const current = sampleConfig();
    current.slots[2].label = 'Backup'; current.slots[3].occupied = false;
    current.options.tray.lid = true; current.options.dock.title = 'Saved dock';
    const old = JSON.parse(JSON.stringify(current));
    old.template = template;
    Object.assign(old.options, {
      rail: { mountingHoles: false, endMargin: 12 }, grid: { mode: 'flat', extraHeight: 4 }, case: { headroom: 3, title: 'Case' },
      tester: { profile: 'AN', startOffset: -0.3, step: 0.2, samples: 5 }, interfaceTests: { kind: 'lid' },
    });
    const migrated = validateConfig(old);
    expect(migrated).toEqual(current);
    expect(parseConfig(serializeConfig(migrated))).toEqual(migrated);
  });
  it('keeps the local project list readable when it contains a retired organizer type', () => {
    const storage = createMemoryStorage();
    const old = JSON.parse(JSON.stringify(sampleConfig()));
    old.template = 'travel_case'; old.options.case = { headroom: 0, title: 'SECURITY KEYS' };
    storage.setItem(LEGACY_KEYS.projects, JSON.stringify({ version: 1, projects: [{ id: 'old-case', name: 'Case', createdAt: '2026-09-21T00:00:00Z', updatedAt: '2026-09-21T00:00:00Z', config: old }] }));
    expect(migrateLegacyStorage(storage, new Date('2026-09-22T00:00:00Z')).problems).toEqual([]);
    expect(listProjects(storage).projects[0].config.template).toBe('inventory_tray');
    const saved = createProject(storage, { config: sampleConfig(), name: 'New tray' }, new Date('2026-09-23T00:00:00Z'));
    expect(listProjects(storage).projects.map(p => p.id)).toEqual([saved.id, 'old-case']);
  });
  it('rejects unknown organizer types instead of guessing a replacement', () => {
    for (const template of ['wall_mount', '', null, 42]) {
      const c = sampleConfig() as unknown as Record<string, unknown>; c.template = template;
      expect(() => validateConfig(c)).toThrow('Template');
    }
  });
  it.each([
    ['dock', 'rowSpacing', 18, 70], ['dock', 'edgeMargin', 12, 40], ['dock', 'depthMargin', 18, 45],
    ['tray', 'rowGap', 2, 40], ['tray', 'height', 8.6, 20],
  ] as const)('validates %s.%s bounds without accepting malformed values', (group, field, min, max) => {
    const c = sampleConfig();
    const options = c.options as unknown as Record<string, Record<string, unknown>>;
    for (const value of [min, max]) {
      options[group][field] = value;
      expect(() => validateConfig(c)).not.toThrow();
    }
    for (const value of [min - 0.1, max + 0.1, NaN, Infinity, null, '20']) {
      options[group][field] = value;
      expect(() => validateConfig(c)).toThrow();
    }
  });
});
