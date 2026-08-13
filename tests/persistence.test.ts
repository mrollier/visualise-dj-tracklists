import { get } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_FILTERS } from '../src/core/filter'
import { freshFirstSet } from '../src/core/sets'
import { ALL_SAMPLE_PACKS, CLASSIC_PACK, SAMPLE_COLLECTION } from '../src/data/samples'
import {
  hasUserWork,
  isSampleLibrary,
  loadSampleCollection,
  replaceLibrary,
  replaceNeedsConfirmation,
  resetEverything,
  sampleLoadNeedsConfirmation,
} from '../src/lib/persistence'
import {
  filters,
  lastImportReport,
  library,
  libraryName,
  manualEdges,
  mustInclude,
  pinnedFirst,
  pinnedLast,
  playlists,
  selectedId,
  tracklist,
} from '../src/stores'
import { track } from './helpers'

const REPORT = { total: 1, missing: { key: 1, bpm: 1, genre: 1, year: 1, rating: 1 }, errors: [] }

// resetEverything touches localStorage; the node test environment has none.
vi.stubGlobal('localStorage', { removeItem: () => {}, getItem: () => null, setItem: () => {} })

beforeEach(() => {
  library.set([track({ id: 'rb-1' }), track({ id: 'rb-2' })])
  libraryName.set('old.xml')
  tracklist.set(['rb-1'])
  playlists.set([{ name: 'Old list', trackIds: ['rb-1'] }])
  filters.set({
    properties: { bpm: [100, 120], rating: [3, 5] },
    genres: ['techno'],
    playlists: [],
    keyRings: { minor: true, major: true },
  })
  selectedId.set('rb-1')
  pinnedFirst.set('rb-1')
  lastImportReport.set(REPORT)
})

describe('replaceLibrary', () => {
  test('replaces library, name, set and report in one go', () => {
    const next = [track({ id: 'csv-0' })]
    replaceLibrary({ tracks: next, name: 'new.csv', set: ['csv-0'], report: REPORT })
    expect(get(library)).toEqual(next)
    expect(get(libraryName)).toBe('new.csv')
    expect(get(tracklist)).toEqual(['csv-0'])
    expect(get(lastImportReport)).toEqual(REPORT)
  })

  test('resets stale filters from the previous library', () => {
    replaceLibrary({ tracks: [track({ id: 'csv-0' })], name: 'new.csv' })
    expect(get(filters)).toEqual(EMPTY_FILTERS)
  })

  test('a collection with playlists starts with none selected (empty wheel)', () => {
    replaceLibrary({
      tracks: [track({ id: 'rb-9' })],
      name: 'collection.xml',
      playlists: [{ name: 'Warm-up', trackIds: ['rb-9'] }],
    })
    expect(get(filters).playlists).toEqual([])
    expect(get(playlists)).toEqual([{ name: 'Warm-up', trackIds: ['rb-9'] }])
  })

  test('clears selection and pins', () => {
    replaceLibrary({ tracks: [track({ id: 'csv-0' })], name: 'new.csv' })
    expect(get(selectedId)).toBeNull()
    expect(get(pinnedFirst)).toBeNull()
  })

  test('clears the previous import report when none is given', () => {
    replaceLibrary({ tracks: [track({ id: 'csv-0' })], name: 'new.csv' })
    expect(get(lastImportReport)).toBeNull()
  })
})

describe('loadSampleCollection', () => {
  test('loads all packs as playlists, Classic demo pre-selected (v14 WS3 D2)', () => {
    loadSampleCollection()
    expect(get(libraryName)).toBe('Sample collection')
    expect(get(library)).toEqual(SAMPLE_COLLECTION.tracks)
    expect(get(playlists)).toEqual(SAMPLE_COLLECTION.playlists)
    // The Classic demo pack starts toggled on so the wheel isn't empty the
    // moment the sample loads; every other pack still starts off.
    expect(get(filters).playlists).toEqual([CLASSIC_PACK.name])
    expect(get(tracklist)).toEqual([])
    expect(isSampleLibrary(get(library))).toBe(true)
  })

  test('raises an import report so the status ⓘ appears (v11 issue 4)', () => {
    loadSampleCollection()
    const report = get(lastImportReport)
    expect(report).not.toBeNull()
    expect(report?.total).toBe(SAMPLE_COLLECTION.tracks.length)
    expect(report?.notes?.join(' ')).toContain(`${SAMPLE_COLLECTION.playlists.length} themed`)
  })
})

describe('replaceNeedsConfirmation', () => {
  test('user work needs a confirmation before being replaced', () => {
    // the beforeEach loads a user library ('rb-…' ids)
    expect(replaceNeedsConfirmation()).toBe(true)
  })

  test('an empty library is replaced silently', () => {
    library.set([])
    expect(replaceNeedsConfirmation()).toBe(false)
  })

  test('a sample library is disposable and replaced silently', () => {
    loadSampleCollection()
    expect(replaceNeedsConfirmation()).toBe(false)
  })
})

describe('hasUserWork (v18 #1)', () => {
  test('fresh state — one empty set, no marks/edges/pins — is no user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet()],
        manualEdges: [],
        mustInclude: [],
        pinnedFirst: null,
        pinnedLast: null,
      }),
    ).toBe(false)
  })

  test('any set holding tracks is user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet(['rb-1'])],
        manualEdges: [],
        mustInclude: [],
        pinnedFirst: null,
        pinnedLast: null,
      }),
    ).toBe(true)
  })

  test('a manual edge is user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet()],
        manualEdges: [{ a: 'rb-1', b: 'rb-2' }],
        mustInclude: [],
        pinnedFirst: null,
        pinnedLast: null,
      }),
    ).toBe(true)
  })

  test('a must-include mark is user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet()],
        manualEdges: [],
        mustInclude: ['rb-1'],
        pinnedFirst: null,
        pinnedLast: null,
      }),
    ).toBe(true)
  })

  test('a pinned opener is user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet()],
        manualEdges: [],
        mustInclude: [],
        pinnedFirst: 'rb-1',
        pinnedLast: null,
      }),
    ).toBe(true)
  })

  test('a pinned closer is user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet()],
        manualEdges: [],
        mustInclude: [],
        pinnedFirst: null,
        pinnedLast: 'rb-2',
      }),
    ).toBe(true)
  })

  test('several empty sets are still no user work', () => {
    expect(
      hasUserWork({
        sets: [freshFirstSet(), freshFirstSet(), freshFirstSet()],
        manualEdges: [],
        mustInclude: [],
        pinnedFirst: null,
        pinnedLast: null,
      }),
    ).toBe(false)
  })
})

describe('sampleLoadNeedsConfirmation (v18 #1)', () => {
  test('a real library needs confirmation, same as replaceNeedsConfirmation', () => {
    // the beforeEach loads a user library ('rb-…' ids)
    expect(sampleLoadNeedsConfirmation()).toBe(true)
  })

  test('a real library alone needs confirmation, with zero user work (isolates the OR)', () => {
    // The beforeEach also leaves hasUserWork() true (tracklist ['rb-1'],
    // pinnedFirst 'rb-1'), so the test above never isolates which half of
    // the OR is doing the work. Clear every user-work signal here so only
    // replaceNeedsConfirmation() can be making this true — dropping that
    // half of the OR (e.g. "refactoring" to hasUserWork(...) alone) would
    // turn this false and fail.
    tracklist.set([])
    mustInclude.set([])
    pinnedFirst.set(null)
    pinnedLast.set(null)
    manualEdges.set([])
    expect(sampleLoadNeedsConfirmation()).toBe(true)
  })

  test('a virgin sample with no user work needs no confirmation', () => {
    loadSampleCollection()
    expect(sampleLoadNeedsConfirmation()).toBe(false)
  })

  test('user work over the sample still needs confirmation (the bug this fixes)', () => {
    // loading the sample first clears sets/edges/pins (replaceLibrary), so
    // this isolates "user work over an already-loaded sample" — previously
    // this replaced silently, wiping the mark for good.
    loadSampleCollection()
    mustInclude.set(['rb-1'])
    expect(sampleLoadNeedsConfirmation()).toBe(true)
  })
})

describe('isSampleLibrary', () => {
  test('recognises themed pack tracks by their id prefix', () => {
    expect(isSampleLibrary(ALL_SAMPLE_PACKS[1].tracks)).toBe(true)
  })

  test('recognises the classic demo tracks', () => {
    expect(isSampleLibrary(ALL_SAMPLE_PACKS[0].tracks)).toBe(true)
  })

  test('a user library is never a sample, whatever its name says', () => {
    expect(isSampleLibrary([track({ id: 'rb-1' })])).toBe(false)
    expect(isSampleLibrary([track({ id: 'csv-0' })])).toBe(false)
  })

  test('an empty library is not a sample', () => {
    expect(isSampleLibrary([])).toBe(false)
  })
})

describe('resetEverything', () => {
  test('clears the import report along with the rest', () => {
    resetEverything()
    expect(get(library)).toEqual([])
    expect(get(lastImportReport)).toBeNull()
    expect(get(filters)).toEqual(EMPTY_FILTERS)
  })
})

describe('replaceLibrary with selectedPlaylists', () => {
  test('pre-selects the given playlists instead of starting empty', () => {
    replaceLibrary({
      tracks: [track({ id: 'txt-0' })],
      name: 'set.txt',
      playlists: [{ name: 'set', trackIds: ['txt-0'] }],
      selectedPlaylists: ['set'],
    })
    expect(get(filters).playlists).toEqual(['set'])
  })

  test('without it, playlists still start unselected (unchanged default)', () => {
    replaceLibrary({
      tracks: [track({ id: 'rb-1' })],
      name: 'coll.xml',
      playlists: [{ name: 'A', trackIds: ['rb-1'] }],
    })
    expect(get(filters).playlists).toEqual([])
  })
})
