import { get, writable } from 'svelte/store'
import { sanitizeProject, serializeProjectParts } from '../core/persist'
import {
  activeSetId,
  analysis,
  autosaveError,
  colorAxis,
  criteria,
  filters,
  library,
  libraryName,
  manualEdges,
  playlists,
  radialAxis,
  sets,
  settings,
  tourStep,
} from '../stores'
import { openStore } from './idb'
import { applyProject, currentProject, isSampleLibrary } from './persistence'

/**
 * The autosave: every meaningful change lands in IndexedDB, debounced.
 *
 * IndexedDB rather than localStorage, whose ~5M-character quota a
 * 6k-track library fills on its own. Two records — `library` (tracks,
 * playlists, analysis) and `work` (everything else) — so a set edit rewrites
 * kilobytes, not the whole collection, and one transaction writes both so the
 * pair never tears.
 *
 * Nothing is saved while the guided tour runs (it swaps the demo in and would
 * otherwise overwrite the real library), nor from a tab that does not hold
 * the autosave lock: two open tabs used to overwrite each other silently.
 * A save this build cannot read is quarantined, never deleted — a rolled-back
 * bundle meeting a newer schema must not destroy the only copy.
 */
const store = openStore('visualise-dj-tracklists:project', 'autosave')
const LEGACY_KEY = 'visualise-dj-tracklists:project:v1'
const LOCK = 'visualise-dj-tracklists:autosave'

/** True while another tab owns the autosave; this one then saves nothing. */
export const autosaveBlocked = writable(false)
/** A save this build could not read, as raw text, so the user can keep it. */
export const unreadableAutosave = writable<string | null>(null)

let restored = false
let saved: { tracks: unknown; playlists: unknown; analysis: unknown } | null = null

function readLegacy(): string | null {
  try {
    return localStorage.getItem(LEGACY_KEY)
  } catch {
    return null
  }
}

/** Keep an unreadable save aside (the first one only) and say so. */
async function quarantine(text: string): Promise<void> {
  unreadableAutosave.set(text)
  autosaveError.set('Your last autosave could not be read by this version.')
  const [existing] = await store.getMany(['unreadable'])
  if (existing === undefined) await store.putMany([['unreadable', text]])
}

/**
 * The two records as one project file a newer build can load through Import
 * — or, if the JSON itself is broken, both texts as they were.
 */
function asProjectFile(work: string, lib: unknown): string {
  try {
    return JSON.stringify({
      ...JSON.parse(work),
      ...JSON.parse(typeof lib === 'string' ? lib : '{}'),
    })
  } catch {
    return JSON.stringify({ work, library: lib })
  }
}

function remember(): void {
  saved = { tracks: get(library), playlists: get(playlists), analysis: get(analysis) }
}

/**
 * Claim the autosave for this tab. The lock is held until the tab closes; a
 * tab that cannot get it runs blocked. `steal` takes it from another tab,
 * whose own request then rejects and blocks it instead.
 */
function claimLock(steal: boolean): Promise<void> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  // ponytail: without Web Locks there is no cross-tab guard; every modern
  // browser has them.
  if (locks === undefined) return Promise.resolve()
  return new Promise((resolve) => {
    locks
      .request(LOCK, steal ? { steal: true } : { ifAvailable: true }, (lock) => {
        autosaveBlocked.set(lock === null)
        resolve()
        return lock === null ? undefined : new Promise<void>(() => {})
      })
      .catch(() => autosaveBlocked.set(true))
  })
}

/** Load the saved project, migrating a localStorage save on the way. */
export async function restoreAutosave(): Promise<void> {
  await claimLock(false)
  await loadSaved()
}

async function loadSaved(): Promise<void> {
  try {
    const [work, lib] = await store.getMany(['work', 'library'])
    if (typeof work === 'string') {
      try {
        applyProject(
          sanitizeProject({
            ...JSON.parse(work),
            ...JSON.parse(typeof lib === 'string' ? lib : '{}'),
          }),
        )
        remember()
      } catch {
        await quarantine(asProjectFile(work, lib))
      }
      return
    }
    const legacy = readLegacy()
    if (legacy === null) return
    try {
      applyProject(sanitizeProject(JSON.parse(legacy)))
    } catch {
      // Left where it is: a later build may read it.
      unreadableAutosave.set(legacy)
      autosaveError.set('Your last autosave could not be read by this version.')
      return
    }
    const parts = serializeProjectParts(currentProject())
    await store.putMany([
      ['work', parts.work],
      ['library', parts.library],
    ])
    remember()
    try {
      localStorage.removeItem(LEGACY_KEY)
    } catch {
      // Harmless: IndexedDB wins from now on.
    }
  } catch {
    autosaveError.set('Autosave is unavailable in this browser mode — save to a file.')
  } finally {
    restored = true
  }
}

let persistRequested = false

/** Write the current project now (the debounced autosave calls this). */
export async function flushAutosave(): Promise<void> {
  if (!restored || get(autosaveBlocked) || get(tourStep) !== null) return
  const project = currentProject()
  if (project.tracks.length === 0) return // nothing worth saving yet
  const parts = serializeProjectParts(project)
  const libraryChanged =
    saved === null ||
    saved.tracks !== project.tracks ||
    saved.playlists !== project.playlists ||
    saved.analysis !== project.analysis
  try {
    await store.putMany(
      libraryChanged
        ? [
            ['work', parts.work],
            ['library', parts.library],
          ]
        : [['work', parts.work]],
    )
    saved = { tracks: project.tracks, playlists: project.playlists, analysis: project.analysis }
    if (get(unreadableAutosave) === null) autosaveError.set(null)
  } catch (error) {
    autosaveError.set(
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Autosave failed — this browser is out of storage. Save to a file (⌘S).'
        : 'Autosave failed — save to a file (⌘S).',
    )
    return
  }
  // Ask the browser not to evict the library under storage pressure — once,
  // after a real library first lands (Firefox shows a prompt for it).
  if (!persistRequested && !isSampleLibrary(project.tracks)) {
    persistRequested = true
    void globalThis.navigator?.storage?.persist?.()
  }
}

/** Save every meaningful change, debounced; flush when the tab is hidden. */
export function startAutosave(): void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    clearTimeout(timer)
    timer = setTimeout(() => void flushAutosave(), 400)
  }
  for (const s of [
    library,
    libraryName,
    criteria,
    filters,
    settings,
    sets, // every tracklist and mark edit flows through here
    activeSetId,
    manualEdges,
    playlists,
    radialAxis,
    colorAxis,
    analysis,
    tourStep, // the tour's end is a change worth saving
  ]) {
    s.subscribe(schedule)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timer)
        void flushAutosave()
      }
    })
  }
}

/**
 * Take the autosave over from another tab and load its latest save here. In
 * place, not by reloading: a reloaded page asks for the lock again and can
 * race the old document releasing it, coming back blocked.
 */
export async function takeOverAutosave(): Promise<void> {
  await claimLock(true)
  await loadSaved()
  // The other tab can still land a write after the read above, so the first
  // save from here writes both records rather than trusting they match.
  saved = null
}

/**
 * Forget the saved project (Reset). A quarantined save is kept, and a tab
 * without the lock leaves the save alone: it belongs to the tab that owns it,
 * which would otherwise go on writing `work` next to a deleted `library`.
 */
export async function clearAutosave(): Promise<void> {
  saved = null
  if (get(autosaveBlocked)) return
  await store.delete(['work', 'library']).catch(() => undefined)
  try {
    localStorage.removeItem(LEGACY_KEY)
  } catch {
    // Storage blocked: nothing there to clear.
  }
}
