# yubi-orginizer

Design printable YubiKey organizers in your browser. yubi-orginizer generates
actual models with OpenSCAD WASM and previews them with Three.js. Projects and
exports stay on your device; no account or backend is required.

## Features

- Inventory trays and desktop docks. Desktop dock socket fit is still being
  refined; print a small one-key dock before a full organizer.
- Six key shapes: YubiKey 5 NFC, 5C NFC, 5 Nano, 5C Nano, 5C, and 5Ci.
- Adjustable layouts, finger scoops, printed labels, front text and lids.
  Retention tabs are available but not yet tested in print, so they start off.
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
   need. Repeated keys and custom labels are supported; **Organizer type**,
   **Columns**, **Print labels** and the label **Size** are at the top of the tab. Hiding a
   key in the preview keeps its pocket; removing a key removes the pocket.
3. In the **Size** tab, choose the **Footprint** (**Fit to keys**,
   **Fixed size**, or **Match project** to copy the width and depth of another
   saved tray) and the height. **Spacing** below sets the column and row spacing
   and the edge margin.
4. In **Tray settings** (or **Dock settings**), adjust the groups: **Stacking**,
   **Lid** and **Pockets & text** (or **Text** for docks). A collapsed group
   shows a summary of its current settings. Front text is engraved into the
   front wall; it can be resized, but small text won't print crisply.
5. Changes save automatically; the editor bar shows **Saved**. Select the project
   name to rename it. The **⋯** project menu offers Rename, Duplicate,
   **New matching layer**, **Save project file (.json)** and Delete. Deleting can
   be undone, and deleted projects stay under **Recently deleted** on the
   Projects page for 30 days.
6. Inspect the preview and use **Explode** to view separate parts. Choose
   **Download**, select the parts and export format, then inspect the file in
   your slicer before printing. Downloaded files are named after the project.

Under **Stacking**, choose **Standalone** for a single tray with an optional
lift-off lid, **Stackable** for locating rims, or **Slide-lock** for the two-pin
H20/V7 connection. Every layer of a stack needs the same size, connection and
slide direction. **New matching layer** creates an empty tray that stacks on the
current one: it switches the current tray to **Size › Fixed size** so the
outside dimensions match, copies the connection and layout, and can move the lid
to the new top layer. You can also set **Size › Fixed size** by hand, or use
**Size › Match project** to give an existing tray the footprint of another. Saved enclosure snap-fit projects retain their geometry and appear as
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

Publishing a GitHub release deploys the site to GitHub Pages
(`.github/workflows/pages.yml`): creating the release's tag runs the tests,
builds under the Pages base path and deploys `dist/`. The workflow can also be
run by hand from the Actions tab. **Help › About** shows the commit the build
was made from, linked to GitHub.

To host elsewhere, serve the complete `dist/` directory over HTTPS. Builds use
`/` as the base path by default; set `BASE_PATH` (for example
`BASE_PATH=/yubi-orginizer`) when building for a sub-path. The PWA start URL
and scope follow it.

## Licensing and attribution

yubi-orginizer is released under the [MIT License](LICENSE). See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for dependency and geometry
provenance: third-party components keep their own licenses, including the
GPL-2.0-only OpenSCAD WASM runtime and the SIL OFL 1.1 Liberation fonts, and the
supplied CAD profiles in `src/geometry/profiles/` have no separate license
declaration.

YubiKey and Yubico names identify supported form factors. This project is not
affiliated with or endorsed by Yubico.
