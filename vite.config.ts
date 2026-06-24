import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'node:path'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/RcV-bible-searching/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    VitePWA({
      // 'prompt' → the app asks before reloading to a new version.
      registerType: 'prompt',
      includeAssets: ['favicon-64x64.png', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: '綱目引經查詢',
        short_name: '綱目引經',
        description: '聖經恢復本：閱讀、經節查詢、綱目研讀',
        lang: 'zh-TW',
        theme_color: '#11476c',
        background_color: '#11476c',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache the app shell (hashed JS/CSS/HTML/fonts). The big bible
        // JSONs are deliberately NOT precached — they're runtime-cached below.
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        navigateFallbackDenylist: [/^\/[^/]+\.\w+$/],
        runtimeCaching: [
          {
            // verse / outline / annotations / English data: serve from cache
            // (instant + offline once fetched), refresh in the background so a
            // re-scraped file is picked up next visit.
            urlPattern: ({ url }) => url.pathname.endsWith('.json'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'bible-data',
              expiration: { maxEntries: 12, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      ignored: ['**/scripts/**'],
    },
  },
}))
