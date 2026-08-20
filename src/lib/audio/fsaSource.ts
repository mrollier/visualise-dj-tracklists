import { isAudioFileName } from '../../core/audio/formats'
import { buildFileIndex } from '../../core/audio/pathMatch'
import { type AudioHandle, type AudioSource, MAX_INDEXED_FILES } from './source'

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
export async function openFsaSource(
  handle: FileSystemDirectoryHandle,
  onProgress?: (indexed: number) => void,
): Promise<AudioSource> {
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
  return {
    kind: 'fsa',
    rootName: handle.name,
    index: buildFileIndex(entries),
    fileFor: (file) => (file instanceof File ? Promise.resolve(file) : file.getFile()),
    ensurePermission: async () => {
      if ((await queryStoredPermission(handle)) === 'granted') return true
      try {
        return (await handle.requestPermission?.({ mode: 'read' })) === 'granted'
      } catch {
        return false
      }
    },
  }
}
