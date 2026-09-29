# Keyform

Design printable YubiKey organizers in your browser. Keyform generates actual
models with OpenSCAD WASM and previews them with Three.js. Designs, saved projects,
and exports stay on your device; no account or backend is required.

## Features

- Desktop docks, modular cartridge rails, inventory trays, Gridfinity organizers,
  and travel cases.
- Six key shapes: YubiKey 5 NFC, 5C NFC, 5 Nano, 5C Nano, 5C, and 5Ci.
- Adjustable layouts, finger access, key retention, printed labels and lids.
- Three tray types: non-stackable, lift-off stacking, and H20/V7 slide-lock.
- Socket and mechanical fit samples, including a two-pin slide-lock pair.
- STL, editable SCAD, 3MF and project JSON exports.
- Local project saving and offline use after the app has been cached.

## Getting started

Use Node.js **22.12 or newer** and npm. An `.nvmrc` is included for Node 22.

```sh
npm ci
npm run dev
```

Open the localhost URL printed by Vite. For a production build and local preview:

```sh
npm run build
npm run preview
```

The build outputs a static site in `dist/`. Production preview supports the
service worker; the development server does not install the offline app.

## Using Keyform

1. Choose an organizer and add keys. Repeated keys and custom labels are supported.
2. Adjust **Size & layout**. Hiding a reference key preserves its pocket; removing
   a key removes the pocket.
3. Inspect the preview and use **Explode** to view separate parts.
4. Save a named project locally, or download a project JSON backup.
5. Choose **Download**, select the parts and export format, then inspect the file
   in your slicer before printing.

For matching tray layers with different contents, use **Lock tray dimensions**
to preserve their outside width and depth. Choose **Non-stackable** for a standalone
tray with an optional lift-off lid, **Stackable** for locating rims, or **Slide-lock**
for the two-pin H20/V7 connection. Saved enclosure snap-fit projects retain their
geometry. Regenerate both mating parts when changing the connection type.

See [printing and fit](docs/printing.md) and the
[H20/V7 slide-lock design](docs/h20-slide-lock.md). Physical fit, retention
and durability require a printed sample; digital validation is not a physical test.

Saved projects belong to the browser and device where they were created.
Clearing site data removes them, so export JSON backups for important designs.
Wait for **Available offline** before disconnecting. Use **Save & update** when
a new application version is offered.

## Development

```sh
npm run check
npm run build
```

GitHub Actions runs tests and a production build on pushes and pull requests.
See [development and geometry validation](docs/development.md) for the real-WASM
checks, sample exports, optional Python tools, and hosting requirements.

| Directory | Contents |
| --- | --- |
| `src/` | UI, project data, CAD generation, preview and exports |
| `src/geometry/profiles/` | Required calibrated SCAD contours and socket cutters |
| `public/` | Runtime icons, reference-key meshes and dependency notices |
| `tests/` | Automated regression tests |
| `scripts/` | Asset generation, mesh validation and sample exports |
| `docs/` | Development and printing documentation |
| `artifacts/` | Generated local reports, samples and historical experiments; ignored by Git |

## Hosting

Serve the complete `dist/` directory from HTTPS at the **origin root**, or use
localhost for testing. The current PWA uses `/` for its start URL and scope.
A GitHub Pages project URL under `/repository-name/` needs corresponding Vite
base-path and PWA configuration changes; it is not configured by default.

## Licensing and attribution

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency and geometry
provenance. No top-level license has been selected for the application, and the
supplied CAD profiles have no separate license declaration in this workspace.
Third-party components retain their existing licenses, including the GPL-2.0-only
OpenSCAD WASM runtime. Do not assume the whole repository is MIT-licensed.

YubiKey and Yubico names identify supported form factors. This project is not
affiliated with or endorsed by Yubico.
