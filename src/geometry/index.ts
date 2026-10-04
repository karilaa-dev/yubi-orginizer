import type { HolderConfig, KeyPlacement, KeyType, PartSpec, ProjectGeometry, Slot, Vec3 } from '../types';
import { scadCall, FRONT_TEXT_FIT, TRAY_RETENTION, TRAY_STACK, TRAY_STACK_PILLAR, TRAY_LID, KEY_LABEL_LAYOUT, trayRetentionBounds } from './library';
import { lidExplodeOffset } from '../preview-layout';
import { CI_INVENTORY_TOUCH_RELIEF } from './ci-touch';
import { traySlideDirection } from '../tray-slide';
import { H20_V7 } from './tray-h20';
import { TRAY_SNAP } from './tray-snap';
import { trayStackGap } from './tray-stack';
import { packRectangles } from './packing';
export { trayStackGap } from './tray-stack';
export { buildKeyScad } from './keys';
export { TRAY_STACK } from './library';

/** Identically sized trays register at the same XY origin. The locating lip
 * nests into a narrow underside groove with a 0.3mm visible exterior seam. */
export function trayStackPitch(height: number, retention = true): number { return height + trayStackGap(retention); }
export function traySnapEnabled(config: HolderConfig): boolean {
  return config.template === 'inventory_tray' && config.options.tray.connection === 'snap_fit';
}
export function trayH20Enabled(config: HolderConfig): boolean {
  return config.template === 'inventory_tray' && config.options.tray.connection === 'h20_slide_v7';
}
export function trayRetentionSpec(type: KeyType) {
  const spec = TRAY_RETENTION[type];
  return { ...spec, peakHeight: 1.25 };
}

export const keyDimensions: Record<KeyType, { length: number; thickness: number; pocketLength: number; socketDepth: number }> = {
  A: { length: 45, thickness: 3.7, pocketLength: 45.6, socketDepth: 8.5 },
  C: { length: 45, thickness: 3.75, pocketLength: 45.6, socketDepth: 6.6 },
  AN: { length: 13, thickness: 3.1, pocketLength: 13.7, socketDepth: 5 },
  CN: { length: 10.1, thickness: 7, pocketLength: 10.8, socketDepth: 4.2 },
  CK: { length: 29.5, thickness: 5, pocketLength: 30.6, socketDepth: 6.6 },
  CI: { length: 40.3, thickness: 5, pocketLength: 41.6, socketDepth: 6.6 },
};

const zero = (): Vec3 => [0, 0, 0];
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
type Point = [number, number];

/** Shared conservative text envelopes match the SCAD placement functions.
 * Scaling moves a label away from its pocket by its added half-height. */
export function keyLabelMetrics(config: HolderConfig) {
  const scale = clamp(config.labelSize ?? KEY_LABEL_LAYOUT.baseSize, 1.5, 4) / KEY_LABEL_LAYOUT.baseSize;
  return {
    scale,
    halfHeight: KEY_LABEL_LAYOUT.baseHalfHeight * scale,
    edgeOffset: KEY_LABEL_LAYOUT.baseEdgeOffset + KEY_LABEL_LAYOUT.baseHalfHeight * (scale - 1),
  };
}

function part(id: string, name: string, scad: string, position: Vec3 = zero(), color = '#36566a', rotation: Vec3 = zero(), explode: Vec3 = zero()): PartSpec {
  return { id, name, scad, position, rotation, explode, color };
}

function labels(config: HolderConfig, slots = config.slots): string[] {
  return slots.map((slot) => config.labels ? slot.label.slice(0, 18) : '');
}

function columnsFor(n: number, requested: number): number {
  if (requested > 0) return Math.min(n, Math.round(clamp(requested, 1, 6)));
  return Math.ceil(n / Math.ceil(n / 6));
}

function layout(n: number, columns: number, pitchX: number, pitchY: number, yOffset = 0): Point[] {
  const rows = Math.ceil(n / columns);
  return Array.from({ length: n }, (_, i) => [
    (i % columns - (columns - 1) / 2) * pitchX,
    (Math.floor(i / columns) - (rows - 1) / 2) * pitchY + yOffset,
  ]);
}

function keyPlacement(slot: Slot, x: number, y: number, top: number, flat: boolean, partId: string): KeyPlacement {
  const d = keyDimensions[slot.type];
  if (flat) {
    const turned = slot.rotation === 90;
    return { slotId: slot.id, type: slot.type, partId,
      position: [x + (turned ? d.length / 2 : 0), y - (turned ? 0 : d.length / 2), top - (d.thickness - 0.4) + d.thickness / 2],
      rotation: [0, 0, turned ? Math.PI / 2 : 0] };
  }
  const reverse = slot.type === 'AN' || slot.type === 'CN' || slot.type === 'CK' || slot.type === 'CI';
  return { slotId: slot.id, type: slot.type, partId, position: [x, y, top - d.socketDepth + (reverse ? d.length : 0)], rotation: [Math.PI / 2, 0, reverse ? Math.PI : 0] };
}

function placements(slots: Slot[], xy: Point[], top: number, flat: boolean, partId: string): KeyPlacement[] {
  return slots.flatMap((slot, i) => slot.occupied ? [keyPlacement(slot, xy[i][0], xy[i][1], top, flat, partId)] : []);
}

/** Full pocket, scoop, label and retention envelope, rotated around the pocket center. */
export function traySlotEnvelope(config: HolderConfig, slot: Slot) {
  const rear = keyDimensions[slot.type].pocketLength / 2;
  const scoop = { radius: { small: 5, default: 6, large: 7 }[config.options.tray.scoop], centerY: rear };
  const label = config.labels && slot.label.trim().length > 0;
  const metrics = keyLabelMetrics(config);
  let front = rear + (label ? metrics.edgeOffset + metrics.halfHeight : 0), back = scoop.centerY + scoop.radius;
  let side = Math.max(TRAY_RETENTION[slot.type].pocketHalfWidth, scoop.radius,
    slot.type === 'CI' ? CI_INVENTORY_TOUCH_RELIEF.outerHalfWidth : 0,
    label ? Math.min(config.options.tray.spacing - 4, 24) / 2 : 0);
  if ((config.options.tray.retention ?? true)) {
    const b = trayRetentionBounds(slot.type);
    front = Math.max(front, -b.minY); back = Math.max(back, b.maxY); side = Math.max(side, b.maxX);
  }
  return slot.rotation === 90
    ? { minX: -back, maxX: front, minY: -side, maxY: side }
    : { minX: -side, maxX: side, minY: -front, maxY: back };
}

/** Inventory rows use the actual pocket, finger-access, and label envelopes.
 * rowGap is the free space between those envelopes, rather than a fixed pitch
 * that forces Nano keys into full-length rows. */
export function inventoryTrayLayout(config: HolderConfig) {
  const n = config.slots.length;
  const columns = n ? columnsFor(n, config.options.tray.columns) : 0;
  const spacing = clamp(config.options.tray.spacing, 24, 42);
  const margin = Math.max(clamp(config.options.tray.margin, 5, 20), traySnapEnabled(config) ? TRAY_SNAP.margin : 0);
  const h20 = trayH20Enabled(config);
  const verticalSlide = h20 && traySlideDirection(config.options.tray.slideDirection).angle % 180 !== 0;
  // Only the two receiver edges need the broad reserved border. The other
  // edges follow the user's ordinary margin instead of wasting another 16 mm.
  const marginX = h20 && verticalSlide ? Math.max(margin, H20_V7.margin) : margin;
  const marginY = h20 && !verticalSlide ? Math.max(margin, H20_V7.margin) : margin;
  const rowGap = clamp(config.options.tray.rowGap ?? 4, 2, 40);
  const height = clamp(config.options.tray.height, traySnapEnabled(config) ? TRAY_SNAP.minimumHeight : 8.6, 20);
  const scoopRadius = { small: 5, default: 6, large: 7 }[config.options.tray.scoop];
  const envelopes = config.slots.map(slot => traySlotEnvelope(config, slot));
  const rows: { center: number; front: number; back: number; minY: number; maxY: number }[] = [];
  let end = 0;
  for (let start = 0; start < n; start += columns) {
    const row = envelopes.slice(start, start + columns);
    const front = Math.max(...row.map(e => -e.minY));
    const back = Math.max(...row.map(e => e.maxY));
    const center = end + (rows.length ? rowGap : 0) + front;
    rows.push({ center, front, back, minY: center - front, maxY: center + back });
    end = center + back;
  }
  for (const row of rows) { row.center -= end / 2; row.minY -= end / 2; row.maxY -= end / 2; }
  const rotated = config.slots.some(s => s.rotation === 90);
  const colLeft = Array.from({ length: columns }, (_, col) => Math.max(9.3, ...envelopes.filter((_, i) => i % columns === col).map(e => -e.minX)));
  const colRight = Array.from({ length: columns }, (_, col) => Math.max(9.3, ...envelopes.filter((_, i) => i % columns === col).map(e => e.maxX)));
  const colX: number[] = [];
  for (let col = 0; col < columns; col++) colX.push(col ? colX[col - 1] + (rotated ? Math.max(spacing, colRight[col - 1] + colLeft[col] + 2) : spacing) : 0);
  const left = colLeft[0] ?? 0, right = (colX.at(-1) ?? 0) + (colRight.at(-1) ?? 0);
  const centerX = rotated ? (right - left) / 2 : (columns - 1) * spacing / 2;
  let xy: Point[] = config.slots.map((_, i) => [colX[i % columns] - centerX, rows[Math.floor(i / columns)].center]);
  const packed = config.options.tray.arrangement === 'compact' && n ? packedTray(config) : undefined;
  if (packed) {
    xy = packed.items.map((p, i): Point => [p.x - packed.width / 2 - envelopes[i].minX, p.y - packed.height / 2 - envelopes[i].minY]);
    end = packed.height;
    rows.splice(0, rows.length, ...packed.items.map(p => ({ center: p.y + p.height / 2 - end / 2, front: p.height / 2, back: p.height / 2,
      minY: p.y - end / 2, maxY: p.y + p.height - end / 2 })).sort((a, b) => a.center - b.center));
  }
  const baseWidth = n ? Math.ceil((packed ? packed.width : rotated ? left + right : (columns - 1) * spacing + 18.6) + 2 * marginX) : 0;
  const storageHalfWidth = Math.max(0, ...envelopes.map((e, i) => Math.max(-xy[i][0] - e.minX, xy[i][0] + e.maxX)));
  const emptyFixed = !n && config.options.tray.footprint !== null;
  const requiredWidth = n ? Math.max(baseWidth, trayH20Enabled(config) ? (verticalSlide ? H20_V7.minimumDepth : H20_V7.minimumWidth) : 0,
    verticalSlide ? Math.ceil(2 * (storageHalfWidth + marginX)) : 0) : emptyFixed
    ? h20 ? (verticalSlide ? H20_V7.minimumDepth : H20_V7.minimumWidth) : traySnapEnabled(config) ? Math.ceil(18.6 + 2 * marginX) : 20 : 0;
  const pocketDepth = n ? (rotated || packed ? Math.ceil((end + 2 * marginY) * 100 - 1e-8) : Math.round((end + 2 * marginY) * 100)) / 100 : 0;
  const requiredDepth = n || emptyFixed ? Math.max(pocketDepth, traySnapEnabled(config) ? TRAY_SNAP.minimumDepth : trayH20Enabled(config) ? (verticalSlide ? H20_V7.minimumWidth : H20_V7.minimumDepth) : emptyFixed ? 20 : 0) : 0;
  const locked = config.options.tray.footprint;
  return {
    xy, rows, rowGap, columns,
    width: locked?.width ?? requiredWidth,
    depth: locked?.depth ?? requiredDepth,
    requiredWidth, requiredDepth,
    height, scoopRadius, labelWidth: Math.min(spacing - 4, 24),
  };
}

function packedTray(config: HolderConfig, rotate = false) {
  const tray = config.options.tray;
  const margin = Math.max(tray.margin, traySnapEnabled(config) ? TRAY_SNAP.margin : 5);
  const vertical = trayH20Enabled(config) && traySlideDirection(tray.slideDirection).angle % 180 !== 0;
  const marginX = vertical ? Math.max(margin, H20_V7.margin) : margin;
  const marginY = trayH20Enabled(config) && !vertical ? Math.max(margin, H20_V7.margin) : margin;
  const envelopes = config.slots.map(s => traySlotEnvelope(config, s));
  return packRectangles(envelopes.map(e => ({ width: e.maxX - e.minX, height: e.maxY - e.minY })), {
    gapX: Math.max(2, tray.spacing - 22), gapY: tray.rowGap, marginX, marginY, rotate,
    ...(tray.footprint ? { available: { width: tray.footprint.width, height: tray.footprint.depth } } : {}),
  });
}

/** Rotate and repack this layer; the normal Columns control returns to a row grid. */
export function compactTray(config: HolderConfig): HolderConfig {
  if (config.template !== 'inventory_tray' || !config.slots.length) return config;
  const next = structuredClone(config);
  const packed = packedTray(config, true);
  next.options.tray.arrangement = 'compact';
  next.slots.forEach((s, i) => { if (packed.items[i].turned) s.rotation = s.rotation === 90 ? 0 : 90; });
  // Also try packing the current orientations. Never replace a smaller existing arrangement.
  const unrotated = structuredClone(config); unrotated.options.tray.arrangement = 'compact';
  const score = (c: HolderConfig) => {
    const t = inventoryTrayLayout(c), fixed = c.options.tray.footprint;
    return (fixed ? Math.max(0, t.requiredWidth - fixed.width) + Math.max(0, t.requiredDepth - fixed.depth) : 0) * 1e9
      + t.requiredWidth * t.requiredDepth;
  };
  let best = [config, unrotated, next].reduce((best, c) => score(c) < score(best) ? c : best);
  // Refine by key model too: a short Nano row can fill space beside a long vertical key.
  for (let pass = 0; pass < 2; pass++) for (const type of new Set(config.slots.map(s => s.type))) {
    const candidate = structuredClone(best);
    candidate.options.tray.arrangement = 'compact';
    candidate.slots.forEach(s => { if (s.type === type) s.rotation = s.rotation === 90 ? 0 : 90; });
    if (score(candidate) < score(best)) best = candidate;
  }
  return best;
}

export function trayFootprintError(config: HolderConfig): string | undefined {
  if (config.template !== 'inventory_tray' || !config.options.tray.footprint) return;
  const t = inventoryTrayLayout(config);
  if (t.width + .00001 < t.requiredWidth || t.depth + .00001 < t.requiredDepth) {
    return `${config.slots.length ? 'These keys and layout need' : 'This tray connection needs'} at least ${t.requiredWidth} × ${t.requiredDepth} mm. Increase the locked tray dimensions or adjust the layout.`;
  }
}

/** Sparse bearing posts sit in clear inter-row space, outside all working
 * features. Circle-to-rectangle distance keeps narrow diagonal gaps usable. */
export function inventoryTraySupports(config: HolderConfig, t = inventoryTrayLayout(config)): Point[] {
  if (!(config.options.tray.connection !== 'none' || config.options.tray.lid) || t.rows.length < 2) return [];
  const radius = TRAY_STACK_PILLAR.diameter / 2;
  const clearanceRadius = radius + TRAY_STACK_PILLAR.clearance;
  const inside = (traySnapEnabled(config) ? TRAY_SNAP.margin : trayH20Enabled(config) ? H20_V7.margin : TRAY_STACK.rimWidth) + clearanceRadius;
  const maxX = t.width / 2 - inside, maxY = t.depth / 2 - inside;
  if (maxX <= 0 || maxY <= 0) return [];
  const rectangles: { x: number; y: number; halfX: number; halfY: number }[] = [];
  const scoops: { x: number; y: number; radius: number }[] = [];
  const labelMetrics = keyLabelMetrics(config);
  for (const [i, slot] of config.slots.entries()) {
    const [x, y] = t.xy[i];
    const rectStart = rectangles.length, scoopStart = scoops.length;
    const half = keyDimensions[slot.type].pocketLength / 2;
    rectangles.push({ x, y, halfX: TRAY_RETENTION[slot.type].pocketHalfWidth, halfY: half });
    const rear = keyDimensions[slot.type].pocketLength / 2;
    if (slot.type === 'CI') rectangles.push({ x, y: y + CI_INVENTORY_TOUCH_RELIEF.centerY, halfX: CI_INVENTORY_TOUCH_RELIEF.outerHalfWidth, halfY: CI_INVENTORY_TOUCH_RELIEF.length / 2 });
    const scoop = { centerY: half, radius: t.scoopRadius };
    scoops.push({ x, y: y + scoop.centerY, radius: scoop.radius });
    if (config.labels && slot.label.trim()) rectangles.push({ x, y: y - rear - labelMetrics.edgeOffset, halfX: t.labelWidth / 2, halfY: labelMetrics.halfHeight });
    if (config.options.tray.retention) {
      const b = trayRetentionBounds(slot.type);
      rectangles.push({ x, y: y + (b.minY + b.maxY) / 2, halfX: b.maxX, halfY: (b.maxY - b.minY) / 2 });
    }
    if (slot.rotation === 90) {
      for (const r of rectangles.slice(rectStart)) {
        const dx = r.x - x, dy = r.y - y;
        r.x = x - dy; r.y = y + dx;
        [r.halfX, r.halfY] = [r.halfY, r.halfX];
      }
      for (const s of scoops.slice(scoopStart)) {
        const dx = s.x - x, dy = s.y - y;
        s.x = x - dy; s.y = y + dx;
      }
    }
  }
  const clear = ([x, y]: Point) => Math.abs(x) <= maxX && Math.abs(y) <= maxY
    && rectangles.every((r) => Math.hypot(Math.max(0, Math.abs(x - r.x) - r.halfX), Math.max(0, Math.abs(y - r.y) - r.halfY)) >= clearanceRadius)
    && scoops.every(s => Math.hypot(x - s.x, y - s.y) >= s.radius + clearanceRadius);
  const gapYs = t.rows.slice(0, -1).map((row, i) => (row.maxY + t.rows[i + 1].minY) / 2);
  // Include exact center and column gaps, then a small search grid when an
  // asymmetric key/label envelope makes those ideal positions unavailable.
  const xs = new Set<number>([0]);
  for (let col = 1; col < t.columns; col++) xs.add((col - t.columns / 2) * config.options.tray.spacing);
  for (let x = 2; x <= maxX; x += 2) { xs.add(x); xs.add(-x); }
  const candidates = gapYs.flatMap((y) => [...xs].map((x): Point => [x, y])).filter(clear);
  const count = Math.min(TRAY_STACK_PILLAR.maxCount, Math.ceil(Math.max(t.width, t.depth) / TRAY_STACK_PILLAR.spanPerSupport));
  const alongX = t.width >= t.depth;
  const supports: Point[] = [];
  for (let i = 0; i < count; i++) {
    const axis = ((i + 0.5) / count - 0.5) * (alongX ? t.width : t.depth);
    const target: Point = alongX ? [axis, 0] : [0, axis];
    const available = candidates.filter(([x, y]) => supports.every(([px, py]) => Math.hypot(x - px, y - py) >= TRAY_STACK_PILLAR.minSeparation));
    available.sort((a, b) => Math.hypot(a[0] - target[0], a[1] - target[1]) - Math.hypot(b[0] - target[0], b[1] - target[1]));
    if (available[0]) supports.push(available[0].map((v) => Math.round(v * 1000) / 1000) as Point);
  }
  return supports;
}

/** Front-text size as a named SCAD argument. Omitted without text, and for projects saved without a size, so their SCAD is unchanged. */
const frontTextArgs = (name: string, text: string, percent: number | undefined): Record<string, number> =>
  percent === undefined || !text.slice(0, 32).length ? {} : { [name]: percent };

/** The largest front text that fits the wall, as in front_title_cut. */
export function frontTextMaxSize(text: string, width: number, height: number): number {
  const length = Math.max(1, [...text.slice(0, 32)].length);
  return Math.max(0, Math.min((width - FRONT_TEXT_FIT.sideInset) / (length * FRONT_TEXT_FIT.charWidth), height - FRONT_TEXT_FIT.verticalClearance));
}

/** Front text of the current organizer type: its engraved size, and that size as a percentage of what fits
 * (for projects saved without a percentage, the one that matches their original size). */
export function frontTextFit(config: HolderConfig): { text: string; percent: number; size: number } {
  const dock = config.template === 'desktop_dock';
  const text = dock ? config.options.dock.title : config.options.tray.sideText;
  const saved = dock ? config.options.dock.titlePercent : config.options.tray.sideTextPercent;
  const box = dock ? dockLayout(config) : inventoryTrayLayout(config);
  const max = config.slots.length || box.width ? frontTextMaxSize(text, box.width, box.height) : 0;
  if (saved !== undefined) return { text, percent: saved, size: max * saved / 100 };
  const size = Math.min(FRONT_TEXT_FIT.legacySize, max);
  return { text, percent: max > 0 ? Math.round(size / max * 1000) / 10 : 100, size };
}

function trayScad(config: HolderConfig, t: ReturnType<typeof inventoryTrayLayout>): string {
  const args: unknown[] = [config.slots.map((s) => s.type), labels(config), t.xy, t.width, t.depth, t.height, t.scoopRadius, t.labelWidth,
    config.options.tray.retention ?? true, config.options.tray.connection !== 'none', (config.options.tray.sideText ?? '').slice(0, 32), inventoryTraySupports(config),
    keyLabelMetrics(config).scale, config.options.tray.lid ?? false];
  if (trayH20Enabled(config)) args.push(traySlideDirection(config.options.tray.slideDirection).angle);
  return scadCall(traySnapEnabled(config) ? 'inventory_tray_snap' : trayH20Enabled(config) ? 'inventory_tray_h20' : 'inventory_tray', args,
    { ...frontTextArgs('side_text_percent', config.options.tray.sideText, config.options.tray.sideTextPercent),
      ...(config.slots.some(s => s.rotation === 90) ? { rotations: config.slots.map(s => s.rotation ?? 0) } : {}) });
}

/** A slide-lock layer's move from flush back to its entry position (the reverse of locking). */
export function traySlideRelease(config: HolderConfig): Vec3 {
  const [x, y] = traySlideDirection(config.options.tray.slideDirection).releaseAxis;
  return [x * H20_V7.travel, y * H20_V7.travel, 0];
}

/** Desktop dock footprint and socket positions. */
export function dockLayout(config: HolderConfig) {
  const n = Math.max(1, config.slots.length);
  const cols = columnsFor(n, config.options.dock.columns);
  const rows = Math.ceil(n / cols);
  const spacing = clamp(config.options.dock.spacing, 22, 40);
  const rowSpacing = clamp(config.options.dock.rowSpacing ?? 45, 18, 70);
  const edgeMargin = clamp(config.options.dock.edgeMargin ?? 18, 12, 40);
  const depthMargin = clamp(config.options.dock.depthMargin ?? 22.5, 18, 45);
  return {
    columns: cols, height: clamp(config.options.dock.height, 11, 25),
    width: (cols - 1) * spacing + 2 * edgeMargin, depth: (rows - 1) * rowSpacing + 2 * depthMargin,
    xy: layout(config.slots.length, cols, spacing, rowSpacing, 3),
  };
}

/** Every part is a printable millimetre-space solid at Z=0. Assembly transforms
 * are separate from its SCAD source. Three.js only displays these generated meshes. */
export function buildProject(config: HolderConfig): ProjectGeometry {
  if (!config.slots.length && !(config.template === 'inventory_tray' && config.options.tray.footprint)) return { parts: [], keys: [], dimensions: zero() };
  const n = config.slots.length;
  const types = config.slots.map((s) => s.type);
  const ls = labels(config);
  const labelHeight = ls.some((s) => s.trim().length > 0) ? 0.35 : 0;
  switch (config.template) {
    case 'desktop_dock': {
      const { width: w, depth: d, height: h, xy } = dockLayout(config);
      // These three products share the same calibrated standard USB-C socket.
      // Normalize only the cutter IDs; labels and preview references retain the
      // user's selected model, including the high-Y USB-C end of 5C and 5Ci.
      const socketTypes = types.map((type) => type === 'CK' || type === 'CI' ? 'C' : type);
      return {
        parts: [part('dock', 'Desktop dock', scadCall('dock', [socketTypes, ls, xy, w, d, h, config.options.dock.title.slice(0, 32), keyLabelMetrics(config).scale],
          frontTextArgs('title_percent', config.options.dock.title, config.options.dock.titlePercent)))],
        keys: placements(config.slots, xy, h, false, 'dock'),
        dimensions: [w, d, h + labelHeight],
      };
    }
    case 'inventory_tray': {
      const footprintError = trayFootprintError(config);
      if (footprintError) throw new Error(footprintError);
      const t = inventoryTrayLayout(config);
      const retentionHeight = (config.options.tray.retention ?? true) ? Math.max(0, ...types.map((type) => trayRetentionSpec(type).peakHeight)) : 0;
      const hasLid = config.options.tray.lid ?? false;
      const snap = traySnapEnabled(config);
      const h20 = trayH20Enabled(config);
      const gap = trayStackGap(config.options.tray.retention ?? true);
      const stackHeight = config.options.tray.connection !== 'none' || hasLid ? gap + (snap ? TRAY_SNAP.captureHeight : h20 ? H20_V7.pinHeight : TRAY_STACK.tongueHeight) : 0;
      const parts = [part('tray', 'Inventory tray', trayScad(config, t), zero(), '#b5c6c4')];
      const lidThickness = h20 ? H20_V7.lidThickness : TRAY_LID.thickness;
      const lidTop = t.height + gap + lidThickness;
      if (hasLid) {
        const percent = config.options.tray.lidTextPercent;
        const lidArgs = [t.width, t.depth, (config.options.tray.lidText ?? '').slice(0, 32), percent === undefined ? clamp(config.options.tray.lidTextSize ?? 6, 2, 100) : percent];
        if (percent !== undefined) lidArgs.push(config.options.tray.lidTextRotation ?? 0);
        const suffix = percent === undefined ? (h20 ? '_legacy' : '') : '_percent';
        if (h20) lidArgs.push(traySlideDirection(config.options.tray.slideDirection).angle, config.options.tray.lidStyle ?? 'regular');
        if (snap) parts.push(part('tray-lid', 'Tray lid', scadCall(percent === undefined ? 'tray_snap_lid_legacy' : 'tray_snap_lid', lidArgs), [0, 0, t.height + gap], '#597f91', zero(), [t.width + 8, 0, -(t.height + gap)]));
        else if (h20 || config.options.tray.lidStyle === 'minimal') {
          const module = h20 ? 'inventory_tray_h20_lid' + suffix : 'inventory_tray_lid_minimal' + (percent === undefined ? '' : '_percent');
          const lid = part('tray-lid', config.options.tray.lidStyle === 'minimal' ? 'Minimal lid' : 'Regular lid', scadCall(module, lidArgs), [0, 0, t.height + gap], '#597f91', zero(), [t.width + 8, 0, -(t.height + gap)]);
          if (h20) lid.release = traySlideRelease(config);
          parts.push(lid);
        } else parts.push(part('tray-lid', 'Tray lid', scadCall('inventory_tray_lid' + suffix, lidArgs), [0, 0, lidTop], '#597f91', [Math.PI, 0, 0], lidExplodeOffset(t.width, lidTop, lidThickness)));
      }
      return {
        parts,
        keys: placements(config.slots, t.xy, t.height, true, 'tray'),
        dimensions: [t.width, t.depth, t.height + Math.max(labelHeight, retentionHeight, stackHeight,
          hasLid ? gap + (snap ? TRAY_SNAP.lidThickness : lidThickness) : 0)],
      };
    }
  }
}

export function buildTraySnapTest(engagement: number = TRAY_SNAP.engagement): ProjectGeometry {
  if (![.1, .2, .3].includes(engagement)) throw new Error("Snap-fit engagement must be 0.1, 0.2 or 0.3 mm");
  const { couponWidth: w, couponDepth: d, couponHeight: h, gap } = TRAY_SNAP;
  const pitch = h + gap;
  return {
    parts: [
      part('fit-tray-snap-lower', 'Snap-fit test tray', scadCall('tray_snap_coupon_lower', [engagement])),
      part('fit-tray-snap-upper', 'Snap-fit test lid', scadCall('tray_snap_lid', [w, d, `${engagement.toFixed(1)} mm`, 45, 0]), [0, 0, pitch], '#87aeb7', zero(), [w + 8, 0, -pitch]),
    ],
    keys: [], dimensions: [w, d, pitch + TRAY_SNAP.lidThickness],
  };
}

/** Two identical coupon layers, using the unchanged zero-gap reference. */
export function buildTrayH20Test(): ProjectGeometry {
  return {
    parts: [
      part('fit-tray-h20-lower', 'Slide-lock lower sample', scadCall('tray_h20_coupon', [])),
      part('fit-tray-h20-upper', 'Slide-lock upper sample', scadCall('tray_h20_coupon', []), [0, 0, 8.4], '#87aeb7', zero(), [48, 0, -8.4]),
    ],
    keys: [], dimensions: [40, 28, 21],
  };
}
