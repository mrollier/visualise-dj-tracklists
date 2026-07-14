import { XMLParser } from 'fast-xml-parser'
import { normalizeKey } from '../keys'
import { buildReport, type ImportResult, type Track } from '../model'

/**
 * Import a Rekordbox library export (File → Export Collection in xml format).
 *
 * Notes on the format:
 * - Rating is stored as 0–255 in steps of 51 (= 0–5 stars).
 * - AverageBpm="0.00" and Year="0" are placeholders for "unknown".
 * - Tonality may be Camelot ("8A") or classical ("Am") depending on settings.
 */
export function importRekordboxXml(xml: string): ImportResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch (e) {
    return { tracks: [], report: buildReport([], [`Could not parse XML: ${String(e)}`]) }
  }

  const collection = (doc as { DJ_PLAYLISTS?: { COLLECTION?: { TRACK?: unknown } } })
    ?.DJ_PLAYLISTS?.COLLECTION?.TRACK
  if (collection === undefined) {
    return {
      tracks: [],
      report: buildReport([], ['Not a Rekordbox export: no DJ_PLAYLISTS/COLLECTION found']),
    }
  }

  const entries = (Array.isArray(collection) ? collection : [collection]) as Record<
    string,
    string | number
  >[]

  const errors: string[] = []
  const tracks: Track[] = []
  for (const entry of entries) {
    const str = (field: string): string | null => {
      const value = entry[field]
      const s = value === undefined ? '' : String(value).trim()
      return s === '' ? null : s
    }
    const title = str('Name')
    if (title === null) {
      errors.push(`Skipped TRACK ${entry.TrackID ?? '?'}: it has no Name`)
      continue
    }
    const bpm = Number(str('AverageBpm') ?? 0)
    const year = Number(str('Year') ?? 0)
    const rawRating = str('Rating')
    const duration = Number(str('TotalTime') ?? 0)
    tracks.push({
      id: `rb-${str('TrackID') ?? `row${tracks.length}`}`,
      title,
      artist: str('Artist'),
      key: normalizeKey(str('Tonality')),
      bpm: bpm > 0 ? bpm : null,
      genre: str('Genre'),
      year: year > 0 ? year : null,
      rating: rawRating === null ? null : Math.round(Number(rawRating) / 51),
      durationSec: duration > 0 ? duration : null,
      location: str('Location'),
    })
  }

  return { tracks, report: buildReport(tracks, errors) }
}
