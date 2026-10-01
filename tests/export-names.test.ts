import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { defaultConfig, parseConfig, serializeConfig } from '../src/config';
import {
  DOWNLOAD_READY_EVENT, PROJECT_FILE_EXTENSION, buildPackage, fileBaseName, partFileName, projectFileText,
  projectsArchive, projectsArchiveName, type DownloadReadyDetail,
} from '../src/export';
import { buildProject } from '../src/geometry';
import { createMemoryStorage, importProject } from '../src/projects';
import type { HolderConfig, PartSpec, ProjectGeometry } from '../src/types';

function part(id: string): PartSpec {
  return { id, name: id, scad: `// ${id}\n`, position: [0, 0, 0], rotation: [0, 0, 0], explode: [0, 0, 0], color: '#ffffff' };
}
const geometry = (...ids: string[]): ProjectGeometry => ({ parts: ids.map(part), keys: [], dimensions: [10, 10, 10] });
const meshesFor = (project: ProjectGeometry) => new Map(project.parts.map(p => [p.id, new Uint8Array([1, 2, 3]).buffer]));

function lidTray(): HolderConfig {
  const config = defaultConfig();
  config.template = 'inventory_tray';
  config.options.tray.lid = true;
  return config;
}

describe('export identifiers', () => {
  it('uses the yubi-orginizer event name and project file extension', () => {
    expect(DOWNLOAD_READY_EVENT).toBe('yubi-orginizer:download-ready');
    expect(PROJECT_FILE_EXTENSION).toBe('.yubi-orginizer.json');
  });
});

describe('fileBaseName', () => {
  it('strips characters that file systems reject and collapses the gaps', () => {
    expect(fileBaseName('Desk: "main" tray?', 'x')).toBe('Desk main tray');
    expect(fileBaseName('a/b\\c|d*e<f>g', 'x')).toBe('a b c d e f g');
    expect(fileBaseName('tab\there\u0000\u007fend', 'x')).toBe('tab here end');
  });

  it('keeps Unicode and spaces, normalised to NFC', () => {
    expect(fileBaseName('Ключі', 'x')).toBe('Ключі');
    expect(fileBaseName('Desk – layer 2', 'x')).toBe('Desk – layer 2');
    expect(fileBaseName('Cafe\u0301', 'x')).toBe('Caf\u00e9');
  });

  it('falls back for blank, dot-only and Windows reserved names', () => {
    for (const name of [undefined, '', '   ', '...', '?*', 'CON', 'con', 'Nul', 'com1', 'LPT9', 'aux.backup']) {
      expect(fileBaseName(name, 'inventory_tray')).toBe('inventory_tray');
    }
    expect(fileBaseName('Console', 'x')).toBe('Console');
    expect(fileBaseName('COM10', 'x')).toBe('COM10');
  });

  it('limits the stem to 60 characters without trailing dots or spaces', () => {
    expect(fileBaseName('a'.repeat(80), 'x')).toBe('a'.repeat(60));
    expect(fileBaseName('Desk. ', 'x')).toBe('Desk');
    expect(fileBaseName(`${'b'.repeat(58)} .z`, 'x')).toBe('b'.repeat(58));
    // Code points, not UTF-16 units: the emoji is never split into a lone surrogate.
    const stem = fileBaseName(`${'c'.repeat(59)}🔑🔑`, 'x');
    expect(stem).toBe(`${'c'.repeat(59)}🔑`);
  });
});

describe('projectFileText', () => {
  it('is exactly serializeConfig without a name', () => {
    const config = lidTray();
    expect(projectFileText(config)).toBe(serializeConfig(config));
    expect(projectFileText(config, '  ')).toBe(serializeConfig(config));
  });

  it('adds a leading "name" that older builds ignore and that import restores', () => {
    const config = lidTray();
    config.options.tray.lidText = 'DESK';
    const text = projectFileText(config, 'Desk – layer 2');
    expect(Object.keys(JSON.parse(text))[0]).toBe('name');
    expect(JSON.parse(text).name).toBe('Desk – layer 2');
    expect(parseConfig(text)).toEqual(parseConfig(serializeConfig(config)));
    expect(text.endsWith('}\n')).toBe(true);
    const imported = importProject(createMemoryStorage(), text, 'whatever.yubi-orginizer.json');
    expect(imported.name).toBe('Desk – layer 2');
    expect(imported.config).toEqual(parseConfig(serializeConfig(config)));
  });
});

describe('partFileName', () => {
  const single = geometry('tray');
  const pair = geometry('tray', 'tray-lid');

  it.each([
    // [name, project, partId, extension, expected]
    [undefined, pair, undefined, '3mf', 'inventory_tray.3mf'],
    [undefined, pair, 'tray-lid', '3mf', 'tray-lid.3mf'],
    [undefined, single, 'tray', 'stl', 'tray.stl'],
    ['', pair, 'tray', 'scad', 'tray.scad'],
    ['CON', pair, undefined, 'stl', 'inventory_tray.stl'],
    ['Desk', pair, undefined, '3mf', 'Desk.3mf'],
    ['Desk', single, 'tray', 'stl', 'Desk.stl'],
    ['Desk', pair, 'tray', 'stl', 'Desk-tray.stl'],
    ['Desk', pair, 'tray-lid', 'scad', 'Desk-tray-lid.scad'],
    ['Desk: "main"?', pair, 'tray-lid', '3mf', 'Desk main-tray-lid.3mf'],
  ] as const)('%s / %s parts / %s / %s gives %s', (name, project, partId, extension, expected) => {
    expect(partFileName(name, project, 'inventory_tray', extension, partId)).toBe(expected);
  });

  it('uses the organizer type when there is no name', () => {
    expect(partFileName(undefined, geometry('dock'), 'desktop_dock', '3mf')).toBe('desktop_dock.3mf');
  });
});

describe('projectsArchive', () => {
  it('stores one named project file per project and numbers case-insensitive duplicates', () => {
    const dock = { ...defaultConfig(), template: 'desktop_dock' as const };
    const first = lidTray();
    const archive = projectsArchive([
      { name: 'Desk', config: first },
      { name: 'desk', config: defaultConfig() },
      { name: 'Desk 2', config: defaultConfig() },
      { name: 'CON', config: dock },
      { name: 'Ключі', config: defaultConfig() },
    ]);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual([
      'Desk.yubi-orginizer.json',
      'desk 2.yubi-orginizer.json',
      'Desk 2 2.yubi-orginizer.json',
      'desktop_dock.yubi-orginizer.json',
      'Ключі.yubi-orginizer.json',
    ]);
    const desk = strFromU8(files['Desk.yubi-orginizer.json']);
    expect(desk).toBe(projectFileText(first, 'Desk'));
    expect(JSON.parse(strFromU8(files['desk 2.yubi-orginizer.json'])).name).toBe('desk');
    expect(JSON.parse(strFromU8(files['desktop_dock.yubi-orginizer.json'])).name).toBe('CON');
    for (const text of Object.values(files)) expect(() => parseConfig(strFromU8(text))).not.toThrow();
  });

  it('produces reproducible bytes', () => {
    const projects = [{ name: 'Desk', config: lidTray() }];
    expect(projectsArchive(projects)).toEqual(projectsArchive(projects));
    expect(Object.keys(unzipSync(projectsArchive([])))).toEqual([]);
  });

  it('is named after the local date', () => {
    expect(projectsArchiveName(new Date(2026, 0, 5, 23, 59))).toBe('yubi-orginizer-projects-2026-01-05.zip');
    expect(projectsArchiveName(new Date(2026, 11, 31, 0, 0))).toBe('yubi-orginizer-projects-2026-12-31.zip');
  });
});

describe('portable package naming', () => {
  it('names the package after the project and embeds the name in the project file', () => {
    const config = lidTray();
    const project = buildProject(config);
    const files = unzipSync(buildPackage(config, project, meshesFor(project), false, 'Desk'));
    const readme = strFromU8(files['READ ME.txt']).split('\n');
    expect(readme[0]).toBe('yubi-orginizer / YubiKey organizer');
    expect(readme[2]).toBe('Desk');
    expect(readme).toContain('Import project.yubi-orginizer.json on the yubi-orginizer Projects page to keep editing.');
    expect(readme.join('\n')).not.toMatch(/keyform|Minimal material|Lid design/i);
    expect(JSON.parse(strFromU8(files['project.yubi-orginizer.json'])).name).toBe('Desk');
  });

  it('lists the minimal lid under the name the Lid settings use', () => {
    const config = lidTray();
    config.options.tray.lidStyle = 'minimal';
    const project = buildProject(config);
    const readme = strFromU8(unzipSync(buildPackage(config, project, meshesFor(project)))['READ ME.txt']).split('\n');
    expect(readme).toContain('- tray-lid.stl: Minimal lid');
    expect(readme.join('\n')).not.toMatch(/Minimal material/i);
  });

  it('keeps the organizer type or fit-test heading without a name', () => {
    const config = lidTray();
    const project = buildProject(config);
    const readme = (fitTests: boolean) => strFromU8(unzipSync(buildPackage(config, project, meshesFor(project), fitTests))['READ ME.txt']).split('\n');
    expect(readme(false)[2]).toBe('inventory_tray');
    expect(readme(true)[2]).toBe('Mechanical fit-test pieces');
  });
});

describe('repository README', () => {
  it('uses the yubi-orginizer name', () => {
    const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
    expect(readme.startsWith('# yubi-orginizer\n')).toBe(true);
    expect(readme).not.toMatch(/keyform/i);
  });
});

describe('browser download names', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  async function browserFixture() {
    vi.resetModules();
    const target = new EventTarget();
    const events: DownloadReadyDetail[] = [];
    target.addEventListener(DOWNLOAD_READY_EVENT, event => events.push((event as CustomEvent<DownloadReadyDetail>).detail));
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => ({ href: '', download: '', click: vi.fn(), remove: vi.fn() })),
    });
    const blobs: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return `blob:${blobs.length}`; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const module = await import('../src/export');
    const names = () => events.map(event => event.name);
    return { ...module, names, blobs };
  }

  it('names part downloads and ZIPs after the project', async () => {
    const { downloadParts, names, blobs } = await browserFixture();
    const config = lidTray();
    const project = buildProject(config);
    expect(project.parts.map(p => p.id)).toEqual(['tray', 'tray-lid']);
    const meshes = meshesFor(project);
    downloadParts('stl', config, project, meshes, 'tray-lid', 'Desk');
    downloadParts('stl', config, project, meshes, undefined, 'Desk');
    downloadParts('scad', config, project, meshes, 'tray', 'Desk');
    expect(names()).toEqual(['Desk-tray-lid.stl', 'Desk-stl.zip', 'Desk-tray.scad']);
    const zip = unzipSync(new Uint8Array(await blobs[1].arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['project.yubi-orginizer.json', 'tray-lid.stl', 'tray.stl']);
    expect(JSON.parse(strFromU8(zip['project.yubi-orginizer.json'])).name).toBe('Desk');
  });

  it('keeps the pre-rename part names without a project name', async () => {
    const { downloadParts, names, blobs } = await browserFixture();
    const config = lidTray();
    const project = buildProject(config);
    const meshes = meshesFor(project);
    downloadParts('stl', config, project, meshes, 'tray-lid');
    downloadParts('scad', config, project, meshes);
    const single = geometry('tray');
    downloadParts('stl', config, single, meshesFor(single));
    downloadParts('stl', config, single, meshesFor(single), undefined, 'Desk');
    expect(names()).toEqual(['tray-lid.stl', 'inventory_tray-scad.zip', 'tray.stl', 'Desk.stl']);
    const zip = unzipSync(new Uint8Array(await blobs[1].arrayBuffer()));
    expect(strFromU8(zip['project.yubi-orginizer.json'])).toBe(serializeConfig(config));
  });

  it('names project files and packages after the project', async () => {
    const { downloadProject, downloadPackage, names, blobs } = await browserFixture();
    const config = lidTray();
    const project = buildProject(config);
    const meshes = meshesFor(project);
    downloadProject(config, 'Desk: main');
    downloadProject(config);
    downloadPackage(config, project, meshes, false, 'Desk');
    downloadPackage(config, project, meshes);
    downloadPackage(config, project, meshes, true, 'Desk');
    expect(names()).toEqual([
      'Desk main.yubi-orginizer.json',
      'inventory_tray.yubi-orginizer.json',
      'Desk-yubi-orginizer.zip',
      'inventory_tray-yubi-orginizer.zip',
      'fit-tests-yubi-orginizer.zip',
    ]);
    expect(blobs[0].type).toBe('application/json');
    expect(JSON.parse(await blobs[0].text()).name).toBe('Desk: main');
    expect(await blobs[1].text()).toBe(serializeConfig(config));
  });
});
