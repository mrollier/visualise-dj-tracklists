import { ALL_CAMELOT_KEYS } from '../src/core/keys'
import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'
import { mulberry32 } from '../src/core/random'

/**
 * Shared test track factory (v14.1 WS5): every non-identity field defaults to
 * null via EMPTY_TRACK_FIELDS, and title defaults to id. This is a clean
 * superset with no per-domain defaults baked in — callers that relied on a
 * local factory's extra defaults (e.g. key/bpm/genre/year/rating) now pass
 * them explicitly at the call site.
 */
export function track(overrides: Partial<Track> & { id: string }): Track {
  return { ...EMPTY_TRACK_FIELDS, title: overrides.id, ...overrides }
}

const GENRES = [
  'House',
  'Deep House',
  'Tech House',
  'Techno',
  'Minimal',
  'Progressive House',
  'Trance',
  'Drum & Bass',
  'Hip Hop',
  'Disco',
  null,
]

/**
 * A seeded, realistic-looking library: every field a combo criterion reads,
 * spread over its usual range, with some gaps. Same seed, same library.
 */
export function randomLibrary(n: number, seed = 1): Track[] {
  const rand = mulberry32(seed)
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]
  const maybe = <T>(value: T): T | null => (rand() < 0.08 ? null : value)
  return Array.from({ length: n }, (_, i) =>
    track({
      id: `t${i}`,
      artist: `Artist ${Math.floor(rand() * (n / 4 + 1))}`,
      key: maybe(pick(ALL_CAMELOT_KEYS)),
      bpm: maybe(Math.round((90 + rand() * 85) * 10) / 10),
      genre: pick(GENRES),
      year: maybe(1990 + Math.floor(rand() * 35)),
      energy: maybe(1 + Math.floor(rand() * 10)),
    }),
  )
}
