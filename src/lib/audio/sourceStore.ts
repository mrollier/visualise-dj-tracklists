import { get, writable } from 'svelte/store'
import { type CoverageReport, resolveTrack, summarize } from '../../core/audio/coverage'
import type { CanPlayProbe } from '../../core/audio/formats'
import type { Track } from '../../core/model'
import { library } from '../../stores'
import {
  openFsaSource,
  pickDirectory,
  queryStoredPermission,
  requestReadPermission,
  supportsDirectoryPicker,
} from './fsaSource'
import { forgetRootHandle, loadRootHandle, saveRootHandle } from './handleStore'
import { openPickerSource } from './pickerSource'
import type { AudioHandle, AudioSource, IndexProgress } from './source'

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

export type { IndexPhase, IndexProgress } from './source'

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

function locationsOf(tracks: readonly Track[]): string[] {
  return tracks.flatMap((track) => (track.location === null ? [] : [track.location]))
}

function reportProgress(progress: IndexProgress): void {
  indexProgress.set(progress)
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
 * `ready` waits for the match to finish. Setting it first would flip the
 * control to its linked state while `coverage` is still null, falling
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
    // Also ends any pass still running, or it would write over this one.
    matchRun += 1
    resolutions = new Map()
    coverage.set(null)
    indexProgress.set(null)
    return
  }
  const run = ++matchRun
  const index = await against.indexFor(locationsOf(tracks), (progress) => {
    if (run === matchRun) reportProgress(progress)
  })
  // Overtaken while the folder was being searched; the newer pass owns the stores.
  if (run !== matchRun) return
  const next = new Map<string, Resolution>()
  for (let i = 0; i < tracks.length; i += 1) {
    next.set(tracks[i].id, resolveTrack(tracks[i], index, probe))
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
  // Named before the walk, not after it: setting this only once `adopt` runs
  // would read "Scanning… 0" with no folder in it for a first link.
  rootName.set(handle.name)
  beginScan()
  try {
    const next = await openFsaSource(handle, locationsOf(get(library)), reportProgress)
    await saveRootHandle(handle)
    await adopt(next)
  } catch {
    // A folder can be renamed, unmounted or have its permission revoked partway
    // through the walk. Without this the state stuck on 'indexing' for the rest
    // of the session and the UI scanned forever.
    //
    // Known accepted edge: if saveRootHandle(B) succeeded and adopt then threw,
    // IndexedDB holds B while this session keeps A; the next reload restores B.
    // Rare and self-correcting — not worth extra code.
    await abandonLink()
  }
}

/**
 * A link attempt failed partway. Forgetting everything is only right when
 * there was nothing before it — a failed REPLACEMENT must not unlink the
 * still-working folder from memory and IndexedDB. `adopt` never ran, so
 * `resolutions`/`coverage` still describe the surviving source and only the
 * three stores the attempt touched need restoring.
 */
async function abandonLink(): Promise<void> {
  if (source === null) {
    await forgetFolder()
    return
  }
  rootName.set(source.rootName)
  indexProgress.set(null)
  sourceState.set('ready')
}

function beginScan(): void {
  sourceState.set('indexing')
  indexProgress.set({ phase: 'scanning', done: 0, total: null })
}

/**
 * The webkitdirectory path: files the user has just picked, session-only.
 *
 * Async and chunked: setting 'indexing' and adopting in the same synchronous
 * tick would mean no scanning state ever paints, on Firefox and Safari — the
 * only browsers that take this path.
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
    await abandonLink()
  }
}

/** Chromium after a reload. Must be called from inside a click handler. */
export async function reconnect(): Promise<void> {
  const handle = pendingHandle
  if (handle === null) return
  // The prompt must come BEFORE the walk: iterating an ungranted handle
  // rejects, and walking first would treat that rejection — and even a
  // plain Cancel on the prompt — as a reason to forget the folder. A
  // refusal keeps the parked handle; the Reconnect button stays offered.
  if (!(await requestReadPermission(handle))) return
  beginScan()
  try {
    const next = await openFsaSource(handle, locationsOf(get(library)), reportProgress)
    pendingHandle = null
    await adopt(next)
  } catch {
    // Unreachable (an unmounted drive, most often) is not a reason to forget
    // the folder: keep offering Reconnect for when it is plugged back in.
    if (source === null) park(handle)
    else await abandonLink()
  }
}

/** Remember a folder without reading it, and offer Reconnect. */
function park(handle: FileSystemDirectoryHandle): void {
  pendingHandle = handle
  rootName.set(handle.name)
  indexProgress.set(null)
  sourceState.set('needs-permission')
}

async function forgetFolder(): Promise<void> {
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
 * reject. A handle that cannot be read now (volume unmounted, folder moved)
 * is parked behind Reconnect rather than forgotten: a DJ's music drive is
 * routinely not plugged in when the app opens.
 */
export async function restoreSavedFolder(): Promise<void> {
  const handle = await loadRootHandle()
  if (handle === null) return
  const state = await queryStoredPermission(handle)
  if (state === 'granted') {
    rootName.set(handle.name)
    beginScan()
    try {
      await adopt(await openFsaSource(handle, locationsOf(get(library)), reportProgress))
    } catch {
      park(handle)
    }
  } else if (state === 'prompt') {
    // Let the bar offer a Reconnect button whose click can pay for the
    // permission prompt.
    park(handle)
  } else {
    await forgetFolder()
  }
}
