import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// Served from a sub-path on GitHub Pages project sites (BASE_PATH=/yubi-orginizer); '/' elsewhere.
const base = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');
const commit = process.env.GITHUB_SHA || gitHead();
const commitUrl = process.env.GITHUB_SHA && process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`
  : '';
const buildTime = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
// VITE_BUILD_ID lets tests force distinct builds (every distinct id changes the entry chunk).
const buildId = process.env.VITE_BUILD_ID || buildTime + (commit ? ` · ${commit.slice(0, 7)}` : '');

function gitHead(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId),
    __BUILD_TIME__: JSON.stringify(buildTime),
    __COMMIT_SHA__: JSON.stringify(commit),
    __COMMIT_URL__: JSON.stringify(commitUrl),
  },
  worker: { format: 'es' },
  // Pre-bundling rewrites the package's `new URL(`./${path}`, import.meta.url)`
  // into a glob over the deps cache, which breaks the render worker in dev.
  optimizeDeps: { exclude: ['@lofcz/openscad-wasm'] },
  plugins: [VitePWA({
    registerType: 'prompt',
    injectRegister: false,              // src/pwa.ts registers `${BASE_URL}sw.js` itself
    manifest: {
      id: base, name: 'yubi-orginizer', short_name: 'yubi-orginizer',
      description: 'Design and export custom YubiKey organizers, entirely on your device.',
      theme_color: '#f5f6f4', background_color: '#f5f6f4', display: 'standalone',
      start_url: base, scope: base,
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
