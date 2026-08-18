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
 * Deterministic by construction — nodes sort by radius (ties by id).
 *
 * Only nodes that actually risk overlapping are moved (issue #6): the slot is
 * split into connected components of the overlap graph (two nodes are linked
 * when `minAngularGapDeg` > 0), and each component is relaxed on its own,
 * centred on the slot line. A node that overlaps nobody is a one-member
 * component pinned to 0 — a radially isolated track stays dead-centre in its
 * wedge no matter how many (non-overlapping) neighbours share the slot.
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

  // Union-find over the overlap graph: link every pair that genuinely needs a
  // gap. Components are then the groups that must be spread apart together.
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (minAngularGapDeg(order[i].r, order[j].r, nodeRadius) > 0) {
        parent[find(i)] = find(j)
      }
    }
  }
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    const group = groups.get(root)
    if (group) group.push(i)
    else groups.set(root, [i])
  }

  for (const indices of groups.values()) {
    if (indices.length === 1) {
      out.set(order[indices[0]].id, 0)
      continue
    }
    const members = indices.map((i) => order[i])
    const angles = relaxComponentAngles(members, halfSpreadDeg, nodeRadius, iterations)
    members.forEach((m, k) => out.set(m.id, angles[k]))
  }
  return out
}

/**
 * Relax a single overlap component (≥2 members, already sorted): start evenly
 * spread across the window, push actually-overlapping pairs symmetrically
 * apart over a fixed number of passes, then re-centre the cloud on 0. Returns
 * angles aligned with `members`. Components never collide across each other
 * (no cross-component overlap edge exists), so each may centre on 0 freely.
 */
function relaxComponentAngles(
  members: readonly SlotNode[],
  halfSpreadDeg: number,
  nodeRadius: number,
  iterations: number,
): number[] {
  const n = members.length
  const angles = members.map((_, i) => -halfSpreadDeg + (i * 2 * halfSpreadDeg) / (n - 1))
  interface Pair {
    i: number
    j: number
    gap: number
  }
  const pairs: Pair[] = []
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const gap = minAngularGapDeg(members[i].r, members[j].r, nodeRadius)
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
    const gap = Math.min(
      minAngularGapDeg(members[prev].r, members[cur].r, nodeRadius),
      uniformShare,
    )
    if (angles[cur] - angles[prev] < gap) angles[cur] = angles[prev] + gap
  }
  // Re-centre on the slot line (v10 issue 5): the one-directional sweep above
  // biases the cloud's centroid off 0, so a key's weight drifts off its angle.
  // Subtract the mean to pin the centroid to 0, then — if the span overflows
  // the window — scale about the origin, which keeps the centroid at 0 while
  // fitting the bounds (graceful saturation, order and spacing preserved).
  let sum = 0
  for (let k = 0; k < n; k++) sum += angles[k]
  const meanAngle = sum / n
  let maxAbs = 0
  for (let k = 0; k < n; k++) {
    angles[k] -= meanAngle
    maxAbs = Math.max(maxAbs, Math.abs(angles[k]))
  }
  if (maxAbs > halfSpreadDeg) {
    const scale = halfSpreadDeg / maxAbs
    for (let k = 0; k < n; k++) angles[k] *= scale
  }
  return angles
}

/** v14 W4: slider 0–2. Piecewise so 1 keeps today's exact look: 0→0°, 1→4°,
 * 2→ the ±7.5° wedge edge minus the node's angular radius (node EDGE kisses
 * the boundary; angular radius depends on radial distance r). */
export function spreadHalfDeg(factor: number, nodeRadius: number, r: number): number {
  const angular = (Math.asin(Math.min(1, nodeRadius / Math.max(r, nodeRadius))) * 180) / Math.PI
  const edge = Math.max(4, 7.5 - angular)
  return factor <= 1 ? 4 * factor : 4 + (factor - 1) * (edge - 4)
}

/**
 * Gutter x-slot per unkeyed track (v20 #3), keyed by id. Tracks band
 * together when their y falls in the same `bandHeight`-px bucket (rounded,
 * so a boundary sits exactly between two bands, never inside one), then fan
 * 14px apart within a band, centred on `gutterX` — the exact grouping
 * WheelView's gutter loop used to run per animation frame, straight off the
 * ANIMATED y. Read that way, band membership (and each member's index
 * within it) flips the instant a track's y crosses a boundary mid-glide,
 * so already-settled members jump sideways in `spacing`-px steps for no
 * reason visible in the data. The fix is entirely in the caller: this
 * function is unchanged maths, just fed the SETTLED target y instead
 * (WheelView's `gutterTargetXById`) — banding is now a function of where a
 * track is headed, not where it currently happens to be on screen, so the
 * grouping itself is stable through a glide and only the displayed x
 * (via `displacedScalar`) still eases smoothly toward it.
 *
 * `entries` are taken in the caller's given order — that order IS each
 * track's index within its band (and so its fan position), matching the
 * legacy per-frame code's `Array.push` order exactly for a like-for-like
 * settled result.
 */
export function gutterSlotX(
  entries: readonly { id: string; y: number }[],
  gutterX: number,
  bandHeight = 16,
  spacing = 14,
): Map<string, number> {
  const byBand = new Map<number, string[]>()
  for (const { id, y } of entries) {
    const band = Math.round(y / bandHeight)
    if (!byBand.has(band)) byBand.set(band, [])
    byBand.get(band)!.push(id)
  }
  const out = new Map<string, number>()
  for (const [, group] of byBand)
    group.forEach((id, i) => out.set(id, gutterX + (i - (group.length - 1) / 2) * spacing))
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

/**
 * SVG path of a semicircular arc along a ring's lower half, left point
 * (cx−r, cy) to right point (cx+r, cy), through the bottom. Sweep flag 0
 * (counter-clockwise) so text laid on it via <textPath> reads left-to-right
 * upright, rather than mirrored along the top of the circle. Used for the
 * hub retry label, which curves along the ring instead of sitting on a
 * straight baseline.
 */
export function lowerArcPath(cx: number, cy: number, r: number): string {
  const round = (v: number) => Math.round(v * 100) / 100
  const x0 = round(cx - r)
  const x1 = round(cx + r)
  const y = round(cy)
  const rr = round(r)
  return `M ${x0} ${y} A ${rr} ${rr} 0 0 0 ${x1} ${y}`
}
