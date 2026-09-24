import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig, serializeConfig, validateConfig } from '../src/config';
import { buildProject } from '../src/geometry';

describe('retired tray connection migration', () => {
  it.each(['stackable', 'slide_lock'])('replaces %s with the enclosure snap while preserving layout and source records', connection => {
    for (const lockStyle of [undefined, 'button', 'side_clips', 'captive_button']) {
      const old = JSON.parse(JSON.stringify(defaultConfig()));
      old.template = 'inventory_tray';
      old.slots.reverse(); old.slots[0].label = 'Personal'; old.slots[1].occupied = false;
      Object.assign(old.options.tray, {
        connection, lockStyle, height: 8.6, columns: 3, footprint: { width: 120, depth: 160 }, lid: true,
        lidText: 'Layer 3', lidTextPercent: 85, lidTextRotation: 90,
      });
      const before = structuredClone(old);
      const restored = parseConfig(JSON.stringify(old));
      const { lockStyle: _retired, ...tray } = old.options.tray;
      expect(restored).toEqual({ ...old, options: { ...old.options, tray: { ...tray, connection: 'snap_fit' } } });
      expect(old).toEqual(before);
      expect(parseConfig(serializeConfig(restored))).toEqual(restored);
      const project = buildProject(restored);
      expect(project.parts.map(p => p.id)).toEqual(['tray', 'tray-lid']);
      expect(project.parts[0].scad.trim().split('\n').at(-1)).toMatch(/^inventory_tray_snap\(/);
      expect(project.parts.every(p => !/tray_captive|tray_slide|tray_clips/.test(p.scad))).toBe(true);
    }
  });
  it('removes a legacy style without enabling a disabled connection', () => {
    const c = defaultConfig();
    Object.assign(c.options.tray, { connection: 'none', lockStyle: 'side_clips' });
    const restored = validateConfig(c);
    expect(restored.options.tray.connection).toBe('none');
    expect(restored.options.tray).not.toHaveProperty('lockStyle');
  });
  it.each(['unknown', null, false, 4])('rejects malformed mechanism %s before importing a project', lockStyle => {
    const c = defaultConfig(); Object.assign(c.options.tray, { lockStyle });
    expect(() => validateConfig(c)).toThrow('Tray lock mechanism');
  });
  it.each(['tray_lock', 'tray_clips', 'tray_captive'])('replaces the %s sample with the two-piece enclosure sample', kind => {
    const c = defaultConfig(); c.template = 'interface_tests';
    Object.assign(c.options.interfaceTests, { kind });
    const restored = parseConfig(serializeConfig(c));
    expect(restored.options.interfaceTests.kind).toBe('tray_snap');
    expect(restored.slots).toEqual(c.slots);
    expect(buildProject(restored).parts.map(p => p.id)).toEqual(['fit-tray-snap-lower', 'fit-tray-snap-upper']);
  });
});
