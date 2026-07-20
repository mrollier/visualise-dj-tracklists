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
  key: {
    enabled: boolean
    plusTwo: boolean
    plusSeven: boolean
    vinylMode: boolean
    demanded: boolean
  }
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
    demanded: boolean
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
    demanded: boolean
  }
  year: { enabled: boolean; maxYears: number; demanded: boolean }
  /**
   * Minimum number of matching criteria for an edge (clamped to #evaluable).
   * A `demanded` (locked) criterion is mandatory regardless of this bar and
   * floors it: threshold ≥ demandedCount (v14 C2).
   */
  threshold: number
}

// Rating deliberately has no pairwise criterion — it acts as a library
// filter instead (see filter.ts): you exclude tracks you wouldn't play,
// rather than requiring neighbours to be similarly rated.
export const DEFAULT_CRITERIA: CriteriaConfig = {
  key: { enabled: true, plusTwo: false, plusSeven: false, vinylMode: false, demanded: false },
  // ±8% mirrors the pitch-bend range of a classic Technics 1210 fader
  bpm: {
    enabled: true,
    maxPercent: 8,
    unitTime: true,
    halfDouble: false,
    twoThirds: false,
    demanded: false,
  },
  genre: { enabled: true, method: 'hybrid', mode: 'topk', k: 5, threshold: 0.2, demanded: false },
  year: { enabled: true, maxYears: 5, demanded: false },
  threshold: 3,
}

/**
 * Easy mode's fixed criteria (v15): key + BPM only, both required — genre
 * and year matching are too loose for a hands-off default. Not editable in
 * easy mode (the Combo criteria section is hidden there); switching to
 * advanced control is the only way to change it. Missing data still shrinks
 * the denominator same as everywhere else (neither field is `demanded`) —
 * a track with no BPM tag isn't zeroed out of every combo, just judged on key.
 */
export const EASY_CRITERIA: CriteriaConfig = {
  ...DEFAULT_CRITERIA,
  genre: { ...DEFAULT_CRITERIA.genre, enabled: false },
  year: { ...DEFAULT_CRITERIA.year, enabled: false },
  threshold: 2,
}

/** The metadata fields that act as pairwise combo criteria. */
export type CriterionField = 'key' | 'bpm' | 'genre' | 'year'

interface ComboEvaluation {
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

type Predicate = (a: Track, b: Track, criteria: CriteriaConfig) => boolean

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
  criteria: CriteriaConfig,
): GenreMatcher {
  const { method, mode, k, threshold } = criteria.genre
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
  criteria: CriteriaConfig,
): [string, string][] {
  const vocabulary = new Set<string>()
  for (const raw of genres) {
    if (raw === null) continue
    for (const component of genreComponents(raw)) vocabulary.add(component)
  }
  const labels = [...vocabulary].sort()
  const matches = makeGenreMatcher(labels, criteria)
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
function bpmCompatibleRatio(a: Track, b: Track, criteria: CriteriaConfig): number | null {
  if (a.bpm === null || b.bpm === null) return null
  const ratios: number[] = []
  if (criteria.bpm.unitTime) ratios.push(1)
  if (criteria.bpm.halfDouble) ratios.push(2, 0.5)
  if (criteria.bpm.twoThirds) ratios.push(1.5, 2 / 3)
  for (const ratio of ratios) {
    const effective = b.bpm * ratio
    const low = Math.min(a.bpm, effective)
    if (Math.abs(a.bpm - effective) <= (criteria.bpm.maxPercent / 100) * low) return ratio
  }
  return null
}

const PREDICATES: Record<CriterionField, Predicate> = {
  key: (a, b, criteria) => {
    const opts = { plusTwo: criteria.key.plusTwo, plusSeven: criteria.key.plusSeven }
    // Vinyl mode: beatmatching by pitch shifts the key along with the tempo,
    // so keys are compared *after* that shift (design-v5 §B). The plain
    // comparison only applies without vinyl mode or when a tempo is unknown.
    if (!criteria.key.vinylMode || a.bpm === null || b.bpm === null) {
      return keysMatch(a.key!, b.key!, opts)
    }
    const ratio = bpmCompatibleRatio(a, b, criteria)
    if (ratio === null) return false // beyond the pitch fader: unbeatmatchable
    const semitones = 12 * Math.log2(a.bpm / (b.bpm * ratio))
    const shift = Math.round(semitones)
    if (Math.abs(semitones - shift) > 0.35) return false // detuned, between keys
    return keysMatch(a.key!, transposeCamelot(b.key!, shift), opts)
  },
  bpm: (a, b, criteria) => bpmCompatibleRatio(a, b, criteria) !== null,
  // genre is handled in evaluateCombo: it needs the library-wide matcher.
  genre: () => false,
  year: (a, b, criteria) => Math.abs(a.year! - b.year!) <= criteria.year.maxYears,
}

const FIELDS = Object.keys(PREDICATES) as CriterionField[]

/**
 * How many criteria are locked as mandatory (v14 C2): enabled AND demanded.
 * A demanded criterion must match on both sides for any edge, and floors the
 * N-of-M threshold (threshold ≥ demandedCount).
 */
export function demandedCount(criteria: CriteriaConfig): number {
  return FIELDS.filter((f) => criteria[f].enabled && criteria[f].demanded).length
}

/**
 * The key criterion under relaxed opts — +2 and +7-semitone moves allowed
 * regardless of the user's toggles (vinyl mode still respected). The forced
 * picker uses this as a gentle preference when no harmonious transition is
 * left (v8 issue 16).
 */
export function keysNearlyMatch(a: Track, b: Track, criteria: CriteriaConfig): boolean {
  if (a.key === null || b.key === null) return false
  const relaxed: CriteriaConfig = {
    ...criteria,
    key: { ...criteria.key, plusTwo: true, plusSeven: true },
  }
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
  criteria: CriteriaConfig,
  genreMatch?: GenreMatcher,
): ComboEvaluation {
  const evaluable: CriterionField[] = []
  const matched: CriterionField[] = []
  // A demanded (locked) criterion is mandatory: missing on either side, or a
  // failing predicate, vetoes the edge (v14 C2). We record the veto in a flag
  // rather than returning early, so `matched` stays fully populated — the
  // forced picker scores pairs off it even when they never form an edge.
  let demandedFailed = false
  for (const field of FIELDS) {
    if (!criteria[field].enabled) continue
    if (a[field] === null || b[field] === null) {
      if (criteria[field].demanded) demandedFailed = true
      continue
    }
    evaluable.push(field)
    let fieldMatched: boolean
    if (field === 'genre') {
      genreMatch ??= makeGenreMatcher([a.genre, b.genre], criteria)
      fieldMatched = genreMatch(a.genre!, b.genre!)
    } else {
      fieldMatched = PREDICATES[field](a, b, criteria)
    }
    if (fieldMatched) matched.push(field)
    else if (criteria[field].demanded) demandedFailed = true
  }
  const effectiveThreshold = Math.min(criteria.threshold, evaluable.length)
  const isCombo = !demandedFailed && evaluable.length > 0 && matched.length >= effectiveThreshold
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
interface ComboView {
  edges: ComboEdge[]
  complete: boolean
  pairCount: number
}

export function computeComboView(tracks: Track[], criteria: CriteriaConfig): ComboView {
  // The symbolic complete graph only holds when nothing is required AND
  // nothing is demanded (v14 C2): a locked criterion still filters every pair,
  // so those edges must be materialized, not assumed.
  if (criteria.threshold === 0 && demandedCount(criteria) === 0) {
    const n = tracks.length
    return { edges: [], complete: true, pairCount: n < 2 ? 0 : (n * (n - 1)) / 2 }
  }
  const edges = computeEdges(tracks, criteria)
  return { edges, complete: false, pairCount: edges.length }
}

/**
 * Flip one criterion on/off, keeping the N-of-M threshold honest. Enabling a
 * criterion ALWAYS requires it (v14 C1): threshold rises by one, capped at the
 * enabled count — including up from a previous deliberate zero. Disabling
 * clamps to the remaining count. A demanded (locked) criterion floors the
 * threshold at all times (v14 C2): threshold ≥ demandedCount.
 */
export function toggleCriterion(
  criteria: CriteriaConfig,
  field: CriterionField,
  enabled: boolean,
): CriteriaConfig {
  const enabledCount = (criteria: CriteriaConfig): number =>
    [criteria.key, criteria.bpm, criteria.genre, criteria.year].filter((c) => c.enabled).length
  // Disabling drops the lock too: a re-enable must come back unlocked, not
  // silently still demanded (must-match is a per-session commitment, not a
  // property that survives the criterion being switched off).
  const demanded = enabled ? criteria[field].demanded : false
  const next: CriteriaConfig = { ...criteria, [field]: { ...criteria[field], enabled, demanded } }
  const after = enabledCount(next)
  let threshold = criteria.threshold
  // v14 C1: enabling ALWAYS requires the newly-enabled criterion — including up
  // from a previous deliberate 0 (design change per ISSUES.md C1).
  if (enabled && !criteria[field].enabled) threshold = Math.min(threshold + 1, after)
  if (after > 0 && threshold > after) threshold = after
  threshold = Math.max(threshold, demandedCount(next)) // v14 C2 floor
  return { ...next, threshold }
}

/**
 * Lock or unlock a criterion as mandatory (v14 C2). A locked criterion floors
 * the threshold at the demanded count; unlocking leaves the threshold where it
 * is (the desired bar is unaffected by removing a floor).
 */
export function toggleDemanded(
  criteria: CriteriaConfig,
  field: CriterionField,
  demanded: boolean,
): CriteriaConfig {
  const next: CriteriaConfig = { ...criteria, [field]: { ...criteria[field], demanded } }
  return { ...next, threshold: Math.max(next.threshold, demandedCount(next)) }
}

/** All undirected combo edges for a track set, each pair reported once. */
export function computeEdges(tracks: Track[], criteria: CriteriaConfig): ComboEdge[] {
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria,
  )
  const edges: ComboEdge[] = []
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      const { matched, isCombo } = evaluateCombo(tracks[i], tracks[j], criteria, genreMatch)
      if (isCombo) {
        edges.push({ sourceId: tracks[i].id, targetId: tracks[j].id, matched })
      }
    }
  }
  return edges
}
