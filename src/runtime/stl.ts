/** Validate OpenSCAD's binary STL before exposing it for preview or download. */
export function validateBinaryStl(buffer: ArrayBuffer): number {
  if (buffer.byteLength < 84) throw new Error('The generated STL is incomplete.');
  const data = new DataView(buffer);
  const triangles = data.getUint32(80, true);
  if (triangles === 0) throw new Error('The generated model is empty.');
  if (buffer.byteLength !== 84 + triangles * 50) {
    throw new Error('The generated STL has an invalid triangle count.');
  }
  for (let triangle = 0; triangle < triangles; triangle++) {
    const offset = 84 + triangle * 50;
    // Each record has a normal plus three vertices; all coordinates must be finite.
    for (let component = 0; component < 12; component++) {
      if (!Number.isFinite(data.getFloat32(offset + component * 4, true))) {
        throw new Error('The generated STL contains an invalid coordinate.');
      }
    }
  }
  return triangles;
}

/** Float32 STL export can collapse two vertices of a tiny bevel triangle.
 * Remove only those duplicate-vertex faces. Keep distinct collinear vertices:
 * they still connect adjacent surface edges and must not open the mesh. */
export function removeCollapsedTriangles(buffer: ArrayBuffer): ArrayBuffer {
  const triangles = validateBinaryStl(buffer);
  const data = new DataView(buffer);
  const kept: number[] = [];
  for (let triangle = 0; triangle < triangles; triangle++) {
    const offset = 84 + triangle * 50 + 12;
    const ax = data.getFloat32(offset, true);
    const ay = data.getFloat32(offset + 4, true);
    const az = data.getFloat32(offset + 8, true);
    const bx = data.getFloat32(offset + 12, true);
    const by = data.getFloat32(offset + 16, true);
    const bz = data.getFloat32(offset + 20, true);
    const cx = data.getFloat32(offset + 24, true);
    const cy = data.getFloat32(offset + 28, true);
    const cz = data.getFloat32(offset + 32, true);
    if ((ax !== bx || ay !== by || az !== bz) && (ax !== cx || ay !== cy || az !== cz) && (bx !== cx || by !== cy || bz !== cz)) kept.push(triangle);
  }
  if (kept.length === triangles) return buffer;
  if (!kept.length) throw new Error('The generated model has no printable faces.');
  const source = new Uint8Array(buffer);
  const clean = new Uint8Array(84 + kept.length * 50);
  clean.set(source.subarray(0, 84));
  new DataView(clean.buffer).setUint32(80, kept.length, true);
  kept.forEach((original, index) => clean.set(source.subarray(84 + original * 50, 134 + original * 50), 84 + index * 50));
  return clean.buffer;
}
