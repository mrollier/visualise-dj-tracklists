import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

// README promises that src/core is plain TypeScript, reusable outside the
// app: no Svelte, no DOM. This keeps the promise honest.
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sources(join(dir, entry.name))
      : entry.name.endsWith('.ts')
        ? [join(dir, entry.name)]
        : [],
  )
}

describe('src/core stays framework-free', () => {
  test('no module imports Svelte', () => {
    const offenders = sources('src/core').filter((file) =>
      /from ['"]svelte/.test(readFileSync(file, 'utf8')),
    )
    expect(offenders).toEqual([])
  })
})
