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

export interface AudioSource {
  readonly kind: 'fsa' | 'picker'
  /** The granted folder's name, for "file not found in X". */
  readonly rootName: string
  readonly index: FileIndex<AudioHandle>
  fileFor(handle: AudioHandle): Promise<File>
  /**
   * Chromium: re-acquire read permission after a reload. MUST be called from
   * inside a user gesture — `requestPermission` rejects otherwise. Always true
   * for the picker source, which only exists because the user just picked.
   */
  ensurePermission(): Promise<boolean>
}

/**
 * Both backends enumerate eagerly into one index. The picker has no choice —
 * the browser hands over a flat File[]. A lazy FSA walk is possible but could
 * not answer the coverage read-out without thousands of round-trips, and would
 * fail outright for a library that moved machines, since it would have nothing
 * to match a suffix against.
 */
export const MAX_INDEXED_FILES = 100_000
