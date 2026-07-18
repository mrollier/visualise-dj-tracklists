import { describe, expect, test } from 'vitest'
import {
  edgeTier,
  ghostAnchors,
  mapMotion,
  pairKey,
  skeletonKeys,
  skeletonOpacity,
} from '../src/core/genreMap'
import { packNeighbours } from '../src/core/genre'

const e = (a: string, b: string, score: number) => ({ a, b, score })

describe('pairKey (v13)', () => {
  test('is unordered', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'))
  })

  test('distinct pairs stay distinct', () => {
    expect(pairKey('a', 'b')).not.toBe(pairKey('a', 'c'))
  })
})

describe('skeletonKeys (v13 issue 2): each node keeps its strongest link', () => {
  test('no edges: empty skeleton', () => {
    expect(skeletonKeys([]).size).toBe(0)
  })

  test('weak third side of a triangle is dropped', () => {
    const keys = skeletonKeys([e('a', 'b', 0.9), e('b', 'c', 0.5), e('a', 'c', 0.2)])
    expect(keys).toEqual(new Set([pairKey('a', 'b'), pairKey('b', 'c')]))
  })

  test('every connected node keeps at least one edge (leaf edges survive)', () => {
    const keys = skeletonKeys([e('hub', 'x', 0.9), e('hub', 'y', 0.4), e('hub', 'z', 0.3)])
    expect(keys).toEqual(new Set([pairKey('hub', 'x'), pairKey('hub', 'y'), pairKey('hub', 'z')]))
  })

  test('score ties break to the lexicographically smaller pair', () => {
    // a ties between ab and ac; b and c both prefer bc — only a's tie-break
    // decides whether ab or ac survives, and it must be deterministic.
    const edges = [e('a', 'b', 0.5), e('a', 'c', 0.5), e('b', 'c', 0.9)]
    expect(skeletonKeys(edges)).toEqual(new Set([pairKey('a', 'b'), pairKey('b', 'c')]))
  })

  test('input order never changes the skeleton', () => {
    const edges = [e('a', 'b', 0.5), e('a', 'c', 0.5), e('b', 'c', 0.9)]
    expect(skeletonKeys([...edges].reverse())).toEqual(skeletonKeys(edges))
  })
})

describe('skeletonOpacity (v13): eases down as the map grows', () => {
  test('small maps get the full resting opacity', () => {
    expect(skeletonOpacity(10)).toBe(0.42)
    expect(skeletonOpacity(22)).toBe(0.42)
  })

  test('a 36-genre map is dimmer than a 22-genre map', () => {
    expect(skeletonOpacity(36)).toBeLessThan(skeletonOpacity(22))
    expect(skeletonOpacity(36)).toBeGreaterThan(0.16)
  })

  test('clamped to a readable floor on huge maps', () => {
    expect(skeletonOpacity(2000)).toBe(0.16)
  })
})

describe('mapMotion (v13): physics calm scales with node count', () => {
  test('small maps keep the classic damping and a gentle drag reheat', () => {
    // 0.15, not d3's classic 0.3: with this map's slow cooling a 0.3 target
    // keeps the whole field boiling for as long as the mouse is held.
    expect(mapMotion(22)).toEqual({ velocityDecay: 0.6, dragAlphaTarget: 0.15 })
  })

  test('bigger maps damp harder and drag with less energy', () => {
    const small = mapMotion(22)
    const mid = mapMotion(36)
    expect(mid.velocityDecay).toBeGreaterThan(small.velocityDecay)
    expect(mid.dragAlphaTarget).toBeLessThan(small.dragAlphaTarget)
  })

  test('both knobs clamp on huge maps', () => {
    expect(mapMotion(500)).toEqual({ velocityDecay: 0.8, dragAlphaTarget: 0.06 })
  })
})

describe('ghostAnchors (v13 issue 2): ghosts remember who summoned them', () => {
  test('unowned pack neighbours become ghosts anchored to their summoner', () => {
    const anchors = ghostAnchors(['techno'], 3)
    expect(anchors.size).toBe(3)
    for (const [ghost, summoners] of anchors) {
      expect(ghost).not.toBe('techno')
      expect([...summoners]).toEqual(['techno'])
    }
  })

  test('a neighbour already in the library never becomes a ghost', () => {
    const [first] = packNeighbours('techno', 1).map(([label]) => label)
    const anchors = ghostAnchors(['techno', first], 3)
    expect(anchors.has(first)).toBe(false)
  })

  test('perGenre limits how many ghosts each genre summons', () => {
    expect(ghostAnchors(['techno'], 1).size).toBe(1)
  })

  test('a ghost summoned twice records both anchors', () => {
    const stub = (label: string): [string, number][] =>
      label === 'a'
        ? [['g', 0.9]]
        : [
            ['g', 0.8],
            ['h', 0.5],
          ]
    const anchors = ghostAnchors(['a', 'b'], 3, stub)
    expect([...anchors.get('g')!].sort()).toEqual(['a', 'b'])
    expect([...anchors.get('h')!]).toEqual(['b'])
  })
})

describe('edgeTier (v13 issue 3): wheel-style focus on the map', () => {
  const resting = new Set([pairKey('a', 'b')])
  const rest = { hover: null, selected: null, pair: null }

  test('at rest only skeleton edges draw', () => {
    expect(edgeTier(e('a', 'b', 1), rest, resting)).toBe('skeleton')
    expect(edgeTier(e('a', 'c', 1), rest, resting)).toBe(null)
  })

  test('hovering a node lights its full star; the skeleton stays', () => {
    const state = { ...rest, hover: 'c' }
    expect(edgeTier(e('a', 'c', 1), state, resting)).toBe('star')
    expect(edgeTier(e('a', 'b', 1), state, resting)).toBe('skeleton')
    expect(edgeTier(e('b', 'd', 1), state, resting)).toBe(null)
  })

  test('a selected node focuses exactly like a hovered one', () => {
    const state = { ...rest, selected: 'c' }
    expect(edgeTier(e('a', 'c', 1), state, resting)).toBe('star')
    expect(edgeTier(e('b', 'd', 1), state, resting)).toBe(null)
  })

  test('the compare pair shows its one link over the resting skeleton', () => {
    const state = { ...rest, pair: ['c', 'a'] as [string, string] }
    expect(edgeTier(e('a', 'c', 1), state, resting)).toBe('pair')
    expect(edgeTier(e('a', 'b', 1), state, resting)).toBe('skeleton')
    // Touching a compared genre is NOT enough — only the pair's own link pops.
    expect(edgeTier(e('c', 'd', 1), state, resting)).toBe(null)
  })

  test('hover still previews during a comparison, and pair beats star', () => {
    const state = { ...rest, hover: 'a', pair: ['a', 'c'] as [string, string] }
    expect(edgeTier(e('a', 'd', 1), state, resting)).toBe('star')
    expect(edgeTier(e('a', 'c', 1), state, resting)).toBe('pair')
  })
})
