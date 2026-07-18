import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { computeGenreCoverage } from '../src/core/genre'
import { importRekordboxXml } from '../src/core/importers/rekordbox'

/**
 * The genre-alias miner (v12 WS7) — a dev tool, not a test. Runs only when
 * pointed at a local library export:
 *
 *   MINE_XML=docs/rekordbox/collection.xml npx vitest run tests/mine-genre-aliases.dev.test.ts
 *
 * It replays the app's exact resolution chain (importer → normalize → alias →
 * components → pack/tree lookup, via computeGenreCoverage) and writes every
 * unresolved label, frequency-ranked, to mine-genre-aliases.out.md next to
 * the XML. Those labels get mapped to known genres during development (with a
 * reject class for non-genres) and ship as static alias/tree data — the
 * runtime never calls an LLM. Vitest is the runner because it resolves the
 * TypeScript core directly: no duplicated normalization to drift.
 */
describe.runIf(process.env.MINE_XML !== undefined)('genre-alias miner', () => {
  test('dump unresolved labels for alias mining', () => {
    const path = process.env.MINE_XML!
    const { tracks } = importRekordboxXml(readFileSync(path, 'utf8'))
    const cov = computeGenreCoverage(tracks)
    const lines = [
      `# Unresolved genre labels — ${path}`,
      ``,
      `${cov.total} tracks · ${cov.blank} blank · ${cov.tagged} tagged · ` +
        `${cov.outside} outside the similarity data (${cov.invisible} invisible)`,
      ``,
      ...cov.top.map(({ label, count }) => `- ${label} ×${count}`),
      ``,
    ]
    const out = path.replace(/[^/]+$/, 'mine-genre-aliases.out.md')
    writeFileSync(out, lines.join('\n'))
    console.log(lines.slice(0, 3).join('\n'))
    console.log(`→ ${out} (${cov.top.length} labels)`)
    expect(cov.total).toBeGreaterThan(0)
  })
})
