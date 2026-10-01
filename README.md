# yubi-orginizer

Design printable YubiKey organizers in your browser. yubi-orginizer generates
actual models with OpenSCAD WASM and previews them with Three.js. Projects and
exports stay on your device; no account or backend is required.

## Features

- Inventory trays and desktop docks. Desktop dock socket fit is still being
  refined; print a small one-key dock before a full organizer.
- Six key shapes: YubiKey 5 NFC, 5C NFC, 5 Nano, 5C Nano, 5C, and 5Ci.
- Adjustable layouts, finger scoops, retention tabs, printed labels and lids.
- Three tray connections: Standalone, Stackable (lift-off locating rims) and
  H20/V7 Slide-lock.
- STL, editable SCAD, 3MF and project file (`.yubi-orginizer.json`) exports.
- Automatic saving in the browser, and offline use after the first visit.

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

## Using yubi-orginizer

1. The app opens on the **Projects** page, or on the project you had open last.
   Choose **Inventory tray** or **Desktop dock** to start a new project, or open
   an existing project card.
2. In the **Keys** tab, choose **Add keys** and set how many of each model you
   need. Repeated keys and custom labels are supported, and **Print labels** and
   **Label size** are at the top of the tab. Hiding a key in the preview keeps
   its pocket; removing a key removes the pocket.
3. In **Tray settings** (or **Dock settings**), adjust the groups: **Layout**,
   **Stacking**, **Lid**, **Size** and **Pockets & text**. A collapsed group
   shows a summary of its current settings.
4. Changes save automatically; the editor bar shows **Saved**. Select the project
   name to rename it. The **⋯** project menu offers Rename, Duplicate,
   **New matching layer**, **Save project file (.json)** and Delete. Deleting can
   be undone, and deleted projects stay under **Recently deleted** on the
   Projects page for 30 days.
5. Inspect the preview and use **Explode** to view separate parts. Choose
   **Download**, select the parts and export format, then inspect the file in
   your slicer before printing. Downloaded files are named after the project.

Under **Stacking**, choose **Standalone** for a single tray with an optional
lift-off lid, **Stackable** for locating rims, or **Slide-lock** for the two-pin
H20/V7 connection. Every layer of a stack needs the same size, connection and
slide direction. **New matching layer** creates an empty tray that stacks on the
current one: it switches the current tray to **Size › Fixed size** so the
outside dimensions match, copies the connection and layout, and can move the lid
to the new top layer. You can also set **Tray settings › Size › Fixed size** by
hand. Saved enclosure snap-fit projects retain their geometry and appear as
**Snap-fit (from an older version)**. Regenerate both mating parts when changing
the connection type.

See [printing and fit](docs/printing.md) and the
[H20/V7 slide-lock design](docs/h20-slide-lock.md). Physical fit, retention
and durability require a printed test; digital validation is not a physical test.

Projects belong to the browser and device where they were created. Clearing
site data removes them, so save project files for important designs, or use
**Export all (.zip)** on the Projects page. **Import** on the Projects page opens
`.json` project files, including files saved by earlier versions of the app, and
restores **Export all** backups: select the `.zip` as it is, no unzipping needed.
You can select several files at once.

After the first visit the app works offline. New versions install in the
background; refreshing applies them, or select **Update**.

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
