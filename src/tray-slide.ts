import type { TraySlideDirection } from './types';

/** Directions describe the upper layer's locking motion, viewed from above.
 * Front is the tray's side-text edge (-Y), independent of the preview camera. */
export const TRAY_SLIDE_DIRECTIONS = [
  { id: 'left', label: 'Left ←', angle: 0, entry: 'right', lock: 'left', release: 'right', releaseAxis: [1, 0] },
  { id: 'right', label: 'Right →', angle: 180, entry: 'left', lock: 'right', release: 'left', releaseAxis: [-1, 0] },
  { id: 'front', label: 'Front ↓', angle: 90, entry: 'back', lock: 'toward the front', release: 'toward the back', releaseAxis: [0, 1] },
  { id: 'back', label: 'Back ↑', angle: 270, entry: 'front', lock: 'toward the back', release: 'toward the front', releaseAxis: [0, -1] },
] as const;
export function traySlideDirection(direction: TraySlideDirection = 'left') {
  return TRAY_SLIDE_DIRECTIONS.find(item => item.id === direction)!;
}
export function traySlideMotionInstructions(direction: TraySlideDirection = 'left'): string {
  const d = traySlideDirection(direction);
  return `Start the upper layer 6 mm to the ${d.entry}, lower, then slide ${d.lock} until flush. Slide ${d.release} 6 mm before lifting; do not twist or peel.`;
}
