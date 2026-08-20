import { foldSegments, locationSegments } from '../location'

/**
 * Matching a library's `Track.location` against the contents of a folder the
 * user granted.
 *
 * The granted root's absolute path is unobservable — a FileSystemDirectoryHandle
 * exposes only its `.name`, and `File.webkitRelativePath` is relative to the
 * pick. So rerooting a stored absolute path onto the grant is not merely
 * fragile, it is impossible, and prefix matching is off the table.
 *
 * What survives a move between machines is the SUFFIX: `House/2019/Track.mp3`
 * travels with the files, `/Users/old/Music` belongs to the old machine. So we
 * bucket on file name and break collisions on the deepest shared parent.
 *
 * Ties are refused rather than guessed. The M3U importer can afford to fall
 * back to "artist - title" because a wrong metadata row is visible and
 * recoverable; silently playing the WRONG AUDIO FILE would corrupt the exact
 * judgement this feature exists to support, invisibly.
 */

export interface IndexEntry<H> {
  /** Folder-relative path, folded for comparison. */
  readonly segments: readonly string[]
  readonly handle: H
}

export interface FileIndex<H> {
  readonly byName: ReadonlyMap<string, readonly IndexEntry<H>[]>
  readonly size: number
}

export type Match<H> =
  | { kind: 'hit'; entry: IndexEntry<H>; depth: number }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'miss' }

export function buildFileIndex<H>(
  entries: Iterable<{ path: readonly string[]; handle: H }>,
): FileIndex<H> {
  const byName = new Map<string, IndexEntry<H>[]>()
  let size = 0
  for (const { path, handle } of entries) {
    const segments = foldSegments(path).filter((segment) => segment !== '')
    const name = segments[segments.length - 1]
    if (name === undefined) continue
    const bucket = byName.get(name)
    if (bucket === undefined) byName.set(name, [{ segments, handle }])
    else bucket.push({ segments, handle })
    size += 1
  }
  return { byName, size }
}

/** How many segments the two paths share, walking backwards from the end. */
export function commonSuffixDepth(a: readonly string[], b: readonly string[]): number {
  let depth = 0
  while (
    depth < a.length &&
    depth < b.length &&
    a[a.length - 1 - depth] === b[b.length - 1 - depth]
  )
    depth += 1
  return depth
}

export function matchSegments<H>(index: FileIndex<H>, folded: readonly string[]): Match<H> {
  const name = folded[folded.length - 1]
  if (name === undefined) return { kind: 'miss' }
  const bucket = index.byName.get(name)
  if (bucket === undefined || bucket.length === 0) return { kind: 'miss' }
  // The overwhelmingly common case: one file with that name in the user's own
  // music folder. No shared folder structure is needed for it to be right.
  if (bucket.length === 1) {
    return { kind: 'hit', entry: bucket[0], depth: commonSuffixDepth(bucket[0].segments, folded) }
  }
  let best = bucket[0]
  let bestDepth = commonSuffixDepth(best.segments, folded)
  let tied = 1
  for (const entry of bucket.slice(1)) {
    const depth = commonSuffixDepth(entry.segments, folded)
    if (depth > bestDepth) {
      best = entry
      bestDepth = depth
      tied = 1
    } else if (depth === bestDepth) tied += 1
  }
  if (tied > 1) return { kind: 'ambiguous', count: tied }
  return { kind: 'hit', entry: best, depth: bestDepth }
}

export function matchLocation<H>(index: FileIndex<H>, location: string): Match<H> {
  return matchSegments(index, foldSegments(locationSegments(location)))
}
