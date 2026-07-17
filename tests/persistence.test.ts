import { get } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_FILTERS } from '../src/core/filter'
import { EMPTY_TRACK_FIELDS, type Track } from '../src/core/model'
import { ALL_SAMPLE_PACKS, SAMPLE_COLLECTION } from '../src/data/samples'
import {
  isSampleLibrary,
  loadSampleCollection,
  replaceLibrary,
  replaceNeedsConfirmation,
  resetEverything,
} from '../src/lib/persistence'
import {
  filters,
  lastImportReport,
  library,
  libraryName,
  pinnedFirst,
  playlists,
  selectedId,
  tracklist,
} from '../src/stores'

function track(id: string): Track {
  return { ...EMPTY_TRACK_FIELDS, id, title: id }
}

const REPORT = { total: 1, missing: { key: 1, bpm: 1, genre: 1, year: 1, rating: 1 }, errors: [] }

// resetEverything touches localStorage; the node test environment has none.
vi.stubGlobal('localStorage', { removeItem: () => {}, getItem: () => null, setItem: () => {} })

beforeEach(() => {
  library.set([track('rb-1'), track('rb-2')])
  libraryName.set('old.xml')
  tracklist.set(['rb-1'])
  playlists.set([{ name: 'Old list', trackIds: ['rb-1'] }])
  filters.set({
    bpm: [100, 120],
    year: null,
    rating: [3, 5],
    dateAdded: null,
    genres: ['techno'],
    playlists: [],
    keyRing: 'both',
  })
  selectedId.set('rb-1')
  pinnedFirst.set('rb-1')
  lastImportReport.set(REPORT)
})

describe('replaceLibrary', () => {
  test('replaces library, name, set and report in one go', () => {
    const next = [track('csv-0')]
    replaceLibrary({ tracks: next, name: 'new.csv', set: ['csv-0'], report: REPORT })
    expect(get(library)).toEqual(next)
    expect(get(libraryName)).toBe('new.csv')
    expect(get(tracklist)).toEqual(['csv-0'])
    expect(get(lastImportReport)).toEqual(REPORT)
  })

  test('resets stale filters from the previous library', () => {
    replaceLibrary({ tracks: [track('csv-0')], name: 'new.csv' })
    expect(get(filters)).toEqual(EMPTY_FILTERS)
  })

  test('a collection with playlists starts with none selected (empty wheel)', () => {
    replaceLibrary({
      tracks: [track('rb-9')],
      name: 'collection.xml',
      playlists: [{ name: 'Warm-up', trackIds: ['rb-9'] }],
    })
    expect(get(filters).playlists).toEqual([])
    expect(get(playlists)).toEqual([{ name: 'Warm-up', trackIds: ['rb-9'] }])
  })

  test('clears selection and pins', () => {
    replaceLibrary({ tracks: [track('csv-0')], name: 'new.csv' })
    expect(get(selectedId)).toBeNull()
    expect(get(pinnedFirst)).toBeNull()
  })

  test('clears the previous import report when none is given', () => {
    replaceLibrary({ tracks: [track('csv-0')], name: 'new.csv' })
    expect(get(lastImportReport)).toBeNull()
  })
})

describe('loadSampleCollection', () => {
  test('loads all packs as playlists and behaves like an XML import', () => {
    loadSampleCollection()
    expect(get(libraryName)).toBe('Sample collection')
    expect(get(library)).toEqual(SAMPLE_COLLECTION.tracks)
    expect(get(playlists)).toEqual(SAMPLE_COLLECTION.playlists)
    // Nothing selected yet: empty wheel until playlists are toggled on.
    expect(get(filters).playlists).toEqual([])
    expect(get(tracklist)).toEqual([])
    expect(isSampleLibrary(get(library))).toBe(true)
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

describe('isSampleLibrary', () => {
  test('recognises themed pack tracks by their id prefix', () => {
    expect(isSampleLibrary(ALL_SAMPLE_PACKS[1].tracks)).toBe(true)
  })

  test('recognises the classic demo tracks', () => {
    expect(isSampleLibrary(ALL_SAMPLE_PACKS[0].tracks)).toBe(true)
  })

  test('a user library is never a sample, whatever its name says', () => {
    expect(isSampleLibrary([track('rb-1')])).toBe(false)
    expect(isSampleLibrary([track('csv-0')])).toBe(false)
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
      tracks: [track('txt-0')],
      name: 'set.txt',
      playlists: [{ name: 'set', trackIds: ['txt-0'] }],
      selectedPlaylists: ['set'],
    })
    expect(get(filters).playlists).toEqual(['set'])
  })

  test('without it, playlists still start unselected (unchanged default)', () => {
    replaceLibrary({
      tracks: [track('rb-1')],
      name: 'coll.xml',
      playlists: [{ name: 'A', trackIds: ['rb-1'] }],
    })
    expect(get(filters).playlists).toEqual([])
  })
})
