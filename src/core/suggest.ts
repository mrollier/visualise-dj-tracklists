import { computeEdges, evaluateCombo, type CriteriaConfig } from './combos'
import type { Track } from './model'

/**
 * Suggest a trajectory through the metadata space (remark 7): a greedy walk
 * over the combo graph. From the seed (or the best-connected track), keep
 * moving to the unvisited neighbour with the most matched criteria,
 * tie-broken by smallest BPM difference, then by id for determinism. Stops
 * at the target length or when no unvisited neighbour remains.
 *
 * Deliberately simple — this is a starting point the DJ edits, not an oracle.
 */
export interface SuggestOptions {
  seedId?: string | null
  length?: number
}

export function suggestWalk(
  tracks: Track[],
  criteria: CriteriaConfig,
  options: SuggestOptions = {},
): string[] {
  const { seedId = null, length = 15 } = options
  if (tracks.length === 0) return []

  const byId = new Map(tracks.map((t) => [t.id, t]))
  const neighbours = new Map<string, string[]>()
  for (const edge of computeEdges(tracks, criteria)) {
    if (!neighbours.has(edge.sourceId)) neighbours.set(edge.sourceId, [])
    if (!neighbours.has(edge.targetId)) neighbours.set(edge.targetId, [])
    neighbours.get(edge.sourceId)!.push(edge.targetId)
    neighbours.get(edge.targetId)!.push(edge.sourceId)
  }

  let start = seedId !== null && byId.has(seedId) ? seedId : null
  if (start === null) {
    // Best-connected track; ties broken by id for determinism.
    const sorted = [...tracks].sort(
      (a, b) =>
        (neighbours.get(b.id)?.length ?? 0) - (neighbours.get(a.id)?.length ?? 0) ||
        a.id.localeCompare(b.id),
    )
    start = sorted[0].id
  }

  const walk = [start]
  const visited = new Set([start])
  while (walk.length < length) {
    const current = byId.get(walk[walk.length - 1])!
    const candidates = (neighbours.get(current.id) ?? []).filter((id) => !visited.has(id))
    if (candidates.length === 0) break
    candidates.sort((idA, idB) => {
      const a = byId.get(idA)!
      const b = byId.get(idB)!
      const matchDiff =
        evaluateCombo(current, b, criteria).matched.length -
        evaluateCombo(current, a, criteria).matched.length
      if (matchDiff !== 0) return matchDiff
      const bpmDelta = (t: Track) =>
        current.bpm !== null && t.bpm !== null ? Math.abs(current.bpm - t.bpm) : Infinity
      if (bpmDelta(a) !== bpmDelta(b)) return bpmDelta(a) - bpmDelta(b)
      return idA.localeCompare(idB)
    })
    walk.push(candidates[0])
    visited.add(candidates[0])
  }
  return walk
}
