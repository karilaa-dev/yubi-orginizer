import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { Euler, Matrix4, Vector3 } from 'three';
import { createServer } from 'vite';
import { defaultConfig, KEY_CATALOG, KEY_TYPES } from '../src/config';
import { CI_INVENTORY_TOUCH_RELIEF } from '../src/geometry/ci-touch';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh, type MeshInspection } from '../src/runtime/mesh-check';
import type { HolderConfig, KeyType, PartSpec, ProjectGeometry, Vec3 } from '../src/types';

// Integration probes use the exported meshes. Contact envelopes identify the
// mating wall that must move; they do not simulate wall strain, force or fatigue.
await mkdir('artifacts', { recursive: true });

const vite = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
type Layout = { width: number; depth: number; requiredWidth: number; requiredDepth: number; height: number; scoopRadius: number; labelWidth: number; xy: number[][] };
const { buildProject, buildTraySnapTest, inventoryTrayLayout, trayStackPitch, keyLabelMetrics } = await vite.ssrLoadModule('/src/geometry/index.ts') as {
  buildProject(c: HolderConfig): ProjectGeometry;
  buildTraySnapTest(engagement: number): ProjectGeometry;
  inventoryTrayLayout(c: HolderConfig): Layout;
  trayStackPitch(h: number, retention: boolean): number;
  keyLabelMetrics(c: HolderConfig): { scale: number };
};
const { library } = await vite.ssrLoadModule('/src/geometry/library.ts') as { library: string };
const { TRAY_SNAP, traySnapRequiredSpread, traySnapStations } = await vite.ssrLoadModule('/src/geometry/tray-snap.ts') as typeof import('../src/geometry/tray-snap');
await vite.close();
const hash = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');
const startedAt = new Date().toISOString(), librarySha256 = hash(library);
const quick = process.env.SNAP_VALIDATION_QUICK === '1';
const sourceFilesSha256 = Object.fromEntries(await Promise.all(['src/geometry/index.ts', 'src/geometry/library.ts', 'src/geometry/tray-snap.ts'].map(async file => [file, hash(await readFile(file))])));
const parts: object[] = [], checks: object[] = [], cases: object[] = [], failures: { name: string; error: string }[] = [];
type Mesh = { bytes: ArrayBuffer; inspection: MeshInspection };
const meshes = new Map<string, Mesh>();
const union = (shapes: string[]) => `union(){${shapes.join('\n')}}`;
async function save(status: string) {
  await writeFile('artifacts/tray-snap-validation.json', JSON.stringify({ status, mode: quick ? 'development subset' : 'complete matrix', startedAt, finishedAt: status === 'running' ? undefined : new Date().toISOString(), librarySha256, sourceFilesSha256, configurations: cases.length, partChecks: parts.length, probeChecks: checks.length, failures, cases, parts, checks, limitations: ['Geometric motion is a kinematic approximation, not validated deformation, force or fatigue simulation.', 'Printable mesh and clearance checks do not establish physical fit, holding force, print quality or service life.', '5Ci contact-relief support is compared with a plain retained tray because pre-existing retention slots deliberately pass through that region.'] }, null, 2));
}
function triangles(bytes: ArrayBuffer): number[][][] {
  const d = new DataView(bytes);
  return Array.from({ length: d.getUint32(80, true) }, (_, t) => [0, 1, 2].map(v => [0, 1, 2].map(a => d.getFloat32(96 + t * 50 + v * 12 + a * 4, true))));
}
function volume(bytes: ArrayBuffer | null) {
  let sum = 0;
  if (bytes) for (const [a, b, c] of triangles(bytes)) sum += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  return Math.abs(sum);
}
function matrix(part: PartSpec, offset: Vec3 = [0, 0, 0]) {
  const m = new Matrix4().makeRotationFromEuler(new Euler(...part.rotation, 'XYZ'));
  m.setPosition(new Vector3(...part.position.map((v, i) => v + offset[i]) as Vec3));
  return m;
}
function placed(part: PartSpec, offset: Vec3 = [0, 0, 0]) {
  const e = matrix(part, offset).elements;
  return `multmatrix(${JSON.stringify([0, 1, 2, 3].map(r => [0, 1, 2, 3].map(c => e[c * 4 + r])))})import("/${part.id}.stl");`;
}
async function record(name: string, action: () => void | Promise<void>) {
  try { await action(); }
  catch (error) { failures.push({ name, error: String(error) }); console.error('FAIL', name, String(error)); }
}
async function mesh(part: PartSpec, name: string) {
  let result = meshes.get(part.scad);
  if (!result) {
    const { stl } = await renderScadInNode(part.scad);
    assert.ok(stl, `${name}: empty mesh`);
    result = { bytes: stl, inspection: inspectPrintableMesh(stl) }; meshes.set(part.scad, result);
  }
  parts.push({ name, id: part.id, scadSha256: hash(part.scad), ...result.inspection });
  return result;
}
async function probe(name: string, scad: string, files: Record<string, Uint8Array>, positive = false, tolerance = .00001) {
  await record(name, async () => {
    const { stl } = await renderScadInNode(library + scad, { files, allowEmpty: true });
    const v = volume(stl), passed = positive ? v > tolerance : v <= tolerance;
    const points = stl ? triangles(stl).flat() : [];
    const bounds = points.length ? [0, 1, 2].map(axis => [Math.min(...points.map(p => p[axis])), Math.max(...points.map(p => p[axis]))]) : undefined;
    checks.push({ name, volumeMm3: v, expected: positive ? 'positive interference' : 'empty', toleranceMm3: tolerance, passed, bounds });
    assert.ok(passed, `volume ${v} mm³, expected ${positive ? 'positive' : 'empty'}`);
  });
}
function config(types: KeyType[], retention = true): HolderConfig {
  const c = defaultConfig(); c.template = 'inventory_tray'; c.labels = false;
  c.slots = types.map((type, i) => ({ id: `slot-${i}`, type, label: KEY_CATALOG[type].short, occupied: true }));
  Object.assign(c.options.tray, { connection: 'snap_fit', height: TRAY_SNAP.minimumHeight, columns: 3, spacing: 24, rowGap: 2, margin: 5, scoop: 'default', retention, lid: true, lidText: '', lidTextPercent: 100 });
  return c;
}
type Completed = { config: HolderConfig; project: ProjectGeometry; layout: Layout; files: Record<string, Uint8Array>; tray: PartSpec; lid?: PartSpec; gap: number };
async function motion(project: Completed, name: string) {
  const { layout: t, gap, files, tray, lid } = project;
  const pitch = t.height + gap;
  // Real positive interference during lifting must occur ONLY in the four
  // receiver walls. The catch blocks and guides stay rigid in these probes.
  const contact = `tsnap_stations(${t.width},${t.depth})translate([-.001,-${TRAY_SNAP.catchWidth / 2 + TRAY_SNAP.clearance},-.001])cube([${TRAY_SNAP.skirtThickness + .002},${TRAY_SNAP.catchWidth + 2 * TRAY_SNAP.clearance},${TRAY_SNAP.skirtDepth}]);`;
  for (const lift of [0, .25, .5, .75, 1, 1.25, 1.4, 1.6, 2, 2.5, 3, 4.01]) {
    const spread = traySnapRequiredSpread(lift);
    await record(`${name}/wall-spread-${lift}`, () => {
      assert.ok(spread >= 0 && spread <= TRAY_SNAP.engagement + 1e-8);
      checks.push({ name: `${name}/wall-spread-${lift}`, requiredMm: spread, passed: true });
    });
    const upper = placed(tray, [0, 0, pitch + lift]);
    const overlap = `intersection(){${placed(tray)}${upper}}`;
    await probe(`${name}/contact-confined-to-receiver-skirt-${lift}`, `difference(){${overlap}translate([0,0,${pitch + lift}]){${contact}}}`, files);
    if (spread > .025) await probe(`${name}/positive-retention-${lift}`, overlap, files, true);
    if (lift === 0 || lift > TRAY_SNAP.captureHeight) await probe(`${name}/clear-at-rest-or-separated-${lift}`, overlap, files);
    if (lid) await probe(`${name}/lid-contact-confined-to-skirt-${lift}`, `difference(){intersection(){${placed(tray)}${placed(lid, [0,0,lift])}}translate([0,0,${pitch + lift}]){${contact}}}`, files);
  }
  // Every catch must engage independently; an accidental one-sided latch fails.
  for (const side of [-1,1]) for (const station of [-1,1]) {
    const region = `translate([${side < 0 ? -t.width : 0},${traySnapStations(t.depth)[station === -1 ? 0 : 1] - TRAY_SNAP.catchWidth / 2},0])cube([${t.width},${TRAY_SNAP.catchWidth},${2*pitch}]);`;
    await probe(`${name}/catch-${side}-${station}-holds`, `intersection(){${placed(tray)}${placed(tray,[0,0,pitch+1.25])}${region}}`, files, true);
  }
  await save('running');
}
async function project(c: HolderConfig, name: string): Promise<Completed | undefined> {
  let completed: Completed | undefined;
  await record(name, async () => {
    const p = buildProject(c), t = inventoryTrayLayout(c), files: Record<string, Uint8Array> = {};
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const part of p.parts) {
      const result = await mesh(part, `${name}/${part.id}`); files[`/${part.id}.stl`] = new Uint8Array(result.bytes);
      const transform = matrix(part);
      for (const triangle of triangles(result.bytes)) for (const point of triangle) {
        const v = new Vector3(...point as Vec3).applyMatrix4(transform).toArray();
        for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], v[a]); max[a] = Math.max(max[a], v[a]); }
      }
    }
    assert.deepEqual(p.parts.map(p => p.id), c.options.tray.lid ? ['tray', 'tray-lid'] : ['tray'], 'Snap fit must be integrated with no extra latch parts');
    const tray = p.parts[0], lid = p.parts.find(p => p.id === 'tray-lid');
    const gap = trayStackPitch(t.height, c.options.tray.retention) - t.height;
    const catches = `tray_snap_catches(${t.width},${t.depth},${t.height},${gap});`;
    const bases = `tsnap_stations(${t.width},${t.depth})translate([${TRAY_SNAP.catchOuter+.001},-${TRAY_SNAP.catchWidth/2-.001},${TRAY_SNAP.receiverTop+.001}])cube([${TRAY_SNAP.catchThickness-.002},${TRAY_SNAP.catchWidth-.002},${t.height+gap+TRAY_SNAP.captureHeight-TRAY_SNAP.receiverTop-.002}]);`;
    await probe(`${name}/four-solid-catch-bases-and-webs`, `difference(){${bases}${placed(tray)}}`, files);
    // The underside relief is continuous around the central key deck; no ribs
    // or body fill may immobilize the skirt along its straight walls.
    const corridor = `translate([0,0,.001])linear_extrude(${TRAY_SNAP.skirtDepth-.002})tsnap_ring(${t.width},${t.depth},${TRAY_SNAP.skirtThickness+.001},${TRAY_SNAP.receiverInner-.001});`;
    await probe(`${name}/continuous-receiver-channel`, `intersection(){${corridor}${placed(tray)}}`, files);
    if (lid) await probe(`${name}/lid-receiver-channel`, `intersection(){${corridor}import("/tray-lid.stl");}`, files);
    const channel = `translate([0,0,${t.height-TRAY_SNAP.channelDepth+.001}])linear_extrude(${TRAY_SNAP.channelDepth+gap-.002})tsnap_ring(${t.width},${t.depth},${TRAY_SNAP.skirtThickness+.001},${TRAY_SNAP.guideOuter-.001});`;
    await probe(`${name}/open-channel-between-solid-catches`, `difference(){intersection(){${channel}${placed(tray)}}${catches}}`, files);
    const bodyEnvelopes = union(p.keys.map(k => `translate(${JSON.stringify(k.position)})union(){translate([0,0,-key_t("${k.type}")/2+.001])linear_extrude(key_t("${k.type}")-.002)polygon(nominal_pts("${k.type}"));${k.type === 'CI' ? 'ci_side_touch_reference();' : ''}}`));
    const floors = union(c.slots.map((slot, i) => {
      const shape = `translate([0,-pocket_l("${slot.type}")/2])offset(delta=-.001)polygon(body_pts("${slot.type}"));`;
      return `translate([${t.xy[i][0]},${t.xy[i][1]},${t.height}-pocket_d("${slot.type}")-1.999])linear_extrude(1.998)${slot.type === 'CI' ? `union(){for(angle=[0,180])rotate(angle)${shape}}` : shape}`;
    }));
    await probe(`${name}/calibrated-pocket-floors`, `difference(){${floors}${placed(tray)}}`, files);
    await probe(`${name}/key-clearance`, `intersection(){${bodyEnvelopes}${union(p.parts.map(part => placed(part)))}}`, files);
    if (lid) await probe(`${name}/closed-tray-lid`, `intersection(){${placed(tray)}${placed(lid)}}`, files);
    const scoops = union(c.slots.map((slot, i) => `translate([${t.xy[i][0]},${t.xy[i][1]},0])scoop("${slot.type}",${t.height},${t.scoopRadius});`));
    const lips = c.options.tray.retention ? union(c.slots.map((slot, i) => `translate([${t.xy[i][0]},${t.xy[i][1]},0])tray_retention_lips("${slot.type}",${t.height});`)) : 'union(){}';
    const scale = keyLabelMetrics(c).scale;
    const labels = c.labels ? union(c.slots.map((slot, i) => `label(${JSON.stringify(slot.label.slice(0, 18))},${t.xy[i][0]},${t.xy[i][1]}-flat_label_distance("${slot.type}",${scale}),${t.height},${t.labelWidth},2.7*${scale});`)) : 'union(){}';
    await probe(`${name}/rigid-catches-vs-working-features`, `intersection(){${catches}${union([bodyEnvelopes, floors, scoops, lips, labels])}}`, files);
    if (c.slots.some(slot => slot.type === 'CI')) {
      const plain = structuredClone(c); Object.assign(plain.options.tray, { connection: 'none', lid: false, height: t.height, footprint: { width: t.width, depth: t.depth } });
      const baseline = buildProject(plain).parts[0], result = await mesh(baseline, `${name}/plain-Ci-floor-reference`);
      files['/plain-Ci-floor-reference.stl'] = new Uint8Array(result.bytes);
      const contactFloors = union(c.slots.flatMap((slot, i) => slot.type === 'CI' ? [`translate([${t.xy[i][0]},${t.xy[i][1]},${t.height}-${CI_INVENTORY_TOUCH_RELIEF.depth}-1.999])linear_extrude(1.998)square([${CI_INVENTORY_TOUCH_RELIEF.outerHalfWidth * 2 - .002},${CI_INVENTORY_TOUCH_RELIEF.length - .002}],center=true);`] : []));
      await probe(`${name}/Ci-contact-no-additional-support-loss`, `difference(){intersection(){${contactFloors}import("/plain-Ci-floor-reference.stl");}${placed(tray)}}`, files);
    }
    await record(`${name}/dimensions-and-footprint`, () => {
      const actual = max.map((v, i) => v - min[i]);
      actual.forEach((v, i) => assert.ok(Math.abs(v - p.dimensions[i]) < .002, `axis ${i}: ${v} instead of ${p.dimensions[i]}`));
      const plain = structuredClone(c); plain.options.tray.connection = 'none'; const plainLayout = inventoryTrayLayout(plain);
      const growth = [actual[0] - plainLayout.width, actual[1] - plainLayout.depth];
      assert.ok(t.width >= t.requiredWidth && t.depth >= t.requiredDepth);
      checks.push({ name: `${name}/dimensions-and-footprint`, expected: p.dimensions, actual, min, max, growthMm: growth, passed: true });
    });
    completed = { config: c, project: p, layout: t, files, tray, lid, gap };
    cases.push({ name, config: c, dimensions: p.dimensions, parts: p.parts.map(p => p.id) });
    console.log('CHECKED', name, p.dimensions.join(' × '));
  });
  await save('running'); return completed;
}

try {
  for (const engagement of [.1,.2,.3]) {
    const fit = buildTraySnapTest(engagement), files: Record<string,Uint8Array> = {};
    assert.equal(fit.parts.length, 2);
    for (const p of fit.parts) await record(`fit-${engagement}/${p.id}`, async () => { files[`/${p.id}.stl`] = new Uint8Array((await mesh(p, `fit-${engagement}/${p.id}`)).bytes); });
    await probe(`fit-${engagement}/closed`, `intersection(){${fit.parts.map(p => placed(p)).join('')}}`, files);
    await probe(`fit-${engagement}/holds`, `intersection(){${placed(fit.parts[0])}${placed(fit.parts[1],[0,0,1.25])}}`, files, true);
  }
  let nano: Completed | undefined;
  for (const type of quick ? ['CN'] as const : KEY_TYPES) for (const retention of [false, true]) {
    const p = await project(config([type], retention), `single-${type}-${retention ? 'retained' : 'compact'}`);
    if (type === 'CN' && retention) nano = p;
  }
  const mixed = config(KEY_TYPES); mixed.labels = true; mixed.labelSize = 4;
  mixed.slots.forEach((s, i) => { s.label = i % 2 ? 'WIDE ΩЖ LABEL' : 'Key "A" \\ spare'; });
  mixed.options.tray.lidText = 'Layer Ω'; mixed.options.tray.sideText = 'Layer Ω';
  const large = await project(mixed, 'mixed-six-max-labels');
  if (!quick) {
    const noLid = config(['CN']); noLid.options.tray.lid = false; await project(noLid, 'Nano-without-lid');
    const tall = config(['CI', 'C', 'AN']); tall.options.tray.height = 20; tall.options.tray.scoop = 'large'; await project(tall, 'tall-large-scoops');
  }
  const five = config(['A', 'CN', 'CI', 'CK', 'C']); five.labels = true;
  const required = inventoryTrayLayout(five); five.options.tray.footprint = { width: required.requiredWidth, depth: required.requiredDepth };
  const two = structuredClone(five); two.slots = two.slots.slice(0, 2); two.options.tray.retention = false; two.options.tray.height = Math.min(20, TRAY_SNAP.minimumHeight + 3);
  const first = await project(five, 'locked-five'), second = await project(two, 'locked-two');
  if (first && second) for (const [name, lower, upper] of [['five-below-two', first, second], ['two-below-five', second, first]] as const) {
    const files = { ...lower.files, '/upper-tray.stl': upper.files['/tray.stl'] };
    const lifted = { ...upper.tray, id: 'upper-tray' }, pitch = trayStackPitch(lower.layout.height, lower.config.options.tray.retention);
    await probe(`locked-layers/${name}`, `intersection(){${placed(lower.tray)}${placed(lifted, [0, 0, pitch])}}`, files);
    const secondPitch = trayStackPitch(upper.layout.height, upper.config.options.tray.retention);
    await probe(`locked-layers/${name}-three-trays`, `union(){intersection(){${placed(lower.tray)}${placed(lower.tray,[0,0,pitch+secondPitch])}}intersection(){${placed(lifted,[0,0,pitch])}${placed(lower.tray,[0,0,pitch+secondPitch])}}}`, files);

  }
  if (nano) await motion(nano, 'motion/Nano');
  if (large) await motion(large, 'motion/mixed-max-labels');
  await record('source-files-unchanged-during-validation', async () => {
    for (const [file, before] of Object.entries(sourceFilesSha256)) assert.equal(hash(await readFile(file)), before, `${file} changed while this matrix ran; rerun against the final source`);
    checks.push({ name: 'source-files-unchanged-during-validation', passed: true });
  });
  await save(failures.length ? 'failed' : 'passed');
  console.log(failures.length ? 'FAILED' : 'PASS', cases.length, 'configurations;', parts.length, 'meshes;', checks.length, 'checks;', failures.length, 'failures');
  if (failures.length) process.exitCode = 1;
} catch (error) { failures.push({ name: 'validation-run', error: String(error) }); await save('failed'); throw error; }
