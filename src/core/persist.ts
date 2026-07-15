import { DEFAULT_CRITERIA, type CriteriaConfig } from './combos'
import { EMPTY_FILTERS, type LibraryFilters } from './filter'
import type { Track } from './model'
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
  const criteria: CriteriaConfig = {
    key: { ...defaults.key, ...(raw.key as object) },
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
  const knownIds = new Set((p.tracks as Track[]).map((t) => t.id))
  const settings: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...(p.settings as object | undefined),
  }
  // The spread must stay within one 15° key slot (older saves allowed 20).
  settings.slotSpreadDeg = Math.min(15, settings.slotSpreadDeg)
  return {
    version: 2,
    libraryName: typeof p.libraryName === 'string' ? p.libraryName : '',
    tracks: p.tracks as Track[],
    criteria: migrateCriteria(p.criteria as unknown as Record<string, unknown>),
    filters: (p.filters as LibraryFilters | undefined) ?? structuredClone(EMPTY_FILTERS),
    settings,
    tracklist: (p.tracklist as string[]).filter((id) => knownIds.has(id)),
    radialAxis: p.radialAxis === 'rating' || p.radialAxis === 'year' ? p.radialAxis : 'bpm',
    colorAxis:
      p.colorAxis === 'bpm' || p.colorAxis === 'rating' || p.colorAxis === 'year'
        ? p.colorAxis
        : 'auto',
  }
}
