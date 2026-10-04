# Development

## Setup and checks

Use Node.js 22.12+ and npm. Install the exact dependency tree with `npm ci`.
The OpenSCAD WASM engine is pinned in `package.json`; the lockfile also belongs
in source control. No credentials or environment variables are required.

```sh
npm run check
npm run build
```

For lower concurrency on resource-constrained systems:

```sh
npm test -- --maxWorkers=2
```

## Geometry validation

These checks use the real WASM engine and can take several minutes. Reports are
written to `artifacts/`, which is created as needed and excluded from Git.

```sh
npm run test:geometry -- --report=artifacts/geometry-validation.json
node --import tsx scripts/validate-3mf.ts
node --import tsx scripts/validate-tray-snap.ts
node --import tsx scripts/validate-tray-sizing.ts
node --import tsx scripts/validate-tray-layers.ts
npm run validate:h20
```

Focused checks:

```sh
npm run test:geometry -- --filter=inventory_tray --report=artifacts/tray-validation.json
npm run test:geometry -- --stress --report=artifacts/geometry-stress-validation.json
node --import tsx scripts/validate-reversible-ci.ts
node --import tsx scripts/validate-size-controls.ts
node --import tsx scripts/validate-dock-row-spacing.ts
node --import tsx scripts/validate-label-size-and-lid.ts
node --import tsx scripts/validate-lid-options.ts
```

The optional `SNAP_VALIDATION_QUICK=1` environment variable selects a smaller
snap-fit development matrix. Full validation is separate from physical print
acceptance. Historical local reports do not automatically apply to a new revision.

## Regenerating assets and samples

```sh
npm run build:keys
npm run build:icons
npm run export:snap-sample
```

Reference-key STLs in `public/keys/` are required runtime assets and are committed.
They are illustrative display geometry and never enter printable exports.
The calibrated SCAD profiles under `src/geometry/profiles/` are also required.
The original research package and previous local exports are not build inputs.

The snap sample exporter creates complete mating frames for 0.1, 0.2 and 0.3 mm
engagement in `artifacts/snap-fit-sample/`, including STL, SCAD and portable 3MF.
The nominal 0.2 mm pair is in that directory; alternatives are in subdirectories.

Optional review rendering uses Python 3.10+ with NumPy and Pillow:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
.venv/bin/python scripts/render-tray-snap-review.py
```

The native slice audit uses only Python's standard library. First slice each
exported `snap-fit-test.3mf` locally in Bambu Studio with supports disabled,
PLA/PLA Matte, 5% infill, and Arachne walls. Save the native result as
`sliced-check.3mf` and its CLI output as `slice.log` beside the exported files.
Then run:

```sh
python3 scripts/report-tray-snap-slice.py --stage final
python3 scripts/report-tray-snap-slice.py --directory artifacts/snap-fit-sample/engagement-0.1 --stage final
python3 scripts/report-tray-snap-slice.py --directory artifacts/snap-fit-sample/engagement-0.3 --stage final
```

This audits an existing local slice and never contacts a printer. Slice again
when geometry changes. No printer-specific G-code or machine presets belong in
the source repository.

## Hosting and release checks

Releases deploy to GitHub Pages through `.github/workflows/pages.yml`, which runs
on every pushed tag (publishing a GitHub release creates one) and on manual runs.
Before the first deployment, set **Settings › Pages › Source** to *GitHub Actions*,
and in **Settings › Environments › github-pages** allow tags (for example `v*`)
to deploy; by default only the default branch can.

Deploy the complete `dist/` directory over HTTPS, built with `BASE_PATH` set to
its sub-path when it is not served from the origin root. Serve WASM
as `application/wasm` and JavaScript with a JavaScript MIME type. Preserve asset
names and worker files. Revalidate `index.html` and `sw.js`; hashed assets can
use immutable caching. Opening `index.html` through `file://` is unsupported.

Before releasing, test the production preview: generate a model, download it,
reload offline, edit a previously unrendered design, and check updates: interact
with an open tab, rebuild, then select **Help › Check for updates** (or switch to
another tab and back after at least a minute). An **Update** button appears and
nothing reloads. Then refresh: the page updates by itself. Without a check, an
open tab only looks for updates every 15 minutes.
Check keyboard and touch interaction. A successful build does not establish
browser coverage or physical printing quality.

## Tray sets

Existing version-1 configs remain the first tray. `layerName` names that tray;
`layers` contains the additional `{ name, config }` entries, ordered bottom to
top. Nested sets are rejected. Project autosave, conflict detection, duplication
and JSON backups write the entire set in one record. Older Keyform `traySet`
files are imported without dropping their other layers. Root footprint, height, connection
and slide direction are authoritative for the project. `resolvedTrayLayers`
applies the common automatic footprint before any layer is rendered or exported.
Edits exceeding a fixed footprint stay in the editor draft until Resize or Cancel.

`Slot.rotation` is 0 (vertical, including old files) or 90 (horizontal). The
layout reserves rotated pocket, label, scoop and retention envelopes.
`tray.arrangement: "compact"` packs those envelopes deterministically; the
Arrange compactly command searches rotations without changing key identities or labels. Assembly
transforms in `geometry/layers.ts` only affect preview placement; printable
STL/SCAD meshes stay at Z=0, and 3MF lays them out on the build plate.

`traySetItems` presents each tray and lid independently without rewriting older
project files. The preview always renders `buildTraySet`, with exploded parts in one row.
`OrganizerPreview.setFocusedPart` centers the orbit target on a selected item and
sets other parts and their reference keys to 25% opacity, without regenerating meshes.
`buildTrayItem` can resolve a single printable item; `selectTrayParts`
filters an export after the full set has resolved its shared dimensions. Download
uses a separate cancellable render job and the shared SCAD mesh cache, so its
selection never changes the active editing layer.

The development server serves a retiring worker at `sw.js` so an offline build
previously installed on the same port cannot keep serving stale assets. This
does not modify project storage.
