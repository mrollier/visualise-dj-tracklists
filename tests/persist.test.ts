import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import { parseProject, serializeProject, type Project } from '../src/core/persist'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { SAMPLE_TRACKS } from '../src/data/sample-tracks'

const project: Project = {
  version: 2,
  libraryName: 'My crate',
  tracks: SAMPLE_TRACKS,
  criteria: { ...structuredClone(DEFAULT_CRITERIA), threshold: 4 },
  filters: { ...structuredClone(EMPTY_FILTERS), bpm: [120, 140], playlists: ['Openers'] },
  settings: { ...structuredClone(DEFAULT_SETTINGS), colorScheme: 'aqua' },
  tracklist: [SAMPLE_TRACKS[0].id, SAMPLE_TRACKS[2].id],
  playlists: [{ name: 'Openers', trackIds: [SAMPLE_TRACKS[0].id] }],
  radialAxis: 'year',
  colorAxis: 'bpm',
}

describe('project persistence (v2)', () => {
  test('serialize → parse round-trips the whole project', () => {
    const parsed = parseProject(serializeProject(project))
    expect(parsed).toEqual(project)
  })

  test('rejects JSON that is not a project', () => {
    expect(() => parseProject('{"foo": 1}')).toThrow()
    expect(() => parseProject('not json')).toThrow()
  })

  test('rejects unsupported versions', () => {
    const future = serializeProject({ ...project, version: 99 as Project['version'] })
    expect(() => parseProject(future)).toThrow(/version/i)
  })

  test('drops tracklist entries that reference unknown tracks', () => {
    const withGhost = serializeProject({ ...project, tracklist: ['nope', SAMPLE_TRACKS[0].id] })
    expect(parseProject(withGhost).tracklist).toEqual([SAMPLE_TRACKS[0].id])
  })

  test('sanitizes hand-edited track entries instead of trusting them', () => {
    const junk = JSON.stringify({
      ...project,
      tracks: [
        SAMPLE_TRACKS[0],
        'garbage', // not an object
        { title: 'No id' }, // missing required field
        { id: 'ok-1', title: 'Wrong types', bpm: '128', year: NaN, rating: 3, key: 'nonsense' },
      ],
      tracklist: [SAMPLE_TRACKS[0].id, 'ok-1'],
    })
    const parsed = parseProject(junk)
    expect(parsed.tracks).toHaveLength(2)
    expect(parsed.tracks[0]).toEqual(SAMPLE_TRACKS[0])
    // Wrong-typed fields become missing; valid ones survive.
    expect(parsed.tracks[1]).toMatchObject({ id: 'ok-1', bpm: null, year: null, rating: 3 })
    expect(parsed.tracks[1].key).toBeNull()
    expect(parsed.tracklist).toEqual([SAMPLE_TRACKS[0].id, 'ok-1'])
  })

  test('older saves without bpmProgression are backfilled with the default', () => {
    const saved = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    delete saved.settings.bpmProgression
    expect(parseProject(JSON.stringify(saved)).settings.bpmProgression).toBe('any')
  })

  test('migrates the old slotSpreadDeg (degrees) into slotSpreadFactor', () => {
    const old = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    delete old.settings.slotSpreadFactor
    delete old.settings.jitterSeed
    old.settings.slotSpreadDeg = 3.75 // half of the 7.5° window
    const parsed = parseProject(JSON.stringify(old))
    expect(parsed.settings.slotSpreadFactor).toBe(0.5)
    expect(parsed.settings.jitterSeed).toBe(0)
    expect('slotSpreadDeg' in parsed.settings).toBe(false)
  })

  test('clamps slotSpreadFactor to [0, 1] (old degree saves allowed up to 20)', () => {
    const wide = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    delete wide.settings.slotSpreadFactor
    wide.settings.slotSpreadDeg = 20
    expect(parseProject(JSON.stringify(wide)).settings.slotSpreadFactor).toBe(1)
    const direct = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    direct.settings.slotSpreadFactor = 3
    expect(parseProject(JSON.stringify(direct)).settings.slotSpreadFactor).toBe(1)
  })

  test('migrates v1 projects: defaults for filters/settings, criteria upgraded', () => {
    const v1 = JSON.stringify({
      version: 1,
      libraryName: 'Old save',
      tracks: SAMPLE_TRACKS,
      criteria: {
        key: { enabled: true, advancedMoves: true },
        bpm: { enabled: true, maxPercent: 8 },
        genre: { enabled: true }, // v1 genre had no method/threshold
        year: { enabled: false, maxYears: 5 },
        rating: { enabled: true, maxStars: 1 }, // dropped in v2
        threshold: 5,
      },
      tracklist: [SAMPLE_TRACKS[1].id],
      radialAxis: 'bpm',
    })
    const migrated = parseProject(v1)
    expect(migrated.version).toBe(2)
    expect(migrated.filters).toEqual(EMPTY_FILTERS)
    expect(migrated.settings).toEqual(DEFAULT_SETTINGS)
    expect(migrated.colorAxis).toBe('auto')
    // v1 stored no genre method/threshold, so the modern defaults apply
    // (hybrid + mutual top-k — design-v6 §F).
    expect(migrated.criteria.genre).toEqual({
      enabled: true,
      method: 'hybrid',
      mode: 'topk',
      k: 5,
      threshold: 0.2,
    })
    // v1's single advancedMoves toggle fans out to both split flags.
    expect(migrated.criteria.key).toEqual({
      enabled: true,
      plusTwo: true,
      plusSeven: true,
      vinylMode: false,
    })
    expect('rating' in migrated.criteria).toBe(false)
    expect(migrated.criteria.threshold).toBe(4) // clamped to the 4 criteria left
    expect(migrated.criteria.bpm.maxPercent).toBe(8)
    expect(migrated.tracklist).toEqual([SAMPLE_TRACKS[1].id])
  })

  test('saves from before playlists existed default to none and an inactive filter', () => {
    const legacy = JSON.stringify({
      version: 2,
      libraryName: '',
      tracks: SAMPLE_TRACKS,
      criteria: structuredClone(DEFAULT_CRITERIA),
      filters: { bpm: null, year: null, rating: null, genres: null }, // no playlists field
      settings: structuredClone(DEFAULT_SETTINGS),
      tracklist: [],
      radialAxis: 'bpm',
    })
    const parsed = parseProject(legacy)
    expect(parsed.playlists).toEqual([])
    expect(parsed.filters.playlists).toBeNull()
  })

  test('saves without advancedMoves default both split key flags to off', () => {
    const saved = JSON.stringify({
      version: 2,
      libraryName: '',
      tracks: SAMPLE_TRACKS,
      criteria: { ...structuredClone(DEFAULT_CRITERIA), key: { enabled: true, vinylMode: true } },
      tracklist: [],
      radialAxis: 'bpm',
    })
    const key = parseProject(saved).criteria.key
    expect(key).toEqual({ enabled: true, plusTwo: false, plusSeven: false, vinylMode: true })
  })

  test('projects saved with a genre threshold keep threshold semantics', () => {
    const saved = JSON.stringify({
      version: 2,
      libraryName: 'Pre-top-k save',
      tracks: SAMPLE_TRACKS,
      criteria: {
        ...DEFAULT_CRITERIA,
        genre: { enabled: true, method: 'graph', threshold: 0.36 },
      },
      tracklist: [],
      radialAxis: 'bpm',
    })
    const migrated = parseProject(saved)
    expect(migrated.criteria.genre.mode).toBe('threshold')
    expect(migrated.criteria.genre.threshold).toBe(0.36)
    expect(migrated.criteria.genre.k).toBe(DEFAULT_CRITERIA.genre.k)
  })
})

describe('genre method persistence (design-v6 §F)', () => {
  test("a save that stored 'lexical' explicitly keeps it — no forced upgrade", () => {
    const saved = serializeProject({
      ...project,
      criteria: {
        ...structuredClone(DEFAULT_CRITERIA),
        genre: { enabled: true, method: 'lexical', mode: 'topk', k: 5, threshold: 0.2 },
      },
    })
    expect(parseProject(saved).criteria.genre.method).toBe('lexical')
  })
})
