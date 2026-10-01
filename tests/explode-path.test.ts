import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/config';
import { buildProject } from '../src/geometry';
import { RELEASE_SHARE, explodePathPoint } from '../src/preview-layout';
import type { Vec3 } from '../src/types';

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
