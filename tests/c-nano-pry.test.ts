import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { buildProject, compactTray, inventoryTrayLayout, inventoryTraySupports, keyLabelMetrics, trayFootprintError, traySlotEnvelope } from '../src/geometry';
import { buildTrayItem } from '../src/geometry/layers';
import type { Slot } from '../src/types';

function nano(count = 1) {
  const config = defaultConfig();
  config.template = 'inventory_tray';
  config.labels = false;
  config.slots = Array.from({ length: count }, (_, i): Slot => ({ id: `nano-${i}`, type: 'CN', label: 'C Nano', occupied: true }));
  return config;
}

describe('selected C Nano 7B pocket in production trays', () => {
  it('reserves the actual fixed nose and rear relief across scoop settings and rotations', () => {
    const config = nano();
    for (const scoop of ['small', 'default', 'large'] as const) for (const retention of [false, true]) {
      Object.assign(config.options.tray, { scoop, retention });
      config.slots[0].rotation = 0;
      expect(traySlotEnvelope(config, config.slots[0])).toEqual({ minX: -7, maxX: 7, minY: -7.65, maxY: 14.4 });
      config.slots[0].rotation = 90;
      expect(traySlotEnvelope(config, config.slots[0])).toEqual({ minX: -14.4, maxX: 7.65, minY: -7, maxY: 7 });
    }
  });

  it('keeps labels 0.8 mm beyond the pry opening at every supported text size', () => {
    const config = nano(); config.labels = true;
    for (const size of [1.5, 2.7, 4]) {
      config.labelSize = size;
      const e = traySlotEnvelope(config, config.slots[0]), m = keyLabelMetrics(config);
      const nearestLabelEdge = -e.minY - 2 * m.halfHeight;
      expect(nearestLabelEdge - 7.65).toBeCloseTo(0.8);
    }
  });

  it('keeps neighboring rotated openings separated in both grid and compact layouts', () => {
    const config = nano(8);
    config.slots.forEach((slot, i) => { slot.rotation = i % 2 ? 90 : 0; });
    Object.assign(config.options.tray, { columns: 4, spacing: 24, rowGap: 2 });
    for (const c of [config, compactTray(config)]) {
      const layout = inventoryTrayLayout(c);
      const boxes = c.slots.map((slot, i) => {
        const e = traySlotEnvelope(c, slot), [x, y] = layout.xy[i];
        return { x1: x + e.minX, x2: x + e.maxX, y1: y + e.minY, y2: y + e.maxY };
      });
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(Math.max(b.x1 - a.x2, a.x1 - b.x2, b.y1 - a.y2, a.y1 - b.y2)).toBeGreaterThanOrEqual(1.99999);
      }
    }
  });

  it('rejects an old locked footprint that no longer contains the finger opening', () => {
    const config = nano();
    config.options.tray.footprint = { width: 29, depth: 26 };
    expect(trayFootprintError(config)).toContain('need at least');
    expect(() => buildProject(config)).toThrow('Increase the locked tray dimensions');
  });

  it('does not invent C Nano tab height or move the seated key when retention is toggled', () => {
    const config = nano(); const plain = buildProject(config);
    config.options.tray.retention = true;
    const retained = buildProject(config);
    expect(retained.keys).toEqual(plain.keys);
    expect(retained.dimensions).toEqual(plain.dimensions);
    expect(buildTrayItem(config, 0).dimensions[2]).toBeCloseTo(8.6);
  });

  it('places support posts outside rotated finger openings and rear relief', () => {
    const config = nano(24);
    config.slots.forEach((slot, i) => { slot.rotation = i % 2 ? 90 : 0; });
    Object.assign(config.options.tray, { columns: 4, rowGap: 20, lid: true });
    const layout = inventoryTrayLayout(config), supports = inventoryTraySupports(config, layout);
    expect(supports.length).toBeGreaterThan(0);
    for (const [px, py] of supports) config.slots.forEach((slot, i) => {
      const [x, y] = layout.xy[i];
      const dx = px - x, dy = py - y;
      const [lx, ly] = slot.rotation === 90 ? [dy, -dx] : [dx, dy];
      expect(Math.hypot(lx, ly - 7.4)).toBeGreaterThanOrEqual(9.099);
      const rearDistance = Math.hypot(Math.max(0, Math.abs(lx) - 7), Math.max(0, -7.65 - ly, ly + 5.4));
      expect(rearDistance).toBeGreaterThanOrEqual(2.099);
    });
  });
});
