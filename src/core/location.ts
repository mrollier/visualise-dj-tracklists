/**
 * Shared parsing for the `Location` string every importer stores verbatim on
 * `Track.location` — Rekordbox writes `file://localhost/Users/…/Track.mp3`,
 * percent-encoded and NOT decoded at import (importers/rekordbox.ts).
 *
 * Extracted in v28 from the two private copies that had drifted apart
 * (exporters/m3u.ts and importers/m3u.ts) so the audio-preview matcher, the
 * M3U exporter and the M3U importer all fold names the same way.
 */

/** Turn a Rekordbox-style location URL into a plain filesystem path. */
export function locationToPath(location: string): string {
  const withoutScheme = location.replace(/^file:\/\/(localhost)?/, '')
  try {
    return decodeURIComponent(withoutScheme)
  } catch {
    // A stray '%' is not an escape — keep the raw path rather than throwing.
    return withoutScheme
  }
}

/**
 * The decoded path as non-empty segments. A Windows `file:///C:/…` keeps `C:`
 * as an ordinary segment: it never matches a granted folder's contents, so it
 * simply drops out of suffix scoring instead of needing a special case.
 */
export function locationSegments(location: string): string[] {
  return locationToPath(location)
    .split('/')
    .filter((segment) => segment !== '')
}

/**
 * The comparison form of one path segment. NFC matters: macOS APFS hands
 * filenames to the File API in NFD while Rekordbox's XML carries NFC, so
 * without this every accented artist silently fails to match. Case folds to
 * match macOS/Windows defaults. Punctuation and whitespace are deliberately
 * left alone — stripping them manufactures false positives, and playing the
 * wrong file is the one failure this feature cannot afford.
 */
export function foldSegment(segment: string): string {
  return segment.normalize('NFC').toLowerCase()
}

export function foldSegments(segments: readonly string[]): string[] {
  return segments.map(foldSegment)
}

/** The folded final segment of a location — the file name, ready to compare. */
export function basenameOf(location: string): string {
  const segments = locationSegments(location)
  const last = segments[segments.length - 1]
  return last === undefined ? '' : foldSegment(last)
}

/**
 * The deepest folder every track in the library sits under, as a path a person
 * can read and paste (v28.1).
 *
 * A browser will not let a page pre-open a folder picker at a path: Chromium's
 * `showDirectoryPicker` takes only well-known names, and `<input
 * webkitdirectory>` takes nothing at all. So on Firefox and Safari the only
 * help we can offer is to SHOW the user where their music is and let them
 * paste it — ⌘⇧G in the macOS open panel, the path field in a Windows dialog.
 *
 * Folded comparison, original spelling for display: the folder exists exactly
 * once on disk, so a library whose XML disagrees about case or Unicode form
 * still resolves to one hint.
 *
 * Returns null below two shared segments — one outlier track on the Desktop
 * collapses the prefix, and `/Users` helps nobody. It is a hint, not a
 * contract; a majority-covering variant is not worth the code.
 */
function formatPath(segments: readonly string[]): string {
  // `C:` is an ordinary segment to locationSegments, but `/C:/Users` is not
  // what a Windows dialog accepts pasted back.
  return /^[A-Za-z]:$/.test(segments[0]) ? segments.join('\\') : `/${segments.join('/')}`
}

export function commonAncestorPath(locations: readonly (string | null)[]): string | null {
  let prefix: string[] | null = null
  for (const location of locations) {
    if (location === null || location === '') continue
    const directory = locationSegments(location).slice(0, -1)
    if (directory.length === 0) continue
    if (prefix === null) {
      prefix = directory
      continue
    }
    let shared = 0
    while (
      shared < prefix.length &&
      shared < directory.length &&
      foldSegment(prefix[shared]) === foldSegment(directory[shared])
    )
      shared++
    prefix = prefix.slice(0, shared)
    if (prefix.length === 0) return null
  }
  if (prefix === null || prefix.length < 2) return null
  return formatPath(prefix)
}

/**
 * A track the user will recognise, where it claims to live, and the folder to
 * link because of it (v29 #3).
 *
 * The bare shared-ancestor path was never enough on its own: it says where to
 * go without saying *why*, and it disappears entirely — `commonAncestorPath`
 * returns null — the moment one stray track sits somewhere else. A worked
 * example survives both. The parameter is structural rather than `Track` so
 * this module stays free of the library model.
 */
export interface FolderHint {
  /** A real track, its full path, and the folder that path sits in. */
  example: { label: string; path: string; folder: string | null } | null
  /** The deepest folder every located track shares, when there is one. */
  suggested: string | null
  /** No shared folder worth naming, though the library does have paths. */
  scattered: boolean
}

export interface HintTrack {
  title: string
  artist: string | null
  location: string | null
}

export function folderHint(tracks: readonly HintTrack[]): FolderHint {
  const located = tracks.find((t) => t.location !== null && t.location !== '')
  const suggested = commonAncestorPath(tracks.map((t) => t.location))
  if (located === undefined || located.location === null) {
    return { example: null, suggested, scattered: false }
  }
  const segments = locationSegments(located.location)
  const directory = segments.slice(0, -1)
  return {
    example: {
      label: located.artist === null ? located.title : `${located.artist} — ${located.title}`,
      path: formatPath(segments),
      folder: directory.length > 0 ? formatPath(directory) : null,
    },
    suggested,
    scattered: suggested === null,
  }
}
