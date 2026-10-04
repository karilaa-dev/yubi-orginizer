import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import {
  DEFAULT_OPEN_GROUPS, FRONT_TEXT_NOTE, RETENTION_NOTE, SIZE_SECTIONS, SLIDE_DIRECTION_OPTIONS, TRAY_GROUPS,
  dockSettingsState, footprintChoice, groupOfControl, panelOfControl, traySettingsState,
} from '../src/ui/settings-model';
import type { HolderConfig } from '../src/types';

const tray = (): HolderConfig => defaultConfig();
const summary = (c: HolderConfig, id: string) => traySettingsState(c).groups.find(g => g.id === id)!.summary;

describe('tray settings model', () => {
  it('splits controls across the Keys, Size and Tray settings tabs', () => {
    expect(TRAY_GROUPS.map(g => g.title)).toEqual(['Stacking', 'Lid', 'Pockets & text']);
    expect(SIZE_SECTIONS.inventory_tray.map(s => s.title)).toEqual(['Size', 'Spacing']);
    expect(DEFAULT_OPEN_GROUPS.inventory_tray).toEqual(['stacking', 'lid']);
    expect(panelOfControl('inventory_tray', 'tray.columns')).toBe('settings');
    expect(panelOfControl('inventory_tray', 'labelSize')).toBe('settings');
    expect(panelOfControl('inventory_tray', 'tray.lidText')).toBe('settings');
    expect(panelOfControl('inventory_tray', 'tray.connection')).toBe('layers');
    expect(panelOfControl('inventory_tray', 'label-x')).toBe('keys');
    expect(panelOfControl('inventory_tray', 'tray.width')).toBe('size');
    expect(panelOfControl('inventory_tray', 'tray.margin')).toBe('size');
    expect(panelOfControl('inventory_tray', 'tray.rowGap')).toBe('size');
    expect(panelOfControl('inventory_tray', 'tray.sideTextPercent')).toBe('settings');
    expect(panelOfControl('desktop_dock', 'dock.depthMargin')).toBe('size');
    expect(panelOfControl('desktop_dock', 'dock.columns')).toBe('settings');
    expect(groupOfControl('inventory_tray', 'tray.sideTextPercent')).toBe('pockets');
    expect(groupOfControl('inventory_tray', 'tray.margin')).toBeUndefined();
    expect(groupOfControl('inventory_tray', 'label-x')).toBeUndefined();
    expect(SLIDE_DIRECTION_OPTIONS.map(o => o.label)).toEqual(['← Left', '→ Right', '↓ Front', '↑ Back']);
  });
  it('summarises defaults', () => {
    const s = traySettingsState(tray());
    expect(s.groups.map(g => [g.id, g.summary, g.modified])).toEqual([
      ['stacking', 'Standalone', false],
      ['lid', 'No lid', false],
      ['pockets', 'Standard scoop · No tabs', false],
    ]);
    expect(s.size.choice).toBe('fit');
    expect(s.size.readout).toMatch(/^[\d.]+ × [\d.]+ mm, fits your keys$/);
    expect(traySettingsState({ ...tray(), slots: [] }).size.readout).toBe('Add keys to see the size.');
  });
  it('marks retention tabs as untested', () => {
    const c = tray();
    expect(c.options.tray.retention).toBe(false);
    expect(traySettingsState(c).controls['tray.retention'].hint).toBe(RETENTION_NOTE);
    c.options.tray.retention = true;
    expect(summary(c, 'pockets')).toBe('Standard scoop · Tabs');
    expect(traySettingsState(c).groups.find(g => g.id === 'pockets')!.modified).toBe(true);
  });
  it('shows the front text size with the print note once there is text', () => {
    const c = tray();
    expect(traySettingsState(c).controls['tray.sideTextPercent'].visible).toBe(false);
    c.options.tray.sideText = 'KEYS';
    expect(traySettingsState(c).controls['tray.sideTextPercent']).toMatchObject({ visible: true, hint: FRONT_TEXT_NOTE });
    c.options.tray.sideText = '';
    expect(traySettingsState(c).groups.find(g => g.id === 'pockets')!.modified).toBe(false);
    c.options.tray.sideTextPercent = 80;
    expect(traySettingsState(c).groups.find(g => g.id === 'pockets')!.modified).toBe(true);
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
  it('reports a too-small fixed footprint with a grow action', () => {
    const c = tray(); c.options.tray.footprint = { width: 40, depth: 40 };
    const s = traySettingsState(c);
    expect(s.size.tooSmall).toBe(true);
    expect(s.size.choice).toBe('fixed');
    expect(s.size.readout).toMatch(/^Too small\. These keys need at least [\d.]+ × [\d.]+ mm\.$/);
    expect(s.size.grow!.label).toMatch(/^Use [\d.]+ × [\d.]+ mm$/);
    expect(traySettingsState(tray(), new Set(['tray.lidText'])).groups.find(g => g.id === 'lid')!.error).toBe(true);
  });
});

describe('Size › Footprint › Match project', () => {
  const work = { id: 'p1', name: 'Work keys', width: 200, depth: 90 };
  it('waits for a tray to be picked, then shows where the size came from', () => {
    const c = tray();
    expect(footprintChoice(c, 'choosing')).toBe('match');
    let s = traySettingsState(c, new Set(), 'choosing');
    expect(s.size.readout).toBe('Choose a tray to copy its width and depth.');
    expect(s.controls['tray.width'].visible).toBe(false);
    c.options.tray.footprint = { width: 200, depth: 90 };
    s = traySettingsState(c, new Set(), work);
    expect(s.size.choice).toBe('match');
    expect(s.size.readout).toBe('200 × 90 mm, same as “Work keys”.');
  });
  it('becomes a fixed size once the width or depth no longer matches', () => {
    const c = tray();
    c.options.tray.footprint = { width: 210, depth: 90 };
    expect(footprintChoice(c, work)).toBe('fixed');
    expect(traySettingsState(c, new Set(), work).controls['tray.width'].visible).toBe(true);
    c.options.tray.footprint = null;
    expect(footprintChoice(c, work)).toBe('fit');
  });
});

describe('dock settings model', () => {
  it('keeps only Text in Dock settings and reports the footprint in the Size tab', () => {
    const c = { ...tray(), template: 'desktop_dock' as const };
    const s = dockSettingsState(c);
    expect(s.groups.map(g => g.summary)).toEqual(['“KEY DOCK”']);
    expect(s.size.readout).toMatch(/^[\d.]+ × [\d.]+ mm\. Spacing and margins set the size\.$/);
    expect(s.controls['dock.titlePercent']).toMatchObject({ visible: true, hint: FRONT_TEXT_NOTE });
    c.options.dock.title = '';
    expect(dockSettingsState(c).groups[0]).toMatchObject({ summary: 'No text', modified: true });
    expect(dockSettingsState(c).controls['dock.titlePercent'].visible).toBe(false);
  });
});
