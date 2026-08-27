import { get, writable } from 'svelte/store'
import { type CoverageReport, resolveTrack, summarize } from '../../core/audio/coverage'
import type { CanPlayProbe } from '../../core/audio/formats'
import { library } from '../../stores'
import {
  openFsaSource,
  pickDirectory,
  queryStoredPermission,
  supportsDirectoryPicker,
} from './fsaSource'
import { forgetRootHandle, loadRootHandle, saveRootHandle } from './handleStore'
import { openPickerSource } from './pickerSource'
import type { AudioHandle, AudioSource } from './source'

/**
 * The granted music folder and what it resolves the library to.
 *
 * Deliberately NOT in src/stores.ts: startAutosave subscribes to a list of
 * stores from that module, so keeping the player's state out of it is what
 * structurally guarantees nothing about listening is written into the saved
 * project.
 */
export type SourceState = 'no-source' | 'needs-permission' | 'indexing' | 'ready'
export type Resolution = ReturnType<typeof resolveTrack<AudioHandle>>

/**
 * What the link is doing right now (v29 #2). Two phases, because there are two
 * passes and the second used to happen in silence: the folder is walked, and
 * then the whole library is matched against what the walk found.
 *
 * `total` is null when it cannot be known — an FSA walk discovers the tree as
 * it goes, so the bar is honestly indeterminate there. The picker backend
 * hands over a flat File[] up front, so that one counts down properly.
 */
export type IndexPhase = 'scanning' | 'matching'
export interface IndexProgress {
  phase: IndexPhase
  done: number
  total: number | null
}

export const sourceState = writable<SourceState>('no-source')
export const rootName = writable<string | null>(null)
export const indexProgress = writable<IndexProgress | null>(null)
export const coverage = writable<CoverageReport | null>(null)

/** Matching a big library blocks the main thread; yield every this many. */
const MATCH_CHUNK = 2000

/** Hand the browser a frame, so a progress bar can actually paint. */
export function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Third-party objects and lookup tables — plain module state, never $state. */
let source: AudioSource | null = null
let pendingHandle: FileSystemDirectoryHandle | null = null
let resolutions = new Map<string, Resolution>()
let probe: CanPlayProbe = () => false
/** Bumped per reindex, so a chunked run that is overtaken abandons quietly. */
let matchRun = 0

export function setProbe(next: CanPlayProbe): void {
  probe = next
}

export function currentSource(): AudioSource | null {
  return source
}

export function resolutionFor(trackId: string): Resolution | undefined {
  return resolutions.get(trackId)
}

/**
 * `ready` waits for the match to finish (v29 #2). It used to be set first, so
 * the control flipped to its linked state with `coverage` still null and fell
 * through to "Link music folder…" until the pass completed.
 */
async function adopt(next: AudioSource): Promise<void> {
  source = next
  rootName.set(next.rootName)
  await reindex()
  sourceState.set('ready')
}

/**
 * Re-match the whole library against the current folder and report coverage.
 * Chunked: a 20,000-track library is a long enough pass to drop frames, and
 * the progress bar cannot paint from inside a synchronous loop.
 */
export async function reindex(): Promise<void> {
  const tracks = get(library)
  const against = source
  if (against === null || tracks.length === 0) {
    resolutions = new Map()
    coverage.set(null)
    indexProgress.set(null)
    return
  }
  const run = ++matchRun
  const next = new Map<string, Resolution>()
  for (let i = 0; i < tracks.length; i += 1) {
    next.set(tracks[i].id, resolveTrack(tracks[i], against.index, probe))
    if ((i + 1) % MATCH_CHUNK === 0) {
      indexProgress.set({ phase: 'matching', done: i + 1, total: tracks.length })
      await yieldToPaint()
      // A newer link or import overtook this one; its own pass owns the stores.
      if (run !== matchRun) return
    }
  }
  resolutions = next
  coverage.set(summarize([...next.values()]))
  indexProgress.set(null)
}

export function canLinkPersistently(): boolean {
  return supportsDirectoryPicker()
}

export async function linkFolder(): Promise<void> {
  const handle = await pickDirectory()
  if (handle === null) return
  // Named before the walk, not after it: `adopt` used to be the first thing to
  // set this, so a first link read "Scanning… 0" with no folder in it.
  rootName.set(handle.name)
  beginScan()
  try {
    const next = await openFsaSource(handle, reportScan)
    await saveRootHandle(handle)
    await adopt(next)
  } catch {
    // A folder can be renamed, unmounted or have its permission revoked partway
    // through the walk. Without this the state stuck on 'indexing' for the rest
    // of the session and the UI scanned forever.
    await forgetFolder()
  }
}

function beginScan(): void {
  sourceState.set('indexing')
  indexProgress.set({ phase: 'scanning', done: 0, total: null })
}

function reportScan(done: number): void {
  indexProgress.set({ phase: 'scanning', done, total: null })
}

/**
 * The webkitdirectory path: files the user has just picked, session-only.
 *
 * Async and chunked (v29 #2). It used to set 'indexing' and adopt in the same
 * synchronous tick, so on Firefox and Safari — the only browsers that take
 * this path — no scanning state ever painted at all.
 */
export async function usePickedFiles(files: readonly File[]): Promise<void> {
  if (files.length === 0) return
  rootName.set(files[0].webkitRelativePath.split('/')[0] || null)
  beginScan()
  try {
    await adopt(
      await openPickerSource(files, (done, total) =>
        indexProgress.set({ phase: 'scanning', done, total }),
      ),
    )
  } catch {
    await forgetFolder()
  }
}

/** Chromium after a reload. Must be called from inside a click handler. */
export async function reconnect(): Promise<void> {
  const handle = pendingHandle
  if (handle === null) return
  beginScan()
  try {
    const next = await openFsaSource(handle, reportScan)
    if (!(await next.ensurePermission())) {
      await forgetFolder()
      return
    }
    pendingHandle = null
    await adopt(next)
  } catch {
    await forgetFolder()
  }
}

export async function forgetFolder(): Promise<void> {
  source = null
  pendingHandle = null
  resolutions = new Map()
  matchRun += 1
  rootName.set(null)
  coverage.set(null)
  indexProgress.set(null)
  sourceState.set('no-source')
  await forgetRootHandle()
}

/**
 * Reconnect a folder granted in an earlier session. Never calls
 * requestPermission — there is no user gesture at app start, and it would
 * reject. A stale handle (folder renamed, deleted, volume unmounted) surfaces
 * as a throw at the first enumeration, so it degrades rather than erroring.
 */
export async function restoreSavedFolder(): Promise<void> {
  const handle = await loadRootHandle()
  if (handle === null) return
  const state = await queryStoredPermission(handle)
  if (state === 'granted') {
    rootName.set(handle.name)
    beginScan()
    try {
      await adopt(await openFsaSource(handle, reportScan))
    } catch {
      await forgetFolder()
    }
  } else if (state === 'prompt') {
    // Park the handle and let the bar offer a Reconnect button whose click
    // can pay for the permission prompt.
    pendingHandle = handle
    rootName.set(handle.name)
    sourceState.set('needs-permission')
  } else {
    await forgetFolder()
  }
}
