import {
  computeEdges,
  evaluateCombo,
  makeGenreMatcher,
  type CriteriaConfig,
  type GenreMatcher,
} from './combos'
import { genreSimilarity } from './genre'
import type { Track } from './model'
import { mulberry32 } from './random'
import type { BpmProgression } from './settings'

/**
 * Set suggestions (remarks 6/7): greedy walks over the combo graph, with an
 * optional taste for adventure.
 *
 * Candidates are scored by how many criteria they match, sweetened by the
 * *continuous* genre similarity (so among equal matches, the closer genre
 * wins) and a light preference for small BPM steps. With randomness 0 the
 * best candidate always wins (deterministic); above 0, candidates are sampled
 * with a softmax over their scores — higher randomness flattens the odds and
 * lets "dissonant" picks through. Every suggestion is reproducible via its
 * seed.
 */
export interface SuggestOptions {
  /** Pin the walk's opening track. Without it the opener is random. */
  seedId?: string | null
  /** Pin the walk's closing track: the walk grows from both ends inward. */
  endId?: string | null
  length?: number
  /** 0 = always the safest pick, 1 = adventurous sampling. */
  randomness?: number
  /** PRNG seed: drives the random opener and (with randomness > 0) sampling. */
  seed?: number
  /** Preferred BPM trajectory; 'any' (the default) adds no term at all. */
  progression?: BpmProgression
  /** Tracks to bias into the walk (a strong bonus until each is placed). */
  mustIncludeIds?: readonly string[]
}

/** Sawtooth cycle length: every SAWTOOTH_PERIODth transition drops back. */
const SAWTOOTH_PERIOD = 4
/**
 * Below the matched-criteria unit weight in aggregate, so a progression
 * re-ranks ties and near-ties without overriding harmonic matches.
 */
const PROGRESSION_WEIGHT = 0.8
/** Strictly above the maximum matched-criteria score (4 criteria). */
const MUST_INCLUDE_BONUS = 5

/**
 * How well a BPM step fits the preferred trajectory, in [0, 1]. Missing BPMs
 * are neutral (0.5) — missing data must never punish a candidate. `step` is
 * the zero-based transition index in play order (sawtooth phase).
 */
export function progressionFit(
  currentBpm: number | null,
  candidateBpm: number | null,
  step: number,
  progression: BpmProgression,
): number {
  if (progression === 'any' || currentBpm === null || candidateBpm === null) return 0.5
  const delta = candidateBpm - currentBpm
  const rising = 1 / (1 + Math.exp(-delta / 2))
  switch (progression) {
    case 'steady':
      return 1 / (1 + Math.abs(delta) / 3)
    case 'rising':
      return rising
    case 'falling':
      return 1 - rising
    case 'sawtooth':
      // Build up, then breathe: every SAWTOOTH_PERIODth transition drops.
      return step % SAWTOOTH_PERIOD === SAWTOOTH_PERIOD - 1 ? 1 - rising : rising
  }
}

/** The backward-growing arm of a two-ended walk sees time reversed. */
function invertProgression(progression: BpmProgression): BpmProgression {
  if (progression === 'rising') return 'falling'
  if (progression === 'falling') return 'rising'
  return progression
}

function scoreCandidate(
  current: Track,
  candidate: Track,
  criteria: CriteriaConfig,
  genreMatch: GenreMatcher,
): number {
  const matched = evaluateCombo(current, candidate, criteria, genreMatch).matched.length
  const genre =
    current.genre !== null && candidate.genre !== null
      ? genreSimilarity(current.genre, candidate.genre, criteria.genre.method)
      : 0
  let bpm = 0
  if (current.bpm !== null && candidate.bpm !== null) {
    // An exact hit on any enabled metric ratio is as close as an exact 1×.
    const ratios: number[] = []
    if (criteria.bpm.unitTime) ratios.push(1)
    if (criteria.bpm.halfDouble) ratios.push(2, 0.5)
    if (criteria.bpm.twoThirds) ratios.push(1.5, 2 / 3)
    if (ratios.length > 0) {
      const delta = Math.min(...ratios.map((r) => Math.abs(current.bpm! - candidate.bpm! * r)))
      bpm = 1 / (1 + delta / 4)
    }
  }
  // Matched criteria dominate; genre closeness breaks ties; BPM nudges last.
  return matched + 0.5 * genre + 0.1 * bpm
}

/** Pick from scored candidates: argmax, or softmax sampling when randomness > 0. */
function pick<T>(scored: { item: T; score: number }[], randomness: number, rand: () => number): T {
  if (randomness <= 0 || scored.length === 1) return scored[0].item
  const temperature = 0.5 * randomness
  const max = scored[0].score
  const weights = scored.map(({ score }) => Math.exp((score - max) / temperature))
  const total = weights.reduce((s, w) => s + w, 0)
  let roll = rand() * total
  for (let i = 0; i < scored.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return scored[i].item
  }
  return scored[scored.length - 1].item
}

function buildNeighbours(tracks: Track[], criteria: CriteriaConfig): Map<string, string[]> {
  const neighbours = new Map<string, string[]>()
  for (const edge of computeEdges(tracks, criteria)) {
    if (!neighbours.has(edge.sourceId)) neighbours.set(edge.sourceId, [])
    if (!neighbours.has(edge.targetId)) neighbours.set(edge.targetId, [])
    neighbours.get(edge.sourceId)!.push(edge.targetId)
    neighbours.get(edge.targetId)!.push(edge.sourceId)
  }
  return neighbours
}

/**
 * Uniformly random walk opener (remark: generated sets must not always open
 * with the same track): a connected track when any exists, excluding the
 * pinned end so a two-ended walk never collapses onto itself.
 */
function randomStart(
  tracks: Track[],
  neighbours: Map<string, string[]>,
  exclude: string | null,
  rand: () => number,
): string {
  const eligible = tracks.filter((t) => t.id !== exclude)
  const pool = eligible.length > 0 ? eligible : tracks
  const connected = pool.filter((t) => (neighbours.get(t.id)?.length ?? 0) > 0)
  const from = connected.length > 0 ? connected : pool
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))].id
}

/** Rank unvisited neighbours of `current` by score (descending, id tie-break). */
function rankedCandidates(
  current: Track,
  neighbours: Map<string, string[]>,
  byId: Map<string, Track>,
  used: ReadonlySet<string>,
  criteria: CriteriaConfig,
  genreMatch: GenreMatcher,
  scoreExtra?: (candidate: Track) => number,
): { item: string; score: number }[] {
  return (neighbours.get(current.id) ?? [])
    .filter((id) => !used.has(id))
    .map((id) => {
      const candidate = byId.get(id)!
      const score =
        scoreCandidate(current, candidate, criteria, genreMatch) + (scoreExtra?.(candidate) ?? 0)
      return { item: id, score }
    })
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
}

export function suggestWalk(
  tracks: Track[],
  criteria: CriteriaConfig,
  options: SuggestOptions = {},
): string[] {
  const {
    seedId = null,
    endId = null,
    length = 15,
    randomness = 0,
    seed = 0,
    progression = 'any',
    mustIncludeIds = [],
  } = options
  if (tracks.length === 0) return []

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const neighbours = buildNeighbours(tracks, criteria)
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria,
  )
  const rand = mulberry32(seed)

  const pinnedEnd = endId !== null && byId.has(endId) ? endId : null
  const start =
    seedId !== null && byId.has(seedId) ? seedId : randomStart(tracks, neighbours, pinnedEnd, rand)
  const end = pinnedEnd !== null && pinnedEnd !== start ? pinnedEnd : null

  // Must-include bias: a strong bonus until each marked track is placed.
  // Biased, not guaranteed — a track that never neighbours the walk's tip
  // (or a walk that fills up first) skips it (design-v6 §C).
  const pending = new Set(mustIncludeIds.filter((id) => byId.has(id)))
  pending.delete(start)
  if (end !== null) pending.delete(end)
  const pendingBonus = (candidate: Track) => (pending.has(candidate.id) ? MUST_INCLUDE_BONUS : 0)
  const progressionTerm = (current: Track, step: number, arm: BpmProgression) =>
    arm === 'any'
      ? () => 0
      : (candidate: Track) =>
          PROGRESSION_WEIGHT * progressionFit(current.bpm, candidate.bpm, step, arm)

  if (end === null) {
    const walk = [start]
    const visited = new Set([start])
    while (walk.length < length) {
      const current = byId.get(walk[walk.length - 1])!
      const fitTerm = progressionTerm(current, walk.length - 1, progression)
      const candidates = rankedCandidates(
        current,
        neighbours,
        byId,
        visited,
        criteria,
        genreMatch,
        (candidate) => pendingBonus(candidate) + fitTerm(candidate),
      )
      if (candidates.length === 0) break
      const next = pick(candidates, randomness, rand)
      walk.push(next)
      visited.add(next)
      pending.delete(next)
    }
    return walk
  }

  // Pinned closer: grow two arms — from the opener forward and the closer
  // backward — always extending the arm with the better candidate, nudged
  // toward each other by a genre-similarity convergence bonus. The seam
  // where the arms meet is not guaranteed to be a combo edge (design-v5 §C).
  // The end arm grows backward in play order, so it sees the progression
  // time-reversed (rising ↔ falling; the sawtooth phase there is an
  // approximation — the arm's final play positions aren't known yet).
  const startArm = [start]
  const endArm = [end]
  const visited = new Set([start, end])
  const towards = (other: Track) => (candidate: Track) =>
    other.genre !== null && candidate.genre !== null
      ? 0.3 * genreSimilarity(candidate.genre, other.genre, criteria.genre.method)
      : 0
  while (startArm.length + endArm.length < length) {
    const tipA = byId.get(startArm[startArm.length - 1])!
    const tipB = byId.get(endArm[endArm.length - 1])!
    const towardsB = towards(tipB)
    const towardsA = towards(tipA)
    const fitA = progressionTerm(tipA, startArm.length - 1, progression)
    const fitB = progressionTerm(tipB, endArm.length - 1, invertProgression(progression))
    const fromStart = rankedCandidates(
      tipA,
      neighbours,
      byId,
      visited,
      criteria,
      genreMatch,
      (candidate) => towardsB(candidate) + pendingBonus(candidate) + fitA(candidate),
    )
    const fromEnd = rankedCandidates(
      tipB,
      neighbours,
      byId,
      visited,
      criteria,
      genreMatch,
      (candidate) => towardsA(candidate) + pendingBonus(candidate) + fitB(candidate),
    )
    if (fromStart.length === 0 && fromEnd.length === 0) break
    const extendStart =
      fromEnd.length === 0 || (fromStart.length > 0 && fromStart[0].score >= fromEnd[0].score)
    const next = pick(extendStart ? fromStart : fromEnd, randomness, rand)
    ;(extendStart ? startArm : endArm).push(next)
    visited.add(next)
    pending.delete(next)
  }
  return [...startArm, ...endArm.reverse()]
}

export interface NextSuggestion {
  trackId: string
  /** Where to splice the track into the current set. */
  insertIndex: number
}

/** The hub's insertion anchor: the selected set track, else the last one. */
function nextAnchorIndex(tracklist: string[], selectedId: string | null): number {
  return selectedId !== null && tracklist.includes(selectedId)
    ? tracklist.indexOf(selectedId)
    : tracklist.length - 1
}

/** The track the hub button would extend from; null when the set is empty. */
export function nextAnchorId(tracklist: string[], selectedId: string | null): string | null {
  if (tracklist.length === 0) return null
  return tracklist[nextAnchorIndex(tracklist, selectedId)]
}

/**
 * True when the hub's anchor has no unused combo neighbour left — the state
 * where suggestNext would return null and only a forced (non-matching) pick
 * remains (design-v6 §C). Takes the stores' adjacency map shape so the view
 * derives it without re-running edge computation. An empty set is never
 * exhausted: it always has an opener.
 */
export function nextExhausted(
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
  tracklist: string[],
  selectedId: string | null,
): boolean {
  const anchorId = nextAnchorId(tracklist, selectedId)
  if (anchorId === null) return false
  const used = new Set(tracklist)
  for (const id of neighbours.get(anchorId) ?? []) {
    if (!used.has(id)) return false
  }
  return true
}

/**
 * Whether the retry ring has anything to offer after a hub pick (issue 17):
 * true when re-drawing `lastPick` could yield a DIFFERENT track from the
 * same pool the pick came from. Takes the stores' adjacency-map shape so the
 * view derives it without re-running edge computation.
 * - Stale picks (the set changed since) never retry.
 * - An empty-set opener retries while any other visible track remains.
 * - A normal pick retries while its anchor has another unused neighbour.
 * - A forced pick (not a neighbour of its anchor) retries over any other
 *   unused visible track — it was already rule-breaking.
 */
export function retryAlternativeExists(
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
  tracklist: string[],
  lastPick: NextSuggestion | null,
  visibleIds: readonly string[],
): boolean {
  if (lastPick === null) return false
  const { trackId, insertIndex } = lastPick
  if (tracklist[insertIndex] !== trackId) return false
  const used = new Set(tracklist)
  if (insertIndex === 0) {
    return visibleIds.some((id) => !used.has(id))
  }
  const anchorNeighbours = neighbours.get(tracklist[insertIndex - 1])
  if (anchorNeighbours?.has(trackId) !== true) {
    return visibleIds.some((id) => !used.has(id))
  }
  for (const id of anchorNeighbours) {
    if (!used.has(id)) return true
  }
  return false
}

/**
 * Suggest a single next track for the current set (the wheel's hub button).
 * Anchored at the selected track when it is in the set (inserting between it
 * and its successor, scored against *both* neighbours), otherwise appended
 * after the last track. An empty set starts with the selection, or a seeded
 * random connected track. With `force`, an exhausted anchor falls back to the
 * best-scoring track that is NOT a combo neighbour — the "break the rules
 * knowingly" path; null then only means every track is already in the set.
 */
export function suggestNext(
  tracks: Track[],
  criteria: CriteriaConfig,
  tracklist: string[],
  options: Omit<SuggestOptions, 'seedId' | 'length' | 'mustIncludeIds'> & {
    selectedId?: string | null
    force?: boolean
    /** Never suggest these ids (the retry ring excludes earlier picks). */
    excludeIds?: readonly string[]
  } = {},
): NextSuggestion | null {
  const {
    selectedId = null,
    randomness = 0,
    seed = 0,
    progression = 'any',
    force = false,
    excludeIds = [],
  } = options
  if (tracks.length === 0) return null

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const neighbours = buildNeighbours(tracks, criteria)
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria,
  )
  const excluded = new Set(excludeIds)

  if (tracklist.length === 0) {
    // Opener: the selection when one is set, else a seeded RANDOM connected
    // track — pressing the hub again explores instead of repeating (issue 17).
    if (selectedId !== null && byId.has(selectedId) && !excluded.has(selectedId)) {
      return { trackId: selectedId, insertIndex: 0 }
    }
    const pool = tracks.filter((t) => !excluded.has(t.id))
    if (pool.length === 0) return null
    return { trackId: randomStart(pool, neighbours, null, mulberry32(seed)), insertIndex: 0 }
  }

  const anchorIndex = nextAnchorIndex(tracklist, selectedId)
  const anchor = byId.get(tracklist[anchorIndex])
  if (anchor === undefined) return null
  const successor = byId.get(tracklist[anchorIndex + 1] ?? '')

  const used = new Set([...tracklist, ...excludeIds])
  const scoreExtra = (candidate: Track) =>
    (successor !== undefined ? scoreCandidate(candidate, successor, criteria, genreMatch) : 0) +
    (progression === 'any'
      ? 0
      : PROGRESSION_WEIGHT * progressionFit(anchor.bpm, candidate.bpm, anchorIndex, progression))
  let candidates = rankedCandidates(
    anchor,
    neighbours,
    byId,
    used,
    criteria,
    genreMatch,
    scoreExtra,
  )

  if (candidates.length === 0 && force) {
    // Forced: rank every unused track by the same score, edge gate ignored.
    candidates = tracks
      .filter((t) => !used.has(t.id))
      .map((t) => ({
        item: t.id,
        score: scoreCandidate(anchor, t, criteria, genreMatch) + scoreExtra(t),
      }))
      .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
  }
  if (candidates.length === 0) return null

  const trackId = pick(candidates, randomness, mulberry32(seed))
  return { trackId, insertIndex: anchorIndex + 1 }
}
