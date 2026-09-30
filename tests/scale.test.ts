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
 * scan every pair. Each budget sits about 8× or more above a laptop's time,
 * because a CI runner working through the whole suite was measured about 4×
 * slower. An O(n²) path, seconds to tens of seconds at this size, still fails.
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
    expect(time(() => suggestWalk(tracks, criteria, { ...options, seed: 1 }))).toBeLessThan(1500)
  })
})

describe('10k tracks where many can never pair', () => {
  // A track with no metadata, or missing a demanded field, matches nothing.
  // The random opener asks every track whether it has a partner, so each one
  // must answer at once rather than scan the library.
  const sparse = randomLibrary(10_000, 12, { bare: 0.2, noGenre: 0.3 })

  test('one ✨ walk with no selection, at the defaults', () => {
    const criteria = structuredClone(DEFAULT_CRITERIA)
    const genreMatch = makeGenreMatcher(
      sparse.map((t) => t.genre),
      criteria.genre.k,
    )
    expect(time(() => suggestWalk(sparse, criteria, { genreMatch, seed: 1 }))).toBeLessThan(600)
  })

  test('one hub press on an empty set with the genre locked', () => {
    const criteria = structuredClone(DEFAULT_CRITERIA)
    criteria.genre.demanded = true
    const genreMatch = makeGenreMatcher(
      sparse.map((t) => t.genre),
      criteria.genre.k,
    )
    expect(time(() => suggestNext(sparse, criteria, [], { genreMatch, seed: 1 }))).toBeLessThan(300)
  })
})
