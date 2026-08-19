import { describe, expect, test } from 'vitest'
import { enrichTrack, genreEnergyBaseline } from '../src/data/enrich'
import { genreFamilyOf } from '../src/core/genre'
import { audioQuality } from '../src/core/filter'
import { EMPTY_TRACK_FIELDS } from '../src/core/model'
import { REKORDBOX_COLOURS, TRACK_PROPERTIES } from '../src/core/properties'
import type { TrackSortField } from '../src/core/trackSort'
import { ALL_SAMPLE_PACKS, SAMPLE_COLLECTION, SAMPLE_PACKS } from '../src/data/samples'

describe('sample packs', () => {
  test('there are ten themed packs plus the classic demo', () => {
    expect(SAMPLE_PACKS).toHaveLength(11)
    expect(ALL_SAMPLE_PACKS).toHaveLength(12)
    expect(new Set(ALL_SAMPLE_PACKS.map((p) => p.id)).size).toBe(12)
  })

  test.each(SAMPLE_PACKS.map((p) => [p.name, p] as const))(
    '%s: has a substantial library of unique tracks',
    (_name, pack) => {
      expect(pack.tracks.length).toBeGreaterThanOrEqual(18)
      expect(new Set(pack.tracks.map((t) => t.id)).size).toBe(pack.tracks.length)
    },
  )
})

describe('the sample collection', () => {
  test('is named "Sample collection" and unions every pack', () => {
    expect(SAMPLE_COLLECTION.name).toBe('Sample collection')
    expect(SAMPLE_COLLECTION.tracks.length).toBe(
      ALL_SAMPLE_PACKS.reduce((sum, p) => sum + p.tracks.length, 0),
    )
  })

  test('track ids are globally unique across packs', () => {
    const ids = SAMPLE_COLLECTION.tracks.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('one playlist per pack, named after it, in pack order', () => {
    expect(SAMPLE_COLLECTION.playlists.map((p) => p.name)).toEqual(
      ALL_SAMPLE_PACKS.map((p) => p.name),
    )
  })

  test('every track appears in exactly one playlist', () => {
    const seen = new Map<string, number>()
    for (const playlist of SAMPLE_COLLECTION.playlists) {
      for (const id of playlist.trackIds) seen.set(id, (seen.get(id) ?? 0) + 1)
    }
    expect(seen.size).toBe(SAMPLE_COLLECTION.tracks.length)
    expect([...seen.values()].every((n) => n === 1)).toBe(true)
  })

  test('playlist members reference real collection tracks', () => {
    const ids = new Set(SAMPLE_COLLECTION.tracks.map((t) => t.id))
    for (const playlist of SAMPLE_COLLECTION.playlists) {
      for (const id of playlist.trackIds) expect(ids.has(id)).toBe(true)
    }
  })
})

describe('sample metadata enrichment (v9 issue 11)', () => {
  const tracks = SAMPLE_COLLECTION.tracks

  test.each(['album', 'durationSec', 'dateAdded'] as const)(
    '%s is present on most tracks but deliberately not all',
    (field) => {
      const have = tracks.filter((t) => t[field] !== null).length
      expect(have / tracks.length).toBeGreaterThan(0.7)
      expect(have).toBeLessThan(tracks.length) // realistic gaps survive
    },
  )

  test('generated values are plausible', () => {
    for (const t of tracks) {
      if (t.durationSec !== null) {
        expect(t.durationSec).toBeGreaterThanOrEqual(120)
        expect(t.durationSec).toBeLessThanOrEqual(600)
      }
      if (t.dateAdded !== null) {
        expect(t.dateAdded).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        const year = Number(t.dateAdded.slice(0, 4))
        expect(year).toBeGreaterThanOrEqual(2018)
        expect(year).toBeLessThanOrEqual(2025)
        // A file cannot enter the library before its release year.
        if (t.year !== null) expect(year).toBeGreaterThanOrEqual(Math.min(t.year, 2018))
      }
    }
  })

  test('enrichment is deterministic: same track in, same track out', () => {
    const base = tracks[0]
    const extras = { label: 'Test Label', albums: { [base.artist ?? '']: 'Test LP' } }
    expect(enrichTrack(base, extras)).toEqual(enrichTrack(base, extras))
  })
})

describe('the genre-atlas pack (v12 WS10)', () => {
  const atlas = SAMPLE_PACKS.find((p) => p.id === 'genre-atlas')

  test('exists and spans the genre space', () => {
    expect(atlas).toBeDefined()
    expect(atlas!.tracks.length).toBeGreaterThanOrEqual(24)
    const families = new Set(
      atlas!.tracks.map((t) => (t.genre === null ? null : genreFamilyOf(t.genre))).filter(Boolean),
    )
    // Jazz to gabber: at least ten distinct icon families on one crate.
    expect(families.size).toBeGreaterThanOrEqual(10)
  })

  test('carries Mixed-In-Key-style energy for the WS8 demo', () => {
    const withEnergy = atlas!.tracks.filter((t) => t.energy !== null)
    expect(withEnergy.length).toBeGreaterThanOrEqual(10)
    for (const t of withEnergy) expect(t.comments).toMatch(/Energy \d/)
  })
})

describe('genre-aware energy across the samples (issue #7)', () => {
  const classic = ALL_SAMPLE_PACKS.find((p) => p.id === 'classic')!

  test('the baseline tracks genre, not just BPM', () => {
    // Same BPM, different genre → different energy: proves it is genre-driven,
    // not just a re-skin of the old (bpm-60)/13 formula.
    expect(genreEnergyBaseline('Ambient', 120)).toBeLessThan(genreEnergyBaseline('Gabber', 120))
    expect(genreEnergyBaseline('Trip Hop', 174)).toBeLessThan(
      genreEnergyBaseline('Drum & Bass', 174),
    )
    for (const g of ['Ambient', 'Techno', 'Gabber', 'House', 'Downtempo', 'Unknown Genre']) {
      const e = genreEnergyBaseline(g, 120)
      expect(e).toBeGreaterThanOrEqual(1)
      expect(e).toBeLessThanOrEqual(10)
    }
  })

  test('Classic demo carries energy in 1..10 for most tracks (issue #7)', () => {
    const withE = classic.tracks.filter((t) => t.energy !== null)
    expect(withE.length).toBeGreaterThan(classic.tracks.length / 2)
    for (const t of withE) {
      expect(t.energy).toBeGreaterThanOrEqual(1)
      expect(t.energy).toBeLessThanOrEqual(10)
    }
  })

  test('every pack has energy coverage, with gaps', () => {
    for (const pack of ALL_SAMPLE_PACKS) {
      const withE = pack.tracks.filter((t) => t.energy !== null)
      expect(withE.length, `${pack.name} has no energy`).toBeGreaterThan(0)
    }
    // Gaps exist somewhere across the collection.
    expect(SAMPLE_COLLECTION.tracks.some((t) => t.energy === null)).toBe(true)
  })

  test('high-energy genres read hotter than low-energy ones across the collection', () => {
    const all = SAMPLE_COLLECTION.tracks
    const avg = (re: RegExp) => {
      const es = all
        .filter((t) => t.energy !== null && re.test(t.genre ?? ''))
        .map((t) => t.energy as number)
      return es.reduce((a, b) => a + b, 0) / es.length
    }
    const hot = avg(/techno|drum ?& ?bass|gabber|schranz|dubstep/i)
    const cool = avg(/ambient|downtempo|folk|jazz|blues|trip ?hop/i)
    expect(hot).toBeGreaterThan(cool + 1.5)
  })

  test('energy is deterministic for a fixed track id', () => {
    const base = {
      ...EMPTY_TRACK_FIELDS,
      id: 'classic-0',
      title: 'X',
      artist: 'Y',
      genre: 'Techno',
      bpm: 128,
    }
    const a = enrichTrack(base, { label: null, albums: {} })
    const b = enrichTrack(base, { label: null, albums: {} })
    expect(a.energy).toBe(b.energy)
  })
})

describe('sample metadata enrichment (v14 WS3)', () => {
  const tracks = SAMPLE_COLLECTION.tracks

  // Every field the newer enrichment adds; each must show deliberate gaps
  // (some null) alongside real coverage (some non-null) so every filter kind
  // has something to bite on.
  const NEWLY_GENERATED_FIELDS: TrackSortField[] = [
    'composer',
    'grouping',
    'remixer',
    'mix',
    'colour',
    'kind',
    'bitRate',
    'sampleRate',
    'trackNumber',
    'discNumber',
    'dateModified',
    'lastPlayed',
    'location',
    'size',
  ]

  test('every filterable property has at least one non-null value across the samples', () => {
    for (const prop of TRACK_PROPERTIES) {
      if (!prop.filterable) continue
      const have = tracks.filter((t) => t[prop.key] !== null).length
      expect(have, `${prop.key} is never non-null across the samples`).toBeGreaterThan(0)
    }
  })

  test.each(NEWLY_GENERATED_FIELDS)('%s carries deliberate gaps: at least one null', (field) => {
    const missing = tracks.filter((t) => t[field] === null).length
    expect(missing, `${field} is never null across the samples`).toBeGreaterThan(0)
  })

  test('every non-null kind is a recognised Rekordbox audio quality', () => {
    const kinds = tracks.filter((t) => t.kind !== null).map((t) => t.kind as string)
    expect(kinds.length).toBeGreaterThan(0)
    for (const kind of kinds) expect(audioQuality(kind)).not.toBeNull()
  })

  test('every non-null colour is one of the 8 standard Rekordbox tags', () => {
    const colours = tracks.filter((t) => t.colour !== null).map((t) => t.colour as string)
    expect(colours.length).toBeGreaterThan(0)
    const known = new Set(Object.keys(REKORDBOX_COLOURS))
    for (const colour of colours) expect(known.has(colour)).toBe(true)
  })

  test('size = durationSec * bitRate * 125, and only when both are known', () => {
    let checked = 0
    for (const t of tracks) {
      if (t.durationSec === null || t.bitRate === null) {
        expect(t.size).toBeNull()
      } else {
        expect(t.size).toBe(Math.round(t.durationSec * t.bitRate * 125))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('bitRate is correlated with kind: lossless kinds carry the lossless rate', () => {
    let checked = 0
    for (const t of tracks) {
      if (t.kind === null) {
        expect(t.bitRate).toBeNull()
        continue
      }
      expect(t.bitRate).not.toBeNull()
      if (audioQuality(t.kind) === 'lossless') {
        expect(t.bitRate).toBe(1411)
      } else {
        expect([320, 256, 192]).toContain(t.bitRate)
      }
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('sampleRate is 44100 or 48000 Hz when present', () => {
    const rates = tracks.filter((t) => t.sampleRate !== null).map((t) => t.sampleRate)
    expect(rates.length).toBeGreaterThan(0)
    for (const r of rates) expect([44100, 48000]).toContain(r)
  })

  test('trackNumber is 1-12 when present', () => {
    const numbers = tracks.filter((t) => t.trackNumber !== null).map((t) => t.trackNumber as number)
    expect(numbers.length).toBeGreaterThan(0)
    for (const n of numbers) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(12)
    }
  })

  test('discNumber is mostly 1 when present', () => {
    const numbers = tracks.filter((t) => t.discNumber !== null).map((t) => t.discNumber as number)
    expect(numbers.length).toBeGreaterThan(0)
    const ones = numbers.filter((n) => n === 1).length
    expect(ones / numbers.length).toBeGreaterThan(0.5)
  })

  test('dateModified is on/after dateAdded when both are known', () => {
    let checked = 0
    for (const t of tracks) {
      if (t.dateAdded !== null && t.dateModified !== null) {
        expect(t.dateModified >= t.dateAdded).toBe(true)
        checked++
      }
    }
    expect(checked).toBeGreaterThan(0)
  })

  test('lastPlayed is present iff playCount > 0', () => {
    let checkedNonNull = 0
    let checkedNull = 0
    for (const t of tracks) {
      const played = t.playCount !== null && t.playCount > 0
      expect(t.lastPlayed !== null).toBe(played)
      if (played) checkedNonNull++
      else checkedNull++
    }
    expect(checkedNonNull).toBeGreaterThan(0)
    expect(checkedNull).toBeGreaterThan(0)
  })

  test('location follows the demo convention and matches the kind extension', () => {
    const withLocation = tracks.filter((t) => t.location !== null)
    expect(withLocation.length).toBeGreaterThan(0)
    for (const t of withLocation) {
      expect(t.location).toMatch(/^\/Users\/dj\/Music\/[^/]+\/.+\.\w+$/)
      if (t.kind !== null) {
        if (audioQuality(t.kind) === 'lossless') {
          expect(t.location).toMatch(/\.(wav|aiff|flac)$/)
        } else {
          expect(t.location).toMatch(/\.(mp3|aac)$/)
        }
      }
    }
  })

  test('authored year survives enrichment untouched (enrichTrack never overwrites track.year)', () => {
    const withYear = tracks.filter((t) => t.year !== null)
    expect(withYear.length).toBeGreaterThan(0)
    // Re-enrichment is a no-op on year: it is never part of enrichTrack's
    // return overrides, so feeding an already-enriched track back through
    // must leave year exactly as it is.
    for (const t of withYear.slice(0, 5)) {
      const extras = { label: t.label, albums: {} }
      expect(enrichTrack(t, extras).year).toBe(t.year)
    }
  })

  test('enrichment is deterministic across every generated field: two runs identical', () => {
    const base = tracks[0]
    const extras = { label: 'Test Label', albums: { [base.artist ?? '']: 'Test LP' } }
    const a = enrichTrack(base, extras)
    const b = enrichTrack(base, extras)
    expect(a).toEqual(b)
    for (const field of NEWLY_GENERATED_FIELDS) expect(a[field]).toEqual(b[field])
  })
})
