import { describe, expect, test } from 'vitest'
import {
  buildComboGraph,
  countComboPairs,
  DEFAULT_CRITERIA,
  focusEdgesFor,
  makeGenreMatcher,
  type CriteriaConfig,
} from '../src/core/combos'
import { suggestNext, suggestWalk } from '../src/core/suggest'
import { randomLibrary } from './helpers'

/**
 * A 10k-track library must feel instant: nothing the app does per click may
 * scan every pair. Budgets are generous against a laptop's numbers (noted per
 * test) so a slow CI runner does not flake, yet an O(n²) path — tens of
 * seconds at this size — fails them by two orders of magnitude.
 */
const tracks = randomLibrary(10_000, 11)
const time = (run: () => unknown) => {
  const start = performance.now()
  run()
  return performance.now() - start
}

describe.each<[string, CriteriaConfig]>([
  ['the defaults', structuredClone(DEFAULT_CRITERIA)],
  ['require 1', { ...structuredClone(DEFAULT_CRITERIA), threshold: 1 }],
])('10k tracks at %s', (_, criteria) => {
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria.genre.k,
  )
  const options = { genreMatch, avoidSameArtist: true }

  test('building the graph and one selection star', () => {
    const graph = buildComboGraph(tracks, criteria, genreMatch)
    expect(time(() => focusEdgesFor(graph, 't123', false))).toBeLessThan(300)
  })

  test('the pair count', () => {
    const graph = buildComboGraph(tracks, criteria, genreMatch)
    expect(time(() => countComboPairs(graph))).toBeLessThan(600)
  })

  test('one hub press, opener and continuation', () => {
    expect(time(() => suggestNext(tracks, criteria, [], { ...options, seed: 1 }))).toBeLessThan(300)
    expect(
      time(() => suggestNext(tracks, criteria, ['t5', 't9'], { ...options, seed: 1 })),
    ).toBeLessThan(300)
  })

  test('one ✨ walk of 15', () => {
    expect(time(() => suggestWalk(tracks, criteria, { ...options, seed: 1 }))).toBeLessThan(600)
  })
})
