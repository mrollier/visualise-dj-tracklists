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
  if (sidecar === null) return { tracks, analysedFields }

  const index = buildFileIndex(
    Object.keys(sidecar.tracks).map((key) => ({
      path: foldSegments(key.split('/').filter((segment) => segment !== '')),
      handle: key,
    })),
  )

  let filledAny = false
  const merged = tracks.map((t) => {
    if (t.location === null) return t
    const match = matchLocation(index, t.location)
    if (match.kind !== 'hit') return t
    const entry = sidecar.tracks[match.entry.handle]
    if (entry === undefined) return t

    const fields = new Set<AnalysedField>()
    const next = { ...t }
    // Fill nulls only. A non-null Rekordbox value is never reachable here.
    if (t.bpm === null && typeof entry.bpm === 'number' && confident(entry.bpmConf)) {
      next.bpm = entry.bpm
      fields.add('bpm')
    }
    if (t.key === null && confident(entry.keyConf)) {
      const key = normalizeKey(entry.key)
      if (key !== null) {
        next.key = key
        fields.add('key')
      }
    }
    if (t.energy === null) {
      const energy = energyOf(entry)
      if (energy !== null) {
        next.energy = energy
        fields.add('energy')
      }
    }

    if (fields.size === 0) return t
    filledAny = true
    analysedFields.set(t.id, fields)
    return next
  })

  return { tracks: filledAny ? merged : tracks, analysedFields }
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
 * MTG's arousal/valence heads are trained on annotations in [1, 9], but the
 * head is a linear regressor over unnormalised targets, so predictions fall
 * outside that range and must be clamped.
 *
 * ponytail: a straight linear stretch of [1,9] onto [1,10], with no
 * calibration behind it — the collection carries only six Mixed In Key tags to
 * check against, three of them by one artist. Replace the constants once a
 * real label set exists (design-v33 records the plan); a curve fitted to six
 * biased points would be worse than this line.
 */
export function energyFromArousal(arousal: number): number {
  const AROUSAL_MIN = 1
  const AROUSAL_MAX = 9
  const span = (arousal - AROUSAL_MIN) / (AROUSAL_MAX - AROUSAL_MIN)
  return clampEnergy(Math.round(1 + span * 9))
}

/** Round onto the app's 1–10 energy scale. Callers guarantee a finite input. */
function clampEnergy(value: number): number {
  return Math.min(10, Math.max(1, Math.round(value)))
}
