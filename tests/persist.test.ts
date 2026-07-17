import { describe, expect, test } from 'vitest'
import { ALL_TRACK_COLUMNS, visibleColumns } from '../src/core/columns'
import { DEFAULT_CRITERIA } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import { parseProject, serializeProject, type Project } from '../src/core/persist'
import { DEFAULT_SETTINGS } from '../src/core/settings'
import { SAMPLE_TRACKS } from '../src/data/sample-tracks'

const project: Project = {
  version: 3,
  libraryName: 'My crate',
  tracks: SAMPLE_TRACKS,
  criteria: { ...structuredClone(DEFAULT_CRITERIA), threshold: 4 },
  filters: { ...structuredClone(EMPTY_FILTERS), bpm: [120, 140], playlists: ['Openers'] },
  settings: { ...structuredClone(DEFAULT_SETTINGS), colorScheme: 'aqua' },
  sets: [
    {
      id: 'set-1',
      name: 'First Set',
      trackIds: [SAMPLE_TRACKS[0].id, SAMPLE_TRACKS[2].id],
      generated: false,
    },
    { id: 'set-2', name: 'Peak time', trackIds: [SAMPLE_TRACKS[1].id], generated: true },
  ],
  activeSetId: 'set-2',
  playlists: [{ name: 'Openers', trackIds: [SAMPLE_TRACKS[0].id] }],
  radialAxis: 'year',
  colorAxis: 'bpm',
}

describe('project persistence (v3)', () => {
  test('serialize → parse round-trips the whole project, generated flag included', () => {
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

  test('loading a project with more than eight sets keeps the first eight (v8 issue 18)', () => {
    const many = Array.from({ length: 11 }, (_, i) => ({
      id: `s${i}`,
      name: `Set ${i + 1}`,
      trackIds: [],
      generated: false,
    }))
    const parsed = parseProject(serializeProject({ ...project, sets: many, activeSetId: 's10' }))
    expect(parsed.sets).toHaveLength(8)
    expect(parsed.sets.map((s) => s.id)).toEqual(many.slice(0, 8).map((s) => s.id))
    // the clamped-away active set falls back to the first
    expect(parsed.activeSetId).toBe('s0')
  })

  test('drops set entries that reference unknown tracks, per set', () => {
    const withGhost = serializeProject({
      ...project,
      sets: [
        { id: 's', name: 'First Set', trackIds: ['nope', SAMPLE_TRACKS[0].id], generated: false },
      ],
      activeSetId: 's',
    })
    expect(parseProject(withGhost).sets[0].trackIds).toEqual([SAMPLE_TRACKS[0].id])
  })

  test('a v2 save migrates its tracklist into one un-generated First Set', () => {
    const v2 = JSON.stringify({
      version: 2,
      libraryName: 'Old save',
      tracks: SAMPLE_TRACKS,
      criteria: structuredClone(DEFAULT_CRITERIA),
      filters: structuredClone(EMPTY_FILTERS),
      settings: structuredClone(DEFAULT_SETTINGS),
      tracklist: ['nope', SAMPLE_TRACKS[0].id],
      playlists: [],
      radialAxis: 'bpm',
      colorAxis: 'auto',
    })
    const parsed = parseProject(v2)
    expect(parsed.version).toBe(3)
    expect(parsed.sets).toHaveLength(1)
    expect(parsed.sets[0]).toMatchObject({
      name: 'First Set',
      trackIds: [SAMPLE_TRACKS[0].id], // unknown ids pruned
      generated: false,
    })
    expect(parsed.activeSetId).toBe(parsed.sets[0].id)
    expect('tracklist' in parsed).toBe(false)
  })

  test('duplicate set names in a save are auto-suffixed on load (v9 issue 18)', () => {
    const withDupes = {
      ...project,
      sets: [
        { id: 's1', name: 'Peak', trackIds: [], generated: false },
        { id: 's2', name: 'Peak', trackIds: [], generated: false },
        { id: 's3', name: 'Peak', trackIds: [], generated: false },
      ],
      activeSetId: 's1',
    }
    const parsed = parseProject(serializeProject(withDupes))
    expect(parsed.sets.map((s) => s.name)).toEqual(['Peak', 'Peak (2)', 'Peak (3)'])
  })

  test('a missing or unknown activeSetId falls back to the first set', () => {
    const bad = JSON.parse(serializeProject(project)) as Record<string, unknown>
    bad.activeSetId = 'no-such-set'
    expect(parseProject(JSON.stringify(bad)).activeSetId).toBe('set-1')
    delete bad.activeSetId
    expect(parseProject(JSON.stringify(bad)).activeSetId).toBe('set-1')
  })

  test('zero or garbage sets collapse to one empty First Set', () => {
    const none = JSON.parse(serializeProject(project)) as Record<string, unknown>
    none.sets = []
    const parsedNone = parseProject(JSON.stringify(none))
    expect(parsedNone.sets).toHaveLength(1)
    expect(parsedNone.sets[0]).toMatchObject({ name: 'First Set', trackIds: [], generated: false })
    expect(parsedNone.activeSetId).toBe(parsedNone.sets[0].id)

    const junk = JSON.parse(serializeProject(project)) as Record<string, unknown>
    junk.sets = ['garbage', { name: 42, trackIds: 'nope', generated: 'yes' }]
    const parsedJunk = parseProject(JSON.stringify(junk))
    expect(parsedJunk.sets).toHaveLength(1)
    expect(parsedJunk.sets[0].trackIds).toEqual([])
    expect(parsedJunk.sets[0].generated).toBe(false)
    expect(typeof parsedJunk.sets[0].name).toBe('string')
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
      sets: [
        { id: 's', name: 'First Set', trackIds: [SAMPLE_TRACKS[0].id, 'ok-1'], generated: false },
      ],
      activeSetId: 's',
    })
    const parsed = parseProject(junk)
    expect(parsed.tracks).toHaveLength(2)
    expect(parsed.tracks[0]).toEqual(SAMPLE_TRACKS[0])
    // Wrong-typed fields become missing; valid ones survive.
    expect(parsed.tracks[1]).toMatchObject({ id: 'ok-1', bpm: null, year: null, rating: 3 })
    expect(parsed.tracks[1].key).toBeNull()
    expect(parsed.sets[0].trackIds).toEqual([SAMPLE_TRACKS[0].id, 'ok-1'])
  })

  test('saves from before the section memory start with everything folded (v8 issue 17)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'advancedOpen')
    expect(parseProject(JSON.stringify(raw)).settings.advancedOpen).toEqual([])
  })

  test('saves from before trackColumns show the classic seven (v8 issue 15, v9 issue 12)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'trackColumns')
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'hiddenColumns')
    const settings = parseProject(JSON.stringify(raw)).settings
    expect(settings.trackColumns).toEqual([...ALL_TRACK_COLUMNS])
    expect(visibleColumns(settings.trackColumns, settings.hiddenColumns)).toEqual([
      'artist',
      'title',
      'key',
      'bpm',
      'genre',
      'year',
      'rating',
    ])
  })

  test('a v8 save with a reordered partial column list keeps its visible set (issue 12)', () => {
    const raw = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    raw.settings.trackColumns = ['title', 'bpm', 'key']
    Reflect.deleteProperty(raw.settings, 'hiddenColumns')
    const settings = parseProject(JSON.stringify(raw)).settings
    expect(visibleColumns(settings.trackColumns, settings.hiddenColumns)).toEqual([
      'title',
      'bpm',
      'key',
    ])
    expect(settings.trackColumns).toHaveLength(ALL_TRACK_COLUMNS.length)
  })

  test('saves from before album/dateAdded parse those fields to null (v8 issue 15)', () => {
    const raw = JSON.parse(serializeProject(project)) as { tracks: Record<string, unknown>[] }
    for (const track of raw.tracks) {
      Reflect.deleteProperty(track, 'album')
      Reflect.deleteProperty(track, 'dateAdded')
    }
    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.tracks[0].album).toBeNull()
    expect(parsed.tracks[0].dateAdded).toBeNull()
  })

  test('hand-edited album/dateAdded round-trip and sanitize (v8 issue 15)', () => {
    const withFields = {
      ...project,
      tracks: [
        { ...project.tracks[0], album: 'Night Shift EP', dateAdded: '2020-03-14' },
        ...project.tracks.slice(1),
      ],
    }
    const parsed = parseProject(serializeProject(withFields))
    expect(parsed.tracks[0].album).toBe('Night Shift EP')
    expect(parsed.tracks[0].dateAdded).toBe('2020-03-14')
  })

  test('the v9 metadata fields round-trip, sanitize, and default to null (issue 10)', () => {
    const withFields = {
      ...project,
      tracks: [
        {
          ...project.tracks[0],
          label: 'Night Shift',
          playCount: 0,
          lastPlayed: '2024-02-11',
          bitRate: 320,
          colour: '0xFF007F',
        },
        { ...project.tracks[1], label: 42, playCount: 'many', size: Infinity }, // wrong types
        ...project.tracks.slice(2),
      ],
    }
    const parsed = parseProject(serializeProject(withFields as unknown as Project))
    expect(parsed.tracks[0]).toMatchObject({
      label: 'Night Shift',
      playCount: 0, // a real zero survives
      lastPlayed: '2024-02-11',
      bitRate: 320,
      colour: '0xFF007F',
    })
    expect(parsed.tracks[1]).toMatchObject({ label: null, playCount: null, size: null })
    // Saves predating the fields parse them all to null: strip the keys the
    // way an old file simply wouldn't have them.
    const raw = JSON.parse(serializeProject(project)) as { tracks: Record<string, unknown>[] }
    for (const field of [
      'composer',
      'grouping',
      'kind',
      'size',
      'discNumber',
      'trackNumber',
      'bitRate',
      'sampleRate',
      'comments',
      'playCount',
      'remixer',
      'label',
      'mix',
      'colour',
      'dateModified',
      'lastPlayed',
    ]) {
      Reflect.deleteProperty(raw.tracks[0], field)
    }
    expect(parseProject(JSON.stringify(raw)).tracks[0]).toMatchObject({
      composer: null,
      grouping: null,
      kind: null,
      size: null,
      discNumber: null,
      trackNumber: null,
      bitRate: null,
      sampleRate: null,
      comments: null,
      playCount: null,
      remixer: null,
      label: null,
      mix: null,
      colour: null,
      dateModified: null,
      lastPlayed: null,
    })
  })

  test('saves from before focus-only edges default the cluster toggle off (v9 issue 8)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'focusClusterEdges')
    expect(parseProject(JSON.stringify(raw)).settings.focusClusterEdges).toBe(false)
  })

  test('saves from before visibleFilters default to Date-added on (v10 issue 4b)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'visibleFilters')
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual(['dateAdded'])
  })

  test('visibleFilters keeps valid keys, drops garbage, allows empty (v10 issue 4b)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    ;(raw.settings as Record<string, unknown>).visibleFilters = ['bpm', 'nonsense', 'rating']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual(['bpm', 'rating'])
    ;(raw.settings as Record<string, unknown>).visibleFilters = []
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([])
  })

  test('saves from before icon modes default to genre families (v8 issues 4+5)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'iconMode')
    expect(parseProject(JSON.stringify(raw)).settings.iconMode).toBe('families')
  })

  test('saves from before the key-ring filter default to both rings (v8 issue 10)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const filters = raw.filters as Record<string, unknown>
    Reflect.deleteProperty(filters, 'keyRing')
    expect(parseProject(JSON.stringify(raw)).filters.keyRing).toBe('both')
  })

  test('saves from before the BPM ratio toggles default unit time on (v8 issue 6)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const criteria = raw.criteria as { bpm: Record<string, unknown> }
    criteria.bpm = { enabled: true, maxPercent: 8, halfDouble: true }
    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.criteria.bpm.unitTime).toBe(true)
    expect(parsed.criteria.bpm.twoThirds).toBe(false)
    expect(parsed.criteria.bpm.halfDouble).toBe(true)
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
    expect(migrated.version).toBe(3)
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
    expect(migrated.sets).toHaveLength(1)
    expect(migrated.sets[0].trackIds).toEqual([SAMPLE_TRACKS[1].id])
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
