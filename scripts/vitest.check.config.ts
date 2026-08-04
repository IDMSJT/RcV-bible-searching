import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Runs the `.check.ts` files, which the normal suite leaves alone — they need
 * a fetched cache and report rather than assert. See check_footnote_links.py. */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  test: {
    include: ['scripts/**/*.check.ts'],
    root: fileURLToPath(new URL('..', import.meta.url)),
    // The report is the point; vitest swallows console.log by default.
    disableConsoleIntercept: true,
  },
})
