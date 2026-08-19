/**
 * Mid-edge direction chevron (v21 #2) — shared by the two places that draw
 * the walk: lib/WheelView.svelte and core/exporters/portrait.ts. The
 * arrowhead it replaces sat at the target end, where the star paints over
 * it (layer 9 over layer 5); a midpoint marker has clear canvas.
 */
export const WALK_CHEVRON_VIEW_BOX = '0 0 10 10'
/** Open ›, drawn stroked and unfilled — lighter ink than a solid head. */
export const WALK_CHEVRON_D = 'M 3.6 2.4 L 6.6 5 L 3.6 7.6'
/** Marker viewport, in USER units — markerUnits="userSpaceOnUse", so the
 *  chevron's size is decoupled from the edge's stroke-width and a ghost's
 *  1px hairline does not silently halve it. Sole size knob. */
export const WALK_CHEVRON_SIZE = 9
/** refX/refY: the viewBox point pinned to the vertex — the chevron's centre. */
export const WALK_CHEVRON_REF = 5
/** Stroke width in viewBox units; × SIZE/10 gives ~1.5 user units, a shade
 *  thinner than the 2-unit edge it sits on. */
export const WALK_CHEVRON_STROKE = 1.7
/** Below this edge length (user units) the two stars (r=11) already overlap
 *  and a marker between them is clutter, not information. */
export const WALK_CHEVRON_MIN_EDGE = 16

/** The vertex to hang the chevron on, or null when the edge is too short to
 *  carry one (including a zero-length edge, where orientation is undefined). */
export function walkChevronMid(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  minLen: number = WALK_CHEVRON_MIN_EDGE,
): { x: number; y: number } | null {
  if (Math.hypot(bx - ax, by - ay) < minLen) return null
  return { x: (ax + bx) / 2, y: (ay + by) / 2 }
}
