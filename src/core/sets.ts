/**
 * Multiple named sets (issue 18): a project holds several tracklists, one
 * active. Default names count upward in ordinal words; `generated` marks a
 * set that is untouched generator output (any manual edit clears it).
 */
export interface TrackSet {
  id: string
  name: string
  trackIds: string[]
  generated: boolean
}

const ORDINALS = [
  'First',
  'Second',
  'Third',
  'Fourth',
  'Fifth',
  'Sixth',
  'Seventh',
  'Eighth',
  'Ninth',
  'Tenth',
  'Eleventh',
  'Twelfth',
]

/** "First Set", "Second Set", …, "Set 13" beyond the twelfth. */
export function ordinalSetName(index: number): string {
  return index < ORDINALS.length ? `${ORDINALS[index]} Set` : `Set ${index + 1}`
}

/** The lowest ordinal name not yet taken (custom names don't block any). */
export function nextSetName(existing: readonly string[]): string {
  const taken = new Set(existing)
  for (let i = 0; ; i++) {
    const name = ordinalSetName(i)
    if (!taken.has(name)) return name
  }
}

/**
 * At most this many sets: the sets ARE the suggestion browser (v8 issue 18)
 * — a short, browsable shelf, not an archive.
 */
export const MAX_SETS = 8

export function canAddSet(sets: readonly TrackSet[]): boolean {
  return sets.length < MAX_SETS
}

export function newSetId(): string {
  return crypto.randomUUID()
}

/** A fresh un-generated "First Set", optionally seeded with tracks. */
export function freshFirstSet(trackIds: string[] = []): TrackSet {
  return { id: newSetId(), name: ordinalSetName(0), trackIds, generated: false }
}
