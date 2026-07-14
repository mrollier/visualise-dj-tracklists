import { keysMatch } from './keys'
import type { MetadataField, Track } from './model'

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
  key: { enabled: boolean; advancedMoves: boolean }
  bpm: { enabled: boolean; maxPercent: number }
  genre: { enabled: boolean }
  year: { enabled: boolean; maxYears: number }
  rating: { enabled: boolean; maxStars: number }
  /** Minimum number of matching criteria for an edge (clamped to #evaluable). */
  threshold: number
}

export const DEFAULT_CRITERIA: CriteriaConfig = {
  key: { enabled: true, advancedMoves: false },
  bpm: { enabled: true, maxPercent: 10 },
  genre: { enabled: true },
  year: { enabled: true, maxYears: 5 },
  rating: { enabled: true, maxStars: 1 },
  threshold: 3,
}

export interface ComboEvaluation {
  /** Criteria that were enabled and had values on both sides. */
  evaluable: MetadataField[]
  /** Subset of `evaluable` that matched. */
  matched: MetadataField[]
  isCombo: boolean
}

export interface ComboEdge {
  sourceId: string
  targetId: string
  matched: MetadataField[]
}

type Predicate = (a: Track, b: Track, config: CriteriaConfig) => boolean

const PREDICATES: Record<MetadataField, Predicate> = {
  key: (a, b, cfg) => keysMatch(a.key!, b.key!, { advancedMoves: cfg.key.advancedMoves }),
  bpm: (a, b, cfg) => {
    const low = Math.min(a.bpm!, b.bpm!)
    return Math.abs(a.bpm! - b.bpm!) <= (cfg.bpm.maxPercent / 100) * low
  },
  genre: (a, b) => a.genre!.toLowerCase() === b.genre!.toLowerCase(),
  year: (a, b, cfg) => Math.abs(a.year! - b.year!) <= cfg.year.maxYears,
  rating: (a, b, cfg) => Math.abs(a.rating! - b.rating!) <= cfg.rating.maxStars,
}

const FIELDS = Object.keys(PREDICATES) as MetadataField[]

export function evaluateCombo(a: Track, b: Track, config: CriteriaConfig): ComboEvaluation {
  const evaluable: MetadataField[] = []
  const matched: MetadataField[] = []
  for (const field of FIELDS) {
    if (!config[field].enabled) continue
    if (a[field] === null || b[field] === null) continue
    evaluable.push(field)
    if (PREDICATES[field](a, b, config)) matched.push(field)
  }
  const effectiveThreshold = Math.min(config.threshold, evaluable.length)
  const isCombo = evaluable.length > 0 && matched.length >= effectiveThreshold
  return { evaluable, matched, isCombo }
}

/** All undirected combo edges for a track set, each pair reported once. */
export function computeEdges(tracks: Track[], config: CriteriaConfig): ComboEdge[] {
  const edges: ComboEdge[] = []
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const { matched, isCombo } = evaluateCombo(tracks[i], tracks[j], config)
      if (isCombo) {
        edges.push({ sourceId: tracks[i].id, targetId: tracks[j].id, matched })
      }
    }
  }
  return edges
}
