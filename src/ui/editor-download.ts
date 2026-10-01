/**
 * Download dialog (#download-dialog) and Add keys dialog (#key-dialog) markup. The editor fills
 * in parts, tips and labels from the pure helpers in editor-status.ts.
 */
import { icon } from '../icons';
import { dialogHeading } from './app-dialogs';
import { DOCK_NOTICE } from './editor-settings';

const FORMATS = [
  { value: '3mf', title: 'Print project', description: 'Settings included for Bambu Studio and OrcaSlicer' },
  { value: 'stl', title: '3D model', description: 'Set infill and walls in your slicer' },
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
      <p class="chip-row"><span class="chip">Recommended: 100% scale · 5% infill · Arachne walls</span></p>
      <label class="field" id="download-part-field" for="download-part" hidden>Parts<select id="download-part"></select></label>
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
