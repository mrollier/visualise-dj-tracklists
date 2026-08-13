/**
 * Ghost stars (v18 #10 + #11): a walk (constellation) member the active
 * filters hide doesn't drop off the wheel — it renders as a dim, rim-pinned
 * placeholder instead (WheelView's full-library placement already positions
 * and clamps it for free). This is the pure half: which walk ids need a
 * ghost marker at all.
 */

/**
 * The walk ids currently hidden by the filters, deduped to their first
 * occurrence and kept in walk order — mirrors walkRevealPlan's nodeDelays
 * (a repeated visit lights one dot, once, the first time the walk reaches
 * it). Empty walk or an all-visible walk both collapse to `[]`.
 */
export function ghostWalkIds(walk: readonly string[], visibleIds: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const ghosts: string[] = []
  for (const id of walk) {
    if (visibleIds.has(id) || seen.has(id)) continue
    seen.add(id)
    ghosts.push(id)
  }
  return ghosts
}
