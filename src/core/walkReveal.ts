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
  /** Delay per track id, first occurrence in the animated window — a duplicate
   * lights its dot once; prefix/suffix (already-drawn) nodes are absent. */
  nodeDelays: Map<string, number>
  /** Delay per walk edge, indexed like the walk's consecutive pairs; `null` =
   * an already-drawn edge that must NOT re-animate (S4). */
  edgeDelays: (number | null)[]
  /** The step actually used (capped for long walks) — views animate with
   * THIS, never the raw constant, or their stagger drifts off the plan. */
  stepMs: number
  /** Total reveal duration; 0 for an empty walk. */
  totalMs: number
  /** First animated node index (0 for a fresh, full reveal). Consumers gate
   * their per-row reveal on `index >= from` (S4). */
  from: number
  /** Delay anchor = max(0, from-1): the already-drawn seam node the animated
   * tail chains from, so its first new node lands one step in. */
  origin: number
}

/**
 * Plan the reveal over `ids`. With no `from`/`to` the whole walk animates from
 * index 0 (fresh ✨, unchanged from v12). ⚡ continue-in-place (S4) passes the
 * `[from, to)` range of newly-added nodes — from a prefix+suffix diff of the
 * old vs new walk (`revealRange`) — so only that middle animates and the
 * already-drawn prefix/suffix stay put. `origin = max(0, from-1)` chains the
 * tail off the last drawn node.
 */
export function walkRevealPlan(
  ids: readonly string[],
  opts?: { stepMs?: number; from?: number; to?: number },
): WalkRevealPlan {
  const from = Math.max(0, Math.min(opts?.from ?? 0, ids.length))
  const to = Math.max(from, Math.min(opts?.to ?? ids.length, ids.length))
  const origin = Math.max(0, from - 1)
  const span = to - origin
  const stepMs =
    opts?.stepMs ??
    Math.min(
      WALK_REVEAL_STEP_MS,
      // Sized on `span` — the same range totalMs measures. Sizing on to - from
      // overshot MAX_REVEAL_TOTAL_MS by exactly one step for a continue-in-place
      // reveal, where origin = from - 1.
      Math.max(MIN_STEP_MS, MAX_REVEAL_TOTAL_MS / Math.max(1, span)),
    )

  const nodeDelays = new Map<string, number>()
  for (let i = from; i < to; i++) {
    const id = ids[i]
    if (!nodeDelays.has(id)) nodeDelays.set(id, (i - origin) * stepMs)
  }
  // Edge i (node i → i+1) animates when i is in [origin, to-1]; the seam edge
  // (i = origin) draws first at delay 0, edges outside the window are null.
  const edgeDelays = ids
    .slice(1)
    .map((_, i) => (i >= origin && i <= to - 1 ? (i - origin) * stepMs : null))
  return { nodeDelays, edgeDelays, stepMs, totalMs: (to - origin) * stepMs, from, origin }
}

/**
 * Longest common prefix + suffix diff of the old vs new walk: the animated
 * node range is `[from, to)`. Handles both S2 force shapes — a single-arm
 * strict-prefix extension (suffix empty → tail animates) and a pinned-end
 * two-arm seam-fill (stable start-arm prefix AND end-arm suffix → only the
 * middle animates).
 */
export function revealRange(
  oldIds: readonly string[],
  newIds: readonly string[],
): { from: number; to: number } {
  const m = oldIds.length
  const n = newIds.length
  let p = 0
  while (p < m && p < n && oldIds[p] === newIds[p]) p++
  let s = 0
  while (s < m - p && s < n - p && oldIds[m - 1 - s] === newIds[n - 1 - s]) s++
  return { from: p, to: Math.max(p, n - s) }
}
