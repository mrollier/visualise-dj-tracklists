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
  filters: { ...structuredClone(EMPTY_FILTERS), bpm: [120, 140] },
  settings: { ...structuredClone(DEFAULT_SETTINGS), colorScheme: 'aqua' },
  tracklist: [SAMPLE_TRACKS[0].id, SAMPLE_TRACKS[2].id],
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
    expect(migrated.criteria.genre).toEqual({ enabled: true, method: 'exact', threshold: 0.5 })
    expect('rating' in migrated.criteria).toBe(false)
    expect(migrated.criteria.threshold).toBe(4) // clamped to the 4 criteria left
    expect(migrated.criteria.bpm.maxPercent).toBe(8)
    expect(migrated.tracklist).toEqual([SAMPLE_TRACKS[1].id])
  })
})
