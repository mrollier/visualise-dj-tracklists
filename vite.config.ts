import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

/**
 * Stamp the service worker's cache name with a hash of this build's output
 * files, so each deploy invalidates the previous offline cache. Fails the
 * build if the placeholder is missing — an unstamped worker would cache
 * forever.
 */
function stampServiceWorker(): Plugin {
  let outDir = 'dist'
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir
    },
    writeBundle(_options, bundle) {
      const file = join(outDir, 'sw.js')
      const source = readFileSync(file, 'utf8')
      if (!source.includes('__BUILD_ID__')) {
        throw new Error('public/sw.js has no __BUILD_ID__ placeholder to stamp')
      }
      const id = createHash('sha256')
        .update(Object.keys(bundle).sort().join('\n'))
        .digest('hex')
        .slice(0, 12)
      writeFileSync(file, source.replaceAll('__BUILD_ID__', id))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), stampServiceWorker()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
