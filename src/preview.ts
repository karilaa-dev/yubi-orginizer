import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import type { KeyPlacement, KeyType, PartSpec, ProjectGeometry, Vec3 } from './types';
import { ISOMETRIC_DIRECTION, explodeDuration, explodePathPoint } from './preview-layout';

type ReferenceComponent = 'body' | 'connector' | 'touch';
type PreviewView = 'iso' | 'top' | 'front';
export type PreviewTheme = 'light' | 'dark';
export type PreviewQuality = 'high' | 'low';
type PositionedObject = {
  object: THREE.Object3D;
  partId?: string;
  position: Vec3;
  explode: Vec3;
  /** Slide before lifting (slide-lock), or ZERO. */
  release: Vec3;
};
type CameraPose = { position: THREE.Vector3; target: THREE.Vector3; radius: number; distance: number };

const REFERENCE_COMPONENTS: ReferenceComponent[] = ['body', 'connector', 'touch'];
const ZERO: Vec3 = [0, 0, 0];
const ISO_DIRECTION = new THREE.Vector3(...ISOMETRIC_DIRECTION).normalize();
const MAX_PREVIEW_PIXELS = 12_000_000;

/** Bound the drawing buffer, including supersampling on standard-density screens. */
export function previewPixelRatio(width: number, height: number, nativeRatio: number, quality: PreviewQuality, maxDimension = 8192): number {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  const deviceRatio = Number.isFinite(nativeRatio) && nativeRatio > 0 ? nativeRatio : 1;
  const desired = quality === 'high'
    ? Math.min(3, Math.max(1.5, deviceRatio))
    : Math.max(0.5, Math.min(deviceRatio, 1.25) * 0.85);
  const limit = Number.isFinite(maxDimension) && maxDimension > 0 ? maxDimension : 8192;
  return Math.min(desired, Math.sqrt(MAX_PREVIEW_PIXELS / (w * h)), limit / w, limit / h);
}

/** Displays already manufactured STL geometry. This class never generates printable shapes. */
export class OrganizerPreview {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly loader = new STLLoader();
  private readonly resizeObserver: ResizeObserver;
  private readonly partGroup = new THREE.Group();
  private readonly keyGroup = new THREE.Group();
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private readonly sunlight: THREE.DirectionalLight;
  private readonly ambient: THREE.HemisphereLight;
  private readonly fill: THREE.DirectionalLight;
  private readonly maxDrawingDimension: number;
  private readonly keyCache = new Map<string, Promise<THREE.BufferGeometry>>();
  private readonly requests = new AbortController();
  private grid: THREE.GridHelper | undefined;
  private placements: PositionedObject[] = [];
  private project: ProjectGeometry | undefined;
  private showKeys = true;
  private exploded = true;
  private theme: PreviewTheme = 'light';
  private quality: PreviewQuality = 'high';
  private disposed = false;
  private frame: number | undefined;
  private revision = 0;
  private fitted = false;
  private bounds = new THREE.Box3();
  private focusedPart: string | undefined;
  private focusTween: { frame: number; start: number; fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; pose: CameraPose } | undefined;
  /** 0 = assembled, 1 = exploded; between the two while parts move (explodePathPoint). */
  private explodeProgress = 1;
  /** Explode / collapse in progress. The camera eases to the new framing until the user takes over. */
  private explodeTween: {
    frame: number; last: number; duration: number;
    camera?: { fromPosition: THREE.Vector3; fromTarget: THREE.Vector3; pose: CameraPose; start: number; length: number };
  } | undefined;
  private readonly onControlsChange = () => this.requestRender();
  /** Orbiting during an explode animation hands the camera back to the user. */
  private readonly onControlsStart = () => {
    if (this.explodeTween) this.explodeTween.camera = undefined;
    this.stopFocusTween();
  };
  private readonly onWindowResize = () => this.resize();
  private readonly onVisibilityChange = () => {
    if (document.visibilityState === 'visible') this.requestRender();
  };
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.container.dispatchEvent(new CustomEvent('preview-warning', {
      detail: 'The 3D preview paused because the graphics context was lost. Reload to restore it.',
    }));
  };
  private readonly onContextRestored = () => this.requestRender();

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'default' });
    this.maxDrawingDimension = Math.min(this.renderer.capabilities.maxTextureSize, this.renderer.getContext().getParameter(this.renderer.getContext().MAX_RENDERBUFFER_SIZE));
    this.renderer.setClearColor(0xf3f4f2, 0);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.className = 'preview-canvas';
    this.renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px';
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('role', 'img');
    this.renderer.domElement.setAttribute('aria-label', '3D organizer preview. Drag to orbit, scroll or pinch to zoom. Use the view buttons for keyboard navigation.');
    this.container.append(this.renderer.domElement);
    this.container.dataset.previewTheme = this.theme;
    this.container.dataset.previewQuality = this.quality;

    this.camera.up.set(0, 0, 1);
    this.camera.position.copy(ISO_DIRECTION).multiplyScalar(260);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    // Render only on interaction or state changes. No perpetual animation loop or damping.
    this.controls.enableDamping = false;
    this.controls.screenSpacePanning = true;
    this.controls.minPolarAngle = 0.005;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.015;
    this.controls.rotateSpeed = 0.7;
    this.controls.zoomSpeed = 0.9;
    this.controls.addEventListener('change', this.onControlsChange);
    this.controls.addEventListener('start', this.onControlsStart);

    this.ambient = new THREE.HemisphereLight(0xffffff, 0x899baa, 2.15);
    this.scene.add(this.ambient);
    this.sunlight = new THREE.DirectionalLight(0xfff9ed, 3.2);
    this.sunlight.position.set(-100, -140, 260);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(2048, 2048);
    this.sunlight.shadow.bias = -0.0002;
    this.sunlight.shadow.normalBias = 0.045;
    this.sunlight.shadow.radius = 1.8;
    this.scene.add(this.sunlight, this.sunlight.target);
    this.fill = new THREE.DirectionalLight(0xdce7ff, 1.0);
    this.fill.position.set(120, 90, 160);
    this.scene.add(this.fill);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0xf0f1ed, roughness: 1, metalness: 0 }),
    );
    this.ground.receiveShadow = true;
    this.ground.position.z = -0.12;
    this.scene.add(this.ground, this.partGroup, this.keyGroup);
    this.updateGround(new THREE.Box3(new THREE.Vector3(-50, -40, 0), new THREE.Vector3(50, 40, 40)));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    window.addEventListener('resize', this.onWindowResize);
    this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resize();
  }

  async setProject(project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, signal?: AbortSignal): Promise<void> {
    if (this.disposed || signal?.aborted) return;
    const revision = ++this.revision;
    const superseded = () => this.disposed || revision !== this.revision || signal?.aborted === true;
    const nextParts = new THREE.Group();
    const nextKeys = new THREE.Group();
    const nextPlacements: PositionedObject[] = [];
    let referenceError: unknown;
    try {
      for (const part of project.parts) {
        const bytes = meshes.get(part.id);
        if (!bytes) throw new Error(`The printable mesh for ${part.name} is missing.`);
        const geometry = this.loader.parse(bytes);
        this.assertGeometry(geometry, part.name);
        this.refineNormals(geometry);
        const material = new THREE.MeshStandardMaterial({
          color: part.color,
          roughness: 0.64,
          metalness: 0.035,
          flatShading: false,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = part.name;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.rotation.set(...part.rotation, 'XYZ');
        // A restrained outline makes the actual STL openings legible at small scales.
        if (geometry.getAttribute('position').count < 450000) {
          const edge = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry, 36),
            new THREE.LineBasicMaterial({ color: 0x20343d, transparent: true, opacity: 0.14 }),
          );
          edge.visible = this.quality === 'high';
          mesh.add(edge);
        }
        nextParts.add(mesh);
        nextPlacements.push({ object: mesh, partId: part.id, position: part.position, explode: part.explode, release: part.release ?? ZERO });
      }

      try {
        // References are fetched from local PWA assets, never from an external service.
        const keyTypes = [...new Set(project.keys.map((key) => key.type))];
        await Promise.all(keyTypes.flatMap((type) =>
          REFERENCE_COMPONENTS.map((component) => this.loadReference(type, component)),
        ));
        if (!superseded()) {
          for (const key of project.keys) {
            const object = await this.createReference(key);
            nextKeys.add(object);
            const parent = this.keyParent(key, project.parts);
            nextPlacements.push({ object, partId: parent?.id, position: key.position, explode: parent?.explode ?? ZERO, release: parent?.release ?? ZERO });
          }
        }
      } catch (error) {
        // A missing display asset must never leave an old holder visible beside
        // a newly enabled export. Commit the current printable meshes alone.
        this.disposeGroup(nextKeys);
        nextPlacements.splice(project.parts.length);
        referenceError = error;
      }
    } catch (error) {
      this.disposeGroup(nextParts);
      this.disposeGroup(nextKeys);
      if (!superseded()) throw error;
      return;
    }
    if (superseded()) {
      this.disposeGroup(nextParts);
      this.disposeGroup(nextKeys);
      return;
    }

    const previousFraming = this.framingBounds();
    this.stopFocusTween();
    this.disposeGroup(this.partGroup);
    this.disposeGroup(this.keyGroup);
    if (nextParts.children.length) this.partGroup.add(...[...nextParts.children]);
    if (nextKeys.children.length) this.keyGroup.add(...[...nextKeys.children]);
    this.stopExplodeTween();
    this.placements = nextPlacements;
    this.project = project;
    this.applyQuality();
    this.keyGroup.visible = this.showKeys;
    this.applyPositions();
    const previousSize = previousFraming.getSize(new THREE.Vector3()).length();
    this.refreshBounds();
    const framing = this.framingBounds();
    const size = framing.getSize(new THREE.Vector3()).length();
    this.updateGround(this.bounds);
    if (!this.fitted || previousSize === 0 || Math.abs(size / previousSize - 1) > 0.18
      || framing.getCenter(new THREE.Vector3()).distanceTo(previousFraming.getCenter(new THREE.Vector3())) > .1) {
      this.fitCamera(!this.fitted);
    }
    this.container.dataset.partCount = String(project.parts.length);
    this.requestRender();
    if (referenceError) throw referenceError;
  }

  setShowKeys(show: boolean): void {
    this.showKeys = show;
    this.keyGroup.visible = show;
    this.renderer.shadowMap.needsUpdate = this.quality === 'high';
    this.refreshBounds();
    this.requestRender();
  }

  /** Keep every part visible, but orbit and frame the item being edited. */
  setFocusedPart(partId?: string): void {
    if (this.disposed || this.focusedPart === partId) return;
    this.stopFocusTween();
    this.stopExplodeTween();
    this.focusedPart = partId;
    this.applyFocus();
    this.refreshBounds();
    if (!this.project) return;
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const pose = this.cameraPose(this.framingBounds(), direction);
    if (document.visibilityState !== 'visible' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.applyPose(pose);
      return;
    }
    this.focusTween = { frame: 0, start: performance.now(), fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), pose };
    this.focusTween.frame = requestAnimationFrame(this.stepFocus);
  }

  private readonly stepFocus = (now: number): void => {
    const tween = this.focusTween;
    if (!tween || this.disposed) return;
    const t = Math.min(1, Math.max(0, now - tween.start) / 450);
    const eased = t * t * (3 - 2 * t);
    this.camera.position.lerpVectors(tween.fromPosition, tween.pose.position, eased);
    this.controls.target.lerpVectors(tween.fromTarget, tween.pose.target, eased);
    this.controls.update();
    this.requestRender();
    if (t < 1) tween.frame = requestAnimationFrame(this.stepFocus);
    else { this.focusTween = undefined; this.applyPose(tween.pose); }
  };

  private stopFocusTween(): void {
    if (this.focusTween) cancelAnimationFrame(this.focusTween.frame);
    this.focusTween = undefined;
  }

  setExploded(exploded: boolean): void {
    if (this.exploded === exploded) return;
    this.stopFocusTween();
    this.exploded = exploded;
    const target = exploded ? 1 : 0;
    const animate = this.placements.length > 0 && !this.disposed && document.visibilityState === 'visible'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!animate) {
      this.stopExplodeTween();
      this.explodeProgress = target;
      this.applyPositions();
      this.refreshBounds();
      this.updateGround(this.bounds);
      this.fitCamera(false);
      return;
    }
    // Frame the arrangement the parts move to; the ground covers both while they move.
    const current = this.explodeProgress;
    const boundsAt = (progress: number): THREE.Box3 => {
      this.explodeProgress = progress;
      this.applyPositions();
      this.refreshBounds();
      return this.bounds.clone();
    };
    const from = boundsAt(1 - target), to = boundsAt(target);
    const framing = this.framingBounds();
    this.explodeProgress = current;
    this.applyPositions();
    this.updateGround(from.union(to));
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const pose = this.cameraPose(framing, direction);
    // Limits that fit both framings, so neither the controls nor the clip planes cut in while moving.
    this.controls.minDistance = Math.min(this.controls.minDistance, pose.radius * 0.7);
    this.controls.maxDistance = Math.max(this.controls.maxDistance, pose.distance * 7);
    this.camera.near = Math.min(this.camera.near, Math.max(pose.radius / 1000, 0.01));
    this.camera.far = Math.max(this.camera.far, pose.distance * 16);
    this.camera.updateProjectionMatrix();

    const now = performance.now();
    const duration = explodeDuration(this.placements.some(p => p.release.some(v => v !== 0)));
    // Toggling again mid-way sends the parts back along the same path from where they are.
    const previous = this.explodeTween;
    const userCamera = !!previous && !previous.camera;
    const camera = userCamera ? undefined : {
      fromPosition: this.camera.position.clone(), fromTarget: this.controls.target.clone(), pose,
      start: now, length: Math.max(1, duration * Math.abs(target - current)),
    };
    if (previous) { previous.camera = camera; previous.duration = duration; return; }
    this.explodeTween = { frame: 0, last: now, duration, camera };
    this.explodeTween.frame = requestAnimationFrame(this.stepExplode);
  }

  private readonly stepExplode = (now: number): void => {
    const tween = this.explodeTween;
    if (!tween || this.disposed) return;
    const target = this.exploded ? 1 : 0;
    const step = Math.max(0, now - tween.last) / tween.duration;
    tween.last = now;
    this.explodeProgress = target > this.explodeProgress
      ? Math.min(target, this.explodeProgress + step)
      : Math.max(target, this.explodeProgress - step);
    this.applyPositions();
    const camera = tween.camera;
    if (camera) {
      const t = Math.min(1, Math.max(0, now - camera.start) / camera.length);
      const k = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(camera.fromPosition, camera.pose.position, k);
      this.controls.target.lerpVectors(camera.fromTarget, camera.pose.target, k);
      this.controls.update();
    }
    this.renderer.shadowMap.needsUpdate = this.quality === 'high';
    if (this.explodeProgress !== target) {
      tween.frame = requestAnimationFrame(this.stepExplode);
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.explodeTween = undefined;
    this.refreshBounds();
    this.updateGround(this.bounds);
    if (camera) this.applyPose(camera.pose);
    else this.requestRender();
  };

  /** Ends an explode animation at its final arrangement (the camera stays where it is). */
  private stopExplodeTween(): void {
    if (!this.explodeTween) return;
    cancelAnimationFrame(this.explodeTween.frame);
    this.explodeTween = undefined;
    this.explodeProgress = this.exploded ? 1 : 0;
    this.applyPositions();
  }

  setTheme(theme: PreviewTheme): void {
    if (this.disposed || this.theme === theme) return;
    this.theme = theme;
    const dark = theme === 'dark';
    this.renderer.setClearColor(dark ? 0x141c21 : 0xf3f4f2, 0);
    this.renderer.toneMappingExposure = dark ? 1.12 : 1.08;
    this.ground.material.color.setHex(dark ? 0x1a252a : 0xf0f1ed);
    this.ambient.color.setHex(dark ? 0xd2e6f0 : 0xffffff);
    this.ambient.groundColor.setHex(dark ? 0x243848 : 0x899baa);
    this.ambient.intensity = dark ? 2.3 : 2.15;
    this.fill.intensity = dark ? 1.35 : 1;
    this.updateGround(this.bounds);
    this.container.dataset.previewTheme = theme;
    this.requestRender();
  }

  setQuality(quality: PreviewQuality): void {
    if (this.disposed || this.quality === quality) return;
    this.quality = quality;
    this.applyQuality();
    this.resize();
  }

  resetCamera(): void {
    this.stopFocusTween();
    if (this.explodeTween) this.explodeTween.camera = undefined;
    this.fitCamera(true);
  }

  setView(view: PreviewView): void {
    this.stopFocusTween();
    const direction = view === 'top'
      ? new THREE.Vector3(0, -0.005, 1).normalize()
      : view === 'front'
        ? new THREE.Vector3(0, -1, 0.015).normalize()
        : ISO_DIRECTION;
    if (this.explodeTween) this.explodeTween.camera = undefined;
    this.fitCamera(false, direction);
  }

  dispose(): void {
    this.disposed = true;
    this.revision++;
    this.requests.abort();
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    window.removeEventListener('resize', this.onWindowResize);
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onContextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.stopExplodeTween();
    this.stopFocusTween();
    this.controls.removeEventListener('change', this.onControlsChange);
    this.controls.removeEventListener('start', this.onControlsStart);
    this.controls.dispose();
    this.disposeGroup(this.partGroup);
    this.disposeGroup(this.keyGroup);
    this.ground.geometry.dispose();
    this.ground.material.dispose();
    this.disposeGrid();
    this.sunlight.shadow.map?.dispose();
    for (const promise of this.keyCache.values()) void promise.then((geometry) => geometry.dispose()).catch(() => {});
    this.keyCache.clear();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private keyParent(key: KeyPlacement, parts: PartSpec[]): PartSpec | undefined {
    return parts.find((part) => part.id === key.partId) ?? (parts.length === 1 ? parts[0] : undefined);
  }

  private loadReference(type: KeyType, component: ReferenceComponent): Promise<THREE.BufferGeometry> {
    const name = `${type}-${component}`;
    let cached = this.keyCache.get(name);
    if (!cached) {
      cached = fetch(`${import.meta.env.BASE_URL}keys/${name}.stl`, { signal: this.requests.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Could not load the ${type} reference key (${response.status}).`);
          const geometry = this.loader.parse(await response.arrayBuffer());
          this.assertGeometry(geometry, `${type} reference`);
          this.refineNormals(geometry);
          return geometry;
        }).catch((error: unknown) => {
          this.keyCache.delete(name);
          throw error;
        });
      this.keyCache.set(name, cached);
    }
    return cached;
  }

  private async createReference(key: KeyPlacement): Promise<THREE.Group> {
    const group = new THREE.Group();
    group.name = `Reference key ${key.slotId}`;
    group.rotation.set(...key.rotation, 'XYZ');
    for (const component of REFERENCE_COMPONENTS) {
      const geometry = (await this.loadReference(key.type, component)).clone();
      const connectorIsDark = key.type === 'A' || key.type === 'AN';
      const isMetal = component === 'connector' && !connectorIsDark;
      const isGold = component === 'touch';
      const material = new THREE.MeshStandardMaterial({
        color: isGold ? 0xd4ad50 : isMetal ? 0xadb6bf : 0x202729,
        metalness: isGold ? 0.7 : isMetal ? 0.82 : 0.08,
        roughness: isGold || isMetal ? 0.3 : 0.58,
        flatShading: false,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.referenceComponent = component;
      mesh.castShadow = true;
      mesh.receiveShadow = component !== 'touch';
      group.add(mesh);
    }
    return group;
  }

  private assertGeometry(geometry: THREE.BufferGeometry, name: string): void {
    const positions = geometry.getAttribute('position');
    if (!positions || positions.count < 3) {
      geometry.dispose();
      throw new Error(`${name} produced an empty mesh.`);
    }
    geometry.computeBoundingBox();
    const values = [...geometry.boundingBox!.min.toArray(), ...geometry.boundingBox!.max.toArray()];
    if (!values.every(Number.isFinite)) {
      geometry.dispose();
      throw new Error(`${name} contains invalid mesh coordinates.`);
    }
  }

  private refineNormals(geometry: THREE.BufferGeometry): void {
    // Only shading normals change. Original STL vertex positions, sharp corners,
    // and exported manufacturing bytes are preserved. Bound work for huge scenes.
    if (geometry.getAttribute('position').count <= 450000) {
      toCreasedNormals(geometry, THREE.MathUtils.degToRad(25));
    }
  }

  private applyQuality(): void {
    const high = this.quality === 'high';
    this.renderer.shadowMap.enabled = high;
    this.sunlight.castShadow = high;
    this.ground.receiveShadow = high;
    for (const group of [this.partGroup, this.keyGroup]) {
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = high;
          // Thin contact overlays sit only 0.05 mm above their bodies; receiving
          // their own shadow produces speckling at this scale. They still cast
          // shadows onto the holder and surrounding surfaces.
          object.receiveShadow = high && object.userData.referenceComponent !== 'touch';
        } else if (object instanceof THREE.LineSegments) {
          object.visible = high;
        }
      });
    }
    if (!high && this.sunlight.shadow.map) {
      this.sunlight.shadow.map.dispose();
      this.sunlight.shadow.map = null;
    }
    this.renderer.shadowMap.needsUpdate = high;
    this.container.dataset.previewQuality = this.quality;
    this.applyFocus();
  }

  private applyFocus(): void {
    const focus = this.placements.some(p => p.partId === this.focusedPart) ? this.focusedPart : undefined;
    for (const { object, partId } of this.placements) {
      const muted = focus !== undefined && partId !== focus;
      object.traverse(child => {
        if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) return;
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        for (const material of materials) {
          const base = material.userData.focusBase ??= { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
          material.opacity = base.opacity * (muted ? .25 : 1);
          material.transparent = base.transparent || muted;
          material.depthWrite = base.depthWrite && !muted;
          material.needsUpdate = true;
        }
        child.castShadow = this.quality === 'high' && !muted;
        child.receiveShadow = this.quality === 'high' && !muted && child.userData.referenceComponent !== 'touch';
      });
    }
    this.container.dataset.focusedPart = focus ?? '';
    this.renderer.shadowMap.needsUpdate = this.quality === 'high';
    this.requestRender();
  }

  private framingBounds(): THREE.Box3 {
    if (!this.focusedPart) return this.bounds.clone();
    const bounds = new THREE.Box3();
    for (const { object, partId } of this.placements) {
      if (partId !== this.focusedPart || (!this.showKeys && object.parent === this.keyGroup)) continue;
      bounds.union(new THREE.Box3().setFromObject(object));
    }
    return bounds.isEmpty() ? this.bounds.clone() : bounds;
  }

  private applyPositions(): void {
    for (const { object, position, explode, release } of this.placements) {
      object.position.set(...explodePathPoint(position, explode, release, this.explodeProgress));
    }
  }

  private refreshBounds(): void {
    this.partGroup.updateMatrixWorld(true);
    this.keyGroup.updateMatrixWorld(true);
    this.bounds.setFromObject(this.partGroup);
    if (this.showKeys && this.keyGroup.children.length) {
      this.bounds.union(new THREE.Box3().setFromObject(this.keyGroup));
    }
    if (this.bounds.isEmpty()) {
      this.bounds.set(new THREE.Vector3(-40, -30, 0), new THREE.Vector3(40, 30, 20));
    }
  }

  private fitCamera(reset: boolean, requestedDirection?: THREE.Vector3): void {
    const direction = requestedDirection?.clone() ?? (reset
      ? ISO_DIRECTION.clone()
      : this.camera.position.clone().sub(this.controls.target).normalize());
    this.applyPose(this.cameraPose(this.framingBounds(), direction));
  }

  /** Where the camera looks from to frame `bounds` along `direction`. */
  private cameraPose(bounds: THREE.Box3, direction: THREE.Vector3): CameraPose {
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty() ? new THREE.Vector3(100, 80, 40) : bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 12);
    const verticalFov = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * this.camera.aspect);
    const distance = radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.13;
    return { position: center.clone().addScaledVector(direction, distance), target: center, radius, distance };
  }

  private applyPose({ position, target, radius, distance }: CameraPose): void {
    this.camera.position.copy(position);
    this.controls.target.copy(target);
    this.controls.minDistance = radius * 0.7;
    const sceneSpan = this.bounds.getSize(new THREE.Vector3()).length();
    this.controls.maxDistance = Math.max(distance * 7, sceneSpan * 4);
    this.camera.near = Math.max(radius / 1000, 0.01);
    this.camera.far = Math.max(distance * 16, sceneSpan * 8);
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.fitted = true;
    this.requestRender();
  }

  private updateGround(bounds: THREE.Box3): void {
    const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3());
    const size = bounds.isEmpty() ? new THREE.Vector3(100, 80, 40) : bounds.getSize(new THREE.Vector3());
    const span = Math.max(160, Math.ceil(Math.max(size.x, size.y, size.z) * 2 / 20) * 20);
    this.ground.scale.set(span * 16, span * 16, 1);
    this.ground.position.set(center.x, center.y, -0.16);
    this.disposeGrid();
    const dark = this.theme === 'dark';
    this.grid = new THREE.GridHelper(span, span / 10, dark ? 0x405761 : 0xcbd2cf, dark ? 0x2e4048 : 0xdce1db);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.set(Math.round(center.x / 10) * 10, Math.round(center.y / 10) * 10, -0.13);
    const gridMaterial = this.grid.material as THREE.LineBasicMaterial;
    gridMaterial.transparent = true;
    gridMaterial.opacity = dark ? 0.58 : 0.62;
    this.scene.add(this.grid);
    this.sunlight.position.set(center.x - span * 0.5, center.y - span * 0.7, span * 1.3);
    this.sunlight.target.position.copy(center);
    const camera = this.sunlight.shadow.camera;
    camera.left = -span / 2;
    camera.right = span / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.near = 0.5;
    camera.far = span * 4;
    camera.updateProjectionMatrix();
    this.renderer.shadowMap.needsUpdate = this.quality === 'high';
  }

  private disposeGrid(): void {
    if (!this.grid) return;
    this.grid.geometry.dispose();
    const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of materials) material.dispose();
    this.scene.remove(this.grid);
    this.grid = undefined;
  }

  private disposeGroup(group: THREE.Group): void {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) material.dispose();
      }
    });
    group.clear();
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    const previousAspect = this.camera.aspect;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const ratio = previewPixelRatio(width, height, window.devicePixelRatio, this.quality, this.maxDrawingDimension);
    if (this.renderer.getPixelRatio() !== ratio) this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.container.dataset.previewPixelRatio = ratio.toFixed(3);
    if (this.project && Math.abs(previousAspect / this.camera.aspect - 1) > 0.15) this.fitCamera(false);
    this.requestRender();
  }

  private requestRender(): void {
    if (this.disposed || this.frame !== undefined || document.visibilityState === 'hidden') return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (!this.disposed) this.renderer.render(this.scene, this.camera);
    });
  }
}
