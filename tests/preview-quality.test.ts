import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OrganizerPreview, previewPixelRatio } from '../src/preview';
import type { ProjectGeometry } from '../src/types';

describe('preview drawing-buffer limits', () => {
  it('supersamples standard screens and respects native density up to 3×', () => {
    expect(previewPixelRatio(900, 650, 1, 'high')).toBe(1.5);
    expect(previewPixelRatio(900, 650, 2, 'high')).toBe(2);
    expect(previewPixelRatio(900, 650, 4, 'high')).toBe(3);
  });

  it('reduces low-quality resolution on standard and high-density screens', () => {
    for (const dpr of [1, 1.5, 2, 3]) {
      const low = previewPixelRatio(900, 650, dpr, 'low');
      expect(low).toBeLessThan(previewPixelRatio(900, 650, dpr, 'high'));
      expect(low).toBeGreaterThanOrEqual(0.85);
      expect(low).toBeLessThanOrEqual(1.0625);
    }
  });

  it('caps total pixels and individual dimensions for large viewports', () => {
    for (const [width, height, limit] of [[3840, 2160, 8192], [30000, 800, 4096], [500, 12000, 2048]]) {
      const ratio = previewPixelRatio(width, height, 3, 'high', limit);
      expect(width * height * ratio * ratio).toBeLessThanOrEqual(12_000_001);
      expect(width * ratio).toBeLessThanOrEqual(limit);
      expect(height * ratio).toBeLessThanOrEqual(limit);
    }
    expect(previewPixelRatio(0, 0, NaN, 'high')).toBe(1.5);
  });
});

function fixture() {
  const preview = Object.create(OrganizerPreview.prototype) as OrganizerPreview;
  const partGroup = new THREE.Group();
  const keyGroup = new THREE.Group();
  const holder = new THREE.Mesh(new THREE.BoxGeometry(10, 20, 4), new THREE.MeshStandardMaterial());
  holder.name = 'previous';
  holder.castShadow = holder.receiveShadow = true;
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(holder.geometry), new THREE.LineBasicMaterial());
  holder.add(outline);
  partGroup.add(holder);
  const shadowMap = { dispose: vi.fn() };
  const renderer = { shadowMap: { enabled: true, needsUpdate: false }, setClearColor: vi.fn(), toneMappingExposure: 1.08 };
  const sunlight = { castShadow: true, shadow: { map: shadowMap as unknown | null } };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
  const resize = vi.fn();
  const updateGround = vi.fn();
  const requestRender = vi.fn();
  const project: ProjectGeometry = { parts: [], keys: [], dimensions: [10, 20, 4] };
  Object.assign(preview, {
    disposed: false, revision: 0, theme: 'light', quality: 'high', partGroup, keyGroup,
    renderer, sunlight, ground, resize, updateGround, requestRender, loader: new STLLoader(),
    project, fitted: true, bounds: new THREE.Box3(), showKeys: true, exploded: false,
    ambient: new THREE.HemisphereLight(), fill: new THREE.DirectionalLight(),
    container: { dataset: {} }, fitCamera: vi.fn(), placements: [],
  });
  return { preview, partGroup, keyGroup, holder, outline, renderer, sunlight, ground, shadowMap, resize, updateGround, requestRender, project };
}

describe('display-only quality and theme changes', () => {
  it('disables shadows/outlines and frees the shadow buffer, then restores high quality', () => {
    const { preview, holder, keyGroup, outline, renderer, sunlight, ground, shadowMap, resize, project } = fixture();
    const touch = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
    touch.userData.referenceComponent = 'touch';
    keyGroup.add(touch);
    const positions = Array.from(holder.geometry.getAttribute('position').array);
    const geometry = holder.geometry;
    preview.setQuality('low');
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(sunlight.castShadow).toBe(false);
    expect(ground.receiveShadow).toBe(false);
    expect(holder.castShadow || holder.receiveShadow).toBe(false);
    expect(touch.castShadow || touch.receiveShadow).toBe(false);
    expect(outline.visible).toBe(false);
    expect(shadowMap.dispose).toHaveBeenCalledOnce();
    expect(sunlight.shadow.map).toBeNull();
    expect(resize).toHaveBeenCalledOnce();
    preview.setQuality('high');
    expect(renderer.shadowMap.enabled).toBe(true);
    expect(renderer.shadowMap.needsUpdate).toBe(true);
    expect(holder.castShadow && holder.receiveShadow).toBe(true);
    expect(touch.castShadow).toBe(true);
    expect(touch.receiveShadow).toBe(false);
    expect(outline.visible).toBe(true);
    expect(holder.geometry).toBe(geometry);
    expect(Array.from(holder.geometry.getAttribute('position').array)).toEqual(positions);
    expect(project.dimensions).toEqual([10, 20, 4]);
  });

  it('changes the dark scene palette without replacing or moving printable meshes', () => {
    const { preview, holder, renderer, ground, updateGround, requestRender } = fixture();
    const geometry = holder.geometry;
    const position = holder.position.clone();
    preview.setTheme('dark');
    expect(renderer.setClearColor).toHaveBeenCalledWith(0x141c21, 0);
    expect(ground.material.color.getHex()).toBe(0x1a252a);
    expect(updateGround).toHaveBeenCalledOnce();
    expect(requestRender).toHaveBeenCalledOnce();
    expect(holder.geometry).toBe(geometry);
    expect(holder.position.equals(position)).toBe(true);
    preview.setTheme('light');
    expect(ground.material.color.getHex()).toBe(0xf0f1ed);
  });

  it('smooths curved shading while preserving vertex positions and hard cap edges', () => {
    const { preview } = fixture();
    const geometry = new THREE.CylinderGeometry(5, 5, 4, 48).toNonIndexed();
    const originalPositions = Array.from(geometry.getAttribute('position').array);
    Object.getPrototypeOf(preview).refineNormals(geometry);
    expect(Array.from(geometry.getAttribute('position').array)).toEqual(originalPositions);
    const normals = geometry.getAttribute('normal');
    const capGroup = geometry.groups.find(group => group.materialIndex === 1)!;
    for (let i = capGroup.start; i < capGroup.start + capGroup.count; i++) {
      expect(normals.getY(i)).toBeCloseTo(1, 6);
      expect(normals.getX(i)).toBeCloseTo(0, 6);
      expect(normals.getZ(i)).toBeCloseTo(0, 6);
    }
    expect(normals.getY(0)).toBeCloseTo(0, 6);
  });
});

function project(name: string): ProjectGeometry {
  return {
    parts: [{ id: name, name, scad: 'cube(1);', position: [0, 0, 0], rotation: [0, 0, 0], explode: [0, 0, 10], color: '#36566a' }],
    keys: [{ slotId: 'reference', type: 'A', position: [0, 0, 0], rotation: [0, 0, 0], partId: name }],
    dimensions: [10, 20, 4],
  };
}

describe('quality changes during asynchronous preview loading', () => {
  it('applies the current quality when a pending project commits', async () => {
    const { preview, partGroup, renderer } = fixture();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    Object.assign(preview, { loadReference: () => pending, createReference: async () => new THREE.Group() });
    const bytes = new STLExporter().parse(new THREE.Mesh(new THREE.BoxGeometry(10, 20, 4)), { binary: true }).buffer as ArrayBuffer;
    const before = bytes.slice(0);
    const loading = preview.setProject(project('new'), new Map([['new', bytes]]));
    preview.setQuality('low');
    release();
    await loading;
    expect(partGroup.children[0].name).toBe('new');
    expect(partGroup.children[0].castShadow).toBe(false);
    expect(partGroup.children[0].children[0].visible).toBe(false);
    expect(renderer.shadowMap.enabled).toBe(false);
    expect(new Uint8Array(bytes)).toEqual(new Uint8Array(before));
  });

  it('does not commit canceled geometry when quality changes during reference loading', async () => {
    const { preview, partGroup } = fixture();
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    Object.assign(preview, { loadReference: () => pending, createReference: async () => new THREE.Group() });
    const bytes = new STLExporter().parse(new THREE.Mesh(new THREE.BoxGeometry(10, 20, 4)), { binary: true }).buffer as ArrayBuffer;
    const abort = new AbortController();
    const loading = preview.setProject(project('cancelled'), new Map([['cancelled', bytes]]), abort.signal);
    preview.setQuality('low');
    abort.abort();
    release();
    await loading;
    expect(partGroup.children[0].name).toBe('previous');
  });
});
