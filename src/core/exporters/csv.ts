import type { Track } from '../model'

const COLUMNS = [
  'title',
  'artist',
  'key',
  'bpm',
  'genre',
  'year',
  'rating',
  'duration',
  'location',
] as const

function cell(value: string | number | null): string {
  if (value === null) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Export tracks as CSV with the same canonical headers the importer maps. */
export function exportTracklistCsv(tracks: Track[]): string {
  const rows = [COLUMNS.join(',')]
  for (const t of tracks) {
    rows.push(
      [t.title, t.artist, t.key, t.bpm, t.genre, t.year, t.rating, t.durationSec, t.location]
        .map(cell)
        .join(','),
    )
  }
  return rows.join('\n') + '\n'
}
