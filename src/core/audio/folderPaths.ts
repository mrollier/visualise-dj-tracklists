import { foldSegment, locationSegments } from '../location'
import { buildFileIndex, type FileIndex } from './pathMatch'

/**
 * Finding a library's files inside a granted folder by following their paths.
 *
 * A granted folder exposes only its name, but a Rekordbox location usually
 * runs through it: `/Volumes/SD 1TB/Music/House/x.aiff` under a folder named
 * `Music` is `House/x.aiff` inside it. Following that route costs a few small
 * lookups per track, where walking the folder reads every file on the drive —
 * 60,000 of them for one real library, to find 2,000.
 */

/** The routes inside a folder called `rootName` for one location, one per occurrence of the name. */
export function routesUnder(rootName: string, location: string): string[][] {
  const segments = locationSegments(location)
  const root = foldSegment(rootName)
  const routes: string[][] = []
  // The last segment is the file itself, never the folder.
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (foldSegment(segments[i]) === root) routes.push(segments.slice(i + 1))
  }
  return routes
}

/** The part of a File System Access directory handle the resolver uses. */
export interface Directory<F> {
  getDirectoryHandle(name: string): Promise<Directory<F>>
  getFileHandle(name: string): Promise<F>
}

/**
 * Whether to fall back to walking the whole folder: when fewer than half the
 * locations were found, the paths do not run through this folder (the library
 * moved machines, or the folder was renamed). With nothing to look up, the
 * walk is also what tells a reachable folder from an unplugged drive.
 */
export function shouldWalk(found: number, asked: number): boolean {
  return asked === 0 || found * 2 < asked
}

export interface PathLookup<F> {
  /** Everything found so far, as the index the matcher reads. */
  index: FileIndex<F>
  /** How many of the locations just asked about were found. */
  found: number
}

export function createPathResolver<F>(root: Directory<F>, rootName: string, concurrency = 8) {
  const folders = new Map<string, Promise<Directory<F> | null>>()
  /** Location → whether any of its routes reached a file. */
  const tried = new Map<string, boolean>()
  /** Route key → file; keyed by route so two locations reaching one file stay one entry. */
  const files = new Map<string, { path: string[]; handle: F }>()

  function folder(route: readonly string[]): Promise<Directory<F> | null> {
    if (route.length === 0) return Promise.resolve(root)
    const key = route.join('/')
    let found = folders.get(key)
    if (found === undefined) {
      found = folder(route.slice(0, -1)).then((parent) =>
        parent === null
          ? null
          : parent.getDirectoryHandle(route[route.length - 1]).catch(() => null),
      )
      folders.set(key, found)
    }
    return found
  }

  /**
   * Every route that reaches a file goes into the index, not just the first:
   * when the folder name occurs twice in a path, the matcher's longest-suffix
   * rule then picks among them exactly as it does after a walk.
   */
  async function resolve(location: string): Promise<boolean> {
    let reached = false
    for (const route of routesUnder(rootName, location)) {
      const key = route.join('/')
      if (files.has(key)) {
        reached = true
        continue
      }
      const parent = await folder(route.slice(0, -1))
      if (parent === null) continue
      try {
        files.set(key, { path: route, handle: await parent.getFileHandle(route[route.length - 1]) })
        reached = true
      } catch {
        // Not at this depth.
      }
    }
    return reached
  }

  async function lookUp(
    locations: readonly string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<PathLookup<F>> {
    const fresh = [...new Set(locations)].filter((location) => !tried.has(location))
    let next = 0
    let done = 0
    const worker = async () => {
      while (next < fresh.length) {
        const location = fresh[next]
        next += 1
        tried.set(location, await resolve(location))
        done += 1
        if (done % 100 === 0) onProgress?.(done, fresh.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, fresh.length) }, worker))
    if (fresh.length > 0) onProgress?.(fresh.length, fresh.length)
    const found = locations.filter((location) => tried.get(location) === true).length
    return { index: buildFileIndex(files.values()), found }
  }

  return { lookUp }
}
