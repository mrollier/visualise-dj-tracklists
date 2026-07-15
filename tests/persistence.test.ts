import { get } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_FILTERS } from '../src/core/filter'
import type { Track } from '../src/core/model'
import { ALL_SAMPLE_PACKS } from '../src/data/samples'
import {
  isSampleLibrary,
  loadSamplePack,
  replaceLibrary,
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
  suggestionHistory,
  suggestionIndex,
  tracklist,
} from '../src/stores'

function track(id: string): Track {
  return {
    id,
    title: id,
    artist: null,
    key: null,
    bpm: null,
    genre: null,
    year: null,
    rating: null,
    durationSec: null,
    location: null,
  }
}

const REPORT = { total: 1, missing: { key: 1, bpm: 1, genre: 1, year: 1, rating: 1 }, errors: [] }

// resetEverything touches localStorage; the node test environment has none.
vi.stubGlobal('localStorage', { removeItem: () => {}, getItem: () => null, setItem: () => {} })

beforeEach(() => {
  library.set([track('rb-1'), track('rb-2')])
  libraryName.set('old.xml')
  tracklist.set(['rb-1'])
  playlists.set([{ name: 'Old list', trackIds: ['rb-1'] }])
  filters.set({ bpm: [100, 120], year: null, rating: [3, 5], genres: ['techno'], playlists: [] })
  selectedId.set('rb-1')
  suggestionHistory.set([['rb-1', 'rb-2']])
  suggestionIndex.set(0)
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

  test('clears selection, suggestion history and pins', () => {
    replaceLibrary({ tracks: [track('csv-0')], name: 'new.csv' })
    expect(get(selectedId)).toBeNull()
    expect(get(suggestionHistory)).toEqual([])
    expect(get(suggestionIndex)).toBe(-1)
    expect(get(pinnedFirst)).toBeNull()
  })

  test('clears the previous import report when none is given', () => {
    replaceLibrary({ tracks: [track('csv-0')], name: 'new.csv' })
    expect(get(lastImportReport)).toBeNull()
  })
})

describe('loadSamplePack', () => {
  test('goes through replaceLibrary: filters and session state reset', () => {
    const pack = ALL_SAMPLE_PACKS[1]
    loadSamplePack(pack)
    expect(get(libraryName)).toBe(`${pack.name} (sample)`)
    expect(get(tracklist)).toEqual(pack.set)
    expect(get(filters)).toEqual(EMPTY_FILTERS)
    expect(get(suggestionHistory)).toEqual([])
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
