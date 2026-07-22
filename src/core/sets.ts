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

/** "First Constellation", "Second Constellation", …, "Constellation 13". */
export function ordinalSetName(index: number): string {
  return index < ORDINALS.length ? `${ORDINALS[index]} Constellation` : `Constellation ${index + 1}`
}

/**
 * The default name for a NEW set: count the existing sets — renamed ones
 * included — so two custom-named sets are followed by "Third Set", not
 * "First Set" again (v9 issue 18), scanning past any taken ordinals.
 */
export function nextSetName(existing: readonly string[]): string {
  const taken = new Set(existing)
  for (let i = existing.length; ; i++) {
    const name = ordinalSetName(i)
    if (!taken.has(name)) return name
  }
}

/**
 * Force a unique set name, file-manager style (v9 issue 18): a clash gains
 * " (2)", " (3)", … — applied on rename, on create, and when loading saves
 * that already carry duplicates.
 */
export function uniqueSetName(name: string, taken: readonly string[]): string {
  const names = new Set(taken)
  if (!names.has(name)) return name
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`
    if (!names.has(candidate)) return candidate
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

/**
 * Drop EVERY slot holding the given track (v9 issue 14): the Tracks-view
 * position cell removes a track from the active set wholesale, later
 * occurrences included, and the remaining order renumbers itself.
 */
export function removeAllOccurrences(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id)
}

/**
 * Reorder one slot of a list. `insertAt` is a GAP index in the ORIGINAL array
 * — 0 is before the first item, `items.length` is after the last — which is
 * what a drop between two rows means. The two gaps flanking `from` are no-ops.
 * Positional, not identity-based: a set may hold the same track twice.
 */
export function moveItem<T>(items: readonly T[], from: number, insertAt: number): T[] {
  if (from < 0 || from >= items.length) return [...items]
  if (insertAt < 0 || insertAt > items.length) return [...items]
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(insertAt > from ? insertAt - 1 : insertAt, 0, moved)
  return next
}

/** A fresh un-generated "First Constellation", optionally seeded with tracks. */
export function freshFirstSet(trackIds: string[] = []): TrackSet {
  return { id: newSetId(), name: ordinalSetName(0), trackIds, generated: false }
}
