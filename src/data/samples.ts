import { normalizeKey } from '../core/keys'
import { EMPTY_TRACK_FIELDS, type Playlist, type Track } from '../core/model'
import { enrichTrack, type PackExtras } from './enrich'
import { SAMPLE_TRACKS } from './sample-tracks'

/**
 * Ten themed sample libraries (remark 9). Every pack is fictional (artists
 * and titles invented) and genre-coherent in keys/BPMs/years. A couple of
 * packs deliberately keep missing-metadata edge cases, like real crates do.
 * They all load together as ONE "Sample collection" whose playlists panel
 * carries a playlist per pack — exactly like a Rekordbox XML import
 * (design-v6 §D).
 */
export interface SamplePack {
  id: string
  name: string
  description: string
  tracks: Track[]
}

// title, artist, key, bpm, genre, year, rating
type Row = [
  string,
  string | null,
  string | null,
  number | null,
  string | null,
  number | null,
  number | null,
]

// Fictional labels and albums per pack (v9 issue 11) — the curated half of
// the enrichment; durations/dates/play counts are hashed in enrichTrack.
const PACK_EXTRAS: Record<string, PackExtras> = {
  'peak-techno': {
    label: 'Kraftfeld',
    albums: {
      Voltkraft: 'Voltage Works',
      'Selene Marr': 'Lunar Faults',
      Duskwerk: 'Werkstatt',
      KOVA: 'Pressure Systems',
      Ferrite: 'Oxide',
      'Nadir Bloom': 'Perihelion',
    },
  },
  'liquid-dnb': {
    label: 'Riverline',
    albums: {
      'Alba Circuit': 'Estuary',
      Mireille: 'Sodium Nights',
      'Fen & Marrow': 'Wetlands',
      'Quiet Engine': 'Idle Hours',
      Tallowe: 'Candlewick',
    },
  },
  'melodic-sunset': {
    label: 'Golden Hour Recordings',
    albums: {
      'Cerulean Kites': 'Ferry Songs',
      'Ines Vela': 'Jacaranda LP',
      'Helio Marsh': 'Brackish',
      'Nocturne Bay': 'Bayside',
      Kastell: 'Sandstone',
    },
  },
  'trance-journey': {
    label: 'Anthemic',
    albums: {
      'Meridian Arc': 'Cathedrals',
      Aurelia: 'Golden Ratio',
      'Polar Route': 'Latitudes',
      'Elara Frost': 'Permafrost',
      'Stellar Ferry': 'Crossings',
    },
  },
  'uk-garage': {
    // White labels: the pack keeps label sparse via the null here.
    label: null,
    albums: {
      'Marlowe & Dux': 'Silk & Chrome',
      'Sable D': 'Signal EP',
      'Vex Almeida': 'Postcodes',
      Junia: 'Call Back EP',
      'Ostara Crew': 'Estate Tapes',
    },
  },
  'disco-funk': {
    label: 'Gold Leaf',
    albums: {
      'The Velvet Yards': 'Roller Rink',
      'Otis Fontaine': 'Gravity LP',
      'Ripe Cuts': 'Fruit Machine',
      'Delphine Gold': 'Champagne Years',
      'Marceau Bros.': 'Revue',
    },
  },
  'deep-classic-house': {
    label: 'South Loop',
    albums: {
      'Marshall Keys': 'Warehouse Sermons',
      'Roux Deville': 'Deville LP',
      'Nina Solace': 'Small Hours EP',
      'Bram Oduya': 'Ecologies',
      'Cato & Pearl': 'Garden Level LP',
    },
  },
  'halftime-bass': {
    label: 'Subsoil',
    albums: {
      'Grey Mantis': 'Tar Pit EP',
      Okto: 'Ferrofluid EP',
      'Split Signal': 'Twin Engine LP',
      'Vantablack Audio': 'Event Horizon EP',
    },
  },
  'organic-downtempo': {
    label: 'Terracotta',
    albums: {
      'Sol Reverie': 'Clay Lanterns LP',
      'Anouk Meadow': 'Fig Season EP',
      Tembo: 'Caravan Dust LP',
      Ilma: 'Moon Tea EP',
    },
  },
  'hard-industrial': {
    label: 'Blast Works',
    albums: {
      'Krupp 9': 'Blast Furnace EP',
      'Mara Volt': 'Cooling Tower EP',
      'DK Ostwald': 'Drop Forge LP',
      'Vice Grip': 'Impact Wrench EP',
    },
  },
}

function pack(id: string, name: string, description: string, rows: Row[]): SamplePack {
  const extras = PACK_EXTRAS[id] ?? { label: null, albums: {} }
  const tracks: Track[] = rows.map(([title, artist, key, bpm, genre, year, rating], i) =>
    enrichTrack(
      {
        ...EMPTY_TRACK_FIELDS,
        id: `${id}-${i}`,
        title,
        artist,
        key: normalizeKey(key),
        bpm,
        genre,
        year,
        rating,
      },
      extras,
    ),
  )
  return { id, name, description, tracks }
}

export const SAMPLE_PACKS: SamplePack[] = [
  pack(
    'peak-techno',
    'Peak-Time Techno',
    'Driving 128–134 BPM warehouse material, minor keys front to back.',
    [
      ['Tension Coil', 'Voltkraft', '5A', 130, 'Techno', 2021, 4],
      ['Black Poly', 'Voltkraft', '6A', 131, 'Techno', 2022, 5],
      ['Falling Grid', 'Voltkraft', '8A', 133, 'Peak Time Techno', 2023, 3],
      ['Mercury Arc', 'Selene Marr', '6A', 129, 'Techno', 2020, 4],
      ['Night Shift', 'Selene Marr', '7A', 130, 'Peak Time Techno', 2022, 5],
      ['Afterimage', 'Selene Marr', '9A', 132, 'Techno', 2024, 4],
      ['Rust Ritual', 'Duskwerk', '7A', 132, 'Techno', 2019, 3],
      ['Iron Lung', 'Duskwerk', '8A', 134, 'Hard Techno', 2021, 4],
      ['Bunker Light', 'Duskwerk', '10A', 133, 'Techno', 2023, 2],
      ['Static Bloom', 'KOVA', '8A', 128, 'Peak Time Techno', 2022, 5],
      ['Verglas', 'KOVA', '9A', 130, 'Techno', 2023, 4],
      ['Pressure Test', 'KOVA', '11A', 134, 'Hard Techno', 2024, 3],
      ['Redline District', 'Ferrite', '9A', 131, 'Techno', 2021, 4],
      ['Smoke Column', 'Ferrite', '10A', 132, 'Techno', 2022, 3],
      ['Bare Metal', 'Ferrite', '12A', 129, 'Techno', 2020, 2],
      ['Slow Sirens', 'Nadir Bloom', '10A', 128, 'Melodic Techno', 2023, 4],
      ['Glass Delta', 'Nadir Bloom', '11A', 129, 'Melodic Techno', 2024, 5],
      ['Half Light', 'Nadir Bloom', '12A', 127, 'Melodic Techno', 2022, 3],
      ['Concrete Choir', 'Voltkraft', '4A', 130, 'Techno', 2019, 3],
      ['Signal Fade', 'Selene Marr', '5A', 128, 'Techno', 2018, 2],
      ['Kiln', 'Duskwerk', '6B', 132, 'Techno', 2023, 3],
      ['Overcurrent', 'KOVA', '7B', 133, 'Hard Techno', 2024, 4],
    ],
  ),
  pack(
    'liquid-dnb',
    'Liquid Drum & Bass',
    'Rolling 170–176 BPM liquid: warm pads, long blends, gentle key steps.',
    [
      ['River Mouth', 'Alba Circuit', '9A', 172, 'Liquid Funk', 2021, 5],
      ['Held Breath', 'Alba Circuit', '10A', 174, 'Liquid Funk', 2022, 4],
      ['Winter Sun', 'Alba Circuit', '11A', 173, 'Drum & Bass', 2023, 4],
      ['Paper Boats', 'Mireille', '10A', 170, 'Liquid Funk', 2020, 5],
      ['Sodium Glow', 'Mireille', '11A', 172, 'Liquid Funk', 2021, 3],
      ['Last Orders', 'Mireille', '12A', 174, 'Drum & Bass', 2023, 4],
      ['Deep Cartography', 'Fen & Marrow', '11A', 175, 'Drum & Bass', 2019, 4],
      ['Salt Marsh', 'Fen & Marrow', '12A', 173, 'Liquid Funk', 2020, 3],
      ['Heron', 'Fen & Marrow', '1A', 174, 'Drum & Bass', 2022, 5],
      ['Undertow', 'Quiet Engine', '12A', 176, 'Drum & Bass', 2024, 4],
      ['Sighline', 'Quiet Engine', '1A', 172, 'Liquid Funk', 2023, 3],
      ['Everything After', 'Quiet Engine', '2A', 174, 'Liquid Funk', 2024, 5],
      ['Glasshouse Dub', 'Tallowe', '1A', 170, 'Drum & Bass', 2018, 3],
      ['Northern Soul', 'Tallowe', '2A', 171, 'Liquid Funk', 2019, 4],
      ['Meantime', 'Tallowe', '3A', 173, 'Drum & Bass', 2021, 2],
      ['Cirrus Street', 'Alba Circuit', '8A', 170, 'Liquid Funk', 2020, 3],
      ['Low Water', 'Mireille', '9B', 172, 'Liquid Funk', 2022, 4],
      ['Foxes', 'Fen & Marrow', '10B', 174, 'Drum & Bass', 2023, 3],
      ['Care Label', 'Quiet Engine', '11B', 173, 'Liquid Funk', 2024, 2],
      ['Old Light', 'Tallowe', '12B', 175, 'Drum & Bass', 2022, 3],
    ],
  ),
  pack(
    'melodic-sunset',
    'Melodic House Sunset',
    'A 118–124 BPM golden-hour arc from warm major keys into dusky minors.',
    [
      ['First Ferry', 'Cerulean Kites', '4B', 118, 'Melodic House', 2022, 4],
      ['Apricot Sky', 'Cerulean Kites', '5B', 120, 'Melodic House', 2023, 5],
      ['Shore Leave', 'Cerulean Kites', '6B', 121, 'Progressive House', 2024, 4],
      ['Terracotta', 'Ines Vela', '5B', 119, 'Melodic House', 2021, 4],
      ['Jacaranda', 'Ines Vela', '6B', 122, 'Melodic House', 2022, 5],
      ['Amber Standing', 'Ines Vela', '7B', 123, 'Progressive House', 2023, 3],
      ['Long Shadows', 'Helio Marsh', '6B', 120, 'Melodic House', 2020, 3],
      ['Salt & Citrus', 'Helio Marsh', '7B', 121, 'Melodic House', 2022, 4],
      ['Tidewrack', 'Helio Marsh', '8B', 122, 'Deep House', 2023, 3],
      ['Violet Hour', 'Nocturne Bay', '7A', 122, 'Melodic House', 2023, 5],
      ['Sea Glass', 'Nocturne Bay', '8A', 121, 'Melodic House', 2024, 4],
      ['Afterlight', 'Nocturne Bay', '9A', 123, 'Progressive House', 2024, 5],
      ['Dune Path', 'Kastell', '8B', 119, 'Deep House', 2021, 3],
      ['Warm Static', 'Kastell', '9B', 120, 'Melodic House', 2022, 4],
      ['Slow Portrait', 'Kastell', '10B', 122, 'Melodic House', 2023, 2],
      ['Night Bus Home', 'Cerulean Kites', '10A', 124, 'Melodic House', 2024, 4],
      ['Petrichor', 'Ines Vela', '11A', 123, 'Progressive House', 2024, 3],
      ['Last Colour', 'Helio Marsh', '9A', 122, 'Melodic House', 2023, 4],
      ['Harbour Lights', 'Nocturne Bay', '6A', 120, 'Deep House', 2022, 3],
      ['Wisteria', 'Kastell', '5A', 118, 'Melodic House', 2021, 2],
    ],
  ),
  pack(
    'trance-journey',
    'Trance Journey',
    'Classic 134–140 BPM uplift: long breakdowns, fifths up the wheel.',
    [
      ['Ion Cathedral', 'Meridian Arc', '2B', 136, 'Uplifting Trance', 2001, 5],
      ['Solar Wind', 'Meridian Arc', '3B', 138, 'Trance', 2003, 4],
      ['Twelve Horizons', 'Meridian Arc', '4B', 138, 'Uplifting Trance', 2005, 5],
      ['White Dunes', 'Aurelia', '3B', 136, 'Trance', 2000, 4],
      ['Skylark', 'Aurelia', '4B', 137, 'Progressive Trance', 2002, 3],
      ['Heliograph', 'Aurelia', '5B', 139, 'Uplifting Trance', 2004, 5],
      ['Night Orbit', 'Polar Route', '4A', 138, 'Trance', 2006, 4],
      ['Aurora Line', 'Polar Route', '5A', 138, 'Progressive Trance', 2008, 4],
      ['Meridian Zero', 'Polar Route', '6A', 140, 'Uplifting Trance', 2009, 3],
      ['Signal Mountain', 'Elara Frost', '5B', 136, 'Trance', 2007, 4],
      ['Cloudline', 'Elara Frost', '6B', 137, 'Progressive Trance', 2009, 3],
      ['Ninth Wave', 'Elara Frost', '7B', 139, 'Uplifting Trance', 2010, 5],
      ['Antumbra', 'Stellar Ferry', '6A', 134, 'Progressive Trance', 2019, 4],
      ['Palegrove', 'Stellar Ferry', '7A', 136, 'Trance', 2021, 3],
      ['Silver Route', 'Stellar Ferry', '8A', 138, 'Uplifting Trance', 2023, 4],
      ['Dawn Patrol', 'Meridian Arc', '1B', 135, 'Trance', 1999, 3],
      ['Vapour Trail', 'Aurelia', '2B', 136, 'Trance', 2001, 2],
      ['High Latitude', 'Polar Route', '7A', 139, 'Trance', 2010, 3],
      ['Afterburn', 'Elara Frost', '8B', 140, 'Uplifting Trance', 2011, 4],
      ['Terminus East', 'Stellar Ferry', '9A', 137, 'Progressive Trance', 2024, 3],
    ],
  ),
  pack(
    'uk-garage',
    'UK Garage & Bass',
    '128–135 BPM two-step and bassline; a few white labels with missing tags.',
    [
      ['Creased Silk', 'Marlowe & Dux', '3A', 132, 'UK Garage', 2001, 5],
      ['Ringtone Romance', 'Marlowe & Dux', '4A', 133, '2 Step', 2002, 4],
      ['Gold Hoops', 'Marlowe & Dux', '5A', 131, 'UK Garage', 2003, 4],
      ['Midnight Windows', 'Sable D', '4A', 130, '2 Step', 2000, 4],
      ['Pirate Signal', 'Sable D', '5A', 132, 'UK Garage', 2001, 3],
      ['Champagne Static', 'Sable D', '6A', 134, 'Bassline', 2004, 4],
      ['Low Ceiling', 'Vex Almeida', '5A', 133, 'Bassline', 2019, 4],
      ['Corner Shop Anthem', 'Vex Almeida', '6A', 135, 'UK Garage', 2021, 5],
      ['Nightbus Skank', 'Vex Almeida', '7A', 134, 'Bassline', 2022, 3],
      ['Velvet Rope', 'Junia', '6A', 130, 'UK Garage', 2020, 4],
      ['Missed Calls', 'Junia', '7A', 131, '2 Step', 2022, 5],
      ['Sugar Free', 'Junia', '8A', 133, 'UK Garage', 2023, 3],
      ['Rain On Chrome', 'Ostara Crew', '7A', 132, 'UK Bass', 2023, 4],
      ['Postcode Lottery', 'Ostara Crew', '8A', 134, 'Bassline', 2024, 3],
      ['Off License', 'Ostara Crew', '9A', 133, 'UK Bass', 2024, 2],
      ['White Label 07', null, '8A', 132, 'UK Garage', null, null],
      ['Untitled Two-Step', null, null, 131, '2 Step', 1999, null],
      ['Dub Plate 3', 'Sable D', '9A', 130, null, 2002, 2],
      ['Estate Of Mind', 'Marlowe & Dux', '2A', 130, 'UK Garage', 2000, 3],
      ['Last Entry', 'Junia', '10A', 132, 'UK Garage', 2024, 3],
    ],
  ),
  pack(
    'disco-funk',
    'Disco & Funk Edits',
    '105–120 BPM originals and modern re-edits — major keys, live drummers.',
    [
      ['Roller Rink Queen', 'The Velvet Yards', '7B', 112, 'Disco', 1978, 5],
      ['Mirrorball Money', 'The Velvet Yards', '8B', 114, 'Disco', 1979, 4],
      ['Satin Avenue', 'The Velvet Yards', '9B', 116, 'Disco', 1980, 4],
      ['Pocket Change', 'Otis Fontaine', '8B', 108, 'Funk', 1976, 5],
      ['Grits & Gravity', 'Otis Fontaine', '9B', 110, 'Funk', 1977, 4],
      ['Hot Property', 'Otis Fontaine', '10B', 112, 'Funk', 1979, 3],
      ['Midnight Mango (Edit)', 'Ripe Cuts', '9B', 115, 'Nu Disco', 2019, 4],
      ['Peach Fuzz (Edit)', 'Ripe Cuts', '10B', 117, 'Nu Disco', 2021, 5],
      ['Velvet Rework', 'Ripe Cuts', '11B', 118, 'Nu Disco', 2023, 4],
      ['Corner Booth', 'Delphine Gold', '10B', 110, 'Disco', 1981, 4],
      ['Long Stem Rose', 'Delphine Gold', '11B', 112, 'Disco', 1982, 3],
      ['Champagne Year', 'Delphine Gold', '12B', 114, 'Disco', 1983, 5],
      ['Bassline Balcony', 'Marceau Bros.', '11B', 116, 'Funk', 1980, 3],
      ['Rubber Soul Revue', 'Marceau Bros.', '12B', 118, 'Funk', 1981, 4],
      ['Gilded Lily', 'Marceau Bros.', '1B', 117, 'Disco', 1982, 2],
      ['Terrace Strut (Edit)', 'Ripe Cuts', '12B', 119, 'Nu Disco', 2022, 4],
      ['Neon Grove (Edit)', 'Ripe Cuts', '1B', 120, 'Nu Disco', 2024, 3],
      ['After The Encore', 'The Velvet Yards', '6B', 105, 'Funk', 1977, 3],
      ['Slow Elevator', 'Otis Fontaine', '5B', 106, 'Funk', 1975, 2],
      ['Last Dance Tax', 'Delphine Gold', '2B', 118, 'Disco', 1984, 3],
    ],
  ),
  pack(
    'deep-classic-house',
    'Classic & Deep House',
    'From late-80s Chicago to modern deep cuts, 120–125 BPM.',
    [
      ['Warehouse Sermon', 'Marshall Keys', '5A', 122, 'Chicago House', 1988, 5],
      ['Jack The Morning', 'Marshall Keys', '6A', 123, 'House', 1989, 4],
      ['Piano District', 'Marshall Keys', '7A', 124, 'House', 1991, 5],
      ['Blue Line', 'Roux Deville', '6A', 121, 'Deep House', 1992, 4],
      ['Corduroy', 'Roux Deville', '7A', 122, 'Deep House', 1994, 4],
      ['Harold’s Groove', 'Roux Deville', '8A', 123, 'House', 1995, 3],
      ['Attic Heat', 'Nina Solace', '7A', 120, 'Deep House', 2015, 4],
      ['Terracotta Dub', 'Nina Solace', '8A', 121, 'Deep House', 2017, 5],
      ['Small Hours', 'Nina Solace', '9A', 122, 'Deep House', 2019, 4],
      ['Loft Ecology', 'Bram Oduya', '8A', 123, 'House', 2020, 3],
      ['Paper Fan', 'Bram Oduya', '9A', 124, 'Deep House', 2021, 4],
      ['Sunday Repair', 'Bram Oduya', '10A', 125, 'House', 2023, 3],
      ['Vestibule', 'Cato & Pearl', '9B', 122, 'Deep House', 2018, 4],
      ['Late Registration', 'Cato & Pearl', '10B', 123, 'House', 2020, 3],
      ['Garden Level', 'Cato & Pearl', '11B', 124, 'Deep House', 2022, 5],
      ['Second Summer', 'Marshall Keys', '4A', 121, 'Acid House', 1989, 4],
      ['Roller Dex', 'Roux Deville', '5B', 123, 'House', 1993, 2],
      ['Foyer Music', 'Nina Solace', '10A', 121, 'Deep House', 2021, 3],
      ['Corner Pocket', 'Bram Oduya', '11A', 123, 'House', 2024, 3],
      ['Blue Hour Dub', 'Cato & Pearl', '12B', 122, 'Deep House', 2023, 2],
    ],
  ),
  pack(
    'halftime-bass',
    'Halftime & Bass',
    '85–88 next to 170–176 BPM — switch on half/double-time to link the two worlds.',
    [
      ['Knuckle Walk', 'Grey Mantis', '2A', 86, 'Halftime', 2020, 4],
      ['Tar Pit', 'Grey Mantis', '3A', 87, 'Halftime', 2021, 5],
      ['Sunken Lane', 'Grey Mantis', '4A', 85, 'Halftime', 2022, 3],
      ['Molasses', 'Okto', '3A', 88, 'Halftime', 2019, 4],
      ['Ferrofluid', 'Okto', '4A', 86, 'Bass Music', 2021, 4],
      ['Creeper Vine', 'Okto', '5A', 87, 'Halftime', 2023, 5],
      ['Double Vision', 'Split Signal', '2A', 172, 'Drum & Bass', 2020, 4],
      ['Twin Engine', 'Split Signal', '3A', 174, 'Drum & Bass', 2021, 5],
      ['Mirror Sprint', 'Split Signal', '4A', 170, 'Drum & Bass', 2022, 3],
      ['Redshift Runner', 'Vantablack Audio', '4A', 173, 'Neurofunk', 2021, 4],
      ['Carbon Fibre', 'Vantablack Audio', '5A', 174, 'Neurofunk', 2022, 4],
      ['Event Horizon', 'Vantablack Audio', '6A', 176, 'Drum & Bass', 2024, 5],
      ['Swamp Cooler', 'Grey Mantis', '5A', 172, 'Drum & Bass', 2023, 3],
      ['Slow Blink', 'Okto', '6A', 85, 'Halftime', 2024, 3],
      ['Pendulum Bite', 'Split Signal', '5A', 86, 'Halftime', 2023, 4],
      ['Iron Filings', 'Vantablack Audio', '3A', 87, 'Bass Music', 2020, 3],
      ['Loose Thread', 'Grey Mantis', '6A', 174, 'Drum & Bass', 2024, 2],
      ['Grave Wax', 'Okto', '7A', 175, 'Neurofunk', 2024, 3],
      ['Sidewinder', 'Split Signal', '1A', 170, 'Drum & Bass', 2019, 3],
      ['Charcoal', 'Vantablack Audio', '7A', 88, 'Halftime', 2023, 2],
    ],
  ),
  pack(
    'organic-downtempo',
    'Organic Downtempo',
    '95–115 BPM organic house and downtempo; a slow-burn opener set.',
    [
      ['Clay Lanterns', 'Sol Reverie', '9A', 102, 'Organic House', 2021, 4],
      ['Mango Rain', 'Sol Reverie', '10A', 105, 'Organic House', 2022, 5],
      ['Cedar Smoke', 'Sol Reverie', '11A', 108, 'Downtempo', 2023, 4],
      ['Rooftop Garden', 'Anouk Meadow', '10A', 100, 'Downtempo', 2020, 4],
      ['Ochre Valley', 'Anouk Meadow', '11A', 104, 'Organic House', 2021, 3],
      ['Fig Season', 'Anouk Meadow', '12A', 106, 'Organic House', 2023, 5],
      ['River Stones', 'Tembo', '11A', 98, 'Downtempo', 2019, 3],
      ['Caravan Dust', 'Tembo', '12A', 102, 'Organic House', 2020, 4],
      ['Sandalwood', 'Tembo', '1A', 105, 'Organic House', 2022, 4],
      ['Prayer Flags', 'Ilma', '12A', 110, 'Downtempo', 2022, 3],
      ['Moon Tea', 'Ilma', '1A', 112, 'Organic House', 2023, 4],
      ['Salt Flats', 'Ilma', '2A', 114, 'Organic House', 2024, 5],
      ['Weaver Bird', 'Sol Reverie', '8A', 100, 'Downtempo', 2020, 3],
      ['Long Grass', 'Anouk Meadow', '9A', 103, 'Downtempo', 2021, 2],
      ['Terracotta Steps', 'Tembo', '2A', 112, 'Organic House', 2023, 3],
      ['First Frost', 'Ilma', '3A', 115, 'Organic House', 2024, 4],
      ['Field Recording IV', 'Tembo', null, 96, 'Ambient', 2018, null],
      ['Hearth', 'Ilma', '3B', 110, 'Downtempo', null, 3],
      ['Slow Loom', 'Sol Reverie', '12B', 108, 'Downtempo', 2023, 2],
      ['Bramble', 'Anouk Meadow', '1B', 111, 'Organic House', 2024, 3],
    ],
  ),
  pack(
    'hard-industrial',
    'Hard & Industrial Techno',
    'Relentless 145–155 BPM concrete: distorted kicks, short blends.',
    [
      ['Angle Grinder', 'Krupp 9', '5A', 148, 'Hard Techno', 2022, 4],
      ['Blast Furnace', 'Krupp 9', '6A', 150, 'Industrial Techno', 2023, 5],
      ['Slag Heap', 'Krupp 9', '7A', 152, 'Hard Techno', 2024, 4],
      ['Cooling Tower', 'Mara Volt', '6A', 146, 'Industrial Techno', 2021, 4],
      ['Rebar', 'Mara Volt', '7A', 148, 'Hard Techno', 2022, 3],
      ['Gantry', 'Mara Volt', '8A', 151, 'Hard Techno', 2024, 5],
      ['Pneumatic Prayer', 'DK Ostwald', '7A', 150, 'Industrial Techno', 2022, 4],
      ['Drop Forge', 'DK Ostwald', '8A', 152, 'Hard Techno', 2023, 4],
      ['Sinter', 'DK Ostwald', '9A', 154, 'Schranz', 2024, 3],
      ['Third Rail', 'Vice Grip', '8A', 147, 'Hard Techno', 2021, 3],
      ['Cable Tray', 'Vice Grip', '9A', 149, 'Industrial Techno', 2022, 4],
      ['Impact Wrench', 'Vice Grip', '10A', 153, 'Schranz', 2024, 5],
      ['Dead Man’s Switch', 'Krupp 9', '9A', 150, 'Hard Techno', 2023, 3],
      ['Yellow Warning', 'Mara Volt', '10A', 151, 'Hard Techno', 2023, 4],
      ['Breaker Panel', 'DK Ostwald', '11A', 152, 'Industrial Techno', 2024, 3],
      ['Crush Depth', 'Vice Grip', '11A', 155, 'Schranz', 2024, 2],
      ['Night Shift II', 'Krupp 9', '4A', 145, 'Hard Techno', 2021, 3],
      ['Hazard Pay', 'Mara Volt', '12A', 150, 'Hard Techno', 2024, 3],
      ['Slow Crusher', 'DK Ostwald', '5B', 146, 'Industrial Techno', 2022, 2],
      ['Full Torque', 'Vice Grip', '6B', 149, 'Hard Techno', 2023, 3],
    ],
  ),
  withEnergy(
    pack(
      'genre-atlas',
      'Genre Atlas',
      'One crate across the whole map — jazz to gabber — so the genre views, icon families and umbrellas have room to shine.',
      [
        ['Blue Meridian', 'Kansai Trio', '4B', 126, 'Jazz', 1974, 4],
        ['Velvet Ladder', 'Odetta Vane', '9B', 100, 'Soul', 1971, 5],
        ['Copper Groove', 'The Brass Statutes', '10B', 108, 'Funk', 1977, 4],
        ['Bosphorus Wire', 'Derya Ekim', '1A', 105, 'Turkish Funk', 1975, 4],
        ['Late Reply', 'Cadence Roy', '6B', 92, 'R&B', 1998, 3],
        ['Concrete Letters', 'Marrow MC', '2A', 90, 'Hip Hop', 1994, 4],
        ['Fog Signal', 'Greyline', '11A', 82, 'Trip Hop', 1996, 5],
        ['Roots Antenna', 'Iron Lantern', '7B', 75, 'Reggae', 1979, 4],
        ['Echo Chamber', 'Iron Lantern', '7A', 70, 'Dub', 1980, 3],
        ['Lantern Yard', 'Sundial Crew', '3B', 98, 'Dancehall', 2004, 3],
        ['Cinnamon City', 'Adaeze Group', '5B', 112, 'Afrobeat', 1982, 4],
        ['Reeds', 'Still Water', '12A', null, 'Ambient', 2015, 3],
        ['Slow Orbit', 'Still Water', '12B', 96, 'Downtempo', 2017, 4],
        ['Pinhole', 'Aperture Logic', '10A', 160, 'IDM', 2001, 4],
        ['Gravel Youth', 'Motel Wires', '4A', 145, 'Indie Rock', 2006, 3],
        ['Neon Statues', 'Civic Mirror', '11B', 118, 'New Wave', 1983, 4],
        ['Mirrorball Law', 'Nova Casino', '2B', 116, 'Disco', 1978, 5],
        ['Terrace Steps', 'Ines Vela', '8B', 124, 'House', 2019, 4],
        ['Iron Meridian', 'Voltkraft', '8A', 132, 'Techno', 2021, 4],
        ['Riverrun', 'Alba Circuit', '9A', 174, 'Drum & Bass', 2018, 5],
        ['Hollow Mass', 'Vantablack Sound', '6A', 140, 'Dubstep', 2011, 3],
        ['Sun Temple', 'Goa Prism', '5A', 145, 'Psytrance', 2008, 3],
        ['Anvil Choir', 'Kernwapen', '3A', 190, 'Gabber', 1996, 2],
        ['Silk Tekno', 'Frei Klang', '4A', 175, 'Tekno', 2003, 3],
        ['Half Signal', 'Lowline', '1B', 87, 'Halftime', 2020, 4],
        ['Sawdust Waltz', 'Manège', '2B', 122, 'Electro Swing', 2012, 2],
        ['Harbour Hymn', 'Wren Calloway', null, 90, 'Folk', 1969, 3],
        ['Glass Bouquet', 'Petal Court', '7B', 110, 'Pop', 1987, 3],
        ['Delta Porch', 'Eli Marsh', '10B', 84, 'Blues', 1965, 4],
      ],
    ),
  ),
]

/**
 * The atlas doubles as the energy demo (v12 WS8): most of its tracks carry a
 * Mixed-In-Key-style "Energy N" comment, hash-free and deterministic —
 * roughly rising with BPM so the radius/colour axis reads sensibly.
 */
function withEnergy(base: SamplePack): SamplePack {
  return {
    ...base,
    tracks: base.tracks.map((t, i) => {
      if (i % 4 === 3) return t // realistic gaps
      const bpm = t.bpm ?? 100
      const energy = Math.max(1, Math.min(10, Math.round((bpm - 60) / 13)))
      const comments = t.comments === null ? `Energy ${energy}` : `${t.comments} - Energy ${energy}`
      return { ...t, comments, energy }
    }),
  }
}

/** The original mixed demo library, kept as one more pack/playlist. */
export const CLASSIC_PACK: SamplePack = {
  id: 'classic',
  name: 'Classic demo',
  description: 'The original mixed demo library: house, techno, trance and edge cases.',
  tracks: SAMPLE_TRACKS,
}

/** Every sample pack: the classic demo first, then the themed packs. */
export const ALL_SAMPLE_PACKS: SamplePack[] = [CLASSIC_PACK, ...SAMPLE_PACKS]

export interface SampleCollection {
  name: string
  tracks: Track[]
  playlists: Playlist[]
}

/**
 * All packs as one library with a playlist per pack — "Load sample" loads
 * this, and from there it behaves exactly like an imported collection XML:
 * empty wheel, playlists panel, toggle what you want to work in.
 */
export const SAMPLE_COLLECTION: SampleCollection = {
  name: 'Sample collection',
  tracks: ALL_SAMPLE_PACKS.flatMap((p) => p.tracks),
  playlists: ALL_SAMPLE_PACKS.map((p) => ({
    name: p.name,
    trackIds: p.tracks.map((t) => t.id),
  })),
}
