import { describe, expect, test } from 'vitest'
import { EMPTY_DECKS, reduceDecks, type DeckState } from '../src/core/audio/decks'

const loadedB: DeckState = { a: null, aLocked: false, b: 'x' }

describe('a direct click drives deck B', () => {
  test('clicking a track loads it into B', () => {
    const { state, effects } = reduceDecks(EMPTY_DECKS, { type: 'select', id: 'x' })
    expect(state).toEqual({ a: null, aLocked: false, b: 'x' })
    expect(effects).toEqual([{ kind: 'load', deck: 'b', trackId: 'x' }])
  })

  test('re-clicking the track already in B changes nothing', () => {
    // Clicking a selected track deselects it, and that gesture must not
    // restart — or empty — the deck playing underneath it.
    const { state, effects } = reduceDecks(loadedB, { type: 'select', id: 'x' })
    expect(state).toEqual(loadedB)
    expect(effects).toEqual([])
  })

  test('clicking a different track replaces B even mid-play', () => {
    const { state, effects } = reduceDecks(loadedB, { type: 'select', id: 'y' })
    expect(state.b).toBe('y')
    expect(effects).toEqual([{ kind: 'load', deck: 'b', trackId: 'y' }])
  })

  test('clicking the locked track still loads it into B', () => {
    const locked: DeckState = { a: 'x', aLocked: true, b: null }
    const { state } = reduceDecks(locked, { type: 'select', id: 'x' })
    expect(state).toEqual({ a: 'x', aLocked: true, b: 'x' })
  })
})

describe('lock', () => {
  test('promotes B into A and frees B for the next selection', () => {
    const { state, effects } = reduceDecks(loadedB, { type: 'lock' })
    expect(state).toEqual({ a: 'x', aLocked: true, b: null })
    // A role swap, not a reload: the element keeps playing at its position.
    expect(effects).toEqual([{ kind: 'promote' }, { kind: 'clear', deck: 'b' }])
  })

  test('locking again replaces the track already in A', () => {
    const both: DeckState = { a: 'x', aLocked: true, b: 'y' }
    const { state } = reduceDecks(both, { type: 'lock' })
    expect(state).toEqual({ a: 'y', aLocked: true, b: null })
  })

  test('locking with nothing in B does nothing', () => {
    const { state, effects } = reduceDecks(EMPTY_DECKS, { type: 'lock' })
    expect(state).toEqual(EMPTY_DECKS)
    expect(effects).toEqual([])
  })

  test('unlocking clears A', () => {
    const locked: DeckState = { a: 'x', aLocked: true, b: 'y' }
    const { state, effects } = reduceDecks(locked, { type: 'unlock' })
    expect(state).toEqual({ a: null, aLocked: false, b: 'y' })
    expect(effects).toEqual([{ kind: 'clear', deck: 'a' }])
  })

  test('unlocking when nothing is locked does nothing', () => {
    expect(reduceDecks(loadedB, { type: 'unlock' }).effects).toEqual([])
  })
})

describe('library changes', () => {
  const both: DeckState = { a: 'x', aLocked: true, b: 'y' }

  test('drops decks whose track left the library', () => {
    const { state, effects } = reduceDecks(both, { type: 'library', knownIds: new Set(['y']) })
    expect(state).toEqual({ a: null, aLocked: false, b: 'y' })
    expect(effects).toEqual([{ kind: 'clear', deck: 'a' }])
  })

  test('keeps a track that is merely filtered out of view', () => {
    // Decks follow `library`, never `visibleLibrary` — ticking a playlist
    // filter must not stop the music.
    const { state, effects } = reduceDecks(both, {
      type: 'library',
      knownIds: new Set(['x', 'y']),
    })
    expect(state).toEqual(both)
    expect(effects).toEqual([])
  })

  test('clears both decks when the whole library is replaced', () => {
    const { state, effects } = reduceDecks(both, { type: 'library', knownIds: new Set() })
    expect(state).toEqual(EMPTY_DECKS)
    expect(effects).toEqual([
      { kind: 'clear', deck: 'a' },
      { kind: 'clear', deck: 'b' },
    ])
  })
})
