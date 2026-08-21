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

export const sourceState = writable<SourceState>('no-source')
export const rootName = writable<string | null>(null)
export const indexedCount = writable(0)
export const coverage = writable<CoverageReport | null>(null)

/** Third-party objects and lookup tables — plain module state, never $state. */
let source: AudioSource | null = null
let pendingHandle: FileSystemDirectoryHandle | null = null
let resolutions = new Map<string, Resolution>()
let probe: CanPlayProbe = () => false

export function setProbe(next: CanPlayProbe): void {
  probe = next
}

export function currentSource(): AudioSource | null {
  return source
}

export function resolutionFor(trackId: string): Resolution | undefined {
  return resolutions.get(trackId)
}

function adopt(next: AudioSource): void {
  source = next
  rootName.set(next.rootName)
  sourceState.set('ready')
  reindex()
}

/** Re-match the whole library against the current folder and report coverage. */
export function reindex(): void {
  const tracks = get(library)
  if (source === null || tracks.length === 0) {
    resolutions = new Map()
    coverage.set(null)
    return
  }
  const next = new Map<string, Resolution>()
  for (const track of tracks) next.set(track.id, resolveTrack(track, source.index, probe))
  resolutions = next
  coverage.set(summarize([...next.values()]))
}

export function canLinkPersistently(): boolean {
  return supportsDirectoryPicker()
}

export async function linkFolder(): Promise<void> {
  const handle = await pickDirectory()
  if (handle === null) return
  sourceState.set('indexing')
  // A folder can be renamed, unmounted or have its permission revoked partway
  // through the walk. Without this the state stuck on 'indexing' for the rest
  // of the session and the UI scanned forever.
  try {
    const next = await openFsaSource(handle, (n) => indexedCount.set(n))
    await saveRootHandle(handle)
    adopt(next)
  } catch {
    await forgetFolder()
  }
}

/** The webkitdirectory path: files the user has just picked, session-only. */
export function usePickedFiles(files: readonly File[]): void {
  if (files.length === 0) return
  sourceState.set('indexing')
  adopt(openPickerSource(files))
}

/** Chromium after a reload. Must be called from inside a click handler. */
export async function reconnect(): Promise<void> {
  const handle = pendingHandle
  if (handle === null) return
  sourceState.set('indexing')
  try {
    const next = await openFsaSource(handle, (n) => indexedCount.set(n))
    if (!(await next.ensurePermission())) {
      await forgetFolder()
      return
    }
    pendingHandle = null
    adopt(next)
  } catch {
    await forgetFolder()
  }
}

export async function forgetFolder(): Promise<void> {
  source = null
  pendingHandle = null
  resolutions = new Map()
  rootName.set(null)
  coverage.set(null)
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
    try {
      adopt(await openFsaSource(handle, (n) => indexedCount.set(n)))
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
