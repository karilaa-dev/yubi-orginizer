import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { DEFAULT_OPEN_GROUPS, SLIDE_DIRECTION_OPTIONS, TRAY_GROUPS, dockSettingsState, groupOfControl, traySettingsState } from '../src/ui/settings-model';
import type { HolderConfig } from '../src/types';

const tray = (): HolderConfig => defaultConfig();
const summary = (c: HolderConfig, id: string) => traySettingsState(c).groups.find(g => g.id === id)!.summary;

describe('tray settings model', () => {
  it('orders groups Layout, Stacking, Lid, Size, Pockets & text and opens Layout and Stacking first', () => {
    expect(TRAY_GROUPS.map(g => g.title)).toEqual(['Layout', 'Stacking', 'Lid', 'Size', 'Pockets & text']);
    expect(DEFAULT_OPEN_GROUPS.inventory_tray).toEqual(['layout', 'stacking']);
    expect(groupOfControl('inventory_tray', 'tray.margin')).toBe('size');
    expect(groupOfControl('inventory_tray', 'label-x')).toBeUndefined();
    expect(SLIDE_DIRECTION_OPTIONS.map(o => o.label)).toEqual(['← Left', '→ Right', '↓ Front', '↑ Back']);
  });
  it('summarises defaults', () => {
    const s = traySettingsState(tray());
    expect(s.groups.map(g => [g.id, g.summary, g.modified])).toEqual([
      ['layout', 'Auto · 6 columns · 27 mm', false],
      ['stacking', 'Standalone', false],
      ['lid', 'No lid', false],
      ['size', expect.stringMatching(/^Fit to keys · [\d.]+ × [\d.]+ × 8.6 mm$/), false],
      ['pockets', 'Standard scoop · Tabs', false],
    ]);
    const empty = { ...tray(), slots: [] };
    expect(summary(empty, 'layout')).toBe('Auto · 27 mm');
    expect(summary(empty, 'size')).toBe('Fit to keys · 8.6 mm high');
    expect(traySettingsState(empty).size.readout).toBe('Add keys to see the size.');
  });
  it('hides dependent controls instead of disabling them', () => {
    const c = tray();
    let s = traySettingsState(c);
    for (const id of ['tray.slideDirection', 'tray.lidStyle', 'tray.lidText', 'tray.lidTextPercent', 'tray.lidTextRotation', 'tray.width', 'tray.depth'] as const) expect(s.controls[id].visible).toBe(false);
    Object.assign(c.options.tray, { connection: 'h20_slide_v7', slideDirection: 'back', lid: true, lidText: 'WORK', lidStyle: 'minimal' });
    s = traySettingsState(c);
    expect(s.controls['tray.slideDirection'].visible).toBe(true);
    expect(s.controls['tray.lidTextPercent']).toMatchObject({ visible: true, disabled: false });
    expect(s.controls['tray.lidStyle'].hint).toBe('Thin ribbed panel. Uses less filament.');
    expect(s.controls['tray.lid'].hint).toBe('On a stack, add the lid to the top layer only.');
    expect(s.connectionNote).toBe('Adds a 13 mm border on the two locking edges.');
    expect(summary(c, 'stacking')).toBe('Slide-lock · ↑ Back');
    expect(summary(c, 'lid')).toBe('Minimal lid · “WORK”');
    expect(s.stacking.lockLabel).toMatch(/^Fix size at [\d.]+ × [\d.]+ mm$/);
    delete c.options.tray.lidTextPercent;
    expect(traySettingsState(c).controls['tray.lidTextPercent']).toMatchObject({ disabled: true, hint: 'Available after the preview updates.' });
  });
  it('shows legacy snap-fit as a selected option with raised minimums and a fixed lid design', () => {
    const c = tray(); Object.assign(c.options.tray, { connection: 'snap_fit', lid: true });
    const s = traySettingsState(c);
    expect(s.legacySnapFit).toBe(true);
    expect(s.controls['tray.height']).toMatchObject({ min: 14.6, hint: 'At least 14.6 mm for snap-fit.' });
    expect(s.controls['tray.margin']).toMatchObject({ min: 10 });
    expect(s.controls['tray.lidStyle'].visible).toBe(false);
    expect(s.lidStyleNote).toBe('Snap-fit lids use a fixed design.');
    expect(summary(c, 'stacking')).toBe('Snap-fit (older version)');
  });
  it('reports a too-small fixed footprint with a grow action and marks Size as an error', () => {
    const c = tray(); c.options.tray.footprint = { width: 40, depth: 40 };
    const s = traySettingsState(c);
    expect(s.size.tooSmall).toBe(true);
    expect(s.size.readout).toMatch(/^Too small\. These keys need at least [\d.]+ × [\d.]+ mm\.$/);
    expect(s.size.grow!.label).toMatch(/^Use [\d.]+ × [\d.]+ mm$/);
    expect(s.groups.find(g => g.id === 'size')).toMatchObject({ error: true, modified: true, summary: 'Too small for these keys' });
    expect(traySettingsState(tray(), new Set(['tray.spacing'])).groups.find(g => g.id === 'layout')!.error).toBe(true);
  });
});

describe('dock settings model', () => {
  it('summarises dock groups', () => {
    const c = { ...tray(), template: 'desktop_dock' as const };
    expect(dockSettingsState(c).groups.map(g => g.summary)).toEqual(['Auto · 26 mm', 'Base 13 mm · margins 18 / 22.5 mm', '“KEY DOCK”']);
    c.options.dock.title = '';
    expect(dockSettingsState(c).groups[2]).toMatchObject({ summary: 'No text', modified: true });
  });
});
