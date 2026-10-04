/**
 * Download dialog (#download-dialog) and Add keys dialog (#key-dialog) markup. The editor fills
 * in parts, tips and labels from the pure helpers in editor-status.ts.
 */
import { icon } from '../icons';
import { dialogHeading } from './app-dialogs';
import { DOCK_NOTICE } from './editor-settings';
import { traySetItems } from '../geometry/layers';
import type { HolderConfig } from '../types';
import { esc, plural } from './dom';
import { projectThumbnail, lidThumbnail } from './organizer-thumbnail';

export function downloadLayersMarkup(config: HolderConfig): string {
  if (config.template !== 'inventory_tray') return '';
  const items = traySetItems(config).reverse();
  if (items.length < 2) return '';
  return `<fieldset class="download-layers"><legend>Layers to download</legend>
    <label class="download-all"><input type="checkbox" id="download-all-layers" checked/>All layers</label>
    <div class="download-layer-list">${items.map(item => `<label class="download-layer-row">
      <input type="checkbox" data-download-part="${item.id}" checked aria-label="Download ${esc(item.name)}"/>
      <span class="layer-thumbnail" aria-hidden="true">${item.kind === 'lid' ? lidThumbnail(item.config) : projectThumbnail(item.config)}</span>
      <span class="layer-copy"><strong>${esc(item.name)}</strong><small>${item.kind === 'lid' ? 'Lid' : plural(item.config.slots.length, 'key')}</small></span>
    </label>`).join('')}</div></fieldset>`;
}

const FORMATS = [
  { value: '3mf', title: 'Print project', description: 'Per-object settings for Bambu Studio and OrcaSlicer' },
  { value: 'stl', title: '3D model', description: 'Set infill, walls and brim in your slicer' },
  { value: 'scad', title: 'Editable source', description: 'Open and customize in OpenSCAD' },
] as const;

export function downloadDialogMarkup(): string {
  const formats = FORMATS.map((f, i) => `<label class="option-card format-card">
      <input type="radio" name="format" value="${f.value}"${i === 0 ? ' checked' : ''}/>
      <span class="option-title"><span class="format-tag">${f.value.toUpperCase()}</span>${f.title}</span>
      <small>${f.description}</small>
    </label>`).join('');
  return `<dialog id="download-dialog" class="dialog download-dialog" aria-labelledby="download-title">
    ${dialogHeading('download-title', 'Download')}
    <div class="dialog-body">
      <section class="print-settings" aria-labelledby="print-settings-title">
        <h3 id="print-settings-title">Recommended print settings</h3>
        <dl>
          <div><dt>Scale</dt><dd>100%</dd></div>
          <div><dt>Sparse infill</dt><dd>5%</dd></div>
          <div><dt>Wall generator</dt><dd>Arachne</dd></div>
          <div><dt>Brim type</dt><dd>Outer brim</dd></div>
        </dl>
      </section>
      <div id="download-layers"></div>
      <fieldset class="format-options"><legend class="sr-only">File format</legend>${formats}</fieldset>
      <p id="tray-print-tip" class="callout" hidden></p>
      <p id="dock-print-tip" class="callout warn" hidden>${icon('alert')}<span>${DOCK_NOTICE}</span></p>
      <details id="assembly-notes" class="assembly-notes" hidden><summary>${icon('down')}Assembly notes</summary><p id="tray-lock-tip"></p></details>
      <div id="download-state" class="callout" hidden></div>
      <p id="format-note" class="field-hint"></p>
    </div>
    <div class="dialog-footer">
      <button type="button" class="text-button" data-action="backup">${icon('file')}Save project file (.json)</button>
      <button type="button" class="button primary" id="download-file">${icon('download')}<span id="download-file-label">Download 3MF</span></button>
    </div>
    <div id="download-result" class="download-result" role="status" hidden></div>
    <p id="download-announcer" class="sr-only" role="status" aria-live="polite"></p>
  </dialog>`;
}

export function keyDialogMarkup(): string {
  return `<dialog id="key-dialog" class="dialog key-dialog" aria-labelledby="key-dialog-title">
    ${dialogHeading('key-dialog-title', 'Add keys')}
    <label class="search-field">${icon('search')}<input type="search" id="key-search" placeholder="Search model or connector" aria-label="Search keys" autocomplete="off"/></label>
    <div id="key-catalog" class="key-catalog"></div>
    <div class="dialog-footer"><span id="catalog-total" class="catalog-total" role="status"></span><button type="button" class="button primary" data-action="close-dialog">Done</button></div>
  </dialog>`;
}
