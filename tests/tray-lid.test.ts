import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { buildProject, inventoryTrayLayout, inventoryTraySupports } from '../src/geometry';
import { TRAY_LID, TRAY_STACK } from '../src/geometry/library';

function example() {
  const config = defaultConfig();
  config.template = 'inventory_tray';
  Object.assign(config.options.tray, { columns: 4, spacing: 24, rowGap: 2 });
  return config;
}

describe('inventory tray lift-off lid', () => {
  it('keeps existing trays single-part until a lid is enabled', () => {
    const config = example();
    expect(config.options.tray.lid).toBe(false);
    expect(buildProject(config).parts.map((part) => part.id)).toEqual(['tray']);
    config.options.tray.lid = true;
    expect(buildProject(config).parts.map((part) => part.id)).toEqual(['tray', 'tray-lid']);
  });

  it('seats an unlocked lid on the bearing plane, preserving key placement', () => {
    const config = example();
    config.options.tray.connection = 'none';
    const before = buildProject(config);
    config.options.tray.lid = true;
    const after = buildProject(config);
    const lid = after.parts.find((part) => part.id === 'tray-lid')!;
    expect(after.keys).toEqual(before.keys);
    expect(after.dimensions.slice(0, 2)).toEqual(before.dimensions.slice(0, 2));
    expect(after.dimensions[2]).toBeCloseTo(12.5);
    expect(lid.position.slice(0, 2)).toEqual([0, 0]);
    expect(lid.position[2]).toBeCloseTo(12.5);
    expect(lid.rotation).toEqual([Math.PI, 0, 0]);
    expect(lid.position[2] - TRAY_LID.thickness).toBeCloseTo(config.options.tray.height + TRAY_STACK.gap);
    expect(lid.position[2] + lid.explode[2] - TRAY_LID.thickness).toBeCloseTo(0);
    expect(lid.explode[0]).toBeCloseTo(before.dimensions[0] + 8);
    expect(lid.explode[1]).toBe(0);
    expect(inventoryTraySupports(config)).toEqual([[0, 2]]);
  });

  it('engraves independent lid text and fits the current label-aware tray boundary', () => {
    const config = example();
    config.options.tray.lid = true;
    config.options.tray.lidText = 'Layer "A" \\ ΩЖ';
    config.options.tray.sideText = 'Different side name';
    for (const size of [1.5, 2.7, 4]) {
      config.labelSize = size;
      const layout = inventoryTrayLayout(config);
      const source = buildProject(config).parts[1].scad;
      expect(source.trim().split('\n').at(-1)).toBe(`inventory_tray_lid_percent(${layout.width},${layout.depth},${JSON.stringify(config.options.tray.lidText)},100,0);`);
    }
  });

  it('passes the independent lid-text size and preserves its default for older projects', () => {
    const config = example(); config.options.tray.lid = true;
    delete config.options.tray.lidTextPercent; delete config.options.tray.lidTextRotation;
    const original = buildProject(config);
    delete (config.options.tray as Partial<typeof config.options.tray>).lidTextSize;
    expect(buildProject(config)).toEqual(original);
    config.options.tray.lidTextSize = 10;
    const larger = buildProject(config);
    expect(larger.parts[0]).toEqual(original.parts[0]);
    expect(larger.keys).toEqual(original.keys);
    expect(larger.dimensions).toEqual(original.dimensions);
    expect(larger.parts[1].scad.trim().split('\n').at(-1)).toContain(',10);');
  });

  it('keeps lid options independent of the desktop dock', () => {
    const config = example(); config.template = 'desktop_dock';
    config.options.tray.lid = false;
    const before = buildProject(config);
    config.options.tray.lid = true;
    config.options.tray.lidText = 'Inventory cover';
    expect(buildProject(config)).toEqual(before);
  });
});
