import type { CamelotKey } from './keys'

/** A track = node in the graph. Missing metadata is null, never a guess. */
export interface Track {
  id: string
  title: string
  artist: string | null
  key: CamelotKey | null
  bpm: number | null
  genre: string | null
  year: number | null
  /** 0–5 stars; 0 means "unrated" but present. */
  rating: number | null
  durationSec: number | null
  /** File path or URL from the source library; needed for M3U8 export. */
  location: string | null
}

export type MetadataField = 'key' | 'bpm' | 'genre' | 'year' | 'rating'

export const METADATA_FIELDS: readonly MetadataField[] = ['key', 'bpm', 'genre', 'year', 'rating']

export interface ImportReport {
  total: number
  missing: Record<MetadataField, number>
  errors: string[]
}

export interface ImportResult {
  tracks: Track[]
  report: ImportReport
}

export function buildReport(tracks: Track[], errors: string[]): ImportReport {
  const missing = { key: 0, bpm: 0, genre: 0, year: 0, rating: 0 }
  for (const track of tracks) {
    for (const field of METADATA_FIELDS) {
      if (track[field] === null) missing[field]++
    }
  }
  return { total: tracks.length, missing, errors }
}
