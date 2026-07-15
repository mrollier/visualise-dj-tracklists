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
    // With half/double-time on, an exact 2× tempo is as close as an exact 1×.
    const ratios = criteria.bpm.halfDouble ? [1, 2, 0.5] : [1]
    const delta = Math.min(...ratios.map((r) => Math.abs(current.bpm! - candidate.bpm! * r)))
    bpm = 1 / (1 + delta / 4)
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

/** Best-connected track, ties broken by id — the empty-set hub suggestion. */
function bestConnected(tracks: Track[], neighbours: Map<string, string[]>): string {
  return [...tracks].sort(
    (a, b) =>
      (neighbours.get(b.id)?.length ?? 0) - (neighbours.get(a.id)?.length ?? 0) ||
      a.id.localeCompare(b.id),
  )[0].id
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
  const { seedId = null, endId = null, length = 15, randomness = 0, seed = 0 } = options
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
    seedId !== null && byId.has(seedId)
      ? seedId
      : randomStart(tracks, neighbours, pinnedEnd, rand)
  const end = pinnedEnd !== null && pinnedEnd !== start ? pinnedEnd : null

  if (end === null) {
    const walk = [start]
    const visited = new Set([start])
    while (walk.length < length) {
      const current = byId.get(walk[walk.length - 1])!
      const candidates = rankedCandidates(current, neighbours, byId, visited, criteria, genreMatch)
      if (candidates.length === 0) break
      const next = pick(candidates, randomness, rand)
      walk.push(next)
      visited.add(next)
    }
    return walk
  }

  // Pinned closer: grow two arms — from the opener forward and the closer
  // backward — always extending the arm with the better candidate, nudged
  // toward each other by a genre-similarity convergence bonus. The seam
  // where the arms meet is not guaranteed to be a combo edge (design-v5 §C).
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
    const fromStart = rankedCandidates(
      tipA,
      neighbours,
      byId,
      visited,
      criteria,
      genreMatch,
      towards(tipB),
    )
    const fromEnd = rankedCandidates(
      tipB,
      neighbours,
      byId,
      visited,
      criteria,
      genreMatch,
      towards(tipA),
    )
    if (fromStart.length === 0 && fromEnd.length === 0) break
    const extendStart =
      fromEnd.length === 0 || (fromStart.length > 0 && fromStart[0].score >= fromEnd[0].score)
    const next = pick(extendStart ? fromStart : fromEnd, randomness, rand)
    ;(extendStart ? startArm : endArm).push(next)
    visited.add(next)
  }
  return [...startArm, ...endArm.reverse()]
}

export interface NextSuggestion {
  trackId: string
  /** Where to splice the track into the current set. */
  insertIndex: number
}

/**
 * Suggest a single next track for the current set (the wheel's hub button).
 * Anchored at the selected track when it is in the set (inserting between it
 * and its successor, scored against *both* neighbours), otherwise appended
 * after the last track. An empty set starts with the selection, or the
 * best-connected track.
 */
export function suggestNext(
  tracks: Track[],
  criteria: CriteriaConfig,
  tracklist: string[],
  options: Omit<SuggestOptions, 'seedId' | 'length'> & { selectedId?: string | null } = {},
): NextSuggestion | null {
  const { selectedId = null, randomness = 0, seed = 0 } = options
  if (tracks.length === 0) return null

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const neighbours = buildNeighbours(tracks, criteria)
  const genreMatch = makeGenreMatcher(
    tracks.map((t) => t.genre),
    criteria,
  )

  if (tracklist.length === 0) {
    const trackId =
      selectedId !== null && byId.has(selectedId) ? selectedId : bestConnected(tracks, neighbours)
    return { trackId, insertIndex: 0 }
  }

  const anchorIndex =
    selectedId !== null && tracklist.includes(selectedId)
      ? tracklist.indexOf(selectedId)
      : tracklist.length - 1
  const anchor = byId.get(tracklist[anchorIndex])
  if (anchor === undefined) return null
  const successor = byId.get(tracklist[anchorIndex + 1] ?? '')

  const used = new Set(tracklist)
  const candidates = rankedCandidates(
    anchor,
    neighbours,
    byId,
    used,
    criteria,
    genreMatch,
    (candidate) =>
      successor !== undefined ? scoreCandidate(candidate, successor, criteria, genreMatch) : 0,
  )
  if (candidates.length === 0) return null

  const trackId = pick(candidates, randomness, mulberry32(seed))
  return { trackId, insertIndex: anchorIndex + 1 }
}
