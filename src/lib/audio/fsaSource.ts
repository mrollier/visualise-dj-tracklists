import { isAudioFileName } from '../../core/audio/formats'
import { createPathResolver, shouldWalk } from '../../core/audio/folderPaths'
import { buildFileIndex, type FileIndex } from '../../core/audio/pathMatch'
import { type AudioHandle, type AudioSource, type IndexProgress, MAX_INDEXED_FILES } from './source'

/** Chromium only. Firefox has declined to implement this; Safari has not shipped it. */
export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

/** Returns null when the user dismisses the picker — not an error. */
export async function pickDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsDirectoryPicker()) return null
  try {
    // `id` makes the browser reopen wherever this app last picked; `startIn`
    // only decides the very first time, when there is nothing remembered. It is
    // the only aiming any browser offers — there is no way to pass a path, and
    // <input webkitdirectory> takes no hint at all.
    return (
      (await window.showDirectoryPicker?.({ id: 'music', mode: 'read', startIn: 'music' })) ?? null
    )
  } catch {
    return null
  }
}

/**
 * Read permission without prompting. Safe at app start, where there is no user
 * gesture to spend — `requestPermission` would reject there.
 */
export async function queryStoredPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  try {
    return (await handle.queryPermission?.({ mode: 'read' })) ?? 'granted'
  } catch {
    return 'denied'
  }
}

/**
 * Ensure read permission, prompting if needed. Must be reachable from a user
 * gesture when the stored state is 'prompt' — and it must run BEFORE any
 * directory walk, which rejects outright on an ungranted handle.
 */
export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if ((await queryStoredPermission(handle)) === 'granted') return true
  try {
    return (await handle.requestPermission?.({ mode: 'read' })) === 'granted'
  } catch {
    return false
  }
}

async function* walk(
  directory: FileSystemDirectoryHandle,
  prefix: readonly string[],
): AsyncGenerator<{ path: string[]; handle: AudioHandle }> {
  for await (const [name, entry] of directory.entries()) {
    if (entry.kind === 'directory') {
      yield* walk(entry, [...prefix, name])
    } else if (isAudioFileName(name)) {
      yield { path: [...prefix, name], handle: entry }
    }
  }
}

/**
 * Walk the granted folder once and index what we find. Filtering by extension
 * during the walk matters: a Rekordbox folder is mostly .asd sidecars and
 * artwork. We never call getFile() here — on this backend that is an IPC
 * round-trip per file, and nothing about indexing needs the bytes.
 */
async function walkIndex(
  handle: FileSystemDirectoryHandle,
  onProgress?: (indexed: number) => void,
): Promise<FileIndex<AudioHandle>> {
  const entries: { path: string[]; handle: AudioHandle }[] = []
  for await (const entry of walk(handle, [])) {
    entries.push(entry)
    if (entries.length % 500 === 0) {
      onProgress?.(entries.length)
      // Let the browser paint the running count.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (entries.length >= MAX_INDEXED_FILES) break
  }
  onProgress?.(entries.length)
  return buildFileIndex(entries)
}

/**
 * The Chromium source. Each library track is looked up along its own path
 * inside the granted folder, which costs a few lookups per track instead of
 * reading every file on the drive. When fewer than half the tracks are found
 * that way, the paths do not run through this folder, and it walks the whole
 * folder and matches by path suffix instead. The walk also throws when the
 * folder cannot be reached, which is how an unplugged drive is noticed.
 */
export async function openFsaSource(
  handle: FileSystemDirectoryHandle,
  locations: readonly string[],
  onProgress?: (progress: IndexProgress) => void,
): Promise<AudioSource> {
  const finding = (report?: (progress: IndexProgress) => void) => (done: number, total: number) =>
    report?.({ phase: 'finding', done, total })
  const base = {
    kind: 'fsa' as const,
    rootName: handle.name,
    fileFor: (file: AudioHandle) => (file instanceof File ? Promise.resolve(file) : file.getFile()),
    ensurePermission: () => requestReadPermission(handle),
  }
  const resolver = createPathResolver<FileSystemFileHandle>(handle, handle.name)
  const first = await resolver.lookUp(locations, finding(onProgress))
  if (shouldWalk(first.found, locations.length)) {
    const index = await walkIndex(handle, (done) =>
      onProgress?.({ phase: 'scanning', done, total: null }),
    )
    return { ...base, indexFor: () => Promise.resolve(index) }
  }
  let walked: FileIndex<AudioHandle> | null = null
  return {
    ...base,
    indexFor: async (all, report) => {
      if (walked !== null) return walked
      const { index, found } = await resolver.lookUp(all, finding(report))
      // A library re-imported from another machine may no longer run through
      // this folder; it gets the walk a fresh link would have chosen.
      if (all.length === 0 || !shouldWalk(found, all.length)) return index
      try {
        walked = await walkIndex(handle, (done) =>
          report?.({ phase: 'scanning', done, total: null }),
        )
        return walked
      } catch {
        // Out of reach (an unplugged drive): keep what the paths found.
        return index
      }
    },
  }
}
