import { genreComponents, genreFamilyOf } from './genre'
import type { Playlist, Track } from './model'

/**
 * The node-shape classification for one icon mode (v8 issues 4+5). `classOf`
 * is keyed by normalized primary genre label (genre-derived modes) or by
 * track id (playlist mode) — resolve through classIndexOfTrack so the views
 * never care. Class 0 is always the largest class (it keeps the circle).
 */
export interface IconClassification {
  classOf: Map<string, number>
  /** Per class: a display label and its track count. */
  classes: { label: string; size: number }[]
  keyedBy: 'genre' | 'track'
}

/** Order classes by size (desc), then label, and cap them at maxClasses. */
function toClasses(
  sizes: Map<string, number>,
  maxClasses: number,
): { label: string; size: number }[] {
  return [...sizes.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(2, maxClasses))
    .map(([label, size]) => ({ label, size }))
}

/**
 * Icons from the curated genre tree: each primary genre maps to its family
 * (genreFamilyOf) — deterministic and stable, unlike similarity clustering.
 * Labels without a family stay unclassed (circle); with fewer than two
 * families there is nothing to distinguish and the result is null.
 */
export function genreFamilyClasses(
  rawGenres: (string | null)[],
  maxClasses: number,
): IconClassification | null {
  const familyOfLabel = new Map<string, string>()
  const familySizes = new Map<string, number>()
  for (const raw of rawGenres) {
    if (raw === null) continue
    const primary = genreComponents(raw)[0]
    const family = familyOfLabel.get(primary) ?? genreFamilyOf(primary)
    if (family === null) continue
    familyOfLabel.set(primary, family)
    familySizes.set(family, (familySizes.get(family) ?? 0) + 1)
  }
  if (familySizes.size < 2) return null
  const classes = toClasses(familySizes, maxClasses)
  const indexOfFamily = new Map(classes.map((cls, index) => [cls.label, index]))
  const classOf = new Map<string, number>()
  for (const [label, family] of familyOfLabel) {
    const index = indexOfFamily.get(family)
    if (index !== undefined) classOf.set(label, index)
  }
  return { classOf, classes, keyedBy: 'genre' }
}

/**
 * Icons from playlist membership: a track's class is the FIRST selected
 * playlist (panel order) containing it. Tracks in none of the selected
 * playlists stay unclassed; a single selected playlist distinguishes
 * nothing and yields null. Beyond maxClasses, the largest playlists keep
 * their symbol.
 */
export function playlistClasses(
  tracks: Track[],
  selectedPlaylists: Playlist[],
  maxClasses: number,
): IconClassification | null {
  if (selectedPlaylists.length < 2) return null
  const present = new Set(tracks.map((t) => t.id))
  const playlistOfTrack = new Map<string, string>()
  const sizes = new Map<string, number>(selectedPlaylists.map((p) => [p.name, 0]))
  for (const playlist of selectedPlaylists) {
    for (const id of playlist.trackIds) {
      if (!present.has(id) || playlistOfTrack.has(id)) continue
      playlistOfTrack.set(id, playlist.name)
      sizes.set(playlist.name, (sizes.get(playlist.name) ?? 0) + 1)
    }
  }
  // Size decides, panel order breaks ties — the user's own playlist
  // ordering is more meaningful here than the alphabet.
  const classes = [...sizes]
    .filter(([, size]) => size > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(2, maxClasses))
    .map(([label, size]) => ({ label, size }))
  if (classes.length < 2) return null
  const indexOfPlaylist = new Map(classes.map((cls, index) => [cls.label, index]))
  const classOf = new Map<string, number>()
  for (const [id, name] of playlistOfTrack) {
    const index = indexOfPlaylist.get(name)
    if (index !== undefined) classOf.set(id, index)
  }
  return { classOf, classes, keyedBy: 'track' }
}

/** A track's class index under either keying, null-safe. */
export function classIndexOfTrack(
  classification: IconClassification | null,
  track: Track,
): number | null {
  if (classification === null) return null
  if (classification.keyedBy === 'track') return classification.classOf.get(track.id) ?? null
  if (track.genre === null) return null
  return classification.classOf.get(genreComponents(track.genre)[0]) ?? null
}
