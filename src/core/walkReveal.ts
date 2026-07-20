/**
 * Timing plan for the walk-draw reveal (v12 WS1): after ✨/⚡ the wheel draws
 * the walk node-by-node. Node i lights up at i·step; edge i (from node i to
 * node i+1) draws during [i·step, (i+1)·step]; the whole reveal lasts n·step.
 * Purely presentational — the set itself is written in one store update, so
 * undo semantics never see any of this.
 */

export const WALK_REVEAL_STEP_MS = 140
/** A reveal never runs longer than this: long walks compress their step so a
 * 99-track set draws in ~4s, not 14 (v12). */
const MAX_REVEAL_TOTAL_MS = 4000
const MIN_STEP_MS = 40

interface WalkRevealPlan {
  /** Delay per track id, first occurrence — a duplicate lights its dot once. */
  nodeDelays: Map<string, number>
  /** Delay per walk edge, indexed like the walk's consecutive pairs. */
  edgeDelays: number[]
  /** The step actually used (capped for long walks) — views animate with
   * THIS, never the raw constant, or their stagger drifts off the plan. */
  stepMs: number
  /** Total reveal duration; 0 for an empty walk. */
  totalMs: number
}

export function walkRevealPlan(ids: readonly string[], stepMs?: number): WalkRevealPlan {
  stepMs ??= Math.min(
    WALK_REVEAL_STEP_MS,
    Math.max(MIN_STEP_MS, MAX_REVEAL_TOTAL_MS / Math.max(1, ids.length)),
  )
  const nodeDelays = new Map<string, number>()
  ids.forEach((id, i) => {
    if (!nodeDelays.has(id)) nodeDelays.set(id, i * stepMs)
  })
  const edgeDelays = ids.slice(1).map((_, i) => i * stepMs)
  return { nodeDelays, edgeDelays, stepMs, totalMs: ids.length * stepMs }
}
