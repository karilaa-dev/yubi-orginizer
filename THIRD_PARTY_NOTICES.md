# Third-party notices

yubi-orginizer uses the following third-party components. Exact installed versions and dependency integrity values are recorded in `package-lock.json`. The license labels below reflect the installed packages and bundled notices; they do not replace the complete license texts.

## Model generation and fonts

**OpenSCAD WASM:** [`@lofcz/openscad-wasm@0.0.2`](https://www.npmjs.com/package/@lofcz/openscad-wasm/v/0.0.2), pinned exactly by this application, declares **GPL-2.0-only**. Its full license is in `node_modules/@lofcz/openscad-wasm/COPYING`. The [source and build instructions](https://github.com/lofcz/openscad-wasm) identify the community build and its relationship to the [upstream OpenSCAD WASM project](https://github.com/openscad/openscad-wasm). The package includes the compiled OpenSCAD runtime and its dependencies; their upstream notices remain applicable. This project does not relabel that binary as MIT.

**Liberation fonts:** The runtime's bundled fonts carry **SIL Open Font License 1.1**. The packaged notice credits digitized data to Google Corporation (2010), with reserved names Arimo, Tinos, and Cousine, and Red Hat, Inc. (2012), with reserved name Liberation. The complete `LICENSE` and `AUTHORS` files are embedded in the package's `openscad.fonts.js` alongside the font files. See the [Liberation Fonts source and license](https://github.com/liberationfonts/liberation-fonts/blob/main/LICENSE). yubi-orginizer uses Liberation Sans Bold for manufactured lettering.

## Application and development dependencies

| Component | Purpose | License and source |
| --- | --- | --- |
| Three.js | Display of generated STL and reference meshes | [MIT](https://github.com/mrdoob/three.js/blob/dev/LICENSE) |
| fflate | Local ZIP export | [MIT](https://github.com/101arrowz/fflate/blob/master/LICENSE) |
| Vite | Development server and static build | [MIT](https://github.com/vitejs/vite/blob/main/LICENSE) |
| TypeScript | Static type checking | [Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt) |
| vite-plugin-pwa | PWA build integration | [MIT](https://github.com/vite-pwa/vite-plugin-pwa/blob/main/LICENSE) |
| Workbox | Generated service worker and precaching | [MIT](https://github.com/GoogleChrome/workbox/blob/v7/LICENSE) |
| Vitest | Automated tests | [MIT](https://github.com/vitest-dev/vitest/blob/main/LICENSE) |
| tsx | TypeScript execution for development scripts | [MIT](https://github.com/privatenumber/tsx/blob/master/LICENSE) |
| @resvg/resvg-js | Local PNG app-icon generation | [MPL-2.0](https://github.com/yisibl/resvg-js/blob/main/LICENSE) |

Installed packages provide their own complete license files under `node_modules/`. Transitive packages retain their respective copyright and license notices.

## Research and dimensional references

The calibrated cutters and recovered silhouettes in `src/geometry/profiles/` originated in the supplied `YubiKey_Holder_Concepts_1_to_5_Package`. Required definitions were recovered unchanged from an existing self-contained SCAD export; the original research package is not needed at build time. No separate license declaration for those materials was available in the workspace. This notice does not assign them a new license.

The Gridfinity base geometry is implemented using dimensions documented in [gridfinity-rebuilt-openscad's `standard.scad`](https://raw.githubusercontent.com/kennetek/gridfinity-rebuilt-openscad/main/src/core/standard.scad): 42 mm pitch, 41.5 mm base-top dimensions, and the 0.8 + 1.8 + 2.15 mm foot profile. This is a dimensional reference for the application's own template implementation.

YubiKey and Yubico names identify the supported form factors. This independent project is not affiliated with or endorsed by Yubico.
