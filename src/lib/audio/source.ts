import type { FileIndex } from '../../core/audio/pathMatch'

/**
 * One interface over the two ways a browser will let a page reach local audio.
 *
 * Chromium grants a directory handle that survives a reload; Firefox and
 * Safari only offer `<input webkitdirectory>`, which is session-only. The
 * difference is confined to enumeration and to turning a handle back into a
 * File — matching, format verdicts and coverage are all the shared pure core.
 */
export type AudioHandle = FileSystemFileHandle | File

/**
 * What a link is doing right now, so no phase runs in silence. `finding`
 * follows the library's paths into the folder; `scanning` walks the whole
 * folder when those paths do not fit it; `matching` pairs the library with
 * what was found.
 *
 * `total` is null when it cannot be known — a walk discovers the tree as it
 * goes, so the bar is honestly indeterminate there.
 */
export type IndexPhase = 'finding' | 'scanning' | 'matching'
export interface IndexProgress {
  phase: IndexPhase
  done: number
  total: number | null
}

export interface AudioSource {
  readonly kind: 'fsa' | 'picker'
  /** The granted folder's name, for "file not found in X". */
  readonly rootName: string
  /**
   * The files the given library locations resolve to. The Chromium source
   * looks up locations it has not seen before; the others return the index
   * they built when they opened.
   */
  indexFor(
    locations: readonly string[],
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<FileIndex<AudioHandle>>
  fileFor(handle: AudioHandle): Promise<File>
  /**
   * Chromium: re-acquire read permission after a reload. MUST be called from
   * inside a user gesture — `requestPermission` rejects otherwise. Always true
   * for the picker source, which only exists because the user just picked.
   */
  ensurePermission(): Promise<boolean>
}

/**
 * The cap on a whole-folder index. The picker has no choice but to enumerate
 * — the browser hands over a flat File[] — and the Chromium source walks only
 * when the library's own paths do not run through the granted folder.
 */
export const MAX_INDEXED_FILES = 100_000
