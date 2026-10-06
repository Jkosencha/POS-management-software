import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  // Fixed port: Supabase invite/reset emails link back to this exact address
  // (Authentication > URL Configuration), so it must not drift to 5174 etc.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['pwa-192.png', 'pwa-512.png', 'pwa-maskable-512.png', 'apple-touch-icon.png', 'favicon.svg'],
      manifest: {
        name: 'Sunrise Minimart POS',
        short_name: 'Sunrise POS',
        description: 'Point of sale, stock, and reports for Sunrise Minimart',
        theme_color: '#7c6cf0',
        background_color: '#f6f6fb',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell (JS/CSS/HTML) so the app opens even with zero connectivity.
        // Sales themselves are already queued in IndexedDB (offlineStore.js) and synced
        // separately by useOffline.js; this only covers the static app + reads.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin.includes('.supabase.co') && url.pathname.startsWith('/rest/'),
            // Network first with no timeout: cached data is only used when
            // the network is actually unreachable, never just because it's slow
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-rest-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
