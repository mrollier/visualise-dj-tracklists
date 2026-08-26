import type { Track } from '../core/model'
import { REKORDBOX_COLOURS } from '../core/properties'
import { hashUnit } from '../core/random'

/** The curated per-pack story behind the generated fields. */
export interface PackExtras {
  /** The pack's (fictional) record label; null = white-label pack. */
  label: string | null
  /** artist → the EP/LP their tracks come from. Unknown artists get none. */
  albums: Readonly<Record<string, string>>
}

const SEED = 0x11feed

// --- v14 WS3: generic pools for the fields that have no per-pack story ---
const COMPOSERS = [
  'A. Nightingale',
  'M. Voss',
  'R. Delacroix',
  'J. Okafor',
  'S. Lindqvist',
  'T. Marchetti',
  'K. Nakamura',
  'E. Solberg',
  'P. Adeyemi',
  'H. Castellane',
] as const
const REMIXERS = [
  'Late Nite Collective',
  'Sub Rosa',
  'Vertical Drop',
  'Faint Signal',
  'Glass Horizon',
  'Echo Parade',
  'Blue Hour Edits',
  'Concrete Bloom',
] as const
const GROUPINGS = ['Warmup', 'Peak time', 'Closer', 'After hours'] as const
const MIXES = ['Original', 'Extended', 'Club Mix', 'Dub'] as const
const COLOUR_TAGS = Object.keys(REKORDBOX_COLOURS)
const LOSSLESS_KINDS = ['WAV File', 'AIFF File', 'FLAC File'] as const
const LOSSY_KINDS = ['MP3 File', 'AAC File'] as const
const LOSSY_BIT_RATES = [320, 256, 192] as const
const SAMPLE_RATES = [44100, 48000] as const
const EXTENSION_BY_KIND: Readonly<Record<string, string>> = {
  'MP3 File': 'mp3',
  'AAC File': 'aac',
  'WAV File': 'wav',
  'AIFF File': 'aiff',
  'FLAC File': 'flac',
}

/** One of `pool`, chosen by hashing `salt` under the track's id. */
function pick<T>(pool: readonly T[], u: (salt: string) => number, salt: string): T {
  return pool[Math.floor(u(salt) * pool.length)]
}

/**
 * Genre → a Mixed-In-Key-style energy level, so the sample's generated energies
 * read sensibly per style rather than tracking BPM alone (issue #7). Ordered
 * most-specific first, so "hard techno" beats "techno" and "drum & bass" beats
 * a bare "bass".
 *
 * This is the HUMAN 1-10 scale a DJ writes into a comment, and it stays
 * separate from the model-descriptor table in sample-analysis.ts: those are
 * measured neural-net output on their own scales and the two disagree on
 * purpose (a jungle roller is energy 8 by ear and 24% "happy" by model).
 */
const GENRE_ENERGY: readonly (readonly [RegExp, number])[] = [
  [/gabber|hardcore|speedcore/i, 10],
  [/schranz|\btekno\b/i, 9],
  [/hard techno|industrial techno/i, 9],
  [/psytrance|goa/i, 8],
  [/dubstep|drum ?& ?bass|\bdnb\b|d&b|jungle/i, 8],
  [/halftime/i, 7],
  [/\btechno\b/i, 7],
  [/trance/i, 7],
  [/uk garage|garage|\bbass\b|breakbeat|breaks/i, 6],
  [/\bidm\b|electro/i, 6],
  [/house/i, 6],
  [/disco|afrobeat|dancehall|new wave/i, 6],
  [/\bpop\b|r&b|\brnb\b|reggae|indie|electro swing/i, 5],
  [/hip ?hop|trip ?hop|\bdub\b/i, 4],
  [/jazz|blues|folk|soul/i, 3],
  [/downtempo|chill/i, 3],
  [/ambient/i, 2],
]

/**
 * A genre's baseline energy (issue #7). Known genres map to a fixed level so
 * the value reflects style, not tempo; an unknown genre falls back to a gentle
 * BPM curve (and 5 with no BPM either). Callers add a small jitter.
 */
export function genreEnergyBaseline(genre: string | null, bpm: number | null): number {
  if (genre !== null) {
    for (const [re, energy] of GENRE_ENERGY) {
      if (re.test(genre)) return energy
    }
  }
  return bpm === null ? 5 : Math.max(1, Math.min(10, Math.round((bpm - 60) / 13)))
}

/** `date` (YYYY-MM-DD) plus `days`, still YYYY-MM-DD — used for the fields
 *  that must land on or after another generated date. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Deterministic sample-data enrichment (v9 issue 11, extended v14 WS3):
 * albums come from a curated per-pack map, everything else is hashed from the
 * track id — with deliberate gaps so the demo library stays realistic and
 * every filterable property has something to show. Same track in, same
 * track out, across every reload.
 */
export function enrichTrack(track: Track, extras: PackExtras): Track {
  const u = (salt: string): number => hashUnit(`${track.id}#${salt}`, SEED)
  const album = track.artist === null ? null : (extras.albums[track.artist] ?? null)
  // A file can't enter the library before its release; the demo library
  // itself "started" in 2018.
  const startYear = Math.max(2018, Math.min(track.year ?? 2018, 2025))
  const year = startYear + Math.floor(u('y') * (2026 - startYear))
  const pad = (n: number): string => String(n).padStart(2, '0')
  // The "true" date the file entered the library — used as the anchor for
  // dateModified/lastPlayed even on tracks whose dateAdded field itself
  // rolls a gap below, so those derived dates stay sane either way.
  const dateAddedAnchor = `${year}-${pad(1 + Math.floor(u('m') * 12))}-${pad(1 + Math.floor(u('d') * 28))}`

  const label = u('label?') < 0.25 ? null : extras.label
  const durationSec = u('dur?') < 0.08 ? null : 300 + Math.floor(u('dur') * 150)
  const playCount = u('plays?') < 0.15 ? null : Math.floor(u('plays') * 40)

  const isLossless = u('kind-type') < 0.4
  const kind =
    u('kind?') < 0.1
      ? null
      : isLossless
        ? pick(LOSSLESS_KINDS, u, 'kind-idx')
        : pick(LOSSY_KINDS, u, 'kind-idx')
  // bitRate is correlated with kind: unknown format, unknown rate; otherwise
  // the rate matches the lossless/lossy profile that produced `kind`.
  const bitRate = kind === null ? null : isLossless ? 1411 : pick(LOSSY_BIT_RATES, u, 'bitrate-idx')
  const sampleRate = u('samplerate?') < 0.1 ? null : pick(SAMPLE_RATES, u, 'samplerate-idx')
  const size =
    durationSec === null || bitRate === null ? null : Math.round(durationSec * bitRate * 125)

  // Mixed-In-Key-style energy from the genre baseline + a ±1 jitter, with a
  // small gap rate (issue #7). The matching "Energy N" comment doubles as the
  // sample's Comments coverage and mirrors what MIK writes into a real library.
  const energy =
    u('energy?') < 0.12
      ? null
      : Math.max(
          1,
          Math.min(
            10,
            genreEnergyBaseline(track.genre, track.bpm) + Math.round(u('energy-jitter') * 2 - 1),
          ),
        )
  const comments =
    energy === null
      ? track.comments
      : track.comments
        ? `${track.comments} - Energy ${energy}`
        : `Energy ${energy}`

  const ext = kind === null ? 'mp3' : (EXTENSION_BY_KIND[kind] ?? 'mp3')
  const artistName = track.artist ?? 'Unknown Artist'
  const folder = label ?? 'white-label'
  const location =
    u('location?') < 0.05 ? null : `/Users/dj/Music/${folder}/${artistName} - ${track.title}.${ext}`

  return {
    ...track,
    energy,
    comments,
    album: u('album?') < 0.1 ? null : album,
    durationSec,
    dateAdded: u('date?') < 0.1 ? null : dateAddedAnchor,
    label,
    playCount,
    composer: u('composer?') < 0.35 ? null : pick(COMPOSERS, u, 'composer'),
    grouping: u('grouping?') < 0.4 ? null : pick(GROUPINGS, u, 'grouping'),
    remixer: u('remixer?') < 0.7 ? null : pick(REMIXERS, u, 'remixer'),
    mix: u('mix?') < 0.5 ? null : pick(MIXES, u, 'mix'),
    colour: u('colour?') < 0.3 ? null : pick(COLOUR_TAGS, u, 'colour'),
    kind,
    bitRate,
    sampleRate,
    size,
    trackNumber: u('track?') < 0.2 ? null : 1 + Math.floor(u('track') * 12),
    discNumber: u('disc?') < 0.15 ? null : u('disc-num') < 0.85 ? 1 : 2,
    dateModified:
      u('modified?') < 0.25 ? null : addDays(dateAddedAnchor, Math.floor(u('modified-days') * 400)),
    lastPlayed:
      playCount !== null && playCount > 0
        ? addDays(dateAddedAnchor, Math.floor(u('lastplayed-days') * 600))
        : null,
    location,
  }
}
