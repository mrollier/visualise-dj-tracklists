import {
  computeEdges,
  demandedCount,
  evaluateCombo,
  keysNearlyMatch,
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
interface SuggestOptions {
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
  /**
   * Tracks that MUST appear in the walk (v14 S1). Slots are reserved so every
   * one is placed — harmonious neighbours preferred, a forced edge as a last
   * resort, even in plain (non-`force`) mode. Fillers may reorder under
   * randomness; an essential is never dropped.
   */
  mustIncludeIds?: readonly string[]
  /**
   * When a tip runs out of combo candidates, fill the step with the best
   * NON-matching track instead of stopping short (v11 issue 16b) — the same
   * knowingly-rule-breaking pool as the wheel hub's force, softmax-sampled
   * with the same randomness. Each such step counts into `forced`.
   */
  force?: boolean
  /**
   * Planning annotations (v12 WS9): user-marked pairs count as edges (the
   * walk may traverse them) and carry a strong bonus, like must-include.
   */
  manualEdges?: readonly ManualPair[]
  /**
   * How strongly a user-marked combo pulls the walk (v14 S3). Defaults to
   * MANUAL_EDGE_BONUS (5); 0 removes the preference (the edge still exists),
   * 10 lets it dominate every ordinary match. The Advanced menu tunes it.
   */
  manualEdgeWeight?: number
  /**
   * Steer away from two tracks by the same artist back to back (v31 #1).
   * A soft penalty, not a ban: a same-artist candidate loses to any
   * reasonable alternative but still wins when nothing else is left, so the
   * preference can never cut a walk short or displace a guaranteed essential.
   */
  avoidSameArtist?: boolean
}

/** An unordered user-marked pair; the store's ManualEdge extends it with a tag. */
export interface ManualPair {
  a: string
  b: string
}

function pairKey(x: string, y: string): string {
  return x < y ? `${x}\n${y}` : `${y}\n${x}`
}

interface SuggestedWalk {
  ids: string[]
  /** How many steps had to break the criteria (0 without `force`). */
  forced: number
  /**
   * How many transitions in the FINISHED walk keep the same artist (v31 #1).
   * Counted over the emitted ids rather than tallied per step, so it also
   * sees the two-arm seam and the pinned anchors — neither of which is scored.
   */
  sameArtist: number
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
/** A user-marked combo is a deliberate plan: rank it like a must-include. */
const MANUAL_EDGE_BONUS = 5
/**
 * Forced picks only: a nudge towards ±2/±7-semitone key relations, below
 * the 0.5 genre weight so it re-ranks harmonic near-ties, not styles.
 */
const KEY_AFFINITY_BONUS = 0.3
/**
 * Two tracks by one artist back to back read as a mistake in a set (v31 #1).
 * Soft, not a ban: above the practical matched-criteria spread, so a
 * same-artist candidate loses to any reasonable alternative — but below
 * MUST_INCLUDE_BONUS / MANUAL_EDGE_BONUS, so a guaranteed essential and a
 * hand-marked combo still outrank the preference.
 */
const SAME_ARTIST_PENALTY = 4

function normalizeArtist(name: string): string {
  // toLowerCase, not toLocaleLowerCase: this is an identity key, and under
  // tr-TR the locale form splits "IIO" from "iiO", which would make the same
  // seed produce a different walk on a different machine.
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Whether two tracks share an artist: trim/case/whitespace-insensitive, and
 * an unknown artist never matches another unknown — "no data" is not a match.
 * Deliberately exact on the whole field, so "X feat. Y" is not "X".
 */
export function sameArtist(a: Track, b: Track): boolean {
  if (a.artist === null || b.artist === null) return false
  const left = normalizeArtist(a.artist)
  return left !== '' && left === normalizeArtist(b.artist)
}

/** Consecutive same-artist transitions in a finished walk. */
function countSameArtist(ids: string[], byId: Map<string, Track>): number {
  let count = 0
  for (let i = 1; i < ids.length; i++) {
    const a = byId.get(ids[i - 1])
    const b = byId.get(ids[i])
    if (a !== undefined && b !== undefined && sameArtist(a, b)) count++
  }
  return count
}

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

/** Adjacency lookup: who neighbours `id` in the combo graph. */
type NeighboursOf = (id: string) => string[]

/**
 * At threshold 0 the combo graph is complete (v11 issue 2a) — everyone
 * neighbours everyone, computed lazily instead of materializing n²/2 edges.
 * Otherwise the usual adjacency map from computeEdges.
 */
function buildNeighbours(
  tracks: Track[],
  criteria: CriteriaConfig,
  manualEdges: readonly ManualPair[] = [],
): NeighboursOf {
  if (criteria.threshold === 0 && demandedCount(criteria) === 0) {
    // Complete graph subsumes every manual pair — but only when nothing is
    // demanded (v14 C2): a locked criterion still filters every pair, so the
    // adjacency must be computed from real edges instead.
    const ids = tracks.map((t) => t.id)
    return (id) => ids.filter((other) => other !== id)
  }
  const neighbours = new Map<string, string[]>()
  const connect = (x: string, y: string) => {
    if (!neighbours.has(x)) neighbours.set(x, [])
    if (!neighbours.has(y)) neighbours.set(y, [])
    if (!neighbours.get(x)!.includes(y)) neighbours.get(x)!.push(y)
    if (!neighbours.get(y)!.includes(x)) neighbours.get(y)!.push(x)
  }
  for (const edge of computeEdges(tracks, criteria)) connect(edge.sourceId, edge.targetId)
  // Manual pairs are roads too (v12 WS9) — only between tracks that exist.
  const known = new Set(tracks.map((t) => t.id))
  for (const { a, b } of manualEdges) {
    if (a !== b && known.has(a) && known.has(b)) connect(a, b)
  }
  return (id) => neighbours.get(id) ?? []
}

/**
 * Uniformly random walk opener (remark: generated sets must not always open
 * with the same track): a connected track when any exists, excluding the
 * pinned end so a two-ended walk never collapses onto itself.
 */
function randomStart(
  tracks: Track[],
  neighbours: NeighboursOf,
  exclude: string | null,
  rand: () => number,
): string {
  const eligible = tracks.filter((t) => t.id !== exclude)
  const pool = eligible.length > 0 ? eligible : tracks
  const connected = pool.filter((t) => neighbours(t.id).length > 0)
  const from = connected.length > 0 ? connected : pool
  return from[Math.min(from.length - 1, Math.floor(rand() * from.length))].id
}

/** Rank unvisited neighbours of `current` by score (descending, id tie-break). */
function rankedCandidates(
  current: Track,
  neighbours: NeighboursOf,
  byId: Map<string, Track>,
  used: ReadonlySet<string>,
  criteria: CriteriaConfig,
  genreMatch: GenreMatcher,
  scoreExtra?: (candidate: Track) => number,
): { item: string; score: number }[] {
  return neighbours(current.id)
    .filter((id) => !used.has(id))
    .map((id) => {
      const candidate = byId.get(id)!
      const score =
        scoreCandidate(current, candidate, criteria, genreMatch) + (scoreExtra?.(candidate) ?? 0)
      return { item: id, score }
    })
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
}

/**
 * The forced candidate pool (v8 issue 16, shared with suggestNext since
 * v11): every unused track ranked by the usual score, edge gate ignored,
 * with a gentle preference for keys a ±2/±7-semitone move away — the least
 * dissonant of the rule-breaking options.
 */
function forcedCandidates(
  current: Track,
  tracks: Track[],
  used: ReadonlySet<string>,
  criteria: CriteriaConfig,
  genreMatch: GenreMatcher,
  scoreExtra: (candidate: Track) => number,
): { item: string; score: number }[] {
  return tracks
    .filter((t) => !used.has(t.id))
    .map((t) => ({
      item: t.id,
      score:
        scoreCandidate(current, t, criteria, genreMatch) +
        (keysNearlyMatch(current, t, criteria) ? KEY_AFFINITY_BONUS : 0) +
        scoreExtra(t),
    }))
    .sort((a, b) => b.score - a.score || a.item.localeCompare(b.item))
}

export function suggestWalk(
  tracks: Track[],
  criteria: CriteriaConfig,
  options: SuggestOptions = {},
): SuggestedWalk {
  const {
    seedId = null,
    endId = null,
    length = 15,
    randomness = 0,
    seed = 0,
    progression = 'any',
    mustIncludeIds = [],
    force = false,
    manualEdges = [],
    manualEdgeWeight = MANUAL_EDGE_BONUS,
    avoidSameArtist = false,
  } = options
  if (tracks.length === 0) return { ids: [], forced: 0, sameArtist: 0 }

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const neighbours = buildNeighbours(tracks, criteria, manualEdges)
  const manualSet = new Set(manualEdges.map(({ a, b }) => pairKey(a, b)))
  const manualTerm = (current: Track) => (candidate: Track) =>
    manualSet.has(pairKey(current.id, candidate.id)) ? manualEdgeWeight : 0
  // Folded into the shared `extra` term, which BOTH rankedCandidates and
  // forcedCandidates receive — the plain and force runs must score (and so
  // consume the PRNG) identically for the ⚡ continue-in-place rule below.
  const artistTerm = (current: Track) => (candidate: Track) =>
    avoidSameArtist && sameArtist(current, candidate) ? -SAME_ARTIST_PENALTY : 0
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria,
  )
  const rand = mulberry32(seed)

  const pinnedEnd = endId !== null && byId.has(endId) ? endId : null
  const start =
    seedId !== null && byId.has(seedId) ? seedId : randomStart(tracks, neighbours, pinnedEnd, rand)
  const end = pinnedEnd !== null && pinnedEnd !== start ? pinnedEnd : null

  // Must-include: a strong bonus keeps essentials near the front of the
  // ranking, but placement is a hard GUARANTEE (v14 S1), not a bias.
  const pending = new Set(mustIncludeIds.filter((id) => byId.has(id)))
  pending.delete(start)
  if (end !== null) pending.delete(end)
  const pendingBonus = (candidate: Track) => (pending.has(candidate.id) ? MUST_INCLUDE_BONUS : 0)

  // v14 S1: essentials are guaranteed. Slots are RESERVED — the target length
  // grows to fit every pending essential (plus the pinned anchors); once the
  // remaining slots equal the pending count only essentials may take a slot,
  // harmonious (neighbour) placements first and a forced edge as a last
  // resort, even in plain ✨ mode. Randomness may reorder fillers, never cost
  // an essential. The plain and force runs consume the PRNG identically up to
  // the plain run's stopping point — the only branch that reads `force` is the
  // final "stop short vs. force through" gate — so a force re-run CONTINUES a
  // short walk in place (v14 S2): strictly extending it for a single-arm walk,
  // and (since a two-arm walk emits startArm ++ reverse(endArm) and forcing
  // only ever appends to an arm) keeping both arms while it fills the seam.
  const anchors = end === null ? 1 : 2
  const targetLength = Math.max(length, anchors + pending.size)
  const progressionTerm = (current: Track, step: number, arm: BpmProgression) =>
    arm === 'any'
      ? () => 0
      : (candidate: Track) =>
          PROGRESSION_WEIGHT * progressionFit(current.bpm, candidate.bpm, step, arm)

  let forced = 0

  if (end === null) {
    const walk = [start]
    const visited = new Set([start])
    while (walk.length < targetLength) {
      const current = byId.get(walk[walk.length - 1])!
      const fitTerm = progressionTerm(current, walk.length - 1, progression)
      const manual = manualTerm(current)
      const artist = artistTerm(current)
      const extra = (candidate: Track) =>
        pendingBonus(candidate) + fitTerm(candidate) + manual(candidate) + artist(candidate)
      const slotsLeft = targetLength - walk.length
      const mustPlaceEssential = pending.size >= slotsLeft
      let candidates = rankedCandidates(
        current,
        neighbours,
        byId,
        visited,
        criteria,
        genreMatch,
        extra,
      )
      let breaking = false
      if (mustPlaceEssential) {
        // Every remaining slot is spoken for: seat an essential this step. A
        // real neighbour is harmonious; otherwise force an edge to one.
        const harmonious = candidates.filter((c) => pending.has(c.item))
        if (harmonious.length > 0) {
          candidates = harmonious
        } else {
          candidates = forcedCandidates(
            current,
            tracks,
            visited,
            criteria,
            genreMatch,
            extra,
          ).filter((c) => pending.has(c.item))
          breaking = true
        }
      } else if (candidates.length === 0) {
        // Essentials may break the criteria even without the force flag — a
        // disconnected must-include is still guaranteed (v14 S1).
        if (pending.size > 0) {
          candidates = forcedCandidates(
            current,
            tracks,
            visited,
            criteria,
            genreMatch,
            extra,
          ).filter((c) => pending.has(c.item))
          breaking = candidates.length > 0
        }
        if (candidates.length === 0) {
          if (!force) break
          candidates = forcedCandidates(current, tracks, visited, criteria, genreMatch, extra)
          if (candidates.length === 0) break // every track is already in
          breaking = true
        }
      }
      const next = pick(candidates, randomness, rand)
      if (breaking) forced++
      walk.push(next)
      visited.add(next)
      pending.delete(next)
    }
    return { ids: walk, forced, sameArtist: countSameArtist(walk, byId) }
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
  while (startArm.length + endArm.length < targetLength) {
    const tipA = byId.get(startArm[startArm.length - 1])!
    const tipB = byId.get(endArm[endArm.length - 1])!
    const towardsB = towards(tipB)
    const towardsA = towards(tipA)
    const fitA = progressionTerm(tipA, startArm.length - 1, progression)
    const fitB = progressionTerm(tipB, endArm.length - 1, invertProgression(progression))
    const manualA = manualTerm(tipA)
    const manualB = manualTerm(tipB)
    const artistA = artistTerm(tipA)
    const artistB = artistTerm(tipB)
    const startExtra = (candidate: Track) =>
      towardsB(candidate) +
      pendingBonus(candidate) +
      fitA(candidate) +
      manualA(candidate) +
      artistA(candidate)
    const endExtra = (candidate: Track) =>
      towardsA(candidate) +
      pendingBonus(candidate) +
      fitB(candidate) +
      manualB(candidate) +
      artistB(candidate)
    const fromStart = rankedCandidates(
      tipA,
      neighbours,
      byId,
      visited,
      criteria,
      genreMatch,
      startExtra,
    )
    const fromEnd = rankedCandidates(
      tipB,
      neighbours,
      byId,
      visited,
      criteria,
      genreMatch,
      endExtra,
    )
    const slotsLeft = targetLength - (startArm.length + endArm.length)
    const mustPlaceEssential = pending.size >= slotsLeft
    // Prefer the higher-scoring arm; the pinned end always seats its essential
    // by forcing from the START arm so the closer stays put.
    const chooseStart = (a: typeof fromStart, b: typeof fromEnd) =>
      b.length === 0 || (a.length > 0 && a[0].score >= b[0].score)
    let breaking = false
    let extendStart: boolean
    let pool: { item: string; score: number }[]
    if (mustPlaceEssential) {
      // Every remaining slot is reserved for an essential (v14 S1). Seat one
      // this step: harmonious on either tip first, a forced edge otherwise.
      const startPending = fromStart.filter((c) => pending.has(c.item))
      const endPending = fromEnd.filter((c) => pending.has(c.item))
      if (startPending.length === 0 && endPending.length === 0) {
        pool = forcedCandidates(tipA, tracks, visited, criteria, genreMatch, startExtra).filter(
          (c) => pending.has(c.item),
        )
        extendStart = true
        breaking = true
      } else {
        extendStart = chooseStart(startPending, endPending)
        pool = extendStart ? startPending : endPending
      }
    } else if (fromStart.length === 0 && fromEnd.length === 0) {
      // Both arms stalled. A disconnected essential is still guaranteed even
      // without the force flag; otherwise force through the broken middle
      // (v11 issue 16b) from the start arm, or stop short as before.
      const stalledPending =
        pending.size > 0
          ? forcedCandidates(tipA, tracks, visited, criteria, genreMatch, startExtra).filter((c) =>
              pending.has(c.item),
            )
          : []
      if (stalledPending.length > 0) {
        pool = stalledPending
        extendStart = true
        breaking = true
      } else {
        if (!force) break
        pool = forcedCandidates(tipA, tracks, visited, criteria, genreMatch, startExtra)
        if (pool.length === 0) break
        extendStart = true
        breaking = true
      }
    } else {
      extendStart = chooseStart(fromStart, fromEnd)
      pool = extendStart ? fromStart : fromEnd
    }
    const next = pick(pool, randomness, rand)
    if (breaking) forced++
    ;(extendStart ? startArm : endArm).push(next)
    visited.add(next)
    pending.delete(next)
  }
  const ids = [...startArm, ...endArm.reverse()]
  return { ids, forced, sameArtist: countSameArtist(ids, byId) }
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
  complete = false,
): boolean {
  // A complete graph (threshold 0, v11 issue 2a) never exhausts — the
  // stores' adjacency map is deliberately empty then.
  if (complete) return false
  const anchorId = nextAnchorId(tracklist, selectedId)
  if (anchorId === null) return false
  const used = new Set(tracklist)
  for (const id of neighbours.get(anchorId) ?? []) {
    if (!used.has(id)) return false
  }
  return true
}

/**
 * The retry ring's state after a hub pick (v8 issues 2+3) — the ring never
 * silently vanishes mid-cycle, it degrades:
 * - 'retry': the anchor still has an unused, untried matching neighbour
 *   (for the edge-less opener slot: any unused, untried visible track).
 * - 'force-retry': matching options are exhausted, but an unused, untried
 *   visible track remains for a rule-breaking swap.
 * - 'reset-only': every alternative has been tried — only the ⟲ restore of
 *   the original pick is left (no auto-reset; the user decides).
 * - 'none': no valid pick to swap (stale/absent), or a pick with no
 *   alternatives that was never retried (nothing to reset either).
 * Takes the stores' adjacency-map shape so the view derives it without
 * re-running edge computation.
 */
type RetryState = 'retry' | 'force-retry' | 'reset-only' | 'none'

export function retryState(
  neighbours: ReadonlyMap<string, ReadonlySet<string>>,
  tracklist: string[],
  lastPick: NextSuggestion | null,
  triedIds: readonly string[],
  visibleIds: readonly string[],
  complete = false,
): RetryState {
  if (lastPick === null) return 'none'
  const { trackId, insertIndex } = lastPick
  if (tracklist[insertIndex] !== trackId) return 'none'
  const used = new Set(tracklist)
  const tried = new Set(triedIds)
  const fresh = (id: string): boolean => !used.has(id) && !tried.has(id)
  if (insertIndex === 0) {
    // Opener slot: openers are drawn from the whole pool, not edge-gated.
    if (visibleIds.some(fresh)) return 'retry'
  } else if (complete) {
    // Threshold 0 (v11 issue 2a): every fresh track is a MATCHING retry.
    if (visibleIds.some(fresh)) return 'retry'
  } else {
    for (const id of neighbours.get(tracklist[insertIndex - 1]) ?? []) {
      if (fresh(id)) return 'retry'
    }
    if (visibleIds.some(fresh)) return 'force-retry'
  }
  return tried.size > 0 ? 'reset-only' : 'none'
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
    manualEdges = [],
    manualEdgeWeight = MANUAL_EDGE_BONUS,
    avoidSameArtist = false,
  } = options
  if (tracks.length === 0) return null

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const neighbours = buildNeighbours(tracks, criteria, manualEdges)
  const manualSet = new Set(manualEdges.map(({ a, b }) => pairKey(a, b)))
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
    (manualSet.has(pairKey(anchor.id, candidate.id)) ? manualEdgeWeight : 0) +
    (progression === 'any'
      ? 0
      : PROGRESSION_WEIGHT * progressionFit(anchor.bpm, candidate.bpm, anchorIndex, progression)) +
    // The hub inserts BETWEEN two tracks, so both sides of the new seam count.
    (avoidSameArtist &&
    (sameArtist(anchor, candidate) || (successor !== undefined && sameArtist(candidate, successor)))
      ? -SAME_ARTIST_PENALTY
      : 0)
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
    candidates = forcedCandidates(anchor, tracks, used, criteria, genreMatch, scoreExtra)
  }
  if (candidates.length === 0) return null

  const trackId = pick(candidates, randomness, mulberry32(seed))
  return { trackId, insertIndex: anchorIndex + 1 }
}
