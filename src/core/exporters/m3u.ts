import { locationToPath } from '../location'
import type { Track } from '../model'

/**
 * Export an ordered tracklist as an extended M3U8 playlist (UTF-8), which
 * Rekordbox and most players re-import. Tracks without a file location get a
 * comment line so the export never produces entries that point nowhere.
 */
export function exportM3u(tracks: Track[]): string {
  const lines = ['#EXTM3U']
  for (const track of tracks) {
    const name = track.artist ? `${track.artist} - ${track.title}` : track.title
    if (track.location === null) {
      lines.push(`# no file location: ${name}`)
      continue
    }
    lines.push(`#EXTINF:${track.durationSec ?? -1},${name}`)
    lines.push(locationToPath(track.location))
  }
  return lines.join('\n') + '\n'
}
