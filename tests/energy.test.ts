import { describe, expect, test } from 'vitest'
import { energyFromComments, EMPTY_TRACK_FIELDS } from '../src/core/model'
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
<DJ_PLAYLISTS Version="1.0.0"><COLLECTION Entries="2">
<TRACK TrackID="1" Name="A" Artist="X" Comments="Energy 8" AverageBpm="128" Tonality="8A"/>
<TRACK TrackID="2" Name="B" Artist="Y" Comments="no tag here" AverageBpm="126" Tonality="9A"/>
</COLLECTION><PLAYLISTS><NODE Type="0" Name="ROOT" Count="0"/></PLAYLISTS></DJ_PLAYLISTS>`
    const { tracks } = importRekordboxXml(xml)
    expect(tracks[0].energy).toBe(8)
    expect(tracks[1].energy).toBeNull()
  })
})
