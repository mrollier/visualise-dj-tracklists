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
  key: { enabled: boolean; plusTwo: boolean; plusSeven: boolean; vinylMode: boolean }
  /**
   * BPM matching happens at every enabled metric ratio: unit time (1:1, the
   * normal case — disable it to isolate the exotic combos), half/double time
   * (2:1), and 2/3 time (3:2 — triplet ↔ four-on-the-floor). The percent
   * tolerance applies around each ratio.
   */
  bpm: {
    enabled: boolean
    maxPercent: number
    unitTime: boolean
    halfDouble: boolean
    twoThirds: boolean
  }
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
  key: { enabled: true, plusTwo: false, plusSeven: false, vinylMode: false },
  // ±8% mirrors the pitch-bend range of a classic Technics 1210 fader
  bpm: { enabled: true, maxPercent: 8, unitTime: true, halfDouble: false, twoThirds: false },
  genre: { enabled: true, method: 'hybrid', mode: 'topk', k: 5, threshold: 0.2 },
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
 * Every distinct pair of genre components (sorted, deduplicated) that the
 * configured matcher links. Shared by the genre map's criterion overlay and
 * the advanced menu's live pair count (issue 12), so the two can never
 * disagree about what "matches" means.
 */
export function matchedGenrePairs(
  genres: Iterable<string | null>,
  cfg: CriteriaConfig,
): [string, string][] {
  const vocabulary = new Set<string>()
  for (const raw of genres) {
    if (raw === null) continue
    for (const component of genreComponents(raw)) vocabulary.add(component)
  }
  const labels = [...vocabulary].sort()
  const matches = makeGenreMatcher(labels, cfg)
  const pairs: [string, string][] = []
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (matches(labels[i], labels[j])) pairs.push([labels[i], labels[j]])
    }
  }
  return pairs
}

/**
 * The metric ratio at which the two tracks are beatmatchable within the BPM
 * tolerance, or null if none of the enabled ratios (unit, half/double, 2/3
 * time) fits. Ratios are tried unit-first so the plain match always wins.
 */
export function bpmCompatibleRatio(a: Track, b: Track, cfg: CriteriaConfig): number | null {
  if (a.bpm === null || b.bpm === null) return null
  const ratios: number[] = []
  if (cfg.bpm.unitTime) ratios.push(1)
  if (cfg.bpm.halfDouble) ratios.push(2, 0.5)
  if (cfg.bpm.twoThirds) ratios.push(1.5, 2 / 3)
  for (const ratio of ratios) {
    const effective = b.bpm * ratio
    const low = Math.min(a.bpm, effective)
    if (Math.abs(a.bpm - effective) <= (cfg.bpm.maxPercent / 100) * low) return ratio
  }
  return null
}

const PREDICATES: Record<CriterionField, Predicate> = {
  key: (a, b, cfg) => {
    const opts = { plusTwo: cfg.key.plusTwo, plusSeven: cfg.key.plusSeven }
    // Vinyl mode: beatmatching by pitch shifts the key along with the tempo,
    // so keys are compared *after* that shift (design-v5 §B). The plain
    // comparison only applies without vinyl mode or when a tempo is unknown.
    if (!cfg.key.vinylMode || a.bpm === null || b.bpm === null) {
      return keysMatch(a.key!, b.key!, opts)
    }
    const ratio = bpmCompatibleRatio(a, b, cfg)
    if (ratio === null) return false // beyond the pitch fader: unbeatmatchable
    const semitones = 12 * Math.log2(a.bpm / (b.bpm * ratio))
    const shift = Math.round(semitones)
    if (Math.abs(semitones - shift) > 0.35) return false // detuned, between keys
    return keysMatch(a.key!, transposeCamelot(b.key!, shift), opts)
  },
  bpm: (a, b, cfg) => bpmCompatibleRatio(a, b, cfg) !== null,
  // genre is handled in evaluateCombo: it needs the library-wide matcher.
  genre: () => false,
  year: (a, b, cfg) => Math.abs(a.year! - b.year!) <= cfg.year.maxYears,
}

const FIELDS = Object.keys(PREDICATES) as CriterionField[]

/**
 * The key criterion under relaxed opts — +2 and +7-semitone moves allowed
 * regardless of the user's toggles (vinyl mode still respected). The forced
 * picker uses this as a gentle preference when no harmonious transition is
 * left (v8 issue 16).
 */
export function keysNearlyMatch(a: Track, b: Track, cfg: CriteriaConfig): boolean {
  if (a.key === null || b.key === null) return false
  const relaxed: CriteriaConfig = { ...cfg, key: { ...cfg.key, plusTwo: true, plusSeven: true } }
  return PREDICATES.key(a, b, relaxed)
}

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

/**
 * The combo edges the wheel actually DRAWS (v9 issue 8): none without a
 * selection, the incident star with one, and — when asked — the edges among
 * the selection's neighbours (the cluster's interconnections). Edges leaving
 * the cluster stay hidden either way. Order-preserving, non-mutating; the
 * full edge set keeps feeding suggestions and adjacency unchanged.
 */
export function focusEdges(
  edges: readonly ComboEdge[],
  selectedId: string | null,
  includeCluster: boolean,
): ComboEdge[] {
  if (selectedId === null) return []
  if (!includeCluster) {
    return edges.filter((e) => e.sourceId === selectedId || e.targetId === selectedId)
  }
  const neighbourIds = new Set<string>()
  for (const e of edges) {
    if (e.sourceId === selectedId) neighbourIds.add(e.targetId)
    else if (e.targetId === selectedId) neighbourIds.add(e.sourceId)
  }
  return edges.filter(
    (e) =>
      e.sourceId === selectedId ||
      e.targetId === selectedId ||
      (neighbourIds.has(e.sourceId) && neighbourIds.has(e.targetId)),
  )
}

/**
 * The combo graph as the stores consume it (v11 issue 2a). At threshold 0
 * every pair is a combo — a complete graph that must NOT be materialized
 * (a real library would allocate n²/2 edge objects), so it is reported
 * symbolically: `complete: true`, no edges, an arithmetic pair count. Note
 * the symbolic graph includes pairs with no shared metadata, which
 * evaluateCombo would exclude — at "require 0" nothing is required.
 */
export interface ComboView {
  edges: ComboEdge[]
  complete: boolean
  pairCount: number
}

export function computeComboView(tracks: Track[], config: CriteriaConfig): ComboView {
  if (config.threshold === 0) {
    const n = tracks.length
    return { edges: [], complete: true, pairCount: n < 2 ? 0 : (n * (n - 1)) / 2 }
  }
  const edges = computeEdges(tracks, config)
  return { edges, complete: false, pairCount: edges.length }
}

/**
 * Flip one criterion on/off, keeping the N-of-M threshold honest (v11 issue
 * 2b): enabling while the threshold demanded ALL enabled criteria keeps
 * demanding all (2-of-2 becomes 3-of-3); a partial or deliberate zero
 * requirement is left alone; disabling clamps to the remaining count.
 */
export function toggleCriterion(
  config: CriteriaConfig,
  field: CriterionField,
  enabled: boolean,
): CriteriaConfig {
  const enabledCount = (cfg: CriteriaConfig): number =>
    [cfg.key, cfg.bpm, cfg.genre, cfg.year].filter((c) => c.enabled).length
  const before = enabledCount(config)
  const next: CriteriaConfig = { ...config, [field]: { ...config[field], enabled } }
  const after = enabledCount(next)
  let threshold = config.threshold
  if (enabled && !config[field].enabled && before > 0 && threshold === before) threshold = after
  if (after > 0 && threshold > after) threshold = after
  return { ...next, threshold }
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
