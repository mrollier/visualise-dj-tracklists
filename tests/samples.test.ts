import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA, evaluateCombo } from '../src/core/combos'
import { SAMPLE_PACKS } from '../src/data/samples'

describe('sample packs', () => {
  test('there are ten themed packs', () => {
    expect(SAMPLE_PACKS).toHaveLength(10)
    expect(new Set(SAMPLE_PACKS.map((p) => p.id)).size).toBe(10)
  })

  test.each(SAMPLE_PACKS.map((p) => [p.name, p] as const))(
    '%s: has a substantial library and a demo set of known tracks',
    (_name, pack) => {
      expect(pack.tracks.length).toBeGreaterThanOrEqual(18)
      expect(new Set(pack.tracks.map((t) => t.id)).size).toBe(pack.tracks.length)
      expect(pack.set.length).toBeGreaterThanOrEqual(7)
      const ids = new Set(pack.tracks.map((t) => t.id))
      for (const id of pack.set) expect(ids.has(id)).toBe(true)
      expect(new Set(pack.set).size).toBe(pack.set.length)
    },
  )

  test.each(SAMPLE_PACKS.map((p) => [p.name, p] as const))(
    '%s: every demo-set transition is a combo (half/double-time allowed)',
    (_name, pack) => {
      const criteria = structuredClone(DEFAULT_CRITERIA)
      criteria.bpm.halfDouble = true // the Halftime & Bass pack demos this
      const byId = new Map(pack.tracks.map((t) => [t.id, t]))
      for (let i = 1; i < pack.set.length; i++) {
        const a = byId.get(pack.set[i - 1])!
        const b = byId.get(pack.set[i])!
        expect(evaluateCombo(a, b, criteria).isCombo, `${a.title} → ${b.title}`).toBe(true)
      }
    },
  )
})
