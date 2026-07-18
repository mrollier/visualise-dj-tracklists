/**
 * Timing plan for the walk-draw reveal (v12 WS1): after ✨/⚡ the wheel draws
 * the walk node-by-node. Node i lights up at i·step; edge i (from node i to
 * node i+1) draws during [i·step, (i+1)·step]; the whole reveal lasts n·step.
 * Purely presentational — the set itself is written in one store update, so
 * undo semantics never see any of this.
 */

export const WALK_REVEAL_STEP_MS = 140

export interface WalkRevealPlan {
  /** Delay per track id, first occurrence — a duplicate lights its dot once. */
  nodeDelays: Map<string, number>
  /** Delay per walk edge, indexed like the walk's consecutive pairs. */
  edgeDelays: number[]
  /** Total reveal duration; 0 for an empty walk. */
  totalMs: number
}

export function walkRevealPlan(
  ids: readonly string[],
  stepMs: number = WALK_REVEAL_STEP_MS,
): WalkRevealPlan {
  const nodeDelays = new Map<string, number>()
  ids.forEach((id, i) => {
    if (!nodeDelays.has(id)) nodeDelays.set(id, i * stepMs)
  })
  const edgeDelays = ids.slice(1).map((_, i) => i * stepMs)
  return { nodeDelays, edgeDelays, totalMs: ids.length * stepMs }
}
