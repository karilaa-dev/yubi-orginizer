import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { defaultConfig, KEY_CATALOG, KEY_TYPES, parseConfig, serializeConfig, validateText } from '../src/config';
import { renderScadInNode } from '../src/runtime/node-render';
import { inspectPrintableMesh } from '../src/runtime/mesh-check';
import type { HolderConfig, ProjectGeometry } from '../src/types';

const server = await createServer({
  configFile: false, logLevel: 'silent', optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom',
});
const { buildProject } = await server.ssrLoadModule('/src/geometry/index.ts') as { buildProject(config: HolderConfig): ProjectGeometry };
const { library } = await server.ssrLoadModule('/src/geometry/library.ts') as { library: string };
await server.close();

const pitch = 18, height = 11;
const socketTypes = ['A', 'C', 'AN', 'CN'];
const sampleLabels = ['ǗӜΐgj', 'WWW', 'W'.repeat(18), 'M'.repeat(18), 'Ж'.repeat(18), 'Щ'.repeat(18), 'Ǆ'.repeat(18), 'Ѽ'.repeat(18), '"\\ΩЖ'];
function bounds(buffer: ArrayBuffer) {
  const data = new DataView(buffer), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < data.getUint32(80, true); i++) for (let vertex = 0; vertex < 3; vertex++) for (let axis = 0; axis < 3; axis++) {
    const value = data.getFloat32(84 + 50 * i + 12 + 12 * vertex + 4 * axis, true);
    min[axis] = Math.min(min[axis], value); max[axis] = Math.max(max[axis], value);
  }
  return { min, max };
}
function socketEnvelope() { return `union(){${socketTypes.map(type => `socket_cut(${JSON.stringify(type)},${height});`).join('')}}`; }
function labelEnvelope() { return `union(){${socketTypes.flatMap(type => sampleLabels.map(label => `label(${JSON.stringify(label)},0,-upright_label_distance(${JSON.stringify(type)}),${height},20,2.55);`)).join('')}}`; }

type TextBounds = { min: number[]; max: number[] };
async function measureLabels(values: string[], maxWidth: number, size: number, raw = false): Promise<(TextBounds | null)[]> {
  const results: (TextBounds | null)[] = [];
  // Keep glyphs spatially separate so one actual STL render measures each
  // string independently, without relying on experimental textmetrics().
  for (let start = 0; start < values.length; start += 64) {
    const batch = values.slice(start, start + 64);
    const source = batch.map((value, i) => raw
      ? `translate([${i * 40},0,0])linear_extrude(.35)text(${JSON.stringify(value)},size=${size},font="Liberation Sans:style=Bold",halign="center",valign="center");`
      : `label(${JSON.stringify(value)},${i * 40},0,0,${maxWidth},${size});`).join('\n');
    const { stl } = await renderScadInNode(`${library}\n${source}`, { allowEmpty: true });
    const measured: (TextBounds | null)[] = batch.map(() => null);
    if (stl) {
      const data = new DataView(stl);
      for (let i = 0; i < data.getUint32(80, true); i++) for (let vertex = 0; vertex < 3; vertex++) {
        const x = data.getFloat32(84 + 50 * i + 12 + 12 * vertex, true);
        const y = data.getFloat32(84 + 50 * i + 16 + 12 * vertex, true);
        const index = Math.round(x / 40);
        assert.ok(index >= 0 && index < batch.length);
        const b = measured[index] ?? { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
        b.min[0] = Math.min(b.min[0], x - index * 40); b.max[0] = Math.max(b.max[0], x - index * 40);
        b.min[1] = Math.min(b.min[1], y); b.max[1] = Math.max(b.max[1], y);
        measured[index] = b;
      }
    }
    results.push(...measured);
  }
  return results;
}

const acceptedChars = [];
for (const [start, end] of [[0x20, 0x24f], [0x370, 0x52f]]) for (let code = start; code <= end; code++) acceptedChars.push(String.fromCodePoint(code));
const repeatedChars = acceptedChars.map(char => char.repeat(18));
repeatedChars.forEach(value => validateText(value, 'Probe', 18));
const singleGlyphs = await measureLabels(acceptedChars, 20, 2.7);
const fullLabels = await measureLabels(repeatedChars, 20, 2.7);
let maximumLabelWidth = 0, maximumHalfHeight = 0;
for (const values of [singleGlyphs, fullLabels]) for (const b of values) if (b) {
  const width = b.max[0] - b.min[0];
  maximumLabelWidth = Math.max(maximumLabelWidth, width);
  maximumHalfHeight = Math.max(maximumHalfHeight, Math.abs(b.min[1]), Math.abs(b.max[1]));
  assert.ok(width <= 20.001, `Label exceeds its 20 mm width: ${width}`);
  assert.ok(b.min[0] >= -10.001 && b.max[0] <= 10.001, 'Label escapes its allotted centered width');
  assert.ok(b.min[1] >= -2.2 && b.max[1] <= 2.2, 'Label escapes the compact-row height envelope');
}
const specialLabels = [...sampleLabels, 'Ж' + '\u0483'.repeat(17), 'Ж' + '\u0489'.repeat(17), 'WMЖЩǄѼ'.repeat(3), 'W M Ж Щ Ǆ Ѽ'];
const specialBounds = await measureLabels(specialLabels, 16, 2.7);
specialBounds.forEach(b => { if (b) assert.ok(b.min[0] >= -8.001 && b.max[0] <= 8.001 && b.min[1] >= -2.2 && b.max[1] <= 2.2); });
const shortLabels = KEY_TYPES.map(type => KEY_CATALOG[type].short);
for (const [maxWidth, size] of [[20, 2.55], [23, 2.7]]) {
  const fitted = await measureLabels(shortLabels, maxWidth, size), original = await measureLabels(shortLabels, maxWidth, size, true);
  fitted.forEach((b, i) => {
    assert.ok(b && original[i]);
    for (const edge of ['min', 'max'] as const) for (const axis of [0, 1]) assert.ok(Math.abs(b[edge][axis] - original[i]![edge][axis]) < 0.001, `${shortLabels[i]} changed its normal short-label size`);
  });
}
console.log(`PASS label widths: ${acceptedChars.length} supported characters singly and repeated18; maximum width ${maximumLabelWidth.toFixed(3)} mm; half-height ${maximumHalfHeight.toFixed(3)} mm.`);

const socketRender = await renderScadInNode(`${library}\n${socketEnvelope()}`);
const labelRender = await renderScadInNode(`${library}\n${labelEnvelope()}`);
assert.ok(socketRender.stl); assert.ok(labelRender.stl);
const socketBounds = bounds(socketRender.stl), labelBounds = bounds(labelRender.stl);
const intersections = [
  ['socket/socket', socketEnvelope(), socketEnvelope()],
  ['socket/label', socketEnvelope(), labelEnvelope()],
  ['label/socket', labelEnvelope(), socketEnvelope()],
  ['label/label', labelEnvelope(), labelEnvelope()],
];
for (const [name, first, second] of intersections) {
  const result = await renderScadInNode(`${library}\nintersection(){${first}translate([0,${pitch},0])${second}}`, { allowEmpty: true });
  assert.equal(result.stl, null, `Adjacent dock rows intersect: ${name}`);
}
const columns = await renderScadInNode(`${library}\nintersection(){${labelEnvelope()}translate([22,0,0])${labelEnvelope()}}`, { allowEmpty: true });
assert.equal(columns.stl, null, 'Labels in adjacent minimum-spacing columns intersect');

// Upright references rotate local Z into world -Y on every supported key.
let keyMinY = Infinity, keyMaxY = -Infinity;
for (const type of KEY_TYPES) for (const component of ['body', 'connector', 'touch']) {
  const bytes = await readFile(`public/keys/${type}-${component}.stl`);
  const raw = bounds(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  keyMinY = Math.min(keyMinY, -raw.max[2]); keyMaxY = Math.max(keyMaxY, -raw.min[2]);
}
const bodyGap = pitch + keyMinY - keyMaxY;
const labelToPreviousKeyGap = pitch + labelBounds.min[1] - keyMaxY;
assert.ok(bodyGap > 10.9);
assert.ok(labelToPreviousKeyGap > 4);

const rendered = [];
for (const label of [sampleLabels[0], sampleLabels[2]]) {
  const config = defaultConfig();
  config.template = 'desktop_dock';
  config.slots = [...KEY_TYPES, ...KEY_TYPES].map((type, i) => ({ id: `key-${i}`, type, label, occupied: true }));
  Object.assign(config.options.dock, { columns: 3, spacing: 22, rowSpacing: pitch, edgeMargin: 12, depthMargin: 18, height, title: 'COMPACT' });
  assert.deepEqual(parseConfig(serializeConfig(config)), config);
  const project = buildProject(config);
  assert.deepEqual(project.dimensions, [68, 90, 11.35]);
  const { stl } = await renderScadInNode(project.parts[0].scad);
  assert.ok(stl);
  const mesh = inspectPrintableMesh(stl);
  assert.ok(Math.abs(mesh.min[2]) < 0.00001);
  assert.equal(mesh.components, 1);
  rendered.push({ label, dimensionsMm: project.dimensions, scadSha256: createHash('sha256').update(project.parts[0].scad).digest('hex'), ...mesh });
}
const config = defaultConfig();
assert.equal(config.options.dock.rowSpacing, 45);
for (const saved of [28, 45, 70]) {
  config.options.dock.rowSpacing = saved;
  assert.equal(parseConfig(serializeConfig(config)).options.dock.rowSpacing, saved);
}
const report = {
  status: 'passed', command: 'node --import tsx scripts/validate-dock-row-spacing.ts', rowPitchMm: pitch,
  socketBounds, labelBounds, sampleLabels, referenceKeyYBounds: [keyMinY, keyMaxY],
  labelSizing: {
    acceptedCodePoints: acceptedChars.length, singleAndRepeated18Checks: acceptedChars.length * 2,
    maximumMeasuredWidthMm: maximumLabelWidth, permittedWidthMm: 20,
    maximumMeasuredHalfHeightMm: maximumHalfHeight, compactRowHalfHeightMm: 2.2,
    specialLabelsCheckedAt16Mm: specialLabels.length, normalModelLabelsPreserveSize: shortLabels,
    minimum22MmColumnIntersectionEmpty: true,
  },
  minimumReferenceBodyGapMm: bodyGap, minimumMeasuredLabelToPreviousKeyGapMm: labelToPreviousKeyGap,
  intersectionChecks: intersections.map(([name]) => ({ name, empty: true })), rendered,
  preservedDefaultPitchMm: 45, preservedSavedPitchesMm: [28, 45, 70],
  limitation: 'Geometric clearance only. Finger access and printed fit have not been physically tested.',
};
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/dock-row-spacing-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(`PASS: 18 mm rows; ${bodyGap.toFixed(3)} mm key-body gap; ${labelToPreviousKeyGap.toFixed(3)} mm measured label-to-key gap; five empty intersections; two watertight dock renders.`);
