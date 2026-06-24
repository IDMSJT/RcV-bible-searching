import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'
import path from 'node:path'

// vite-plugin-pwa 1.3 + vite 8 (rolldown) breaks the dev server's
// /@vite/client serving for `Sec-Fetch-Dest: script` requests (404), so we
// drop the real plugin in dev entirely. ReloadPrompt still imports
// `virtual:pwa-register/react`, so provide a no-op stub for that module in dev.
function pwaRegisterDevStub(): Plugin {
  const id = 'virtual:pwa-register/react'
  const resolved = '\0' + id
  return {
    name: 'pwa-register-dev-stub',
    resolveId: (source) => (source === id ? resolved : undefined),
    load: (loadId) =>
      loadId === resolved
        ? `import { useState } from 'react'
export function useRegisterSW() {
  return {
    needRefresh: useState(false),
    offlineReady: useState(false),
    updateServiceWorker: () => {},
  }
}`
        : undefined,
  }
}

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
    // Real PWA plugin only for the build; a no-op stub in dev (see above).
    ...(command !== 'build'
      ? [pwaRegisterDevStub()]
      : [
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
      ]),
  ],
  server: {
    // Listen on all interfaces (IPv4 + IPv6), not just localhost/[::1]. A
    // cloudflared tunnel pointed at 127.0.0.1 then connects reliably — proxying
    // to an IPv6-only [::1] bind is flaky under a browser's concurrent module
    // requests (504s).
    host: true,
    allowedHosts: ['.trycloudflare.com'],
    watch: {
      ignored: ['**/scripts/**'],
    },
  },
}))
