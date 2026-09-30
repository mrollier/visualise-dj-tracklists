import { get } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_FILTERS } from '../src/core/filter'
import { buildReport } from '../src/core/model'
import { freshFirstSet, type TrackSet } from '../src/core/sets'
import { ALL_SAMPLE_PACKS, CLASSIC_PACK, SAMPLE_COLLECTION } from '../src/data/samples'
import {
  applyProject,
  currentProject,
  hasUserWork,
  isSampleLibrary,
  loadSampleCollection,
  planLibraryImport,
  replaceLibrary,
  replaceNeedsConfirmation,
  resetEverything,
  sampleLoadNeedsConfirmation,
  updateLibrary,
} from '../src/lib/persistence'
import {
  activeSetId,
  addSet,
  analysis,
  filters,
  lastImportReport,
  library,
  libraryName,
  manualEdges,
  mustInclude,
  patchActiveSet,
  pinnedFirst,
  pinnedLast,
  playlists,
  renameSet,
  selectedId,
  sets,
  tracklist,
  visibleLibrary,
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
    marks: { starredOnly: false, comboOnly: false, constellationOnly: false },
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

  test('never exposes the new library to stale filters (the v37 import freeze)', () => {
    // Permissive filters left over from the old library: before v37 the new
    // tracks propagated through them (a full O(n²) combo pass) before the
    // playlist filter narrowed the wheel to empty.
    filters.set(structuredClone(EMPTY_FILTERS))
    const seen: number[] = []
    const unsubscribe = visibleLibrary.subscribe((tracks) => seen.push(tracks.length))
    const next = [track({ id: 'rb-7' }), track({ id: 'rb-8' }), track({ id: 'rb-9' })]
    replaceLibrary({
      tracks: next,
      name: 'collection.xml',
      playlists: [{ name: 'Warm-up', trackIds: ['rb-7'] }],
    })
    unsubscribe()
    // Playlists arrive with none selected, so the wheel ends empty — and no
    // intermediate emission may ever contain the full new library either.
    expect(seen.at(-1)).toBe(0)
    expect(seen).not.toContain(next.length)
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

describe('hasUserWork', () => {
  const marked = (patch: Partial<TrackSet>): TrackSet => ({ ...freshFirstSet(), ...patch })

  test('fresh state — one empty set, no marks or edges — is no user work', () => {
    expect(hasUserWork({ sets: [freshFirstSet()], manualEdges: [] })).toBe(false)
  })

  test('any set holding tracks is user work', () => {
    expect(hasUserWork({ sets: [freshFirstSet(['rb-1'])], manualEdges: [] })).toBe(true)
  })

  test('a manual edge is user work', () => {
    expect(hasUserWork({ sets: [freshFirstSet()], manualEdges: [{ a: 'rb-1', b: 'rb-2' }] })).toBe(
      true,
    )
  })

  test('a ★ or a pin on ANY set is user work, not just the active one', () => {
    for (const patch of [
      { mustInclude: ['rb-1'] },
      { pinnedFirst: 'rb-1' },
      { pinnedLast: 'rb-2' },
    ]) {
      expect(hasUserWork({ sets: [freshFirstSet(), marked(patch)], manualEdges: [] })).toBe(true)
    }
  })

  test('several empty sets are still no user work', () => {
    expect(
      hasUserWork({ sets: [freshFirstSet(), freshFirstSet(), freshFirstSet()], manualEdges: [] }),
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

describe('applyProject restores the marks with their flags', () => {
  test('the tour snapshot brings back each set’s marks and the active quick-filters', () => {
    patchActiveSet({ mustInclude: ['rb-1'], pinnedFirst: 'rb-2' })
    filters.update((f) => ({ ...f, marks: { ...f.marks, starredOnly: true } }))
    const snapshot = currentProject()
    patchActiveSet({ mustInclude: [], pinnedFirst: null })
    filters.update((f) => ({ ...f, marks: { ...f.marks, starredOnly: false } }))

    applyProject(snapshot)

    expect(get(mustInclude)).toEqual(['rb-1'])
    expect(get(pinnedFirst)).toBe('rb-2')
    expect(get(filters).marks.starredOnly).toBe(true)
  })

  test('the rest of the snapshot restores untouched', () => {
    filters.update((f) => ({ ...f, genres: ['techno'] }))
    const snapshot = currentProject()

    applyProject(snapshot)

    expect(get(filters).genres).toEqual(['techno'])
  })
})

describe('analysis sidecar lifecycle (v33)', () => {
  const sidecar = {
    zodiacAnalysis: 1 as const,
    run: null,
    tracks: { '/Users/dj/a.mp3': { bpm: 174 } },
  }

  test('replaceLibrary does NOT clear the sidecar', () => {
    // Track ids do not survive a re-import, which is why manualEdges are
    // cleared. File paths do survive, and a multi-hour batch is not
    // disposable — so the sidecar must outlive an XML re-import.
    analysis.set(sidecar)
    replaceLibrary({ tracks: [track({ id: 'new-1' })], name: 'fresh.xml' })

    expect(get(analysis)).toEqual(sidecar)
    expect(get(manualEdges)).toEqual([])
  })

  test('resetEverything DOES clear the sidecar', () => {
    analysis.set(sidecar)
    resetEverything()

    expect(get(analysis)).toBeNull()
  })

  test('currentProject carries the sidecar', () => {
    analysis.set(sidecar)

    expect(currentProject().analysis).toEqual(sidecar)
  })

  test('applyProject restores the sidecar', () => {
    analysis.set(sidecar)
    const saved = currentProject()
    analysis.set(null)

    applyProject(saved)
    expect(get(analysis)).toEqual(sidecar)
  })

  test('applyProject clears a stale sidecar when the project has none', () => {
    analysis.set(sidecar)
    applyProject({ ...currentProject(), analysis: null })

    expect(get(analysis)).toBeNull()
  })
})

describe('re-importing a collection updates it in place', () => {
  const coll = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      track({ id: `rb-${i}`, title: `T${i}`, location: `file://localhost/m/${i}.mp3` }),
    )
  const playlistsOf = (ids: string[]) => [{ name: 'A', trackIds: ids }]

  beforeEach(() => {
    const tracks = coll(10)
    replaceLibrary({ tracks, name: 'collection.xml', playlists: playlistsOf(['rb-0', 'rb-1']) })
    filters.update((f) => ({ ...f, playlists: ['A'], genres: ['techno'] }))
    tracklist.set(['rb-1', 'rb-2', 'rb-3'])
    renameSet(get(activeSetId), 'Friday warmup')
    addSet()
    tracklist.set(['rb-4', 'rb-5'])
    renameSet(get(activeSetId), 'Peak hour')
    patchActiveSet({ mustInclude: ['rb-5'] })
    manualEdges.set([{ a: 'rb-1', b: 'rb-9' }])
  })

  test('the same collection again keeps every set, mark, combo and the playlist selection', () => {
    const active = get(activeSetId)
    const plan = planLibraryImport(coll(10), playlistsOf(['rb-0', 'rb-1']))
    expect(plan.decision).toBe('update')
    updateLibrary(
      { tracks: coll(10), name: 'collection.xml', playlists: playlistsOf(['rb-0', 'rb-1']) },
      plan,
      buildReport(coll(10), []),
    )
    expect(get(sets).map((s) => `${s.name}:${s.trackIds.join(',')}`)).toEqual([
      'Friday warmup:rb-1,rb-2,rb-3',
      'Peak hour:rb-4,rb-5',
    ])
    expect(get(activeSetId)).toBe(active)
    expect(get(mustInclude)).toEqual(['rb-5'])
    expect(get(manualEdges)).toEqual([{ a: 'rb-1', b: 'rb-9' }])
    expect(get(filters).playlists).toEqual(['A'])
    expect(get(filters).genres).toEqual(['techno'])
    expect(get(lastImportReport)?.notes?.join(' ')).toMatch(/Updated in place/)
  })

  test('a newer export adds and drops tracks, and the report says so', () => {
    const next = [...coll(10).filter((t) => t.id !== 'rb-2'), ...coll(12).slice(10)]
    const plan = planLibraryImport(next, playlistsOf(['rb-0']))
    expect(plan.decision).toBe('confirm-update') // rb-2 sat in "Friday warmup"
    expect(plan.remapped.lost.titles).toEqual(['T2'])
    updateLibrary(
      { tracks: next, name: 'collection.xml', playlists: playlistsOf(['rb-0']) },
      plan,
      buildReport(next, []),
    )
    expect(get(sets)[0].trackIds).toEqual(['rb-1', 'rb-3'])
    expect(get(library)).toHaveLength(11)
    expect(get(lastImportReport)?.notes?.join(' ')).toMatch(/\+2 new · −1 gone/)
  })

  test('an unrelated collection is a replacement, confirmed first', () => {
    const other = Array.from({ length: 5 }, (_, i) =>
      track({ id: `rb-${i}`, title: `Other ${i}`, location: `file://localhost/o/${i}.mp3` }),
    )
    expect(planLibraryImport(other, []).decision).toBe('confirm-replace')
  })

  test('the library is cleared before the new tracks arrive', () => {
    const seen: number[] = []
    const stop = library.subscribe((l) => seen.push(l.length))
    const plan = planLibraryImport(coll(10), [])
    updateLibrary({ tracks: coll(10), name: 'c.xml', playlists: [] }, plan, buildReport([], []))
    stop()
    expect(seen.slice(-2)).toEqual([0, 10])
  })
})
