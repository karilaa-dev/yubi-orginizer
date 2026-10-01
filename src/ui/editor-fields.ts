/**
 * Markup and DOM helpers for editor form controls (Keys tab label strip, Tray/Dock settings).
 *
 * Every control is wrapped in `[data-control="<data-option>"]` and followed by a one-line
 * hint (`[data-hint]`) and an inline error (`[data-error]`). Inputs carry `data-option`, which
 * the editor maps onto the config. Visibility, hints and errors are applied later, in place.
 */
import { esc } from './dom';

/** A slider row, a number field or any other control that shares one data-option id. */
export type ControlId = string;

/** Hint and error lines. `hintExtra` is markup kept after the hint text (e.g. a Help link). */
export const fieldNotes = (id: ControlId, hint = '', hintExtra = ''): string =>
  `<p class="field-hint" id="hint-${id}" data-hint="${id}"${hint ? '' : ' hidden'}><span data-hint-text>${esc(hint)}</span>${hintExtra}</p>`
  + `<p class="field-error" id="error-${id}" data-error="${id}" hidden></p>`;

const describedBy = (id: ControlId, extra = ''): string => `aria-describedby="hint-${id} error-${id}${extra ? ` ${extra}` : ''}"`;

/** The unit is shown next to the field (aria-hidden) and spoken as part of the label. */
const unitName = (unit: 'mm' | '%'): string => (unit === '%' ? 'percent' : 'millimetres');
const unitLabel = (id: ControlId, label: string, unit: 'mm' | '%'): string =>
  `<label for="${id}">${esc(label)}<span class="sr-only"> (${unitName(unit)})</span></label>`;

/** Rounds away floating-point noise for display in number fields. */
export const numberValue = (value: number): string => String(Number(value.toFixed(3)));

export interface SliderOptions {
  id: ControlId;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: 'mm' | '%';
  hint?: string;
  disabled?: boolean;
}

/** Label | number field with unit, and a full-width range below. */
export function sliderField(o: SliderOptions): string {
  const unit = o.unit ?? 'mm';
  const disabled = o.disabled ? ' disabled' : '';
  const value = numberValue(o.value);
  return `<div class="size-field" data-control="${o.id}">
    ${unitLabel(o.id, o.label, unit)}
    <span class="number-wrap"><input id="${o.id}" type="number" data-option="${o.id}" min="${o.min}" max="${o.max}" step="${unit === '%' ? 'any' : o.step}" value="${value}" inputmode="decimal" ${describedBy(o.id)}${disabled}/><span class="unit" aria-hidden="true">${unit}</span></span>
    <input type="range" data-option="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${value}" aria-label="${esc(o.label)} (${unitName(unit)})" ${describedBy(o.id)}${disabled}/>
    ${fieldNotes(o.id, o.hint)}
  </div>`;
}

export interface NumberOptions {
  id: ControlId; label: string; value: number; min: number; max: number; step: number;
  /** Id of another element that describes the field (e.g. the tray size readout). */
  describedBy?: string;
}

/** A stand-alone number field with a unit (tray width and depth). */
export function numberField(o: NumberOptions): string {
  return `<div class="field number-field" data-control="${o.id}">
    ${unitLabel(o.id, o.label, 'mm')}
    <span class="number-wrap"><input id="${o.id}" type="number" data-option="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${numberValue(o.value)}" inputmode="decimal" ${describedBy(o.id, o.describedBy)}/><span class="unit" aria-hidden="true">mm</span></span>
    ${fieldNotes(o.id)}
  </div>`;
}

export interface SegmentOption { value: string | number; label: string; html?: string }
export interface SegmentedOptions {
  id: ControlId;
  legend: string;
  options: readonly SegmentOption[];
  value: string | number;
  /** Values are numbers (columns, rotation). */
  numeric?: boolean;
  hint?: string;
  name?: string;
  className?: string;
  /** Markup appended to the hint line. */
  hintExtra?: string;
  /** Markup placed after the hint and error lines, inside the fieldset. */
  after?: string;
}

/** Native radios styled as a segmented control. */
export function segmentedField(o: SegmentedOptions): string {
  const name = o.name ?? o.id;
  const segments = o.options.map(option => {
    const checked = String(option.value) === String(o.value) ? ' checked' : '';
    return `<label><input type="radio" name="${name}" value="${option.value}" data-option="${o.id}"${o.numeric ? ' data-numeric' : ''}${checked}/>`
      + `<span>${option.html ?? esc(option.label)}</span></label>`;
  }).join('');
  return `<fieldset class="segmented-field${o.className ? ` ${o.className}` : ''}" data-control="${o.id}" ${describedBy(o.id)}>
    <legend>${esc(o.legend)}</legend>
    <div class="segmented">${segments}</div>
    ${fieldNotes(o.id, o.hint, o.hintExtra)}${o.after ?? ''}
  </fieldset>`;
}

/* ───────────── Compact rows (text size and rotation) ───────────── */

/** Visible short label ("Size"); screen readers hear `spoken` ("Lid text size") instead. */
const shortLabel = (label: string, spoken?: string): string =>
  spoken ? `<span aria-hidden="true">${esc(label)}</span><span class="sr-only">${esc(spoken)}</span>` : esc(label);

export interface InlineSliderOptions extends SliderOptions {
  /** Full name for screen readers when the visible label is short. */
  spoken?: string;
}

/** One compact row: short label | range | number field with unit. */
export function inlineSliderField(o: InlineSliderOptions): string {
  const unit = o.unit ?? 'mm';
  const disabled = o.disabled ? ' disabled' : '';
  const value = numberValue(o.value);
  const name = o.spoken ?? o.label;
  return `<div class="inline-field inline-slider" data-control="${o.id}">
    <label for="${o.id}">${shortLabel(o.label, o.spoken)}<span class="sr-only"> (${unitName(unit)})</span></label>
    <input type="range" data-option="${o.id}" min="${o.min}" max="${o.max}" step="${o.step}" value="${value}" aria-label="${esc(name)} (${unitName(unit)})" ${describedBy(o.id)}${disabled}/>
    <span class="number-wrap"><input id="${o.id}" type="number" data-option="${o.id}" min="${o.min}" max="${o.max}" step="${unit === '%' ? 'any' : o.step}" value="${value}" inputmode="decimal" ${describedBy(o.id)}${disabled}/><span class="unit" aria-hidden="true">${unit}</span></span>
    ${fieldNotes(o.id, o.hint)}
  </div>`;
}

export interface InlineSegmentedOptions extends SegmentedOptions { spoken?: string }

/** One compact row: short label | segmented radios. */
export function inlineSegmentedField(o: InlineSegmentedOptions): string {
  const name = o.name ?? o.id;
  const segments = o.options.map(option => {
    const checked = String(option.value) === String(o.value) ? ' checked' : '';
    return `<label><input type="radio" name="${name}" value="${option.value}" data-option="${o.id}"${o.numeric ? ' data-numeric' : ''}${checked}/>`
      + `<span>${option.html ?? esc(option.label)}</span></label>`;
  }).join('');
  return `<div class="inline-field inline-segmented${o.className ? ` ${o.className}` : ''}" role="radiogroup" aria-labelledby="legend-${o.id}" data-control="${o.id}" ${describedBy(o.id)}>
    <span class="inline-label" id="legend-${o.id}">${shortLabel(o.legend, o.spoken)}</span>
    <div class="segmented">${segments}</div>
    ${fieldNotes(o.id, o.hint, o.hintExtra)}
  </div>`;
}

/** A text field with its compact Size (and Rotation) rows indented below it. */
export function textSettingField(text: TextOptions, rows: string): string {
  return `<div class="text-setting">${textField(text)}<div class="text-options">${rows}</div></div>`;
}

export interface SwitchOptions { id: ControlId; label: string; checked: boolean; hint?: string; badge?: string }

/** A real checkbox with role=switch inside the existing toggle-row structure. */
export function switchField(o: SwitchOptions): string {
  const badge = o.badge ? ` <span class="badge">${esc(o.badge)}</span>` : '';
  return `<div class="switch-field" data-control="${o.id}">
    <label class="toggle-row" for="${o.id}"><span>${esc(o.label)}${badge}</span><input id="${o.id}" type="checkbox" role="switch" data-option="${o.id}"${o.checked ? ' checked' : ''} ${describedBy(o.id)}/><span class="switch" aria-hidden="true"></span></label>
    ${fieldNotes(o.id, o.hint)}
  </div>`;
}

export interface TextOptions { id: ControlId; label: string; value: string; maxLength?: number; placeholder?: string }

export function textField(o: TextOptions): string {
  return `<div class="field" data-control="${o.id}">
    <label for="${o.id}">${esc(o.label)}</label>
    <input id="${o.id}" type="text" data-option="${o.id}" maxlength="${o.maxLength ?? 32}" placeholder="${esc(o.placeholder ?? 'No text')}" value="${esc(o.value)}" autocomplete="off" spellcheck="false" ${describedBy(o.id)}/>
    ${fieldNotes(o.id)}
  </div>`;
}

/* ───────────── Error text ───────────── */

/** validateConfig() field names → the labels shown in the settings tabs, with the unit for ranges. */
const FIELD_NAMES: Record<string, { label: string; unit?: 'mm' | '%' }> = {
  'Tray spacing': { label: 'Column spacing', unit: 'mm' },
  'Space between tray rows': { label: 'Row spacing', unit: 'mm' },
  'Tray height': { label: 'Height', unit: 'mm' },
  'Tray margin': { label: 'Edge margin', unit: 'mm' },
  'Tray width': { label: 'Width', unit: 'mm' },
  'Tray depth': { label: 'Depth', unit: 'mm' },
  'Lid text percentage': { label: 'Text size', unit: '%' },
  'Tray lid text': { label: 'Lid text' },
  'Side text': { label: 'Front text' },
  'Side text percentage': { label: 'Front text size', unit: '%' },
  'Dock title percentage': { label: 'Front text size', unit: '%' },
  'Dock spacing': { label: 'Column spacing', unit: 'mm' },
  'Dock row spacing': { label: 'Row spacing', unit: 'mm' },
  'Dock side margin': { label: 'Side margin', unit: 'mm' },
  'Dock depth margin': { label: 'Front & back margin', unit: 'mm' },
  'Dock height': { label: 'Base height', unit: 'mm' },
  'Dock title': { label: 'Front text' },
};

/**
 * A validateConfig() message as shown under the field: the field's own label, and a unit on ranges.
 * "Tray margin must be between 5 and 20." → "Edge margin must be between 5 and 20 mm."
 */
export function fieldErrorText(message: string): string {
  const match = /^(.+?) (?:must be|supports) /.exec(message);
  const field = match ? FIELD_NAMES[match[1]] : undefined;
  if (!match || !field) return message;
  const rest = message.slice(match[1].length);
  const range = field.unit ? /^ must be between (\S+) and (\S+)\.$/.exec(rest) : null;
  if (!range) return field.label + rest;
  return field.unit === '%'
    ? `${field.label} must be between ${range[1]}% and ${range[2]}%.`
    : `${field.label} must be between ${range[1]} and ${range[2]} mm.`;
}

/* ───────────── In-place updates ───────────── */

/** The inputs behind an error id: key labels use their element id, everything else data-option. */
export function controlInputs(root: ParentNode, id: ControlId): HTMLInputElement[] {
  if (id.startsWith('label-')) {
    const input = root.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
    return input ? [input] : [];
  }
  return [...root.querySelectorAll<HTMLInputElement>(`[data-option="${id}"]`)];
}

export function showFieldError(root: ParentNode, id: ControlId, message: string): void {
  const line = root.querySelector<HTMLElement>(`[data-error="${id}"]`);
  if (line) { line.textContent = message; line.hidden = false; }
  for (const input of controlInputs(root, id)) {
    input.setCustomValidity(message);
    input.setAttribute('aria-invalid', 'true');
  }
}

export function clearFieldError(root: ParentNode, id: ControlId): void {
  const line = root.querySelector<HTMLElement>(`[data-error="${id}"]`);
  if (line) { line.textContent = ''; line.hidden = true; }
  for (const input of controlInputs(root, id)) {
    input.setCustomValidity('');
    input.removeAttribute('aria-invalid');
  }
}

export function setHint(root: ParentNode, id: ControlId, hint: string): void {
  const line = root.querySelector<HTMLElement>(`[data-hint="${id}"]`);
  if (!line) return;
  const text = line.querySelector<HTMLElement>('[data-hint-text]') ?? line;
  if (text.textContent !== hint) text.textContent = hint;
  line.hidden = !hint;
}

/** Writes a config value into every input of a control (radios: the matching one is checked). */
export function setControlValue(root: ParentNode, id: ControlId, value: string | number | boolean): void {
  for (const input of controlInputs(root, id)) {
    if (input.type === 'radio') input.checked = input.value === String(value);
    else if (input.type === 'checkbox') input.checked = value === true;
    else input.value = typeof value === 'number' ? numberValue(value) : String(value);
  }
}

/* ───────────── Focus across re-renders ───────────── */

export interface FocusSnapshot { selectors: string[]; caret?: [number | null, number | null] }

/** Selectors that find the same control after its panel is re-rendered (first match wins). */
export function captureFocus(root: HTMLElement): FocusSnapshot | undefined {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !root.contains(el) || el === root) return undefined;
  const selectors: string[] = [];
  const attr = (name: string): string | null => el.getAttribute(name);
  const slot = el.closest<HTMLElement>('[data-slot]')?.dataset.slot;
  if (el.id.startsWith('label-')) selectors.push(`#${CSS.escape(el.id)}`);
  else if (attr('data-reorder')) selectors.push(`[data-reorder="${attr('data-reorder')}"]`);
  else if (attr('data-move-dir') && slot) {
    const other = attr('data-move-dir') === 'up' ? 'down' : 'up';
    selectors.push(`[data-slot="${slot}"] [data-move-dir="${attr('data-move-dir')}"]`, `[data-slot="${slot}"] [data-move-dir="${other}"]`);
  } else if (attr('data-occupied')) selectors.push(`[data-occupied="${attr('data-occupied')}"]`);
  else if (el.hasAttribute('data-template-switch')) selectors.push('[data-template-switch]:checked');
  else if (attr('data-option')) {
    const option = attr('data-option');
    const input = el as HTMLInputElement;
    if (input.type === 'radio') selectors.push(`[data-option="${option}"]:checked`);
    else selectors.push(`[data-option="${option}"][type="${input.type}"]`);
  } else if (attr('data-action')) selectors.push(`[data-action="${attr('data-action')}"]`);
  else if (el.matches('summary')) {
    const group = el.closest<HTMLElement>('[data-group]')?.dataset.group;
    if (group) selectors.push(`[data-group="${group}"] > summary`);
  }
  if (!selectors.length) return undefined;
  const caret = el instanceof HTMLInputElement && ['text', 'search'].includes(el.type)
    ? [el.selectionStart, el.selectionEnd] as [number | null, number | null] : undefined;
  return { selectors, caret };
}

const usable = (el: HTMLElement): boolean =>
  !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0;

/** Focuses the first usable match. Returns false when none was found. */
export function restoreFocus(root: HTMLElement, snapshot: FocusSnapshot | undefined): boolean {
  if (!snapshot) return false;
  for (const selector of snapshot.selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (!el || !usable(el)) continue;
    el.focus({ preventScroll: true });
    if (snapshot.caret && el instanceof HTMLInputElement) {
      try { el.setSelectionRange(snapshot.caret[0], snapshot.caret[1]); } catch { /* not a text input */ }
    }
    return true;
  }
  return false;
}
