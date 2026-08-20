/**
 * The two-deck state machine.
 *
 * Deck A is the track the user pinned; deck B mirrors the current selection.
 * The reducer returns EFFECTS rather than touching anything, which is what lets
 * the whole machine — including the element-swap decision — be covered by unit
 * tests in a repo whose vitest runs with no DOM at all. The engine is a dumb
 * interpreter of these effects.
 */
export type DeckId = 'a' | 'b'

export interface DeckState {
  /** The pinned track, or null. */
  a: string | null
  aLocked: boolean
  /** The selected track, or null. */
  b: string | null
}

export const EMPTY_DECKS: DeckState = { a: null, aLocked: false, b: null }

export type DeckEvent =
  /**
   * The selection changed. `bPlaying` is the caller's report of whether deck B
   * is actually making sound right now — the reducer stays pure, so it cannot
   * ask the engine itself.
   */
  | { type: 'select'; id: string | null; bPlaying: boolean }
  | { type: 'lock' }
  | { type: 'unlock' }
  /** Library replaced or reloaded: ids that still exist. */
  | { type: 'library'; knownIds: ReadonlySet<string> }

export type DeckEffect =
  | { kind: 'load'; deck: DeckId; trackId: string }
  | { kind: 'clear'; deck: DeckId }
  /**
   * Swap which element plays which role. The element that was deck B keeps
   * playing, uninterrupted, at its exact position — reloading A from B's file
   * at 0:00 would restart the audio mid-listen, which is precisely wrong for a
   * "pin this one" gesture.
   */
  | { kind: 'promote' }

export interface DeckTransition {
  state: DeckState
  effects: readonly DeckEffect[]
}

export function reduceDecks(state: DeckState, event: DeckEvent): DeckTransition {
  switch (event.type) {
    case 'select': {
      if (event.id === state.b) return { state, effects: [] }
      if (event.id === null) {
        // Latch (v28.1). Clicking bare wheel background (WheelView) or empty
        // left-panel space (CriteriaPanel) clears selectedId, and re-clicking a
        // node to dismiss its focus star is a constant gesture — none of which
        // may cut audio the user is in the middle of judging. A silent deck has
        // nothing to interrupt, so it still clears, which is what lets the bar
        // return to its empty state.
        if (event.bPlaying) return { state, effects: [] }
        return { state: { ...state, b: null }, effects: [{ kind: 'clear', deck: 'b' }] }
      }
      return {
        state: { ...state, b: event.id },
        effects: [{ kind: 'load', deck: 'b', trackId: event.id }],
      }
    }
    case 'lock': {
      if (state.b === null) return { state, effects: [] }
      return {
        state: { a: state.b, aLocked: true, b: null },
        // The promote swaps roles; whatever the old A element held is now in
        // role B and has to go.
        effects: [{ kind: 'promote' }, { kind: 'clear', deck: 'b' }],
      }
    }
    case 'unlock': {
      if (state.a === null && !state.aLocked) return { state, effects: [] }
      return {
        state: { ...state, a: null, aLocked: false },
        effects: [{ kind: 'clear', deck: 'a' }],
      }
    }
    case 'library': {
      const effects: DeckEffect[] = []
      const next = { ...state }
      if (state.a !== null && !event.knownIds.has(state.a)) {
        next.a = null
        next.aLocked = false
        effects.push({ kind: 'clear', deck: 'a' })
      }
      if (state.b !== null && !event.knownIds.has(state.b)) {
        next.b = null
        effects.push({ kind: 'clear', deck: 'b' })
      }
      return { state: next, effects }
    }
  }
}
