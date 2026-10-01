import type { Vec3 } from './types';

export const ISOMETRIC_DIRECTION: Vec3 = [1, -1.4, 1.05];

/** Place the cover directly beside the tray with a compact 8 mm gap.
 * Its outer face remains upward and its lowest surface rests on the table. */
export function lidExplodeOffset(width: number, closedTop: number, printedHeight: number): Vec3 {
  return [width + 8, 0, printedHeight - closedTop];
}

/** Share of the explode motion spent sliding a slide-lock part to its entry position. */
export const RELEASE_SHARE = 0.3;
/** Explode / collapse duration, longer when a part has to slide first. */
export const explodeDuration = (slides: boolean): number => (slides ? 1300 : 950);

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const bezier = (a: number, b: number, c: number, d: number, t: number): number => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/**
 * Where a part is at `progress` between assembled (0) and exploded (1), moved the way a hand
 * would: a slide-lock part first slides by `release` to its entry position, then every part
 * lifts straight up, carries over in an arc and sets straight down. Collapsing plays the same
 * path backwards, so a slide-lock lid is lowered at its entry position and then slides to lock.
 */
export function explodePathPoint(position: Vec3, explode: Vec3, release: Vec3, progress: number): Vec3 {
  const p = Math.min(1, Math.max(0, progress));
  if (explode.every(v => v === 0)) return [...position];
  const slides = release.some(v => v !== 0);
  const entry: Vec3 = [position[0] + release[0], position[1] + release[1], position[2] + release[2]];
  if (slides && p < RELEASE_SHARE) {
    const k = easeInOut(p / RELEASE_SHARE);
    return [position[0] + release[0] * k, position[1] + release[1] * k, position[2] + release[2] * k];
  }
  const start = slides ? entry : position;
  const end: Vec3 = [position[0] + explode[0], position[1] + explode[1], position[2] + explode[2]];
  const t = easeInOut(slides ? (p - RELEASE_SHARE) / (1 - RELEASE_SHARE) : p);
  // Vertical end tangents: the part clears pins and rims before it moves sideways, and lands flat.
  const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const peak = Math.max(start[2], end[2]) + Math.max(10, span * 0.3);
  const across = 3 * t * t - 2 * t * t * t;
  return [
    start[0] + (end[0] - start[0]) * across,
    start[1] + (end[1] - start[1]) * across,
    bezier(start[2], start[2] + (peak - start[2]) * 4 / 3, end[2] + (peak - end[2]) * 4 / 3, end[2], t),
  ];
}
