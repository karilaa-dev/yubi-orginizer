import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { defaultConfig, parseConfig, serializeConfig } from '../src/config';
import { buildPackage, DOWNLOAD_READY_EVENT, trayConnectionInstructions, TRAY_SNAP_INSTRUCTIONS, TRAY_H20_INSTRUCTIONS, type DownloadReadyDetail } from '../src/export';
import { buildProject, buildTrayH20Test, buildTraySnapTest } from '../src/geometry';
import type { ProjectGeometry } from '../src/types';

function fixture() {
  const config = defaultConfig();
  config.template = 'inventory_tray';
  config.slots[0].occupied = false;
  config.slots[1].label = 'ΩЖ "key"';
  config.slots.push({ ...config.slots[1], id: 'duplicate-slot' });
  const project: ProjectGeometry = {
    parts: [
      { id: 'tray', name: 'Inventory tray', scad: 'cube([20,30,3]);\n', position: [0, 0, 0], rotation: [0, 0, 0], explode: [0, 0, 0], color: '#36566a' },
      { id: 'tray-lid', name: 'Tray lid', scad: 'difference(){cube(10);cylinder(h=11,r=2);}\n', position: [20, 0, 3], rotation: [0, 0, 0], explode: [0, 0, 10], color: '#87aeb7' },
    ],
    keys: [{ slotId: config.slots[1].id, type: 'C', position: [20, 0, 10], rotation: [Math.PI / 2, 0, 0], partId: 'tray' }],
    dimensions: [40, 30, 13],
  };
  const meshes = new Map<string, ArrayBuffer>([
    ['tray', new Uint8Array([0, 1, 2, 128, 255]).buffer],
    ['tray-lid', new Uint8Array([3, 5, 8, 13]).buffer],
    // Unused cached/reference data must not leak into the printable package.
    ['C-body', new Uint8Array([99, 99, 99]).buffer],
  ]);
  return { config, project, meshes };
}

describe('portable package contents', () => {
  it('contains exactly the requested printable STL, portable SCAD, project, and readme files', () => {
    const { config, project, meshes } = fixture();
    const files = unzipSync(buildPackage(config, project, meshes));
    expect(Object.keys(files).sort()).toEqual([
      'READ ME.txt', 'project.yubi-orginizer.json', 'scad/tray-lid.scad', 'scad/tray.scad', 'stl/tray-lid.stl', 'stl/tray.stl',
    ]);
    for (const part of project.parts) {
      expect(files[`stl/${part.id}.stl`]).toEqual(new Uint8Array(meshes.get(part.id)!));
      expect(strFromU8(files[`scad/${part.id}.scad`])).toBe(part.scad);
    }
    expect(strFromU8(files['project.yubi-orginizer.json'])).toBe(serializeConfig(config));
    expect(strFromU8(files['READ ME.txt'])).toContain('Units: millimeters. Import STL files at 100% scale.');
    expect(strFromU8(files['READ ME.txt'])).toContain('tray.stl: Inventory tray');
    expect(strFromU8(files['READ ME.txt'])).not.toMatch(/Gridfinity|travel case|cartridge/i);
  });

  it('notes the desktop dock fit caveat only in dock packages', () => {
    const { config, project, meshes } = fixture();
    const note = 'Desktop dock socket fit is still being refined.';
    expect(strFromU8(unzipSync(buildPackage(config, project, meshes))['READ ME.txt'])).not.toContain(note);
    config.template = 'desktop_dock';
    expect(strFromU8(unzipSync(buildPackage(config, project, meshes))['READ ME.txt'])).toContain(note);
  });

  it('round trips reserved and duplicate slots without exporting reference assets', () => {
    const { config, project, meshes } = fixture();
    const files = unzipSync(buildPackage(config, project, meshes));
    const recovered = parseConfig(strFromU8(files['project.yubi-orginizer.json']));
    expect(recovered).toEqual(config);
    expect(recovered.slots[0].occupied).toBe(false);
    expect(recovered.slots.at(-1)?.id).toBe('duplicate-slot');
    expect(recovered.slots[1].label).toBe('ΩЖ "key"');
    expect(Object.keys(files).some(name => /keys\/|C-body|manifest\.json/.test(name))).toBe(false);
  });

  it('rejects an incomplete multipart model before returning an archive', () => {
    const { config, project, meshes } = fixture();
    meshes.delete('tray-lid');
    expect(() => buildPackage(config, project, meshes)).toThrow('Tray lid model is not ready');
  });

  it('builds deterministic archives without changing source files or preview transforms', () => {
    const { config, project, meshes } = fixture();
    const beforeConfig = structuredClone(config);
    const beforeProject = structuredClone(project);
    const beforeMeshes = structuredClone(meshes);
    expect(buildPackage(config, project, meshes)).toEqual(buildPackage(config, project, meshes));
    expect(config).toEqual(beforeConfig);
    expect(project).toEqual(beforeProject);
    expect(meshes).toEqual(beforeMeshes);
  });

  it('identifies mechanical fit-test packages while retaining an editable project', () => {
    const { config, project, meshes } = fixture();
    const files = unzipSync(buildPackage(config, project, meshes, true));
    expect(strFromU8(files['READ ME.txt'])).toContain('Mechanical fit-test pieces');
    expect(parseConfig(strFromU8(files['project.yubi-orginizer.json']))).toEqual(config);
  });

  it('includes both tray lock instructions in combined developer sample packages', () => {
    const config = defaultConfig();
    const project: ProjectGeometry = { parts: [...buildTraySnapTest().parts, ...buildTrayH20Test().parts], keys: [], dimensions: [0, 0, 0] };
    const meshes = new Map(project.parts.map(p => [p.id, new Uint8Array([1, 2, 3]).buffer]));
    const instructions = strFromU8(unzipSync(buildPackage(config, project, meshes, true))['READ ME.txt']);
    expect(instructions).toContain(TRAY_SNAP_INSTRUCTIONS);
    expect(instructions).toContain(TRAY_H20_INSTRUCTIONS);
    expect(instructions).not.toContain('SIDE SLIDERS');
    expect(instructions).not.toContain('SIDE BUTTON');
    expect(project.parts.filter(p => p.id.startsWith('fit-tray-')).map(p => p.id)).toEqual(['fit-tray-snap-lower', 'fit-tray-snap-upper', 'fit-tray-h20-lower', 'fit-tray-h20-upper']);
    expect(instructions).not.toMatch(/SLIDE LOCK|spring feet|actuator stays attached/);
  });

  it('packages snap-fit guidance with its two shells and no separate actuator', () => {
    const config = defaultConfig();
    config.template = 'inventory_tray'; config.options.tray.connection = 'snap_fit'; config.options.tray.lid = true;
    const snapProject = buildProject(config);
    const meshes = new Map(snapProject.parts.map(p => [p.id, new Uint8Array([1, 2, 3]).buffer]));
    const files = unzipSync(buildPackage(config, snapProject, meshes));
    expect(Object.keys(files).filter(name => name.startsWith('stl/')).sort()).toEqual(['stl/tray-lid.stl', 'stl/tray.stl']);
    const instructions = strFromU8(files['READ ME.txt']);
    expect(instructions).toContain(TRAY_SNAP_INSTRUCTIONS);
    expect(instructions).not.toContain('SLIDE LOCK');
    expect(instructions).toContain('Four solid frame-supported catches');
    expect(instructions).toContain('PLA or PLA Matte');
    // Uses the Stacking card's name and points to the only way to add another snap-fit layer.
    expect(instructions).toContain('SNAP-FIT (OLDER VERSION)');
    expect(instructions).toContain('New matching layer');
    expect(instructions).not.toMatch(/enclosure snap|shell width/i);
  });

  it('selects snap-fit sample instructions from exported parts independently of saved inventory settings', () => {
    const { config, project } = fixture();
    const snapProject = { ...project, parts: project.parts.map((part, i) => ({ ...part, id: `fit-tray-snap-${i ? 'upper' : 'lower'}` })) };
    const meshes = new Map(snapProject.parts.map(p => [p.id, new Uint8Array([1, 2, 3]).buffer]));
    const instructions = strFromU8(unzipSync(buildPackage(config, snapProject, meshes, true))['READ ME.txt']);
    expect(instructions).toContain(TRAY_SNAP_INSTRUCTIONS);
    expect(instructions).not.toContain('SLIDE LOCK');
  });

});

describe('tray lock help and download instructions', () => {
  it('provides solid catch instructions when the older Snap-fit connection is kept', () => {
    const config = defaultConfig(); config.template = 'inventory_tray'; config.options.tray.connection = 'snap_fit';
    expect(trayConnectionInstructions(config)).toEqual([TRAY_SNAP_INSTRUCTIONS]);
  });

  it.each(['none'] as const)('hides lock instructions when %s is selected', connection => {
    const config = defaultConfig(); config.template = 'inventory_tray';
    config.options.tray.connection = connection;
    expect(trayConnectionInstructions(config)).toEqual([]);
  });

  it('provides slide-lock instructions for a slide-lock tray only', () => {
    const config = defaultConfig(); config.options.tray.connection = 'h20_slide_v7';
    expect(trayConnectionInstructions(config)).toEqual([TRAY_H20_INSTRUCTIONS]);
    expect(TRAY_H20_INSTRUCTIONS).toContain('incompatible with Stackable and older Snap-fit parts');
    expect(TRAY_H20_INSTRUCTIONS).not.toMatch(/enclosure/i);
    config.template = 'desktop_dock';
    expect(trayConnectionInstructions(config)).toEqual([]);
  });
});

describe('recoverable browser downloads', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  async function browserFixture() {
    vi.resetModules();
    const target = new EventTarget();
    const events: DownloadReadyDetail[] = [];
    target.addEventListener(DOWNLOAD_READY_EVENT, event => events.push((event as CustomEvent<DownloadReadyDetail>).detail));
    const links: { href: string; download: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> }[] = [];
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: vi.fn(() => {
        const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
        links.push(link);
        return link;
      }),
    });
    let count = 0;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:download-${++count}`);
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const { downloadFile, downloadParts } = await import('../src/export');
    return { downloadFile, downloadParts, events, links, create, revoke };
  }

  it('announces actual file bytes and attempts the initial browser download', async () => {
    const { downloadFile, events, links, create } = await browserFixture();
    downloadFile('labels.json', 'ΩЖ', 'application/json');
    expect(events).toEqual([{ name: 'labels.json', url: 'blob:download-1', byteLength: 4 }]);
    expect(links[0].href).toBe(events[0].url);
    expect(links[0].download).toBe('labels.json');
    expect(links[0].click).toHaveBeenCalledOnce();
    expect(links[0].remove).toHaveBeenCalledOnce();
    const blob = create.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(await blob.text()).toBe('ΩЖ');
  });

  it('retains the recovery URL until another download replaces it', async () => {
    const { downloadFile, events, revoke } = await browserFixture();
    vi.useFakeTimers();
    downloadFile('first.stl', new Uint8Array([1, 2]), 'model/stl');
    vi.advanceTimersByTime(5 * 60_000);
    expect(revoke).not.toHaveBeenCalled();
    downloadFile('second.stl', new Uint8Array([3]), 'model/stl');
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:download-1');
    expect(events.at(-1)?.url).toBe('blob:download-2');
    vi.advanceTimersByTime(5 * 60_000);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('keeps a recoverable file available when automatic clicking throws', async () => {
    const { downloadFile, events, links, revoke } = await browserFixture();
    vi.spyOn(document, 'createElement').mockImplementation(() => {
      const link = { href: '', download: '', click: vi.fn(() => { throw new Error('Download blocked'); }), remove: vi.fn() };
      links.push(link);
      return link as unknown as HTMLAnchorElement;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => downloadFile('ready.stl', new Uint8Array([5]), 'model/stl')).not.toThrow();
    expect(events).toEqual([{ name: 'ready.stl', url: 'blob:download-1', byteLength: 1 }]);
    expect(revoke).not.toHaveBeenCalled();
    expect(links[0].remove).toHaveBeenCalledOnce();
  });

  it.each(['stl', 'scad'] as const)('downloads only %s parts and the project, or a single replacement lid', async format => {
    const { downloadParts, create, events } = await browserFixture();
    const config = defaultConfig(); config.template = 'inventory_tray';
    Object.assign(config.options.tray, { connection: 'snap_fit', lid: true });
    const project = buildProject(config);
    const meshes = new Map(project.parts.map(p => [p.id, new Uint8Array([1, 2, 3]).buffer]));
    downloadParts(format, config, project, meshes);
    const archive = create.mock.calls[0][0] as Blob;
    const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['project.yubi-orginizer.json', `tray-lid.${format}`, `tray.${format}`]);
    for (const part of project.parts) {
      if (format === 'stl') expect(files[`${part.id}.stl`]).toEqual(new Uint8Array(meshes.get(part.id)!));
      else expect(strFromU8(files[`${part.id}.scad`])).toBe(part.scad);
    }
    downloadParts(format, config, project, meshes, 'tray-lid');
    expect(events.at(-1)?.name).toBe(`tray-lid.${format}`);
    const replacement = create.mock.calls[1][0] as Blob;
    if (format === 'stl') expect(new Uint8Array(await replacement.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    else expect(await replacement.text()).toBe(project.parts.find(p => p.id === 'tray-lid')!.scad);
  });
});
