/**
 * Key normalization and Camelot wheel geometry.
 *
 * Everything downstream (combo engine, wheel view) works exclusively with
 * canonical Camelot keys ("1A".."12B"). This module converts the notations
 * found in the wild — Camelot, Open Key (Traktor), classical ("F#m") — into
 * that canonical form.
 */

export type CamelotRing = 'A' | 'B' // A = minor (inner), B = major (outer)
export type CamelotKey = `${number}${CamelotRing}`

export const ALL_CAMELOT_KEYS: readonly CamelotKey[] = Array.from(
  { length: 24 },
  (_, i) => `${(i % 12) + 1}${i < 12 ? 'A' : 'B'}` as CamelotKey,
)

// Pitch class (0 = C .. 11 = B) of the tonic for each Camelot number.
// Majors (B ring): 8B = C, each wheel step clockwise adds a perfect fifth.
// Minors (A ring): relative minor shares the Camelot number of its major.
const MAJOR_PC_TO_NUMBER = new Map<number, number>()
const MINOR_PC_TO_NUMBER = new Map<number, number>()
for (let n = 1; n <= 12; n++) {
  const majorPc = (7 * (n - 8) + 120) % 12 // 8B = C (pc 0), +7 semitones per step
  MAJOR_PC_TO_NUMBER.set(majorPc, n)
  MINOR_PC_TO_NUMBER.set((majorPc + 9) % 12, n) // relative minor is 9 semitones up
}

const NOTE_PC: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

const CAMELOT_RE = /^(\d{1,2})\s*([ab])$/
const OPEN_KEY_RE = /^(\d{1,2})\s*([dm])$/
const CLASSICAL_RE = /^([a-g])([#b]?)\s*(maj(?:or)?|min(?:or)?|m)?$/

/**
 * Convert any supported key notation to a canonical Camelot key,
 * or null when the input is missing or unparseable.
 */
export function normalizeKey(raw: string | null | undefined): CamelotKey | null {
  if (!raw) return null
  const input = raw.trim().toLowerCase().replace(/♯/g, '#').replace(/♭/g, 'b')
  if (!input) return null

  const camelot = CAMELOT_RE.exec(input)
  if (camelot) {
    const n = parseInt(camelot[1], 10)
    if (n < 1 || n > 12) return null
    return `${n}${camelot[2].toUpperCase()}` as CamelotKey
  }

  const openKey = OPEN_KEY_RE.exec(input)
  if (openKey) {
    const n = parseInt(openKey[1], 10)
    if (n < 1 || n > 12) return null
    const camelotNumber = ((n + 7 - 1) % 12) + 1 // Open Key 1 = Camelot 8
    return `${camelotNumber}${openKey[2] === 'd' ? 'B' : 'A'}` as CamelotKey
  }

  const classical = CLASSICAL_RE.exec(input)
  if (classical) {
    const [, note, accidental, mode] = classical
    let pc = NOTE_PC[note]
    if (accidental === '#') pc = (pc + 1) % 12
    if (accidental === 'b') pc = (pc + 11) % 12
    const isMinor = mode === 'm' || mode?.startsWith('min')
    const n = (isMinor ? MINOR_PC_TO_NUMBER : MAJOR_PC_TO_NUMBER).get(pc)
    return n === undefined ? null : (`${n}${isMinor ? 'A' : 'B'}` as CamelotKey)
  }

  return null
}

export function camelotNumber(key: CamelotKey): number {
  return parseInt(key, 10)
}

export function camelotRing(key: CamelotKey): CamelotRing {
  return key.endsWith('A') ? 'A' : 'B'
}

/** Angle in degrees, clockwise from 12 o'clock; number 12 sits at the top. */
export function camelotAngleDeg(key: CamelotKey): number {
  return (camelotNumber(key) % 12) * 30
}

/**
 * Angle (degrees clockwise from 12 o'clock) of a key's own slot on the wheel.
 *
 * The 24 slots follow the zigzag ordering from the concept paper's figures —
 * 1A 1B 2B 2A 3A 3B 4B 4A … 12B 12A — which places every harmonically
 * compatible pair (relative A/B and ±1 same ring) in angularly adjacent slots.
 */
export function wheelSlotAngleDeg(key: CamelotKey): number {
  const n = camelotNumber(key)
  const ringFirst = n % 2 === 1 ? 'A' : 'B' // odd numbers lead with A, even with B
  const slot = (n - 1) * 2 + (camelotRing(key) === ringFirst ? 0 : 1)
  return slot * 15 + 7.5
}

/** Minimal number of steps between two keys' numbers around the wheel (0..6). */
export function wheelStepDistance(a: CamelotKey, b: CamelotKey): number {
  const diff = Math.abs(camelotNumber(a) - camelotNumber(b)) % 12
  return Math.min(diff, 12 - diff)
}

/**
 * The key after transposing by `semitones` (vinyl pitch shifts): one semitone
 * up moves +7 Camelot numbers (a fifth of a fifth), same ring.
 */
export function transposeCamelot(key: CamelotKey, semitones: number): CamelotKey {
  const n = camelotNumber(key)
  const shifted = ((((n - 1 + 7 * semitones) % 12) + 12) % 12) + 1
  return `${shifted}${camelotRing(key)}` as CamelotKey
}

export interface KeyMatchOptions {
  /** Also accept the +2 (two wheel steps) same-ring move. */
  plusTwo?: boolean
  /** Also accept the +7-semitone (five wheel steps) same-ring move. */
  plusSeven?: boolean
}

/**
 * The key combo criterion: harmonic compatibility on the Camelot wheel.
 * Matches same key, relative major/minor, and ±1 step on the same ring;
 * the 2-step and 5-step (= +7 semitones) same-ring moves gate independently.
 */
export function keysMatch(a: CamelotKey, b: CamelotKey, options: KeyMatchOptions = {}): boolean {
  const dist = wheelStepDistance(a, b)
  if (dist === 0) return true // same key or relative major/minor
  if (camelotRing(a) !== camelotRing(b)) return false
  if (dist === 1) return true
  if (dist === 2) return options.plusTwo === true
  return dist === 5 && options.plusSeven === true
}
