import { validateBinaryStl } from './stl';

export interface MeshInspection {
  triangles: number;
  vertices: number;
  min: [number, number, number];
  max: [number, number, number];
  volume: number;
  collinearTriangles: number;
  components: number;
}

/** Independent mesh checks for the real, exported triangle surface. */
export function inspectPrintableMesh(buffer: ArrayBuffer, requireBuildPlate = true): MeshInspection {
  const triangles = validateBinaryStl(buffer);
  const data = new DataView(buffer);
  const vertices = new Set<string>();
  const vertexIndices = new Map<string, number>();
  const parent: number[] = [];
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    while (parent[index] !== index) {
      const next = parent[index];
      parent[index] = root;
      index = next;
    }
    return root;
  };
  const edges = new Map<string, { count: number; direction: number }>();
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let volume = 0;
  let collinearTriangles = 0;
  for (let t = 0; t < triangles; t++) {
    const points: number[][] = [];
    const names: string[] = [];
    for (let v = 0; v < 3; v++) {
      const point = [0, 1, 2].map((axis) => data.getFloat32(84 + 50 * t + 12 + v * 12 + axis * 4, true));
      const name = point.join(',');
      vertices.add(name);
      points.push(point);
      names.push(name);
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], point[axis]);
        max[axis] = Math.max(max[axis], point[axis]);
      }
    }
    const [a, b, c] = points;
    const indices = names.map((name) => {
      let index = vertexIndices.get(name);
      if (index === undefined) {
        index = parent.length;
        parent.push(index);
        vertexIndices.set(name, index);
      }
      return index;
    });
    parent[find(indices[1])] = find(indices[0]);
    parent[find(indices[2])] = find(indices[0]);
    const ab = b.map((value, i) => value - a[i]);
    const ac = c.map((value, i) => value - a[i]);
    const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]);
    if (area === 0) collinearTriangles++;
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    for (let i = 0; i < 3; i++) {
      const start = names[i];
      const end = names[(i + 1) % 3];
      const ordered = start < end;
      const key = ordered ? `${start}|${end}` : `${end}|${start}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 };
      edge.count++;
      edge.direction += ordered ? 1 : -1;
      edges.set(key, edge);
    }
  }
  let unclosed = 0;
  for (const edge of edges.values()) if (edge.count !== 2 || edge.direction !== 0) unclosed++;
  if (unclosed) throw new Error(`Mesh is not watertight: ${unclosed} unmatched or inconsistently oriented edges. ${JSON.stringify([...edges.entries()].filter(([, edge]) => edge.count !== 2 || edge.direction !== 0).slice(0, 5))}`);
  if (volume <= 1e-6) throw new Error(`Mesh has nonpositive volume (${volume}).`);
  if (requireBuildPlate && Math.abs(min[2]) > 0.001) throw new Error(`Printable part does not rest at z=0 (minimum ${min[2]}).`);
  if (max.some((value, axis) => value - min[axis] <= 0)) throw new Error('Mesh has zero extent.');
  const components = new Set(parent.map((_, index) => find(index))).size;
  if (components !== 1) throw new Error(`Printable part contains ${components} disconnected components.`);
  return { triangles, vertices: vertices.size, min, max, volume, collinearTriangles, components };
}
