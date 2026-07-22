import { defineConfig } from 'vitest/config'
import { svelte } from '@sveltejs/vite-plugin-svelte'

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte(), cloudflare()],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})