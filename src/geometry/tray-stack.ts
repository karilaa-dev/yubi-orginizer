/** Retention tips need 0.25 mm clearance; bare keys can sit closer to the next layer. */
export const TRAY_STACK = { gap: 1.5, compactGap: 1, wallHeight: 1.2, tongueHeight: 1.2, totalHeight: 2.7, seam: 0.3, rimWidth: 2.7, tongueOuterInset: 1.4, tongueInnerInset: 2.2, grooveOuterInset: 1.1, grooveInnerInset: 2.5, grooveDepth: 1.7, grooveStraightDepth: 1.2, clearance: 0.3 } as const;
export function trayStackGap(retention = true): number {
  return retention ? TRAY_STACK.gap : TRAY_STACK.compactGap;
}
