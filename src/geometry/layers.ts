import { projectLayers } from '../layers';
import type { HolderConfig, ProjectGeometry, Vec3 } from '../types';
import { buildProject, inventoryTrayLayout, trayRetentionSpec, traySlideRelease, trayStackPitch } from './index';
import { H20_V7 } from './tray-h20';
import { TRAY_SNAP } from './tray-snap';
import { TRAY_LID, TRAY_STACK } from './library';
import { trayStackGap } from './tray-stack';

/** One mating footprint for the entire project, including in automatic sizing mode. */
export function traySetLayout(project: HolderConfig) {
  const layers = projectLayers(project);
  const layouts = layers.map(l => inventoryTrayLayout(layers.length > 1 && !l.config.slots.length && !l.config.options.tray.footprint
    ? { ...l.config, options: { ...l.config.options, tray: { ...l.config.options.tray, footprint: { width: 20, depth: 20 } } } } : l.config));
  const requiredWidth = Math.max(...layouts.map(l => l.requiredWidth));
  const requiredDepth = Math.max(...layouts.map(l => l.requiredDepth));
  const width = project.options.tray.footprint?.width ?? requiredWidth;
  const depth = project.options.tray.footprint?.depth ?? requiredDepth;
  return { width, depth, requiredWidth, requiredDepth,
    tooSmall: width + .00001 < requiredWidth || depth + .00001 < requiredDepth };
}

export function resolvedTrayLayers(project: HolderConfig) {
  const layers = projectLayers(project);
  if (project.template !== 'inventory_tray' || layers.length === 1) return layers;
  const { width, depth } = traySetLayout(project);
  return layers.map(layer => ({ ...layer, config: { ...layer.config, options: { ...layer.config.options,
    tray: { ...layer.config.options.tray, footprint: width && depth ? { width, depth } : null } } } }));
}

/** Trays and lids appear as independent editable/downloadable items; old files keep their lid settings. */
export function traySetItems(project: HolderConfig) {
  const layers = resolvedTrayLayers(project);
  const lidCount = layers.filter(l => l.config.options.tray.lid).length;
  return layers.flatMap((layer, index) => {
    const prefix = layers.length > 1 ? `layer-${index + 1}-` : '';
    const tray = { id: prefix + 'tray', name: layer.name, layerIndex: index, kind: 'tray' as 'tray' | 'lid', config: layer.config };
    return [tray, ...(layer.config.options.tray.lid ? [{ ...tray, id: prefix + 'tray-lid', kind: 'lid' as const,
      name: lidCount === 1 ? 'Lid' : `${layer.name} · Lid` }] : [])];
  });
}

/** Select printable items without recalculating the shared footprint or renumbering parts. */
export function selectTrayParts(geometry: ProjectGeometry, selected: ReadonlySet<string>): ProjectGeometry {
  const parts = geometry.parts.filter(part => selected.has(part.id));
  const ids = new Set(parts.map(part => part.id));
  return { ...geometry, parts, keys: geometry.keys.filter(key => key.partId && ids.has(key.partId)) };
}

/** Editing isolates a tray or lid; exports still use the original printable SCAD. */
export function buildTrayItem(project: HolderConfig, index: number, lid = false): ProjectGeometry {
  const config = resolvedTrayLayers(project)[index].config;
  const geometry = buildProject(config);
  if (config.template !== 'inventory_tray') return geometry;
  const t = config.options.tray;
  const snap = t.connection === 'snap_fit', h20 = t.connection === 'h20_slide_v7';
  const thickness = snap ? TRAY_SNAP.lidThickness : h20 ? H20_V7.lidThickness : TRAY_LID.thickness;
  const height = lid ? thickness : inventoryTrayLayout(config).height + Math.max(
    config.labels && config.slots.some(s => s.label.trim()) ? .35 : 0,
    t.retention ? Math.max(0, ...config.slots.map(s => trayRetentionSpec(s.type).peakHeight)) : 0,
    t.connection !== 'none' || t.lid ? trayStackGap(t.retention) + (snap ? TRAY_SNAP.captureHeight : h20 ? H20_V7.pinHeight : TRAY_STACK.tongueHeight) : 0,
  );
  return { ...geometry, dimensions: [geometry.dimensions[0], geometry.dimensions[1], height],
    parts: geometry.parts.filter(p => p.id === (lid ? 'tray-lid' : 'tray')).map(p => ({ ...p,
      position: [0, 0, lid && p.rotation[0] ? thickness : 0], explode: [0, 0, 0] })),
    keys: lid ? [] : geometry.keys };
}

/** Printable solids remain at Z=0 in their own files. Only the preview assembles the set. */
export function buildTraySet(config: HolderConfig): ProjectGeometry {
  const layers = resolvedTrayLayers(config);
  if (layers.length === 1) return buildProject(config);
  const geometry = layers.map(l => {
    try { return buildProject(l.config); }
    catch (error) { throw new Error(`${l.name}: ${(error as Error).message}`); }
  });
  const width = Math.max(...geometry.map(g => g.dimensions[0]));
  const depth = Math.max(...geometry.map(g => g.dimensions[1]));
  const result: ProjectGeometry = { parts: [], keys: [], dimensions: [width, depth, 0] };
  let z = 0, rowX = 0;
  for (const [index, layer] of layers.entries()) {
    const g = geometry[index];
    const prefix = `layer-${index + 1}-`;
    // Keep the entire set in one row; selection can focus any part without hiding its neighbours.
    const x = rowX, y = 0;
    rowX += g.dimensions[0] * (layer.config.options.tray.lid ? 2 : 1) + 20;
    for (const part of g.parts) {
      const position: Vec3 = [part.position[0], part.position[1], part.position[2] + z];
      result.parts.push({ ...part, id: prefix + part.id, name: `${layer.name} · ${part.name}`, position,
        explode: [part.explode[0] + x, part.explode[1] + y, part.explode[2] - z],
        ...(part.id === 'tray' && index > 0 && layers[index - 1].config.options.tray.connection === 'h20_slide_v7'
          ? { release: traySlideRelease(layers[index - 1].config) } : {}) });
    }
    result.keys.push(...g.keys.map(key => ({ ...key, slotId: prefix + key.slotId, partId: prefix + key.partId,
      position: [key.position[0], key.position[1], key.position[2] + z] as Vec3 })));
    result.dimensions[2] = Math.max(result.dimensions[2], z + g.dimensions[2]);
    const tray = layer.config.options.tray;
    z += tray.lid ? g.dimensions[2] : trayStackPitch(inventoryTrayLayout(layer.config).height, tray.retention);
  }
  return result;
}
