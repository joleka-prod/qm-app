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
        name: 'JOLEKA - Einfach besonders!',
        short_name: 'JOLEKA',
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
      },
    }),
  ],
})
