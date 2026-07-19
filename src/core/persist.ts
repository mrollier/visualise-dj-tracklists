import { migrateColumns } from './columns'
import { DEFAULT_CRITERIA, demandedCount, type CriteriaConfig } from './combos'
import { migrateFilters, type LibraryFilters } from './filter'
import { normalizeKey } from './keys'
import { energyFromComments, type ManualEdge, type Playlist, type Track } from './model'
import { DEFAULT_VISIBLE_FILTERS, TRACK_PROPERTIES } from './properties'
import {
  freshFirstSet,
  MAX_SETS,
  newSetId,
  ordinalSetName,
  uniqueSetName,
  type TrackSet,
} from './sets'
import { DEFAULT_SETTINGS, type AppSettings } from './settings'

/**
 * A saved project: the whole app state as one JSON document. Used both for
 * explicit save/load (a .json file the user keeps) and localStorage autosave.
 * Version history: v1 (no filters/settings, criteria had a rating criterion),
 * v2 (filters + settings + colour axis; rating became a filter),
 * v3 (multiple named sets replace the single tracklist — issue 18),
 * v4 (filters carry a per-property range map — v11 issue 1),
 * v5 (manual edges — planning annotations, v12 WS9),
 * v6 (v14: text filter kind split into alpha/contains/colour/quality, so old
 *  stored text ranges are dropped on load — WS2; per-criterion `demanded`
 *  flags — WS4; per-track `isVinyl` dropped — WS1; `slotSpreadFactor` clamp
 *  widened to 0–2 — WS7; `manualEdgeWeight` setting — WS5).
 */
export interface Project {
  version: 6
  libraryName: string
  tracks: Track[]
  criteria: CriteriaConfig
  filters: LibraryFilters
  settings: AppSettings
  /** Named sets; always at least one. */
  sets: TrackSet[]
  /** User-marked "these mix well" pairs (v12 WS9) — planning, never a log. */
  manualEdges: ManualEdge[]
  /** Which set is being edited; always one of `sets`. */
  activeSetId: string
  /** Playlists from the source library (Rekordbox XML); [] elsewhere. */
  playlists: Playlist[]
  radialAxis: 'bpm' | 'rating' | 'year' | 'energy'
  colorAxis: 'auto' | 'bpm' | 'rating' | 'year' | 'energy'
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

/** Upgrade a v1 criteria object: drop rating, add genre method/threshold. */
function migrateCriteria(raw: Record<string, unknown>): CriteriaConfig {
  const defaults = structuredClone(DEFAULT_CRITERIA)
  const genre = (raw.genre ?? {}) as Partial<CriteriaConfig['genre']>
  // Saves from before the split carried a single advancedMoves toggle
  // covering both the +2 and +7-semitone moves — fan it out to both flags.
  const key = (raw.key ?? {}) as Partial<CriteriaConfig['key']> & { advancedMoves?: boolean }
  // v14 (WS4): `demanded` locks a criterion as mandatory. The whitelist reads
  // it explicitly with `=== true` coercion so a non-boolean in a hand-edited
  // save (or its absence in an old one) becomes a clean false, never leaks.
  const bpm = (raw.bpm ?? {}) as Partial<CriteriaConfig['bpm']>
  const year = (raw.year ?? {}) as Partial<CriteriaConfig['year']>
  const criteria: CriteriaConfig = {
    key: {
      enabled: key.enabled ?? defaults.key.enabled,
      plusTwo: key.plusTwo ?? key.advancedMoves ?? defaults.key.plusTwo,
      plusSeven: key.plusSeven ?? key.advancedMoves ?? defaults.key.plusSeven,
      vinylMode: key.vinylMode ?? defaults.key.vinylMode,
      demanded: key.demanded === true,
    },
    bpm: { ...defaults.bpm, ...(raw.bpm as object), demanded: bpm.demanded === true },
    genre: {
      enabled: genre.enabled ?? defaults.genre.enabled,
      method: genre.method ?? defaults.genre.method,
      // Projects saved before mutual top-k existed keep their threshold
      // semantics untouched; only fresh configs default to 'topk'.
      mode: genre.mode ?? (genre.threshold !== undefined ? 'threshold' : defaults.genre.mode),
      k: genre.k ?? defaults.genre.k,
      threshold: genre.threshold ?? defaults.genre.threshold,
      demanded: genre.demanded === true,
    },
    year: { ...defaults.year, ...(raw.year as object), demanded: year.demanded === true },
    threshold: typeof raw.threshold === 'number' ? raw.threshold : defaults.threshold,
  }
  // 0 is a deliberate "require nothing" since v11 (issue 2a).
  criteria.threshold = Math.max(0, Math.min(4, criteria.threshold))
  // v14 C2: a demanded criterion is mandatory, so the threshold can never sit
  // below the demanded count — floor it after the clamp.
  criteria.threshold = Math.max(criteria.threshold, demandedCount(criteria))
  return criteria
}

/**
 * Guard one stored track: project files are hand-editable JSON, so nothing
 * in them is trusted. Entries without a string id/title are dropped;
 * wrong-typed optional fields become missing rather than poisoning the app.
 */
function sanitizeTrack(raw: unknown): Track | null {
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  if (typeof entry.id !== 'string' || typeof entry.title !== 'string') return null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  return {
    id: entry.id,
    title: entry.title,
    artist: str(entry.artist),
    key: normalizeKey(str(entry.key)),
    bpm: num(entry.bpm),
    genre: str(entry.genre),
    year: num(entry.year),
    rating: num(entry.rating),
    durationSec: num(entry.durationSec),
    album: str(entry.album),
    dateAdded: str(entry.dateAdded),
    location: str(entry.location),
    composer: str(entry.composer),
    grouping: str(entry.grouping),
    kind: str(entry.kind),
    size: num(entry.size),
    discNumber: num(entry.discNumber),
    trackNumber: num(entry.trackNumber),
    bitRate: num(entry.bitRate),
    sampleRate: num(entry.sampleRate),
    comments: str(entry.comments),
    // Older saves carry Comments but no energy — derive it here (v12 WS8) so
    // an existing project gains the field without a re-import.
    energy: num(entry.energy) ?? energyFromComments(str(entry.comments)),
    playCount: num(entry.playCount),
    remixer: str(entry.remixer),
    label: str(entry.label),
    mix: str(entry.mix),
    colour: str(entry.colour),
    dateModified: str(entry.dateModified),
    lastPlayed: str(entry.lastPlayed),
  }
}

/**
 * Guard one stored set the same way tracks are guarded: wrong-typed entries
 * are dropped or defaulted, unknown track ids pruned per set.
 */
function sanitizeSet(raw: unknown, knownIds: Set<string>, index: number): TrackSet | null {
  if (typeof raw !== 'object' || raw === null) return null
  const entry = raw as Record<string, unknown>
  const trackIds = Array.isArray(entry.trackIds)
    ? (entry.trackIds as unknown[]).filter(
        (id): id is string => typeof id === 'string' && knownIds.has(id),
      )
    : []
  return {
    id: typeof entry.id === 'string' && entry.id !== '' ? entry.id : newSetId(),
    name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : ordinalSetName(index),
    trackIds,
    generated: entry.generated === true,
  }
}

export function parseProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not a valid project file: could not parse JSON')
  }
  const p = raw as Record<string, unknown> &
    Omit<Partial<Project>, 'version'> & { version?: number; tracklist?: unknown }
  if (
    p.version !== 1 &&
    p.version !== 2 &&
    p.version !== 3 &&
    p.version !== 4 &&
    p.version !== 5 &&
    p.version !== 6
  ) {
    throw new Error(`Unsupported project version: ${String(p.version)}`)
  }
  const hasSetShape = Array.isArray(p.sets) || Array.isArray(p.tracklist)
  if (!Array.isArray(p.tracks) || !hasSetShape || typeof p.criteria !== 'object') {
    throw new Error('Not a valid project file: missing tracks, sets or criteria')
  }
  const tracks = (p.tracks as unknown[]).map(sanitizeTrack).filter((t): t is Track => t !== null)
  const knownIds = new Set(tracks.map((t) => t.id))
  // v1/v2 carried one flat tracklist — it becomes the (un-generated) First
  // Set. v3 sets are sanitized per entry; nothing valid left = one empty set.
  let sets: TrackSet[]
  if (Array.isArray(p.sets)) {
    sets = (p.sets as unknown[])
      .map((entry, i) => sanitizeSet(entry, knownIds, i))
      .filter((s): s is TrackSet => s !== null)
  } else {
    const oldList = (p.tracklist as unknown[]).filter(
      (id): id is string => typeof id === 'string' && knownIds.has(id),
    )
    sets = [freshFirstSet(oldList)]
  }
  if (sets.length === 0) sets = [freshFirstSet()]
  // The sets are the suggestion browser (v8 issue 18): a hand-edited save
  // with more than the cap keeps its first MAX_SETS entries.
  sets = sets.slice(0, MAX_SETS)
  // v9 (issue 18): saves that already carry duplicate names get the same
  // auto-suffix a rename would.
  const seenNames: string[] = []
  sets = sets.map((s) => {
    const name = uniqueSetName(s.name, seenNames)
    seenNames.push(name)
    return name === s.name ? s : { ...s, name }
  })
  const activeSetId =
    typeof p.activeSetId === 'string' && sets.some((s) => s.id === p.activeSetId)
      ? p.activeSetId
      : sets[0].id
  const rawSettings = (p.settings ?? {}) as Partial<AppSettings> & { slotSpreadDeg?: number }
  const settings: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...rawSettings,
  }
  // v7: the same-key spread became a 0–1 factor of the ±7.5° half-slot
  // window. Older saves stored degrees (capped at 7.5; pre-v5 allowed 15/20).
  if (typeof rawSettings.slotSpreadDeg === 'number' && rawSettings.slotSpreadFactor === undefined) {
    settings.slotSpreadFactor = rawSettings.slotSpreadDeg / 7.5
  }
  settings.slotSpreadFactor = Math.max(0, Math.min(1, settings.slotSpreadFactor))
  if (typeof settings.jitterSeed !== 'number' || !Number.isFinite(settings.jitterSeed)) {
    settings.jitterSeed = DEFAULT_SETTINGS.jitterSeed
  }
  // v14 (WS5): the manual-combo pull is a 0–10 knob; a non-finite or
  // out-of-range value in a hand-edited save falls back to the default.
  if (
    typeof settings.manualEdgeWeight !== 'number' ||
    !Number.isFinite(settings.manualEdgeWeight) ||
    settings.manualEdgeWeight < 0 ||
    settings.manualEdgeWeight > 10
  ) {
    settings.manualEdgeWeight = DEFAULT_SETTINGS.manualEdgeWeight
  }
  // v12 (WS4): easy mode — anything but the two literals means an older or
  // mangled save, which stays in the full UI it was written from.
  if (settings.uiMode !== 'easy' && settings.uiMode !== 'advanced') {
    settings.uiMode = DEFAULT_SETTINGS.uiMode
  }
  Reflect.deleteProperty(settings, 'slotSpreadDeg')
  // v9 (issue 12): trackColumns became the full ordering + a hidden list;
  // older partial lists keep their order and visible set.
  const columns = migrateColumns(rawSettings.trackColumns, rawSettings.hiddenColumns)
  settings.trackColumns = columns.trackColumns
  settings.hiddenColumns = columns.hiddenColumns
  // v11 (issue 1): filters normalize into the per-property map, whatever
  // their vintage; migrateFilters lifts v3 top-level ranges and drops
  // garbage entries.
  const filters = migrateFilters(p.filters)
  // visibleFilters (v10 issue 4b, widened in v11 to every property): saved
  // arrays keep their valid keys; older saves back-fill to the default.
  // [] is a valid "hide every property filter" choice. Either way, an
  // actively filtering property is forced visible — the hide-clears-filter
  // invariant means nothing may filter invisibly.
  const validFilterKeys = new Set<string>(
    TRACK_PROPERTIES.filter((prop) => prop.filterable).map((prop) => prop.key),
  )
  const savedVisible = rawSettings.visibleFilters
  settings.visibleFilters = Array.isArray(savedVisible)
    ? savedVisible.filter(
        (k): k is (typeof settings.visibleFilters)[number] =>
          typeof k === 'string' && validFilterKeys.has(k),
      )
    : [...DEFAULT_VISIBLE_FILTERS]
  for (const prop of TRACK_PROPERTIES) {
    if (filters.properties[prop.key] !== undefined && !settings.visibleFilters.includes(prop.key)) {
      settings.visibleFilters.push(prop.key)
    }
  }
  // Manual edges (v12 WS9): unordered unique pairs between known tracks.
  const manualEdges: ManualEdge[] = []
  {
    const seenPairs = new Set<string>()
    const knownIds = new Set(tracks.map((t) => t.id))
    for (const raw of Array.isArray(p.manualEdges) ? (p.manualEdges as unknown[]) : []) {
      if (typeof raw !== 'object' || raw === null) continue
      const entry = raw as Record<string, unknown>
      if (typeof entry.a !== 'string' || typeof entry.b !== 'string') continue
      if (entry.a === entry.b || !knownIds.has(entry.a) || !knownIds.has(entry.b)) continue
      const key = entry.a < entry.b ? `${entry.a}\n${entry.b}` : `${entry.b}\n${entry.a}`
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      const tag = typeof entry.tag === 'string' && entry.tag.trim() !== '' ? entry.tag : undefined
      manualEdges.push(
        tag === undefined ? { a: entry.a, b: entry.b } : { a: entry.a, b: entry.b, tag },
      )
    }
  }

  return {
    version: 6,
    manualEdges,
    libraryName: typeof p.libraryName === 'string' ? p.libraryName : '',
    tracks,
    criteria: migrateCriteria(p.criteria as unknown as Record<string, unknown>),
    filters,
    settings,
    sets,
    activeSetId,
    playlists: Array.isArray(p.playlists) ? (p.playlists as Playlist[]) : [],
    radialAxis:
      p.radialAxis === 'rating' || p.radialAxis === 'year' || p.radialAxis === 'energy'
        ? p.radialAxis
        : 'bpm',
    colorAxis:
      p.colorAxis === 'bpm' ||
      p.colorAxis === 'rating' ||
      p.colorAxis === 'year' ||
      p.colorAxis === 'energy'
        ? p.colorAxis
        : 'auto',
  }
}
