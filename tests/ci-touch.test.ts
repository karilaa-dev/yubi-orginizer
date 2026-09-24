import { describe, expect, it } from 'vitest';
import { CI_INVENTORY_TOUCH_RELIEF as relief, CI_SIDE_TOUCH as touch } from '../src/geometry/ci-touch';
import { TRAY_FLEX, TRAY_RETENTION } from '../src/geometry/library';

describe('5Ci local inventory contact clearance', () => {
  it('clears both orientations about the inventory slot centre', () => {
    expect(relief.centerY).toBe(0);
    const offset = Math.abs(touch.rawCenterY - touch.keyLength / 2);
    expect(relief.length / 2 - touch.length / 2 - offset).toBeCloseTo(.95);
  });

  it('provides explicit clearance around the provisional projecting contact envelope', () => {
    expect(touch.outerHalfWidth * 2).toBe(13);
    expect(relief.outerHalfWidth - touch.outerHalfWidth).toBeCloseTo(0.4);
    expect((relief.length - touch.length) / 2).toBeCloseTo(1.15);
    const keyCenterBelowTrayTop = 5 / 2 - 0.4;
    expect(relief.depth - (keyCenterBelowTrayTop + touch.thickness / 2)).toBeCloseTo(0.35);
  });

  it('clears the projecting pads without cutting either retention beam', () => {
    const innerBeamX = TRAY_RETENTION.CI.pocketHalfWidth + TRAY_FLEX.sideRelief;
    expect(innerBeamX - relief.outerHalfWidth).toBeCloseTo(0.15699);
    expect(innerBeamX - touch.outerHalfWidth).toBeGreaterThan(0.55);
  });

  it('keeps the contact relief clear of the inward-curving root fillets', () => {
    const retainer = TRAY_RETENTION.CI;
    const armStartY = retainer.rawY - retainer.width / 2 - retainer.pocketLength / 2;
    const filletStartY = armStartY + TRAY_FLEX.length - TRAY_FLEX.rootFillet;
    expect(filletStartY - (relief.centerY + relief.length / 2)).toBeCloseTo(0.1);
  });

  it('ends above the original calibrated pocket floor at minimum tray height', () => {
    const height = 8.6;
    const originalPocketFloor = height - (5 - 0.4);
    const reliefFloor = height - relief.depth;
    expect(reliefFloor - originalPocketFloor).toBeCloseTo(0.95);
    expect(reliefFloor).toBeGreaterThan(2);
  });
});
