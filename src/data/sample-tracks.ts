import type { Track } from '../core/model'
import { normalizeKey } from '../core/keys'

// Fictional demo library so the app shows its value before any import.
// Fields: title, artist, key, bpm, genre, year, rating (null = missing).
type Row = [
  string,
  string | null,
  string | null,
  number | null,
  string | null,
  number | null,
  number | null,
]

const ROWS: Row[] = [
  ['Midnight Drive', 'Nova Pulse', '8A', 128, 'Techno', 2019, 4],
  ['Concrete Bloom', 'Nova Pulse', '8A', 130, 'Techno', 2021, 5],
  ['Red Shift', 'Ferro', '9A', 132, 'Techno', 2020, 4],
  ['Warehouse Prayer', 'Ferro', '9A', 129, 'Techno', 2018, 3],
  ['Signal Path', 'Mira Volt', '7A', 126, 'Techno', 2022, 4],
  ['Rotor', 'Mira Volt', '8B', 127, 'Techno', 2022, 3],
  ['Pale Static', 'Kern', '10A', 134, 'Techno', 2017, 2],
  ['Iron Garden', 'Kern', '6A', 124, 'Techno', 2023, 5],
  ['Glasswork', 'Aurora Fields', '8A', 122, 'Melodic House', 2021, 5],
  ['Slow Horizon', 'Aurora Fields', '9A', 121, 'Melodic House', 2020, 4],
  ['Amber Waves', 'Lumen', '9B', 123, 'Melodic House', 2022, 4],
  ['Under Glass', 'Lumen', '10B', 120, 'Melodic House', 2019, 3],
  ['Salt & Light', 'Cerulean', '11B', 118, 'Melodic House', 2023, 4],
  ['Night Swim', 'Cerulean', '12B', 122, 'Melodic House', 2024, 5],
  ['Driftline', 'Aya Reyes', '7B', 119, 'Melodic House', 2021, 3],
  ['Low Tide', 'Aya Reyes', '8B', 117, 'Melodic House', 2018, 2],
  ['Seven Bridges', 'Kasteel', '11A', 174, 'Drum & Bass', 2023, 3],
  ['Paper Lanterns', 'Kasteel', '12A', 172, 'Drum & Bass', 2022, 4],
  ['Broken Compass', 'Verdigris', '12A', 174, 'Drum & Bass', 2024, 5],
  ['Northern Line', 'Verdigris', '1A', 176, 'Drum & Bass', 2023, 4],
  ['Smoke Ring', 'Halide', '10A', 170, 'Drum & Bass', 2020, 3],
  ['Copper Veins', 'Halide', '11A', 178, 'Drum & Bass', 2021, 2],
  ['First Light', 'Meridian Arc', '4B', 138, 'Trance', 2019, 4],
  ['Ion Trail', 'Meridian Arc', '5B', 140, 'Trance', 2020, 5],
  ['Afterglow', 'Solstice', '5A', 138, 'Trance', 2018, 3],
  ['Stratus', 'Solstice', '6A', 136, 'Trance', 2021, 4],
  ['Zenith Falls', 'Polaris Twins', '3B', 142, 'Trance', 2022, 3],
  ['Aurora Gate', 'Polaris Twins', '4A', 140, 'Trance', 2023, 4],
  // Edge cases: missing metadata of various kinds.
  ['Untitled Dub', 'Greyfield', null, 140, null, null, null],
  ['White Label 03', null, '2A', null, 'Techno', null, null],
  ['Found Tape', 'Greyfield', null, null, null, 1997, 1],
  ['Basement Cut', 'Ferro', '9A', 131, 'Techno', null, null],
  ['Closing Chord', 'Aurora Fields', '9B', 120, 'Melodic House', 2024, null],
]

export const SAMPLE_TRACKS: Track[] = ROWS.map(
  ([title, artist, key, bpm, genre, year, rating], i) => ({
    id: `sample-${i}`,
    title,
    artist,
    key: normalizeKey(key),
    bpm,
    genre,
    year,
    rating,
    durationSec: null,
    album: null,
    dateAdded: null,
    location: null,
  }),
)
