import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'

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
