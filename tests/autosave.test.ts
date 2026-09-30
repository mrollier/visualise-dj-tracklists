import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { serializeProject, type Project } from '../src/core/persist'
import { freshFirstSet } from '../src/core/sets'
import { track } from './helpers'

// An in-memory stand-in for IndexedDB: the autosave only ever talks to it
// through src/lib/idb.ts, so the store is the whole contract.
const db = new Map<string, unknown>()
const writes: string[][] = []
let failWrites: Error | null = null
vi.mock('../src/lib/idb', () => ({
  openStore: () => ({
    getMany: (keys: string[]) => Promise.resolve(keys.map((k) => db.get(k))),
    putMany: (entries: [string, unknown][]) => {
      if (failWrites !== null) return Promise.reject(failWrites)
      writes.push(entries.map(([k]) => k))
      for (const [k, v] of entries) db.set(k, v)
      return Promise.resolve()
    },
    delete: (keys: string[]) => {
      for (const k of keys) db.delete(k)
      return Promise.resolve()
    },
  }),
}))

const {
  restoreAutosave,
  flushAutosave,
  startAutosave,
  clearAutosave,
  autosaveBlocked,
  unreadableAutosave,
} = await import('../src/lib/autosave')
const { autosaveError, library, patchActiveSet, sets, tourStep, activeSetId } =
  await import('../src/stores')
const { replaceLibrary } = await import('../src/lib/persistence')

const LEGACY_KEY = 'visualise-dj-tracklists:project:v1'
const tracks = [track({ id: 'rb-1', title: 'One' }), track({ id: 'rb-2', title: 'Two' })]

function legacyProject(): string {
  const first = { ...freshFirstSet(['rb-1']), id: 'set-1', name: 'Legacy' }
  const project = {
    version: 10,
    libraryName: 'old.xml',
    tracks,
    criteria: {},
    filters: {},
    settings: {},
    sets: [first],
    manualEdges: [],
    activeSetId: 'set-1',
    playlists: [],
    radialAxis: 'bpm',
    colorAxis: 'auto',
    analysis: null,
  } as unknown as Project
  return serializeProject(project)
}

let storage: Map<string, string>
beforeEach(() => {
  db.clear()
  writes.length = 0
  failWrites = null
  storage = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  })
  autosaveBlocked.set(false)
  unreadableAutosave.set(null)
  autosaveError.set(null)
  tourStep.set(null)
  library.set([])
})
afterEach(() => vi.unstubAllGlobals())

describe('restoring the autosave', () => {
  test('a localStorage save moves into IndexedDB once, then leaves localStorage', async () => {
    storage.set(LEGACY_KEY, legacyProject())
    await restoreAutosave()
    expect(get(library).map((t) => t.id)).toEqual(['rb-1', 'rb-2'])
    expect(get(sets)[0].name).toBe('Legacy')
    expect(db.has('work') && db.has('library')).toBe(true)
    expect(storage.has(LEGACY_KEY)).toBe(false)
  })

  test('an unreadable localStorage save is kept where it is and never applied', async () => {
    storage.set(LEGACY_KEY, '{"version": 99}')
    await restoreAutosave()
    expect(get(library)).toEqual([])
    expect(storage.get(LEGACY_KEY)).toBe('{"version": 99}')
    expect(get(unreadableAutosave)).not.toBeNull()
  })

  test('IndexedDB wins over a leftover localStorage save', async () => {
    storage.set(LEGACY_KEY, legacyProject())
    replaceLibrary({ tracks: [track({ id: 'rb-9', title: 'Nine' })], name: 'new.xml' })
    await restoreAutosave() // migrates the legacy save first…
    replaceLibrary({ tracks: [track({ id: 'rb-9', title: 'Nine' })], name: 'new.xml' })
    await flushAutosave()
    storage.set(LEGACY_KEY, legacyProject()) // …a stale copy reappears
    library.set([])
    await restoreAutosave()
    expect(get(library).map((t) => t.id)).toEqual(['rb-9'])
  })

  test('an unreadable IndexedDB save is quarantined and survives later saves', async () => {
    db.set('work', '{"version": 99}')
    db.set('library', '{}')
    await restoreAutosave()
    const quarantined = () => JSON.parse(db.get('unreadable') as string) as { version: number }
    expect(quarantined().version).toBe(99)
    replaceLibrary({ tracks, name: 'fresh.xml' })
    await flushAutosave()
    expect(quarantined().version).toBe(99)
    expect(get(unreadableAutosave)).not.toBeNull()
  })
})

describe('saving', () => {
  beforeEach(async () => {
    await restoreAutosave()
    startAutosave()
    replaceLibrary({ tracks, name: 'c.xml' })
    await flushAutosave()
    writes.length = 0
  })

  test('a set edit rewrites only the small work record, not the library', async () => {
    patchActiveSet({ mustInclude: ['rb-1'] })
    await flushAutosave()
    expect(writes).toEqual([['work']])
  })

  test('nothing is written while the tour runs; its end is saved', async () => {
    tourStep.set(0)
    patchActiveSet({ mustInclude: ['rb-2'] })
    await flushAutosave()
    expect(writes).toEqual([])
    tourStep.set(null)
    await flushAutosave()
    expect(writes).toEqual([['work']])
  })

  test('a tab without the autosave lock writes nothing', async () => {
    autosaveBlocked.set(true)
    patchActiveSet({ mustInclude: ['rb-1'] })
    await flushAutosave()
    expect(writes).toEqual([])
  })

  test('a failed write says so, and the next good one clears it', async () => {
    failWrites = new DOMException('full', 'QuotaExceededError')
    patchActiveSet({ mustInclude: ['rb-1'] })
    await flushAutosave()
    expect(get(autosaveError)).toMatch(/out of storage/)
    failWrites = null
    await flushAutosave()
    expect(get(autosaveError)).toBeNull()
  })

  test('reset clears the saved project but keeps a quarantined one', async () => {
    db.set('unreadable', 'keep me')
    await clearAutosave()
    expect(db.has('work') || db.has('library')).toBe(false)
    expect(db.get('unreadable')).toBe('keep me')
    expect(get(activeSetId)).toBeTruthy()
  })

  test("a Reset in a tab without the lock leaves the other tab's save alone", async () => {
    autosaveBlocked.set(true)
    await clearAutosave()
    expect(db.has('work') && db.has('library')).toBe(true)
  })
})

describe('taking the autosave over from another tab', () => {
  test('steals the lock and loads the latest save in place, without a reload', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    const requests: unknown[] = []
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, options: unknown, grant: (lock: object | null) => unknown) => {
          requests.push(options)
          void grant({})
          return new Promise(() => {})
        },
      },
    })
    const { takeOverAutosave } = await import('../src/lib/autosave')
    // The other tab saved a library this tab has not seen.
    replaceLibrary({ tracks, name: 'other-tab.xml' })
    await flushAutosave()
    library.set([])
    autosaveBlocked.set(true)

    await takeOverAutosave()

    expect(requests.at(-1)).toEqual({ steal: true })
    expect(reload).not.toHaveBeenCalled()
    expect(get(autosaveBlocked)).toBe(false)
    expect(get(library).map((t) => t.id)).toEqual(['rb-1', 'rb-2'])
  })

  test('the first save after taking over rewrites both records', async () => {
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, _options: unknown, grant: (lock: object | null) => unknown) => {
          void grant({})
          return new Promise(() => {})
        },
      },
    })
    const { takeOverAutosave } = await import('../src/lib/autosave')
    replaceLibrary({ tracks, name: 'other-tab.xml' })
    await flushAutosave()
    autosaveBlocked.set(true)
    await takeOverAutosave()
    // The other tab may still land a write after this tab read the save; the
    // pair is only known to match once this tab has written both halves.
    writes.length = 0
    patchActiveSet({ mustInclude: ['rb-2'] })
    await flushAutosave()
    expect(writes).toEqual([['work', 'library']])
  })
})
