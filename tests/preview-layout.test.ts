import { describe, expect, it } from 'vitest';
import { lidExplodeOffset } from '../src/preview-layout';

describe('exploded inventory lid placement', () => {
  it.each([[25, 25], [77, 120], [350, 30], [30, 500], [350, 500]])(
    'places the lid directly right with an 8 mm gap for a %s × %s tray', (width) => {
      const offset = lidExplodeOffset(width, 13.7, 2.4);
      expect(offset[0]).toBe(width + 8);
      expect(offset[1]).toBe(0);
      const trayRight = width / 2;
      const lidLeft = offset[0] - width / 2;
      expect(lidLeft - trayRight).toBeCloseTo(8);
      // Keep the outer face up and the groove opening on the table in preview.
      expect(13.7 + offset[2] - 2.4).toBeCloseTo(0);
    },
  );
});
