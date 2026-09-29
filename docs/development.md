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
node --import tsx scripts/validate-fit-tools.ts
node --import tsx scripts/validate-tray-snap.ts
node --import tsx scripts/validate-tray-sizing.ts
npm run validate:h20
```

Focused checks:

```sh
npm run test:geometry -- --filter=travel_case --report=artifacts/case-validation.json
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

Deploy the complete `dist/` directory over HTTPS at the origin root. Serve WASM
as `application/wasm` and JavaScript with a JavaScript MIME type. Preserve asset
names and worker files. Revalidate `index.html` and `sw.js`; hashed assets can
use immutable caching. Opening `index.html` through `file://` is unsupported.

Before releasing, test the production preview: generate a model, download it,
reload offline, edit a previously unrendered design, and verify the update banner.
Check keyboard and touch interaction. A successful build does not establish
browser coverage or physical printing quality.
