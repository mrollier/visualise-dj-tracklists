import { migrateColumns } from './columns'
import { DEFAULT_CRITERIA, type CriteriaConfig } from './combos'
import { EMPTY_FILTERS, type LibraryFilters } from './filter'
import { normalizeKey } from './keys'
import type { Playlist, Track } from './model'
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
 * v3 (multiple named sets replace the single tracklist — issue 18).
 */
export interface Project {
  version: 3
  libraryName: string
  tracks: Track[]
  criteria: CriteriaConfig
  filters: LibraryFilters
  settings: AppSettings
  /** Named sets; always at least one. */
  sets: TrackSet[]
  /** Which set is being edited; always one of `sets`. */
  activeSetId: string
  /** Playlists from the source library (Rekordbox XML); [] elsewhere. */
  playlists: Playlist[]
  radialAxis: 'bpm' | 'rating' | 'year'
  colorAxis: 'auto' | 'bpm' | 'rating' | 'year'
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
  const criteria: CriteriaConfig = {
    key: {
      enabled: key.enabled ?? defaults.key.enabled,
      plusTwo: key.plusTwo ?? key.advancedMoves ?? defaults.key.plusTwo,
      plusSeven: key.plusSeven ?? key.advancedMoves ?? defaults.key.plusSeven,
      vinylMode: key.vinylMode ?? defaults.key.vinylMode,
    },
    bpm: { ...defaults.bpm, ...(raw.bpm as object) },
    genre: {
      enabled: genre.enabled ?? defaults.genre.enabled,
      method: genre.method ?? defaults.genre.method,
      // Projects saved before mutual top-k existed keep their threshold
      // semantics untouched; only fresh configs default to 'topk'.
      mode: genre.mode ?? (genre.threshold !== undefined ? 'threshold' : defaults.genre.mode),
      k: genre.k ?? defaults.genre.k,
      threshold: genre.threshold ?? defaults.genre.threshold,
    },
    year: { ...defaults.year, ...(raw.year as object) },
    threshold: typeof raw.threshold === 'number' ? raw.threshold : defaults.threshold,
  }
  criteria.threshold = Math.max(1, Math.min(4, criteria.threshold))
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
  if (p.version !== 1 && p.version !== 2 && p.version !== 3) {
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
  Reflect.deleteProperty(settings, 'slotSpreadDeg')
  // v9 (issue 12): trackColumns became the full ordering + a hidden list;
  // older partial lists keep their order and visible set.
  const columns = migrateColumns(rawSettings.trackColumns, rawSettings.hiddenColumns)
  settings.trackColumns = columns.trackColumns
  settings.hiddenColumns = columns.hiddenColumns
  return {
    version: 3,
    libraryName: typeof p.libraryName === 'string' ? p.libraryName : '',
    tracks,
    criteria: migrateCriteria(p.criteria as unknown as Record<string, unknown>),
    // Merge-defaults: saves from before the playlists filter existed gain
    // playlists: null (inactive) rather than failing to parse.
    filters: { ...structuredClone(EMPTY_FILTERS), ...(p.filters as object | undefined) },
    settings,
    sets,
    activeSetId,
    playlists: Array.isArray(p.playlists) ? (p.playlists as Playlist[]) : [],
    radialAxis: p.radialAxis === 'rating' || p.radialAxis === 'year' ? p.radialAxis : 'bpm',
    colorAxis:
      p.colorAxis === 'bpm' || p.colorAxis === 'rating' || p.colorAxis === 'year'
        ? p.colorAxis
        : 'auto',
  }
}
