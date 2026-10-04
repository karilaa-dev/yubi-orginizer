import { strToU8, zipSync } from 'fflate';
import { serializeConfig, validateConfig } from './config';
import { traySlideMotionInstructions } from './tray-slide';
import type { HolderConfig, ProjectGeometry, TemplateId, TraySlideDirection } from './types';

/** Fired on `window` whenever a generated file is ready (see `downloadFile`). */
export const DOWNLOAD_READY_EVENT = 'yubi-orginizer:download-ready';
export const PROJECT_FILE_EXTENSION = '.yubi-orginizer.json';
const PROJECT_ENTRY = `project${PROJECT_FILE_EXTENSION}`;

// Stable ZIP timestamps keep identical input files reproducible.
const ZIP_OPTIONS = { level: 6, mtime: new Date(1980, 0, 1) } as const;

/**
 * File-name stem from a free-form name. Keeps Unicode and spaces; strips
 * <>:"/\|?* and control characters; at most 60 characters; no trailing dots or
 * spaces. Empty results and Windows reserved names give `fallback`.
 */
export function fileBaseName(projectName: string | undefined, fallback: string): string {
  const cleaned = (projectName ?? '')
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Slice by code point so an emoji is never cut in half.
  const stem = Array.from(cleaned).slice(0, 60).join('').replace(/[. ]+$/, '');
  return stem && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(stem) ? stem : fallback;
}

/** The usable name stem, or undefined when the name is blank or unusable. */
function namedBase(projectName: string | undefined): string | undefined {
  return fileBaseName(projectName, '') || undefined;
}

/**
 * Project file contents. Without a name this is exactly `serializeConfig(config)`.
 * With a name it is `{"name", ...validated config}`; older builds ignore "name".
 */
export function projectFileText(config: HolderConfig, projectName?: string): string {
  const name = projectName?.trim();
  if (!name) return serializeConfig(config);
  return JSON.stringify({ name, ...validateConfig(config) }, null, 2) + '\n';
}

export function trayH20Instructions(direction: TraySlideDirection = 'left'): string {
  return 'Slide-lock (H20/V7): use matching outside dimensions, connection, and slide direction on every layer. ' + traySlideMotionInstructions(direction) + ' Directions are viewed from above; front is the front-text edge. Two reinforced pins and two guides are integrated into each tray. Print at 100% scale using the same material as your H20 reference. Print trays pins-up and lids with their flat inside face down in the supplied orientation; inspect the sloped receiver roofs with supports disabled. This joint is incompatible with Stackable and older Snap-fit parts. Physical retention and durability need a printed test.';
}
export const TRAY_H20_INSTRUCTIONS = trayH20Instructions();

export const TRAY_SNAP_INSTRUCTIONS = 'Print Snap-fit parts in PLA or PLA Matte. Four solid frame-supported catches engage recesses in the mating perimeter skirt. Align matching layers and press straight down; lift one edge progressively at the finger notch to open. Keep the long perimeter channels clear so the skirt can flex. The default engagement is 0.2 mm. Regenerate both mating parts: this joint is incompatible with earlier Snap fit and Cantilever prints. Physical fit, opening force and durability require a printed test.';

/** Keep instructions tied to the exported tray connection. */
export function trayConnectionInstructions(config: HolderConfig): string[] {
  if (config.template === 'inventory_tray') {
    if (config.options.tray.connection === 'h20_slide_v7') return [trayH20Instructions(config.options.tray.slideDirection)];
    if (config.options.tray.connection === 'stackable') return ['Stackable: match outside dimensions on every tray; align the locating rims and lower straight down. Lift straight up to separate.'];
    if (config.options.tray.connection === 'snap_fit') return [TRAY_SNAP_INSTRUCTIONS];
  }
  return [];
}

function trayLockPrintNotes(config: HolderConfig, project: ProjectGeometry): string[] {
  const h20Notes = project.parts.some(p => p.id.startsWith('fit-tray-h20-')) || (config.template === 'inventory_tray' && config.options.tray.connection === 'h20_slide_v7') ? ['SLIDE-LOCK (H20/V7)', config.template === 'inventory_tray' ? trayH20Instructions(config.options.tray.slideDirection) : TRAY_H20_INSTRUCTIONS] : [];
  const snap = project.parts.some(p => p.id.startsWith('fit-tray-snap-')) || (config.template === 'inventory_tray' && config.options.tray.connection === 'snap_fit' && project.parts.some(p => p.id === 'tray' || p.id.endsWith('-tray')));
  if (!snap) return h20Notes;
  return [
    ...h20Notes, 'SNAP-FIT (OLDER VERSION)', TRAY_SNAP_INSTRUCTIONS,
    'Four broad solid catches are integral with the frame. The surrounding receiver skirt supplies compliance. Inspect the 45-degree contact faces and narrow channel roof closures in the slicer.',
    'Print Snap-fit parts in PLA or PLA Matte, in the supplied orientation at 100% scale, with 5% infill and Arachne walls.',
    'Inspect the connection surfaces and clearance channels in the slicer before printing. Keep them free of supports.',
    'Use the same Width, Depth and Snap-fit connection on every layer. New projects no longer offer Snap-fit, so make each extra layer with New matching layer, which copies all three.',
    'Regenerate mating parts when replacing an older lock print.',
    'Physical fit, release force, strength, and service life remain unqualified.',
  ];
}

export interface DownloadReadyDetail {
  name: string;
  url: string;
  byteLength: number;
}

let latestDownloadUrl: string | undefined;

export function downloadFile(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  if (latestDownloadUrl) URL.revokeObjectURL(latestDownloadUrl);
  latestDownloadUrl = url;
  // The visible recovery link remains valid until another file is generated.
  // Dispatching this event means the file exists, not that the browser saved it.
  window.dispatchEvent(new CustomEvent<DownloadReadyDetail>(DOWNLOAD_READY_EVENT, {
    detail: { name, url, byteLength: blob.size },
  }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  try { link.click(); }
  catch (error) { console.warn('Automatic download could not start. The generated file link remains available.', error); }
  finally { link.remove(); }
}
/** Saves `<name>.yubi-orginizer.json` (or `<template>.yubi-orginizer.json` without a usable name). */
export function downloadProject(config: HolderConfig, projectName?: string): void {
  const name = `${fileBaseName(projectName, config.template)}${PROJECT_FILE_EXTENSION}`;
  downloadFile(name, projectFileText(config, projectName), 'application/json');
}

/**
 * Download name for one part or a whole-project file.
 * Without a name: `${partId ?? template}.${extension}` (the pre-rename names).
 * With a name: `${base}.${extension}` when there is no partId or only one part,
 * otherwise `${base}-${partId}.${extension}`.
 */
export function partFileName(
  projectName: string | undefined,
  project: ProjectGeometry,
  template: TemplateId,
  extension: '3mf' | 'stl' | 'scad',
  partId?: string,
): string {
  const base = namedBase(projectName);
  if (!base) return `${partId ?? template}.${extension}`;
  if (!partId || project.parts.length === 1) return `${base}.${extension}`;
  return `${base}-${partId}.${extension}`;
}

/** One part downloads directly; multiple parts are collected in one format-specific ZIP. */
export function downloadParts(format: 'stl' | 'scad', config: HolderConfig, project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, partId?: string, projectName?: string): void {
  const parts = partId ? project.parts.filter(p => p.id === partId) : project.parts;
  if (!parts.length) throw new Error('Choose a printable part.');
  const files: Record<string, Uint8Array> = {};
  for (const part of parts) {
    const bytes = meshes.get(part.id);
    if (!bytes) throw new Error(`${part.name} is not ready yet.`);
    files[`${part.id}.${format}`] = format === 'stl' ? new Uint8Array(bytes) : strToU8(part.scad);
  }
  if (parts.length === 1) {
    const bytes = files[`${parts[0].id}.${format}`];
    const name = partFileName(projectName, project, config.template, format, parts[0].id);
    downloadFile(name, bytes.buffer as ArrayBuffer, format === 'stl' ? 'model/stl' : 'text/plain');
  } else {
    files[PROJECT_ENTRY] = strToU8(projectFileText(config, projectName));
    const printNotes = trayLockPrintNotes(config, project);
    if (printNotes.length) files['PRINTING.txt'] = strToU8(printNotes.join('\n'));
    const zipName = `${namedBase(projectName) ?? config.template}-${format}.zip`;
    downloadFile(zipName, zipSync(files, ZIP_OPTIONS).buffer as ArrayBuffer, 'application/zip');
  }
}
/** Build the portable archive without touching the DOM, browser storage, or input data. */
export function buildPackage(config: HolderConfig, project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, fitTests = false, projectName?: string): Uint8Array {
  const files: Record<string, Uint8Array> = { [PROJECT_ENTRY]: strToU8(projectFileText(config, projectName)) };
  for (const part of project.parts) {
    const bytes = meshes.get(part.id);
    if (!bytes) throw new Error(`The ${part.name} model is not ready yet.`);
    files[`stl/${part.id}.stl`] = new Uint8Array(bytes);
    files[`scad/${part.id}.scad`] = strToU8(part.scad);
  }
  files['READ ME.txt'] = strToU8([
    'yubi-orginizer / YubiKey organizer', '',
    projectName?.trim() || (fitTests ? 'Mechanical fit-test pieces' : config.template),
    'Units: millimeters. Import STL files at 100% scale.',
    'Every STL is a separate printable part resting on Z=0.',
    'Preview colors and illustrative keys are not included in printable meshes.',
    'Each SCAD file is self-contained. It uses Liberation Sans for text.',
    `Import ${PROJECT_ENTRY} on the yubi-orginizer Projects page to keep editing.`, '',
    'Key sockets and body contours preserve the supplied calibrated geometry.',
    'The underlying 5Ci contour (~12.964 mm) differs from the research JSON (13.7 mm).',
    'Inventory trays add local 5Ci side-contact relief spanning 13.8 mm; physically verify it.',
    'Original XY contours and upright USB socket fits are unchanged. Flat C Nano pockets support the USB-C connector root on a raised shelf and leave 1 mm of clearance beneath its tip for grabbing. No global fit offset is applied.',
    ...(config.template === 'inventory_tray' && config.options.tray.lid && config.options.tray.connection !== 'snap_fit' ? [
      `Lid style: ${config.options.tray.lidStyle === 'minimal' ? 'Minimal (closed 1.2 mm panel with exterior ribs)' : 'Regular (2.4 mm panel)'}. Both keep the inside face at the same seating plane as an upper tray.`,
      ...(config.options.tray.connection === 'h20_slide_v7' && config.options.tray.lidStyle === 'regular'
        ? ['The regular slide-lock lid has a continuous rounded border with recessed thumb grips at the sliding ends. Hold the tray and push the lid 6 mm opposite the chosen locking direction before lifting. Grip recesses do not change the H20 friction fit.'] : []),
      config.options.tray.connection === 'h20_slide_v7' || config.options.tray.lidStyle === 'minimal'
        ? 'Print the lid with its flat inside face on the bed and its exterior border/ribs/receiver housings upward. Keep the exported orientation.'
        : 'Print the regular lift-off lid exterior-down in its exported orientation.',
    ] : []),
    'New lid and tray connection interfaces require a physical fit test for your printer.',
    ...(config.template === 'desktop_dock' ? ['Desktop dock socket fit is still being refined. Print a small dock with one key before a full organizer.'] : []),
    ...trayLockPrintNotes(config, project), '',
    'Parts:', ...project.parts.map(p => `- ${p.id}.stl: ${p.name}`), '',
  ].join('\n'));
  return zipSync(files, ZIP_OPTIONS);
}

export function downloadPackage(config: HolderConfig, project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, fitTests = false, projectName?: string): void {
  const zip = buildPackage(config, project, meshes, fitTests, projectName);
  const base = fitTests ? 'fit-tests' : fileBaseName(projectName, config.template);
  downloadFile(`${base}-yubi-orginizer.zip`, zip.buffer as ArrayBuffer, 'application/zip');
}

/**
 * One ZIP holding `<name>.yubi-orginizer.json` for every project. Names that
 * collide (ignoring case) get " 2", " 3", … so no file is overwritten.
 */
export function projectsArchive(projects: readonly { name: string; config: HolderConfig }[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const { name, config } of projects) {
    const base = fileBaseName(name, config.template);
    let fileName = `${base}${PROJECT_FILE_EXTENSION}`;
    for (let n = 2; used.has(fileName.toLowerCase()); n++) fileName = `${base} ${n}${PROJECT_FILE_EXTENSION}`;
    used.add(fileName.toLowerCase());
    files[fileName] = strToU8(projectFileText(config, name));
  }
  return zipSync(files, ZIP_OPTIONS);
}

/** `yubi-orginizer-projects-YYYY-MM-DD.zip`, using the local date. */
export function projectsArchiveName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `yubi-orginizer-projects-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.zip`;
}
