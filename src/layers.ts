import { MAX_LAYERS, defaultConfig, validateConfig } from './config';
import type { HolderConfig, TrayLayer } from './types';
import { copyTrayLid, normalizeProjectLid } from './tray-lid';

export function singleLayer(config: HolderConfig): HolderConfig {
  const { layers: _layers, layerName: _name, ...layer } = config;
  return layer;
}

/** Old projects naturally have one layer; no storage rewrite or migration is needed. */
export function projectLayers(project: HolderConfig): TrayLayer[] {
  project = normalizeProjectLid(project);
  const { footprint, height, connection, slideDirection } = project.options.tray;
  return [{ name: project.layerName ?? 'Layer 1', config: singleLayer(project) }, ...(project.layers ?? [])].map(layer => ({
    ...layer, config: { ...layer.config, options: { ...layer.config.options,
      tray: { ...layer.config.options.tray, footprint, height, connection, slideDirection } } },
  }));
}

export function withLayers(layers: TrayLayer[]): HolderConfig {
  if (!layers.length) throw new Error('Keep at least one layer in the project.');
  return validateConfig({ ...singleLayer(layers[0].config), layerName: layers[0].name,
    ...(layers.length > 1 ? { layers: layers.slice(1).map(l => ({ name: l.name, config: singleLayer(l.config) })) } : {}) });
}

/** Indices follow the stack from bottom to top; the lid remains above every tray. */
export function moveLayer(project: HolderConfig, from: number, to: number): HolderConfig {
  const layers = projectLayers(project);
  if (from === to || !layers[from] || !layers[to]) return project;
  const [moved] = layers.splice(from, 1);
  layers.splice(to, 0, moved);
  return withLayers(layers);
}

export function replaceLayer(project: HolderConfig, index: number, config: HolderConfig): HolderConfig {
  const layers = projectLayers(project);
  if (!layers[index]) throw new Error('This layer no longer exists.');
  if (layers.length === 1 && project.layerName === undefined) return validateConfig(config);
  // The mating frame is shared by the set; key layouts and labels stay per layer.
  const before = layers[index].config.options.tray, after = config.options.tray;
  for (const key of ['footprint', 'height', 'connection', 'slideDirection'] as const) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      for (let i = 0; i < layers.length; i++) layers[i] = { ...layers[i], config: {
        ...layers[i].config, options: { ...layers[i].config.options, tray: { ...layers[i].config.options.tray, [key]: after[key] } },
      } };
    }
  }
  layers[index] = { ...layers[index], config: singleLayer(config) };
  return withLayers(layers);
}

export function appendLayer(project: HolderConfig, sourceIndex: number, options: {
  footprint: { width: number; depth: number }; name?: string; duplicate?: boolean;
}): HolderConfig {
  const layers = structuredClone(projectLayers(project));
  if (project.template !== 'inventory_tray') throw new Error('Matching layers are only available for inventory trays.');
  if (layers.length >= MAX_LAYERS) throw new Error(`A project may contain up to ${MAX_LAYERS} layers.`);
  const source = layers[sourceIndex];
  if (!source) throw new Error('This layer no longer exists.');
  const config = options.duplicate ? structuredClone(source.config) : defaultConfig();
  if (!options.duplicate) {
    config.slots = [];
    const { footprint, height, connection, slideDirection } = project.options.tray;
    Object.assign(config.options.tray, { footprint, height, connection, slideDirection });
  }
  config.options.tray.lid = false;
  let n = layers.length + 1;
  while (layers.some(l => l.name === `Layer ${n}`)) n++;
  layers.push({ name: options.name ?? `Layer ${n}`, config });
  return withLayers(layers);
}

/** Removing a tray keeps the project's lid on the remaining top tray. */
export function removeLayer(project: HolderConfig, index: number): HolderConfig {
  const layers = projectLayers(project);
  if (!layers[index]) throw new Error('This layer no longer exists.');
  if (layers.length === 1) throw new Error('Keep at least one layer in the project.');
  const [removed] = layers.splice(index, 1);
  if (removed.config.options.tray.lid) {
    const top = layers.at(-1)!;
    top.config = { ...top.config, options: { ...top.config.options,
      tray: copyTrayLid(top.config.options.tray, removed.config.options.tray) } };
  }
  return withLayers(layers);
}

export const projectKeyCount = (project: HolderConfig): number => projectLayers(project).reduce((n, l) => n + l.config.slots.length, 0);
