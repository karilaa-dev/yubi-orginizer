import { strToU8, zipSync } from 'fflate';
import { validateBinaryStl } from './runtime/stl';
import type { PartSpec, ProjectGeometry } from './types';

/** These are Bambu Studio / OrcaSlicer settings, not universal 3MF properties. */
export const THREE_MF_PRINT_SETTINGS = Object.freeze({
  sparse_infill_density: '5%',
  wall_generator: 'arachne',
});

interface IndexedMesh {
  part: PartSpec;
  vertices: [number, number, number][];
  triangles: [number, number, number][];
  min: [number, number, number];
  max: [number, number, number];
}

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[character]!);
}

// Expand scientific notation without quantizing the generated mesh coordinates.
function number(value: number): string {
  const original = String(value);
  if (!original.includes('e')) return original;
  const [mantissa, exponent] = original.split('e');
  const negative = mantissa.startsWith('-');
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const digits = unsigned.replace('.', '');
  const decimal = (unsigned.includes('.') ? unsigned.indexOf('.') : unsigned.length) + Number(exponent);
  const expanded = decimal <= 0 ? `0.${'0'.repeat(-decimal)}${digits}` : decimal >= digits.length ? digits + '0'.repeat(decimal - digits.length) : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
  return `${negative ? '-' : ''}${expanded}`;
}

function indexMesh(part: PartSpec, stl: ArrayBuffer): IndexedMesh {
  const count = validateBinaryStl(stl);
  const view = new DataView(stl);
  const indices = new Map<string, number>();
  const vertices: IndexedMesh['vertices'] = [];
  const triangles: IndexedMesh['triangles'] = [];
  const min: IndexedMesh['min'] = [Infinity, Infinity, Infinity];
  const max: IndexedMesh['max'] = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < count; t++) {
    const triangle: [number, number, number] = [0, 0, 0];
    for (let v = 0; v < 3; v++) {
      const position = [0, 1, 2].map((axis) => view.getFloat32(84 + t * 50 + 12 + v * 12 + axis * 4, true)) as [number, number, number];
      // Only bit-equivalent coordinates are welded: calibrated fits are unchanged.
      const key = position.join(',');
      let index = indices.get(key);
      if (index === undefined) {
        index = vertices.length;
        indices.set(key, index);
        vertices.push(position);
        for (let axis = 0; axis < 3; axis++) {
          min[axis] = Math.min(min[axis], position[axis]);
          max[axis] = Math.max(max[axis], position[axis]);
        }
      }
      triangle[v] = index;
    }
    if (new Set(triangle).size === 3) triangles.push(triangle);
  }
  if (!triangles.length || max.some((coordinate, axis) => coordinate <= min[axis])) throw new Error(`The ${part.name} mesh is empty or flat.`);
  // Use the printable STL orientation, independently of preview assembly poses.
  for (const vertex of vertices) vertex[2] -= min[2];
  max[2] -= min[2];
  min[2] = 0;
  return { part, vertices, triangles, min, max };
}

/** A portable model plus Bambu/Orca process overrides; no printer, material,
 * nozzle, temperatures, speeds, or G-code are selected or embedded. */
export function build3mf(project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, options: { partId?: string; title?: string } = {}): Uint8Array {
  const parts = options.partId ? project.parts.filter((part) => part.id === options.partId) : project.parts;
  if (!parts.length) throw new Error(options.partId ? 'The selected printable part does not exist.' : 'Add keys and generate a model before exporting.');
  const indexed = parts.map((part) => {
    const bytes = meshes.get(part.id);
    if (!bytes) throw new Error(`The ${part.name} model is not ready yet.`);
    return indexMesh(part, bytes);
  });
  const gap = 10;
  const widths = indexed.map((mesh) => mesh.max[0] - mesh.min[0]);
  const depths = indexed.map((mesh) => mesh.max[1] - mesh.min[1]);
  const targetWidth = Math.max(...widths, Math.sqrt(widths.reduce((area, width, i) => area + (width + gap) * (depths[i] + gap), 0)));
  let cursorX = 0;
  let cursorY = 0;
  let rowDepth = 0;
  const items: string[] = [];
  const objects: string[] = [];
  const settings: string[] = [];
  indexed.forEach((mesh, index) => {
    if (cursorX > 0 && cursorX + widths[index] > targetWidth) {
      cursorX = 0;
      cursorY += rowDepth + gap;
      rowDepth = 0;
    }
    const id = index + 1;
    const tx = cursorX + gap - mesh.min[0];
    const ty = cursorY + gap - mesh.min[1];
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${number(tx)} ${number(ty)} 0"/>`);
    cursorX += widths[index] + gap;
    rowDepth = Math.max(rowDepth, depths[index]);
    objects.push(`<object id="${id}" type="model" name="${xml(mesh.part.name)}"><mesh><vertices>${mesh.vertices.map(([x, y, z]) => `<vertex x="${number(x)}" y="${number(y)}" z="${number(z)}"/>`).join('')}</vertices><triangles>${mesh.triangles.map(([v1, v2, v3]) => `<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join('')}</triangles></mesh></object>`);
    // Bambu skips foreign applications' global project settings. Its importer
    // still applies these object overrides, as verified by a native roundtrip.
    // This preserves the user's printer/material selection in the slicer.
    settings.push(`<object id="${id}"><metadata key="name" value="${xml(mesh.part.name)}"/><metadata key="sparse_infill_density" value="5%"/><metadata key="wall_generator" value="arachne"/><part id="${id}" subtype="normal_part"><metadata key="name" value="${xml(mesh.part.name)}"/></part></object>`);
  });
  const title = options.title?.trim() || 'YubiKey organizer';
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="application/octet-stream"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    '3D/3dmodel.model': strToU8(`<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">yubi-orginizer</metadata><metadata name="Title">${xml(title)}</metadata><metadata name="Description">Printable parts with 5% infill and Arachne object overrides for Bambu Studio and OrcaSlicer. Choose your printer and filament in the slicer.</metadata><resources>${objects.join('')}</resources><build>${items.join('')}</build></model>`),
    'Metadata/project_settings.config': strToU8(JSON.stringify(THREE_MF_PRINT_SETTINGS, null, 2)),
    'Metadata/model_settings.config': strToU8(`<?xml version="1.0" encoding="UTF-8"?><config>${settings.join('')}</config>`),
  };
  return zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) });
}
