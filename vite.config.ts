import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'QM-Tickets',
        short_name: 'QM',
        description: 'Qualitätsmeldungen erfassen und bearbeiten',
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
