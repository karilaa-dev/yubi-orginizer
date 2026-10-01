import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const sha = process.env.GITHUB_SHA?.slice(0, 7);
// VITE_BUILD_ID lets tests force distinct builds (every distinct id changes the entry chunk).
const buildId = process.env.VITE_BUILD_ID
  || new Date().toISOString().slice(0, 16).replace('T', ' ') + (sha ? ` · ${sha}` : '');

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkg.version), __BUILD_ID__: JSON.stringify(buildId) },
  worker: { format: 'es' },
  // Pre-bundling rewrites the package's `new URL(`./${path}`, import.meta.url)`
  // into a glob over the deps cache, which breaks the render worker in dev.
  optimizeDeps: { exclude: ['@lofcz/openscad-wasm'] },
  plugins: [VitePWA({
    registerType: 'prompt',
    injectRegister: false,              // src/pwa.ts registers `${BASE_URL}sw.js` itself
    manifest: {
      id: '/', name: 'yubi-orginizer', short_name: 'yubi-orginizer',
      description: 'Design and export custom YubiKey organizers, entirely on your device.',
      theme_color: '#f5f6f4', background_color: '#f5f6f4', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm,json,svg,png,stl,ttf,woff,woff2,txt}'],
      // The OpenSCAD loader's `new URL(`./${path}`)` makes Vite emit every file of the
      // package, but the fonts are bundled into the render worker and MCAD is unused:
      // these two assets are never fetched. Revert if offline lid text/labels fail (N.34).
      globIgnores: ['**/assets/openscad.fonts-*.js', '**/assets/openscad.mcad-*.js'],
      maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      navigateFallback: 'index.html',
    },
  })],
  build: { target: 'es2022' },
});
