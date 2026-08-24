/**
 * The four states of a track's single star control in the Tracks view (v10
 * issue 13): unmarked, must-include, forced-first, forced-last. One click
 * cycles to the next; only one track can be first and one last, so the cycle
 * skips a pin stage already held by another track.
 */
export type StarState = 'none' | 'must' | 'first' | 'last'

/**
 * The one pair of glyphs for "opens the set" / "closes the set" (v31 #5).
 * Shared by the Tracks-view star, the selected-track card's mark toggles and
 * the set list's pin, which used to draw a 📌 pushpin for the same idea.
 */
export const PIN_FIRST_GLYPH = '⏮'
export const PIN_LAST_GLYPH = '⏭'

/**
 * The next state a click moves to. `firstTakenByOther` / `lastTakenByOther`
 * report whether ANOTHER track holds that pin (self never counts), so the
 * stage is skipped when it is unavailable.
 */
export function nextStarState(
  current: StarState,
  firstTakenByOther: boolean,
  lastTakenByOther: boolean,
): StarState {
  switch (current) {
    case 'none':
      return 'must'
    case 'must':
      if (!firstTakenByOther) return 'first'
      if (!lastTakenByOther) return 'last'
      return 'none'
    case 'first':
      return lastTakenByOther ? 'none' : 'last'
    case 'last':
      return 'none'
  }
}
