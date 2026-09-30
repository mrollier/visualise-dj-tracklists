import { NOT_IN_PLAYLIST } from './filter'
import { basenameOf, locationToPath } from './location'
import type { ManualEdge, Playlist, Track } from './model'
import type { TrackSet } from './sets'

/**
 * Re-importing a collection updates the library in place: the DJ exports the
 * same Rekordbox collection again after adding tracks, and their sets, marks
 * and manual combos have to survive it. This module is the pure part — which
 * old track is which new track, and what the user's work becomes.
 */

/** Placeholder tracks an M3U import created for entries the library lacked. */
const isPlaceholder = (t: Track): boolean => t.id.startsWith('m3u-')

function pathKey(location: string): string {
  return locationToPath(location).normalize('NFC').toLowerCase()
}

function nameKey(t: Track): string {
  return `${t.artist ?? ''} - ${t.title}`.trim().toLowerCase().replace(/\s+/g, ' ')
}

export interface LibraryDiff {
  /** Old track id → the incoming id it became. */
  idMap: Map<string, string>
  added: Track[]
  /** Old tracks with no counterpart, placeholders included. */
  gone: Track[]
  /** Matched tracks whose Rekordbox key or BPM changed. */
  changed: { id: string; title: string; fields: ('key' | 'bpm')[] }[]
  matchedById: number
  /** Matched by file location, file name, or artist + title. */
  matchedByLocation: number
  /** Share of the old library's own tracks (placeholders aside) that matched. */
  overlap: number
}

/**
 * Match every old track to at most one incoming track. An equal id counts
 * only when the file location or artist + title agrees as well: Rekordbox
 * TrackIDs are small integers, so rb-1 exists in every collection. Everything
 * else falls back to the exact file path and then to artist + title; M3U
 * placeholders, whose paths came from another machine, also try the file name.
 */
export function diffLibraries(old: readonly Track[], incoming: readonly Track[]): LibraryDiff {
  const byId = new Map(incoming.map((t) => [t.id, t]))
  const byPath = new Map<string, Track>()
  const byFile = new Map<string, Track>()
  const byName = new Map<string, Track>()
  for (const t of incoming) {
    if (t.location !== null) {
      byPath.set(pathKey(t.location), t)
      byFile.set(basenameOf(t.location), t)
    }
    byName.set(nameKey(t), t)
  }

  const idMap = new Map<string, string>()
  const taken = new Set<string>()
  const claim = (from: Track, to: Track | undefined): boolean => {
    if (to === undefined || taken.has(to.id)) return false
    idMap.set(from.id, to.id)
    taken.add(to.id)
    return true
  }

  let matchedById = 0
  for (const t of old) {
    const same = byId.get(t.id)
    if (same === undefined) continue
    const samePath =
      t.location !== null &&
      same.location !== null &&
      pathKey(t.location) === pathKey(same.location)
    if ((samePath || nameKey(t) === nameKey(same)) && claim(t, same)) matchedById++
  }

  let matchedByLocation = 0
  for (const t of old) {
    if (idMap.has(t.id)) continue
    // The bare file name only for placeholders, whose path came from another
    // machine: in a real collection "01 Intro.mp3" is not one track.
    const candidates = [
      t.location === null ? undefined : byPath.get(pathKey(t.location)),
      t.location === null || !isPlaceholder(t) ? undefined : byFile.get(basenameOf(t.location)),
      byName.get(nameKey(t)),
    ]
    if (candidates.some((c) => claim(t, c))) matchedByLocation++
  }

  const changed: LibraryDiff['changed'] = []
  for (const t of old) {
    const to = idMap.get(t.id)
    if (to === undefined || isPlaceholder(t)) continue
    const next = byId.get(to)!
    const fields: ('key' | 'bpm')[] = []
    if (t.key !== next.key) fields.push('key')
    if (t.bpm !== next.bpm) fields.push('bpm')
    if (fields.length > 0) changed.push({ id: to, title: next.title, fields })
  }

  const own = old.filter((t) => !isPlaceholder(t))
  const ownMatched = own.filter((t) => idMap.has(t.id)).length
  return {
    idMap,
    added: incoming.filter((t) => !taken.has(t.id)),
    gone: old.filter((t) => !idMap.has(t.id)),
    changed,
    matchedById,
    matchedByLocation,
    overlap: own.length === 0 ? 1 : ownMatched / own.length,
  }
}

/** The user's work a library update carries across. */
export interface Work {
  sets: TrackSet[]
  manualEdges: ManualEdge[]
  selectedId: string | null
  /** The playlist filter's selection; null when the filter is inactive. */
  playlistSelection: string[] | null
}

export interface RemappedWork extends Work {
  /** Unmatched placeholders the work still refers to: they stay in the library. */
  carried: Track[]
  /** What pointed at tracks that are gone, for the confirmation and the report. */
  lost: { slots: number; marks: number; manualEdges: number; titles: string[] }
}

export function remapWork(
  work: Work,
  diff: LibraryDiff,
  incomingPlaylists: readonly Playlist[],
): RemappedWork {
  const referenced = new Set<string>()
  for (const set of work.sets) {
    for (const id of [...set.trackIds, ...set.mustInclude, set.pinnedFirst, set.pinnedLast]) {
      if (id !== null) referenced.add(id)
    }
  }
  for (const { a, b } of work.manualEdges) referenced.add(a).add(b)

  const carried = diff.gone.filter((t) => isPlaceholder(t) && referenced.has(t.id))
  const carriedIds = new Set(carried.map((t) => t.id))
  const goneById = new Map(diff.gone.map((t) => [t.id, t]))
  const lostIds = new Set<string>()
  const map = (id: string): string | null => {
    const to = diff.idMap.get(id) ?? (carriedIds.has(id) ? id : null)
    if (to === null && goneById.has(id)) lostIds.add(id)
    return to
  }

  const lost = { slots: 0, marks: 0, manualEdges: 0 }
  const sets = work.sets.map((set) => {
    const trackIds: string[] = []
    for (const id of set.trackIds) {
      const to = map(id)
      if (to === null) lost.slots++
      // Dropping a track can leave two copies of one track back to back.
      else if (trackIds.at(-1) !== to) trackIds.push(to)
    }
    const mustInclude = [...new Set(set.mustInclude.map(map).filter((id) => id !== null))]
    const pin = (id: string | null): string | null => {
      if (id === null) return null
      const to = map(id)
      if (to === null) lost.marks++
      return to
    }
    lost.marks += set.mustInclude.filter((id) => map(id) === null).length
    return {
      ...set,
      trackIds,
      mustInclude,
      pinnedFirst: pin(set.pinnedFirst),
      pinnedLast: pin(set.pinnedLast),
    }
  })

  const manualEdges: ManualEdge[] = []
  const seen = new Set<string>()
  for (const edge of work.manualEdges) {
    const a = map(edge.a)
    const b = map(edge.b)
    if (a === null || b === null) {
      lost.manualEdges++
      continue
    }
    const key = a < b ? `${a}\n${b}` : `${b}\n${a}`
    if (a === b || seen.has(key)) continue
    seen.add(key)
    manualEdges.push({ ...edge, a, b })
  }

  const names = new Set(incomingPlaylists.map((p) => p.name))
  const playlistSelection =
    work.playlistSelection === null || names.size === 0
      ? null
      : work.playlistSelection.filter((name) => name === NOT_IN_PLAYLIST || names.has(name))

  return {
    sets,
    manualEdges,
    selectedId: work.selectedId === null ? null : map(work.selectedId),
    playlistSelection,
    carried,
    lost: { ...lost, titles: [...lostIds].map((id) => goneById.get(id)!.title) },
  }
}

/**
 * What an import over the current library does. An empty or sample library
 * is simply replaced; a collection sharing under half its tracks is probably
 * a different one, so replacing it asks first; an update that would drop work
 * asks first; anything else updates silently and reports the diff.
 */
export function importDecision(
  disposable: boolean,
  diff: LibraryDiff,
  lostCount: number,
): 'replace' | 'confirm-replace' | 'update' | 'confirm-update' {
  if (disposable) return 'replace'
  if (diff.overlap < 0.5) return 'confirm-replace'
  return lostCount > 0 ? 'confirm-update' : 'update'
}
