import { buildReport, type ImportReport, type Track } from '../model'

/**
 * Import an M3U/M3U8 playlist as an ordered tracklist (remark 4: bring an
 * existing playlist in, then reorder it on the wheel).
 *
 * Entries are matched against the current library first by file basename,
 * then by a normalized "artist - title" from the EXTINF line. Entries that
 * match nothing become minimal new tracks (metadata-poor, flagged in the
 * report) so the set stays complete.
 */
export interface M3uImportResult {
  /** Track ids in playlist order: library ids where matched, new ids otherwise. */
  tracklist: string[]
  /** Minimal tracks created for unmatched entries; add these to the library. */
  newTracks: Track[]
  report: ImportReport
}

function basename(path: string): string {
  const clean = path.replace(/^file:\/\/(localhost)?/, '')
  let decoded = clean
  try {
    decoded = decodeURIComponent(clean)
  } catch {
    // keep the raw path
  }
  return decoded.split('/').pop()?.toLowerCase() ?? decoded.toLowerCase()
}

function stem(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, '')
}

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function importM3u(m3u: string, library: Track[]): M3uImportResult {
  const lines = m3u
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '')

  const byBasename = new Map<string, Track>()
  const byArtistTitle = new Map<string, Track>()
  for (const track of library) {
    if (track.location !== null) byBasename.set(basename(track.location), track)
    if (track.artist !== null)
      byArtistTitle.set(normalize(`${track.artist} - ${track.title}`), track)
  }

  const tracklist: string[] = []
  const newTracks: Track[] = []
  const errors: string[] = []

  let pendingName: string | null = null
  let pendingDuration: number | null = null
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const match = /^#EXTINF:(-?\d+)\s*,\s*(.*)$/.exec(line)
      pendingDuration = match && Number(match[1]) > 0 ? Number(match[1]) : null
      pendingName = match?.[2]?.trim() || null
      continue
    }
    if (line.startsWith('#')) continue // header or comment

    const path = line
    const matched =
      byBasename.get(basename(path)) ??
      (pendingName !== null ? byArtistTitle.get(normalize(pendingName)) : undefined)
    if (matched !== undefined) {
      tracklist.push(matched.id)
    } else {
      const dash = pendingName?.indexOf(' - ') ?? -1
      const artist = dash > 0 ? pendingName!.slice(0, dash).trim() : null
      const title =
        dash > 0 ? pendingName!.slice(dash + 3).trim() : (pendingName ?? stem(basename(path)))
      const track: Track = {
        id: `m3u-${newTracks.length}-${basename(path)}`,
        title,
        artist,
        key: null,
        bpm: null,
        genre: null,
        year: null,
        rating: null,
        durationSec: pendingDuration,
        location: path,
      }
      newTracks.push(track)
      tracklist.push(track.id)
    }
    pendingName = null
    pendingDuration = null
  }

  if (tracklist.length === 0) {
    errors.push('No playlist entries found in the M3U file')
  }
  if (newTracks.length > 0) {
    errors.push(
      `${newTracks.length} playlist entr${newTracks.length === 1 ? 'y' : 'ies'} not found in the library (added without metadata)`,
    )
  }
  return { tracklist, newTracks, report: buildReport(newTracks, errors) }
}
