import Papa from 'papaparse'
import { normalizeKey } from '../keys'
import { buildReport, EMPTY_TRACK_FIELDS, type ImportResult, type Track } from '../model'

/** Header synonyms → Track field, matched case-insensitively after trimming. */
const HEADER_MAP: Record<string, keyof Track> = {
  title: 'title',
  name: 'title',
  track: 'title',
  'track name': 'title',
  'track title': 'title',
  artist: 'artist',
  artists: 'artist',
  key: 'key',
  tonality: 'key',
  camelot: 'key',
  bpm: 'bpm',
  tempo: 'bpm',
  genre: 'genre',
  style: 'genre',
  year: 'year',
  'release year': 'year',
  rating: 'rating',
  stars: 'rating',
  album: 'album',
  release: 'album',
  'date added': 'dateAdded',
  duration: 'durationSec',
  'duration (s)': 'durationSec',
  length: 'durationSec',
  location: 'location',
  path: 'location',
  file: 'location',
}

/**
 * Import tracks from CSV text. The delimiter is auto-detected and headers are
 * mapped through common synonyms (e.g. "Tonality" → key, "Tempo" → bpm).
 */
export function importCsv(csv: string): ImportResult {
  if (csv.trim() === '') {
    return { tracks: [], report: buildReport([], ['The CSV file is empty']) }
  }

  const parsed = Papa.parse<Record<string, string>>(csv.trim(), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => {
      const field = HEADER_MAP[h.trim().toLowerCase()]
      return field ?? `_unmapped_${h}`
    },
  })

  const errors = parsed.errors.map((e) => `CSV row ${e.row ?? '?'}: ${e.message}`)
  const tracks: Track[] = []
  for (const [index, row] of parsed.data.entries()) {
    const str = (field: keyof Track): string | null => {
      const s = row[field]?.trim() ?? ''
      return s === '' ? null : s
    }
    const num = (field: keyof Track): number | null => {
      const s = str(field)
      if (s === null) return null
      const n = Number(s)
      return Number.isFinite(n) ? n : null
    }
    const title = str('title')
    if (title === null) {
      errors.push(`Skipped row ${index + 2}: it has no title`)
      continue
    }
    tracks.push({
      ...EMPTY_TRACK_FIELDS,
      id: `csv-${index}`,
      title,
      artist: str('artist'),
      key: normalizeKey(str('key')),
      bpm: num('bpm'),
      genre: str('genre'),
      year: num('year'),
      rating: num('rating'),
      durationSec: num('durationSec'),
      album: str('album'),
      dateAdded: str('dateAdded'),
      location: str('location'),
    })
  }

  return { tracks, report: buildReport(tracks, errors) }
}
