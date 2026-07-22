import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { addTrackToSet, selectedId, tracklist } from '../src/stores'

// S5: adding a track from the wheel/Tracks view splices it in after the
// selected in-set track, instead of always appending to the end.
describe('addTrackToSet', () => {
  beforeEach(() => {
    tracklist.set([])
    selectedId.set(null)
  })
  afterEach(() => {
    tracklist.set([])
    selectedId.set(null)
  })

  test('appends when nothing is selected', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set(null)
    addTrackToSet('d')
    expect(get(tracklist)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('appends when the selected track is NOT in the set', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set('z')
    addTrackToSet('d')
    expect(get(tracklist)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('inserts after the selected in-set track', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set('b')
    addTrackToSet('d')
    expect(get(tracklist)).toEqual(['a', 'b', 'd', 'c'])
  })

  test('inserts after the FIRST occurrence when the selected track repeats', () => {
    tracklist.set(['a', 'b', 'c', 'b'])
    selectedId.set('b')
    addTrackToSet('d')
    expect(get(tracklist)).toEqual(['a', 'b', 'd', 'c', 'b'])
  })

  test('skips an insert that would duplicate the track back-to-back', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set('b')
    addTrackToSet('b') // would put b right after b
    expect(get(tracklist)).toEqual(['a', 'b', 'c'])
  })

  // The wheel's double-click fires two `click`s first, which move (and then
  // toggle off) the selection before `ondblclick` runs — so the caller must be
  // able to name the anchor explicitly instead of trusting the live selection.
  test('an explicit anchor overrides the live selection', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set('c')
    addTrackToSet('d', 'a')
    expect(get(tracklist)).toEqual(['a', 'd', 'b', 'c'])
  })

  test('an explicit null anchor appends even with a selection', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set('b')
    addTrackToSet('d', null)
    expect(get(tracklist)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('an explicit anchor that is not in the set appends', () => {
    tracklist.set(['a', 'b', 'c'])
    selectedId.set('b')
    addTrackToSet('d', 'zz')
    expect(get(tracklist)).toEqual(['a', 'b', 'c', 'd'])
  })
})
