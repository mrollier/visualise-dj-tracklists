import { describe, expect, test } from 'vitest'
import { nextStarState, PIN_FIRST_GLYPH, PIN_LAST_GLYPH, type StarState } from '../src/core/pins'

describe('nextStarState (v10 issue 13)', () => {
  test('cycles none → must → first → last → none when both pins are free', () => {
    expect(nextStarState('none', false, false)).toBe('must')
    expect(nextStarState('must', false, false)).toBe('first')
    expect(nextStarState('first', false, false)).toBe('last')
    expect(nextStarState('last', false, false)).toBe('none')
  })

  test('skips first when another track already holds it', () => {
    expect(nextStarState('must', true, false)).toBe('last')
  })

  test('skips last when another track already holds it', () => {
    expect(nextStarState('first', false, true)).toBe('none')
  })

  test('skips both pins when both are held elsewhere', () => {
    expect(nextStarState('must', true, true)).toBe('none')
  })

  test('a short click from none always turns must-include on', () => {
    const states: StarState[] = ['none']
    expect(nextStarState(states[0], true, true)).toBe('must')
  })
})

describe('shared first/last glyphs (v31 #5)', () => {
  test('the set list, the Tracks star and the track card all name one pair', () => {
    // Guards the de-duplication: three surfaces, one constant each. The set
    // list's 📌 pushpin is gone.
    expect(PIN_FIRST_GLYPH).toBe('⏮')
    expect(PIN_LAST_GLYPH).toBe('⏭')
  })
})
