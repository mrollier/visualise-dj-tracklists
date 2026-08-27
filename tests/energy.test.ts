import { describe, expect, test } from 'vitest'
import {
  applySourcePreference,
  energyFromComments,
  parseMikComment,
  EMPTY_TRACK_FIELDS,
  type Track,
} from '../src/core/model'
import { PROPERTY_BY_KEY } from '../src/core/properties'
import { importRekordboxXml } from '../src/core/importers/rekordbox'

describe('energyFromComments (v12 WS8)', () => {
  test('parses Mixed-In-Key-style tokens', () => {
    expect(energyFromComments('Energy 7')).toBe(7)
    expect(energyFromComments('8A - Energy 9 - great closer')).toBe(9)
    expect(energyFromComments('energy 10')).toBe(10)
    expect(energyFromComments('Energy: 5')).toBe(5)
    expect(energyFromComments('ENERGY 3')).toBe(3)
  })

  test('rejects out-of-range and unrelated numbers', () => {
    expect(energyFromComments('Energy 11')).toBeNull()
    expect(energyFromComments('Energy 0')).toBeNull()
    expect(energyFromComments('high energy banger')).toBeNull()
    expect(energyFromComments('128 BPM')).toBeNull()
    expect(energyFromComments('')).toBeNull()
    expect(energyFromComments(null)).toBeNull()
  })

  test('the Track model carries energy, default null', () => {
    expect(EMPTY_TRACK_FIELDS.energy).toBeNull()
  })

  test('energy is a filterable number property in the registry', () => {
    const p = PROPERTY_BY_KEY.get('energy')
    expect(p?.kind).toBe('number')
    expect(p?.filterable).toBe(true)
  })

  test('the Rekordbox importer derives energy from Comments', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="3">
<TRACK TrackID="1" Name="A" Artist="X" Comments="Energy 8" AverageBpm="128" Tonality="8A"/>
<TRACK TrackID="2" Name="B" Artist="Y" Comments="no tag here" AverageBpm="126" Tonality="9A"/>
<TRACK TrackID="3" Name="C" Artist="Z" Comments="10A - 126 - 7" AverageBpm="126" Tonality="9A"/>
</COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT" Count="0"/></PLAYLISTS></DJ_PLAYLISTS>`
    const { tracks } = importRekordboxXml(xml)
    expect(tracks[0].energy).toBe(8)
    expect(tracks[1].energy).toBeNull()
    expect(tracks[2].energy).toBe(7)
  })
})

describe('parseMikComment (v36)', () => {
  test('all eight MIK comment formats', () => {
    expect(parseMikComment('10A')).toEqual({ key: '10A', bpm: null, energy: null })
    expect(parseMikComment('Energy 7')).toEqual({ key: null, bpm: null, energy: 7 })
    expect(parseMikComment('10A - Energy 7')).toEqual({ key: '10A', bpm: null, energy: 7 })
    expect(parseMikComment('7')).toEqual({ key: null, bpm: null, energy: 7 })
    expect(parseMikComment('10A - 7')).toEqual({ key: '10A', bpm: null, energy: 7 })
    expect(parseMikComment('10A - 126')).toEqual({ key: '10A', bpm: 126, energy: null })
    expect(parseMikComment('10A - 126 - 7')).toEqual({ key: '10A', bpm: 126, energy: 7 })
    expect(parseMikComment('126 - 10A - 7')).toEqual({ key: '10A', bpm: 126, energy: 7 })
  })

  test('initial-zero Camelot keys normalize', () => {
    expect(parseMikComment('05A - 7')).toEqual({ key: '5A', bpm: null, energy: 7 })
    expect(parseMikComment('05A')).toEqual({ key: '5A', bpm: null, energy: null })
  })

  test('decimal tempo parses, out-of-band numbers do not', () => {
    expect(parseMikComment('10A - 126.05 - 7')).toEqual({ key: '10A', bpm: 126.05, energy: 7 })
    expect(parseMikComment('10A - 300')).toEqual({ key: '10A', bpm: null, energy: null })
    expect(parseMikComment('10A - 25')).toEqual({ key: '10A', bpm: null, energy: null })
  })

  test('prose and near-miss tokens never parse', () => {
    expect(parseMikComment('128 BPM')).toEqual({ key: null, bpm: null, energy: null })
    expect(parseMikComment('high energy banger')).toEqual({ key: null, bpm: null, energy: null })
    expect(parseMikComment('Track 7 - remix')).toEqual({ key: null, bpm: null, energy: null })
    expect(parseMikComment('d-floor filler')).toEqual({ key: null, bpm: null, energy: null })
    expect(parseMikComment('13A')).toEqual({ key: null, bpm: null, energy: null })
    expect(parseMikComment('')).toEqual({ key: null, bpm: null, energy: null })
    expect(parseMikComment(null)).toEqual({ key: null, bpm: null, energy: null })
  })

  test('Open Key notation is excluded from comment keys', () => {
    expect(parseMikComment('5d - 7')).toEqual({ key: null, bpm: null, energy: 7 })
  })

  test('trailing prose survives, first-of-each-kind wins', () => {
    expect(parseMikComment('8A - Energy 9 - great closer')).toEqual({
      key: '8A',
      bpm: null,
      energy: 9,
    })
  })

  test('energyFromComments delegates to the segment parser', () => {
    expect(energyFromComments('10A - 7')).toBe(7)
    expect(energyFromComments('10A - 126')).toBeNull()
    expect(energyFromComments('7')).toBe(7)
  })
})

describe('applySourcePreference (v36)', () => {
  const track = (fields: Partial<Track>): Track => ({
    id: 't1',
    title: 'T',
    ...EMPTY_TRACK_FIELDS,
    ...fields,
  })
  const REKORDBOX = { keySource: 'rekordbox', bpmSource: 'comments' } as const
  const DEFAULTS = { keySource: 'rekordbox', bpmSource: 'rekordbox' } as const
  const COMMENTS = { keySource: 'comments', bpmSource: 'comments' } as const

  test('defaults return the input array by reference', () => {
    const tracks = [track({ key: '8A', comments: '10A - 7' })]
    expect(applySourcePreference(tracks, DEFAULTS)).toBe(tracks)
  })

  test('comment key and bpm win when present', () => {
    const tracks = [track({ key: '8A', bpm: 128.5, comments: '126 - 10A - 7' })]
    const out = applySourcePreference(tracks, COMMENTS)
    expect(out[0].key).toBe('10A')
    expect(out[0].bpm).toBe(126)
  })

  test('falls back to the Rekordbox value when the comment has no token', () => {
    const tracks = [track({ key: '8A', bpm: 128.5, comments: 'Energy 7' })]
    const out = applySourcePreference(tracks, COMMENTS)
    expect(out[0].key).toBe('8A')
    expect(out[0].bpm).toBe(128.5)
  })

  test('per-field preference: only the comments-sourced field substitutes', () => {
    const tracks = [track({ key: '8A', bpm: 128.5, comments: '10A - 126 - 7' })]
    const out = applySourcePreference(tracks, REKORDBOX)
    expect(out[0].key).toBe('8A')
    expect(out[0].bpm).toBe(126)
  })

  test('nothing parsable anywhere returns the input array by reference', () => {
    const tracks = [track({ key: '8A', comments: 'great closer' }), track({ comments: null })]
    expect(applySourcePreference(tracks, COMMENTS)).toBe(tracks)
  })

  test('unchanged tracks keep their object identity', () => {
    const untouched = track({ key: '8A', comments: null })
    const tracks = [track({ key: '8A', comments: '10A - 7' }), untouched]
    const out = applySourcePreference(tracks, COMMENTS)
    expect(out).not.toBe(tracks)
    expect(out[1]).toBe(untouched)
  })
})
