import { MAX_LAYERS } from '../config';
import { icon } from '../icons';
import { traySetItems } from '../geometry/layers';
import { projectThumbnail, lidThumbnail } from './organizer-thumbnail';
import type { HolderConfig } from '../types';
import { esc, plural } from './dom';

export function layersPanelMarkup(project: HolderConfig, active: number, overview: boolean, lid = false, draggable = true): string {
  const items = traySetItems(project), trays = items.filter(item => item.kind === 'tray');
  const topHasLid = items.at(-1)?.kind === 'lid';
  return `<div class="layers-heading"><strong>${icon('layers')}Layers <span class="tab-count">${items.length}</span></strong>
    <button type="button" class="button secondary compact" data-action="all-layers" aria-pressed="${overview}"${items.length < 2 ? ' disabled' : ''}>All layers</button></div>
    <p id="layer-reorder-help" class="sr-only">Drag to reorder trays, or use Arrow Up and Arrow Down on the handle. The lid always stays on top. The actions menu also has move controls.</p>
    <ol class="layer-list" aria-label="Tray layers, top to bottom">${[...items].reverse().map(item => {
      const isLid = item.kind === 'lid', selected = !overview && item.layerIndex === active && isLid === lid;
      return `<li class="layer-row${selected ? ' is-active' : ''}"${isLid ? ' data-pinned-lid' : ` data-layer-row="${item.layerIndex}"${draggable && trays.length > 1 ? ' draggable="true"' : ''}`}>
        ${!isLid && trays.length > 1 ? `<button type="button" class="drag-handle" data-reorder-layer="${item.layerIndex}" aria-label="Reorder ${esc(item.name)}" aria-describedby="layer-reorder-help">${icon('grip')}</button>` : ''}
        <button type="button" class="layer-select" data-layer="${item.layerIndex}"${isLid ? ' data-lid="true"' : ''} aria-pressed="${selected}" aria-label="Edit ${esc(item.name)}">
          <span class="layer-thumbnail" aria-hidden="true">${isLid ? lidThumbnail(item.config) : projectThumbnail(item.config)}</span>
          <span class="layer-copy"><strong>${esc(item.name)}</strong><small>${isLid ? `${item.config.options.tray.lidStyle === 'minimal' ? 'Minimal' : 'Regular'} lid · Top` : `${plural(item.config.slots.length, 'key')}${item.layerIndex === 0 ? ' · Bottom' : item.layerIndex === trays.length - 1 ? ' · Top tray' : ''}`}</small></span>
        </button><button type="button" class="icon-button" ${isLid ? 'data-lid-menu' : 'data-layer-menu'}="${item.layerIndex}" aria-label="Actions for ${esc(item.name)}" aria-haspopup="menu">${icon('more')}</button>
      </li>`;
    }).join('')}</ol>
    <div class="layer-add-actions"><button type="button" class="button secondary add-layer-button" data-action="new-layer"${trays.length >= MAX_LAYERS ? ' disabled' : ''}>${icon('plus')}Add tray</button>
      ${!topHasLid ? `<button type="button" class="button secondary" data-action="new-lid">${icon('plus')}Add lid</button>` : ''}</div>
    <p class="field-hint layer-hint">Tray size, connection and slide direction apply to the whole project. The lid always stays on top. Select a tray or lid to edit it.</p>`;
}
