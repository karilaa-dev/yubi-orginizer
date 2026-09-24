import { describe, expect, it } from 'vitest';
import { estimateFilament, FILAMENT_SETTINGS } from '../src/filament';

type Point = [number, number, number];
type Triangle = [Point, Point, Point];
function stl(triangles: Triangle[]): ArrayBuffer {
  const buffer = new ArrayBuffer(84 + triangles.length * 50);
  const view = new DataView(buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((triangle, t) => triangle.forEach((vertex, v) => vertex.forEach((coordinate, axis) => {
    view.setFloat32(96 + t * 50 + v * 12 + axis * 4, coordinate, true);
  })));
  return buffer;
}
function boxTriangles(width: number, depth: number, height: number, translation: Point = [0, 0, 0]): Triangle[] {
  const vertices = [[0, 0, 0], [width, 0, 0], [width, depth, 0], [0, depth, 0], [0, 0, height], [width, 0, height], [width, depth, height], [0, depth, height]]
    .map((point) => point.map((value, axis) => value + translation[axis]) as Point);
  return [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]]
    .map((face) => face.map((vertex) => vertices[vertex]) as Triangle);
}
const box = (width: number, depth: number, height: number, translation?: Point) => stl(boxTriangles(width, depth, height, translation));

describe('rough printable filament estimate', () => {
  it.each([[20, 20, 20], [20, 10, 5], [100, 2, 10]])('accounts for shells on an analytical %s×%s×%s mm box', (width, depth, height) => {
    const result = estimateFilament([box(width, depth, height)]);
    const solid = width * depth * height;
    const wall = 2 * 0.42;
    const skin = 4 * 0.2;
    const core = Math.max(0, width - wall * 2) * Math.max(0, depth - wall * 2) * Math.max(0, height - skin * 2);
    const analytical = solid - core + core * 0.05;
    expect(result.solidVolumeMm3).toBeCloseTo(solid, 8);
    expect(Math.abs(result.materialVolumeMm3 - analytical) / analytical).toBeLessThan(0.05);
    expect(result.materialVolumeMm3).toBeGreaterThan(solid * 0.05 * 2);
    expect(result.materialVolumeMm3).toBeLessThanOrEqual(solid);
    expect(result.grams).toBeCloseTo(result.materialVolumeMm3 * 1.24 / 1000, 10);
    expect(result.meters).toBeCloseTo(result.materialVolumeMm3 / (Math.PI * 0.875 ** 2) / 1000, 10);
  });
  it('treats thin plates and narrow walls as effectively solid without exceeding solid volume', () => {
    for (const mesh of [box(20, 20, 1), box(1, 20, 20), box(0.5, 0.5, 0.5)]) {
      const result = estimateFilament([mesh]);
      expect(result.materialVolumeMm3).toBeCloseTo(result.solidVolumeMm3, 8);
    }
  });
  it('counts repeated parts independently even at the same coordinates', () => {
    const mesh = box(20, 10, 5);
    const one = estimateFilament([mesh]);
    const duplicate = estimateFilament([mesh, mesh]);
    const copied = estimateFilament([mesh, mesh.slice(0)]);
    expect(duplicate.partCount).toBe(2);
    expect(duplicate.grams).toBeCloseTo(one.grams * 2, 10);
    expect(copied).toEqual(duplicate);
  });
  it('is additive across disjoint printable parts and independent of XY/Z translations', () => {
    const a = box(20, 10, 5);
    const b = box(12, 8, 20);
    const translatedA = box(20, 10, 5, [1024, -2048, 4096]);
    const translatedB = box(12, 8, 20, [-256, 512, -128]);
    const result = estimateFilament([a, b]);
    expect(estimateFilament([translatedA, translatedB])).toEqual(result);
    expect(result.grams).toBeCloseTo(estimateFilament([a]).grams + estimateFilament([b]).grams, 10);
    expect(result.materialVolumeMm3).toBeCloseTo(estimateFilament([a]).materialVolumeMm3 + estimateFilament([b]).materialVolumeMm3, 10);
  });
  it('uses triangle geometry instead of optional normals and is invariant to tessellation', () => {
    const triangles = boxTriangles(20, 10, 5);
    const subdivided = triangles.flatMap(([a, b, c]): Triangle[] => {
      const midpoint = a.map((value, axis) => (value + b[axis]) / 2) as Point;
      return [[a, midpoint, c], [midpoint, b, c]];
    });
    const source = stl(triangles);
    const snapshot = source.slice(0);
    const result = estimateFilament([source]);
    expect(estimateFilament([stl(subdivided)])).toEqual(result);
    expect(source).toEqual(snapshot);
  });
  it('subtracts cavities from solid volume and includes their shell surfaces', () => {
    const outside = boxTriangles(20, 20, 20);
    const cavity = boxTriangles(16, 16, 16, [2, 2, 2]).map(([a, b, c]) => [a, c, b] as Triangle);
    const result = estimateFilament([stl([...outside, ...cavity])]);
    expect(result.solidVolumeMm3).toBeCloseTo(20 ** 3 - 16 ** 3, 8);
    expect(result.materialVolumeMm3).toBeGreaterThan(result.solidVolumeMm3 * 0.5);
    expect(result.materialVolumeMm3).toBeLessThanOrEqual(result.solidVolumeMm3);
  });
  it('labels its assumptions and handles an empty project without estimating invalid geometry', () => {
    const result = estimateFilament([]);
    expect(result).toMatchObject({ grams: 0, meters: 0, solidVolumeMm3: 0, partCount: 0, approximate: true });
    expect(result.assumptions.join(' ')).toContain('Rough mesh-based estimate');
    expect(result.assumptions.join(' ')).toContain('Excludes supports');
    expect(FILAMENT_SETTINGS.infillFraction).toBe(0.05);
    expect(() => estimateFilament([new ArrayBuffer(8)])).toThrow('incomplete');
    expect(() => estimateFilament([stl([[[0, 0, 0], [1, 0, 0], [0, 1, 0]]])])).toThrow('no solid volume');
  });
});
