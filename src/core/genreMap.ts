/**
 * Pure logic behind the genre map's calm rendering (v13): the resting
 * skeleton, the wheel-style focus tiers, size-scaled physics and the
 * ghost-anchor bookkeeping. The component keeps only wiring; everything
 * decidable from plain data lives here.
 */

import { packNeighbours } from './genre'

export interface MapEdge {
  a: string
  b: string
  score: number
}

/** Unordered pair key — same encoding the map view already uses. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}${b}` : `${b}${a}`
}

/**
 * The resting skeleton: the union over nodes of each node's strongest
 * incident edge. Every connected genre keeps exactly one anchor line, so the
 * cluster structure stays legible without the full hairball. Ties break to
 * the lexicographically smaller pair so input order never changes the map.
 */
export function skeletonKeys(edges: readonly MapEdge[]): Set<string> {
  const best = new Map<string, MapEdge>()
  for (const edge of edges) {
    for (const end of [edge.a, edge.b]) {
      const current = best.get(end)
      if (
        current === undefined ||
        edge.score > current.score ||
        (edge.score === current.score && pairKey(edge.a, edge.b) < pairKey(current.a, current.b))
      ) {
        best.set(end, edge)
      }
    }
  }
  return new Set([...best.values()].map((edge) => pairKey(edge.a, edge.b)))
}

/**
 * Resting-edge opacity eases down as the map grows (same √(n/22) family as
 * the containment gravity), clamped to stay readable.
 */
export function skeletonOpacity(nodeCount: number): number {
  const raw = 0.42 / Math.max(1, Math.sqrt(nodeCount / 22))
  return Math.min(0.42, Math.max(0.16, raw))
}

export interface MapMotion {
  velocityDecay: number
  dragAlphaTarget: number
}

/**
 * Physics calm scales with node count (v13 issue 2): bigger maps damp harder
 * and a drag injects less energy, so a 36-genre library drifts instead of
 * churning. ≤22 nodes keeps the classic tuning exactly.
 */
export function mapMotion(nodeCount: number): MapMotion {
  const growth = Math.max(1, Math.sqrt(nodeCount / 22))
  return {
    velocityDecay: Math.min(0.8, 0.6 + 0.2 * (growth - 1)),
    // Half of d3's classic 0.3: with the map's deliberately slow cooling, a
    // 0.3 target keeps the whole field boiling for as long as the mouse is
    // held; 0.15 still lets neighbours follow an active drag.
    dragAlphaTarget: Math.max(0.06, 0.15 / growth),
  }
}

/**
 * Which unowned pack neighbours to show as ghosts, and — new in v13 — which
 * library genre(s) summoned each one. Ghosts only ever draw (and are only
 * pulled by) links to their anchors, so "show nearby genres" tethers context
 * to the map instead of flooding it.
 */
export function ghostAnchors(
  libraryLabels: Iterable<string>,
  perGenre: number,
  neighboursOf: (label: string, limit: number) => [string, number][] = packNeighbours,
): Map<string, Set<string>> {
  const library = new Set(libraryLabels)
  const anchors = new Map<string, Set<string>>()
  for (const label of library) {
    for (const [neighbour] of neighboursOf(label, perGenre)) {
      if (library.has(neighbour)) continue
      let summoners = anchors.get(neighbour)
      if (summoners === undefined) anchors.set(neighbour, (summoners = new Set()))
      summoners.add(label)
    }
  }
  return anchors
}

export interface MapFocusState {
  hover: string | null
  /** The single inspected genre (first click of the compare flow). */
  selected: string | null
  pair: readonly [string, string] | null
}

export type EdgeTier = 'pair' | 'star' | 'skeleton' | null

/**
 * The focus state machine (v13 issue 3, mirroring the wheel's focus-only
 * edges): the compare pair's own link pops above everything; a hovered or
 * selected genre lights its full star; the resting set stays faint; the rest
 * is not drawn at all.
 */
export function edgeTier(
  edge: { a: string; b: string },
  state: MapFocusState,
  resting: ReadonlySet<string>,
): EdgeTier {
  const key = pairKey(edge.a, edge.b)
  if (state.pair !== null && key === pairKey(state.pair[0], state.pair[1])) return 'pair'
  const stars = (id: string | null) => id !== null && (edge.a === id || edge.b === id)
  if (stars(state.hover) || stars(state.selected)) return 'star'
  if (resting.has(key)) return 'skeleton'
  return null
}
