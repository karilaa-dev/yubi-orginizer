import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  worker: { format: 'es' },
  plugins: [VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png', 'keys/*.stl', 'licenses/*.txt'],
    manifest: {
      id: '/', name: 'Keyform — YubiKey Organizer', short_name: 'Keyform',
      description: 'Design and export custom YubiKey organizers, entirely on your device.',
      theme_color: '#f6f7f9', background_color: '#f6f7f9', display: 'standalone',
      start_url: '/', scope: '/',
      icons: [
        { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,wasm,json,svg,png,stl,ttf,woff,woff2,txt}'],
      maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
      cleanupOutdatedCaches: true,
      navigateFallback: 'index.html',
    },
  })],
  build: { target: 'es2022' },
});
