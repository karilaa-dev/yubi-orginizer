import type { HolderConfig, HolderOptions } from './types';

const LID_FIELDS = ['lid', 'lidStyle', 'lidText', 'lidTextSize', 'lidTextPercent', 'lidTextRotation'] as const;

/** Move the complete lid, including legacy text sizing, without copying tray settings. */
export function copyTrayLid(target: HolderOptions['tray'], source: HolderOptions['tray']): HolderOptions['tray'] {
  const next = { ...target };
  for (const key of LID_FIELDS) {
    if (source[key] === undefined) delete (next as Partial<HolderOptions['tray']>)[key];
    else Object.assign(next, { [key]: source[key] });
  }
  return next;
}

/** The project has one lid above its top tray. Older sets use their uppermost enabled lid. */
export function normalizeProjectLid(project: HolderConfig): HolderConfig {
  if (project.template !== 'inventory_tray' || !project.layers?.length) return project;
  const configs = [project, ...project.layers.map(layer => layer.config)];
  if (!configs.slice(0, -1).some(config => config.options.tray.lid)) return project;
  const lid = [...configs].reverse().find(config => config.options.tray.lid)!.options.tray;
  const normalized = configs.map((config, index) => ({ ...config, options: { ...config.options,
    tray: index === configs.length - 1 ? copyTrayLid(config.options.tray, lid) : { ...config.options.tray, lid: false },
  } }));
  return { ...normalized[0], layers: project.layers.map((layer, index) => ({ ...layer, config: normalized[index + 1] })) };
}
