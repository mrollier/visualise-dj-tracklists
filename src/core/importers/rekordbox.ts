import { XMLParser } from 'fast-xml-parser'
import { normalizeKey } from '../keys'
import { buildReport, type ImportResult, type Playlist, type Track } from '../model'

/**
 * Import a Rekordbox library export (File → Export Collection in xml format).
 *
 * Notes on the format:
 * - Rating is stored as 0–255 in steps of 51 (= 0–5 stars).
 * - AverageBpm="0.00" and Year="0" are placeholders for "unknown".
 * - Tonality may be Camelot ("8A") or classical ("Am") depending on settings.
 * - PLAYLISTS is a NODE tree: folders are Type="0" (ROOT included), playlists
 *   Type="1"; members are <TRACK Key="…"/> where Key = the collection TrackID.
 */

interface PlaylistNode {
  Type?: string | number
  Name?: string | number
  NODE?: PlaylistNode | PlaylistNode[]
  TRACK?: { Key?: string | number } | { Key?: string | number }[]
}

function collectPlaylists(node: PlaylistNode | PlaylistNode[], prefix: string, out: Playlist[]) {
  for (const n of Array.isArray(node) ? node : [node]) {
    const name = n.Name === undefined ? '' : String(n.Name)
    if (String(n.Type) === '0') {
      // A folder: ROOT stays invisible, deeper folders prefix their children.
      const path =
        name === '' || name === 'ROOT' ? prefix : prefix === '' ? name : `${prefix} / ${name}`
      if (n.NODE !== undefined) collectPlaylists(n.NODE, path, out)
      continue
    }
    const members = n.TRACK === undefined ? [] : Array.isArray(n.TRACK) ? n.TRACK : [n.TRACK]
    out.push({
      name: prefix === '' ? name : `${prefix} / ${name}`,
      trackIds: members.filter((m) => m.Key !== undefined).map((m) => `rb-${String(m.Key)}`),
    })
  }
}

export function importRekordboxXml(xml: string): ImportResult {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' })
  let doc: unknown
  try {
    doc = parser.parse(xml)
  } catch (e) {
    return { tracks: [], report: buildReport([], [`Could not parse XML: ${String(e)}`]) }
  }

  const root = (
    doc as {
      DJ_PLAYLISTS?: {
        COLLECTION?: { TRACK?: unknown }
        PLAYLISTS?: { NODE?: PlaylistNode | PlaylistNode[] }
      }
    }
  )?.DJ_PLAYLISTS
  const collection = root?.COLLECTION?.TRACK
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
  const usedIds = new Set<string>()
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
    const rating = Number(str('Rating') ?? NaN)
    const duration = Number(str('TotalTime') ?? 0)
    // Hand-edited exports can repeat TrackIDs; node ids must stay unique.
    const base = `rb-${str('TrackID') ?? `row${tracks.length}`}`
    let id = base
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`
    usedIds.add(id)
    tracks.push({
      id,
      title,
      artist: str('Artist'),
      key: normalizeKey(str('Tonality')),
      bpm: bpm > 0 ? bpm : null,
      genre: str('Genre'),
      year: year > 0 ? year : null,
      rating: Number.isFinite(rating) ? Math.round(rating / 51) : null,
      durationSec: duration > 0 ? duration : null,
      album: str('Album'),
      dateAdded: str('DateAdded'),
      location: str('Location'),
    })
  }

  const playlists: Playlist[] = []
  if (root?.PLAYLISTS?.NODE !== undefined) collectPlaylists(root.PLAYLISTS.NODE, '', playlists)
  // Names key the playlist filter and UI list — force them unique.
  const seenNames = new Set<string>()
  for (const playlist of playlists) {
    let name = playlist.name
    for (let n = 2; seenNames.has(name); n++) name = `${playlist.name} (${n})`
    seenNames.add(name)
    playlist.name = name
  }

  return { tracks, report: buildReport(tracks, errors), playlists }
}
