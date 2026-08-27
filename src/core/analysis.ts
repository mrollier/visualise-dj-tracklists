import { buildFileIndex, matchLocation } from './audio/pathMatch'
import { foldSegments } from './location'
import { normalizeKey } from './keys'
import { parseDescriptorToken, type Track } from './model'

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

/**
 * The Track fields analysis can fill. The last four (v35) are analysis-only:
 * no DJ library supplies them, so every non-null value on a Track came from
 * here. Energy is deliberately absent (v36): it comes exclusively from the
 * "Energy N" comment token (Mixed In Key), never from analysis — the
 * arousal-derived fallback was removed after MIK beat it against Michiel's
 * own labels, and an honest null beats an inferior guess.
 */
export type AnalysedField = 'bpm' | 'key' | 'arousal' | 'valence' | 'danceability' | 'happiness'

/** One track's analysis, as a producer writes it. Every field is optional. */
export interface AnalysisEntry {
  bpm?: number | null
  bpmConf?: number | null
  key?: string | null
  keyConf?: number | null
  /** Raw model output on the emoMusic 1–9 annotation scale. */
  arousal?: number | null
  valence?: number | null
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

/**
 * The analysis-only descriptors and the scale each lands on. Track and
 * AnalysisEntry share these names, so the merge reads and writes one key.
 */
const DESCRIPTORS = [
  ['arousal', percentFromAffect],
  ['valence', percentFromAffect],
  ['danceability', percentFromUnit],
  ['happiness', percentFromUnit],
] as const satisfies readonly (readonly [AnalysedField, (value: number) => number])[]

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
  /**
   * Tracks that gained at least one v35 descriptor. One counter rather than
   * four: the import note reports what a run achieved, and four near-identical
   * numbers would bury the BPM and key figures that actually vary.
   */
  descriptorsFilled: number
  /**
   * Tracks that gained a descriptor from the `[A..V..D..H..]` comment token
   * (v38) — the sidecar's own lossy export, read back when no sidecar entry
   * matched. Counted separately so the note can say where values came from.
   */
  descriptorsFromComments: number
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
    descriptorsFilled: 0,
    descriptorsFromComments: 0,
    bpmMissing: tracks.filter((t) => t.bpm === null).length,
    keyMissing: tracks.filter((t) => t.key === null).length,
    belowConfidence: 0,
    notFound: 0,
    ambiguous: 0,
  }

  const index =
    sidecar === null
      ? null
      : buildFileIndex(
          Object.keys(sidecar.tracks).map((key) => ({
            path: foldSegments(key.split('/').filter((segment) => segment !== '')),
            handle: key,
          })),
        )

  // The join outcome, with `stats` as its side channel. Split out so the
  // comment-token fill below still runs for a track the sidecar cannot place
  // — and with no sidecar at all, the XML-only case the token exists for.
  const entryFor = (t: Track): AnalysisEntry | null => {
    if (sidecar === null || index === null) return null
    if (t.location === null) {
      stats.notFound += 1
      return null
    }
    const match = matchLocation(index, t.location)
    if (match.kind === 'ambiguous') {
      stats.ambiguous += 1
      return null
    }
    if (match.kind !== 'hit') {
      stats.notFound += 1
      return null
    }
    const entry = sidecar.tracks[match.entry.handle]
    if (entry === undefined) {
      stats.notFound += 1
      return null
    }
    return entry
  }

  let filledAny = false
  const merged = tracks.map((t) => {
    const entry = entryFor(t)
    const fields = new Set<AnalysedField>()
    const next = { ...t }
    if (entry !== null) {
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
      // Energy is NEVER filled from analysis (v36): the only source is the
      // "Energy N" comment token, parsed at import. A track without one keeps
      // an honest null rather than an arousal-derived guess.

      // The v35 descriptors. Every one is analysis-only, so fill-nulls-only is
      // vacuously true here; the loop keeps them on the same path as the rest
      // rather than inventing a second one.
      let gainedDescriptor = false
      for (const [field, toPercent] of DESCRIPTORS) {
        if (t[field] !== null) continue
        const value = entry[field]
        if (typeof value !== 'number' || !Number.isFinite(value)) continue
        next[field] = toPercent(value)
        fields.add(field)
        gainedDescriptor = true
      }
      if (gainedDescriptor) stats.descriptorsFilled += 1
    }

    // The `[A..V..D..H..]` comment token (v38): the sidecar's own lossy 0-100
    // export, read back. Runs AFTER the sidecar loop and fills nulls only, so
    // a matched sidecar entry — the precise original — always wins.
    const token = parseDescriptorToken(t.comments)
    if (token !== null) {
      let gainedFromToken = false
      for (const [field] of DESCRIPTORS) {
        if (next[field] !== null) continue
        next[field] = token[field]
        fields.add(field)
        gainedFromToken = true
      }
      if (gainedFromToken) stats.descriptorsFromComments += 1
    }

    if (fields.size === 0) return t
    filledAny = true
    analysedFields.set(t.id, fields)
    return next
  })

  return { tracks: filledAny ? merged : tracks, analysedFields, stats }
}

/**
 * Union two sidecars, next wins per path (v38). A playlist-scoped helper run
 * must add to a whole-library sidecar, never discard it — and the union is
 * bounded by unique file paths, so it adds nothing to the autosave footprint
 * a full sidecar would not.
 */
export function mergeSidecars(prev: AnalysisSidecar | null, next: AnalysisSidecar): AnalysisSidecar {
  if (prev === null) return next
  return { zodiacAnalysis: 1, run: next.run, tracks: { ...prev.tracks, ...next.tracks } }
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
    `descriptors ${stats.descriptorsFilled} ${stats.descriptorsFilled === 1 ? 'track' : 'tracks'}`,
  ]
  if (stats.descriptorsFromComments > 0) {
    parts.push(
      `comment tokens ${stats.descriptorsFromComments} ${stats.descriptorsFromComments === 1 ? 'track' : 'tracks'}`,
    )
  }
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

// The arousal→energy mapping (energyOf / energyFromArousal, v33–v35) lived
// here until v36. It was removed, not retuned: against Michiel's 18 anchor
// labels the arousal-derived energy managed r = +0.83 / MAE 2.31 while the
// Mixed In Key tag managed r = +0.91, and above 155 BPM the model's slope
// inverted outright. Energy now has exactly one source — the "Energy N"
// comment token — and a track without one stays null.

/**
 * The descriptor percent scales (v35). `arousal` and `valence` come off the
 * emoMusic head on its annotation range of 1–9; `danceability` and
 * `happiness` are softmax probabilities on 0–1. Both land on Track as whole
 * percentages so the column and the range filter share one unit — and so the
 * filter works at all, since `wholeExtent` floors and ceils and a 0–1 domain
 * would collapse its two boxes onto 0 and 1.
 *
 * Deliberately the NOMINAL range, not an observed band. These four gate
 * nothing, so there is nothing to protect and no reason for an eyeballed
 * constant. Over the real collection arousal then spans about 28–83% and
 * valence 28–77% — the head's shrink towards its mean, shown rather than
 * hidden.
 */
export function percentFromAffect(value: number): number {
  return clampPercent(((value - 1) / 8) * 100)
}

export function percentFromUnit(value: number): number {
  return clampPercent(value * 100)
}

/** Round onto 0–100. Callers guarantee a finite input. */
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}
