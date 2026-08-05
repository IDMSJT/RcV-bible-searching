import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import type { Plugin } from 'vite'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// App version shown in Settings. major.minor are hand-bumped in package.json
// (you decide when to jump those); the patch is the git commit count, so every
// commit auto-increments it at build time — e.g. 0.2.0 → "0.2.137".
// (CI must do a full clone — fetch-depth: 0 — or the count collapses to 1.)
function resolveAppVersion(): string {
  const { version } = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
  ) as { version: string }
  const [major = '0', minor = '0'] = version.split('.')
  let commits: string
  try {
    commits = execSync('git rev-list --count HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    // no git (e.g. tarball build) — fall back to the package.json patch
    commits = version.split('.')[2] ?? '0'
  }
  return `${major}.${minor}.${commits}`
}

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
  build: {
    rollupOptions: {
      output: {
        // Anything reached only through the scanner goes in its own folder, so
        // the service worker can leave the whole of it out of the precache.
        chunkFileNames: (chunk) =>
          /ScanCamera|scanPhoto|ppu-paddle-ocr|ppu-ocv|onnxruntime/.test(
            chunk.facadeModuleId ?? chunk.moduleIds?.join(' ') ?? '',
          )
            ? 'assets/ocr/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
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
      // 'prompt' keeps the new SW parked in `waiting` (so `needRefresh` fires);
      // <SwUpdate> then applies it *silently* — no prompt, no manual close. The
      // check runs on app launch (SPA route changes don't trigger it), so the
      // reload lands at startup, not mid-read.
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
        // Nor is the text recogniser. It is only reached by tapping 掃描, and
        // it arrives with a 25 MB runtime and 6 MB of model behind it — the
        // reader who never scans should not carry any of that. Everything it
        // needs is built into assets/ocr/ so one rule covers it.
        globIgnores: ['**/ocr/**'],
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
