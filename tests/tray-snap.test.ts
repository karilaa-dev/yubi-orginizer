import { describe, expect, it } from 'vitest';
import { TRAY_SNAP as s, TRAY_SNAP_ENGAGEMENTS, traySnapStations, traySnapRequiredSpread } from '../src/geometry/tray-snap';

describe('solid enclosure catches and mating skirt', () => {
  it('reserves four full-width stations outside the rounded corners even on the smallest tray', () => {
    const stations = traySnapStations(s.minimumDepth);
    expect(stations).toHaveLength(2);
    expect(stations[1] - stations[0]).toBeGreaterThan(s.catchWidth + 2 * s.clearance);
    for (const y of stations) expect(Math.abs(y) + s.catchWidth / 2 + s.clearance).toBeLessThan(s.minimumDepth / 2 - s.cornerCenterInset);
    expect(s.catchThickness).toBe(3);
    expect(s.catchWidth).toBe(8);
  });
  it('protects the pocket floors, full catch bases, and engraved lid cap', () => {
    expect(s.minimumHeight - s.channelDepth - s.receiverTop).toBeCloseTo(2);
    expect(s.lidThickness - .35 - s.receiverTop).toBeGreaterThanOrEqual(2);
    expect(s.margin - s.receiverInner).toBeGreaterThanOrEqual(2);
    expect(s.receiverInner - s.guideOuter - s.guideThickness).toBeCloseTo(.4);
    expect(s.catchOuter - s.skirtThickness).toBeCloseTo(.4);
  });
  it.each(TRAY_SNAP_ENGAGEMENTS)('seats without preload and needs only %s mm of skirt movement', engagement => {
    expect(traySnapRequiredSpread(0, engagement)).toBe(0);
    expect(traySnapRequiredSpread(s.captureHeight, engagement)).toBe(0);
    const required = Array.from({ length: 401 }, (_, i) => traySnapRequiredSpread(i / 100, engagement));
    expect(Math.max(...required)).toBeCloseTo(engagement, 6);
    expect(required.some(v => v > 0)).toBe(true);
  });
});
