import { describe, expect, it } from 'vitest';
import { TRAY_FLEX, TRAY_RETENTION, TRAY_STACK, TRAY_STACK_PILLAR, TRAY_LID, KEY_LABEL_LAYOUT, trayRetentionBounds, library } from '../src/geometry/library';
import profiles from '../src/geometry/profiles/profiles.scad?raw';
import type { KeyType } from '../src/types';

const types = Object.keys(TRAY_RETENTION) as KeyType[];
const points = (name: string): [number, number][] => JSON.parse(new RegExp(`^${name} = (\\[.*\\]);$`, 'm').exec(profiles)![1]);

describe('planar tray clip mechanisms', () => {
  it.each(types)('%s relief stays outside the entire calibrated pocket, including narrower tip sections', (type) => {
    const spec = TRAY_RETENTION[type];
    const polygon = points(`body_${type}`);
    expect(spec.pocketHalfWidth).toBeGreaterThanOrEqual(Math.max(...polygon.map(([x]) => Math.abs(x))) - 0.00001);
    const bounds = trayRetentionBounds(type);
    expect(bounds.maxX).toBeCloseTo(spec.pocketHalfWidth + TRAY_FLEX.outerExtent);
    expect(bounds.minX).toBe(-bounds.maxX);
    // The arm runs toward the connector/finger-scoop end, away from labels.
    expect(bounds.minY).toBeGreaterThan(-spec.pocketLength / 2);
    expect(bounds.maxY).toBeLessThanOrEqual(spec.pocketLength / 2 + 4);
    expect(bounds.maxY - bounds.minY).toBeCloseTo(TRAY_FLEX.length + TRAY_FLEX.endRelief);
  });

  it('uses a tapered, filleted, long beam and through relief rather than floor-limited leaves', () => {
    expect(TRAY_FLEX.length / TRAY_FLEX.rootThickness).toBeGreaterThanOrEqual(12);
    expect(TRAY_FLEX.tipThickness).toBeLessThan(TRAY_FLEX.rootThickness);
    expect(TRAY_FLEX.rootFillet).toBeGreaterThanOrEqual(TRAY_FLEX.rootThickness / 2);
    expect(TRAY_FLEX.sideRelief).toBeGreaterThanOrEqual(0.5);
    expect(library).toContain('translate([s[1],start,-eps])');
    expect(library).toContain('linear_extrude(h+2*eps) tray_retention_relief_2d()');
    expect(library).not.toContain('translate([0,y,h-6])');
  });

  it('keeps CI relief beyond its isolated widest point to avoid a nonmanifold tangent', () => {
    const silhouetteHalfWidth = Math.max(...points('body_CI').map(([x]) => Math.abs(x)));
    expect(TRAY_RETENTION.CI.pocketHalfWidth - silhouetteHalfWidth).toBeCloseTo(0.075);
  });

  it.each(types)('%s seated body and capture lips clear the upper tray', (type) => {
    const spec = TRAY_RETENTION[type];
    const reach = spec.pocketHalfWidth + 0.5 - spec.bodyHalfWidth + TRAY_FLEX.capture;
    const bodyEdgeUnderside = 0.75 - TRAY_FLEX.capture * 0.7 / reach;
    const peak = 1.25;
    expect(bodyEdgeUnderside).toBeGreaterThan(0.475);
    expect(bodyEdgeUnderside).toBeLessThan(0.75);
    expect(TRAY_STACK.gap - peak).toBeCloseTo(0.25);
  });
});

describe('inventory lid access and text fitting', () => {
  it('keeps all four access recesses shallower than the locating groove offset', () => {
    expect(TRAY_LID.notchDepth).toBe(0.8);
    expect(TRAY_LID.notchHeight).toBe(1.2);
    expect(TRAY_LID.notchRadius).toBe(4);
    expect(TRAY_STACK.grooveOuterInset - TRAY_LID.notchDepth).toBeCloseTo(0.3);
    expect(library.includes('rotate([side*90,0,0]) cylinder')).toBe(true);
    expect(library.includes('rotate([0,-side*90,0]) cylinder')).toBe(true);
  });

  it('uses a depth budget covering the validated key-label glyph height', () => {
    expect(TRAY_LID.textVerticalBudget).toBeGreaterThan(2 * KEY_LABEL_LAYOUT.baseHalfHeight / KEY_LABEL_LAYOUT.baseSize);
    expect(TRAY_LID.textInset).toBeGreaterThan(TRAY_STACK.rimWidth);
    expect(TRAY_LID.thickness - TRAY_LID.engravingDepth).toBeGreaterThan(2);
    // A short glyph at size10 fits the width of a tiny Nano tray but must still
    // shrink to its depth. The default6 fits both, preserving normal output.
    const depthLimit = (25.8 - 2 * TRAY_LID.textInset) / TRAY_LID.textVerticalBudget;
    expect(depthLimit).toBeLessThan(10);
    expect(depthLimit).toBeGreaterThan(6);
    expect(library).toContain('m=textmetrics(s,size=1');
  });
});

describe('nearly flush perimeter nesting interface', () => {
  it('has a 0.3 mm visible seam with separate bearing and locating surfaces', () => {
    expect(TRAY_STACK.gap).toBe(1.5);
    expect(TRAY_STACK.wallHeight).toBe(1.2);
    expect(TRAY_STACK.totalHeight).toBe(2.7);
    expect(TRAY_STACK.gap - TRAY_STACK.wallHeight).toBeCloseTo(0.3);
    expect(TRAY_STACK.seam).toBeCloseTo(0.3);
    expect(TRAY_STACK.totalHeight).toBeCloseTo(TRAY_STACK.gap + TRAY_STACK.tongueHeight);
    expect(TRAY_STACK.tongueOuterInset - TRAY_STACK.grooveOuterInset).toBeCloseTo(0.3);
    expect(TRAY_STACK.grooveInnerInset - TRAY_STACK.tongueInnerInset).toBeCloseTo(0.3);
    expect(TRAY_STACK.grooveDepth - TRAY_STACK.tongueHeight).toBeCloseTo(0.5);
    expect(TRAY_STACK.grooveOuterInset - TRAY_STACK.seam).toBeGreaterThan(0.7);
  });

  it('uses only a narrow chamfer-roof groove, leaving the central underside intact', () => {
    const mouth = TRAY_STACK.grooveInnerInset - TRAY_STACK.grooveOuterInset;
    const chamfer = TRAY_STACK.grooveDepth - TRAY_STACK.grooveStraightDepth;
    expect(mouth).toBeCloseTo(1.4);
    expect(mouth - 2 * chamfer).toBeCloseTo(0.4);
    expect(TRAY_STACK.grooveDepth).toBeLessThan(2);
    expect(TRAY_STACK.rimWidth + TRAY_FLEX.outerExtent).toBeLessThan(5);
  });

  it('adds sparse small pillars at the existing bearing plane for stacking or a lid', () => {
    expect(TRAY_STACK_PILLAR.diameter).toBe(3);
    expect(TRAY_STACK_PILLAR.clearance).toBeGreaterThanOrEqual(0.6);
    expect(TRAY_STACK_PILLAR.minSeparation).toBeGreaterThanOrEqual(90);
    expect(Math.ceil(119.6 / TRAY_STACK_PILLAR.spanPerSupport)).toBe(1);
    expect(TRAY_STACK.gap).toBeLessThan(TRAY_STACK.totalHeight);
    expect(library).toContain('side_text="",support_xy=[]');
    expect(library.includes('cylinder(d=3,h=gap+eps,$fn=48)')).toBe(true);
    expect(library.includes('if(stackable||has_lid) {\n      tray_stack_supports(w,d,h,true,gap);\n      tray_stack_pillars(support_xy,h,gap);')).toBe(true);
  });
});
