/** Actual WASM geometry and motion audit; never submits a print job. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { TRAY_SLIDE_DIRECTIONS, traySlideDirection } from '../src/tray-slide';
import { defaultConfig, KEY_TYPES } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import { build3mf } from '../src/three-mf';
import { buildPackage } from '../src/export';
import type { HolderConfig, ProjectGeometry } from '../src/types';
import golden from '../tests/fixtures/h20-v7-contact.json';
import materialBaseline from '../tests/fixtures/h20-material-baseline.json';

const output = 'artifacts/h20-validation';
await mkdir(output, { recursive: true });
const vite = await createServer({ configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] }, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
const { buildProject, buildTrayH20Test, inventoryTrayLayout, trayStackGap } = await vite.ssrLoadModule('/src/geometry/index.ts') as typeof import('../src/geometry');
const { library } = await vite.ssrLoadModule('/src/geometry/library.ts');
const { h20V7Stations, H20_V7 } = await vite.ssrLoadModule('/src/geometry/tray-h20.ts') as typeof import('../src/geometry/tray-h20');
await vite.close();
const checks: object[] = [];
const materialComparisons: object[] = [];
const scadContact = new Map<number, number>();
const files: Record<string, Uint8Array> = {};
const startedAt = new Date().toISOString();
const bezelOnly = process.argv.includes('--bezel-only');
const volume = (bytes: ArrayBuffer | null) => {
  if (!bytes) return 0;
  const v = new DataView(bytes); let result = 0;
  for (let t = 0; t < v.getUint32(80, true); t++) {
    const [a,b,c] = [0,1,2].map(i => [0,1,2].map(j => v.getFloat32(96+t*50+i*12+j*4, true)));
    result += (a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  return Math.abs(result);
};
async function probe(name: string, source: string, expected = 0, tolerance = .0001) {
  const { stl } = await renderScadInNode(library + '\n' + source, { allowEmpty: true, files });
  const actual = volume(stl);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: expected ${expected}, got ${actual}`);
  checks.push({ name, volume: actual, expected, tolerance });
  return actual;
}
async function positive(name: string, source: string) {
  const { stl } = await renderScadInNode(library + '\n' + source, { allowEmpty: true, files });
  const actual = volume(stl); assert.ok(actual > .01, `${name}: no capture`);
  checks.push({ name, volume: actual, expected: 'positive capture' });
}
// A union is empty only if every member is empty. Batch zero-volume checks to
// share WASM startup/imports; isolate failures for a precise diagnostic.
async function emptyChecks(entries: { name: string; source: string }[]) {
  const { stl } = await renderScadInNode(library + '\nunion(){' + entries.map(e => e.source).join('\n') + '}', { allowEmpty: true, files });
  const actual = volume(stl);
  if (actual > .0001) {
    for (const e of entries) await probe(e.name, e.source);
    throw new Error(`Empty-check union has unexpected volume ${actual}`);
  }
  checks.push(...entries.map(e => ({ name: e.name, volumeUpperBound: actual, expected: 0, tolerance: .0001 })));
}
async function render(name: string, p: ProjectGeometry, config?: HolderConfig) {
  const meshes = new Map<string, ArrayBuffer>();
  for (const part of p.parts) {
    const { stl } = await renderScadInNode(part.scad); assert.ok(stl);
    const inspection = inspectPrintableMesh(stl);
    meshes.set(part.id, stl); files[`/${name}-${part.id}.stl`] = new Uint8Array(stl);
    checks.push({ name: `${name}/${part.id}`, ...inspection });
    const previous = materialBaseline.records.find(r => r.name === name)?.parts.find(p => p.name === `${name}/${part.id}`);
    if (previous) {
      const reduction = 1 - inspection.volume / previous.volume;
      // The archived regular lid predates the requested continuous bezel.
      // Record its tradeoff rather than imposing the old local-housing target.
      // Minimal-vs-regular savings are enforced separately below.
      if (part.id !== 'tray-lid') assert.ok(reduction > .08, `${name}/${part.id}: insufficient material reduction (${reduction})`);
      materialComparisons.push({ name: `${name}/${part.id}`, previousVolume: previous.volume, volume: inspection.volume, reductionPercent: reduction * 100,
        previousSize: previous.max.map((v, i) => v - previous.min[i]), size: inspection.max.map((v, i) => v - inspection.min[i]) });
    }
    await writeFile(`${output}/${name}-${part.id}.stl`, new Uint8Array(stl));
    await writeFile(`${output}/${name}-${part.id}.scad`, part.scad);
  }
  await writeFile(`${output}/${name}.3mf`, build3mf(p, meshes));
  if (config) await writeFile(`${output}/${name}.zip`, buildPackage(config, p, meshes));
  console.log('Rendered', name);
  return meshes;
}
function config(retention = true): HolderConfig {
  const c = defaultConfig(); c.template = 'inventory_tray';
  c.labelSize = 4;
  Object.assign(c.options.tray, { connection: 'h20_slide_v7', columns: 3, spacing: 24, rowGap: 8, margin: 5, height: 8.6, scoop: 'large', retention, lid: true, sideText: 'Layer 1', lidText: 'H20 / V7' });
  return c;
}
function pinZones(w: number, d: number, z: number, angle = 0) {
  if (angle % 180) [w, d] = [d, w];
  return `rotate([0,0,${angle}]) union(){for(p=h20_pins(${w},${d})) translate([p[0]-2.01,p[1]-2.91,${z+.79}])cube([4.02,5.82,2.42]);}`;
}
async function motion(name: string, c: HolderConfig, upperName = name, lidOnly = false) {
  const t = inventoryTrayLayout(c), seat = t.height + trayStackGap(c.options.tray.retention);
  const angle = traySlideDirection(c.options.tray.slideDirection).angle;
  const entryAxis = angle === 90 ? [0, 1] : angle === 180 ? [-1, 0] : angle === 270 ? [0, -1] : [1, 0];
  const lower = `import("/${name}-tray.stl");`;
  // A 0.00001 mm separation avoids coincident-face artifacts after float32 STL export.
  const upper = (x: number, lift: number, lid = false) => lid
    ? `translate([${x*entryAxis[0]},${x*entryAxis[1]},${seat+lift+.00001}])import("/${name}-tray-lid.stl");`
    : `translate([${x*entryAxis[0]},${x*entryAxis[1]},${seat+lift+.00001}])import("/${upperName}-tray.stl");`;
  // Solid material all around the raised perimeter: there must be no open
  // side slots beneath the next tray/lid, including around the rounded corners.
  const zero: { name: string; source: string }[] = [];
  const empty = (name: string, source: string) => zero.push({ name, source });
  empty(`${name}/closed-perimeter`, `difference(){translate([0,0,${t.height+.02}])linear_extrude(${seat-t.height-.04})tray_ring_2d(${t.width},${t.depth},.1,1.6);${lower}}`);
  empty(`${name}/closed-lid-panel`, `difference(){translate([0,0,.1])linear_extrude(.65)square([${t.width-26},${t.depth-26}],center=true);import("/${name}-tray-lid.stl");}`);
  const frame = angle % 180 ? [t.depth,t.width] : [t.width,t.depth];
  empty(`${name}/pins-joined-to-rim`, `difference(){rotate([0,0,${angle}])for(p=h20_pins(${frame[0]},${frame[1]}))translate([p[0]-2,p[1]+(p[1]>0?4:-4.6),${t.height+.05}])cube([4,.6,${seat-t.height-.1}]);${lower}}`);
  for (const lid of lidOnly ? [true] : [false,true]) {
    for (const lift of [6,4.2,3,1.5,.75,0]) empty(`${name}/${lid?'lid':'tray'}/lower-${lift}`, `intersection(){${lower}${upper(6,lift,lid)}}`);
    for (const remaining of [6,4.5,4,3,2,1,0]) {
      const overlap = `intersection(){${lower}${upper(remaining,0,lid)}}`;
      empty(`${name}/${lid?'lid':'tray'}/slide-${remaining}-unintended`, `difference(){${overlap}${pinZones(t.width,t.depth,seat,angle)}}`);
      const expected = scadContact.get(remaining)! * 2;
      await probe(`${name}/${lid?'lid':'tray'}/slide-${remaining}-H20`, overlap, expected, .002);
    }
    await positive(`${name}/${lid?'lid':'tray'}/vertical-capture`, `intersection(){${lower}${upper(0,.3,lid)}}`);
  }
  // Illustrative keys and physical retainers remain below the common bearing
  // plane. Check all key meshes against the moving upper body and actual lid.
  const project = buildProject(c);
  for (const key of project.keys) {
    for (const component of ['body','connector']) files[`/key-${key.type}-${component}.stl`] = new Uint8Array(await readFile(`public/keys/${key.type}-${component}.stl`));
  }
  const keys = project.keys.map(k => `translate(${JSON.stringify(k.position)})union(){import("/key-${k.type}-body.stl");import("/key-${k.type}-connector.stl");}`).join('');
  for (const remaining of [6,3,0]) for (const lid of lidOnly ? [true] : [false,true]) empty(`${name}/occupied-${remaining}-${lid}`, `intersection(){union(){${keys}}${upper(remaining,0,lid)}}`);
  const bodyY = { A: 22, C: 22, AN: 1.5, CN: 1.7, CK: 12, CI: 20 };
  for (const k of project.keys) empty(`${name}/${k.type}-same-ceiling-as-upper-tray`, `difference(){translate([${k.position[0]-1},${k.position[1]+bodyY[k.type]-.4},${seat+.05}])cube([2,.8,.4]);${upper(0,0,true)}}`);
  const cn = project.keys.find(k => k.type === 'CN');
  if (cn && !lidOnly) {
    const connector = `translate(${JSON.stringify(cn.position)})import("/key-CN-connector.stl");`;
    empty(`${name}/CN-horizontal-clearance`, `intersection(){${lower}translate([0,0,.00001])${connector}}`);
    await positive(`${name}/CN-connector-supported`, `intersection(){${lower}translate([0,0,-.05])${connector}}`);
    empty(`${name}/CN-root-ledge`, `difference(){translate([${cn.position[0]-2},${cn.position[1]+4.8},${cn.position[2]-1.4}])cube([4,1,.15]);${lower}}`);
    empty(`${name}/CN-grab-under-tip`, `intersection(){${lower}translate([${cn.position[0]-3},${cn.position[1]+8},${cn.position[2]-2.05}])cube([6,1.6,.8]);}`);
    empty(`${name}/CN-open-front-access`, `intersection(){${lower}translate([${cn.position[0]-3},${cn.position[1]+10.3},${cn.position[2]-2.05}])cube([6,.8,5.2]);}`);
  }
  await emptyChecks(zero);
  console.log('Motion and headroom passed', name);
}
async function minimalLid(name: string, c: HolderConfig, move = true) {
  const minimal = structuredClone(c); minimal.options.tray.lidStyle = 'minimal';
  await render(`${name}-minimal`, buildProject(minimal), minimal);
  const regularVolume = volume(files[`/${name}-tray-lid.stl`].buffer as ArrayBuffer);
  const minimalVolume = volume(files[`/${name}-minimal-tray-lid.stl`].buffer as ArrayBuffer);
  assert.ok(minimalVolume < regularVolume * .8, `${name}: minimal lid should save at least 20% for the mixed-key/large layout`);
  materialComparisons.push({ name: `${name}/lid-styles`, regularVolume, minimalVolume, reductionPercent: (1-minimalVolume/regularVolume)*100 });
  if (move) await motion(`${name}-minimal`, minimal, `${name}-minimal`, true);
}
async function bezelGeometry() {
  const zero: { name: string; source: string }[] = [];
  // Include the absolute connector minimum, a short-grip cover, the six-key
  // cover and a large cover. Check the actual cut solid in every direction.
  for (const [w,d] of [[40,28],[50,40],[83,118.2],[220,220]]) for (const angle of [0,90,180,270]) {
    const frame = angle % 180 ? [d,w] : [w,d];
    if (frame[0] < 40 || frame[1] < 28) continue;
    const name = `bezel/${w}x${d}/${angle}`;
    const lid = `h20_lid_assembled(${w},${d},direction=${angle});`;
    const housings = `rotate([0,0,${angle}])union(){
      for(p=h20_pins(${frame[0]},${frame[1]}))translate([p[0],p[1],0])yo_v7_rect_loft([[2.4,-10.65,5.05,-5.55,5.55],[3.3,-10.65,5.05,-5.55,5.55],[7.8,-10.65,5.05,-1.6,1.6]]);
      for(g=h20_guides(${frame[0]},${frame[1]}))translate([g[0],g[1],0])yo_v7_rect_loft([[2.4,-12.65,6.4,-5.55,5.55],[3.3,-12.65,6.4,-5.55,5.55],[7.8,-12.65,6.4,-1.6,1.6]]);
    }`;
    zero.push({ name: `${name}/concealed-housings`, source: `difference(){intersection(){${housings}slab(${w},${d},7.8,4);}h20_lid_bezel(${w},${d});}` });
    zero.push({ name: `${name}/grips-clear-of-housings`, source: `intersection(){${housings}rotate([0,0,${angle}])h20_lid_grip_cuts(${frame[0]},${frame[1]});}` });
    zero.push({ name: `${name}/unbroken-rounded-edge`, source: `difference(){translate([0,0,7.4])linear_extrude(.2)tray_ring_2d(${w},${d},1.1,2.1);${lid}}` });
    if (frame[1] >= 36) {
      const span = Math.min(24,frame[1]-28);
      const wells = `rotate([0,0,${angle}])for(side=[-1,1])translate([side*(${frame[0]}/2-5.4)-1,-${span/2-3},6.8])cube([2,${span-6},.5]);`;
      zero.push({ name: `${name}/thumb-purchase`, source: `intersection(){${wells}${lid}}` });
      const floors = `rotate([0,0,${angle}])for(side=[-1,1])translate([side*(${frame[0]}/2-5.4)-1,-${span/2-3},5.9])cube([2,${span-6},.2]);`;
      zero.push({ name: `${name}/solid-grip-floors`, source: `difference(){${floors}${lid}}` });
    }
  }
  await emptyChecks(zero);
  console.log('Rounded rim, concealed housings and thumb grips passed', zero.length, 'checks');
}
async function cNanoGripGeometry() {
  const zero: { name: string; source: string }[] = [];
  // C Nano 7B stays fixed across saved scoop sizes and retention settings.
  for (const r of [4,5,6,7]) for (const retention of [false,true]) {
    const name = `CN-access/r${r}/${retention}`;
    const tray = `inventory_tray(["CN"],[""],[[0,0]],40,36,8.6,${r},23,${retention});`;
    zero.push({ name: `${name}/supported-root`, source: `difference(){translate([-2,-.5,4.1])cube([4,1,.15]);${tray}}` });
    zero.push({ name: `${name}/clear-under-tip`, source: `intersection(){${tray}translate([-3,3,3.4])cube([6,1.5,.8]);}` });
    zero.push({ name: `${name}/front-finger-access`, source: `intersection(){${tray}translate([-3,5.5,3.4])cube([6,1.5,5.3]);}` });
    zero.push({ name: `${name}/solid-floor`, source: `difference(){translate([-3,3,1.85])cube([6,4,.1]);${tray}}` });
    zero.push({ name: `${name}/tab-free-pry-opening`, source: `intersection(){${tray}translate([-10,-10,8.61])cube([20,25,2]);}` });
  }
  await emptyChecks(zero);
  console.log('C Nano grip and root support passed', zero.length, 'checks');
}
try {
  await bezelGeometry();
  if (!bezelOnly) {
    await cNanoGripGeometry();
    // Same additive/cutter profile as the supplied reference, all 25 positions.
    for (const s of golden.samples) {
      const actual = await probe(`reference/contact-${s.remaining_slide_mm}`, `intersection(){translate([${-s.remaining_slide_mm},0,0])yo_v7_fixed_pin();difference(){translate([-15,-8,0])cube([25,16,8.4]);yo_v7_pin_socket();}}`, s.H20_overlap_mm3, s.remaining_slide_mm === 0 ? .00001 : .0023);
      scadContact.set(s.remaining_slide_mm, actual);
    }
    console.log('All 25 reference contact samples passed; ruled BRep versus triangulated SCAD transition tolerance 0.0023 mm³; seated tolerance 0.00001 mm³');
    await render('coupon', buildTrayH20Test());
    for (const retention of [true,false]) {
      const c = config(retention), name = retention ? 'mixed-retained' : 'mixed-bare';
      await render(name, buildProject(c), c);
      await motion(name, c);
      await minimalLid(name, c);
      const t = inventoryTrayLayout(c);
      const other = structuredClone(c); other.slots = other.slots.filter(s => s.type === 'CN');
      other.options.tray.footprint = { width: t.width, depth: t.depth };
      await render(`${name}-nano`, buildProject(other), other);
      // Different populations, same external datums and headroom.
      await motion(name, c, `${name}-nano`);
      for (const type of KEY_TYPES) {
        const single = config(retention); single.slots = single.slots.filter(s => s.type === type);
        await render(`single-${type}-${retention}`, buildProject(single));
      }
    }
    for (const direction of TRAY_SLIDE_DIRECTIONS.filter(d => d.id !== 'left')) {
      for (const retention of [true, false]) {
        const c = config(retention); c.options.tray.slideDirection = direction.id;
        const name = `direction-${direction.id}-${retention ? 'retained' : 'bare'}`;
        await render(name, buildProject(c), c);
        await motion(name, c);
        await minimalLid(name, c);
        if (retention && direction.id === 'front') {
          const t = inventoryTrayLayout(c), other = structuredClone(c);
          other.slots = other.slots.filter(s => s.type === 'CN');
          other.options.tray.footprint = { width: t.width, depth: t.depth };
          await render(`${name}-nano`, buildProject(other), other);
          await motion(name, c, `${name}-nano`);
        }
      }
    }
    const large = config(); large.options.tray.columns = 6; large.options.tray.height = 20;
    large.slots = Array.from({ length: 24 }, (_, i) => ({ ...large.slots[i%6], id: `key-${i}` }));
    await render('large', buildProject(large));
    await minimalLid('large', large, false);
    assert.equal(h20V7Stations(...buildProject(large).dimensions.slice(0,2) as [number,number]).pins.length, 2);
    // The same two closed-cover choices also fit the lift-off tray modes.
    for (const connection of ['none','stackable'] as const) for (const retention of [true,false]) {
      for (const lidStyle of ['regular','minimal'] as const) {
        const c = config(retention); Object.assign(c.options.tray, { connection, lidStyle });
        const p = buildProject(c), name = `${connection}-${retention}-${lidStyle}`;
        await render(name, p, c);
        const t = inventoryTrayLayout(c), seat = t.height + trayStackGap(retention), lid = p.parts[1];
        const assembled = `translate(${JSON.stringify(lid.position)})rotate(${JSON.stringify(lid.rotation.map(r => r*180/Math.PI))})import("/${name}-tray-lid.stl");`;
        await emptyChecks([
          { name: `${name}/seated-clearance`, source: `intersection(){import("/${name}-tray.stl");translate([0,0,.00001])${assembled}}` },
          { name: `${name}/flat-key-ceiling`, source: `difference(){translate([0,0,${seat+.1}])linear_extrude(.6)square([${t.width-10},${t.depth-10}],center=true);${assembled}}` },
        ]);
      }
    }
  }
  await writeFile(`${output}/${bezelOnly ? 'bezel-report' : 'report'}.json`, JSON.stringify({ status: 'passed', startedAt, completedAt: new Date().toISOString(), connectorSha256: createHash('sha256').update(await readFile('src/geometry/connectors/h20-v7.scad')).digest('hex'), checks, materialComparisons, limitations: ['Digital checks do not establish physical friction, force, fatigue or durability.', 'Real printer slicing and physical fit are separate acceptance steps.'] }, null, 2));
  console.log(`PASS: ${checks.length} mesh/contact/motion checks`);
} catch (error) {
  await writeFile(`${output}/${bezelOnly ? 'bezel-report' : 'report'}.json`, JSON.stringify({ status: 'failed', startedAt, checks, error: String(error) }, null, 2));
  throw error;
}
