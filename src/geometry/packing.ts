/** Bounded rectangle-packing search, including pocket, label and finger-access envelopes.
 * Several strip widths and insertion orders find a compact layout with explicit clearance. */
export interface PackItem { width: number; height: number }
interface Rect extends PackItem { x: number; y: number }
export interface PackedItem extends Rect { turned: boolean; index: number }
export interface Packing { items: PackedItem[]; width: number; height: number }
export interface PackOptions { gapX: number; gapY: number; marginX: number; marginY: number; rotate?: boolean; available?: PackItem }
const cache = new Map<string, Packing>();

export function packRectangles(items: PackItem[], options: PackOptions): Packing {
  const key = JSON.stringify([items, options]);
  const cached = cache.get(key);
  if (cached) return cached;
  const packed = searchPacking(items, options);
  if (cache.size >= 64) cache.delete(cache.keys().next().value!);
  cache.set(key, packed);
  return packed;
}

function searchPacking(items: PackItem[], options: PackOptions): Packing {
  if (!items.length) return { items: [], width: 0, height: 0 };
  const { gapX, gapY, marginX, marginY, rotate, available } = options;
  const area = items.reduce((sum, r) => sum + (r.width + gapX) * (r.height + gapY), 0);
  const minWidth = Math.max(...items.map(r => rotate ? Math.min(r.width, r.height) : r.width));
  const maxWidth = items.reduce((sum, r) => sum + (rotate ? Math.max(r.width, r.height) : r.width) + gapX, -gapX);
  const widths = new Set<number>([minWidth, maxWidth]);
  if (available) widths.add(available.width - 2 * marginX);
  for (let i = 0; i <= 40; i++) widths.add(minWidth + (Math.min(maxWidth, Math.sqrt(area) * 2.5) - minWidth) * i / 40);
  let sum = -gapX;
  for (const r of items) { sum += r.width + gapX; widths.add(sum); }
  const orders = [items.map((_, i) => i), items.map((_, i) => i).sort((a, b) => items[b].width * items[b].height - items[a].width * items[a].height),
    items.map((_, i) => i).sort((a, b) => Math.max(items[b].width, items[b].height) - Math.max(items[a].width, items[a].height))];
  let best: Packing | undefined, bestScore = Infinity;
  for (const width of widths) for (const order of orders) {
    if (width + 1e-7 < minWidth) continue;
    let free: Rect[] = [{ x: 0, y: 0, width: width + gapX, height: items.reduce((h, r) => h + Math.max(r.width, r.height) + gapY, 0) }];
    const placed: PackedItem[] = [];
    for (const index of order) {
      const item = items[index];
      let chosen: PackedItem | undefined, score = Infinity;
      for (const r of free) for (const turned of rotate ? [false, true] : [false]) {
        const w = (turned ? item.height : item.width) + gapX, h = (turned ? item.width : item.height) + gapY;
        if (w > r.width + 1e-7 || h > r.height + 1e-7) continue;
        const cost = (r.y + h) * 100000 + r.x * 100 + Math.min(r.width - w, r.height - h);
        if (cost < score) { score = cost; chosen = { x: r.x, y: r.y, width: w, height: h, index, turned }; }
      }
      if (!chosen) break;
      const p = chosen;
      placed.push({ ...p, width: p.width - gapX, height: p.height - gapY });
      const split: Rect[] = [];
      for (const r of free) {
        if (p.x >= r.x + r.width - 1e-7 || p.x + p.width <= r.x + 1e-7 || p.y >= r.y + r.height - 1e-7 || p.y + p.height <= r.y + 1e-7) { split.push(r); continue; }
        if (p.x > r.x) split.push({ ...r, width: p.x - r.x });
        if (p.x + p.width < r.x + r.width) split.push({ ...r, x: p.x + p.width, width: r.x + r.width - p.x - p.width });
        if (p.y > r.y) split.push({ ...r, height: p.y - r.y });
        if (p.y + p.height < r.y + r.height) split.push({ ...r, y: p.y + p.height, height: r.y + r.height - p.y - p.height });
      }
      free = split.filter((r, i) => !split.some((s, j) => i !== j && s.x <= r.x && s.y <= r.y && s.x + s.width >= r.x + r.width && s.y + s.height >= r.y + r.height && (j < i || s.width * s.height > r.width * r.height)));
    }
    if (placed.length !== items.length) continue;
    const w = Math.max(...placed.map(p => p.x + p.width)), h = Math.max(...placed.map(p => p.y + p.height));
    const outsideW = Math.ceil(w + 2 * marginX), outsideH = Math.ceil((h + 2 * marginY) * 100 - 1e-8) / 100;
    const overflow = available ? Math.max(0, outsideW - available.width) + Math.max(0, outsideH - available.height) : 0;
    const score = overflow * 1e9 + outsideW * outsideH + Math.abs(outsideW - outsideH) * .001;
    if (score < bestScore) { bestScore = score; best = { items: placed.sort((a, b) => a.index - b.index), width: w, height: h }; }
  }
  return best!;
}
