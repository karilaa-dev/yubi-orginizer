import { strToU8, zipSync } from 'fflate';
import { serializeConfig } from './config';
import type { HolderConfig, ProjectGeometry } from './types';

export const TRAY_SNAP_INSTRUCTIONS = 'Print the Enclosure snap-fit sample in PLA or PLA Matte first. Four solid frame-supported catches engage recesses in the mating perimeter skirt. Align matching layers and press straight down; lift one edge progressively at the finger notch to open. Keep the long perimeter channels clear so the skirt can flex. The default engagement is 0.2 mm; compare the supplied 0.1 and 0.3 mm sample alternatives if needed. Regenerate both mating parts: this joint is incompatible with earlier Snap fit and Cantilever prints. Physical fit, opening force and durability require a printed sample.';

/** Keep instructions tied to the exported tray connection. */
export function trayConnectionInstructions(config: HolderConfig): string[] {
  if (config.template === 'inventory_tray') {
    if (config.options.tray.connection === 'snap_fit') return [TRAY_SNAP_INSTRUCTIONS];
  }
  if (config.template === 'interface_tests') {
    if (config.options.interfaceTests.kind === 'tray_snap') return [TRAY_SNAP_INSTRUCTIONS];
    if (config.options.interfaceTests.kind === 'all') return [TRAY_SNAP_INSTRUCTIONS];
  }
  return [];
}

function trayLockPrintNotes(config: HolderConfig, project: ProjectGeometry): string[] {
  const snap = project.parts.some(p => p.id.startsWith('fit-tray-snap-')) || (config.template === 'inventory_tray' && config.options.tray.connection === 'snap_fit' && project.parts.some(p => p.id === 'tray'));
  if (!snap) return [];
  return [
    'ENCLOSURE SNAP-FIT', TRAY_SNAP_INSTRUCTIONS,
    'Four broad solid catches are integral with the frame. The surrounding receiver skirt supplies compliance. Inspect the 45-degree contact faces and narrow channel roof closures in the slicer.',
    'Print enclosure snap parts in PLA or PLA Matte, in the supplied orientation at 100% scale, with 5% infill and Arachne walls.',
    'Inspect the connection surfaces and clearance channels in the slicer before printing. Keep them free of supports.',
    'Use matching shell width/depth and Enclosure snap-fit on every layer.',
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
  window.dispatchEvent(new CustomEvent<DownloadReadyDetail>('keyform:download-ready', {
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
export function downloadProject(config: HolderConfig): void {
  downloadFile(`${config.template}.keyform.json`, serializeConfig(config), 'application/json');
}

/** One part downloads directly; multiple parts are collected in one format-specific ZIP. */
export function downloadParts(format: 'stl' | 'scad', config: HolderConfig, project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, partId?: string): void {
  const parts = partId ? project.parts.filter(p => p.id === partId) : project.parts;
  if (!parts.length) throw new Error('Choose a printable part.');
  const files: Record<string, Uint8Array> = {};
  for (const part of parts) {
    const bytes = meshes.get(part.id);
    if (!bytes) throw new Error(`${part.name} is not ready yet.`);
    files[`${part.id}.${format}`] = format === 'stl' ? new Uint8Array(bytes) : strToU8(part.scad);
  }
  if (parts.length === 1) {
    const [name, bytes] = Object.entries(files)[0];
    downloadFile(name, bytes.buffer as ArrayBuffer, format === 'stl' ? 'model/stl' : 'text/plain');
  } else {
    files['project.keyform.json'] = strToU8(serializeConfig(config));
    const printNotes = trayLockPrintNotes(config, project);
    if (printNotes.length) files['PRINTING.txt'] = strToU8(printNotes.join('\n'));
    downloadFile(`${config.template}-${format}.zip`, zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) }).buffer as ArrayBuffer, 'application/zip');
  }
}
/** Build the portable archive without touching the DOM, browser storage, or input data. */
export function buildPackage(config: HolderConfig, project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, fitTests = false): Uint8Array {
  const files: Record<string, Uint8Array> = { 'project.keyform.json': strToU8(serializeConfig(config)) };
  for (const part of project.parts) {
    const bytes = meshes.get(part.id);
    if (!bytes) throw new Error(`The ${part.name} model is not ready yet.`);
    files[`stl/${part.id}.stl`] = new Uint8Array(bytes);
    files[`scad/${part.id}.scad`] = strToU8(part.scad);
  }
  files['READ ME.txt'] = strToU8([
    'KEYFORM / YubiKey Organizer', '',
    fitTests ? 'Mechanical fit-test pieces' : config.template,
    'Units: millimeters. Import STL files at 100% scale.',
    'Every STL is a separate printable part resting on Z=0.',
    'Preview colors and illustrative keys are not included in printable meshes.',
    'Each SCAD file is self-contained. It uses Liberation Sans for text.',
    'Open project.keyform.json in Keyform to edit the organizer.', '',
    'Key sockets and body contours preserve the supplied calibrated geometry.',
    'The underlying 5Ci contour (~12.964 mm) differs from the research JSON (13.7 mm).',
    'Inventory trays add local 5Ci side-contact relief spanning 13.8 mm; physically verify it.',
    'The original contour and pocket floor remain unchanged. No global fit offset is applied.',
    'New rail, lid, tray lock, and Gridfinity interfaces require a physical fit test for your printer.',
    ...trayLockPrintNotes(config, project),
    'Gridfinity targets baseplate mating; no magnets or stacking rim.',
    'The travel case uses a lift-off lid; the rail has an open loading end.', '',
    'Parts:', ...project.parts.map(p => `- ${p.id}.stl: ${p.name}`), '',
  ].join('\n'));
  // Stable ZIP timestamps keep identical input files reproducible.
  return zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) });
}

export function downloadPackage(config: HolderConfig, project: ProjectGeometry, meshes: Map<string, ArrayBuffer>, fitTests = false): void {
  const zip = buildPackage(config, project, meshes, fitTests);
  downloadFile(`${fitTests ? 'fit-tests' : config.template}-keyform.zip`, zip.buffer as ArrayBuffer, 'application/zip');
}
