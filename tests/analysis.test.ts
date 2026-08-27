import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  percentFromAffect,
  percentFromUnit,
  mergeAnalysis,
  sanitizeAnalysis,
  summariseAnalysisImport,
  type AnalysisSidecar,
} from '../src/core/analysis'
import { SAMPLE_COLLECTION } from '../src/data/samples'
import { track } from './helpers'

/**
 * The analysis provenance layer (v33 WS1). Analysed values fill metadata
 * Rekordbox left null and never replace metadata it supplied.
 */

function sidecar(tracks: AnalysisSidecar['tracks']): AnalysisSidecar {
  return { zodiacAnalysis: 1, run: null, tracks }
}

describe('mergeAnalysis — the never-overwrite invariant (v33)', () => {
  test('a Rekordbox BPM is never replaced by an analysed one', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', bpm: 128 })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBe(128)
  })

  test('a null BPM is filled, and marked as analysed', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBe(174)
    expect(merged.analysedFields.get('a')).toEqual(new Set(['bpm']))
  })

  test('a Rekordbox key is never replaced, while a null key beside it is filled', () => {
    const tracks = [
      track({ id: 'keyed', location: 'file://localhost/Users/dj/keyed.mp3', key: '8A' }),
      track({ id: 'bare', location: 'file://localhost/Users/dj/bare.mp3' }),
    ]
    const merged = mergeAnalysis(
      tracks,
      sidecar({
        '/Users/dj/keyed.mp3': { key: '3A' },
        '/Users/dj/bare.mp3': { key: '3A' },
      }),
    )

    expect(merged.tracks[0].key).toBe('8A')
    expect(merged.analysedFields.has('keyed')).toBe(false)
    expect(merged.tracks[1].key).toBe('3A')
    expect(merged.analysedFields.get('bare')).toEqual(new Set(['key']))
  })

  test('a below-confidence BPM is left null rather than guessed', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174, bpmConf: 0.2 } }))

    expect(merged.tracks[0].bpm).toBeNull()
    expect(merged.analysedFields.has('a')).toBe(false)
  })

  test('a below-confidence key is left null rather than guessed', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(
      tracks,
      sidecar({ '/Users/dj/a.mp3': { key: '3A', keyConf: 0.1 } }),
    )

    expect(merged.tracks[0].key).toBeNull()
  })

  test('a confident value still fills', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(
      tracks,
      sidecar({ '/Users/dj/a.mp3': { bpm: 174, bpmConf: 0.95 } }),
    )

    expect(merged.tracks[0].bpm).toBe(174)
  })

  test('the raw track objects are not mutated', () => {
    const original = track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })
    const tracks = [original]
    mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(original.bpm).toBeNull()
  })
})

describe('mergeAnalysis — matching (v33)', () => {
  test('matches on path suffix, so a moved library still resolves', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Volumes/new/House/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/old/House/a.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBe(174)
  })

  test('percent-encoding on the track side is decoded before matching', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a%20b.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a b.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBe(174)
  })

  test('a sidecar key is NOT decoded a second time', () => {
    // A file whose real name contains a literal '%20'. Decoding the sidecar
    // key would fold it onto 'a b.mp3' and match the wrong track.
    const tracks = [track({ id: 'space', location: 'file://localhost/Users/dj/a%20b.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a%20b.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBeNull()
  })

  test('an ambiguous basename is refused, never guessed', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/x/a.mp3' })]
    const merged = mergeAnalysis(
      tracks,
      sidecar({ '/one/a.mp3': { bpm: 100 }, '/two/a.mp3': { bpm: 174 } }),
    )

    expect(merged.tracks[0].bpm).toBeNull()
    expect(merged.analysedFields.size).toBe(0)
  })

  test('a track the sidecar does not mention is untouched', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/other.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBeNull()
  })

  test('a track with no location is a miss by definition', () => {
    const tracks = [track({ id: 'a', location: null })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBeNull()
  })

  test('case and unicode form are folded, as macOS hands them over in NFD', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/Café.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/café.mp3': { bpm: 174 } }))

    expect(merged.tracks[0].bpm).toBe(174)
  })
})

describe('mergeAnalysis — identity stability (v33)', () => {
  test('returns the same array reference when nothing is filled', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', bpm: 128 })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(merged.tracks).toBe(tracks)
  })

  test('returns the same array reference for a null sidecar', () => {
    const tracks = [track({ id: 'a' })]

    expect(mergeAnalysis(tracks, null).tracks).toBe(tracks)
  })

  test('returns a new array once something is filled', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { bpm: 174 } }))

    expect(merged.tracks).not.toBe(tracks)
  })
})

describe('sanitizeAnalysis (v33)', () => {
  const good = {
    zodiacAnalysis: 1,
    run: { analysedAt: '2026-08-25', tool: 'essentia-tensorflow 2.1b6', models: ['musicnn'] },
    tracks: { '/Users/dj/a.mp3': { bpm: 128.02, bpmConf: 0.93, key: '8A', arousal: 7.1 } },
  }

  test('accepts a well-formed sidecar', () => {
    const parsed = sanitizeAnalysis(good)

    expect(parsed?.zodiacAnalysis).toBe(1)
    expect(parsed?.tracks['/Users/dj/a.mp3']).toEqual({
      bpm: 128.02,
      bpmConf: 0.93,
      key: '8A',
      keyConf: null,
      arousal: 7.1,
      valence: null,
      happiness: null,
      danceability: null,
    })
  })

  test('rejects anything that is not a sidecar', () => {
    expect(sanitizeAnalysis(null)).toBeNull()
    expect(sanitizeAnalysis(undefined)).toBeNull()
    expect(sanitizeAnalysis('a string')).toBeNull()
    expect(sanitizeAnalysis([])).toBeNull()
    expect(sanitizeAnalysis({})).toBeNull()
    expect(sanitizeAnalysis({ zodiacAnalysis: 2, tracks: {} })).toBeNull()
  })

  test('an array of tracks does not become an object with numeric keys', () => {
    const parsed = sanitizeAnalysis({ ...good, tracks: [{ bpm: 128 }] })

    expect(parsed).toBeNull()
  })

  test('a wrong-typed field drops to null rather than leaking through', () => {
    const parsed = sanitizeAnalysis({
      ...good,
      tracks: { '/Users/dj/a.mp3': { bpm: '128', key: 42, arousal: Infinity } },
    })

    expect(parsed?.tracks['/Users/dj/a.mp3']).toEqual({
      bpm: null,
      bpmConf: null,
      key: null,
      keyConf: null,
      arousal: null,
      valence: null,
      happiness: null,
      danceability: null,
    })
  })

  test('a non-record entry is dropped, and its neighbours survive', () => {
    const parsed = sanitizeAnalysis({
      ...good,
      tracks: { '/Users/dj/bad.mp3': 'nonsense', '/Users/dj/a.mp3': { bpm: 128 } },
    })

    expect(Object.keys(parsed?.tracks ?? {})).toEqual(['/Users/dj/a.mp3'])
  })

  test('an empty path key is dropped — it can never match a track', () => {
    const parsed = sanitizeAnalysis({ ...good, tracks: { '': { bpm: 128 } } })

    expect(parsed?.tracks).toEqual({})
  })

  test('a missing or malformed run block becomes null rather than failing', () => {
    expect(sanitizeAnalysis({ ...good, run: undefined })?.run).toBeNull()
    expect(sanitizeAnalysis({ ...good, run: 'yesterday' })?.run).toBeNull()
    expect(sanitizeAnalysis({ ...good, run: { models: 'musicnn' } })?.run).toEqual({
      analysedAt: null,
      tool: null,
      models: [],
    })
  })

  test('a sanitized sidecar round-trips through JSON unchanged', () => {
    const once = sanitizeAnalysis(good)
    const twice = sanitizeAnalysis(JSON.parse(JSON.stringify(once)))

    expect(twice).toEqual(once)
  })
})

describe('energy comes only from Comments (v36)', () => {
  test('the merge never invents an energy, whatever the sidecar carries', () => {
    // The arousal-derived fallback was removed in v36: against the 18 anchor
    // labels the Mixed In Key comment token outperformed it, and an honest
    // null beats an inferior estimate.
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { arousal: 9 } }))

    expect(merged.tracks[0].energy).toBeNull()
    expect(merged.analysedFields.get('a')?.has('arousal')).toBe(true)
  })

  test('a Mixed In Key tag in Comments passes through the merge untouched', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', energy: 5 })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { arousal: 9 } }))

    expect(merged.tracks[0].energy).toBe(5)
  })
})

describe('summariseAnalysisImport (v33)', () => {
  test('counts what was filled, and what could not be', () => {
    const tracks = [
      track({ id: 'fill', location: 'file://localhost/Users/dj/fill.mp3' }),
      track({ id: 'kept', location: 'file://localhost/Users/dj/kept.mp3', bpm: 128 }),
      track({ id: 'shy', location: 'file://localhost/Users/dj/shy.mp3' }),
      track({ id: 'gone', location: 'file://localhost/Users/dj/gone.mp3' }),
      track({ id: 'nowhere', location: null }),
    ]
    const summary = summariseAnalysisImport(
      tracks,
      sidecar({
        '/Users/dj/fill.mp3': { bpm: 174, key: '8A', arousal: 9 },
        '/Users/dj/kept.mp3': { bpm: 174 },
        '/Users/dj/shy.mp3': { bpm: 174, bpmConf: 0.1 },
      }),
    )

    expect(summary).toMatchObject({
      bpmFilled: 1,
      bpmMissing: 4,
      keyFilled: 1,
      notFound: 2,
      belowConfidence: 1,
    })
  })

  test('reads as a sentence for the import report', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const summary = summariseAnalysisImport(
      tracks,
      sidecar({ '/Users/dj/a.mp3': { bpm: 174, arousal: 9 } }),
    )

    expect(summary.note).toBe('BPM filled 1/1, key 0/1, descriptors 1 track')
  })

  test('names the refusals rather than swallowing them', () => {
    const tracks = [
      track({ id: 'shy', location: 'file://localhost/Users/dj/shy.mp3' }),
      track({ id: 'gone', location: 'file://localhost/Users/dj/gone.mp3' }),
    ]
    const summary = summariseAnalysisImport(
      tracks,
      sidecar({ '/Users/dj/shy.mp3': { bpm: 174, bpmConf: 0.1 } }),
    )

    expect(summary.note).toBe(
      'BPM filled 0/2, key 0/2, descriptors 0 tracks; 1 below confidence, 1 not found',
    )
  })

  test('an ambiguous match is reported, not silently dropped', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/x/a.mp3' })]
    const summary = summariseAnalysisImport(
      tracks,
      sidecar({ '/one/a.mp3': { bpm: 100 }, '/two/a.mp3': { bpm: 174 } }),
    )

    expect(summary.ambiguous).toBe(1)
    expect(summary.note).toContain('1 ambiguous')
  })
})

describe('the sample-collection fixture (v33)', () => {
  // Guards the hand-written sidecar against sample-data drift: enrichTrack
  // generates the locations it is keyed on, so a change there would silently
  // stop the acceptance demo working.
  const sidecar = sanitizeAnalysis(
    JSON.parse(readFileSync('tests/fixtures/sample-analysis.json', 'utf8')) as unknown,
  )

  test('is a valid sidecar', () => {
    expect(sidecar).not.toBeNull()
  })

  test('fills every gap in the sample collection except the uncertain one', () => {
    const summary = summariseAnalysisImport(SAMPLE_COLLECTION.tracks, sidecar as AnalysisSidecar)

    expect(summary.bpmFilled).toBe(3)
    expect(summary.bpmMissing).toBe(3)
    // Four of the five keyless tracks fill; "Found Tape" carries keyConf 0.18
    // and is refused, which is the point of including it.
    expect(summary.keyFilled).toBe(4)
    expect(summary.keyMissing).toBe(5)
    expect(summary.belowConfidence).toBe(1)
  })

  test('never touches energy — comments are its only source (v36)', () => {
    const { tracks } = mergeAnalysis(SAMPLE_COLLECTION.tracks, sidecar)

    const before = SAMPLE_COLLECTION.tracks.map((t) => t.energy)
    expect(tracks.map((t) => t.energy)).toEqual(before)
  })
})

describe('the descriptor percent scales (v35)', () => {
  test('the nominal 1-9 affect range maps onto the ends of the percent scale', () => {
    expect(percentFromAffect(1)).toBe(0)
    expect(percentFromAffect(9)).toBe(100)
    expect(percentFromAffect(5)).toBe(50)
  })

  test('the nominal range is used, so the model shrinking to its mean stays visible', () => {
    // Deliberately NOT an eyeballed observed band. The
    // emoMusic head barely leaves the middle of its own annotation range —
    // over the real 2040-track collection arousal spans 3.20 to 7.63 — and a
    // rescale that hides that would claim a precision the model has not got.
    expect(percentFromAffect(3.2)).toBe(28)
    expect(percentFromAffect(7.63)).toBe(83)
  })

  test('a unit probability maps by hundredths', () => {
    expect(percentFromUnit(0)).toBe(0)
    expect(percentFromUnit(1)).toBe(100)
    expect(percentFromUnit(0.921)).toBe(92)
  })

  test('both clamp rather than letting a stray prediction escape 0-100', () => {
    expect(percentFromAffect(-4)).toBe(0)
    expect(percentFromAffect(14)).toBe(100)
    expect(percentFromUnit(-0.5)).toBe(0)
    expect(percentFromUnit(2)).toBe(100)
  })
})

describe('descriptors reaching Track (v35 WS4)', () => {
  test('all four fill, as whole percentages', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(
      tracks,
      sidecar({
        '/Users/dj/a.mp3': { arousal: 5, valence: 3.27, danceability: 0.921, happiness: 0.315 },
      }),
    )

    expect(merged.tracks[0].arousal).toBe(50)
    expect(merged.tracks[0].valence).toBe(28)
    expect(merged.tracks[0].danceability).toBe(92)
    expect(merged.tracks[0].happiness).toBe(32)
  })

  test('a descriptor the sidecar omits stays null rather than becoming zero', () => {
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3' })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { danceability: 0.5 } }))

    expect(merged.tracks[0].danceability).toBe(50)
    expect(merged.tracks[0].arousal).toBeNull()
    expect(merged.tracks[0].valence).toBeNull()
    expect(merged.tracks[0].happiness).toBeNull()
  })

  test('an entry carrying only descriptors still produces a new array', () => {
    // mergeAnalysis returns the INPUT array by reference unless something
    // joined the per-track analysed set. A descriptor that filled a value but
    // skipped that set would be silently discarded.
    const raw = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', bpm: 128 })]
    const merged = mergeAnalysis(raw, sidecar({ '/Users/dj/a.mp3': { danceability: 0.5 } }))

    expect(merged.tracks).not.toBe(raw)
    expect(merged.analysedFields.get('a')).toEqual(new Set(['danceability']))
  })

  test('arousal fills the descriptor even when a Mixed In Key energy already won', () => {
    // Energy and Arousal are independent columns: a MIK comment blocks the
    // derived energy, but the raw arousal it was derived from still shows.
    const tracks = [track({ id: 'a', location: 'file://localhost/Users/dj/a.mp3', energy: 5 })]
    const merged = mergeAnalysis(tracks, sidecar({ '/Users/dj/a.mp3': { arousal: 9 } }))

    expect(merged.tracks[0].energy).toBe(5)
    expect(merged.tracks[0].arousal).toBe(100)
  })

  test('descriptorsFilled counts tracks, not fields', () => {
    const tracks = [
      track({ id: 'four', location: 'file://localhost/Users/dj/four.mp3' }),
      track({ id: 'one', location: 'file://localhost/Users/dj/one.mp3' }),
      track({ id: 'none', location: 'file://localhost/Users/dj/none.mp3' }),
    ]
    const summary = summariseAnalysisImport(
      tracks,
      sidecar({
        '/Users/dj/four.mp3': { arousal: 5, valence: 5, danceability: 0.5, happiness: 0.5 },
        '/Users/dj/one.mp3': { happiness: 0.5 },
        '/Users/dj/none.mp3': { bpm: 174 },
      }),
    )

    expect(summary.descriptorsFilled).toBe(2)
  })
})
