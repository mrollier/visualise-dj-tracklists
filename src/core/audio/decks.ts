/**
 * The two-deck state machine.
 *
 * Deck A is the track the user pinned; deck B holds the last track the user
 * clicked directly (v29 #10 — it followed `selectedId` until then).
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
  /** The last directly-clicked track, or null. */
  b: string | null
}

export const EMPTY_DECKS: DeckState = { a: null, aLocked: false, b: null }

export type DeckEvent =
  /**
   * The user clicked a track directly — a wheel star or a Tracks-view row
   * (v29 #10). NOT "the selection changed": `selectedId` also moves for hub
   * picks, undo/redo, background clicks and project loads, none of which are
   * anyone asking to hear something. So `id` is always a real track; there is
   * no null case to latch against any more.
   */
  | { type: 'select'; id: string }
  | { type: 'lock' }
  | { type: 'unlock' }
  /** Library replaced or reloaded: ids that still exist. */
  | { type: 'library'; knownIds: ReadonlySet<string> }

export type DeckEffect =
  | { kind: 'load'; deck: DeckId; trackId: string }
  | { kind: 'clear'; deck: DeckId }
  /**
   * Swap which element plays which role, in either direction: lock moves deck
   * B up, unlock moves deck A down (v29 #8). The element being kept goes on
   * playing, uninterrupted, at its exact position — reloading it from the same
   * file at 0:00 would restart the audio mid-listen, which is precisely wrong
   * for both "pin this one" and "keep only this one". The `clear` that always
   * follows disposes of the side being discarded.
   */
  | { kind: 'promote' }

export interface DeckTransition {
  state: DeckState
  effects: readonly DeckEffect[]
}

export function reduceDecks(state: DeckState, event: DeckEvent): DeckTransition {
  switch (event.type) {
    case 'select': {
      // Re-clicking the loaded track is a no-op, which is what keeps a
      // click-to-deselect gesture from restarting the audio underneath it.
      if (event.id === state.b) return { state, effects: [] }
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
      if (state.a === null) return { state, effects: [] }
      // Unpinning KEEPS the track it is named after (v29 #8). It used to clear
      // deck A and leave deck B, which threw away the very track the button
      // says it is acting on. The promote swaps roles so the pinned element
      // goes on playing, uninterrupted, as the single deck B; whatever deck B
      // held is what goes.
      return {
        state: { ...state, a: null, aLocked: false, b: state.a },
        effects: [{ kind: 'promote' }, { kind: 'clear', deck: 'a' }],
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
