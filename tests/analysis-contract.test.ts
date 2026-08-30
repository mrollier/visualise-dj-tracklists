import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import {
  mergeAnalysis,
  percentFromAffect,
  percentFromUnit,
  sanitizeAnalysis,
} from '../src/core/analysis'
import { buildFileIndex, matchSegments } from '../src/core/audio/pathMatch'
import { importRekordboxXml } from '../src/core/importers/rekordbox'
import { normalizeKey } from '../src/core/keys'
import { foldSegments, locationSegments } from '../src/core/location'
import { parseDescriptorToken } from '../src/core/model'

/**
 * v34 WS2 — the contract between `scripts/analyse-audio.py` and the app.
 *
 * The script is Python, so none of its logic can be unit-tested from here.
 * What CAN be pinned is the shape of what it emits, and that is where the
 * silent failures live: `mergeAnalysis` drops a key it cannot parse without
 * incrementing any counter (analysis.ts:205-210), so a spelling the script
 * emits and `normalizeKey` rejects would cost the whole batch with nothing
 * anywhere reporting it.
 */

// Essentia's Key algorithm names its tonic from this fixed array; the script
// emits `${key} ${scale}`. Camelot targets computed from the wheel geometry:
// 8B = C major, a perfect fifth per clockwise step, relative minor 9 semitones up.
const ESSENTIA_KEY_NAMES = [
  'A',
  'Bb',
  'B',
  'C',
  'C#',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
] as const

const EXPECTED_MAJOR: Record<string, string> = {
  A: '11B',
  Bb: '6B',
  B: '1B',
  C: '8B',
  'C#': '3B',
  D: '10B',
  Eb: '5B',
  E: '12B',
  F: '7B',
  'F#': '2B',
  G: '9B',
  Ab: '4B',
}

const EXPECTED_MINOR: Record<string, string> = {
  A: '8A',
  Bb: '3A',
  B: '10A',
  C: '5A',
  'C#': '12A',
  D: '7A',
  Eb: '2A',
  E: '9A',
  F: '4A',
  'F#': '11A',
  G: '6A',
  Ab: '1A',
}

describe("the script's key strings survive normalizeKey (v34)", () => {
  test('every tonic essentia can name maps to the right Camelot key', () => {
    for (const name of ESSENTIA_KEY_NAMES) {
      expect(normalizeKey(`${name} major`), `${name} major`).toBe(EXPECTED_MAJOR[name])
      expect(normalizeKey(`${name} minor`), `${name} minor`).toBe(EXPECTED_MINOR[name])
    }
  })

  test('the enharmonic spellings essentia does not currently use also parse', () => {
    // Guards against an essentia release quietly switching its accidentals.
    expect(normalizeKey('A# minor')).toBe(normalizeKey('Bb minor'))
    expect(normalizeKey('Db major')).toBe(normalizeKey('C# major'))
    expect(normalizeKey('D# minor')).toBe(normalizeKey('Eb minor'))
    expect(normalizeKey('Gb major')).toBe(normalizeKey('F# major'))
    expect(normalizeKey('G# minor')).toBe(normalizeKey('Ab minor'))
  })

  test('a scale essentia never emits is refused rather than guessed', () => {
    expect(normalizeKey('F# dorian')).toBeNull()
    expect(normalizeKey('H minor')).toBeNull()
  })
})

describe("the script's descriptor token matches the app's percent scales (v38)", () => {
  // The same fixed vector `self_test()` in scripts/analyse-audio.py asserts:
  // this raw entry must serialise to exactly this token. Pinning it from both
  // languages is what keeps the comment tag and the sidecar telling one story.
  const RAW = { arousal: 5.37, valence: 3.8, danceability: 0.898, happiness: 0.55 }
  const TOKEN = '[A55V35D90H55]'

  test('the pinned raw vector lands on the pinned token values', () => {
    expect(parseDescriptorToken(TOKEN)).toEqual({
      arousal: percentFromAffect(RAW.arousal),
      valence: percentFromAffect(RAW.valence),
      danceability: percentFromUnit(RAW.danceability),
      happiness: percentFromUnit(RAW.happiness),
    })
  })
})

/**
 * The real gate, and the only thing that proves an actual batch landed: run
 * the produced sidecar and the real collection through the app's own parser
 * and merge. Skipped unless both are pointed at, because the collection is
 * gitignored personal data and the sidecar takes hours to produce.
 *
 *   ANALYSIS_SIDECAR=scripts/out/library.analysis.json \
 *   ANALYSIS_COLLECTION=docs/rekordbox/collection.xml npm test -- analysis-contract
 */
const sidecarPath = process.env.ANALYSIS_SIDECAR
const collectionPath = process.env.ANALYSIS_COLLECTION ?? 'docs/rekordbox/collection.xml'
const canRun = sidecarPath !== undefined && existsSync(sidecarPath) && existsSync(collectionPath)

// `describe.skipIf` still evaluates the describe body, so the reads are lazy.
const readRaw = () =>
  JSON.parse(readFileSync(sidecarPath!, 'utf8')) as { tracks: Record<string, unknown> }
const readSidecar = () => sanitizeAnalysis(readRaw())
const readTracks = () => importRekordboxXml(readFileSync(collectionPath, 'utf8')).tracks

describe.skipIf(!canRun)('a produced sidecar against the real collection (v34)', () => {
  test('the whole document survives sanitizeAnalysis', () => {
    const sidecar = readSidecar()
    expect(sidecar).not.toBeNull()
    // Field-by-field rebuilding is silent: an entry the sanitizer rejects
    // simply is not there afterwards.
    expect(Object.keys(sidecar!.tracks).length).toBe(Object.keys(readRaw().tracks).length)
  })

  test('every entry the script wrote resolves back to exactly one track', () => {
    // The merge's own `notFound` counts TRACKS with no entry, which is large
    // and legitimate during a resumed or excluded run — it cannot detect the
    // failure that matters here. So ask the question the other way round,
    // over the same fold: did Python's decoded path and TypeScript's decoded
    // location land on the same string? An entry that resolves nowhere is a
    // whole track's analysis thrown away in silence.
    const index = buildFileIndex(
      readTracks()
        .filter((t): t is typeof t & { location: string } => t.location !== null)
        .map((t) => ({ path: locationSegments(t.location), handle: t.id })),
    )
    const unresolved = Object.keys(readSidecar()!.tracks).filter(
      (key) =>
        matchSegments(index, foldSegments(key.split('/').filter((s) => s !== ''))).kind !== 'hit',
    )
    expect(unresolved).toEqual([])
  })

  test('the merge reports what the script produced', () => {
    const { stats } = mergeAnalysis(readTracks(), readSidecar())
    expect(stats.ambiguous).toBe(0)
    console.log(
      `merge: bpm ${stats.bpmFilled}/${stats.bpmMissing}, key ${stats.keyFilled}/${stats.keyMissing}, ` +
        `below confidence ${stats.belowConfidence}, not found ${stats.notFound}`,
    )
  })

  test('the descriptors land on 0-100 and keep the shape the models produced (v35)', () => {
    const { tracks, stats } = mergeAnalysis(readTracks(), readSidecar())
    const extent = (key: 'arousal' | 'valence' | 'danceability' | 'happiness') => {
      const values = tracks.map((t) => t[key]).filter((v): v is number => v !== null)
      return [Math.min(...values), Math.max(...values), values.length] as const
    }

    for (const key of ['arousal', 'valence', 'danceability', 'happiness'] as const) {
      const [lo, hi, n] = extent(key)
      expect(n, `${key} filled nothing`).toBeGreaterThan(0)
      expect(lo, `${key} escaped below 0`).toBeGreaterThanOrEqual(0)
      expect(hi, `${key} escaped above 100`).toBeLessThanOrEqual(100)
      expect(Number.isInteger(lo) && Number.isInteger(hi), `${key} is not whole`).toBe(true)
      console.log(`${key}: ${lo}-${hi}% over ${n} tracks`)
    }

    // The emoMusic head barely leaves the middle of its own annotation range.
    // Mapping the NOMINAL 1-9 keeps that visible instead of stretching it
    // away, so arousal must NOT reach the ends of the scale. If it ever does,
    // either the model changed or someone swapped in an empirical band.
    const [arousalLo, arousalHi] = extent('arousal')
    expect(arousalLo).toBeGreaterThan(10)
    expect(arousalHi).toBeLessThan(95)
    console.log(`descriptors filled ${stats.descriptorsFilled} tracks`)
  })

  test('every emitted key parses', () => {
    const unparsed = Object.entries(readSidecar()!.tracks)
      .filter(([, e]) => typeof e.key === 'string' && normalizeKey(e.key) === null)
      .map(([path, e]) => `${path}: ${String(e.key)}`)
    expect(unparsed).toEqual([])
  })

  test('Rekordbox values are still untouched after the merge', () => {
    const tracks = readTracks()
    const before = tracks.map((t) => `${t.id}:${String(t.bpm)}:${String(t.key)}`)
    mergeAnalysis(tracks, readSidecar())
    expect(tracks.map((t) => `${t.id}:${String(t.bpm)}:${String(t.key)}`)).toEqual(before)
  })
})
