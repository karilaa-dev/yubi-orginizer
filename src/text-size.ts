/** UI percentages retain the calibrated key-label size range in old projects. */
export const keyLabelPercent = (millimeters: number): number => Number((millimeters * 25).toFixed(4));
export const keyLabelMillimeters = (percent: number): number => percent / 25;

/** Real font metrics from the existing lid render migrate old text exactly.
 * A stale render must never apply this result to a newer configuration. */
export function readLegacyLidSize(line: string): { percent: number; rotation: 0 | 90 | 180 | 270 } | undefined {
  const match = /KEYFORM_LID_TEXT",\s*\[([\d.e+-]+),\s*(\d+)\]/.exec(line);
  if (!match) return;
  const percent = Number(match[1]), rotation = Number(match[2]);
  if (!Number.isFinite(percent) || percent < .1 || percent > 100.001 || ![0, 90, 180, 270].includes(rotation)) return;
  return { percent: Math.min(100, percent), rotation: rotation as 0 | 90 | 180 | 270 };
}
