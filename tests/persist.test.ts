import { describe, expect, test } from 'vitest'
import { ALL_TRACK_COLUMNS, visibleColumns } from '../src/core/columns'
import { DEFAULT_CRITERIA } from '../src/core/combos'
import { EMPTY_FILTERS } from '../src/core/filter'
import type { Track } from '../src/core/model'
import { parseProject, serializeProject, type Project } from '../src/core/persist'
import { DEFAULT_SETTINGS, type AppSettings } from '../src/core/settings'
import { SAMPLE_TRACKS } from '../src/data/sample-tracks'

const project: Project = {
  version: 10,
  manualEdges: [],
  libraryName: 'My crate',
  tracks: SAMPLE_TRACKS,
  criteria: { ...structuredClone(DEFAULT_CRITERIA), threshold: 4 },
  filters: {
    ...structuredClone(EMPTY_FILTERS),
    properties: { bpm: [120, 140] },
    playlists: ['Openers'],
  },
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
  analysis: null,
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

  test('a v2 save migrates its tracklist into one un-generated First constellation', () => {
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
    expect(parsed.version).toBe(10)
    expect(parsed.sets).toHaveLength(1)
    expect(parsed.sets[0]).toMatchObject({
      name: 'First',
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

  test('a pre-v17 save sheds the "Constellation" noun from its default names', () => {
    const old = JSON.parse(serializeProject(project)) as Record<string, unknown>
    old.sets = [
      { id: 's1', name: 'First Constellation', trackIds: [], generated: false },
      { id: 's2', name: 'peak time bangers', trackIds: [], generated: false },
    ]
    old.activeSetId = 's1'
    const parsed = parseProject(JSON.stringify(old))
    expect(parsed.sets.map((s) => s.name)).toEqual(['First', 'peak time bangers'])
  })

  test('migrated names still get the duplicate suffix', () => {
    const old = JSON.parse(serializeProject(project)) as Record<string, unknown>
    old.sets = [
      { id: 's1', name: 'First', trackIds: [], generated: false },
      { id: 's2', name: 'First Constellation', trackIds: [], generated: false },
    ]
    old.activeSetId = 's1'
    const parsed = parseProject(JSON.stringify(old))
    expect(parsed.sets.map((s) => s.name)).toEqual(['First', 'First (2)'])
  })

  test('zero or garbage sets collapse to one empty First constellation', () => {
    const none = JSON.parse(serializeProject(project)) as Record<string, unknown>
    none.sets = []
    const parsedNone = parseProject(JSON.stringify(none))
    expect(parsedNone.sets).toHaveLength(1)
    expect(parsedNone.sets[0]).toMatchObject({ name: 'First', trackIds: [], generated: false })
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

  test('saves from before visibleFilters default to BPM/Year/Rating, then v23 back-fills the three permanent rows (v11 revert of v10 4b)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown> & {
      version: number
    }
    raw.version = 7 // pre-v23: a save this old predates the permanent rows too
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'visibleFilters')
    // The fixture has an active bpm filter, which the back-fill guard must
    // keep visible — it is already in the default, so the default stands;
    // the v23 back-fill then appends the three permanent panel rows.
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'year',
      'rating',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
  })

  test('visibleFilters keeps valid keys, drops garbage; a pre-v23 (v7) save always gains the three permanent rows (v11)', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.version = 7
    raw.filters.properties = {} // keep the active-filter guard out of this test
    raw.settings.visibleFilters = ['bpm', 'nonsense', 'rating']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'rating',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
    raw.settings.visibleFilters = ['artist', 'dateAdded']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'artist',
      'dateAdded',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
    // Even an explicit [] (v11's "hide every property filter" choice) gains
    // the four permanent rows on a pre-v25 save — they aren't optional.
    raw.settings.visibleFilters = []
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
  })

  test('a back-filled visibleFilters always includes the actively filtering properties, plus the v23 permanent rows on a pre-v23 save (v11)', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.version = 7
    Reflect.deleteProperty(raw.settings, 'visibleFilters')
    raw.filters.properties = { dateAdded: ['2020-01-01', '2024-12-31'] }
    // dateAdded is filtering but not in the new default (which already
    // carries the three permanent panel rows via DEFAULT_SETTINGS) — it
    // must be appended so no filter can act invisibly.
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'year',
      'rating',
      'starred',
      'constellation',
      'combos',
      'keys',
      'dateAdded',
    ])
    // An explicit [] with an active filter gains that filter's row too, plus
    // the four permanent rows the version<8/version<10 back-fills add.
    raw.settings.visibleFilters = []
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'dateAdded',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
  })

  test('a saved require-zero threshold survives the load (v11 issue 2a)', () => {
    const zero = { ...project, criteria: { ...structuredClone(DEFAULT_CRITERIA), threshold: 0 } }
    expect(parseProject(serializeProject(zero)).criteria.threshold).toBe(0)
  })

  test('v3 saves lift their top-level ranges into filters.properties (v11 issue 1)', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      filters: Record<string, unknown>
    }
    raw.version = 3
    raw.filters = {
      bpm: [120, 130],
      year: null,
      rating: [3, 5],
      dateAdded: ['2020-01-01', '9999-12-31'],
      genres: null,
      playlists: ['Openers'],
      keyRing: 'minor',
    }
    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.filters.properties).toEqual({
      bpm: [120, 130],
      rating: [3, 5],
      dateAdded: ['2020-01-01', '9999-12-31'],
    })
    expect(parsed.filters.playlists).toEqual(['Openers'])
    // F5: the old string keyRing migrates to the new toggle pair.
    expect(parsed.filters.keyRings).toEqual({ minor: true, major: false })
    expect(parsed.version).toBe(10)
  })

  test('garbage property filters are dropped or clamped (v14 WS2 kinds)', () => {
    const raw = JSON.parse(serializeProject(project)) as { filters: Record<string, unknown> }
    raw.filters.properties = {
      bpm: [120, 130], // fine — number tuple
      nonsense: [1, 2], // unknown property
      artist: ['b', 'k'], // old v5 text tuple → dropped (alpha needs bucket indices)
      year: ['a', 'b'], // strings on a number property → dropped
      rating: [3], // not a pair → dropped
      key: [0, 99], // clamps into 1–12
      genre: [3, 8], // alpha bucket range → survives
      comments: { contains: 'live' }, // contains object → survives
      location: { contains: '' }, // empty contains → dropped
      colour: { colours: ['0xFF0000'] }, // colour allow-list → survives
      kind: { quality: 'lossless' }, // old v6 single quality → migrates to array
    }
    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.filters.properties).toEqual({
      bpm: [120, 130],
      key: [1, 12],
      genre: [3, 8],
      comments: { contains: 'live' },
      colour: { colours: ['0xFF0000'] },
      kind: { qualities: ['lossless'] },
    })
  })

  test('the new filter-kind object ranges round-trip through serialize → parse (v14 WS2)', () => {
    const withKinds: Project = {
      ...project,
      filters: {
        ...structuredClone(EMPTY_FILTERS),
        properties: {
          genre: [0, 12],
          key: [8, 12],
          comments: { contains: 'peak' },
          colour: { colours: ['0xFF007F', '0x0000FF'] },
          kind: { qualities: ['lossy'] },
        },
      },
    }
    const parsed = parseProject(serializeProject(withKinds))
    expect(parsed.filters.properties).toEqual(withKinds.filters.properties)
  })

  test('a v5 save with an old text range drops it, no phantom filter row (v14 WS2)', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      filters: Record<string, unknown>
      settings: Record<string, unknown>
    }
    raw.version = 5
    raw.filters.properties = { artist: ['b', 'k'] }
    raw.settings.visibleFilters = ['bpm']
    const parsed = parseProject(JSON.stringify(raw))
    // The old text range fails the new alpha number-checks and drops.
    expect(parsed.filters.properties).toEqual({})
    // Nothing filters, so the reconciliation never force-adds an artist row;
    // the v23/v25 back-fills still run (a v5 save predates the permanent rows).
    expect(parsed.settings.visibleFilters).toEqual([
      'bpm',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
  })

  test('old saves without location in hiddenColumns keep it hidden (v11 issue 1)', () => {
    const raw = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    raw.settings.trackColumns = (raw.settings.trackColumns as string[]).filter(
      (f) => f !== 'location',
    )
    raw.settings.hiddenColumns = ['album']
    const settings = parseProject(JSON.stringify(raw)).settings
    expect(settings.hiddenColumns).toContain('location')
    expect(visibleColumns(settings.trackColumns, settings.hiddenColumns)).not.toContain('location')
  })

  test('saves from before icon modes default to genre families (v8 issues 4+5)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    Reflect.deleteProperty(raw.settings as Record<string, unknown>, 'iconMode')
    expect(parseProject(JSON.stringify(raw)).settings.iconMode).toBe('families')
  })

  test('saves from before the key-ring filter default to both rings (v8 issue 10 / F5)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const filters = raw.filters as Record<string, unknown>
    Reflect.deleteProperty(filters, 'keyRings')
    expect(parseProject(JSON.stringify(raw)).filters.keyRings).toEqual({ minor: true, major: true })
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

  test('clamps slotSpreadFactor to [0, 2] (v14 WS7), legacy degree migration unaffected', () => {
    // A stored factor inside the widened range survives the reload untouched.
    const stored = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    stored.settings.slotSpreadFactor = 1.7
    expect(parseProject(JSON.stringify(stored)).settings.slotSpreadFactor).toBe(1.7)
    // Out of range on either side clamps to the [0, 2] bounds.
    const high = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    high.settings.slotSpreadFactor = 3
    expect(parseProject(JSON.stringify(high)).settings.slotSpreadFactor).toBe(2)
    const low = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    low.settings.slotSpreadFactor = -1
    expect(parseProject(JSON.stringify(low)).settings.slotSpreadFactor).toBe(0)
    // A legacy degrees save (window capped at 7.5°) still migrates to ≤1 —
    // the wider clamp leaves the ordinary migration path untouched.
    const legacy = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    delete legacy.settings.slotSpreadFactor
    legacy.settings.slotSpreadDeg = 7.5
    expect(parseProject(JSON.stringify(legacy)).settings.slotSpreadFactor).toBe(1)
    // A non-number value (typeof guard, matching jitterSeed/manualEdgeWeight)
    // falls back to the default of 1 rather than clamping garbage through.
    const garbage = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    garbage.settings.slotSpreadFactor = 'nope'
    expect(parseProject(JSON.stringify(garbage)).settings.slotSpreadFactor).toBe(1)
  })

  test('clamps manualEdgeWeight to a finite 0–10, resetting anything else to 5 (v14 S3)', () => {
    const parse = (v: unknown) => {
      const s = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
      s.settings.manualEdgeWeight = v
      return parseProject(JSON.stringify(s)).settings.manualEdgeWeight
    }
    expect(parse(0)).toBe(0)
    expect(parse(7.5)).toBe(7.5)
    expect(parse(10)).toBe(10)
    expect(parse(-1)).toBe(5)
    expect(parse(100)).toBe(5)
    expect(parse('nope')).toBe(5)
    // older saves without the field back-fill to the default
    const old = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    delete old.settings.manualEdgeWeight
    expect(parseProject(JSON.stringify(old)).settings.manualEdgeWeight).toBe(5)
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
    expect(migrated.version).toBe(10)
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
      demanded: false,
    })
    // v1's single advancedMoves toggle fans out to both split flags.
    expect(migrated.criteria.key).toEqual({
      enabled: true,
      plusTwo: true,
      plusSeven: true,
      vinylMode: false,
      demanded: false,
    })
    expect('rating' in migrated.criteria).toBe(false)
    // v1 predates energy too — it back-fills to the default (v9).
    expect(migrated.criteria.energy).toEqual({ enabled: true, maxSteps: 2, demanded: false })
    // The flat schema ceiling is 5 (not the 4 fields this save actually has
    // enabled — year stayed off); nothing downstream breaks since every
    // consumer re-clamps threshold against the live enabled count before
    // display or evaluation (CriteriaPanel's $effect, evaluateCombo's
    // effectiveThreshold, …) — this assertion is just documenting the raw,
    // unclamped-against-enabledCount value parseProject returns.
    expect(migrated.criteria.threshold).toBe(5)
    expect(migrated.criteria.bpm.maxPercent).toBe(8)
    expect(migrated.sets).toHaveLength(1)
    expect(migrated.sets[0].trackIds).toEqual([SAMPLE_TRACKS[1].id])
  })

  test('a v8 save (no criteria.energy) back-fills Energy to the default on migration (v9)', () => {
    const v8 = JSON.stringify({
      version: 8,
      libraryName: 'Pre-energy save',
      tracks: SAMPLE_TRACKS,
      criteria: {
        // The shape a real v8 save had — genuinely no `energy` key.
        key: DEFAULT_CRITERIA.key,
        bpm: DEFAULT_CRITERIA.bpm,
        genre: DEFAULT_CRITERIA.genre,
        year: DEFAULT_CRITERIA.year,
        threshold: 4,
      },
      tracklist: [],
      radialAxis: 'bpm',
    })
    const migrated = parseProject(v8)
    expect(migrated.version).toBe(10)
    expect(migrated.criteria.energy).toEqual({ enabled: true, maxSteps: 2, demanded: false })
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
    expect(key).toEqual({
      enabled: true,
      plusTwo: false,
      plusSeven: false,
      vinylMode: true,
      demanded: false,
    })
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

describe('demanded criteria flags (v14 WS4)', () => {
  test('the four demanded flags round-trip through serialize → parse', () => {
    const withLocks: Project = {
      ...project,
      criteria: {
        ...structuredClone(DEFAULT_CRITERIA),
        key: { ...DEFAULT_CRITERIA.key, demanded: true },
        genre: { ...DEFAULT_CRITERIA.genre, demanded: true },
        threshold: 2,
      },
    }
    const parsed = parseProject(serializeProject(withLocks))
    expect(parsed.criteria.key.demanded).toBe(true)
    expect(parsed.criteria.bpm.demanded).toBe(false)
    expect(parsed.criteria.genre.demanded).toBe(true)
    expect(parsed.criteria.year.demanded).toBe(false)
  })

  test('old saves without demanded flags default all four to false', () => {
    const raw = JSON.parse(serializeProject(project)) as { criteria: Record<string, unknown> }
    for (const field of ['key', 'bpm', 'genre', 'year']) {
      Reflect.deleteProperty(raw.criteria[field] as Record<string, unknown>, 'demanded')
    }
    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.criteria.key.demanded).toBe(false)
    expect(parsed.criteria.bpm.demanded).toBe(false)
    expect(parsed.criteria.genre.demanded).toBe(false)
    expect(parsed.criteria.year.demanded).toBe(false)
  })

  test('non-boolean demanded garbage coerces to false (whitelist coercion)', () => {
    const raw = JSON.parse(serializeProject(project)) as { criteria: Record<string, unknown> }
    ;(raw.criteria.key as Record<string, unknown>).demanded = 'yes'
    ;(raw.criteria.bpm as Record<string, unknown>).demanded = 1
    expect(parseProject(JSON.stringify(raw)).criteria.key.demanded).toBe(false)
    expect(parseProject(JSON.stringify(raw)).criteria.bpm.demanded).toBe(false)
  })

  test('a migrated threshold is floored to the demanded count on load', () => {
    // Two locked criteria but a saved require-1 (or 0) must rise to 2.
    const raw = JSON.parse(serializeProject(project)) as { criteria: Record<string, unknown> }
    ;(raw.criteria.key as Record<string, unknown>).demanded = true
    ;(raw.criteria.genre as Record<string, unknown>).demanded = true
    raw.criteria.threshold = 1
    expect(parseProject(JSON.stringify(raw)).criteria.threshold).toBe(2)
  })
})

describe('genre method persistence (design-v6 §F)', () => {
  test("a save that stored 'lexical' explicitly keeps it — no forced upgrade", () => {
    const saved = serializeProject({
      ...project,
      criteria: {
        ...structuredClone(DEFAULT_CRITERIA),
        genre: {
          enabled: true,
          method: 'lexical',
          mode: 'topk',
          k: 5,
          threshold: 0.2,
          demanded: false,
        },
      },
    })
    expect(parseProject(saved).criteria.genre.method).toBe('lexical')
  })
})

describe('uiMode (v12 WS4)', () => {
  test('saves without uiMode back-fill to advanced', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    delete (raw.settings as Record<string, unknown>).uiMode
    expect(parseProject(JSON.stringify(raw)).settings.uiMode).toBe('advanced')
  })

  test('a stored easy mode survives the round-trip', () => {
    const easy = {
      ...project,
      settings: { ...structuredClone(DEFAULT_SETTINGS), uiMode: 'easy' as const },
    }
    expect(parseProject(serializeProject(easy)).settings.uiMode).toBe('easy')
  })

  test('garbage uiMode values fall back to advanced', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    ;(raw.settings as Record<string, unknown>).uiMode = 'banana'
    expect(parseProject(JSON.stringify(raw)).settings.uiMode).toBe('advanced')
  })
})

describe('same-artist preference (v31)', () => {
  test('a save from before v31 back-fills to the preference being on', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    delete (raw.settings as Record<string, unknown>).avoidSameArtist
    expect(parseProject(JSON.stringify(raw)).settings.avoidSameArtist).toBe(true)
  })

  test('switching it off survives the round-trip', () => {
    const off = {
      ...project,
      settings: { ...structuredClone(DEFAULT_SETTINGS), avoidSameArtist: false },
    }
    expect(parseProject(serializeProject(off)).settings.avoidSameArtist).toBe(false)
  })

  test('a garbage value falls back to the default', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    ;(raw.settings as Record<string, unknown>).avoidSameArtist = 'sometimes'
    expect(parseProject(JSON.stringify(raw)).settings.avoidSameArtist).toBe(
      DEFAULT_SETTINGS.avoidSameArtist,
    )
  })
})

describe('key/BPM source preference (v36)', () => {
  test('a save from before v36 back-fills both sources to rekordbox', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const stored = raw.settings as Record<string, unknown>
    delete stored.keySource
    delete stored.bpmSource
    const parsed = parseProject(JSON.stringify(raw)).settings
    expect(parsed.keySource).toBe('rekordbox')
    expect(parsed.bpmSource).toBe('rekordbox')
  })

  test('comments as source survives the round-trip', () => {
    const comments = {
      ...project,
      settings: {
        ...structuredClone(DEFAULT_SETTINGS),
        keySource: 'comments' as const,
        bpmSource: 'comments' as const,
      },
    }
    const parsed = parseProject(serializeProject(comments)).settings
    expect(parsed.keySource).toBe('comments')
    expect(parsed.bpmSource).toBe('comments')
  })

  test('garbage source values fall back to rekordbox', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const stored = raw.settings as Record<string, unknown>
    stored.keySource = 'id3'
    stored.bpmSource = 42
    const parsed = parseProject(JSON.stringify(raw)).settings
    expect(parsed.keySource).toBe('rekordbox')
    expect(parsed.bpmSource).toBe('rekordbox')
  })
})

describe('panel visibility (v30)', () => {
  test('saves from before collapsible panels back-fill to both panels shown', () => {
    // The layout every save before v30 was written from. Additive booleans
    // whose default IS the legacy behaviour are what let this wave skip a
    // schema bump.
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    const stored = raw.settings as Record<string, unknown>
    delete stored.showLeftPanel
    delete stored.showRightPanel
    const parsed = parseProject(JSON.stringify(raw)).settings
    expect(parsed.showLeftPanel).toBe(true)
    expect(parsed.showRightPanel).toBe(true)
  })

  test('a collapsed panel survives the round-trip', () => {
    const collapsed = {
      ...project,
      settings: { ...structuredClone(DEFAULT_SETTINGS), showLeftPanel: false },
    }
    const parsed = parseProject(serializeProject(collapsed)).settings
    expect(parsed.showLeftPanel).toBe(false)
    expect(parsed.showRightPanel).toBe(true)
  })

  test('garbage panel values fall back to shown', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    ;(raw.settings as Record<string, unknown>).showRightPanel = 'sometimes'
    expect(parseProject(JSON.stringify(raw)).settings.showRightPanel).toBe(true)
  })
})

describe('manual edges (v12 WS9, schema v5)', () => {
  test('manual edges round-trip with their tag', () => {
    const withEdges = {
      ...project,
      manualEdges: [{ a: SAMPLE_TRACKS[0].id, b: SAMPLE_TRACKS[1].id, tag: 'mashup' }],
    }
    const parsed = parseProject(serializeProject(withEdges))
    expect(parsed.manualEdges).toEqual(withEdges.manualEdges)
  })

  test('v4 saves parse with no manual edges', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    raw.version = 4
    delete raw.manualEdges
    expect(parseProject(JSON.stringify(raw)).manualEdges).toEqual([])
  })

  test('unknown ids, self-pairs and duplicate pairs are pruned', () => {
    const withEdges = {
      ...project,
      manualEdges: [
        { a: SAMPLE_TRACKS[0].id, b: SAMPLE_TRACKS[1].id },
        { a: SAMPLE_TRACKS[1].id, b: SAMPLE_TRACKS[0].id }, // same pair reversed
        { a: SAMPLE_TRACKS[0].id, b: SAMPLE_TRACKS[0].id }, // self
        { a: SAMPLE_TRACKS[0].id, b: 'ghost' }, // unknown
      ],
    }
    const parsed = parseProject(serializeProject(withEdges))
    expect(parsed.manualEdges).toEqual([{ a: SAMPLE_TRACKS[0].id, b: SAMPLE_TRACKS[1].id }])
  })
})

describe('WS6 sanitize round-trip pins (v14.1)', () => {
  // Tracks built in sanitizeTrack's exact emit order (id, title, …) so the pin
  // isolates the settings/criteria/playlists round-trip — SAMPLE_TRACKS store
  // id/title last, which sanitizeTrack always normalizes to first, and that
  // pre-existing reorder is not what these pins are asserting on.
  const canonTrack = (over: Partial<Track> & { id: string; title: string }): Track => ({
    id: over.id,
    title: over.title,
    artist: over.artist ?? null,
    key: over.key ?? null,
    bpm: over.bpm ?? null,
    genre: over.genre ?? null,
    year: over.year ?? null,
    rating: over.rating ?? null,
    durationSec: over.durationSec ?? null,
    album: over.album ?? null,
    dateAdded: over.dateAdded ?? null,
    location: over.location ?? null,
    composer: over.composer ?? null,
    grouping: over.grouping ?? null,
    kind: over.kind ?? null,
    size: over.size ?? null,
    discNumber: over.discNumber ?? null,
    trackNumber: over.trackNumber ?? null,
    bitRate: over.bitRate ?? null,
    sampleRate: over.sampleRate ?? null,
    comments: over.comments ?? null,
    energy: over.energy ?? null,
    arousal: over.arousal ?? null,
    valence: over.valence ?? null,
    danceability: over.danceability ?? null,
    happiness: over.happiness ?? null,
    playCount: over.playCount ?? null,
    remixer: over.remixer ?? null,
    label: over.label ?? null,
    mix: over.mix ?? null,
    colour: over.colour ?? null,
    dateModified: over.dateModified ?? null,
    lastPlayed: over.lastPlayed ?? null,
  })
  const pinTracks: Track[] = [
    canonTrack({
      id: 't1',
      title: 'A',
      artist: 'X',
      key: '8A',
      bpm: 128,
      genre: 'Techno',
      year: 2019,
      rating: 4,
    }),
    canonTrack({
      id: 't2',
      title: 'B',
      artist: 'Y',
      key: '8A',
      bpm: 130,
      genre: 'Techno',
      year: 2021,
      rating: 5,
    }),
    canonTrack({
      id: 't3',
      title: 'C',
      artist: 'Z',
      key: '9A',
      bpm: 126,
      genre: 'House',
      year: 2020,
      rating: 3,
    }),
  ]
  const buildValid = (settings: AppSettings): Project => ({
    version: 10,
    manualEdges: [{ a: 't1', b: 't2', tag: 'mashup' }],
    libraryName: 'Pin crate',
    tracks: pinTracks,
    criteria: { ...structuredClone(DEFAULT_CRITERIA), threshold: 4 },
    filters: {
      ...structuredClone(EMPTY_FILTERS),
      properties: { bpm: [120, 140] },
      playlists: ['Openers'],
    },
    settings,
    sets: [
      { id: 'set-1', name: 'First Set', trackIds: ['t1', 't3'], generated: false },
      { id: 'set-2', name: 'Peak time', trackIds: ['t2'], generated: true },
    ],
    activeSetId: 'set-2',
    playlists: [{ name: 'Openers', trackIds: ['t1'] }],
    radialAxis: 'year',
    colorAxis: 'bpm',
    analysis: null,
  })

  // Every settings field carries a NON-default-but-valid value: proof that a
  // valid save survives the per-field sanitize byte-for-byte.
  const settingsA: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    theme: 'dark',
    colorScheme: 'violet',
    slotSpreadFactor: 1.7,
    jitterSeed: 3,
    edgeOpacity: 0.9,
    focusClusterEdges: true,
    suggestLength: 99,
    suggestRandomness: 0.8,
    iconMode: 'clusters',
    maxGenreClasses: 8,
    bpmProgression: 'sawtooth',
    manualEdgeWeight: 7.5,
    advancedOpen: ['genres', 'display'],
    uiMode: 'easy',
    showLeftPanel: false,
    showRightPanel: true,
    audioPreview: false,
    analysisWriteTags: true,
  }

  // A second fixture with a DIFFERENT valid value on every field.
  const settingsB: AppSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    theme: 'light',
    colorScheme: 'aqua',
    slotSpreadFactor: 0.5,
    jitterSeed: 0,
    edgeOpacity: 0.1,
    focusClusterEdges: false,
    suggestLength: 2,
    suggestRandomness: 0,
    iconMode: 'playlists',
    maxGenreClasses: 1,
    bpmProgression: 'rising',
    manualEdgeWeight: 0,
    visibleFilters: ['bpm', 'year'],
    advancedOpen: [],
    uiMode: 'advanced',
    showLeftPanel: true,
    showRightPanel: false,
    audioPreview: true,
  }

  test('fixture A (every settings field non-default) round-trips byte-identically', () => {
    const s = serializeProject(buildValid(settingsA))
    expect(serializeProject(parseProject(s))).toBe(s)
  })

  test('fixture B (a different valid value on every field) round-trips byte-identically', () => {
    const s = serializeProject(buildValid(settingsB))
    expect(serializeProject(parseProject(s))).toBe(s)
  })
})

describe('WS6 garbage inputs resolve to defaults (v14.1)', () => {
  test('garbage settings fields each fall back to their default', () => {
    const raw = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    raw.settings.theme = 'purple'
    raw.settings.edgeOpacity = 'high'
    raw.settings.suggestLength = NaN
    raw.settings.bpmProgression = 7
    raw.settings.advancedOpen = 'yes'
    raw.settings.showLeftPanel = 'nope'
    const s = parseProject(JSON.stringify(raw)).settings
    expect(s.theme).toBe(null)
    expect(s.edgeOpacity).toBe(DEFAULT_SETTINGS.edgeOpacity)
    expect(s.suggestLength).toBe(DEFAULT_SETTINGS.suggestLength)
    expect(s.bpmProgression).toBe('any')
    expect(s.advancedOpen).toEqual([])
    expect(s.showLeftPanel).toBe(DEFAULT_SETTINGS.showLeftPanel)
  })

  test('unknown criteria bpm keys never reach the output', () => {
    const raw = JSON.parse(serializeProject(project)) as { criteria: Record<string, unknown> }
    raw.criteria.bpm = { enabled: true, evil: 'x', maxPercent: 'lots' }
    const parsed = parseProject(JSON.stringify(raw))
    expect('evil' in parsed.criteria.bpm).toBe(false)
  })

  test('malformed playlist entries are dropped, valid ones kept (ids not pruned)', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    raw.playlists = [null, { name: 42 }, { name: 'ok', trackIds: ['a', 3] }]
    expect(parseProject(JSON.stringify(raw)).playlists).toEqual([{ name: 'ok', trackIds: ['a'] }])
  })

  test('a non-array playlists collapses to []', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    raw.playlists = 'nope'
    expect(parseProject(JSON.stringify(raw)).playlists).toEqual([])
  })
})

describe('vinyl flag removed (v14 WS1)', () => {
  test('a v5 save carrying isVinyl still parses, and serialized output carries no isVinyl', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    ;(raw.tracks as Record<string, unknown>[])[0].isVinyl = true
    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.tracks[0]).not.toHaveProperty('isVinyl')
    expect(serializeProject(parsed)).not.toContain('isVinyl')
  })
})

// v18 (#3/#8): the marks quick-filters add pseudo-keys to visibleFilters
// (which row shows in the panel — an ordinary persisted preference) while the
// filter STATE (filters.marks itself) stays session-only and always resets;
// see filter.ts's migrateFilters for why. Widened v23: 'starred'/'combos'/
// 'keys' are now permanent panel rows, back-filled into any save older than
// schema 8 — see the "permanent panel filters persistence" describe below.
describe('marks quick-filters persistence (v18 #3/#8)', () => {
  test('a saved active marks filter always parses back to all-off', () => {
    const raw = JSON.parse(serializeProject(project)) as { filters: Record<string, unknown> }
    raw.filters.marks = { starredOnly: true, comboOnly: true, constellationOnly: true }
    expect(parseProject(JSON.stringify(raw)).filters.marks).toEqual({
      starredOnly: false,
      comboOnly: false,
      constellationOnly: false,
    })
  })
})

// v23: ★ Starred, 🔗 Combos and 🎵 Keys are permanent panel rows. A save
// older than schema 8 predates them and back-fills all three into
// visibleFilters on load; schema 8+ is trusted verbatim, so a deliberate
// hide made after this wave sticks (Design §3). v25 widens the group to
// four (☰ Constellation), back-filled separately by a narrower version<10
// check — a save already at schema 8/9 has the first three but not it.
describe('permanent panel filters persistence (v23, widened v25)', () => {
  test('a v9 save back-fills just the constellation row', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.version = 9
    raw.filters.properties = {}
    raw.settings.visibleFilters = ['bpm', 'starred', 'combos', 'keys']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'starred',
      'combos',
      'keys',
      'constellation',
    ])
  })

  test('a v9 save that already lists constellation does not duplicate it', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.version = 9
    raw.filters.properties = {}
    raw.settings.visibleFilters = ['bpm', 'starred', 'combos', 'keys', 'constellation']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'starred',
      'combos',
      'keys',
      'constellation',
    ])
  })

  test("a v10 save with ['bpm'] keeps exactly ['bpm'] — the deliberate-hide case extends to constellation too", () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    expect(raw.version).toBe(10) // project already serializes at the current schema
    raw.filters.properties = {}
    raw.settings.visibleFilters = ['bpm']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual(['bpm'])
  })
  test('a v7 save back-fills all three permanent rows', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.version = 7
    raw.filters.properties = {} // keep the active-filter force-visible guard out of this test
    raw.settings.visibleFilters = ['bpm']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
  })

  test('a v7 save that already lists all three does not duplicate them', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.version = 7
    raw.filters.properties = {}
    raw.settings.visibleFilters = ['starred', 'bpm', 'combos', 'keys']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'starred',
      'bpm',
      'combos',
      'keys',
      'constellation',
    ])
  })

  test("a v8 save with ['bpm'] keeps exactly ['bpm'] — the deliberate-hide case", () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    expect(raw.version).toBe(10) // project already serializes at the current schema
    raw.filters.properties = {}
    raw.settings.visibleFilters = ['bpm']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual(['bpm'])
  })

  test("'keys' survives validation alongside 'starred'/'combos'; garbage still drops", () => {
    const raw = JSON.parse(serializeProject(project)) as {
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    raw.filters.properties = {}
    raw.settings.visibleFilters = ['starred', 'nonsense', 'combos', 'keys']
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'starred',
      'combos',
      'keys',
    ])
  })

  test('a v8 save with visibleFilters missing (not just empty) falls back to all seven default keys, not just the permanent rows', () => {
    const raw = JSON.parse(serializeProject(project)) as {
      version: number
      settings: Record<string, unknown>
      filters: Record<string, unknown>
    }
    expect(raw.version).toBe(10) // project already serializes at the current schema
    raw.filters.properties = {}
    Reflect.deleteProperty(raw.settings, 'visibleFilters')
    expect(parseProject(JSON.stringify(raw)).settings.visibleFilters).toEqual([
      'bpm',
      'year',
      'rating',
      'starred',
      'constellation',
      'combos',
      'keys',
    ])
  })
})

describe('descriptor persistence (v35)', () => {
  test('a descriptor already on a track survives a save and load round-trip', () => {
    const withDescriptors = {
      ...project,
      tracks: [{ ...SAMPLE_TRACKS[0], arousal: 78, valence: 47, danceability: 97, happiness: 23 }],
    }
    const parsed = parseProject(serializeProject(withDescriptors))

    expect(parsed.tracks[0].arousal).toBe(78)
    expect(parsed.tracks[0].valence).toBe(47)
    expect(parsed.tracks[0].danceability).toBe(97)
    expect(parsed.tracks[0].happiness).toBe(23)
  })

  test('a save predating the descriptors loads them as null, with no version bump', () => {
    const parsed = parseProject(serializeProject(project))

    expect(parsed.tracks[0].arousal).toBeNull()
    expect(parsed.tracks[0].happiness).toBeNull()
    expect(parsed.version).toBe(10)
  })

  test('a garbage descriptor is refused rather than carried through', () => {
    const bad = JSON.parse(serializeProject(project)) as Record<string, unknown>
    ;(bad.tracks as Record<string, unknown>[])[0].danceability = 'very'
    const parsed = parseProject(JSON.stringify(bad))

    expect(parsed.tracks[0].danceability).toBeNull()
  })
})

describe('analysis sidecar persistence (v33)', () => {
  const sidecar = {
    zodiacAnalysis: 1 as const,
    run: { analysedAt: '2026-08-25', tool: 'essentia-tensorflow 2.1b6', models: ['musicnn'] },
    tracks: { '/Users/dj/a.mp3': { bpm: 128.02, bpmConf: 0.93 } },
  }

  test('analysisWriteTags is additive — an older save loads as false (v38)', () => {
    const raw = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    delete raw.settings.analysisWriteTags

    expect(parseProject(JSON.stringify(raw)).settings.analysisWriteTags).toBe(false)
  })

  test('a saved analysisWriteTags survives the round-trip (v38)', () => {
    const raw = JSON.parse(serializeProject(project)) as { settings: Record<string, unknown> }
    raw.settings.analysisWriteTags = true

    expect(parseProject(JSON.stringify(raw)).settings.analysisWriteTags).toBe(true)
  })

  test('a sidecar survives a save and load round-trip', () => {
    const parsed = parseProject(serializeProject({ ...project, analysis: sidecar }))

    expect(parsed.analysis?.tracks['/Users/dj/a.mp3'].bpm).toBe(128.02)
    expect(parsed.analysis?.run?.tool).toBe('essentia-tensorflow 2.1b6')
  })

  test('a save with no analysis loads as null, with no version bump', () => {
    const parsed = parseProject(serializeProject(project))

    expect(parsed.analysis).toBeNull()
    // The field is additive with a safe default, like audioPreview (v28),
    // showLeftPanel (v30) and avoidSameArtist (v31). Bumping would make any
    // bundle rollback brick autosave restore, since parseProject throws on an
    // unknown version while restoreAutosave deliberately keeps what it cannot
    // read.
    expect(parsed.version).toBe(10)
  })

  test('a garbage sidecar resolves to null rather than loading', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    raw.analysis = { zodiacAnalysis: 99, tracks: 'nonsense' }

    expect(parseProject(JSON.stringify(raw)).analysis).toBeNull()
  })

  test('an older save that predates the field loads unharmed', () => {
    const raw = JSON.parse(serializeProject(project)) as Record<string, unknown>
    raw.version = 7
    delete raw.analysis

    const parsed = parseProject(JSON.stringify(raw))
    expect(parsed.analysis).toBeNull()
    expect(parsed.tracks.length).toBe(SAMPLE_TRACKS.length)
  })

  test('a valid save still round-trips byte-identically', () => {
    // A hand-written sidecar may omit fields; the first load fills them in as
    // nulls, which is the canonical form. From there the invariant holds.
    const canonical = serializeProject(
      parseProject(serializeProject({ ...project, analysis: sidecar })),
    )

    expect(serializeProject(parseProject(canonical))).toBe(canonical)
    expect(parseProject(canonical).analysis?.tracks['/Users/dj/a.mp3'].bpm).toBe(128.02)
  })
})
