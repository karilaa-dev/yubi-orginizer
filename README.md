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
   need. Repeated keys and custom labels are supported; **Organizer type** is at the top of the tab. In a project with multiple trays,
   it stays locked to Inventory tray; hover or click for an explanation. Hiding a
   key in the preview keeps its pocket; removing a key removes the pocket. Each
   tray key has a **Vertical / Horizontal** rotation button that turns its pocket,
   finger access, retention features and label together. **Arrange compactly**
   rotates and packs the layer with room for labels and finger access; Undo restores it.
3. In the **Size** tab, choose the **Footprint** (**Fit to keys**,
   **Fixed size**, or **Match project** to copy the width and depth of another
   saved tray) and the height. **Spacing** below sets the column and row spacing
   and the edge margin. The footprint and tray height are shared by all layers; **Fit to keys** uses
   the minimum width and depth needed by the whole set. A change that exceeds a
   fixed size offers the proposed new size and **Cancel** before it is saved.
4. In **Tray settings** (or **Dock settings**), before Size, adjust **Columns**,
   **Print labels**, label **Size**, and **Pockets & text**
   (or **Text** for docks). A collapsed group
   shows a summary of its current settings. Front text is engraved into the
   front wall; it can be resized, but small text won't print crisply.
5. In the **Layers** tab, add, rename, duplicate, reorder or remove trays within
   one project (up to 16 layers). **All layers** previews the complete set;
   the default preview lays every tray and lid out in one row.
   Selecting a layer keeps the current tab, centers the camera on it, and makes other
   layers 75% transparent. The camera orbits the selected layer. Use **All layers**
   to restore the overview, or turn **Explode** off to see the stack. Drag trays by
   their handles to reorder them; keyboard arrows and the actions menu also work.
   The lid always stays on top.
   **Stacking** here sets the project connection and slide direction.
   Selecting the lid renames **Tray settings** to **Lid settings**, containing its style,
   text, text size and rotation. New layers start at minimum spacing with
   retention tabs off; duplicating a layer preserves its settings.
6. Use **Undo** and **Redo** in the editor bar to revert keys, settings, names and
   layer changes. Shortcuts: **Ctrl+Z** / **Ctrl+Shift+Z** (or **Ctrl+Y**),
   **⌘Z** / **⌘⇧Z** on Mac. Continuous typing and slider drags count as one edit;
   text fields keep native typing undo. The last 100 edits are available while
   the project stays open; reopening, reloading or adopting changes from another
   window starts a fresh history.
7. Changes save automatically; the editor bar shows **Saved**. Select the project
   name to rename it. The **⋯** project menu offers Rename, Duplicate,
   **New matching layer**, **Save project file (.json)** and Delete. Deleting can
   be undone, and deleted projects stay under **Recently deleted** on the
   Projects page for 30 days.
8. Inspect the preview and use **Explode** to view separate parts. Choose
   **Download**, select the parts and export format, then inspect the file in
   your slicer before printing. Download starts with every tray and lid selected,
   regardless of the preview. Toggle individual items in **Layers to download**. **Save project file (.json)**
   always includes the full set, including layer names and key rotations.

Under **Stacking**, choose **Standalone** for a single tray with an optional
lift-off lid, **Stackable** for locating rims, or **Slide-lock** for the two-pin
H20/V7 connection. Every layer of a stack needs the same size, connection and
slide direction. **Layers › Add tray** creates an empty tray in the current
project, shares its footprint and connection, and moves the top lid to
the new layer. Size, connection and slide direction changes apply to the whole
set; keys, labels and pocket settings belong to each layer. You can also set **Size › Fixed size** by hand, or use
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
