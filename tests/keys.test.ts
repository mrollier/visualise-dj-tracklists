import { describe, expect, test } from 'vitest'
import {
  ALL_CAMELOT_KEYS,
  camelotAngleDeg,
  camelotNumber,
  camelotRing,
  keysMatch,
  normalizeKey,
  transposeCamelot,
  wheelSlotAngleDeg,
  wheelStepDistance,
} from '../src/core/keys'

describe('normalizeKey: Camelot notation', () => {
  test('accepts all 24 canonical Camelot keys as-is', () => {
    for (const key of ALL_CAMELOT_KEYS) {
      expect(normalizeKey(key)).toBe(key)
    }
  })

  test('is case-insensitive and tolerates whitespace and leading zeros', () => {
    expect(normalizeKey('8a')).toBe('8A')
    expect(normalizeKey(' 08A ')).toBe('8A')
    expect(normalizeKey('12b')).toBe('12B')
  })

  test('rejects out-of-range Camelot numbers', () => {
    expect(normalizeKey('0A')).toBeNull()
    expect(normalizeKey('13B')).toBeNull()
  })
})

describe('normalizeKey: Open Key notation', () => {
  test('maps d (major) and m (minor) numbers to Camelot', () => {
    expect(normalizeKey('1d')).toBe('8B') // C major
    expect(normalizeKey('1m')).toBe('8A') // A minor
    expect(normalizeKey('2d')).toBe('9B') // G major
    expect(normalizeKey('12m')).toBe('7A') // D minor
  })

  test('wraps numbers above the 12-step cycle correctly', () => {
    expect(normalizeKey('6d')).toBe('1B')
    expect(normalizeKey('7m')).toBe('2A')
  })
})

describe('normalizeKey: classical notation', () => {
  test('parses minor keys in several spellings', () => {
    expect(normalizeKey('Am')).toBe('8A')
    expect(normalizeKey('A min')).toBe('8A')
    expect(normalizeKey('a minor')).toBe('8A')
    expect(normalizeKey('F#m')).toBe('11A')
    expect(normalizeKey('C#m')).toBe('12A')
  })

  test('parses major keys, bare note defaults to major', () => {
    expect(normalizeKey('C')).toBe('8B')
    expect(normalizeKey('C maj')).toBe('8B')
    expect(normalizeKey('G major')).toBe('9B')
    expect(normalizeKey('F')).toBe('7B')
  })

  test('handles enharmonic spellings and unicode accidentals', () => {
    expect(normalizeKey('Db')).toBe('3B')
    expect(normalizeKey('C#')).toBe('3B')
    expect(normalizeKey('Gbm')).toBe('11A')
    expect(normalizeKey('F♯m')).toBe('11A')
    expect(normalizeKey('B♭')).toBe('6B')
  })

  test('rejects garbage, empty and unknown notes', () => {
    expect(normalizeKey('')).toBeNull()
    expect(normalizeKey('Hm')).toBeNull()
    expect(normalizeKey('not a key')).toBeNull()
    expect(normalizeKey('##')).toBeNull()
  })
})

describe('wheel geometry', () => {
  test('camelotNumber and camelotRing decompose a key', () => {
    expect(camelotNumber('8A')).toBe(8)
    expect(camelotRing('8A')).toBe('A')
    expect(camelotNumber('12B')).toBe(12)
    expect(camelotRing('12B')).toBe('B')
  })

  test('angle: 12 at top (0°), increasing clockwise by 30° per step', () => {
    expect(camelotAngleDeg('12A')).toBe(0)
    expect(camelotAngleDeg('12B')).toBe(0) // ring, not angle, separates A/B
    expect(camelotAngleDeg('1A')).toBe(30)
    expect(camelotAngleDeg('3B')).toBe(90)
    expect(camelotAngleDeg('6A')).toBe(180)
    expect(camelotAngleDeg('11B')).toBe(330)
  })

  test('slot angles follow the zigzag ordering so every compatible key is adjacent', () => {
    // Order clockwise from the top: 1A 1B 2B 2A 3A 3B 4B 4A ... 12B 12A
    expect(wheelSlotAngleDeg('1A')).toBe(7.5)
    expect(wheelSlotAngleDeg('1B')).toBe(22.5)
    expect(wheelSlotAngleDeg('2B')).toBe(37.5)
    expect(wheelSlotAngleDeg('2A')).toBe(52.5)
    expect(wheelSlotAngleDeg('3A')).toBe(67.5)
    expect(wheelSlotAngleDeg('12B')).toBe(337.5)
    expect(wheelSlotAngleDeg('12A')).toBe(352.5) // wraps to sit next to 1A
  })

  test('every key gets a unique slot', () => {
    const angles = ALL_CAMELOT_KEYS.map(wheelSlotAngleDeg)
    expect(new Set(angles).size).toBe(24)
  })

  test('wheelStepDistance is the minimal number of steps around the wheel', () => {
    expect(wheelStepDistance('8A', '8B')).toBe(0)
    expect(wheelStepDistance('8A', '9A')).toBe(1)
    expect(wheelStepDistance('1A', '12A')).toBe(1)
    expect(wheelStepDistance('1A', '7A')).toBe(6)
    expect(wheelStepDistance('2A', '11B')).toBe(3)
  })
})

describe('keysMatch (combo criterion)', () => {
  test('same key matches', () => {
    expect(keysMatch('8A', '8A')).toBe(true)
  })

  test('relative major/minor (same number, other ring) matches', () => {
    expect(keysMatch('8A', '8B')).toBe(true)
  })

  test('±1 step on the same ring matches, including the 12→1 wrap', () => {
    expect(keysMatch('8A', '9A')).toBe(true)
    expect(keysMatch('8A', '7A')).toBe(true)
    expect(keysMatch('12B', '1B')).toBe(true)
  })

  test('±1 step on a different ring does not match', () => {
    expect(keysMatch('8A', '9B')).toBe(false)
  })

  test('distant keys do not match', () => {
    expect(keysMatch('8A', '3A')).toBe(false)
  })

  test('+2 and +7-semitone same-ring moves are gated independently', () => {
    expect(keysMatch('8A', '10A')).toBe(false)
    expect(keysMatch('8A', '10A', { plusTwo: true })).toBe(true) // 2 steps
    expect(keysMatch('8A', '10A', { plusSeven: true })).toBe(false)
    expect(keysMatch('8A', '3A', { plusSeven: true })).toBe(true) // 5 steps = +7 semitones
    expect(keysMatch('8A', '3A', { plusTwo: true })).toBe(false)
    expect(keysMatch('8A', '10B', { plusTwo: true, plusSeven: true })).toBe(false) // cross-ring
  })
})

describe('transposeCamelot (vinyl pitch shifts)', () => {
  test('+1 semitone moves +7 Camelot numbers on the same ring', () => {
    expect(transposeCamelot('8A', 1)).toBe('3A')
    expect(transposeCamelot('8B', 1)).toBe('3B')
  })

  test('-1 semitone moves -7 numbers (A minor down to G# minor)', () => {
    expect(transposeCamelot('8A', -1)).toBe('1A')
  })

  test('an octave (±12 semitones) or no shift is the identity', () => {
    expect(transposeCamelot('5B', 0)).toBe('5B')
    expect(transposeCamelot('5B', 12)).toBe('5B')
    expect(transposeCamelot('5B', -12)).toBe('5B')
  })

  test('shifts compose: two +1 shifts equal one +2 shift', () => {
    expect(transposeCamelot(transposeCamelot('4A', 1), 1)).toBe(transposeCamelot('4A', 2))
  })
})
