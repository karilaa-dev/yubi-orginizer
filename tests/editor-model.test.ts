import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSlot, defaultConfig, validateConfig } from '../src/config';
import type { HolderConfig } from '../src/types';
import { offlineStatusText, updateCheckText } from '../src/ui/app-help';
import { fieldErrorText, numberField, sliderField } from '../src/ui/editor-fields';
import { catalogMarkup, catalogTotalText, dropIndex, isKeysControl, keysPanelMarkup, reinsertSlot, removeOneOfType, removedMessage } from '../src/ui/editor-keys';
import { controlValue, trayGroups, settingsPanelMarkup, sizePanelMarkup, snapFitRangeError, withConnection, withTemplate } from '../src/ui/editor-settings';
import {
  createErrorAnnouncer, downloadButtonState, downloadDialogStatus, fileSizeText, formatNote, generationLabel, gramsText, isOfflineSetupFailure,
  mobileStatusText, partSelectValue, preparingLabel, previewOverlay, primaryDownloadLabel,
} from '../src/ui/editor-status';
import { DOCK_CONTROLS, TRAY_CONTROLS } from '../src/ui/settings-model';

const tray = (): HolderConfig => defaultConfig();

describe('Download button and mobile status', () => {
  it('leads to the problem instead of disabling', () => {
    expect(downloadButtonState({ keys: 0, errors: 0, state: 'empty' })).toEqual({ label: 'Add keys to download', blocked: true, action: 'add' });
    expect(downloadButtonState({ keys: 3, errors: 1, state: 'invalid' })).toEqual({ label: 'Fix 1 setting', blocked: true, action: 'fix' });
    expect(downloadButtonState({ keys: 3, errors: 2, state: 'too-small' }).label).toBe('Fix 2 settings');
    for (const state of ['failed', 'paused', 'offline-setup'] as const) {
      expect(downloadButtonState({ keys: 3, errors: 0, state })).toEqual({ label: 'Download', blocked: true, action: 'retry' });
    }
    for (const state of ['generating', 'ready'] as const) {
      expect(downloadButtonState({ keys: 3, errors: 0, state })).toEqual({ label: 'Download', blocked: false, action: 'open' });
    }
  });

  it('summarises the state for the mobile bar', () => {
    expect(mobileStatusText({ keys: 0, errors: 0, state: 'empty' })).toBe('Add keys to start');
    expect(mobileStatusText({ keys: 2, errors: 1, state: 'invalid' })).toBe('Fix 1 setting');
    expect(mobileStatusText({ keys: 2, errors: 0, state: 'generating' })).toBe('Generating…');
    expect(mobileStatusText({ keys: 2, errors: 0, state: 'ready' }, '≈ 24 g')).toBe('Ready · ≈ 24 g');
    expect(mobileStatusText({ keys: 2, errors: 0, state: 'paused' })).toBe('Paused');
    expect(mobileStatusText({ keys: 2, errors: 0, state: 'failed' })).toBe("Couldn't generate");
  });

  it('says "Not saved" in the mobile bar when the latest edit could not be saved', () => {
    expect(mobileStatusText({ keys: 2, errors: 0, state: 'ready', unsaved: true }, '≈ 24 g')).toBe('Not saved');
    expect(mobileStatusText({ keys: 2, errors: 1, state: 'invalid', unsaved: true })).toBe('Not saved');
    expect(mobileStatusText({ keys: 2, errors: 0, state: 'ready', unsaved: false }, '≈ 24 g')).toBe('Ready · ≈ 24 g');
  });
});

describe('Blocking error announcements', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('speaks only after typing pauses, once per error', () => {
    vi.useFakeTimers();
    const spoken: string[] = [];
    const announcer = createErrorAnnouncer(text => spoken.push(text), 450);
    announcer.schedule('Column spacing must be between 24 and 42 mm.'); // "3" of "30"
    vi.advanceTimersByTime(200);
    announcer.cancel(); // "30" is valid
    vi.advanceTimersByTime(1000);
    expect(spoken).toEqual([]);
    const tooSmall = 'Too small. These keys need at least 90 × 82.8 mm.';
    announcer.schedule(tooSmall);
    vi.advanceTimersByTime(450);
    announcer.schedule(tooSmall);
    vi.advanceTimersByTime(450);
    expect(spoken).toEqual([tooSmall]);
    announcer.reset(); // fixed, then the same error comes back
    announcer.schedule(tooSmall);
    vi.advanceTimersByTime(450);
    expect(spoken).toEqual([tooSmall, tooSmall]);
  });
});

describe('Preview overlay', () => {
  it('has no card while generating or ready', () => {
    expect(previewOverlay('generating')).toBeUndefined();
    expect(previewOverlay('ready')).toBeUndefined();
  });

  it('offers the next step for every blocked state', () => {
    expect(previewOverlay('empty')).toMatchObject({ text: 'Add keys to start', actions: [{ label: 'Add keys', action: 'add' }] });
    expect(previewOverlay('invalid', { errors: 1 })?.text).toBe('Fix 1 setting to update the model.');
    expect(previewOverlay('invalid', { errors: 3 })).toMatchObject({ text: 'Fix 3 settings to update the model.', actions: [{ action: 'show-error' }] });
    expect(previewOverlay('too-small', { required: { width: 164, depth: 82.8 }, grow: { width: 164, depth: 90 }, cancellable: true })).toMatchObject({
      text: 'This change needs at least 164 × 82.8 mm. Resize every tray to fit?',
      actions: [{ label: 'Use 164 × 90 mm', action: 'grow-footprint' }, { label: 'Cancel', action: 'cancel-resize' }],
    });
    expect(previewOverlay('paused')).toMatchObject({ text: 'Paused.', actions: [{ label: 'Resume', action: 'retry' }] });
    expect(previewOverlay('failed')?.text).toBe("Couldn't generate the model.");
    expect(previewOverlay('failed', { message: 'Worker crashed' })).toMatchObject({ text: 'Worker crashed', actions: [{ label: 'Try again', action: 'retry' }] });
    expect(previewOverlay('offline-setup')?.text).toMatch(/^The model engine hasn't finished downloading\./);
  });

  it('names the part being generated', () => {
    expect(generationLabel('Inventory tray', 0, 2)).toBe('Generating inventory tray (1/2)…');
    expect(generationLabel('Tray lid', 1, 2)).toBe('Generating tray lid (2/2)…');
    expect(generationLabel('Desktop dock', 0, 1)).toBe('Generating desktop dock…');
  });

  it('maps network failures before offline setup to the setup message', () => {
    const notReady = { supported: true, offlineReady: false };
    expect(isOfflineSetupFailure('Failed to fetch', notReady, true)).toBe(true);
    expect(isOfflineSetupFailure('Syntax error', notReady, false)).toBe(true);
    expect(isOfflineSetupFailure('Syntax error', notReady, true)).toBe(false);
    expect(isOfflineSetupFailure('Failed to fetch', { supported: true, offlineReady: true }, false)).toBe(false);
    expect(isOfflineSetupFailure('Failed to fetch', { supported: false, offlineReady: false }, false)).toBe(false);
    expect(isOfflineSetupFailure('Failed to fetch', { ...notReady, registrationFailed: true }, false)).toBe(false);
  });

  it('formats estimates and sizes', () => {
    expect(gramsText(8.43)).toBe('≈ 8.4 g');
    expect(gramsText(24.4)).toBe('≈ 24 g');
    expect(fileSizeText(12_345)).toBe('13 KB');
    expect(fileSizeText(10)).toBe('1 KB');
    expect(fileSizeText(1_500_000)).toBe('1.4 MB');
  });
});

describe('Download dialog parts and status', () => {
  it('selects all parts when a lid is added after the single-part list', () => {
    // [tray] → [tray, tray-lid]: the one-part list's implicit value is not a choice.
    expect(partSelectValue('tray', 1, ['tray', 'tray-lid'])).toBe('');
    // Lid on → off → on.
    expect(partSelectValue('', 3, ['tray'])).toBe('tray');
    expect(partSelectValue('tray', 1, ['tray', 'tray-lid'])).toBe('');
    // A project that opens with a lid.
    expect(partSelectValue('', 0, ['tray', 'tray-lid'])).toBe('');
  });

  it('keeps a part picked in a multi-part list while it exists', () => {
    expect(partSelectValue('tray-lid', 3, ['tray', 'tray-lid'])).toBe('tray-lid');
    expect(partSelectValue('tray', 3, ['tray', 'tray-lid'])).toBe('tray');
    expect(partSelectValue('tray-lid', 3, ['tray', 'other'])).toBe('');
    expect(partSelectValue('tray-lid', 3, [])).toBe('');
  });

  it('explains a failed or offline model inside the dialog, with Try again', () => {
    expect(downloadDialogStatus('failed', 'Worker crashed')).toMatchObject({ text: 'Worker crashed', tone: 'error', actions: [{ label: 'Try again', action: 'retry' }] });
    expect(downloadDialogStatus('failed')?.text).toBe("Couldn't generate the model.");
    expect(downloadDialogStatus('offline-setup')).toMatchObject({ actions: [{ label: 'Try again', action: 'retry' }] });
    expect(downloadDialogStatus('paused')).toMatchObject({ actions: [{ label: 'Resume', action: 'retry' }] });
    for (const state of ['generating', 'ready', 'invalid', 'too-small', 'empty'] as const) expect(downloadDialogStatus(state), state).toBeUndefined();
  });
});

describe('Download dialog labels', () => {
  it('follows the format and the selected parts', () => {
    expect(primaryDownloadLabel('3mf', 2)).toBe('Download 3MF');
    expect(primaryDownloadLabel('stl', 2)).toBe('Download ZIP');
    expect(primaryDownloadLabel('stl', 2, 'tray')).toBe('Download STL');
    expect(primaryDownloadLabel('scad', 1, 'tray')).toBe('Download SCAD');
    expect(preparingLabel({ index: 0, total: 2 })).toBe('Preparing… 1/2');
    expect(preparingLabel({ index: 0, total: 0 })).toBe('Preparing…');
    expect(formatNote('3mf', false)).toBe('Open as a project in your slicer to keep these settings.');
    expect(formatNote('stl', true)).toBe('Several parts download as one ZIP.');
    expect(formatNote('scad', false)).toBe('');
  });
});

describe('Keys: catalog steppers and list operations', () => {
  it('minus removes the last key without a label of its own first', () => {
    const c = { ...tray(), slots: [createSlot('C'), createSlot('C'), createSlot('A')] };
    c.slots[1].label = 'Work';
    const result = removeOneOfType(c, 'C')!;
    expect(result.custom).toBe(false);
    expect(result.index).toBe(0);
    expect(result.config.slots.map(s => s.label)).toEqual(['Work', '5 NFC']);
  });

  it('never removes a custom-labelled key silently', () => {
    const c = { ...tray(), slots: [createSlot('C'), createSlot('C')] };
    c.slots[0].label = 'Home';
    c.slots[1].label = 'Work';
    const result = removeOneOfType(c, 'C')!;
    expect(result).toMatchObject({ custom: true, index: 1, slot: { label: 'Work' } });
    expect(removedMessage(result.slot)).toBe('Removed YubiKey 5C NFC (“Work”).');
    expect(removeOneOfType(c, 'AN')).toBeUndefined();
  });

  it('Undo puts a key back at its index with the same id and label', () => {
    const c = { ...tray(), slots: [createSlot('A'), createSlot('C'), createSlot('CI')] };
    const removed = c.slots[1];
    const without = { ...c, slots: c.slots.filter(s => s !== removed) };
    const restored = reinsertSlot(without, removed, 1);
    expect(restored.slots.map(s => s.id)).toEqual(c.slots.map(s => s.id));
    expect(reinsertSlot(restored, removed, 1)).toBe(restored);
  });

  it('reports totals and drop targets', () => {
    expect(catalogTotalText(1)).toBe('1 key');
    expect(catalogTotalText(7, { verb: 'Added', type: 'C' })).toBe('Added 5C NFC · 7 keys');
    expect(catalogTotalText(6, { verb: 'Removed', type: 'C' })).toBe('Removed 5C NFC · 6 keys');
    expect(dropIndex(0, 3, false)).toBe(2);
    expect(dropIndex(0, 3, true)).toBe(3);
    expect(dropIndex(4, 1, false)).toBe(1);
    expect(dropIndex(4, 1, true)).toBe(2);
    expect(removedMessage({ ...createSlot('A'), label: ' ' })).toBe('Removed YubiKey 5 NFC.');
  });

  it('renders rows with reorder controls and steppers with limits', () => {
    const c = tray();
    const html = keysPanelMarkup(c, { draggable: true });
    expect(html.match(/<li class="key-row/g)).toHaveLength(6);
    expect(html).toContain('aria-label="Reorder YubiKey 5 NFC, 1 of 6"');
    expect(html).toContain('placeholder="No label"');
    expect(html).not.toContain('Printed label</');
    expect(html).not.toContain('Long labels shrink to fit.');
    expect(keysPanelMarkup({ ...c, slots: [] }, { draggable: false })).toContain('No keys yet');
    const catalog = catalogMarkup({ ...c, slots: [] }, '');
    expect(catalog).toContain('data-remove-type="C" aria-label="Remove one YubiKey 5C NFC" disabled');
    expect(catalog).toContain('Also fits: Security Key C NFC, YubiKey 5C NFC FIPS');
    expect(catalogMarkup(c, 'zzz')).toContain('No matching keys');
    expect(isKeysControl('label-x')).toBe(true);
    expect(['labels', 'labelSize', 'tray.columns', 'dock.columns'].some(isKeysControl)).toBe(false);
    expect(isKeysControl('tray.margin')).toBe(false);
  });
});

describe('Settings fields', () => {
  it('speaks the unit as part of the label', () => {
    const percent = sliderField({ id: 'tray.lidTextPercent', label: 'Text size', value: 31.061, min: 0.1, max: 100, step: 0.1, unit: '%' });
    expect(percent).toContain('<label for="tray.lidTextPercent">Text size<span class="sr-only"> (percent)</span></label>');
    expect(percent).toContain('aria-label="Text size (percent)"');
    expect(percent).toContain('<span class="unit" aria-hidden="true">%</span>');
    const mm = sliderField({ id: 'dock.depthMargin', label: 'Front & back margin', value: 22.5, min: 18, max: 45, step: 0.5 });
    expect(mm).toContain('Front &amp; back margin<span class="sr-only"> (millimetres)</span></label>');
    expect(mm).toContain('aria-label="Front &amp; back margin (millimetres)"');
    const width = numberField({ id: 'tray.width', label: 'Width', value: 60, min: 20, max: 1000, step: 0.01, describedBy: 'tray-size-readout' });
    expect(width).toContain('Width<span class="sr-only"> (millimetres)</span></label>');
    expect(width).toContain('aria-describedby="hint-tray.width error-tray.width tray-size-readout"');
  });

  it('ties the tray size readout to Width and Depth', () => {
    const html = sizePanelMarkup(tray(), { match: undefined, candidates: [] });
    expect(html).toContain('aria-describedby="hint-tray.width error-tray.width tray-size-readout"');
    expect(html).toContain('aria-describedby="hint-tray.depth error-tray.depth tray-size-readout"');
  });

  it('names the field and unit in validation errors', () => {
    const message = (edit: (c: HolderConfig) => void): string => {
      const c = tray();
      edit(c);
      try { validateConfig(c); } catch (error) { return fieldErrorText((error as Error).message); }
      throw new Error('expected a validation error');
    };
    expect(message(c => { c.options.tray.margin = 25; })).toBe('Edge margin must be between 5 and 20 mm.');
    expect(message(c => { c.options.tray.margin = NaN; })).toBe('Edge margin must be between 5 and 20 mm.');
    expect(message(c => { c.options.tray.rowGap = 50; })).toBe('Row spacing must be between 2 and 40 mm.');
    expect(message(c => { c.options.tray.height = 30; })).toBe('Height must be between 8.6 and 20 mm.');
    expect(message(c => { c.options.tray.spacing = 3; })).toBe('Column spacing must be between 24 and 42 mm.');
    expect(message(c => { c.options.tray.lidTextPercent = 150; })).toBe('Text size must be between 0.1% and 100%.');
    expect(message(c => { c.options.tray.footprint = { width: 10, depth: 80 }; })).toBe('Width must be between 20 and 1000 mm.');
    expect(message(c => { c.options.dock.spacing = 50; })).toBe('Column spacing must be between 22 and 40 mm.');
    expect(message(c => { c.options.dock.rowSpacing = 5; })).toBe('Row spacing must be between 18 and 70 mm.');
    expect(message(c => { c.options.dock.edgeMargin = 5; })).toBe('Side margin must be between 12 and 40 mm.');
    expect(message(c => { c.options.dock.depthMargin = 50; })).toBe('Front & back margin must be between 18 and 45 mm.');
    expect(message(c => { c.options.dock.height = 5; })).toBe('Base height must be between 11 and 25 mm.');
    expect(message(c => { c.options.tray.sideText = 'Café ☕ tray'; })).toBe('Front text supports Latin, Greek, and Cyrillic letters, numbers, and punctuation.');
    expect(message(c => { c.options.dock.title = '☕'; })).toMatch(/^Front text supports /);
    expect(message(c => { c.options.tray.lidText = '☕'; })).toMatch(/^Lid text supports /);
    expect(fieldErrorText('Browser storage is full.')).toBe('Browser storage is full.');
    expect(fieldErrorText('Tray lid text size must be between 2 and 100.')).toBe('Tray lid text size must be between 2 and 100.');
  });

  it('gives snap-fit trays their own Height and Edge margin range', () => {
    const c = tray();
    c.options.tray.connection = 'snap_fit';
    const at = (height: number, margin: number): HolderConfig => ({ ...c, options: { ...c.options, tray: { ...c.options.tray, height, margin } } });
    for (const height of [25, NaN, 10]) expect(snapFitRangeError(at(height, 10), 'tray.height'), String(height)).toBe('Height must be between 14.6 and 20 mm for snap-fit.');
    for (const margin of [25, NaN, 6]) expect(snapFitRangeError(at(15, margin), 'tray.margin'), String(margin)).toBe('Edge margin must be between 10 and 20 mm for snap-fit.');
    expect(snapFitRangeError(at(15, 10), 'tray.height')).toBeUndefined();
    expect(snapFitRangeError(at(15, 10), 'tray.margin')).toBeUndefined();
    expect(snapFitRangeError(tray(), 'tray.height')).toBeUndefined(); // not snap-fit: validateConfig's range applies
  });
});

describe('Undo of a type switch or snap-fit replacement', () => {
  it('reverts only that choice and keeps later edits', () => {
    const switched = withTemplate(tray(), 'desktop_dock');
    // Keys added and dock settings changed after the switch, before Undo.
    const edited: HolderConfig = { ...switched, slots: [...switched.slots, createSlot('C'), createSlot('C')] };
    edited.options = { ...edited.options, dock: { ...edited.options.dock, title: 'MY DOCK', columns: 4 } };
    const undone = withTemplate(edited, 'inventory_tray');
    expect(undone.template).toBe('inventory_tray');
    expect(undone.slots).toHaveLength(8);
    expect(undone.options.dock).toMatchObject({ title: 'MY DOCK', columns: 4 });

    const replaced = tray();
    replaced.options.tray.connection = 'stackable';
    replaced.slots.push(createSlot('A'));
    replaced.options.tray.sideText = 'Desk';
    const snap = withConnection(replaced, 'snap_fit');
    expect(snap.options.tray.connection).toBe('snap_fit');
    expect(snap.slots).toHaveLength(7);
    expect(snap.options.tray.sideText).toBe('Desk');
    expect(replaced.options.tray.connection).toBe('stackable'); // not mutated
    expect(() => validateConfig(snap)).not.toThrow();
  });
});

describe('Settings panel markup', () => {
  it('wraps every model control in [data-control], in the Keys, Size or settings tab', () => {
    const tabs = (c: HolderConfig) => [
      keysPanelMarkup(c, { draggable: false }),
      sizePanelMarkup(c, { match: undefined, candidates: [] }),
      settingsPanelMarkup(c, { open: new Set() }),
      c.template === 'inventory_tray' ? trayGroups(c, new Set(), 'layers') + settingsPanelMarkup(c, { open: new Set(), lid: true }) : '',
    ];
    const trayHtml = settingsPanelMarkup(tray(), { open: new Set() });
    const all = tabs(tray()).join('');
    for (const id of TRAY_CONTROLS) expect(all, id).toContain(`data-control="${id}"`);
    for (const id of ['tray.columns', 'labels', 'labelSize']) {
      expect(tabs(tray())[0]).not.toContain(`data-control="${id}"`);
      expect(trayHtml).toContain(`data-control="${id}"`);
    }
    const lidHtml = settingsPanelMarkup(tray(), { open: new Set(), lid: true });
    expect(lidHtml).toContain('data-control="tray.lidText"');
    expect(lidHtml).not.toContain('data-control="tray.columns"');
    expect(lidHtml).not.toContain('data-control="labels"');
    expect(tabs(tray())[0]).toContain('data-template-switch');
    expect(tabs(tray())[2]).not.toContain('data-template-switch');
    expect(tabs(tray())[1]).toContain('data-control="tray.spacing"');
    expect(trayHtml).not.toContain('Snap-fit (from an older version)');
    expect(trayHtml).not.toContain('dock-notice');
    expect(trayHtml).not.toContain('data-control="tray.lid"');
    expect(tabs(tray())[3]).toContain('data-control="tray.lidStyle"');
    expect(tabs(tray())[3]).toContain('data-control="tray.connection"');
    expect(trayHtml).not.toContain('rotate-lid-text');
    const dock = { ...tray(), template: 'desktop_dock' as const };
    const dockHtml = keysPanelMarkup(dock, { draggable: false, dockNotice: true });
    for (const id of DOCK_CONTROLS) expect(tabs(dock).join(''), id).toContain(`data-control="${id}"`);
    expect(dockHtml).toContain('Dock fit is still being tuned. Print a one-key dock first.');
  });

  it('keeps the retired snap-fit card only while it is selected', () => {
    const c = tray();
    c.options.tray.connection = 'snap_fit';
    expect(trayGroups(c, new Set(), 'layers')).toContain('Snap-fit (from an older version)');
  });

  it('reads control values from the config', () => {
    const c = tray();
    expect(controlValue(c, 'tray.sizeLocked')).toBe('fit');
    expect(controlValue(c, 'tray.spacing')).toBe(24);
    c.options.tray.connection = 'snap_fit';
    expect(controlValue(c, 'tray.height')).toBeGreaterThan(8.6);
    c.options.tray.footprint = { width: 120, depth: 90 };
    expect([controlValue(c, 'tray.sizeLocked'), controlValue(c, 'tray.width'), controlValue(c, 'tray.depth')]).toEqual(['fixed', 120, 90]);
  });
});

describe('Help status lines', () => {
  it('describes offline readiness', () => {
    expect(offlineStatusText({ supported: true, offlineReady: true }, false)).toBe('Works offline on this device.');
    expect(offlineStatusText({ supported: true, offlineReady: false }, false)).toBe('Getting ready for offline use…');
    expect(offlineStatusText({ supported: false, offlineReady: false }, false)).toBe("Offline use isn't available in this browser.");
    expect(offlineStatusText({ supported: true, offlineReady: true }, true)).toBe('Works offline on this device. Running as an installed app.');
  });

  it('describes the update check', () => {
    const base = { online: true, downloading: false, updateReady: false, applying: false };
    expect(updateCheckText(base, true)).toBe('Checking…');
    expect(updateCheckText(base, false)).toBe("You're up to date.");
    expect(updateCheckText({ ...base, downloading: true }, false)).toBe('Downloading an update…');
    expect(updateCheckText({ ...base, updateReady: true }, false)).toBe('Update ready.');
    expect(updateCheckText({ ...base, online: false }, false)).toBe('Connect to the internet to check for updates.');
  });
});
