import { describe, expect, it } from 'vitest';
import { createSlot, defaultConfig, MAX_LAYERS } from '../src/config';
import { buildProject } from '../src/geometry';
import { buildTraySet } from '../src/geometry/layers';
import { withLayers } from '../src/layers';
import { RELEASE_SHARE, createExplodeSequence, explodeDuration, explodePathPoint, explodeStepProgress } from '../src/preview-layout';
import type { PartSpec, TrayConnection, TraySlideDirection, Vec3 } from '../src/types';

const lid: Vec3 = [0, 0, 10.1];
const aside: Vec3 = [64, 0, -10.1];
const horizontal = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('explode path', () => {
  it('starts assembled and ends exploded; parts without an offset never move', () => {
    expect(explodePathPoint(lid, aside, [0, 0, 0], 0)).toEqual(lid);
    expect(explodePathPoint(lid, aside, [0, 0, 0], 1)).toEqual([64, 0, 0]);
    expect(explodePathPoint([1, 2, 3], [0, 0, 0], [0, 0, 0], 0.5)).toEqual([1, 2, 3]);
  });

  it('lifts straight up before moving sideways, and sets down straight', () => {
    const samples = Array.from({ length: 101 }, (_, i) => explodePathPoint(lid, aside, [0, 0, 0], i / 100));
    const cleared = samples.find(p => p[2] >= lid[2] + 5)!; // above the 4.2 mm slide-lock pins
    expect(horizontal(cleared, lid)).toBeLessThan(1.5);
    const landing = samples.findLast(p => p[2] >= 5)!;
    expect(horizontal(landing, [64, 0, 0])).toBeLessThan(1.5);
    expect(Math.max(...samples.map(p => p[2]))).toBeGreaterThan(lid[2] + 10);
  });

  it('slides a slide-lock lid to its entry position before lifting it', () => {
    const release: Vec3 = [6, 0, 0];
    const sliding = Array.from({ length: 11 }, (_, i) => explodePathPoint(lid, aside, release, (i / 10) * RELEASE_SHARE));
    for (const p of sliding) expect(p[2]).toBe(lid[2]);
    expect(sliding.at(-1)).toEqual([6, 0, lid[2]]);
    expect(sliding[5][0]).toBeGreaterThan(0);
    expect(sliding[5][0]).toBeLessThan(6);
    // Collapsing runs the same path backwards: lowered at the entry position, then slid to lock.
    const lowered = explodePathPoint(lid, aside, release, RELEASE_SHARE + 0.001);
    expect(horizontal(lowered, [6, 0, 0])).toBeLessThan(0.01);
    expect(explodePathPoint(lid, aside, release, 1)).toEqual([64, 0, 0]);
  });

  it('gives slide-lock lids the release move of their slide direction', () => {
    const expected = { left: [6, 0, 0], right: [-6, 0, 0], front: [0, 6, 0], back: [0, -6, 0] } as const;
    for (const [direction, release] of Object.entries(expected)) {
      const c = defaultConfig();
      Object.assign(c.options.tray, { connection: 'h20_slide_v7', slideDirection: direction, lid: true });
      expect(buildProject(c).parts.find(p => p.id === 'tray-lid')!.release, direction).toEqual(release);
    }
    const lifted = defaultConfig();
    lifted.options.tray.lid = true;
    expect(buildProject(lifted).parts.find(p => p.id === 'tray-lid')!.release).toBeUndefined();
  });
});

function stack(count: number, connection: TrayConnection, direction: TraySlideDirection, hasLid: boolean) {
  return buildTraySet(withLayers(Array.from({ length: count }, (_, index) => {
    const config = defaultConfig();
    config.slots = [createSlot('A')];
    Object.assign(config.options.tray, { connection, slideDirection: direction, height: 16,
      footprint: { width: 100, depth: 100 }, lid: hasLid && index === count - 1 });
    return { name: `Tray ${index + 1}`, config };
  })));
}

describe('multi-layer explode sequence', () => {
  it.each(['left', 'right', 'front', 'back'] as const)('unlocks every %s-facing layer against a stationary supporting tray', direction => {
    const geometry = stack(4, 'h20_slide_v7', direction, true);
    const { steps } = createExplodeSequence(geometry.parts);
    const at = (part: PartSpec, progress: number) => explodePathPoint(part.position, part.explode,
      part.release ?? [0, 0, 0], explodeStepProgress(progress, steps.get(part.id)));
    const resting = (part: PartSpec) => part.position.map((v, axis) => v + part.explode[axis]);
    const moving = [...geometry.parts.slice(1)].reverse();
    expect([...steps.keys()]).toEqual(moving.map(part => part.id));
    for (const [index, part] of moving.entries()) {
      const step = steps.get(part.id)!;
      const halfwayReleased = step.start + (step.end - step.start) * RELEASE_SHARE / 2;
      const point = at(part, halfwayReleased);
      expect(point[2]).toBe(part.position[2]);
      for (let axis = 0; axis < 2; axis++) expect(point[axis]).toBeCloseTo(part.position[axis] + part.release![axis] / 2);
      // The original simultaneous animation failed here: lower trays also slid by 3 mm.
      for (const below of geometry.parts.filter(p => p.position[2] < part.position[2])) {
        expect(at(below, halfwayReleased)).toEqual(below.position);
      }
      for (const above of moving.slice(0, index)) expect(at(above, halfwayReleased)).toEqual(resting(above));
      const lifting = at(part, step.start + (step.end - step.start) * (RELEASE_SHARE + .1));
      expect(lifting[2]).toBeGreaterThan(part.position[2]);
      expect(at(part, step.end)).toEqual(resting(part));
      // On collapse it lowers at the entry position, then locks onto an already seated support.
      const entry = at(part, step.start + (step.end - step.start) * RELEASE_SHARE);
      for (let axis = 0; axis < 3; axis++) expect(entry[axis]).toBeCloseTo(part.position[axis] + part.release![axis]);
    }
  });

  it.each(['none', 'stackable', 'snap_fit', 'h20_slide_v7'] as const)('reverses the %s stack smoothly, with and without a lid', connection => {
    for (const hasLid of [false, true]) {
      const geometry = stack(3, connection, 'front', hasLid);
      const { steps } = createExplodeSequence(geometry.parts);
      const points = (progress: number) => geometry.parts.map(part => explodePathPoint(part.position, part.explode,
        part.release ?? [0, 0, 0], explodeStepProgress(progress, steps.get(part.id))));
      expect(points(0)).toEqual(geometry.parts.map(part => part.position));
      expect(points(1)).toEqual(geometry.parts.map(part => part.position.map((v, axis) => v + part.explode[axis])));
      const progress = Array.from({ length: 201 }, (_, i) => i / 200);
      const forward = progress.map(points);
      expect([...progress].reverse().map(points)).toEqual([...forward].reverse());
      // Reversing at any point retraces the path instead of restarting a different layer.
      for (const p of [.15, .37, .62, .89, ...[...steps.values()].map(step => step.end)]) {
        const before = points(p - 1e-6), after = points(p + 1e-6);
        for (let i = 0; i < before.length; i++) expect(Math.hypot(...before[i].map((v, axis) => v - after[i][axis]))).toBeLessThan(.1);
      }
      for (const sample of forward) expect(sample[0]).toEqual(geometry.parts[0].position);
    }
  });

  it('keeps the single-lid timing and sequences the maximum stack without counting stationary parts', () => {
    for (const connection of ['stackable', 'h20_slide_v7'] as const) {
      const single = stack(1, connection, 'left', true);
      const { duration, steps } = createExplodeSequence(single.parts);
      expect(duration).toBe(explodeDuration(connection === 'h20_slide_v7'));
      expect([...steps.values()]).toEqual([{ start: 0, end: 1 }]);
      const full = createExplodeSequence(stack(MAX_LAYERS, connection, 'left', true).parts);
      expect(full.steps.size).toBe(MAX_LAYERS);
      expect(full.duration).toBeGreaterThan(duration);
      expect(full.duration).toBeLessThan(MAX_LAYERS * duration);
    }
    expect(createExplodeSequence([])).toEqual({ duration: 0, steps: new Map() });
    expect(createExplodeSequence(stack(1, 'stackable', 'left', false).parts).steps.size).toBe(0);
  });
});
