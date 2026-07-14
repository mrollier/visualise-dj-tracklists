import { normalizeKey } from '../keys'
import type { Track } from '../model'

/** The subset of audio tags we care about, already flattened by the caller. */
export interface FlatTags {
  title?: string
  artist?: string
  key?: string
  bpm?: number
  genre?: string[]
  year?: number
  durationSec?: number
}

/**
 * Map audio-file tags (ID3v2 / Vorbis / MP4, as flattened from
 * music-metadata's `common` block) onto the Track model. Pure and testable;
 * the browser-side file reading lives in the UI layer.
 */
export function trackFromTags(id: string, fileName: string, tags: FlatTags): Track {
  const stem = fileName.replace(/\.[a-z0-9]+$/i, '')
  return {
    id,
    title: tags.title?.trim() || stem,
    artist: tags.artist?.trim() || null,
    key: normalizeKey(tags.key ?? null),
    bpm: tags.bpm !== undefined && tags.bpm > 0 ? tags.bpm : null,
    genre: tags.genre?.[0]?.trim() || null,
    year: tags.year !== undefined && tags.year > 0 ? tags.year : null,
    rating: null, // star ratings are proprietary per player; not read in v1
    durationSec: tags.durationSec !== undefined ? Math.round(tags.durationSec) : null,
    location: fileName,
  }
}
