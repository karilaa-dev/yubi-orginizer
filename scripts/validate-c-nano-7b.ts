/** Independent production-mesh audit against the user-approved 7B coupon. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createSlot, defaultConfig } from '../src/config';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { renderScadInNode } from '../src/runtime/node-render';
import { traySlideDirection } from '../src/tray-slide';
import type { HolderConfig, KeyType, Vec3 } from '../src/types';
import h20Contact from '../tests/fixtures/h20-v7-contact.json';

const output = 'artifacts/c-nano-7b-integration';
await mkdir(output, { recursive: true });
const server = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const geometry = await server.ssrLoadModule('/src/geometry/index.ts') as typeof import('../src/geometry');
const { library } = await server.ssrLoadModule('/src/geometry/library.ts') as { library: string };
await server.close();

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const approved = new Uint8Array(await readFile('artifacts/c-nano-pry-refinements/c-nano-pry-7B.stl'));
assert.equal(hash(approved), 'f55265737802cbef53cb58977a57e98407f01fbe47d63ece18aa4fc5d40639fe', 'Approved 7B reference has changed');
const files: Record<string, Uint8Array> = { '/approved.stl': approved };
const renders: object[] = [], checks: object[] = [], meshes: object[] = [];
const report: Record<string, unknown> = { status: 'running', startedAt: new Date().toISOString(), librarySha256: hash(library), approved7bSha256: hash(approved), renders, checks, meshes };
const save = () => writeFile(`${output}/validation.json`, JSON.stringify(report, null, 2) + '\n');
const volume = (bytes: ArrayBuffer | null) => {
  if (!bytes) return 0;
  const view = new DataView(bytes); let result = 0;
  for (let triangle = 0; triangle < view.getUint32(80, true); triangle++) {
    const [a, b, c] = [0, 1, 2].map(vertex => [0, 1, 2].map(axis => view.getFloat32(96 + triangle * 50 + vertex * 12 + axis * 4, true)));
    result += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(result);
};
async function render(name: string, source: string, empty = false) {
  const result = await renderScadInNode(source, { files, allowEmpty: empty, timeoutMs: 240_000 });
  const errors = result.logs.filter(line => /\bERROR\b|CGAL error|assertion violation|failed with error|not valid|Unable to|Can't open import|can't open file|WARNING: Ignoring unknown/i.test(line));
  renders.push({ name, sourceSha256: hash(source), passed: errors.length === 0, logs: result.logs });
  await save();
  assert.deepEqual(errors, [], `${name}: renderer emitted an error`);
  return result.stl;
}
async function printable(name: string, source: string) {
  const stl = await render(name, source); assert.ok(stl);
  const inspection = inspectPrintableMesh(stl);
  files[`/${name}.stl`] = new Uint8Array(stl);
  meshes.push({ name, sha256: hash(new Uint8Array(stl)), ...inspection });
  await writeFile(`${output}/${name}.stl`, new Uint8Array(stl));
  await writeFile(`${output}/${name}.scad`, source);
  await save();
  console.log(`Rendered ${name}: ${inspection.triangles} triangles, one watertight component`);
}
type EmptyCheck = { name: string; source: string; tolerance?: number };
async function emptyBatch(name: string, entries: EmptyCheck[]) {
  const result = await render(name, library + '\nunion(){\n' + entries.map(entry => entry.source).join('\n') + '\n}', true);
  const actual = volume(result);
  if (actual >= .00001) {
    for (const entry of entries) {
      const detail = volume(await render(entry.name, library + '\n' + entry.source, true));
      const tolerance = entry.tolerance ?? .00001;
      checks.push({ name: entry.name, passed: detail < tolerance, volumeMm3: detail, toleranceMm3: tolerance });
      await save();
      assert.ok(detail < tolerance, `${entry.name}: ${detail} mm³ of collision or missing material`);
    }
    console.log(`PASS ${name}: ${entries.length} geometric checks, individually resolved`);
    return;
  }
  checks.push(...entries.map(entry => ({ name: entry.name, passed: true, aggregateVolumeUpperBoundMm3: actual })));
  await save();
  console.log(`PASS ${name}: ${entries.length} geometric checks`);
}
const keyPose = (height: number, rotation: number, angle: number, lift = 0, x = 0, y = 0) =>
  `translate([${x},${y},0])rotate([0,0,${rotation}])translate([0,-5.05,${height - 6.6 + lift}])rotate([${angle},0,0])translate([0,0,3.5])import("/key.stl");`;
const differenceBoth = (first: string, second: string) => `union(){difference(){${first}${second}}difference(){${second}${first}}}`;

try {
  const key = await render('reference-key', geometry.buildKeyScad('CN')); assert.ok(key);
  files['/key.stl'] = new Uint8Array(key);
  report.referenceKeySha256 = hash(new Uint8Array(key));

  // Use real inventory_tray(), including its retention branches and scoop
  // routing. The comparison clips off differing slab corner radii and labels.
  const variants = [
    { name: 'production-7b', height: 8.6, rotation: 0, scoop: 6, retention: false },
    { name: 'production-small-retained', height: 8.6, rotation: 0, scoop: 5, retention: true },
    { name: 'production-large', height: 8.6, rotation: 0, scoop: 7, retention: false },
    { name: 'production-tall-rotated', height: 20, rotation: 90, scoop: 6, retention: true },
  ];
  for (const variant of variants) {
    const { name, height, rotation, scoop, retention } = variant;
    await printable(name, `${library}\ninventory_tray(["CN"],[""],[[0,0]],40,40,${height},${scoop},23,${retention},rotations=[${rotation}]);`);
    const normalized = `translate([0,0,${8.6 - height}])rotate([0,0,${-rotation}])import("/${name}.stl");`;
    const local = (source: string) => `rotate([0,0,${rotation}])${source}`;
    await emptyBatch(`${name}/shape-and-support`, [
      // Inverse Z translation after a 20 mm STL float32 round-trip produces
      // micrometer-scale surface differences; do not relax motion checks.
      { name: `${name}/approved-7b-exact-cavity`, tolerance: height === 8.6 ? .00001 : .0001, source: `intersection(){translate([-10,-10,2.001])cube([20,25,6.598]);${differenceBoth(normalized, 'import("/approved.stl");')}}` },
      { name: `${name}/solid-floor`, source: `difference(){translate([0,0,.001])linear_extrude(${height - 6.601})offset(delta=-.001)rr(40,40,4);import("/${name}.stl");}` },
      { name: `${name}/root-supported`, source: `difference(){${local(`translate([-2,-.5,${height - 4.5}])cube([4,1,.15]);`)}import("/${name}.stl");}` },
      { name: `${name}/finger-route`, source: `intersection(){import("/${name}.stl");${local(`translate([-3,3.2,${height - 5.3}])cube([6,8.8,.8]);`)}}` },
      { name: `${name}/no-unselected-tabs`, source: `intersection(){import("/${name}.stl");translate([-19,-19,${height + .001}])cube([38,38,2]);}` },
    ]);
  }
  const poses: EmptyCheck[] = [];
  for (let angle = 0; angle <= 20; angle += .5) poses.push({ name: `motion/angle-${angle}`, source: `intersection(){import("/production-7b.stl");${keyPose(8.6, 0, angle)}}` });
  for (const lift of [.25, .5, 1, 2, 4, 7, 10]) poses.push({ name: `motion/lift-${lift}`, source: `intersection(){import("/production-7b.stl");${keyPose(8.6, 0, 20, lift)}}` });
  for (const angle of [0, 5, 10, 15, 20]) poses.push({ name: `motion/tall-rotated-${angle}`, source: `intersection(){import("/production-tall-rotated.stl");${keyPose(20, 90, angle)}}` });
  for (const lift of [.5, 7]) poses.push({ name: `motion/tall-rotated-lift-${lift}`, source: `intersection(){import("/production-tall-rotated.stl");${keyPose(20, 90, 20, lift)}}` });
  // Keep each Boolean batch small enough for the WASM geometry engine.
  for (let start = 0; start < poses.length; start += 12) await emptyBatch(`motion-${start}`, poses.slice(start, start + 12));

  for (const retention of [false, true]) {
    const config: HolderConfig = defaultConfig();
    config.slots = (['CN', 'CN', 'A', 'CN', 'C', 'CN'] as KeyType[]).map((type, index) => ({ ...createSlot(type), rotation: index % 2 ? 90 : 0, label: type === 'CN' ? '5C Nano' : type }));
    config.labelSize = 4;
    Object.assign(config.options.tray, { columns: 2, spacing: 24, rowGap: 2, scoop: 'small', retention, connection: 'none', lid: false });
    const name = `mixed-${retention ? 'retained' : 'plain'}`;
    const layout = geometry.inventoryTrayLayout(config), project = geometry.buildProject(config);
    await printable(name, project.parts[0].scad);
    await writeFile(`${output}/${name}.json`, JSON.stringify(config, null, 2) + '\n');
    const entries: EmptyCheck[] = [];
    for (const [index, slot] of config.slots.entries()) {
      if (slot.type !== 'CN') continue;
      const [x, y] = layout.xy[index], rotation = slot.rotation ?? 0;
      // These intersections include the actual embossed label, neighbors and
      // any remaining non-CN retainers rather than only the isolated cavity.
      for (const angle of [0, 10, 20]) entries.push({ name: `${name}/${index}/pry-${angle}`, source: `intersection(){import("/${name}.stl");${keyPose(layout.height, rotation, angle, 0, x, y)}}` });
      for (const lift of [.5, 7]) entries.push({ name: `${name}/${index}/lift-${lift}`, source: `intersection(){import("/${name}.stl");${keyPose(layout.height, rotation, 20, lift, x, y)}}` });
      const envelope = geometry.traySlotEnvelope(config, slot);
      assert.ok(x + envelope.minX >= -layout.width / 2 + 5 - 1e-5 && x + envelope.maxX <= layout.width / 2 - 5 + 1e-5);
      assert.ok(y + envelope.minY >= -layout.depth / 2 + 5 - 1e-5 && y + envelope.maxY <= layout.depth / 2 - 5 + 1e-5);
    }
    for (let start = 0; start < entries.length; start += 10) await emptyBatch(`${name}/clearance-${start}`, entries.slice(start, start + 10));
  }
  // Representative real stacking assemblies, including generated sparse
  // bearing posts. Preview transforms are part of the acceptance surface.
  const place = (position: Vec3, rotation: Vec3, file: string, zGuard = 0) =>
    `translate(${JSON.stringify([position[0], position[1], position[2] + zGuard])})rotate(${JSON.stringify(rotation.map(value => value * 180 / Math.PI))})import("/${file}.stl");`;
  for (const connection of ['stackable', 'h20_slide_v7'] as const) {
    const config = defaultConfig();
    config.slots = (['CN', 'CN', 'A', 'CN', 'C', 'CN'] as KeyType[]).map((type, index) => ({ ...createSlot(type), rotation: index % 2 ? 90 : 0, label: type === 'CN' ? '5C Nano' : type }));
    config.labelSize = 4;
    Object.assign(config.options.tray, { columns: 2, spacing: 24, rowGap: 2, scoop: 'small', retention: connection === 'h20_slide_v7', connection, lid: true, slideDirection: 'front' });
    const name = `assembly-${connection}`, layout = geometry.inventoryTrayLayout(config), project = geometry.buildProject(config);
    const supports = geometry.inventoryTraySupports(config);
    assert.ok(supports.length > 0, `${name}: intended bearing-post test has no posts`);
    await writeFile(`${output}/${name}.json`, JSON.stringify(config, null, 2) + '\n');
    for (const part of project.parts) await printable(`${name}-${part.id}`, part.scad);
    const tray = project.parts.find(part => part.id === 'tray')!, lid = project.parts.find(part => part.id === 'tray-lid')!;
    const lower = place(tray.position, tray.rotation, `${name}-tray`);
    const assembledLid = place(lid.position, lid.rotation, `${name}-tray-lid`, .00001);
    const upper = place([0, 0, geometry.trayStackPitch(layout.height, config.options.tray.retention)], [0, 0, 0], `${name}-tray`, .00001);
    const entries: EmptyCheck[] = [];
    for (const [kind, assembled] of [['lid', assembledLid], ['tray', upper]]) {
      const overlap = `intersection(){${lower}${assembled}}`;
      if (connection === 'h20_slide_v7') {
        // The accepted H20 mechanism deliberately has locked pin contact.
        // Validate its existing golden quantity and require every other point
        // in the actual tray/lid assembly to remain collision-free.
        const angle = traySlideDirection(config.options.tray.slideDirection).angle;
        const [width, depth] = angle % 180 ? [layout.depth, layout.width] : [layout.width, layout.depth];
        const seat = geometry.trayStackPitch(layout.height, config.options.tray.retention);
        const zones = `rotate([0,0,${angle}])union(){for(p=h20_pins(${width},${depth}))translate([p[0]-2.01,p[1]-2.91,${seat + .79}])cube([4.02,5.82,2.42]);}`;
        const expected = h20Contact.samples.find(sample => sample.remaining_slide_mm === 0)!.H20_overlap_mm3 * 2;
        const actual = volume(await render(`${name}/${kind}/intentional-pin-contact`, library + '\n' + overlap, true));
        assert.ok(Math.abs(actual - expected) <= .002, `${name}/${kind}: locked pin contact changed (${actual} vs ${expected} mm³)`);
        checks.push({ name: `${name}/${kind}/intentional-pin-contact`, passed: true, actualMm3: actual, expectedMm3: expected, toleranceMm3: .002, reference: 'tests/fixtures/h20-v7-contact.json, remaining_slide_mm=0' });
        entries.push({ name: `${name}/assembled-tray-${kind}-outside-pin-contact`, source: `difference(){${overlap}${zones}}` });
      } else entries.push({ name: `${name}/assembled-tray-${kind}`, source: overlap });
    }
    for (const key of project.keys) {
      const keyFile = `assembly-key-${key.type}`;
      if (!files[`/${keyFile}.stl`]) {
        const stl = await render(keyFile, geometry.buildKeyScad(key.type)); assert.ok(stl);
        files[`/${keyFile}.stl`] = new Uint8Array(stl);
      }
      const seated = place(key.position, key.rotation, keyFile);
      entries.push(
        { name: `${name}/${key.slotId}/seated-tray`, source: `intersection(){${lower}${seated}}` },
        { name: `${name}/${key.slotId}/seated-lid`, source: `intersection(){${assembledLid}${seated}}` },
        { name: `${name}/${key.slotId}/seated-upper-tray`, source: `intersection(){${upper}${seated}}` },
      );
    }
    for (const [index, slot] of config.slots.entries()) {
      if (slot.type !== 'CN') continue;
      const [x, y] = layout.xy[index];
      for (const [angle, lift] of [[10, 0], [20, 0], [20, .5], [20, 7]]) entries.push({ name: `${name}/${index}/open-pry-${angle}-lift-${lift}`, source: `intersection(){${lower}${keyPose(layout.height, slot.rotation ?? 0, angle, lift, x, y)}}` });
    }
    for (let start = 0; start < entries.length; start += 10) await emptyBatch(`${name}/clearance-${start}`, entries.slice(start, start + 10));
    checks.push({ name: `${name}/bearing-posts-present`, passed: true, positions: supports });
    await save();
  }
  report.status = 'passed'; report.completedAt = new Date().toISOString();
  report.scriptSha256 = hash(new Uint8Array(await readFile(new URL(import.meta.url))));
  await save();
  console.log(`PASS: ${checks.length} production 7B checks; ${meshes.length} watertight production meshes`);
} catch (error) {
  report.status = 'failed'; report.failure = String(error); await save(); throw error;
}
