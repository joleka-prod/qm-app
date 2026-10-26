import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Stand der Version, wird unten in der App angezeigt
const BUILD = new Date().toLocaleString('de-DE', {
  timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'JOLEKA 360°',
        short_name: 'JOLEKA 360°',
        description: 'Aufträge, Monteurplanung und Zeiterfassung',
        lang: 'de',
        theme_color: '#1d4ed8',
        background_color: '#f4f6f9',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        // Supabase-Anfragen nie aus dem Cache bedienen
        navigateFallbackDenylist: [/^\/auth/, /^\/rest/, /^\/storage/],
        // Fotos und Unterschriften für den Offline-Modus im Handy behalten. Der Link enthält ein
        // wechselndes Zugriffstoken, die Datei selbst ändert sich nie: deshalb ohne Token vergleichen.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/sign/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'fotos',
              matchOptions: { ignoreSearch: true },
              expiration: { maxEntries: 600, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
})
