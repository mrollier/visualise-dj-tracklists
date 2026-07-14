import { describe, expect, test } from 'vitest'
import { DEFAULT_CRITERIA } from '../src/core/combos'
import { parseProject, serializeProject, type Project } from '../src/core/persist'
import { SAMPLE_TRACKS } from '../src/data/sample-tracks'

const project: Project = {
  version: 1,
  libraryName: 'My crate',
  tracks: SAMPLE_TRACKS,
  criteria: { ...structuredClone(DEFAULT_CRITERIA), threshold: 4 },
  tracklist: [SAMPLE_TRACKS[0].id, SAMPLE_TRACKS[2].id],
  radialAxis: 'year',
}

describe('project persistence', () => {
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
})
