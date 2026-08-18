/**
 * The "displaced scalar" mechanism (v20 #2): a per-node value — the wheel
 * slot ANGLE today, the gutter x arriving in v20 #3 — that used to be read
 * straight off its live target map every frame. Correct once settled, but a
 * hard SNAP the instant the target map itself changes: an axis swap, a
 * radial range-filter edit, a playlist switch, easy-mode, the spread slider.
 * Unlike the node RADIUS, which already glides (morphTween/domainTween),
 * these values landed in a single frame with no animation channel of their
 * own — this module is that channel's pure planning half.
 *
 * `captureDisplaced` freezes each node's currently DISPLAYED value the
 * instant a new target map is about to replace the old one — not the stale
 * old target, the actual on-screen position, mid-lerp or already settled —
 * so the caller can glide FROM there TO the new target instead of jumping
 * straight to it. `numericMapsEqual` guards against restarting that glide
 * for a target map that was rebuilt (fresh Map instance) but landed on
 * identical values.
 *
 * Two clocks feed the progress a captured value glides on, both owned by
 * WheelView.svelte, not this module: during an axis swap, the SAME per-node
 * `radialMorphProgress(morphTween.current, morphDelays.get(id) ?? 0)` the
 * radius itself rides, so angle and radius arrive together, node by node, in
 * the same clockwise sweep (gutter ids get delay 0 via `angleDeg: null`, see
 * radialMorph.ts); everywhere else — a filter edit, a spread-factor change,
 * a playlist swap, none of which touch the axis — a plain uniform 0..1
 * `displacedTween` (`motionMs(RADIAL_TWEEN_MS)`, cubicOut). Displayed value
 * per frame is then `from(id) === undefined ? target(id) : lerp(from(id),
 * target(id), progress(id))`, with `target` always read LIVE off the
 * current map — a retarget mid-flight (two swaps back to back, a filter
 * edit landing mid-morph) is just another capture against whatever's on
 * screen that instant, no special-casing needed.
 */

/**
 * Capture each node's currently-displayed scalar at the moment its target
 * map is about to be replaced by a new one: the OLD target directly once
 * settled (`oldFrom` null, or the id missing from it — this node never
 * glided, or its last glide already landed), otherwise the OLD lerp frozen
 * at each node's own current progress (`progressOf`) — the exact on-screen
 * position, not the value it would eventually have reached at rest. Ids
 * absent from `oldTargets` are dropped: a capture never invents an entry for
 * a node its own previous target map never covered.
 */
export function captureDisplaced(
  oldTargets: ReadonlyMap<string, number>,
  oldFrom: ReadonlyMap<string, number> | null,
  progressOf: (id: string) => number,
): Map<string, number> {
  const captured = new Map<string, number>()
  for (const [id, target] of oldTargets) {
    const from = oldFrom?.get(id)
    captured.set(id, from === undefined ? target : from + (target - from) * progressOf(id))
  }
  return captured
}

/**
 * Value equality for numeric id maps, independent of insertion order — lets
 * the caller skip a no-op capture when a target map is rebuilt (a fresh Map
 * instance, so `===` alone would miss it) but lands on identical values.
 * `slotAngleById` is a `$derived.by` that reruns — and reallocates — on any
 * of several inputs changing, including ones with nothing to do with the
 * angles themselves (e.g. an unrelated `$effectiveSettings` field firing);
 * without this check, every such emission would look like a genuine angle
 * change and restart an in-flight glide's clock for nothing.
 */
export function numericMapsEqual(
  a: ReadonlyMap<string, number>,
  b: ReadonlyMap<string, number>,
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [id, v] of a) if (b.get(id) !== v) return false
  return true
}
