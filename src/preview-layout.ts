import type { Vec3 } from './types';

export const ISOMETRIC_DIRECTION: Vec3 = [1, -1.4, 1.05];

/** Place the cover directly beside the tray with a compact 8 mm gap.
 * Its outer face remains upward and its lowest surface rests on the table. */
export function lidExplodeOffset(width: number, closedTop: number, printedHeight: number): Vec3 {
  return [width + 8, 0, printedHeight - closedTop];
}
