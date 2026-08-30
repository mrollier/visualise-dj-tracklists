import { camelotNumber, camelotRing } from './keys'
import type { MarksContext, MarksFilter } from './marks'
import type { Playlist, Track } from './model'
import { PROPERTY_BY_KEY, TRACK_PROPERTIES, type TrackProperty } from './properties'
import type { TrackSortField } from './trackSort'

/**
 * Library-level filters (remarks 2, 6, 8): they decide which tracks are
 * visible at all — on the wheel, in the combo graph, and for suggestions.
 * Since v11 (issue 1) every track property can carry a filter; the property's
 * kind (registry, `properties.ts`) decides the semantics:
 *
 * - number: inclusive [min, max]; a missing value never fails (consistent
 *   with the combo engine's missing-data policy).
 * - alpha (v14 WS2): inclusive range over the value's first-letter bucket
 *   (A=0…Z=25, everything else '#'=26); missing passes.
 * - contains (v14 WS2): case-insensitive substring match; missing passes.
 * - colour (v14 WS2): allow-list of raw colour tags (case-insensitive);
 *   missing passes (genre allow-list precedent).
 * - quality (v14 WS2): lossy/lossless, derived from the file `kind` string;
 *   an unknown or missing format passes.
 * - date: inclusive 'YYYY-MM-DD' lexical bounds. Unlike the other kinds, a
 *   missing date is EXCLUDED while the filter is active (v10 issue 4b,
 *   generalized) — "between these dates" has no sensible answer for an
 *   unknown date, and hiding them is what a DJ browsing by recency wants.
 * - key: inclusive range over the Camelot NUMBER (1–12), both rings — the
 *   ring is filtered separately by `keyRings`, so the two compose.
 */
export type QualityChoice = 'lossy' | 'lossless'
export type PropertyRange =
  | [number, number] // number, key — and alpha: bucket indices 0–26
  | [string, string] // date
  | { contains: string } // contains kind (case-insensitive substring)
  | { colours: string[] } // colour kind: allow-list of raw tag values
  | { qualities: QualityChoice[] } // quality kind allow-list (F5); both-on = entry absent, [] = both-off

// --- alpha buckets (v14 WS2) ---
/** The '#' bucket for non-letter / diacritic starts, ordered AFTER Z. */
export const ALPHA_CATCH_ALL = 26
export function alphaBucket(value: string): number {
  const c = value.trimStart().charAt(0).toLowerCase()
  return c >= 'a' && c <= 'z' ? c.charCodeAt(0) - 97 : ALPHA_CATCH_ALL
}
export function alphaBucketLabel(b: number): string {
  return b === ALPHA_CATCH_ALL ? '#' : String.fromCharCode(65 + b)
}

// --- audio quality (v14 WS2) ---
const LOSSLESS = /\b(wav|aiff?|flac|alac|apple lossless|pcm)\b/i
const LOSSY = /\b(mp3|aac|m4a|mp4|ogg|opus|wma)\b/i
export function audioQuality(kind: string): QualityChoice | null {
  if (LOSSLESS.test(kind)) return 'lossless'
  if (LOSSY.test(kind)) return 'lossy'
  return null // unknown format — passes the filter
}

// --- PropertyRange shape guards (v14 WS2) ---
function isTuple(range: PropertyRange): range is [number, number] | [string, string] {
  return Array.isArray(range)
}
function isContains(range: PropertyRange): range is { contains: string } {
  return !Array.isArray(range) && 'contains' in range
}
function isColours(range: PropertyRange): range is { colours: string[] } {
  return !Array.isArray(range) && 'colours' in range
}
function isQualities(range: PropertyRange): range is { qualities: QualityChoice[] } {
  return !Array.isArray(range) && 'qualities' in range
}

export interface LibraryFilters {
  /** Active per-property ranges; an absent key means "not filtering". */
  properties: Partial<Record<TrackSortField, PropertyRange>>
  /** Allow-list of genres (compared case-insensitively); null = all genres. */
  genres: string[] | null
  /**
   * Selected playlist names (may include NOT_IN_PLAYLIST); null = the
   * playlist filter is inactive. A fresh collection import with playlists
   * starts at [] — nothing selected, empty wheel (design-v5 §D).
   */
  playlists: string[] | null
  /**
   * Which Camelot rings to show (F5): independent toggles for minor (A/inner)
   * and major (B/outer). Both true = both rings (the old 'both'); both false =
   * no keyed track shows. Lives with the key criterion in the UI but is a
   * visibility filter; keyless tracks always pass (v8 issue 10), even with both
   * toggles off.
   */
  keyRings: { minor: boolean; major: boolean }
  /**
   * The starred-only / combo-only quick-filters (v18 #3/#8, `marks.ts`).
   * Both false = inert. Filtering by these needs a `MarksContext` passed
   * separately to `applyFilters` — see that function and `marks.ts` for why
   * the live id sets don't live on this object. A saved-active value here is
   * never honoured on load (`migrateFilters` below always resets it).
   */
  marks: MarksFilter
}

/** Pseudo-playlist name: tracks that appear in no playlist at all. */
export const NOT_IN_PLAYLIST = '__not-in-a-playlist__'

export const EMPTY_FILTERS: LibraryFilters = {
  properties: {},
  genres: null,
  playlists: null,
  keyRings: { minor: true, major: true },
  marks: { starredOnly: false, comboOnly: false, constellationOnly: false },
}

/** A saved entry that must be a two-number tuple; null otherwise. */
function twoNumbers(entry: unknown): [number, number] | null {
  if (!Array.isArray(entry) || entry.length !== 2) return null
  const [a, b] = entry as [unknown, unknown]
  if (typeof a !== 'number' || !Number.isFinite(a)) return null
  if (typeof b !== 'number' || !Number.isFinite(b)) return null
  return [a, b]
}

/**
 * One saved range, checked against its property's kind; null = drop it. Since
 * v14 WS2 the array guard lives *inside* the tuple kinds, so v5 text tuples
 * (e.g. `artist: ["b","k"]`) fail the alpha number-checks and drop — the
 * recorded "drop old stored text ranges" migration.
 */
function sanitizeRange(prop: TrackProperty, entry: unknown): PropertyRange | null {
  switch (prop.kind) {
    case 'number':
      return twoNumbers(entry)
    case 'key': {
      const pair = twoNumbers(entry)
      if (pair === null) return null
      const clamp = (v: number): number => Math.max(1, Math.min(12, Math.round(v)))
      return [clamp(pair[0]), clamp(pair[1])]
    }
    case 'alpha': {
      const pair = twoNumbers(entry)
      if (pair === null) return null
      const clamp = (v: number): number => Math.max(0, Math.min(ALPHA_CATCH_ALL, Math.round(v)))
      return [clamp(pair[0]), clamp(pair[1])]
    }
    case 'date': {
      if (!Array.isArray(entry) || entry.length !== 2) return null
      const [a, b] = entry as [unknown, unknown]
      return typeof a === 'string' && typeof b === 'string' ? [a, b] : null
    }
    case 'contains': {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
      const value = (entry as Record<string, unknown>).contains
      return typeof value === 'string' && value !== '' ? { contains: value } : null
    }
    case 'colour': {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
      const value = (entry as Record<string, unknown>).colours
      if (!Array.isArray(value)) return null
      const colours = value.filter((v): v is string => typeof v === 'string')
      return colours.length > 0 ? { colours } : null
    }
    case 'quality': {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return null
      const rec = entry as Record<string, unknown>
      const valid = (v: unknown): v is QualityChoice => v === 'lossy' || v === 'lossless'
      if (Array.isArray(rec.qualities)) {
        // F5: an empty array is a real "both-off" state — keep it, don't drop.
        return { qualities: [...new Set(rec.qualities.filter(valid))] }
      }
      if (valid(rec.quality)) return { qualities: [rec.quality] } // old v6 → v7 migration
      return null
    }
  }
}

/**
 * Normalize saved filters, whatever their vintage (v11 issue 1): the v4
 * per-property map is sanitized entry by entry (unknown properties and
 * kind-mismatched tuples dropped, key ranges clamped into 1–12); v3-and-older
 * saves carried top-level bpm/year/rating/dateAdded ranges, which lift into
 * the map. The bespoke fields (genres, playlists, keyRing) carry over.
 */
export function migrateFilters(raw: unknown): LibraryFilters {
  const out = structuredClone(EMPTY_FILTERS)
  if (typeof raw !== 'object' || raw === null) return out
  const p = raw as Record<string, unknown>
  if (Array.isArray(p.genres)) {
    out.genres = p.genres.filter((g): g is string => typeof g === 'string')
  }
  if (Array.isArray(p.playlists)) {
    out.playlists = p.playlists.filter((n): n is string => typeof n === 'string')
  }
  // F5: new-shape {minor,major} toggles; else migrate the old string enum.
  const kr = p.keyRings
  if (typeof kr === 'object' && kr !== null && !Array.isArray(kr)) {
    out.keyRings = {
      minor: (kr as Record<string, unknown>).minor !== false,
      major: (kr as Record<string, unknown>).major !== false,
    }
  } else if (p.keyRing === 'minor') out.keyRings = { minor: true, major: false }
  else if (p.keyRing === 'major') out.keyRings = { minor: false, major: true }
  // old 'both'/absent/garbage → the EMPTY_FILTERS default (both true)
  const rawProperties =
    typeof p.properties === 'object' && p.properties !== null
      ? (p.properties as Record<string, unknown>)
      : { bpm: p.bpm, year: p.year, rating: p.rating, dateAdded: p.dateAdded }
  for (const prop of TRACK_PROPERTIES) {
    if (!prop.filterable) continue
    const range = sanitizeRange(prop, rawProperties[prop.key])
    if (range !== null) out.properties[prop.key] = range
  }
  // v18 (#3/#8): `p.marks` is deliberately never read. The marks quick-filters
  // check membership in mustInclude/pinnedFirst/pinnedLast, which are
  // session-only stores that always start empty — a persisted-active marks
  // filter would blank the wheel on every reload. `out` is already the
  // EMPTY_FILTERS clone from above (both flags false), so simply not copying
  // `p.marks` onto it IS the reset; there is nothing else to do here.
  return out
}

/**
 * Min/max per requested property over the library, missing values ignored;
 * null when no track has the property. Only number- and key-kind properties
 * have extents (key runs over Camelot numbers); other kinds are skipped.
 * The filter inputs default to these, so freshly imported libraries start
 * with their true ranges visible.
 */
export function propertyExtents(
  tracks: Track[],
  keys: readonly TrackSortField[],
): Partial<Record<TrackSortField, [number, number] | null>> {
  const out: Partial<Record<TrackSortField, [number, number] | null>> = {}
  for (const key of keys) {
    const kind = PROPERTY_BY_KEY.get(key)?.kind
    if (kind !== 'number' && kind !== 'key') continue
    let min = Infinity
    let max = -Infinity
    for (const track of tracks) {
      let value: number
      if (kind === 'key') {
        if (track.key === null) continue
        value = camelotNumber(track.key)
      } else {
        const raw = track[key]
        if (typeof raw !== 'number') continue
        value = raw
      }
      if (value < min) min = value
      if (value > max) max = value
    }
    out[key] = min === Infinity ? null : [min, max]
  }
  return out
}

/**
 * Colour-chip rendering options (v14.1 WS7): chips must show every colour
 * the store is actually filtering by, not just the ones in scope — a stored
 * selection can retain a colour that dropped out of scope after a playlist
 * switch, and hiding its chip would filter invisibly. Scoped colours come
 * first (in their given order, `inScope: true`); any selected colour not in
 * scope is appended afterwards, in selected's order, `inScope: false`. A
 * colour that is both scoped and selected appears once, `inScope: true`.
 */
export function colourChipOptions(
  scoped: string[],
  selected: string[],
): { colour: string; inScope: boolean }[] {
  const scopedSet = new Set(scoped)
  const out = scoped.map((colour) => ({ colour, inScope: true }))
  for (const colour of selected) {
    if (!scopedSet.has(colour)) out.push({ colour, inScope: false })
  }
  return out
}

/**
 * One genre checkbox toggled. `current === null` means "no filter", which
 * reads as the whole scope. Collapsing back to null asks whether every SCOPED
 * genre is selected — set membership, not a length comparison: a selection
 * carried over from another playlist's scope can be longer than the current
 * scope, and the old `next.length >= scoped.length` check turned an untick
 * into "show everything" (v40, Codex bug 5).
 */
export function nextGenreSelection(
  current: readonly string[] | null,
  scoped: readonly string[],
  genre: string,
  on: boolean,
): string[] | null {
  const base = current ?? scoped
  const next = on
    ? base.includes(genre)
      ? [...base]
      : [...base, genre]
    : base.filter((g) => g !== genre)
  return scoped.every((g) => next.includes(g)) ? null : next
}

/**
 * Whole numbers just outside the extent: [floor(min), ceil(max)]. The range
 * filters reset to these, so the bounds read cleanly and still cover every
 * track in the current selection.
 */
export function wholeExtent(extent: [number, number]): [number, number] {
  return [Math.floor(extent[0]), Math.ceil(extent[1])]
}

/**
 * Keep min <= max by pulling the side the user just edited to the other
 * bound (editing min past max collapses onto max, and vice versa). Generic
 * since v11: string bounds clamp lexically for the text filters.
 */
export function clampRange<T extends number | string>(
  range: [T, T],
  edited: 'min' | 'max',
): [T, T] {
  const [min, max] = range
  if (min <= max) return range
  return edited === 'min' ? [max, max] : [min, min]
}

/** One property's pass test; kind-aware (see the module comment). */
function passesProperty(track: Track, prop: TrackProperty, range: PropertyRange): boolean {
  const raw = track[prop.key]
  switch (prop.kind) {
    case 'number': {
      if (!isTuple(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
        return true
      }
      if (raw === null) return true
      const value = Number(raw)
      return value >= range[0] && value <= range[1]
    }
    case 'key': {
      if (!isTuple(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
        return true
      }
      if (track.key === null) return true
      const value = camelotNumber(track.key)
      return value >= range[0] && value <= range[1]
    }
    case 'alpha': {
      if (!isTuple(range) || typeof range[0] !== 'number' || typeof range[1] !== 'number') {
        return true
      }
      if (raw === null) return true
      const bucket = alphaBucket(String(raw))
      return bucket >= range[0] && bucket <= range[1]
    }
    case 'date': {
      if (!isTuple(range) || typeof range[0] !== 'string' || typeof range[1] !== 'string') {
        return true
      }
      if (raw === null) return false // missing dates hide while active
      return raw >= range[0] && raw <= range[1]
    }
    case 'contains': {
      if (!isContains(range)) return true
      if (raw === null) return true
      return String(raw).toLowerCase().includes(range.contains.toLowerCase())
    }
    case 'colour': {
      if (!isColours(range)) return true
      if (raw === null) return true // missing colour passes (genre precedent)
      const value = String(raw).toLowerCase()
      return range.colours.some((c) => c.toLowerCase() === value)
    }
    case 'quality': {
      if (!isQualities(range)) return true
      if (raw === null) return true
      const quality = audioQuality(String(raw))
      // Unknown/missing format always passes (F5); a known one must be allowed.
      return quality === null || range.qualities.includes(quality)
    }
  }
}

/**
 * The marks-quick-filter pass test (v18 #3/#8, widened v25): true unless a
 * flag is on AND a context is present that excludes the track. A missing
 * context makes ALL THREE flags inert, not "hide everything" — the safe
 * default for a stray caller (existing tests, a future one-off filter
 * preview) that never passed one.
 */
function passesMarks(track: Track, flags: MarksFilter, context: MarksContext | undefined): boolean {
  if (context === undefined) return true
  return (
    (!flags.starredOnly || context.starredIds.has(track.id)) &&
    (!flags.comboOnly || context.comboIds.has(track.id)) &&
    (!flags.constellationOnly || context.constellationIds.has(track.id))
  )
}

/** The track ids the playlist selection allows, or null when it is inert. */
function playlistMemberIds(
  tracks: Track[],
  selected: string[] | null,
  playlists: Playlist[],
): Set<string> | null {
  if (selected === null || playlists.length === 0) return null
  const chosen = new Set(selected)
  const allowedIds = new Set<string>()
  for (const playlist of playlists) {
    if (!chosen.has(playlist.name)) continue
    for (const id of playlist.trackIds) allowedIds.add(id)
  }
  if (chosen.has(NOT_IN_PLAYLIST)) {
    const inAny = new Set(playlists.flatMap((p) => p.trackIds))
    for (const track of tracks) {
      if (!inAny.has(track.id)) allowedIds.add(track.id)
    }
  }
  return allowedIds
}

/**
 * Just the playlist part of the filters: the tracks the current playlist
 * selection allows, ignoring ranges and genres. The range-filter defaults
 * (and the radial axis fallback) are scoped to this, not the whole library.
 */
export function applyPlaylistFilter(
  tracks: Track[],
  selected: string[] | null,
  playlists: Playlist[],
): Track[] {
  const allowedIds = playlistMemberIds(tracks, selected, playlists)
  return allowedIds === null ? tracks : tracks.filter((t) => allowedIds.has(t.id))
}

export function applyFilters(
  tracks: Track[],
  filters: LibraryFilters,
  playlists: Playlist[] = [],
  marks?: MarksContext,
): Track[] {
  // Resolve the active property filters once, in registry order — unknown
  // keys in a corrupted save simply never match a property and stay inert.
  const active: { prop: TrackProperty; range: PropertyRange }[] = []
  for (const prop of TRACK_PROPERTIES) {
    const range = filters.properties[prop.key]
    if (range !== undefined) active.push({ prop, range })
  }
  const allowed =
    filters.genres === null ? null : new Set(filters.genres.map((g) => g.toLowerCase()))
  const allowedIds = playlistMemberIds(tracks, filters.playlists, playlists)
  // F5: a track passes iff keyless (always) or its ring toggle is on.
  const { minor, major } = filters.keyRings
  return tracks.filter(
    (t) =>
      active.every(({ prop, range }) => passesProperty(t, prop, range)) &&
      (allowed === null || t.genre === null || allowed.has(t.genre.toLowerCase())) &&
      (allowedIds === null || allowedIds.has(t.id)) &&
      (t.key === null || (camelotRing(t.key) === 'A' ? minor : major)) &&
      passesMarks(t, filters.marks, marks),
  )
}
