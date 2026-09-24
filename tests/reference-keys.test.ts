import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { NFC_TOUCH_CENTER_Y, NFC_TOUCH_RADIUS, NFC_TOUCH_RECESS, NFC_TOUCH_THICKNESS } from '../src/geometry/keys';
import { buildProject, keyDimensions } from '../src/geometry';
import { defaultConfig, KEY_TYPES } from '../src/config';
import { keyIcon } from '../src/icons';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import type { KeyType } from '../src/types';

const components = ['body', 'connector', 'touch'] as const;
function assetBuffer(type: KeyType, component: typeof components[number]): ArrayBuffer {
  const bytes = readFileSync(new URL(`../public/keys/${type}-${component}.stl`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
function geometry(type: KeyType, component: typeof components[number]): THREE.BufferGeometry {
  return new STLLoader().parse(assetBuffer(type, component));
}
function bounds(type: KeyType, component: typeof components[number]): THREE.Box3 {
  const g = geometry(type, component);
  g.computeBoundingBox();
  return g.boundingBox!;
}
function reference(type: KeyType): THREE.Group {
  const group = new THREE.Group();
  for (const component of components) group.add(new THREE.Mesh(geometry(type, component), new THREE.MeshBasicMaterial()));
  return group;
}

describe('generated display-key detail and proportions', () => {
  it('matches all generated asset hashes and triangle counts recorded in the manifest', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/keys/manifest.json', import.meta.url), 'utf8'));
    expect(manifest.assets).toHaveLength(18);
    for (const asset of manifest.assets) {
      const bytes = readFileSync(new URL(`../public/keys/${asset.file}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset.sha256);
      expect(bytes.byteLength).toBe(asset.bytes);
      expect(bytes.readUInt32LE(80)).toBe(asset.triangles);
    }
  });

  it.each(['A', 'C'] as const)('places the %s NFC touch disk lower, closer to its connector', type => {
    const positions = geometry(type, 'touch').getAttribute('position');
    const disk = new THREE.Box3();
    for (let i = 0; i < positions.count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(positions, i);
      if (p.y > 18 && p.y < 31) disk.expandByPoint(p);
    }
    expect(disk.getCenter(new THREE.Vector3()).y).toBeCloseTo(NFC_TOUCH_CENTER_Y, 4);
    expect(disk.getSize(new THREE.Vector3()).x).toBeCloseTo(9.3, 4);
    expect(NFC_TOUCH_CENTER_Y).toBeLessThan(27);
  });

  it.each(['A', 'C'] as const)('exposes a blank %s NFC disk 0.15 mm below a matching body recess', type => {
    const bodyGeometry = geometry(type, 'body'), touchGeometry = geometry(type, 'touch');
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const body = new THREE.Mesh(bodyGeometry, material), touch = new THREE.Mesh(touchGeometry, material);
    body.updateMatrixWorld(true); touch.updateMatrixWorld(true);
    const surface = keyDimensions[type].thickness / 2;
    const face = surface - NFC_TOUCH_RECESS;
    const floor = face - NFC_TOUCH_THICKNESS;
    expect(NFC_TOUCH_RECESS).toBe(0.15);
    expect(NFC_TOUCH_THICKNESS).toBe(0.1);
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    // Sample the whole disk, including where the old y and NFC arcs cut holes.
    for (let x = -4; x <= 4; x += 0.25) for (let y = -4; y <= 4; y += 0.25) {
      if (x * x + y * y > (NFC_TOUCH_RADIUS - 0.1) ** 2) continue;
      ray.ray.origin.set(x, NFC_TOUCH_CENTER_Y + y, 10);
      const bodyHits = ray.intersectObject(body), touchHits = ray.intersectObject(touch);
      expect(bodyHits.length).toBeGreaterThan(0);
      expect(touchHits.length).toBeGreaterThan(0);
      expect(bodyHits[0].point.z).toBeCloseTo(floor, 5);
      expect(touchHits[0].point.z).toBeCloseTo(face, 5);
      expect(touchHits[0].point.z).toBeGreaterThan(bodyHits[0].point.z);
    }
    ray.ray.origin.set(NFC_TOUCH_RADIUS + 0.2, NFC_TOUCH_CENTER_Y, 10);
    expect(ray.intersectObject(body)[0].point.z).toBeCloseTo(surface, 5);
    expect(ray.intersectObject(touch)).toHaveLength(0);
    expect(inspectPrintableMesh(assetBuffer(type, 'body'), false).components).toBe(1);
    bodyGeometry.dispose(); touchGeometry.dispose(); material.dispose();
  });

  it('uses a high-Y USB-A Nano blade and a curved low-Y touch cap', () => {
    expect(bounds('AN', 'body').max.y).toBeCloseTo(3.8, 5);
    expect(bounds('AN', 'connector').min.y).toBeCloseTo(3.8, 5);
    expect(bounds('AN', 'connector').max.y).toBe(13);
    expect(bounds('AN', 'touch').min.y).toBeCloseTo(0, 5);
    expect(bounds('AN', 'touch').max.y).toBeCloseTo(12.3, 5);
  });

  it('keeps 5C contacts on the sides, with no invented front touch disk', () => {
    const positions = geometry('CK', 'touch').getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) > 10 && positions.getY(i) < 20) expect(Math.abs(positions.getX(i))).toBeGreaterThan(6);
    }
    expect(bounds('CN', 'touch').getSize(new THREE.Vector3()).x).toBeCloseTo(3.6, 4);
  });

  it.each([['CK', 5.5], ['CI', 15.7]] as const)('includes an open, metal-lined keyring hole on %s', (type, y) => {
    const body = new THREE.Mesh(geometry(type, 'body'), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    body.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, y, 10), new THREE.Vector3(0, 0, -1));
    expect(ray.intersectObject(body)).toHaveLength(0);
    ray.ray.origin.x = 4;
    expect(ray.intersectObject(body).length).toBeGreaterThan(0);
    expect(bounds(type, 'touch').min.z).toBeGreaterThanOrEqual(-keyDimensions[type].thickness / 2 - 0.00001);
  });

  it('preserves key lengths and cavity-floor alignment in upright and flat projects', () => {
    for (const type of KEY_TYPES) {
      const model = reference(type);
      const local = new THREE.Box3().setFromObject(model);
      expect(local.min.y).toBeCloseTo(0, 5);
      expect(local.max.y).toBeCloseTo(keyDimensions[type].length, 5);
      for (const template of ['desktop_dock', 'inventory_tray'] as const) {
        const config = defaultConfig();
        config.template = template;
        config.slots = [{ id: type, type, label: '', occupied: true }];
        const placement = buildProject(config).keys[0];
        model.position.fromArray(placement.position);
        model.rotation.set(...placement.rotation, 'XYZ');
        const posed = new THREE.Box3().setFromObject(model);
        const d = keyDimensions[type];
        const floor = template === 'desktop_dock' ? config.options.dock.height - d.socketDepth : config.options.tray.height - (d.thickness - .4);
        expect(posed.min.z).toBeCloseTo(floor, 5);
      }
    }
  });

  it('renders distinct chooser silhouettes without forcing light holes in dark mode', () => {
    expect(new Set(KEY_TYPES.map(keyIcon)).size).toBe(6);
    for (const type of ['A', 'C', 'CK', 'CI']) {
      expect(keyIcon(type)).toContain('var(--surface,#fff)');
      expect(keyIcon(type)).not.toContain('fill="#f5f7f8"');
    }
    for (const type of ['A', 'C']) {
      expect(keyIcon(type)).not.toContain('<text');
      expect(keyIcon(type)).toContain('<circle cy="24.5" r="4.65" fill="#d4ae55"/>');
    }
  });
});
