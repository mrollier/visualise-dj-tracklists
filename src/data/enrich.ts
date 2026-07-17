import type { Track } from '../core/model'
import { hashUnit } from '../core/random'

/** The curated per-pack story behind the generated fields. */
export interface PackExtras {
  /** The pack's (fictional) record label; null = white-label pack. */
  label: string | null
  /** artist → the EP/LP their tracks come from. Unknown artists get none. */
  albums: Readonly<Record<string, string>>
}

const SEED = 0x11feed

/**
 * Deterministic sample-data enrichment (v9 issue 11): albums come from a
 * curated per-pack map, durations / date-added / label / play-count are
 * hashed from the track id — with deliberate gaps so the demo library stays
 * realistic. Same track in, same track out, across every reload.
 */
export function enrichTrack(track: Track, extras: PackExtras): Track {
  const u = (salt: string): number => hashUnit(`${track.id}#${salt}`, SEED)
  const album = track.artist === null ? null : (extras.albums[track.artist] ?? null)
  // A file can't enter the library before its release; the demo library
  // itself "started" in 2018.
  const startYear = Math.max(2018, Math.min(track.year ?? 2018, 2025))
  const year = startYear + Math.floor(u('y') * (2026 - startYear))
  const pad = (n: number): string => String(n).padStart(2, '0')
  const dateAdded = `${year}-${pad(1 + Math.floor(u('m') * 12))}-${pad(1 + Math.floor(u('d') * 28))}`
  return {
    ...track,
    album: u('album?') < 0.1 ? null : album,
    durationSec: u('dur?') < 0.08 ? null : 300 + Math.floor(u('dur') * 150),
    dateAdded: u('date?') < 0.1 ? null : dateAdded,
    label: u('label?') < 0.25 ? null : extras.label,
    playCount: u('plays?') < 0.15 ? null : Math.floor(u('plays') * 40),
  }
}
