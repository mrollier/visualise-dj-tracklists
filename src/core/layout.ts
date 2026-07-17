/** A same-slot node for the angular relaxation: fixed radius, free angle. */
export interface SlotNode {
  id: string
  r: number
}

/**
 * The minimum angular separation (degrees) two nodes of the given world-unit
 * radius need to not overlap, given their fixed radii — the chord condition.
 * Radii more than a node diameter apart can never overlap: 0. Radii at or
 * inside the node radius can never be separated angularly: also 0 (give up
 * gracefully rather than demand the impossible).
 */
export function minAngularGapDeg(r1: number, r2: number, nodeRadius: number): number {
  const diameter = 2 * nodeRadius
  if (r1 <= nodeRadius || r2 <= nodeRadius) return 0
  if (Math.abs(r1 - r2) >= diameter) return 0
  const cos = (r1 * r1 + r2 * r2 - diameter * diameter) / (2 * r1 * r2)
  if (cos >= 1) return 0
  if (cos <= -1) return 180
  return (Math.acos(cos) * 180) / Math.PI
}

/**
 * Place same-slot nodes at angular offsets that minimise overlap (issue 17):
 * every node keeps its exact radius, offsets stay within ±halfSpreadDeg.
 * Deterministic by construction — nodes sort by radius (ties by id), start
 * evenly spread, then a fixed number of passes push actually-overlapping
 * pairs (per minAngularGapDeg) symmetrically apart, clamping to the window.
 * When a slot genuinely cannot fit its tracks, the pushes cancel into an
 * even squeeze; nothing special happens at saturation.
 */
export function relaxSlotAngles(
  nodes: readonly SlotNode[],
  halfSpreadDeg: number,
  nodeRadius: number,
  iterations = 60,
): Map<string, number> {
  const out = new Map<string, number>()
  if (nodes.length === 0) return out
  const order = [...nodes].sort((a, b) => b.r - a.r || a.id.localeCompare(b.id))
  const n = order.length
  if (n === 1 || halfSpreadDeg <= 0) {
    for (const { id } of order) out.set(id, 0)
    return out
  }
  const angles = order.map((_, i) => -halfSpreadDeg + (i * 2 * halfSpreadDeg) / (n - 1))
  interface Pair {
    i: number
    j: number
    gap: number
  }
  const pairs: Pair[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = minAngularGapDeg(order[i].r, order[j].r, nodeRadius)
      if (gap > 0) pairs.push({ i, j, gap })
    }
  }
  // Simultaneous (averaged) updates rather than sequential ones: each pass
  // gathers every violating pair's push and applies the mean per node. At
  // saturation the symmetric forces then cancel into an even squeeze instead
  // of piling nodes onto the window edges.
  const force = new Array<number>(n)
  const contributions = new Array<number>(n)
  for (let iter = 0; iter < iterations; iter++) {
    force.fill(0)
    contributions.fill(0)
    for (const { i, j, gap } of pairs) {
      const delta = angles[j] - angles[i]
      const distance = Math.abs(delta)
      if (distance >= gap) continue
      const push = (gap - distance) / 2
      const direction = delta === 0 ? 1 : Math.sign(delta)
      force[i] -= direction * push
      force[j] += direction * push
      contributions[i]++
      contributions[j]++
    }
    for (let k = 0; k < n; k++) {
      if (contributions[k] > 0) angles[k] += force[k] / contributions[k]
      angles[k] = Math.max(-halfSpreadDeg, Math.min(halfSpreadDeg, angles[k]))
    }
  }
  // Clamping can pile the outermost nodes onto the window edge. A final
  // sweep enforces each adjacent pair's required gap — capped at the uniform
  // share of the window, so the total span always fits — then shifts the
  // whole line back inside if the sweep overflowed.
  const sorted = angles.map((_, k) => k).sort((x, y) => angles[x] - angles[y] || x - y)
  const uniformShare = (2 * halfSpreadDeg) / (n - 1)
  for (let m = 1; m < n; m++) {
    const prev = sorted[m - 1]
    const cur = sorted[m]
    const gap = Math.min(minAngularGapDeg(order[prev].r, order[cur].r, nodeRadius), uniformShare)
    if (angles[cur] - angles[prev] < gap) angles[cur] = angles[prev] + gap
  }
  const first = angles[sorted[0]]
  const last = angles[sorted[n - 1]]
  if (last > halfSpreadDeg) {
    const span = last - first
    if (span > 2 * halfSpreadDeg) {
      // Larger-than-required gaps survived the sweep and pushed the span past
      // the window: compress linearly (order and relative spacing preserved).
      const scale = (2 * halfSpreadDeg) / span
      for (let k = 0; k < n; k++) angles[k] = -halfSpreadDeg + (angles[k] - first) * scale
    } else {
      for (let k = 0; k < n; k++) angles[k] -= last - halfSpreadDeg
    }
  }
  order.forEach(({ id }, k) => out.set(id, angles[k]))
  return out
}

/**
 * SVG path of an annular (ring) sector between radii r0..r1 spanning angles
 * a0..a1, in degrees clockwise from 12 o'clock — the wheel's convention.
 * Used for the subtle per-key major/minor sector backgrounds.
 */
export function annularSectorPath(
  cx: number,
  cy: number,
  a0: number,
  a1: number,
  r0: number,
  r1: number,
): string {
  const round = (v: number) => Math.round(v * 100) / 100
  const point = (angleDeg: number, r: number) => {
    const rad = ((angleDeg - 90) * Math.PI) / 180
    return [round(cx + r * Math.cos(rad)), round(cy + r * Math.sin(rad))]
  }
  const large = a1 - a0 > 180 ? 1 : 0
  const [ox0, oy0] = point(a0, r1)
  const [ox1, oy1] = point(a1, r1)
  const [ix1, iy1] = point(a1, r0)
  const [ix0, iy0] = point(a0, r0)
  return (
    `M ${ox0} ${oy0} ` +
    `A ${r1} ${r1} 0 ${large} 1 ${ox1} ${oy1} ` +
    `L ${ix1} ${iy1} ` +
    `A ${r0} ${r0} 0 ${large} 0 ${ix0} ${iy0} Z`
  )
}
