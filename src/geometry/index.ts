import type { HolderConfig, KeyPlacement, KeyType, PartSpec, ProjectGeometry, Slot, Vec3 } from '../types';
import { scadCall, TRAY_RETENTION, TRAY_STACK, TRAY_STACK_PILLAR, TRAY_LID, KEY_LABEL_LAYOUT, trayRetentionBounds } from './library';
import { fitOffsets, formatFitOffset } from '../fit-options';
import { lidExplodeOffset } from '../preview-layout';
import { CI_INVENTORY_TOUCH_RELIEF } from './ci-touch';
import { TRAY_SNAP } from './tray-snap';
import { trayStackGap } from './tray-stack';
export { trayStackGap } from './tray-stack';
export { buildKeyScad } from './keys';
export { TRAY_STACK } from './library';

/** Identically sized trays register at the same XY origin. The locating lip
 * nests into a narrow underside groove with a 0.3mm visible exterior seam. */
export function trayStackPitch(height: number, retention = true): number { return height + trayStackGap(retention); }
export function traySnapEnabled(config: HolderConfig): boolean {
  return config.template === 'inventory_tray' && config.options.tray.connection === 'snap_fit';
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

const keyLabels: Record<KeyType, string> = { A: 'A NFC', C: 'C NFC', AN: 'A NANO', CN: 'C NANO', CK: '5C', CI: '5Ci' };
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
  if (flat) return { slotId: slot.id, type: slot.type, partId, position: [x, y - d.length / 2, top - (d.thickness - 0.4) + d.thickness / 2], rotation: zero() };
  const reverse = slot.type === 'AN' || slot.type === 'CN' || slot.type === 'CK' || slot.type === 'CI';
  return { slotId: slot.id, type: slot.type, partId, position: [x, y, top - d.socketDepth + (reverse ? d.length : 0)], rotation: [Math.PI / 2, 0, reverse ? Math.PI : 0] };
}

function placements(slots: Slot[], xy: Point[], top: number, flat: boolean, partId: string, offset: Vec3 = zero()): KeyPlacement[] {
  return slots.flatMap((slot, i) => slot.occupied ? [keyPlacement(slot, xy[i][0] + offset[0], xy[i][1] + offset[1], top + offset[2], flat, partId)] : []);
}

function trayLayout(config: HolderConfig) {
  const n = config.slots.length;
  const columns = columnsFor(n, config.options.tray.columns);
  const rows = Math.ceil(n / columns);
  const spacing = clamp(config.options.tray.spacing, 24, 42);
  const margin = clamp(config.options.tray.margin, 5, 20);
  const rowSpacing = clamp(config.options.tray.rowSpacing ?? 66 + margin * 2, 66, 110);
  const height = clamp(config.options.tray.height ?? 8.6, 8.6, 20);
  return {
    xy: layout(n, columns, spacing, rowSpacing),
    width: Math.ceil((columns - 1) * spacing + 18.6 + 2 * margin),
    depth: (rows - 1) * rowSpacing + 66 + 2 * margin,
    height,
    scoopRadius: { small: 4, default: 5, large: 6 }[config.options.tray.scoop],
    labelWidth: Math.min(spacing - 4, 24),
  };
}

/** Inventory rows use the actual pocket, finger-access, and label envelopes.
 * rowGap is the free space between those envelopes, rather than a fixed pitch
 * that forces Nano keys into full-length rows. Case inserts retain their layout. */
export function inventoryTrayLayout(config: HolderConfig) {
  const n = config.slots.length;
  const columns = n ? columnsFor(n, config.options.tray.columns) : 0;
  const spacing = clamp(config.options.tray.spacing, 24, 42);
  const margin = Math.max(clamp(config.options.tray.margin, 5, 20), traySnapEnabled(config) ? TRAY_SNAP.margin : 0);
  const rowGap = clamp(config.options.tray.rowGap ?? 4, 2, 40);
  const height = clamp(config.options.tray.height, traySnapEnabled(config) ? TRAY_SNAP.minimumHeight : 8.6, 20);
  const scoopRadius = { small: 5, default: 6, large: 7 }[config.options.tray.scoop];
  const labelMetrics = keyLabelMetrics(config);
  const rows: { center: number; front: number; back: number; minY: number; maxY: number }[] = [];
  let end = 0;
  for (let start = 0; start < n; start += columns) {
    let front = 0, back = 0;
    for (const slot of config.slots.slice(start, start + columns)) {
      const half = keyDimensions[slot.type].pocketLength / 2;
      const hasLabel = config.labels && slot.label.trim().length > 0;
      // Scaled Liberation Sans, including accents/descenders. Blank labels
      // reserve no space; resizing leaves the nearest pocket edge clear.
      front = Math.max(front, half + (hasLabel ? labelMetrics.edgeOffset + labelMetrics.halfHeight : 0));
      back = Math.max(back, half + scoopRadius);
      if (config.options.tray.retention ?? true) {
        const bounds = trayRetentionBounds(slot.type);
        front = Math.max(front, -bounds.minY);
        back = Math.max(back, bounds.maxY);
      }
    }
    const center = end + (rows.length ? rowGap : 0) + front;
    rows.push({ center, front, back, minY: center - front, maxY: center + back });
    end = center + back;
  }
  for (const row of rows) { row.center -= end / 2; row.minY -= end / 2; row.maxY -= end / 2; }
  const xy: Point[] = config.slots.map((_, i) => [(i % columns - (columns - 1) / 2) * spacing, rows[Math.floor(i / columns)].center]);
  const baseWidth = n ? Math.ceil((columns - 1) * spacing + 18.6 + 2 * margin) : 0;
  // Reserve a complete perimeter channel for enclosure snaps. The key layout
  // stays fixed; the surrounding frame grows independently of its population.
  const requiredWidth = baseWidth;
  const pocketDepth = n ? Math.round((end + 2 * margin) * 100) / 100 : 0;
  const requiredDepth = n ? Math.max(pocketDepth, traySnapEnabled(config) ? TRAY_SNAP.minimumDepth : 0) : 0;
  const locked = config.options.tray.footprint;
  return {
    xy, rows, rowGap, columns,
    width: locked?.width ?? requiredWidth,
    depth: locked?.depth ?? requiredDepth,
    requiredWidth, requiredDepth,
    height, scoopRadius, labelWidth: Math.min(spacing - 4, 24),
  };
}

export function trayFootprintError(config: HolderConfig): string | undefined {
  if (config.template !== 'inventory_tray' || !config.options.tray.footprint || !config.slots.length) return;
  const t = inventoryTrayLayout(config);
  if (t.width + .00001 < t.requiredWidth || t.depth + .00001 < t.requiredDepth) {
    return `These keys and layout need at least ${t.requiredWidth} × ${t.requiredDepth} mm. Increase the locked tray dimensions, adjust the layout, or unlock the size.`;
  }
}

/** Sparse bearing posts sit in clear inter-row space, outside all working
 * features. Circle-to-rectangle distance keeps narrow diagonal gaps usable. */
export function inventoryTraySupports(config: HolderConfig, t = inventoryTrayLayout(config)): Point[] {
  if (!(config.options.tray.connection !== 'none' || config.options.tray.lid) || t.rows.length < 2) return [];
  const radius = TRAY_STACK_PILLAR.diameter / 2;
  const clearanceRadius = radius + TRAY_STACK_PILLAR.clearance;
  const inside = (traySnapEnabled(config) ? TRAY_SNAP.margin : TRAY_STACK.rimWidth) + clearanceRadius;
  const maxX = t.width / 2 - inside, maxY = t.depth / 2 - inside;
  if (maxX <= 0 || maxY <= 0) return [];
  const rectangles: { x: number; y: number; halfX: number; halfY: number }[] = [];
  const scoops: Point[] = [];
  const labelMetrics = keyLabelMetrics(config);
  for (const [i, slot] of config.slots.entries()) {
    const [x, y] = t.xy[i];
    const half = keyDimensions[slot.type].pocketLength / 2;
    rectangles.push({ x, y, halfX: TRAY_RETENTION[slot.type].pocketHalfWidth, halfY: half });
    if (slot.type === 'CI') rectangles.push({ x, y: y + CI_INVENTORY_TOUCH_RELIEF.centerY, halfX: CI_INVENTORY_TOUCH_RELIEF.outerHalfWidth, halfY: CI_INVENTORY_TOUCH_RELIEF.length / 2 });
    scoops.push([x, y + half]);
    if (config.labels && slot.label.trim()) rectangles.push({ x, y: y - half - labelMetrics.edgeOffset, halfX: t.labelWidth / 2, halfY: labelMetrics.halfHeight });
    if (config.options.tray.retention) {
      const b = trayRetentionBounds(slot.type);
      rectangles.push({ x, y: y + (b.minY + b.maxY) / 2, halfX: b.maxX, halfY: (b.maxY - b.minY) / 2 });
    }
  }
  const clear = ([x, y]: Point) => Math.abs(x) <= maxX && Math.abs(y) <= maxY
    && rectangles.every((r) => Math.hypot(Math.max(0, Math.abs(x - r.x) - r.halfX), Math.max(0, Math.abs(y - r.y) - r.halfY)) >= clearanceRadius)
    && scoops.every(([sx, sy]) => Math.hypot(x - sx, y - sy) >= t.scoopRadius + clearanceRadius);
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

function trayScad(config: HolderConfig, t: ReturnType<typeof trayLayout>, inventory = false): string {
  const args: unknown[] = [config.slots.map((s) => s.type), labels(config), t.xy, t.width, t.depth, t.height, t.scoopRadius, t.labelWidth];
  if (inventory) args.push(config.options.tray.retention ?? true, config.options.tray.connection !== 'none', (config.options.tray.sideText ?? '').slice(0, 32), inventoryTraySupports(config));
  args.push(keyLabelMetrics(config).scale);
  if (inventory) args.push(config.options.tray.lid ?? false);
  return scadCall(inventory ? (traySnapEnabled(config) ? 'inventory_tray_snap' : 'inventory_tray') : 'tray', args);
}

/** Every part is a printable millimetre-space solid at Z=0. Assembly transforms
 * are separate from its SCAD source. Three.js only displays these generated meshes. */
export function buildProject(config: HolderConfig): ProjectGeometry {
  if (config.template === 'key_fit_tester') return buildKeyFitTester(config);
  if (config.template === 'interface_tests') return buildFitTests(config.options.interfaceTests.kind);
  if (!config.slots.length) return { parts: [], keys: [], dimensions: zero() };
  const n = config.slots.length;
  const types = config.slots.map((s) => s.type);
  const ls = labels(config);
  const labelHeight = ls.some((s) => s.trim().length > 0) ? 0.35 : 0;
  switch (config.template) {
    case 'desktop_dock': {
      const cols = columnsFor(n, config.options.dock.columns);
      const rows = Math.ceil(n / cols);
      const spacing = clamp(config.options.dock.spacing, 22, 40);
      const rowSpacing = clamp(config.options.dock.rowSpacing ?? 45, 18, 70);
      const edgeMargin = clamp(config.options.dock.edgeMargin ?? 18, 12, 40);
      const depthMargin = clamp(config.options.dock.depthMargin ?? 22.5, 18, 45);
      const h = clamp(config.options.dock.height, 11, 25);
      const w = (cols - 1) * spacing + 2 * edgeMargin;
      const d = (rows - 1) * rowSpacing + 2 * depthMargin;
      const xy = layout(n, cols, spacing, rowSpacing, 3);
      // These three products share the same calibrated standard USB-C socket.
      // Normalize only the cutter IDs; labels and preview references retain the
      // user's selected model, including the high-Y USB-C end of 5C and 5Ci.
      const socketTypes = types.map((type) => type === 'CK' || type === 'CI' ? 'C' : type);
      return {
        parts: [part('dock', 'Desktop dock', scadCall('dock', [socketTypes, ls, xy, w, d, h, config.options.dock.title.slice(0, 32), keyLabelMetrics(config).scale]))],
        keys: placements(config.slots, xy, h, false, 'dock'),
        dimensions: [w, d, h + labelHeight],
      };
    }
    case 'inventory_tray': {
      const footprintError = trayFootprintError(config);
      if (footprintError) throw new Error(footprintError);
      const t = inventoryTrayLayout(config);
      const retentionHeight = (config.options.tray.retention ?? true) ? Math.max(...types.map((type) => trayRetentionSpec(type).peakHeight)) : 0;
      const hasLid = config.options.tray.lid ?? false;
      const snap = traySnapEnabled(config);
      const gap = trayStackGap(config.options.tray.retention ?? true);
      const stackHeight = config.options.tray.connection !== 'none' || hasLid ? gap + (snap ? TRAY_SNAP.captureHeight : TRAY_STACK.tongueHeight) : 0;
      const parts = [part('tray', 'Inventory tray', trayScad(config, t, true), zero(), '#b5c6c4')];
      const lidTop = t.height + gap + TRAY_LID.thickness;
      if (hasLid) {
        const percent = config.options.tray.lidTextPercent;
        const lidArgs = [t.width, t.depth, (config.options.tray.lidText ?? '').slice(0, 32), percent === undefined ? clamp(config.options.tray.lidTextSize ?? 6, 2, 100) : percent];
        if (percent !== undefined) lidArgs.push(config.options.tray.lidTextRotation ?? 0);
        const suffix = percent === undefined ? '' : '_percent';
        if (snap) parts.push(part('tray-lid', 'Tray lid', scadCall(percent === undefined ? 'tray_snap_lid_legacy' : 'tray_snap_lid', lidArgs), [0, 0, t.height + gap], '#597f91', zero(), [t.width + 8, 0, -(t.height + gap)]));
        else parts.push(part('tray-lid', 'Tray lid', scadCall('inventory_tray_lid' + suffix, lidArgs), [0, 0, lidTop], '#597f91', [Math.PI, 0, 0], lidExplodeOffset(t.width, lidTop, TRAY_LID.thickness)));
      }
      return {
        parts,
        keys: placements(config.slots, t.xy, t.height, true, 'tray'),
        dimensions: [t.width, t.depth, t.height + Math.max(labelHeight, retentionHeight, stackHeight,
          hasLid ? gap + (snap ? TRAY_SNAP.lidThickness : TRAY_LID.thickness) : 0)],
      };
    }
    case 'modular_rail': {
      const endMargin = clamp(config.options.rail.endMargin ?? 5, 5, 30);
      const parts = [part('rail', 'Rail base', scadCall('rail_base', [n, config.options.rail.mountingHoles, endMargin]))];
      const keys: KeyPlacement[] = [];
      config.slots.forEach((slot, i) => {
        const x = (i - (n - 1) / 2) * 26;
        const id = `cartridge-${i + 1}`;
        parts.push(part(id, `Cartridge ${i + 1} — ${keyLabels[slot.type]}`, scadCall('cartridge', [slot.type, ls[i], keyLabelMetrics(config).scale]), [x, 0, 3], i % 2 ? '#87aeb7' : '#597f91', zero(), [0, 0, 10]));
        if (slot.occupied) keys.push(keyPlacement(slot, x, 0, 16.6, false, id));
      });
      return { parts, keys, dimensions: [n * 26 + 2 * endMargin, 36, 16.6 + labelHeight] };
    }
    case 'travel_case': {
      const t = trayLayout(config);
      const h = t.height + 6.4 + clamp(config.options.case.headroom, 0, 15);
      return {
        parts: [
          part('case-base', 'Case base', scadCall('case_base', [t.width, t.depth, h])),
          part('case-insert', 'Case insert', trayScad(config, t), [0, 0, 2.4], '#b5c6c4', zero(), [0, 0, 8]),
          part('case-lid', 'Case lid', scadCall('case_lid', [t.width, t.depth, config.options.case.title.slice(0, 32)]), [0, 0, h + 2.4], '#36566a', [Math.PI, 0, 0], [0, 0, 30]),
        ],
        keys: placements(config.slots, t.xy, t.height, true, 'case-insert', [0, 0, 2.4]),
        dimensions: [t.width + 8, t.depth + 8, h + 2.4],
      };
    }
    case 'grid_organizer': return buildGrid(config);
  }
}

function buildGrid(config: HolderConfig): ProjectGeometry {
  const mode = config.options.grid.mode;
  const extraHeight = clamp(config.options.grid.extraHeight ?? 0, 0, 15);
  const groups = mode === 'mixed'
    ? [{ flat: false, slots: config.slots.filter((s) => s.type !== 'CK' && s.type !== 'CI') }, { flat: true, slots: config.slots.filter((s) => s.type === 'CK' || s.type === 'CI') }]
    : [{ flat: mode === 'flat', slots: config.slots }];
  const tiles: { flat: boolean; slots: Slot[] }[] = [];
  for (const group of groups) {
    const capacity = group.flat ? 2 : 4;
    for (let i = 0; i < group.slots.length; i += capacity) {
      const slots = group.slots.slice(i, i + capacity);
      tiles.push({ flat: group.flat, slots });
    }
  }
  const tileColumns = Math.ceil(Math.sqrt(tiles.length));
  const tileRows = Math.ceil(tiles.length / tileColumns);
  const parts: PartSpec[] = [];
  const keys: KeyPlacement[] = [];
  tiles.forEach((tile, i) => {
    // Adjacent parts remain on the same 42mm baseplate grid, with a 0.5mm gap.
    const offset: Vec3 = [(i % tileColumns - (tileColumns - 1) / 2) * 84, (Math.floor(i / tileColumns) - (tileRows - 1) / 2) * 84, 0];
    const xy: Point[] = tile.slots.map((_, j) => [(j % 2 - 0.5) * 42, tile.flat ? 4 : (Math.floor(j / 2) - 0.5) * 42 + 3]);
    const id = `grid-${tile.flat ? 'flat' : 'upright'}-${i + 1}`;
    parts.push(part(id, `${tile.flat ? 'Flat' : 'Upright'} grid tile ${i + 1}`, scadCall('grid_tile', [tile.slots.map((s) => s.type), labels(config, tile.slots), xy, 2, 2, tile.flat, extraHeight, keyLabelMetrics(config).scale]), offset, tile.flat ? '#87aeb7' : '#36566a', zero(), [0, 0, 5]));
    keys.push(...placements(tile.slots, xy, (tile.flat ? 13 : 15) + extraHeight, tile.flat, id, offset));
  });
  const height = Math.max(...tiles.map((t) => (t.flat ? 13 : 15) + extraHeight + (labels(config, t.slots).some((s) => s.trim().length > 0) ? 0.35 : 0)));
  return { parts, keys, dimensions: [tileColumns * 84 - 0.5, tileRows * 84 - 0.5, height] };
}

function buildKeyFitTester(config: HolderConfig): ProjectGeometry {
  const options = config.options.tester;
  const count = options.samples;
  const offsets = fitOffsets(options);
  const offsetLabels = offsets.map(formatFitOffset);
  const headings = { A: 'USB-A / mm per side', C: 'USB-C / mm per side', AN: 'A NANO / mm per side', CN: 'C NANO / mm per side' };
  const height = keyDimensions[options.profile].socketDepth + 3;
  return {
    parts: [part('key-fit-tester', `${keyLabels[options.profile]} socket fit tester`, scadCall('key_fit_tester', [options.profile, offsets, offsetLabels, headings[options.profile]]))],
    keys: [], dimensions: [(count - 1) * 22 + 24, 28, height + 0.35],
  };
}

export function buildTraySnapTest(engagement: number = TRAY_SNAP.engagement): ProjectGeometry {
  if (![.1, .2, .3].includes(engagement)) throw new Error("Enclosure snap engagement must be 0.1, 0.2 or 0.3 mm");
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

export function buildFitTests(kind: HolderConfig['options']['interfaceTests']['kind'] = 'all'): ProjectGeometry {
  if (kind === 'tray_snap') return buildTraySnapTest();
  if (kind === 'grid') return {
    parts: [part('fit-grid', 'Gridfinity 1×1 fit test', scadCall('grid_fit_test', []))],
    keys: [], dimensions: [41.5, 41.5, 7],
  };
  if (kind === 'rail') return {
    parts: [
      part('fit-rail', 'Rail fit-test segment', scadCall('rail_base', [1, false])),
      part('fit-cartridge', 'Rail fit-test cartridge', scadCall('cartridge', ['C', '']), [0, 0, 3], '#87aeb7', zero(), [0, 0, 10]),
    ],
    keys: [], dimensions: [36, 36, 16.6],
  };
  if (kind === 'lid') return {
    parts: [
      part('fit-case-corner', 'Case corner fit test', scadCall('lid_fit_base', []), [12, 12, 0]),
      part('fit-lid-corner', 'Lid corner fit test', scadCall('lid_fit_lid', []), [12, 12, 17.4], '#87aeb7', [Math.PI, 0, 0], [0, 0, 18]),
    ],
    keys: [], dimensions: [24, 24, 17.4],
  };
  return {
    parts: [
      part('fit-grid', 'Gridfinity 1×1 fit test', scadCall('grid_fit_test', []), [-75, 0, 0]),
      part('fit-rail', 'Rail fit-test segment', scadCall('rail_base', [1, false]), [-20, 0, 0]),
      part('fit-cartridge', 'Rail fit-test cartridge', scadCall('cartridge', ['C', '']), [-20, 0, 3], '#87aeb7', zero(), [0, 0, 10]),
      part('fit-case-corner', 'Case corner fit test', scadCall('lid_fit_base', []), [70, 10, 0]),
      part('fit-lid-corner', 'Lid corner fit test', scadCall('lid_fit_lid', []), [70, 10, 17.4], '#87aeb7', [Math.PI, 0, 0], [0, 0, 18]),
      ...buildTraySnapTest().parts.map((p) => ({ ...p, position: [p.position[0] + 120, p.position[1], p.position[2]] as Vec3 })),
    ],
    keys: [], dimensions: [215.75 + TRAY_SNAP.couponWidth / 2, Math.max(41.5, TRAY_SNAP.couponDepth), Math.max(17.4, TRAY_SNAP.couponHeight + TRAY_SNAP.gap + TRAY_SNAP.lidThickness)],
  };
}
