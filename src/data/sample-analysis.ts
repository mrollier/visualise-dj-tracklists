import type { AnalysisEntry, AnalysisSidecar } from '../core/analysis'
import type { Track } from '../core/model'
import { hashUnit } from '../core/random'

/**
 * A generated analysis sidecar for the sample collection (v35.1), so the four
 * descriptor filters and columns have something to act on before anyone owns a
 * real sidecar.
 *
 * It is a SIDECAR, not extra fields on `SAMPLE_TRACKS`, for the reason
 * `stores.ts` gives for keeping `trackById` raw: analysis-derived numbers must
 * never sit in the library as Rekordbox-looking truth. Going through the real
 * `mergeAnalysis` means the demo gets the provenance underlines, the import
 * report and the join's own not-found accounting for free — and the merge path
 * itself is exercised by the demo rather than only by tests.
 *
 * Values are RAW model output (affect on 1-9, class probabilities on 0-1), not
 * the percentages Track carries. `mergeAnalysis` applies `percentFromAffect` /
 * `percentFromUnit`, so the demo cannot drift from the real scale conversion.
 */

const SEED = 0x5eed35

/**
 * Genre → the mean percentage the real models return, as
 * `[genre, arousal, valence, danceability, happiness]`.
 *
 * MEASURED, not estimated: every unmarked row is the mean over the v34 run of
 * the real 2040-track collection (`essentia-tensorflow 2.1b6.dev1438`, the same
 * four models), joined to that collection's own Rekordbox genre tags, using
 * only genres with at least 8 tracks. Published literature on these dimensions
 * is almost all Spotify audio features, which is a DIFFERENT instrument on a
 * different scale — matching it would make the demo disagree with what a user's
 * own sidecar produces, which is the only number this app ever shows.
 *
 * Two things the table exists to preserve, both counter-intuitive and both
 * invisible if the numbers were guessed from the genre names:
 *
 *  - `happiness` is not valence. The `mood_happy` head fires on acoustic,
 *    played, major-key music, so disco (69) and funk (69) sit far above house
 *    (26) and trance (15) while their valences differ by only a few points. It
 *    is closer to an organic/electronic detector than to a mood.
 *  - `danceability` saturates. Nearly every four-to-the-floor genre lands
 *    between 92 and 98, so the axis separates band music from club music and
 *    almost nothing else.
 *
 * Ordered most-specific first, same as `GENRE_ENERGY`.
 */
const GENRE_DESCRIPTORS: readonly (readonly [RegExp, number, number, number, number])[] = [
  [/gabber|hardcore|speedcore|schranz|\btekno\b/i, 67, 51, 98, 18], // ≈ measured acid techno
  [/hard techno|industrial techno|acid techno/i, 67, 52, 98, 18],
  [/melodic techno|techno melancholic/i, 59, 49, 96, 8],
  [/minimal techno/i, 53, 57, 95, 5],
  [/tech house/i, 63, 58, 98, 16],
  [/\btechno\b/i, 62, 55, 97, 21],
  [/psytrance|goa/i, 61, 51, 93, 3],
  [/hard ?trance/i, 67, 51, 97, 19],
  [/trance/i, 62, 52, 95, 15],
  [/organic house|house ethno|afro house/i, 46, 51, 92, 12],
  [/deep house|minimal house/i, 53, 56, 92, 20],
  [/funky house/i, 66, 63, 97, 48],
  [/house/i, 61, 60, 96, 26],
  [/italo/i, 65, 65, 98, 71],
  [/nu ?disco/i, 65, 63, 98, 56],
  [/disco/i, 61, 64, 94, 69],
  [/turkish|persian|afrobeat|reggae|dancehall/i, 53, 55, 62, 78],
  [/future garage|halftime/i, 45, 46, 86, 7],
  [/uk garage|garage|2 ?step|bassline|breakbeat|breaks|footwork/i, 56, 51, 96, 22],
  // Above the band-music row below, or "Liquid Funk" reads as funk.
  [/liquid funk|neurofunk|drum ?& ?bass|\bdnb\b|d&b|dubstep|\bbass\b/i, 51, 48, 94, 14],
  [/jungle/i, 56, 51, 94, 24],
  [/\bfunk\b|soul|electro swing/i, 57, 57, 85, 69],
  [/\bidm\b|electro/i, 62, 54, 98, 15],
  [/lo-?fi|downtempo|chill|trip ?hop/i, 48, 53, 93, 9],
  [/hip ?hop|\bdub\b/i, 52, 53, 93, 25], // estimated — anchored on lo-fi
  [/\bpop\b|r&b|\brnb\b|indie|new wave/i, 61, 62, 86, 69],
  [/jazz|blues|folk/i, 50, 56, 58, 78], // estimated — anchored on the acoustic funk rows
  [/ambient/i, 40, 50, 35, 10], // estimated — nothing this quiet is in the real collection
]

/**
 * The fallback for a genre no row matches — measured the same way, over the 280
 * real tracks carrying no genre tag at all.
 */
const UNTAGGED = [58, 57, 91, 35] as const

/**
 * Within-genre standard deviation in percentage points, measured as the spread
 * left over once each genre's own mean is removed.
 *
 * These are the whole point of generating from a distribution rather than from
 * a genre constant plus a token wobble: genre explains only 26% of the real
 * variance in arousal, 38% in valence, 31% in danceability and 48% in
 * happiness. A demo whose genre fixed the value would make every descriptor
 * sort come out as a genre sort, and teach a DJ to expect a precision these
 * models do not have.
 *
 * Nothing renormalises after the 0-100 clamp, deliberately: the real
 * distributions pile up against both ends (danceability at 100, happiness at 0)
 * and clamping a normal draw is what reproduces that pile.
 */
const SPREAD = [7.6, 5.7, 11.4, 20.3] as const

/**
 * How much of each track's deviation is shared across all four axes. Within a
 * genre the real residuals correlate +0.39 to +0.54 on five of the six pairs,
 * so one common factor at this loading (0.6² ≈ 0.36) reproduces them closely.
 *
 * The sixth pair is danceability/happiness, +0.02 in reality and +0.36 here.
 * Fitting it would take a second factor for a demo dataset; the sign that
 * actually matters — those two run OPPOSITE across genres, which is what makes
 * the pair look independent — comes from the table above and survives.
 */
const COMMON = 0.6

/** A standard normal from two uniforms (Box-Muller); `1 - u` keeps log() fed. */
function normal(u1: number, u2: number): number {
  return Math.sqrt(-2 * Math.log(1 - u1)) * Math.cos(2 * Math.PI * u2)
}

function descriptorMeans(genre: string | null): readonly number[] {
  if (genre !== null) {
    for (const [re, ...means] of GENRE_DESCRIPTORS) {
      if (re.test(genre)) return means
    }
  }
  return UNTAGGED
}

function entryFor(track: Track, u: (salt: string) => number): AnalysisEntry {
  const means = descriptorMeans(track.genre)
  const shared = normal(u('shared-a'), u('shared-b'))
  const percent = (axis: number, salt: string): number => {
    const own = normal(u(`${salt}-a`), u(`${salt}-b`))
    const z = COMMON * shared + Math.sqrt(1 - COMMON * COMMON) * own
    return Math.min(100, Math.max(0, means[axis] + z * SPREAD[axis]))
  }
  return {
    // Back onto the models' own scales, so mergeAnalysis converts them exactly
    // as it converts a real sidecar's.
    arousal: 1 + (percent(0, 'arousal') / 100) * 8,
    valence: 1 + (percent(1, 'valence') / 100) * 8,
    danceability: percent(2, 'dance') / 100,
    happiness: percent(3, 'happy') / 100,
  }
}

/**
 * Build the sidecar for a set of sample tracks, keyed by `location` exactly as
 * a real producer writes it — an absolute decoded path (`mergeAnalysis` folds
 * both sides itself).
 *
 * Tracks whose `location` the enrichment rolled as null get no entry, which is
 * the realistic case rather than an oversight: the demo then shows both filled
 * descriptor cells and the em-dash gaps, and the import report's "not found"
 * count is a true number.
 */
export function buildSampleSidecar(tracks: readonly Track[]): AnalysisSidecar {
  const entries: Record<string, AnalysisEntry> = {}
  for (const track of tracks) {
    if (track.location === null) continue
    entries[track.location] = entryFor(track, (salt) => hashUnit(`${track.id}#${salt}`, SEED))
  }
  return {
    zodiacAnalysis: 1,
    run: {
      analysedAt: '2026-08-26',
      tool: 'sample-collection (generated)',
      models: ['emomusic-msd-musicnn', 'danceability-msd-musicnn', 'mood_happy-msd-musicnn'],
    },
    tracks: entries,
  }
}
