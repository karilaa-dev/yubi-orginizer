import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { selectTrayParts } from '../src/geometry/layers';
import { build3mf, THREE_MF_PRINT_SETTINGS } from '../src/three-mf';
import type { PartSpec, ProjectGeometry } from '../src/types';

function tetrahedron(z = 0): ArrayBuffer {
  const points = [[0, 0, z], [2, 0, z], [0, 2, z], [0, 0, z + 2]];
  const faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]];
  const buffer = new ArrayBuffer(84 + faces.length * 50);
  const data = new DataView(buffer);
  data.setUint32(80, faces.length, true);
  faces.forEach((face, t) => face.forEach((vertex, i) => points[vertex].forEach((coordinate, axis) => data.setFloat32(84 + t * 50 + 12 + i * 12 + axis * 4, coordinate, true))));
  return buffer;
}
function part(id: string, name = id): PartSpec {
  return { id, name, scad: '', position: [0, 0, 50], rotation: [Math.PI, 0, 0], explode: [0, 0, 10], color: '#ffffff' };
}
function project(parts: PartSpec[]): ProjectGeometry { return { parts, keys: [], dimensions: [10, 10, 10] }; }
const text = (entries: Record<string, Uint8Array>, name: string) => strFromU8(entries[name]);

describe('3MF export', () => {
  it('creates a standard millimeter package with welded vertices and scoped Bambu/Orca settings', () => {
    const result = unzipSync(build3mf(project([part('base', 'A & "B" <test>')]), new Map([['base', tetrahedron()]])));
    const model = text(result, '3D/3dmodel.model');
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<vertex /g)).toHaveLength(4);
    expect(model.match(/<triangle /g)).toHaveLength(4);
    expect(model).toContain('A &amp; &quot;B&quot; &lt;test&gt;');
    expect(text(result, '_rels/.rels')).toContain('Target="/3D/3dmodel.model"');
    expect(result['Metadata/project_settings.config']).toBeUndefined();
    expect(text(result, 'Metadata/model_settings.config')).toContain('key="sparse_infill_density" value="5%"');
    expect(text(result, 'Metadata/model_settings.config')).toContain('key="wall_generator" value="arachne"');
    expect(text(result, 'Metadata/model_settings.config')).toContain('key="brim_type" value="outer_only"');
    expect(Object.keys(result).some((name) => name.includes('gcode'))).toBe(false);
    expect(text(result, 'Metadata/model_settings.config')).not.toMatch(/printer|filament|nozzle|temperature/);
  });
  it('lays parts flat at zero with non-overlapping build translations instead of assembly poses', () => {
    const entries = unzipSync(build3mf(project([part('a'), part('b')]), new Map([['a', tetrahedron(7)], ['b', tetrahedron(12)]])));
    const model = text(entries, '3D/3dmodel.model');
    const objects = [...model.matchAll(/<object[^>]*>([\s\S]*?)<\/object>/g)];
    for (const object of objects) {
      const z = [...object[1].matchAll(/<vertex[^>]* z="([^"]+)"/g)].map((match) => Number(match[1]));
      expect(Math.min(...z)).toBe(0);
      expect(Math.max(...z)).toBe(2);
    }
    const transforms = [...model.matchAll(/<item[^>]*transform="([^"]+)"/g)].map((match) => match[1].split(' ').map(Number));
    expect(transforms).toHaveLength(2);
    expect(transforms.every((matrix) => matrix.slice(0, 9).join(' ') === '1 0 0 0 1 0 0 0 1' && matrix[11] === 0)).toBe(true);
    const dx = Math.abs(transforms[0][9] - transforms[1][9]);
    const dy = Math.abs(transforms[0][10] - transforms[1][10]);
    expect(dx >= 12 || dy >= 12).toBe(true);
  });
  it('exports the selected part only and does not require other unfinished meshes', () => {
    const entries = unzipSync(build3mf(project([part('a'), part('b')]), new Map([['b', tetrahedron()]]), { partId: 'b' }));
    expect(text(entries, '3D/3dmodel.model').match(/<object /g)).toHaveLength(1);
    expect(text(entries, '3D/3dmodel.model')).toContain('name="b"');
  });
  it('exports only checked tray and lid items, with no meshes needed for unchecked trays', () => {
    const full = project([part('layer-1-tray'), part('layer-2-tray'), part('layer-2-tray-lid')]);
    for (const ids of [['layer-1-tray', 'layer-2-tray-lid'], ['layer-2-tray-lid']]) {
      const selected = selectTrayParts(full, new Set(ids));
      const meshes = new Map(ids.map(id => [id, tetrahedron()]));
      const entries = unzipSync(build3mf(selected, meshes));
      const model = text(entries, '3D/3dmodel.model');
      expect(model.match(/<object /g)).toHaveLength(ids.length);
      for (const id of ids) expect(model).toContain(`name="${id}"`);
      expect(model).not.toContain('name="layer-2-tray"');
      expect(entries['Metadata/project_settings.config']).toBeUndefined();
      const objects = [...text(entries, 'Metadata/model_settings.config').matchAll(/<object[^>]*>([\s\S]*?)<\/object>/g)];
      expect(objects).toHaveLength(ids.length);
      for (const [, object] of objects) {
        const [objectSettings, partSettings] = object.split('<part');
        for (const [key, value] of Object.entries(THREE_MF_PRINT_SETTINGS)) {
          expect(objectSettings).toContain(`<metadata key="${key}" value="${value}"/>`);
          expect(partSettings).not.toContain(`key="${key}"`);
        }
      }
    }
  });
  it('rejects unfinished, invalid, or missing models and produces reproducible bytes', () => {
    const input = project([part('a')]);
    expect(() => build3mf(input, new Map())).toThrow('not ready');
    expect(() => build3mf(input, new Map(), { partId: 'missing' })).toThrow('does not exist');
    expect(() => build3mf(project([]), new Map())).toThrow('Add keys');
    expect(() => build3mf(input, new Map([['a', new ArrayBuffer(20)]]))).toThrow('incomplete');
    const meshes = new Map([['a', tetrahedron()]]);
    const before = structuredClone(input);
    expect(build3mf(input, meshes)).toEqual(build3mf(input, meshes));
    expect(input).toEqual(before);
  });
  it('identifies yubi-orginizer and titles the model after the project, escaped', () => {
    const input = project([part('a')]);
    const meshes = new Map([['a', tetrahedron()]]);
    const model = (options?: { title?: string }) => text(unzipSync(build3mf(input, meshes, options)), '3D/3dmodel.model');
    expect(model()).toContain('<metadata name="Application">yubi-orginizer</metadata>');
    expect(model()).toContain('<metadata name="Title">YubiKey organizer</metadata>');
    expect(model({ title: '  ' })).toContain('<metadata name="Title">YubiKey organizer</metadata>');
    expect(model({ title: 'Desk <A&B> "1"' })).toContain('<metadata name="Title">Desk &lt;A&amp;B&gt; &quot;1&quot;</metadata>');
    expect(model({ title: '\u041a\u043b\u044e\u0447\u0456' })).toContain('<metadata name="Title">\u041a\u043b\u044e\u0447\u0456</metadata>');
    expect(model()).not.toMatch(/keyform/i);
  });
});
