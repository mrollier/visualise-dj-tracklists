import {
  genreComponents,
  genreSimilarity,
  labelSimilarity,
  UMBRELLA_GENRES,
  type GenreMethod,
} from './genre'
import { keysMatch, transposeCamelot } from './keys'
import type { Track } from './model'

/**
 * The combo engine: decides which pairs of tracks get a suggested-combo edge.
 *
 * V1 uses threshold ("N of M") mode, matching the concept paper's Figure 1:
 * an edge exists when at least `threshold` of the enabled criteria match.
 * Missing data shrinks the denominator: a criterion that cannot be evaluated
 * for a pair (a value missing on either side) neither passes nor fails —
 * the effective threshold for the pair is min(threshold, #evaluable).
 * A pair with no evaluable criteria never forms an edge.
 */
export interface CriteriaConfig {
  key: { enabled: boolean; advancedMoves: boolean; vinylMode: boolean }
  bpm: { enabled: boolean; maxPercent: number; halfDouble: boolean }
  genre: {
    enabled: boolean
    method: GenreMethod
    /**
     * 'topk': each genre links to its k nearest genres in the library when
     * the closeness is mutual (self-calibrating across dense and sparse
     * genre regions — the research report's recommendation); the threshold
     * stays on as a secondary score floor. 'threshold': plain sim ≥ t.
     */
    mode: 'topk' | 'threshold'
    k: number
    threshold: number
  }
  year: { enabled: boolean; maxYears: number }
  /** Minimum number of matching criteria for an edge (clamped to #evaluable). */
  threshold: number
}

// Rating deliberately has no pairwise criterion — it acts as a library
// filter instead (see filter.ts): you exclude tracks you wouldn't play,
// rather than requiring neighbours to be similarly rated.
export const DEFAULT_CRITERIA: CriteriaConfig = {
  key: { enabled: true, advancedMoves: false, vinylMode: false },
  bpm: { enabled: true, maxPercent: 10, halfDouble: false },
  genre: { enabled: true, method: 'lexical', mode: 'topk', k: 5, threshold: 0.2 },
  year: { enabled: true, maxYears: 5 },
  threshold: 3,
}

/** The metadata fields that act as pairwise combo criteria. */
export type CriterionField = 'key' | 'bpm' | 'genre' | 'year'

export interface ComboEvaluation {
  /** Criteria that were enabled and had values on both sides. */
  evaluable: CriterionField[]
  /** Subset of `evaluable` that matched. */
  matched: CriterionField[]
  isCombo: boolean
}

export interface ComboEdge {
  sourceId: string
  targetId: string
  matched: CriterionField[]
}

type Predicate = (a: Track, b: Track, config: CriteriaConfig) => boolean

export type GenreMatcher = (rawA: string, rawB: string) => boolean

/**
 * Build the genre predicate for a pairing universe. In 'topk' mode each
 * distinct genre (multi-genre fields split into components) ranks the others
 * by the configured similarity method; a pair matches when each is in the
 * other's top k (and clears the threshold floor). Umbrella labels
 * ("electronic", …) never rank as neighbours, so they cannot become hubs.
 */
export function makeGenreMatcher(
  genres: Iterable<string | null>,
  cfg: CriteriaConfig,
): GenreMatcher {
  const { method, mode, k, threshold } = cfg.genre
  if (mode === 'threshold') {
    return (rawA, rawB) => genreSimilarity(rawA, rawB, method) >= threshold
  }
  const vocabulary = new Set<string>()
  for (const raw of genres) {
    if (raw === null) continue
    for (const component of genreComponents(raw)) vocabulary.add(component)
  }
  const labels = [...vocabulary]
  const umbrella = new Set(UMBRELLA_GENRES)
  const topOf = new Map<string, Set<string>>()
  for (const label of labels) {
    const ranked = labels
      .filter((other) => other !== label && !umbrella.has(other))
      .map((other) => ({ other, sim: labelSimilarity(label, other, method) }))
      .filter(({ sim }) => sim > 0 && sim >= threshold)
      .sort((x, y) => y.sim - x.sim || (x.other < y.other ? -1 : 1))
      .slice(0, k)
    topOf.set(label, new Set(ranked.map(({ other }) => other)))
  }
  return (rawA, rawB) => {
    for (const a of genreComponents(rawA)) {
      for (const b of genreComponents(rawB)) {
        if (a === b) return true
        if (topOf.get(a)?.has(b) === true && topOf.get(b)?.has(a) === true) return true
      }
    }
    return false
  }
}

/**
 * The tempo ratio (1, or 2 / 0.5 with half/double-time enabled) at which the
 * two tracks are beatmatchable within the BPM tolerance, or null if none is.
 */
export function bpmCompatibleRatio(a: Track, b: Track, cfg: CriteriaConfig): number | null {
  if (a.bpm === null || b.bpm === null) return null
  const ratios = cfg.bpm.halfDouble ? [1, 2, 0.5] : [1]
  for (const ratio of ratios) {
    const effective = b.bpm * ratio
    const low = Math.min(a.bpm, effective)
    if (Math.abs(a.bpm - effective) <= (cfg.bpm.maxPercent / 100) * low) return ratio
  }
  return null
}

const PREDICATES: Record<CriterionField, Predicate> = {
  key: (a, b, cfg) => {
    const opts = { advancedMoves: cfg.key.advancedMoves }
    if (keysMatch(a.key!, b.key!, opts)) return true
    if (!cfg.key.vinylMode) return false
    // Vinyl mode: beatmatching by pitch shifts the key along with the tempo.
    // Only tempo gaps landing on a whole semitone yield a clean transposition.
    const ratio = bpmCompatibleRatio(a, b, cfg)
    if (ratio === null) return false
    const semitones = 12 * Math.log2(a.bpm! / (b.bpm! * ratio))
    const shift = Math.round(semitones)
    if (shift === 0 || Math.abs(semitones - shift) > 0.35) return false
    return keysMatch(a.key!, transposeCamelot(b.key!, shift), opts)
  },
  bpm: (a, b, cfg) => bpmCompatibleRatio(a, b, cfg) !== null,
  // genre is handled in evaluateCombo: it needs the library-wide matcher.
  genre: () => false,
  year: (a, b, cfg) => Math.abs(a.year! - b.year!) <= cfg.year.maxYears,
}

const FIELDS = Object.keys(PREDICATES) as CriterionField[]

/**
 * Evaluate one pair. `genreMatch` should be the matcher built over the whole
 * pairing universe (computeEdges and the suggesters do this); without it, a
 * pair-local matcher is built — identical semantics for 'threshold' mode,
 * and a two-genre universe for 'topk'.
 */
export function evaluateCombo(
  a: Track,
  b: Track,
  config: CriteriaConfig,
  genreMatch?: GenreMatcher,
): ComboEvaluation {
  const evaluable: CriterionField[] = []
  const matched: CriterionField[] = []
  for (const field of FIELDS) {
    if (!config[field].enabled) continue
    if (a[field] === null || b[field] === null) continue
    evaluable.push(field)
    if (field === 'genre') {
      genreMatch ??= makeGenreMatcher([a.genre, b.genre], config)
      if (genreMatch(a.genre!, b.genre!)) matched.push(field)
    } else if (PREDICATES[field](a, b, config)) {
      matched.push(field)
    }
  }
  const effectiveThreshold = Math.min(config.threshold, evaluable.length)
  const isCombo = evaluable.length > 0 && matched.length >= effectiveThreshold
  return { evaluable, matched, isCombo }
}

/** All undirected combo edges for a track set, each pair reported once. */
export function computeEdges(tracks: Track[], config: CriteriaConfig): ComboEdge[] {
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    config,
  )
  const edges: ComboEdge[] = []
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const { matched, isCombo } = evaluateCombo(tracks[i], tracks[j], config, genreMatch)
      if (isCombo) {
        edges.push({ sourceId: tracks[i].id, targetId: tracks[j].id, matched })
      }
    }
  }
  return edges
}
