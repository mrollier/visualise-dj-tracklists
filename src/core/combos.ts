import { genreAliases, genreComponents, labelSimilarity, UMBRELLA_GENRES } from './genre'
import { keysMatch, transposeCamelot } from './keys'
import type { Track } from './model'
import { mulberry32 } from './random'

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
  /** Mixed-In-Key-style energy (1–10); "within" is an absolute step count. */
  energy: { enabled: boolean; maxSteps: number; demanded: boolean }
  /**
   * Each genre links to its k nearest genres in the library when the
   * closeness is mutual — self-calibrating across dense (electronic) and
   * sparse genre regions, the research report's recommendation.
   */
  genre: { enabled: boolean; k: number; demanded: boolean }
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
  // ±2 energy steps mirrors BPM's fairly tight default tolerance.
  energy: { enabled: true, maxSteps: 2, demanded: false },
  genre: { enabled: true, k: 5, demanded: false },
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
  energy: { ...DEFAULT_CRITERIA.energy, enabled: false },
  genre: { ...DEFAULT_CRITERIA.genre, enabled: false },
  year: { ...DEFAULT_CRITERIA.year, enabled: false },
  threshold: 2,
}

/** The metadata fields that act as pairwise combo criteria. */
export type CriterionField = 'key' | 'bpm' | 'energy' | 'genre' | 'year'

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

type Predicate = (a: Track, b: Track, criteria: CriteriaConfig) => boolean

export type GenreMatcher = (rawA: string, rawB: string) => boolean

/**
 * Below this a pack score is noise, not a neighbour: it keeps a sparse genre
 * region from linking its k "nearest" genres when none of them is actually
 * near.
 */
const GENRE_SCORE_FLOOR = 0.2

/**
 * Build the genre predicate for a pairing universe. Each distinct genre
 * (multi-genre fields split into components) ranks the others by pack
 * similarity; a pair matches when each is in the other's top k and the score
 * clears GENRE_SCORE_FLOOR. Umbrella labels ("electronic", …) never rank as
 * neighbours, so they cannot become hubs.
 */
export function makeGenreMatcher(genres: Iterable<string | null>, k: number): GenreMatcher {
  const threshold = GENRE_SCORE_FLOOR
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
      .map((other) => ({ other, sim: labelSimilarity(label, other) }))
      .filter(({ sim }) => sim > 0 && sim >= threshold)
      .sort((x, y) => y.sim - x.sim || (x.other < y.other ? -1 : 1))
      .slice(0, k)
    topOf.set(label, new Set(ranked.map(({ other }) => other)))
  }
  // Learned aliases skip the ranking but not the score floor; `?.add` ignores
  // a label this pairing universe never mentions.
  for (const { own, style, weight } of genreAliases()) {
    if (weight < threshold) continue
    topOf.get(own)?.add(style)
    topOf.get(style)?.add(own)
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
 * Every distinct pair of genre components (sorted, deduplicated) among
 * `genres` that `matches` links. Shared by the genre map and the advanced
 * menu's live pair count, so the two can never disagree about what "matches"
 * means.
 */
export function matchedGenrePairs(
  genres: Iterable<string | null>,
  matches: GenreMatcher,
): [string, string][] {
  const vocabulary = new Set<string>()
  for (const raw of genres) {
    if (raw === null) continue
    for (const component of genreComponents(raw)) vocabulary.add(component)
  }
  const labels = [...vocabulary].sort()
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
  energy: (a, b, criteria) => Math.abs(a.energy! - b.energy!) <= criteria.energy.maxSteps,
  // genre is handled in evaluateCombo: it needs the library-wide matcher.
  genre: () => false,
  year: (a, b, criteria) => Math.abs(a.year! - b.year!) <= criteria.year.maxYears,
}

export const CRITERION_FIELDS = Object.keys(PREDICATES) as CriterionField[]

/**
 * How many criteria are locked as mandatory (v14 C2): enabled AND demanded.
 * A demanded criterion must match on both sides for any edge, and floors the
 * N-of-M threshold (threshold ≥ demandedCount).
 */
export function demandedCount(criteria: CriteriaConfig): number {
  return CRITERION_FIELDS.filter((f) => criteria[f].enabled && criteria[f].demanded).length
}

/**
 * The key criterion under relaxed opts — the +2 and +7 wheel moves allowed
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
  for (const field of CRITERION_FIELDS) {
    if (!criteria[field].enabled) continue
    if (a[field] === null || b[field] === null) {
      if (criteria[field].demanded) demandedFailed = true
      continue
    }
    evaluable.push(field)
    let fieldMatched: boolean
    if (field === 'genre') {
      genreMatch ??= makeGenreMatcher([a.genre, b.genre], criteria.genre.k)
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
 * The combo graph, evaluated on demand. Nothing is computed up front: a
 * track's partners are found by one scan over the library the first time they
 * are asked for (O(n), about 3 ms at 10k tracks) and kept. Everything the app
 * asks of the graph starts from one track — the selection's star, the hub's
 * anchor, a walk's current tip — so a full O(n²) pass is never needed.
 *
 * Pairs are always evaluated in library order (earlier track first), exactly
 * as `computeEdges` does, so the lazy graph and the full edge list agree.
 *
 * At require 0 with nothing demanded every pair is a combo: `complete` is set
 * and nothing is evaluated at all. That graph includes pairs with no shared
 * metadata, which evaluateCombo would exclude — at "require 0" nothing is
 * required.
 */
export interface ComboGraph {
  readonly complete: boolean
  readonly tracks: readonly Track[]
  readonly criteria: CriteriaConfig
  readonly genreMatch: GenreMatcher
  /** The combo partners of `id`, in library order; [] for an unknown id. */
  partners(id: string): readonly string[]
  /** Whether `id` has any partner, stopping at the first one found. */
  hasPartner(id: string): boolean
  /** Evaluate the pair at these library positions, earlier track first. */
  evaluateAt(i: number, j: number): ComboEvaluation
}

export function buildComboGraph(
  tracks: readonly Track[],
  criteria: CriteriaConfig,
  genreMatch: GenreMatcher = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria.genre.k,
  ),
): ComboGraph {
  const complete = criteria.threshold === 0 && demandedCount(criteria) === 0
  const indexOf = new Map(tracks.map((t, i) => [t.id, i]))
  const memo = new Map<string, string[]>()
  const evaluateAt = (i: number, j: number) =>
    i < j
      ? evaluateCombo(tracks[i], tracks[j], criteria, genreMatch)
      : evaluateCombo(tracks[j], tracks[i], criteria, genreMatch)
  return {
    complete,
    tracks,
    criteria,
    genreMatch,
    evaluateAt,
    partners(id) {
      const i = indexOf.get(id)
      if (i === undefined) return []
      if (complete) return tracks.filter((t) => t.id !== id).map((t) => t.id)
      let found = memo.get(id)
      if (found === undefined) {
        found = []
        for (let j = 0; j < tracks.length; j++) {
          if (j !== i && evaluateAt(i, j).isCombo) found.push(tracks[j].id)
        }
        memo.set(id, found)
      }
      return found
    },
    hasPartner(id) {
      const i = indexOf.get(id)
      if (i === undefined) return false
      if (complete) return tracks.length > 1
      const known = memo.get(id)
      if (known !== undefined) return known.length > 0
      for (let j = 0; j < tracks.length; j++) {
        if (j !== i && evaluateAt(i, j).isCombo) return true
      }
      return false
    },
  }
}

/**
 * The combo edges the wheel actually draws: none without a selection, the
 * star around it, and — when asked — the edges among its partners (the
 * cluster's interconnections). Edges leaving the cluster stay hidden. In the
 * full edge list's order, so the drawing never reshuffles.
 *
 * ponytail: the cluster costs O(partners²) evaluations — fine for the few
 * hundred partners a real selection has; a very loose criterion set on a huge
 * library makes it the slow path.
 */
export function focusEdgesFor(
  graph: ComboGraph,
  selectedId: string | null,
  includeCluster: boolean,
): ComboEdge[] {
  if (selectedId === null) return []
  const { tracks } = graph
  const s = tracks.findIndex((t) => t.id === selectedId)
  if (s === -1) return []
  const partnerIds = new Set(graph.partners(selectedId))
  const members: number[] = []
  for (let i = 0; i < tracks.length; i++) {
    if (i === s || partnerIds.has(tracks[i].id)) members.push(i)
  }
  const edges: ComboEdge[] = []
  for (let x = 0; x < members.length; x++) {
    for (let y = x + 1; y < members.length; y++) {
      const i = members[x]
      const j = members[y]
      if (!includeCluster && i !== s && j !== s) continue
      const { matched, isCombo } = graph.evaluateAt(i, j)
      if (isCombo) edges.push({ sourceId: tracks[i].id, targetId: tracks[j].id, matched })
    }
  }
  return edges
}

/**
 * How many combo pairs the graph holds, for the criteria panel. Exact while
 * the library has at most `exactLimit` pairs (about 775 tracks by default);
 * past that, estimated from a fixed-seed sample of pairs, so the same library
 * and criteria always show the same number.
 */
export function countComboPairs(
  graph: ComboGraph,
  { exactLimit = 300_000, samples = 200_000 } = {},
): { count: number; approximate: boolean } {
  const n = graph.tracks.length
  const pairs = n < 2 ? 0 : (n * (n - 1)) / 2
  if (graph.complete) return { count: pairs, approximate: false }
  if (pairs <= exactLimit) {
    let count = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) if (graph.evaluateAt(i, j).isCombo) count++
    }
    return { count, approximate: false }
  }
  const rand = mulberry32(PAIR_SAMPLE_SEED)
  let hits = 0
  for (let k = 0; k < samples; k++) {
    const i = Math.floor(rand() * n)
    let j = Math.floor(rand() * (n - 1))
    if (j >= i) j++
    if (graph.evaluateAt(i, j).isCombo) hits++
  }
  return { count: Math.round((hits / samples) * pairs), approximate: true }
}

const PAIR_SAMPLE_SEED = 0x5eed

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
    CRITERION_FIELDS.filter((f) => criteria[f].enabled).length
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

/**
 * All undirected combo edges for a track set, each pair reported once.
 * `genreMatch` defaults to a matcher over these tracks' own genres; the app
 * passes its library-wide one so filtering never changes what matches.
 */
export function computeEdges(
  tracks: Track[],
  criteria: CriteriaConfig,
  genreMatch: GenreMatcher = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria.genre.k,
  ),
): ComboEdge[] {
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
