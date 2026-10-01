/**
 * Keys tab (#keys-panel) and the Add keys catalog (#key-dialog): markup and the pure list
 * operations behind the steppers, removal and drag-and-drop reordering.
 */
import { KEY_CATALOG, MAX_SLOTS } from '../config';
import { MATCHING_MODELS, searchKeys } from '../catalog';
import { icon, keyIcon } from '../icons';
import { keyLabelPercent } from '../text-size';
import type { HolderConfig, KeyType, Slot } from '../types';
import { esc, plural } from './dom';
import { inlineSegmentedField, inlineSliderField, switchField } from './editor-fields';
import { COLUMN_OPTIONS, organizerTypeMarkup } from './editor-settings';

export { isKeysControl } from './settings-model';

/* ───────────── Pure list operations ───────────── */

const isDefaultLabel = (slot: Slot): boolean => !slot.label.trim() || slot.label === KEY_CATALOG[slot.type].short;

export interface RemovedSlot { config: HolderConfig; slot: Slot; index: number; custom: boolean }

/**
 * Catalog minus: removes the last key of `type` that has no label of its own.
 * Only when every key of that type has a custom label is the last one removed, with `custom: true`
 * so the caller offers Undo (a custom label is never removed silently).
 */
export function removeOneOfType(config: HolderConfig, type: KeyType): RemovedSlot | undefined {
  let index = -1;
  for (let i = config.slots.length - 1; i >= 0; i--) {
    if (config.slots[i].type === type && isDefaultLabel(config.slots[i])) { index = i; break; }
  }
  const custom = index < 0;
  if (custom) index = config.slots.map(s => s.type).lastIndexOf(type);
  if (index < 0) return undefined;
  const slot = config.slots[index];
  return { config: { ...config, slots: config.slots.filter((_, i) => i !== index) }, slot, index, custom };
}

/** Puts a removed key back at its old position (Undo). No-op if it is already there or the list is full. */
export function reinsertSlot(config: HolderConfig, slot: Slot, index: number): HolderConfig {
  if (config.slots.some(s => s.id === slot.id) || config.slots.length >= MAX_SLOTS) return config;
  const slots = [...config.slots];
  slots.splice(Math.min(Math.max(index, 0), slots.length), 0, slot);
  return { ...config, slots };
}

/** `Removed YubiKey 5C NFC (“Work”).` */
export function removedMessage(slot: Slot): string {
  const label = slot.label.trim();
  return `Removed ${KEY_CATALOG[slot.type].name}${label ? ` (“${label}”)` : ''}.`;
}

/** "6 keys", "Added 5C NFC · 7 keys", "Removed 5C NFC · 6 keys". */
export function catalogTotalText(count: number, change?: { verb: 'Added' | 'Removed'; type: KeyType }): string {
  const total = plural(count, 'key');
  return change ? `${change.verb} ${KEY_CATALOG[change.type].short} · ${total}` : total;
}

/** Target index for moveSlot() when a row is dropped before or after another row. */
export function dropIndex(from: number, target: number, after: boolean): number {
  if (from < target) return after ? target : target - 1;
  return after ? target + 1 : target;
}

/* ───────────── Markup ───────────── */

function keyRow(slot: Slot, index: number, count: number, draggable: boolean): string {
  const name = KEY_CATALOG[slot.type].name;
  const hideLabel = slot.occupied ? `Hide ${name} in preview` : `Show ${name} in preview`;
  return `<li class="key-row${slot.occupied ? '' : ' key-hidden'}" data-slot="${slot.id}"${draggable ? ' draggable="true"' : ''}>
    <button type="button" class="drag-handle" data-reorder="${slot.id}" aria-label="Reorder ${esc(name)}, ${index + 1} of ${count}" aria-describedby="reorder-help">${icon('grip')}</button>
    <span class="move-buttons">
      <button type="button" class="icon-button mini" data-move="${index},${index - 1}" data-move-dir="up" aria-label="Move ${esc(name)} up"${index === 0 ? ' disabled' : ''}>${icon('up')}</button>
      <button type="button" class="icon-button mini" data-move="${index},${index + 1}" data-move-dir="down" aria-label="Move ${esc(name)} down"${index === count - 1 ? ' disabled' : ''}>${icon('down')}</button>
    </span>
    ${keyIcon(slot.type)}
    <div class="key-row-main">
      <span class="key-model"><span class="key-model-name">${esc(name)}</span><span class="badge"${slot.occupied ? ' hidden' : ''}>Hidden in preview</span></span>
      <input id="label-${slot.id}" class="key-label" data-label="${slot.id}" type="text" value="${esc(slot.label)}" maxlength="18" placeholder="No label" autocomplete="off" spellcheck="false" aria-label="Printed label for key ${index + 1}, ${esc(name)}" aria-describedby="error-label-${slot.id} label-reorder-help"/>
      <p class="field-error" id="error-label-${slot.id}" data-error="label-${slot.id}" hidden></p>
    </div>
    <button type="button" class="icon-button" data-occupied="${slot.id}" aria-label="${esc(hideLabel)}" title="${slot.occupied ? 'Hide in preview. The pocket stays.' : 'Show in preview'}">${icon(slot.occupied ? 'eye' : 'eyeOff')}</button>
    <button type="button" class="icon-button delete-key" data-remove="${slot.id}" aria-label="Remove key ${index + 1}, ${esc(name)}">${icon('close')}</button>
  </li>`;
}

export function keysPanelMarkup(config: HolderConfig, options: { draggable: boolean; dockNotice?: boolean }): string {
  const { slots } = config;
  const type = organizerTypeMarkup(config.template, options.dockNotice ?? false);
  if (!slots.length) {
    return `<div class="panel-section keys-top">${type}</div><div class="keys-empty">${icon('plus', 'keys-empty-icon')}<p>No keys yet</p>
      <button type="button" class="button primary" data-action="add">${icon('plus')}Add keys</button></div>`;
  }
  const full = slots.length >= MAX_SLOTS;
  const columns = config.template === 'desktop_dock' ? config.options.dock.columns : config.options.tray.columns;
  const columnsId = config.template === 'desktop_dock' ? 'dock.columns' : 'tray.columns';
  const top = `<div class="panel-section keys-top">
      ${type}
      ${inlineSegmentedField({ id: columnsId, legend: 'Columns', options: COLUMN_OPTIONS, value: columns, numeric: true, className: 'columns-field' })}
      <div class="text-setting">
        ${switchField({ id: 'labels', label: 'Print labels', checked: config.labels })}
        <div class="text-options label-size"${config.labels ? '' : ' hidden'}>${inlineSliderField({ id: 'labelSize', label: 'Size', spoken: 'Label size', value: keyLabelPercent(config.labelSize), min: 37.5, max: 100, step: 2.5, unit: '%' })}</div>
        <p id="labels-off-note" class="field-hint"${config.labels ? ' hidden' : ''}>Labels won't be printed.</p>
      </div>
    </div>`;
  return `${top}
    <p id="reorder-help" class="sr-only">Use the Move up and Move down buttons, or press Arrow Up or Arrow Down here.</p>
    <p id="label-reorder-help" class="sr-only">Alt+Arrow Up or Alt+Arrow Down moves this key.</p>
    <ol class="key-list" aria-label="Keys in this organizer">${slots.map((slot, i) => keyRow(slot, i, slots.length, options.draggable)).join('')}</ol>
    <div class="keys-footer">
      <button type="button" class="button secondary add-key-button" data-action="add"${full ? ' disabled aria-describedby="keys-max"' : ''}>${icon('plus')}Add keys</button>
      <p id="keys-max" class="field-hint"${full ? '' : ' hidden'}>${MAX_SLOTS} keys max</p>
    </div>`;
}

/** Catalog rows with steppers. Counts come from the current config. */
export function catalogMarkup(config: HolderConfig, query: string): string {
  const matches = searchKeys(query);
  if (!matches.length) return '<p class="catalog-empty">No matching keys</p>';
  const full = config.slots.length >= MAX_SLOTS;
  return matches.map(type => {
    const key = KEY_CATALOG[type];
    const count = config.slots.filter(s => s.type === type).length;
    return `<div class="catalog-key${count ? ' is-added' : ''}" data-type="${type}">
      ${keyIcon(type)}
      <div class="catalog-text"><strong>${esc(key.name)}</strong><small>${esc(key.connector)}</small><small class="also-fits">Also fits: ${esc(MATCHING_MODELS[type].join(', '))}</small></div>
      <div class="stepper" role="group" aria-label="${esc(key.name)} in this organizer">
        <button type="button" class="icon-button stepper-button" data-remove-type="${type}" aria-label="Remove one ${esc(key.name)}"${count === 0 ? ' disabled' : ''}>${icon('minus')}</button>
        <output class="stepper-count" aria-label="${plural(count, 'key')}">${count}</output>
        <button type="button" class="icon-button stepper-button" data-add-type="${type}" aria-label="Add ${esc(key.name)}"${full ? ' disabled' : ''}>${icon('plus')}</button>
      </div>
    </div>`;
  }).join('');
}
