import { describe, expect, it } from 'vitest';
import { defaultConfig, validateConfig } from '../src/config';
import { buildProject, frontTextFit, frontTextMaxSize } from '../src/geometry';
import type { HolderConfig } from '../src/types';

const lastLine = (scad: string): string => scad.trim().split('\n').at(-1)!;
/** A project saved before front text had a size setting. */
function legacy(c: HolderConfig): HolderConfig {
  delete c.options.tray.sideTextPercent;
  delete c.options.dock.titlePercent;
  return c;
}

describe('front text size (percent of what fits the front wall)', () => {
  it('keeps the SCAD of projects saved without a size', () => {
    const c = legacy(defaultConfig());
    c.options.tray.sideText = 'KEYS';
    expect(lastLine(buildProject(c).parts[0].scad)).not.toContain('side_text_percent');
    const dock = legacy({ ...defaultConfig(), template: 'desktop_dock' as const });
    expect(lastLine(buildProject(dock).parts[0].scad)).not.toContain('title_percent');
  });

  it('passes the percentage to every tray connection and to docks', () => {
    for (const connection of ['none', 'stackable', 'h20_slide_v7', 'snap_fit'] as const) {
      const c = defaultConfig();
      Object.assign(c.options.tray, { connection, sideText: 'KEYS', sideTextPercent: 75 });
      if (connection === 'snap_fit') Object.assign(c.options.tray, { height: 14.6, margin: 10 });
      expect(lastLine(buildProject(c).parts[0].scad), connection).toMatch(/,side_text_percent=75\);$/);
    }
    const dock = { ...defaultConfig(), template: 'desktop_dock' as const };
    expect(lastLine(buildProject(dock).parts[0].scad)).toMatch(/,title_percent=30\);$/);
  });

  it('sizes text from the wall height and width, like front_title_cut', () => {
    expect(frontTextMaxSize('KEYS', 200, 8.6)).toBeCloseTo(6.2);
    expect(frontTextMaxSize('A'.repeat(20), 56, 20)).toBeCloseTo((56 - 10) / (20 * 1.15));
    const c = defaultConfig();
    c.options.tray.sideText = 'KEYS';
    // The default 50 % on a standard 8.6 mm tray matches the original 3.1 mm text.
    expect(frontTextFit(c)).toMatchObject({ text: 'KEYS', percent: 50 });
    expect(frontTextFit(c).size).toBeCloseTo(3.1);
    c.options.tray.sideTextPercent = 100;
    expect(frontTextFit(c).size).toBeCloseTo(6.2);
  });

  it('shows the matching percentage for projects saved without one', () => {
    const c = legacy(defaultConfig());
    c.options.tray.sideText = 'KEYS';
    expect(frontTextFit(c)).toMatchObject({ percent: 50 });
    expect(frontTextFit(c).size).toBeCloseTo(3.1);
    c.options.tray.height = 12.6; // more room: the same 3.1 mm is a smaller share
    expect(frontTextFit(c).percent).toBeCloseTo(30.4, 1);
  });

  it('validates the percentage and leaves it unset for older projects', () => {
    const parsed = validateConfig(JSON.parse(JSON.stringify(legacy(defaultConfig()))));
    expect(parsed.options.tray.sideTextPercent).toBeUndefined();
    expect(parsed.options.dock.titlePercent).toBeUndefined();
    expect(defaultConfig().options.tray.sideTextPercent).toBe(50);
    expect(defaultConfig().options.dock.titlePercent).toBe(30);
    const small = defaultConfig(); small.options.tray.sideTextPercent = 10;
    expect(() => validateConfig(small)).toThrow('Side text percentage must be between 20 and 100.');
  });
});
