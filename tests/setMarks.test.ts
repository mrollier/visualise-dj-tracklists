import { get } from 'svelte/store'
import { beforeEach, describe, expect, test } from 'vitest'
import { freshFirstSet } from '../src/core/sets'
import {
  activeSet,
  activeSetId,
  addSet,
  deleteSet,
  mustInclude,
  patchActiveSet,
  pinnedFirst,
  pinnedLast,
  setGeneratedTracklist,
  sets,
} from '../src/stores'

describe('★ essentials and ⏮/⏭ pins belong to their constellation', () => {
  beforeEach(() => {
    const first = freshFirstSet()
    sets.set([first])
    activeSetId.set(first.id)
  })

  test('a fresh set carries no marks', () => {
    expect(freshFirstSet()).toMatchObject({ mustInclude: [], pinnedFirst: null, pinnedLast: null })
  })

  test('switching sets switches the marks with it', () => {
    const firstId = get(activeSetId)
    mustInclude.set(['a'])
    pinnedFirst.set('b')
    addSet()
    expect(get(mustInclude)).toEqual([])
    expect(get(pinnedFirst)).toBeNull()
    pinnedLast.set('c')
    activeSetId.set(firstId)
    expect(get(mustInclude)).toEqual(['a'])
    expect(get(pinnedFirst)).toBe('b')
    expect(get(pinnedLast)).toBeNull()
  })

  test('marking a track does not turn a generated set into a hand-edited one', () => {
    setGeneratedTracklist(['a', 'b'])
    mustInclude.set(['a'])
    pinnedFirst.set('a')
    expect(get(activeSet).generated).toBe(true)
  })

  test('a new set can inherit the active set’s marks (the ✨ fork)', () => {
    patchActiveSet({ mustInclude: ['a'], pinnedFirst: 'b', pinnedLast: 'c' })
    addSet(true)
    expect(get(sets)).toHaveLength(2)
    expect(get(activeSet)).toMatchObject({
      trackIds: [],
      mustInclude: ['a'],
      pinnedFirst: 'b',
      pinnedLast: 'c',
    })
  })

  test('the marks store does not re-emit when only the tracklist changes', () => {
    mustInclude.set(['a'])
    let emissions = 0
    const stop = mustInclude.subscribe(() => emissions++)
    const settled = emissions
    setGeneratedTracklist(['x'])
    setGeneratedTracklist(['x', 'y'])
    expect(emissions).toBe(settled)
    stop()
  })

  test('deleting the active set activates its neighbour before the list shrinks', () => {
    const firstId = get(activeSetId)
    mustInclude.set(['a'])
    addSet()
    mustInclude.set(['z'])
    const seen: string[][] = []
    const stop = mustInclude.subscribe((ids) => seen.push(ids))
    deleteSet(get(activeSetId))
    stop()
    expect(get(activeSetId)).toBe(firstId)
    expect(get(mustInclude)).toEqual(['a'])
    // Never an intermediate where the deleted set's id resolves to sets[0]
    // under a stale activeSetId: every emission is one of the two real states.
    for (const ids of seen) expect([['z'], ['a']]).toContainEqual(ids)
  })
})
