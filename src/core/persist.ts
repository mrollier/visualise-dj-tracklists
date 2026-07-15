import { DEFAULT_CRITERIA, type CriteriaConfig } from './combos'
import { EMPTY_FILTERS, type LibraryFilters } from './filter'
import { normalizeKey } from './keys'
import type { Playlist, Track } from './model'
import { DEFAULT_SETTINGS, type AppSettings } from './settings'

/**
 * A saved project: the whole app state as one JSON document. Used both for
 * explicit save/load (a .json file the user keeps) and localStorage autosave.
 * Version history: v1 (no filters/settings, criteria had a rating criterion),
 * v2 (filters + settings + colour axis; rating became a filter).
 */
export interface Project {
  version: 2
  libraryName: string
  tracks: Track[]
  criteria: CriteriaConfig
  filters: LibraryFilters
  settings: AppSettings
  tracklist: string[]
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
    location: str(entry.location),
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
    Omit<Partial<Project>, 'version'> & { version?: number }
  if (p.version !== 1 && p.version !== 2) {
    throw new Error(`Unsupported project version: ${String(p.version)}`)
  }
  if (!Array.isArray(p.tracks) || !Array.isArray(p.tracklist) || typeof p.criteria !== 'object') {
    throw new Error('Not a valid project file: missing tracks, tracklist or criteria')
  }
  const tracks = (p.tracks as unknown[]).map(sanitizeTrack).filter((t): t is Track => t !== null)
  const knownIds = new Set(tracks.map((t) => t.id))
  const settings: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(p.settings as object | undefined),
  }
  // The spread caps at half a 15° key slot (older saves allowed 15 or 20).
  settings.slotSpreadDeg = Math.min(7.5, settings.slotSpreadDeg)
  return {
    version: 2,
    libraryName: typeof p.libraryName === 'string' ? p.libraryName : '',
    tracks,
    criteria: migrateCriteria(p.criteria as unknown as Record<string, unknown>),
    // Merge-defaults: saves from before the playlists filter existed gain
    // playlists: null (inactive) rather than failing to parse.
    filters: { ...structuredClone(EMPTY_FILTERS), ...(p.filters as object | undefined) },
    settings,
    tracklist: (p.tracklist as string[]).filter((id) => knownIds.has(id)),
    playlists: Array.isArray(p.playlists) ? (p.playlists as Playlist[]) : [],
    radialAxis: p.radialAxis === 'rating' || p.radialAxis === 'year' ? p.radialAxis : 'bpm',
    colorAxis:
      p.colorAxis === 'bpm' || p.colorAxis === 'rating' || p.colorAxis === 'year'
        ? p.colorAxis
        : 'auto',
  }
}
