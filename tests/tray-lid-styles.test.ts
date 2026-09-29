import { describe, expect, it } from 'vitest';
import { defaultConfig, parseConfig, serializeConfig } from '../src/config';
import { buildProject, inventoryTrayLayout, trayStackGap } from '../src/geometry';
import { readDraft, readProjects, saveProject, writeDraft } from '../src/projects';
import { TRAY_SLIDE_DIRECTIONS } from '../src/tray-slide';

describe('closed lids at the stacking plane', () => {
  it('defaults saved projects to Regular and validates both lid choices', () => {
    const c = JSON.parse(serializeConfig(defaultConfig()));
    delete c.options.tray.lidStyle;
    expect(parseConfig(JSON.stringify(c)).options.tray.lidStyle).toBe('regular');
    for (const bad of ['open', '', false, null]) {
      c.options.tray.lidStyle = bad;
      expect(() => parseConfig(JSON.stringify(c))).toThrow('Tray lid style');
    }
  });
  it.each(['none', 'stackable', 'h20_slide_v7'] as const)('preserves storage and saved lid choices for %s', connection => {
    const c = defaultConfig(); c.template = 'inventory_tray';
    Object.assign(c.options.tray, { connection, columns: 3, lid: true });
    const initial = buildProject(c);
    for (const style of ['regular', 'minimal'] as const) for (const retention of [true, false]) {
      c.options.tray.lidStyle = style; c.options.tray.retention = retention;
      const p = buildProject(c), lid = p.parts[1], t = inventoryTrayLayout(c);
      expect(p.keys).toEqual(initial.keys);
      // Upright printed lids have their key-facing plane at local Z=0.
      if (connection === 'h20_slide_v7' || style === 'minimal') {
        expect(lid.rotation).toEqual([0, 0, 0]);
        expect(lid.position[2]).toBeCloseTo(t.height + trayStackGap(retention));
        expect(lid.position[2] + lid.explode[2]).toBe(0);
      } else expect(lid.position[2] - 2.4).toBeCloseTo(t.height + trayStackGap(retention));
      expect(parseConfig(serializeConfig(c))).toEqual(c);
      const data = new Map<string, string>();
      const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
      writeDraft(store, c); saveProject(store, c, style);
      expect(readDraft(store)?.config).toEqual(c); expect(readProjects(store)[0].config).toEqual(c);
      c.options.tray.footprint = { width: t.width, depth: t.depth };
      const slots = c.slots; c.slots = c.slots.slice(0, 1);
      expect(buildProject(c).parts[1]).toEqual(lid);
      c.slots = slots; c.options.tray.footprint = null;
    }
  });
  it.each(TRAY_SLIDE_DIRECTIONS)('keeps both $id lids interchangeable across matching tray contents', direction => {
    const c = defaultConfig(); c.template = 'inventory_tray';
    Object.assign(c.options.tray, { connection: 'h20_slide_v7', slideDirection: direction.id, lid: true, footprint: { width: 220, depth: 220 } });
    for (const lidStyle of ['regular', 'minimal'] as const) {
      c.options.tray.lidStyle = lidStyle;
      const before = buildProject(c);
      const subset = structuredClone(c); subset.slots = subset.slots.slice(0, 1);
      expect(buildProject(subset).parts[1]).toEqual(before.parts[1]);
    }
  });
});
