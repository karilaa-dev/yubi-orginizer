import type { HolderOptions } from './types';

/** Display and manufacturing use identical rounded offsets and labels. */
export function fitOffsets(options: HolderOptions['tester']): number[] {
  return Array.from({ length: options.samples }, (_, i) => Number((options.startOffset + i * options.step).toFixed(4)));
}
export function formatFitOffset(offset: number): string {
  const precision = Math.abs(offset * 100 - Math.round(offset * 100)) < 1e-8
    ? offset.toFixed(2) : offset.toFixed(4).replace(/0+$/, '');
  return `${offset > 0 ? '+' : ''}${precision}`;
}
