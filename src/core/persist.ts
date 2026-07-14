import type { CriteriaConfig } from './combos'
import type { Track } from './model'

/**
 * A saved project: the whole app state as one JSON document. Used both for
 * explicit save/load (a .json file the user keeps) and localStorage autosave.
 */
export interface Project {
  version: 1
  libraryName: string
  tracks: Track[]
  criteria: CriteriaConfig
  tracklist: string[]
  radialAxis: 'bpm' | 'rating' | 'year'
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2)
}

export function parseProject(json: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    throw new Error('Not a valid project file: could not parse JSON')
  }
  const p = raw as Partial<Project>
  if (p.version !== 1) {
    throw new Error(`Unsupported project version: ${String(p.version)}`)
  }
  if (!Array.isArray(p.tracks) || !Array.isArray(p.tracklist) || typeof p.criteria !== 'object') {
    throw new Error('Not a valid project file: missing tracks, tracklist or criteria')
  }
  const knownIds = new Set(p.tracks.map((t) => t.id))
  return {
    version: 1,
    libraryName: typeof p.libraryName === 'string' ? p.libraryName : '',
    tracks: p.tracks,
    criteria: p.criteria as CriteriaConfig,
    tracklist: p.tracklist.filter((id) => knownIds.has(id)),
    radialAxis: p.radialAxis === 'rating' || p.radialAxis === 'year' ? p.radialAxis : 'bpm',
  }
}
