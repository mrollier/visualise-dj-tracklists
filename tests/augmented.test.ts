import { get } from 'svelte/store'
import { afterEach, describe, expect, test } from 'vitest'
import type { AnalysisSidecar } from '../src/core/analysis'
import { exportTracklistCsv } from '../src/core/exporters/csv'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import {
  analysedFieldsById,
  analysis,
  augmentedLibrary,
  augmentedTrackById,
  library,
  settings,
  trackById,
  visibleLibrary,
} from '../src/stores'
import { track } from './helpers'

/**
 * The derived layer that joins the analysis sidecar onto the library (v33
 * WS1). Raw `library` keeps feeding persistence, the importers and the CSV
 * exporter untouched — the same shape as the easy-mode `effective*` layer.
 */

function sidecar(tracks: AnalysisSidecar['tracks']): AnalysisSidecar {
  return { zodiacAnalysis: 1, run: null, tracks }
}

afterEach(() => {
  library.set([])
  analysis.set(null)
})

describe('augmentedLibrary (v33)', () => {
  test('fills a null BPM without touching the raw library', () => {
    const raw = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    library.set(raw)
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(get(augmentedLibrary)[0].bpm).toBe(174)
    expect(get(library)[0].bpm).toBeNull()
  })

  test('never replaces a Rekordbox value', () => {
    library.set([track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', bpm: 128 })])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(get(augmentedLibrary)[0].bpm).toBe(128)
  })

  test('is the raw library by reference when no sidecar is loaded', () => {
    const raw = [track({ id: 'a' })]
    library.set(raw)

    expect(get(augmentedLibrary)).toBe(raw)
  })

  test('is the raw library by reference when the sidecar fills nothing', () => {
    const raw = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', bpm: 128 })]
    library.set(raw)
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(get(augmentedLibrary)).toBe(raw)
  })

  test('recomputes when the sidecar arrives', () => {
    library.set([track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })])
    expect(get(augmentedLibrary)[0].bpm).toBeNull()

    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))
    expect(get(augmentedLibrary)[0].bpm).toBe(174)
  })

  test('a filled key reaches visibleLibrary, so the wheel can place the track', () => {
    library.set([track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { key: '8A' } }))

    expect(get(visibleLibrary)[0].key).toBe('8A')
  })
})

describe('analysedFieldsById (v33)', () => {
  test('reports which fields analysis supplied', () => {
    library.set([track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174, key: '8A' } }))

    expect(get(analysedFieldsById).get('a')).toEqual(new Set(['bpm', 'key']))
  })

  test('says nothing about a track whose values all came from Rekordbox', () => {
    library.set([
      track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', bpm: 128, key: '8A' }),
    ])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174, key: '3A' } }))

    expect(get(analysedFieldsById).size).toBe(0)
  })
})

describe('the exports still carry Rekordbox truth (v33)', () => {
  test('trackById stays raw, so a CSV export cannot launder analysed values', () => {
    // The CSV exporter resolves through trackById, and the app also IMPORTS
    // CSV — so an augmented trackById would make "export, re-import" write
    // analysed values into the library as Rekordbox-looking truth, in two
    // clicks and irreversibly.
    library.set([track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174, key: '8A' } }))

    expect(get(trackById).get('a')?.bpm).toBeNull()
    expect(get(trackById).get('a')?.key).toBeNull()
    // ...while the display map does carry them.
    expect(get(augmentedTrackById).get('a')?.bpm).toBe(174)
  })

  test('the CSV export writes the raw values', () => {
    library.set([track({ id: 'a', title: 'A', location: 'file://localhost/Users/dj/a.mp3' })])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { bpm: 174, key: '8A' } }))

    const rows = [...get(trackById).values()]
    const csv = exportTracklistCsv(rows)

    expect(csv).not.toContain('174')
    expect(csv).not.toContain('8A')
  })
})

describe('key/BPM source preference (v36)', () => {
  afterEach(() => {
    settings.set(structuredClone(DEFAULT_SETTINGS))
  })

  test('comments as key source substitutes live, raw library untouched', () => {
    library.set([track({ id: 'a', key: '8A', comments: '10A - 7' })])

    settings.update((s) => ({ ...s, keySource: 'comments' }))
    expect(get(augmentedLibrary)[0].key).toBe('10A')
    expect(get(library)[0].key).toBe('8A')

    settings.update((s) => ({ ...s, keySource: 'rekordbox' }))
    expect(get(augmentedLibrary)[0].key).toBe('8A')
  })

  test('a comment without the token keeps the Rekordbox value', () => {
    library.set([track({ id: 'a', key: '8A', bpm: 128.5, comments: 'Energy 7' })])
    settings.update((s) => ({ ...s, keySource: 'comments', bpmSource: 'comments' }))

    expect(get(augmentedLibrary)[0].key).toBe('8A')
    expect(get(augmentedLibrary)[0].bpm).toBe(128.5)
  })

  test('the sidecar still fills what neither comment nor Rekordbox has', () => {
    library.set([
      track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', comments: 'Energy 7' }),
    ])
    analysis.set(sidecar({ '/Users/dj/a.mp3': { key: '3A' } }))
    settings.update((s) => ({ ...s, keySource: 'comments' }))

    expect(get(augmentedLibrary)[0].key).toBe('3A')
  })

  test('unrelated settings churn never re-emits the augmented library', () => {
    library.set([track({ id: 'a', key: '8A', comments: '10A - 7' })])
    settings.update((s) => ({ ...s, keySource: 'comments' }))

    let emits = 0
    const unsubscribe = augmentedLibrary.subscribe(() => {
      emits += 1
    })
    const afterSubscribe = emits // the initial synchronous push on subscribe
    settings.update((s) => ({ ...s, edgeOpacity: 0.5 }))
    expect(emits).toBe(afterSubscribe)
    unsubscribe()
  })

  test('comments mode with nothing parsable is the raw library by reference', () => {
    const raw = [track({ id: 'a', key: '8A', comments: 'great closer' })]
    library.set(raw)
    settings.update((s) => ({ ...s, keySource: 'comments', bpmSource: 'comments' }))

    expect(get(augmentedLibrary)).toBe(raw)
  })
})
