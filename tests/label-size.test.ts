import { describe, expect, it } from 'vitest';
import { defaultConfig, KEY_TYPES } from '../src/config';
import { buildProject, inventoryTrayLayout, inventoryTraySupports, keyDimensions, keyLabelMetrics } from '../src/geometry';
import type { HolderConfig } from '../src/types';

function example(): HolderConfig {
  const config = defaultConfig();
  config.slots = KEY_TYPES.map((type, i) => ({ id: `size-${i}`, type, label: i ? 'WÉЖ wide label' : 'Spare', occupied: true }));
  return config;
}
function args(source: string): unknown[] {
  // Positional arguments only: trailing named ones (title_percent=30) are not JSON.
  return JSON.parse(`[${/^\w+\((.*)\);$/.exec(source.trim().split('\n').at(-1)!)![1].replace(/(,\w+=[\d.]+)+$/, '')}]`);
}

describe('adjustable printed key labels', () => {
  it.each([1.5, 2.7, 4])('reserves a consistent pocket clearance at size %s', (size) => {
    const config = example(); config.labelSize = size;
    const metrics = keyLabelMetrics(config);
    expect(metrics.scale).toBeCloseTo(size / 2.7);
    expect(metrics.edgeOffset - metrics.halfHeight).toBeCloseTo(0.8);
  });

  it.each(['desktop_dock', 'inventory_tray'] as const)('%s passes the ratio while preserving the default when omitted', (template) => {
    const config = example(); config.template = template;
    config.labelSize = 2.7;
    const explicit = buildProject(config);
    delete (config as Partial<HolderConfig>).labelSize;
    expect(buildProject(config)).toEqual(explicit);
    config.labelSize = 4;
    const project = buildProject(config);
    for (const part of project.parts) {
      const index = template === 'desktop_dock' ? 7 : part.id === 'tray' ? 12 : undefined;
      if (index !== undefined) expect(args(part.scad)[index]).toBeCloseTo(4 / 2.7);
    }
  });

  it.each([1.5, 2.7, 4])('keeps compact row gaps and pillar clearance correct at size %s', (size) => {
    const config = example(); config.template = 'inventory_tray'; config.labelSize = size;
    Object.assign(config.options.tray, { columns: 4, spacing: 24, rowGap: 2, margin: 5, connection: 'none', lid: true, retention: true });
    const t = inventoryTrayLayout(config), metrics = keyLabelMetrics(config);
    expect(t.rows[1].minY - t.rows[0].maxY).toBeCloseTo(2);
    const expectedFront = 45.6 / 2 + metrics.edgeOffset + metrics.halfHeight;
    expect(t.rows[0].front).toBeCloseTo(expectedFront);
    for (const [px, py] of inventoryTraySupports(config, t)) {
      config.slots.forEach((slot, i) => {
        const [x, y] = t.xy[i];
        const labelY = y - keyDimensions[slot.type].pocketLength / 2 - metrics.edgeOffset;
        const distance = Math.hypot(Math.max(0, Math.abs(px - x) - t.labelWidth / 2), Math.max(0, Math.abs(py - labelY) - metrics.halfHeight));
        expect(distance).toBeGreaterThanOrEqual(2.099);
      });
    }
  });

  it('does not enlarge row envelopes for disabled or blank labels', () => {
    for (const blank of [false, true]) {
      const config = example(); config.template = 'inventory_tray'; config.labels = blank;
      if (blank) config.slots.forEach((slot) => { slot.label = ''; });
      config.labelSize = 1.5;
      const small = inventoryTrayLayout(config);
      config.labelSize = 4;
      expect(inventoryTrayLayout(config)).toEqual(small);
    }
  });

  it('keeps maximum text envelopes on fixed-pitch dock material', () => {
    const config = example(); config.labelSize = 4;
    const metrics = keyLabelMetrics(config);
    const maxUprightFront = 3.5 + metrics.edgeOffset + metrics.halfHeight;
    expect(18 - maxUprightFront - 3.5).toBeGreaterThan(0.8);
  });

});
