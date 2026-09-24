import { validateBinaryStl } from './runtime/stl';

export const FILAMENT_SETTINGS = Object.freeze({
  infillFraction: 0.05,
  wallCount: 2,
  lineWidthMm: 0.42,
  layerHeightMm: 0.2,
  topLayers: 4,
  bottomLayers: 4,
  densityGramsPerCm3: 1.24,
  filamentDiameterMm: 1.75,
});

const ASSUMPTIONS: readonly string[] = Object.freeze([
  'PLA, 1.75 mm diameter, 1.24 g/cm³ density.',
  '5% infill, 2 walls at 0.42 mm, 0.2 mm layers, 4 top and 4 bottom layers.',
  'Rough mesh-based estimate; actual slicer usage varies with shape and print settings.',
  'Excludes supports, brims, purge, and waste.',
]);

export interface FilamentEstimate {
  grams: number;
  meters: number;
  materialVolumeMm3: number;
  solidVolumeMm3: number;
  shellVolumeMm3: number;
  infillVolumeMm3: number;
  partCount: number;
  approximate: true;
  assumptions: readonly string[];
}

function estimatePart(buffer: ArrayBuffer): Pick<FilamentEstimate, 'solidVolumeMm3' | 'shellVolumeMm3' | 'infillVolumeMm3'> {
  const triangles = validateBinaryStl(buffer);
  const view = new DataView(buffer);
  // Anchor signed tetrahedral volumes to the mesh, not the world origin.
  // This avoids cancellation when a part is translated away from z=0.
  const originX = view.getFloat32(96, true);
  const originY = view.getFloat32(100, true);
  const originZ = view.getFloat32(104, true);
  let signedVolume = 0;
  let compensation = 0;
  let lateralProjectionArea = 0;
  let horizontalProjectionArea = 0;
  for (let triangle = 0; triangle < triangles; triangle++) {
    const offset = 96 + triangle * 50;
    const ax = view.getFloat32(offset, true) - originX;
    const ay = view.getFloat32(offset + 4, true) - originY;
    const az = view.getFloat32(offset + 8, true) - originZ;
    const bx = view.getFloat32(offset + 12, true) - originX;
    const by = view.getFloat32(offset + 16, true) - originY;
    const bz = view.getFloat32(offset + 20, true) - originZ;
    const cx = view.getFloat32(offset + 24, true) - originX;
    const cy = view.getFloat32(offset + 28, true) - originY;
    const cz = view.getFloat32(offset + 32, true) - originZ;
    const abx = bx - ax; const aby = by - ay; const abz = bz - az;
    const acx = cx - ax; const acy = cy - ay; const acz = cz - az;
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    // These include cavity surfaces. Derive normals from vertices: STL normals
    // are optional/unreliable, and the estimate must not depend on tessellation.
    lateralProjectionArea += Math.hypot(nx, ny) / 2;
    horizontalProjectionArea += Math.abs(nz) / 2;
    const contribution = (ax * nx + ay * ny + az * nz) / 6 - compensation;
    const sum = signedVolume + contribution;
    compensation = (sum - signedVolume) - contribution;
    signedVolume = sum;
  }
  const solidVolumeMm3 = Math.abs(signedVolume);
  if (!Number.isFinite(solidVolumeMm3) || solidVolumeMm3 <= 1e-9) throw new Error('Cannot estimate filament for a mesh with no solid volume.');

  // Integrating layer perimeters gives the projected lateral area. Its product
  // with wall thickness approximates wall volume, including pocket walls.
  // Projected top/bottom area similarly estimates the solid skin volume.
  const wallFraction = Math.min(1, lateralProjectionArea * FILAMENT_SETTINGS.wallCount * FILAMENT_SETTINGS.lineWidthMm / solidVolumeMm3);
  const skinThickness = FILAMENT_SETTINGS.layerHeightMm * (FILAMENT_SETTINGS.topLayers + FILAMENT_SETTINGS.bottomLayers) / 2;
  const skinFraction = Math.min(1, horizontalProjectionArea * skinThickness / solidVolumeMm3);
  // Inclusion/exclusion approximates wall/skin overlap. Both fractions are
  // capped so thin printable pieces never estimate above their solid volume.
  const shellVolumeMm3 = solidVolumeMm3 * (1 - (1 - wallFraction) * (1 - skinFraction));
  const infillVolumeMm3 = (solidVolumeMm3 - shellVolumeMm3) * FILAMENT_SETTINGS.infillFraction;
  return { solidVolumeMm3, shellVolumeMm3, infillVolumeMm3 };
}

/** Estimate the printable STL parts, in their print orientation. Pass each part
 * once; preview keys and assembly transforms do not belong in this input.
 * Separate parts are intentionally counted even if their coordinates coincide.
 * This is a surface/volume approximation, not a slicer or an Arachne simulation.
 */
export function estimateFilament(meshes: Iterable<ArrayBuffer>): FilamentEstimate {
  let solidVolumeMm3 = 0;
  let shellVolumeMm3 = 0;
  let infillVolumeMm3 = 0;
  let partCount = 0;
  for (const mesh of meshes) {
    const estimate = estimatePart(mesh);
    solidVolumeMm3 += estimate.solidVolumeMm3;
    shellVolumeMm3 += estimate.shellVolumeMm3;
    infillVolumeMm3 += estimate.infillVolumeMm3;
    partCount++;
  }
  const materialVolumeMm3 = shellVolumeMm3 + infillVolumeMm3;
  const filamentAreaMm2 = Math.PI * (FILAMENT_SETTINGS.filamentDiameterMm / 2) ** 2;
  return {
    grams: materialVolumeMm3 / 1000 * FILAMENT_SETTINGS.densityGramsPerCm3,
    meters: materialVolumeMm3 / filamentAreaMm2 / 1000,
    materialVolumeMm3, solidVolumeMm3, shellVolumeMm3, infillVolumeMm3, partCount,
    approximate: true,
    assumptions: ASSUMPTIONS,
  };
}
