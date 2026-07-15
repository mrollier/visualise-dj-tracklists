import { normalizeKey } from '../keys'
import { buildReport, type ImportResult, type Track } from '../model'

/**
 * Rekordbox "export playlist as TXT": a tab-separated table of whatever
 * columns the playlist view shows, encoded UTF-16 LE with a BOM. Rows carry
 * full metadata (artist, title, genre, BPM, star rating as asterisks, time
 * as M:SS, Camelot key), in playlist order — so an import yields both a
 * library and a ready-made set (design-v5 §D).
 */

/**
 * Column header → Track field (case-insensitive). Unknown columns are
 * ignored — including "#", since rows already arrive in playlist order.
 */
const HEADER_MAP: Record<string, keyof Track> = {
  title: 'title',
  'track title': 'title',
  artist: 'artist',
  genre: 'genre',
  bpm: 'bpm',
  key: 'key',
  rating: 'rating',
  time: 'durationSec',
  location: 'location',
}

function decodeBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const encoding =
    bytes[0] === 0xff && bytes[1] === 0xfe
      ? 'utf-16le'
      : bytes[0] === 0xfe && bytes[1] === 0xff
        ? 'utf-16be'
        : 'utf-8'
  // TextDecoder strips the BOM for both UTF-16 and UTF-8 inputs.
  return new TextDecoder(encoding).decode(buffer)
}

/** Does this .txt look like a Rekordbox playlist export (vs a plain CSV)? */
export function isRekordboxTxt(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer)
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    return true
  }
  const firstLine = decodeBuffer(buffer).split('\n', 1)[0]
  return firstLine.includes('\t')
}

/** "6:45" or "1:02:03" → seconds; anything else → null. */
function parseTime(value: string): number | null {
  const parts = value.split(':').map((p) => Number(p))
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) return null
  return parts.reduce((total, part) => total * 60 + part, 0)
}

/** "*****" → 5; a plain number passes through; empty → null. */
function parseRating(value: string): number | null {
  if (/^\*+$/.test(value)) return value.length
  const n = Number(value)
  return Number.isFinite(n) && value !== '' ? n : null
}

export function importRekordboxTxt(buffer: ArrayBuffer): ImportResult {
  const lines = decodeBuffer(buffer)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
  if (lines.length === 0) {
    return { tracks: [], report: buildReport([], ['The playlist export is empty']) }
  }

  const headers = lines[0].split('\t').map((h) => HEADER_MAP[h.trim().toLowerCase()] ?? null)
  if (!headers.includes('title')) {
    return {
      tracks: [],
      report: buildReport([], ['No "Track Title" column found in the playlist export']),
    }
  }

  const errors: string[] = []
  const tracks: Track[] = []
  for (const [index, line] of lines.slice(1).entries()) {
    const cells = line.split('\t')
    const row = new Map<string, string>()
    headers.forEach((field, i) => {
      const value = cells[i]?.trim() ?? ''
      if (field !== null && value !== '') row.set(field, value)
    })
    const title = row.get('title')
    if (title === undefined) {
      errors.push(`Skipped row ${index + 2}: it has no title`)
      continue
    }
    const bpm = Number(row.get('bpm') ?? '')
    tracks.push({
      id: `txt-${tracks.length}`,
      title,
      artist: row.get('artist') ?? null,
      key: normalizeKey(row.get('key') ?? null),
      bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : null,
      genre: row.get('genre') ?? null,
      // The export has no release year — "Date Added" is not one.
      year: null,
      rating: parseRating(row.get('rating') ?? ''),
      durationSec: parseTime(row.get('durationSec') ?? ''),
      location: row.get('location') ?? null,
    })
  }

  return { tracks, report: buildReport(tracks, errors) }
}
