import { inventoryTrayLayout, keyDimensions } from '../geometry';
import { resolvedTrayLayers } from '../geometry/layers';
import { icon, keyIcon } from '../icons';
import type { HolderConfig } from '../types';
import { esc, fmt } from './dom';

const DOCK_GLYPHS = 10;
const SLOT_WIDTH = 18.6;

export function lidThumbnail(config: HolderConfig): string {
  const { width: w, depth: d } = inventoryTrayLayout(config);
  const text = config.options.tray.lidText;
  return `<svg class="thumb" viewBox="${fmt(-w / 2 - 2)} ${fmt(-d / 2 - 2)} ${fmt(w + 4)} ${fmt(d + 4)}" aria-hidden="true" focusable="false">
    <rect class="thumb-footprint" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" rx="3"/>
    <rect class="thumb-slot" x="${fmt(-w / 2 + 4)}" y="${fmt(-d / 2 + 4)}" width="${fmt(Math.max(1, w - 8))}" height="${fmt(Math.max(1, d - 8))}" rx="2"/>
    ${text ? `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" fill="currentColor" font-size="${fmt(Math.min(d / 4, w / (text.length + 2)))}">${esc(text)}</text>` : ''}</svg>`;
}

function emptyThumbnail(kind: 'tray' | 'dock', size = { width: 96, depth: 64 }): string {
  const { width: w, depth: d } = size;
  return `<span class="thumb-empty"><svg class="thumb" viewBox="${fmt(-w / 2 - 2)} ${fmt(-d / 2 - 2)} ${fmt(w + 4)} ${fmt(d + 4)}" aria-hidden="true" focusable="false">`
    + `<rect class="thumb-footprint is-empty" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" rx="3"/></svg>${icon(kind)}</span>`;
}

/**
 * Schematic thumbnail drawn from the config (no raster, no storage).
 * Trays: footprint plus one rect per slot (hidden-in-preview slots dashed). Docks: up to 10 key glyphs, then "+N".
 */
export function projectThumbnail(config: HolderConfig): string {
  if (config.template === 'desktop_dock') {
    if (!config.slots.length) return emptyThumbnail('dock');
    const extra = config.slots.length - DOCK_GLYPHS;
    return `<span class="thumb-dock">${config.slots.slice(0, DOCK_GLYPHS).map(s => keyIcon(s.type)).join('')}`
      + `${extra > 0 ? `<span class="thumb-more">+${extra}</span>` : ''}</span>`;
  }
  config = resolvedTrayLayers(config)[0].config;
  if (!config.slots.length) return emptyThumbnail('tray', config.options.tray.footprint ?? undefined);
  const layout = inventoryTrayLayout(config);
  const w = layout.width, d = layout.depth;
  const slots = config.slots.map((slot, i) => {
    const [x, y] = layout.xy[i];
    const h = keyDimensions[slot.type].pocketLength;
    return `<rect class="thumb-slot${slot.occupied ? '' : ' is-hidden'}" x="${fmt(x - SLOT_WIDTH / 2)}" y="${fmt(-y - h / 2)}" width="${SLOT_WIDTH}" height="${fmt(h)}" rx="1.5"${slot.rotation === 90 ? ` transform="rotate(-90 ${fmt(x)} ${fmt(-y)})"` : ''}/>`;
  }).join('');
  return `<svg class="thumb thumb-tray" viewBox="${fmt(-w / 2 - 2)} ${fmt(-d / 2 - 2)} ${fmt(w + 4)} ${fmt(d + 4)}" aria-hidden="true" focusable="false">`
    + `<rect class="thumb-footprint" x="${fmt(-w / 2)}" y="${fmt(-d / 2)}" width="${fmt(w)}" height="${fmt(d)}" rx="3"/>${slots}</svg>`;
}
