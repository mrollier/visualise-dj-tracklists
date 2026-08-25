import { buildFileIndex, matchLocation } from './audio/pathMatch'
import { foldSegments } from './location'
import { normalizeKey } from './keys'
import type { Track } from './model'

/**
 * The analysis provenance layer (v33 WS1).
 *
 * Audio analysis produces a file-keyed sidecar that fills metadata Rekordbox
 * left null. Rekordbox is authoritative and is never overwritten: the merge
 * here reads `library` and returns a NEW array, so the raw store that feeds
 * persistence, the importers and the CSV exporter is untouched, and a non-null
 * Rekordbox value is unreachable by the fill rather than merely deprioritised.
 *
 * See designs/design-v33-audio-analysis-provenance.md.
 */

/** The three Track fields analysis can fill. */
export type AnalysedField = 'bpm' | 'key' | 'energy'

/** One track's analysis, as a producer writes it. Every field is optional. */
export interface AnalysisEntry {
  bpm?: number | null
  bpmConf?: number | null
  key?: string | null
  keyConf?: number | null
  /**
   * Raw model output. `energy` is derived from `arousal` when a producer
   * supplies no direct value — see `energyOf`.
   */
  arousal?: number | null
  valence?: number | null
  /** A direct 1–10 energy from a producer that already has one (e.g. Mixed In Key). */
  energy?: number | null
  happiness?: number | null
  danceability?: number | null
}

/** Batch-level provenance: when, by what, with which models. */
export interface AnalysisRun {
  analysedAt: string | null
  tool: string | null
  models: string[]
}

export interface AnalysisSidecar {
  /** The sidecar's own format version, independent of the project schema. */
  zodiacAnalysis: 1
  run: AnalysisRun | null
  /** Keyed by full decoded absolute file path. */
  tracks: Record<string, AnalysisEntry>
}

export interface MergeResult {
  /**
   * The library with nulls filled. The SAME array reference as the input when
   * nothing was filled, so an unused sidecar leaves every downstream memo
   * untouched (the `applyPlaylistFilter` idiom, filter.ts).
   */
  tracks: Track[]
  /** Which fields on which track came from analysis — drives the badges. */
  analysedFields: Map<string, Set<AnalysedField>>
  /**
   * What the join actually did. Computed here rather than in a second pass so
   * the import report can never disagree with the merge it describes.
   */
  stats: MergeStats
}

export interface MergeStats {
  bpmFilled: number
  keyFilled: number
  energyFilled: number
  /** Tracks whose Rekordbox BPM/key was absent — the gap analysis could close. */
  bpmMissing: number
  keyMissing: number
  /** A value the sidecar carried but the app refused as too uncertain. */
  belowConfidence: number
  /** No entry for this track's path, or the track has no path at all. */
  notFound: number
  /** Two or more sidecar entries share the basename — refused, never guessed. */
  ambiguous: number
}

/** A non-null, non-array object — the shape every hand-edited record must have. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * Guard an untrusted sidecar the way `sanitizeTrack` guards a saved track: every
 * field is rebuilt explicitly, a wrong-typed value resolves to null rather than
 * leaking through, and anything that is not recognisably a sidecar is rejected
 * outright.
 *
 * The `tracks` map is `isRecord`-guarded itself, not merely its entries — a
 * hand-edited `"tracks": []` would otherwise become an object with numeric
 * keys, and numeric keys can never match a file path.
 */
export function sanitizeAnalysis(raw: unknown): AnalysisSidecar | null {
  if (!isRecord(raw)) return null
  if (raw.zodiacAnalysis !== 1) return null
  if (!isRecord(raw.tracks)) return null

  const tracks: Record<string, AnalysisEntry> = {}
  for (const [path, entry] of Object.entries(raw.tracks)) {
    // An empty key can never match a track, so it is dropped rather than kept
    // as an entry nothing will ever read.
    if (path === '' || !isRecord(entry)) continue
    tracks[path] = {
      bpm: num(entry.bpm),
      bpmConf: num(entry.bpmConf),
      key: str(entry.key),
      keyConf: num(entry.keyConf),
      arousal: num(entry.arousal),
      valence: num(entry.valence),
      energy: num(entry.energy),
      happiness: num(entry.happiness),
      danceability: num(entry.danceability),
    }
  }

  return { zodiacAnalysis: 1, run: sanitizeRun(raw.run), tracks }
}

function sanitizeRun(raw: unknown): AnalysisRun | null {
  if (!isRecord(raw)) return null
  return {
    analysedAt: str(raw.analysedAt),
    tool: str(raw.tool),
    models: Array.isArray(raw.models)
      ? raw.models.filter((m): m is string => typeof m === 'string')
      : [],
  }
}

/**
 * Join a sidecar onto a library. Reuses v28's suffix matcher (pathMatch.ts),
 * which refuses ambiguous ties rather than guessing — attaching the wrong BPM
 * and key to a track would corrupt the exact judgement this feature serves.
 *
 * The two sides are fed ASYMMETRICALLY on purpose: sidecar keys are already
 * decoded absolute paths, while `Track.location` is a percent-encoded
 * `file://localhost/…` URL. Running a sidecar key through `matchLocation`
 * would decode it a second time, turning a filename that genuinely contains
 * `%20` into one with a space.
 */
export function mergeAnalysis(tracks: Track[], sidecar: AnalysisSidecar | null): MergeResult {
  const analysedFields = new Map<string, Set<AnalysedField>>()
  const stats: MergeStats = {
    bpmFilled: 0,
    keyFilled: 0,
    energyFilled: 0,
    bpmMissing: tracks.filter((t) => t.bpm === null).length,
    keyMissing: tracks.filter((t) => t.key === null).length,
    belowConfidence: 0,
    notFound: 0,
    ambiguous: 0,
  }
  if (sidecar === null) return { tracks, analysedFields, stats }

  const index = buildFileIndex(
    Object.keys(sidecar.tracks).map((key) => ({
      path: foldSegments(key.split('/').filter((segment) => segment !== '')),
      handle: key,
    })),
  )

  let filledAny = false
  const merged = tracks.map((t) => {
    if (t.location === null) {
      stats.notFound += 1
      return t
    }
    const match = matchLocation(index, t.location)
    if (match.kind === 'ambiguous') {
      stats.ambiguous += 1
      return t
    }
    if (match.kind !== 'hit') {
      stats.notFound += 1
      return t
    }
    const entry = sidecar.tracks[match.entry.handle]
    if (entry === undefined) {
      stats.notFound += 1
      return t
    }

    const fields = new Set<AnalysedField>()
    const next = { ...t }
    // Fill nulls only. A non-null Rekordbox value is never reachable here.
    if (t.bpm === null && typeof entry.bpm === 'number') {
      if (confident(entry.bpmConf)) {
        next.bpm = entry.bpm
        fields.add('bpm')
        stats.bpmFilled += 1
      } else stats.belowConfidence += 1
    }
    if (t.key === null && entry.key !== null && entry.key !== undefined) {
      if (confident(entry.keyConf)) {
        const key = normalizeKey(entry.key)
        if (key !== null) {
          next.key = key
          fields.add('key')
          stats.keyFilled += 1
        }
      } else stats.belowConfidence += 1
    }
    if (t.energy === null) {
      const energy = energyOf(entry)
      if (energy !== null) {
        next.energy = energy
        fields.add('energy')
        stats.energyFilled += 1
      }
    }

    if (fields.size === 0) return t
    filledAny = true
    analysedFields.set(t.id, fields)
    return next
  })

  return { tracks: filledAny ? merged : tracks, analysedFields, stats }
}

export interface AnalysisImportSummary extends MergeStats {
  /** One line for the import report, in the house style. */
  note: string
}

/**
 * What an imported sidecar did to this library, as the ⓘ report shows it.
 * Refusals are reported rather than swallowed: a file the matcher could not
 * place, or placed ambiguously, is a thing the user can act on.
 */
export function summariseAnalysisImport(
  tracks: Track[],
  sidecar: AnalysisSidecar,
): AnalysisImportSummary {
  const { stats } = mergeAnalysis(tracks, sidecar)
  const parts = [
    `BPM filled ${stats.bpmFilled}/${stats.bpmMissing}`,
    `key ${stats.keyFilled}/${stats.keyMissing}`,
    `energy ${stats.energyFilled} ${stats.energyFilled === 1 ? 'track' : 'tracks'}`,
  ]
  const caveats = []
  if (stats.belowConfidence > 0) caveats.push(`${stats.belowConfidence} below confidence`)
  if (stats.ambiguous > 0) caveats.push(`${stats.ambiguous} ambiguous`)
  if (stats.notFound > 0) caveats.push(`${stats.notFound} not found`)
  const note = parts.join(', ') + (caveats.length > 0 ? `; ${caveats.join(', ')}` : '')
  return { ...stats, note }
}

/**
 * A producer confidence-gates its own output — a below-threshold BPM or key is
 * written as `null` with the confidence still recorded. This is the second
 * gate: the app drops a value whose recorded confidence sits below its own
 * bar, so the bar can be raised later without re-running a multi-hour batch.
 *
 * An entry with no confidence at all is trusted. Not every producer has one
 * (Mixed In Key publishes no score), and refusing those would discard the most
 * reliable source available.
 *
 * ponytail: one threshold for both BPM and key, chosen by eye rather than
 * measured — no analysed data exists yet to tune it against. Split it per
 * field, or lift it into settings, once a real run says the two behave
 * differently.
 */
const MIN_CONFIDENCE = 0.5

function confident(conf: number | null | undefined): boolean {
  if (typeof conf !== 'number' || !Number.isFinite(conf)) return true
  return conf >= MIN_CONFIDENCE
}

/**
 * One entry's energy on the app's 1–10 scale. A direct value from a producer
 * that already has one wins; otherwise it is derived from raw arousal, so the
 * curve can be retuned without re-running a multi-hour analysis batch.
 */
export function energyOf(entry: AnalysisEntry): number | null {
  if (typeof entry.energy === 'number' && Number.isFinite(entry.energy))
    return clampEnergy(entry.energy)
  if (typeof entry.arousal === 'number' && Number.isFinite(entry.arousal))
    return energyFromArousal(entry.arousal)
  return null
}

/**
 * MTG's arousal/valence heads are trained on annotations in [1, 9], but two
 * things stop that from being the range to stretch.
 *
 * The head is a linear regressor over unnormalised targets, so predictions
 * fall outside [1, 9] and must be clamped. And emoMusic's own annotations sit
 * near the middle of their scale and never reach its ends, so a regressor
 * trained on them shrinks towards the mean: over the real 2080-track
 * collection (v34) arousal came back between 4.08 and 7.26, mean 5.80, sd
 * 0.53. Stretching [1, 9] therefore barely stretches at all — it put 159 of
 * the first 175 tracks on energy 6 or 7.
 *
 * A near-constant energy is worse than none. Energy is an enabled-by-default
 * combo criterion with a ±2 window (combos.ts:83), so a field that is always
 * within tolerance adds a criterion that always matches, quietly loosening the
 * N-of-M threshold across the whole library while conveying nothing.
 *
 * So the band below brackets the observed range with headroom on both sides,
 * which keeps a genuinely quiet or genuinely brutal track able to reach 1 or
 * 10 rather than being clipped, and keeps the centre of mass near 5-7 — where
 * Mixed In Key's own scale puts dance music, and where the six MIK-tagged
 * tracks this library already carries actually sit.
 *
 * Deliberately NOT a percentile or decile map over the library. Those
 * fabricate a uniform spread, which would manufacture 1s and 10s that do not
 * exist and clash with those six real values; this stays linear, so the shape
 * of the distribution survives.
 *
 * ponytail: two constants bracketing a measured range, not a fitted curve —
 * there is still no labelled set to fit against. The sidecar stores raw
 * arousal precisely so replacing these costs an evening rather than a
 * multi-hour re-run.
 */
const AROUSAL_MIN = 3.5
const AROUSAL_MAX = 7.5

export function energyFromArousal(arousal: number): number {
  const span = (arousal - AROUSAL_MIN) / (AROUSAL_MAX - AROUSAL_MIN)
  return clampEnergy(Math.round(1 + span * 9))
}

/** Round onto the app's 1–10 energy scale. Callers guarantee a finite input. */
function clampEnergy(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)))
}
