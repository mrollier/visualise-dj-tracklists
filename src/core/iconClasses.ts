import { genreComponents, genreFamilyOf, umbrellaFor } from './genre'
import type { Track } from './model'

/** How many distinct node shapes the wheel and the genre map use. */
export const MAX_ICON_CLASSES = 4

/**
 * Node shapes by curated genre family. `classOf` is keyed by normalized
 * primary genre label — resolve through classIndexOfTrack. Class 0 is always
 * the largest class (it keeps the circle).
 */
interface IconClassification {
  classOf: Map<string, number>
  /** Per class: a display label and its track count. */
  classes: { label: string; size: number }[]
}

/**
 * Fit families into at most `maxClasses` (floor 1) by merging the smallest
 * into their genre-tree umbrella rather than dropping them to circles. Each step collapses a cluster of families that share an umbrella
 * (reducing the count), or promotes the smallest lone family one level up
 * until such a cluster forms. Deterministic (size then label); terminates
 * because every family's lineage ends at the root. Returns the surviving
 * classes (size desc) and each original family's final label.
 */
function capFamilies(
  sizes: Map<string, number>,
  maxClasses: number,
): { classes: { label: string; size: number }[]; labelOf: Map<string, string> } {
  const cap = Math.max(1, maxClasses)
  const assign = new Map<string, string>([...sizes.keys()].map((family) => [family, family]))
  const totals = (): Map<string, number> => {
    const t = new Map<string, number>()
    for (const [family, size] of sizes) {
      const label = assign.get(family)!
      t.set(label, (t.get(label) ?? 0) + size)
    }
    return t
  }
  let groups = totals()
  for (let guard = 0; groups.size > cap && guard < 1000; guard++) {
    const byUmbrella = new Map<string, string[]>()
    for (const label of groups.keys()) {
      const umbrella = umbrellaFor(label)
      if (umbrella === null) continue
      if (!byUmbrella.has(umbrella)) byUmbrella.set(umbrella, [])
      byUmbrella.get(umbrella)!.push(label)
    }
    if (byUmbrella.size === 0) break // everything is at the root already
    const clusterSize = (labels: string[]): number =>
      labels.reduce((sum, label) => sum + groups.get(label)!, 0)
    const merges = [...byUmbrella.entries()].filter(([, labels]) => labels.length >= 2)
    let target: string
    let members: string[]
    if (merges.length > 0) {
      // Collapse the smallest shared-umbrella cluster first.
      merges.sort((a, b) => clusterSize(a[1]) - clusterSize(b[1]) || a[0].localeCompare(b[0]))
      ;[target, members] = merges[0]
    } else {
      // No shared umbrella yet: promote the smallest lone family up a level.
      const smallest = [...groups.entries()]
        .filter(([label]) => umbrellaFor(label) !== null)
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0]
      target = umbrellaFor(smallest[0])!
      members = [smallest[0]]
    }
    const merging = new Set(members)
    for (const [family, label] of assign) if (merging.has(label)) assign.set(family, target)
    groups = totals()
  }
  const classes = [...groups.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([label, size]) => ({ label, size }))
  const keep = new Set(classes.map((cls) => cls.label))
  const labelOf = new Map<string, string>()
  for (const family of sizes.keys()) {
    const label = assign.get(family)!
    if (keep.has(label)) labelOf.set(family, label)
  }
  return { classes, labelOf }
}

/**
 * Icons from the curated genre tree: each primary genre maps to its family
 * (genreFamilyOf) — deterministic and stable, unlike similarity clustering.
 * Labels without a family stay unclassed (circle); with fewer than two
 * families there is nothing to distinguish and the result is null.
 */
export function genreFamilyClasses(
  rawGenres: (string | null)[],
  maxClasses = MAX_ICON_CLASSES,
): IconClassification | null {
  const familyOfLabel = new Map<string, string | null>()
  const familySizes = new Map<string, number>()
  for (const raw of rawGenres) {
    if (raw === null) continue
    const primary = genreComponents(raw)[0]
    if (!familyOfLabel.has(primary)) familyOfLabel.set(primary, genreFamilyOf(primary))
    const family = familyOfLabel.get(primary)
    if (family === null || family === undefined) continue
    familySizes.set(family, (familySizes.get(family) ?? 0) + 1)
  }
  if (familySizes.size < 2) return null
  const { classes, labelOf } = capFamilies(familySizes, maxClasses)
  const indexOfFamily = new Map(classes.map((cls, index) => [cls.label, index]))
  const classOf = new Map<string, number>()
  for (const [label, family] of familyOfLabel) {
    if (family === null) continue
    const finalLabel = labelOf.get(family)
    const index = finalLabel === undefined ? undefined : indexOfFamily.get(finalLabel)
    if (index !== undefined) classOf.set(label, index)
  }
  return { classOf, classes }
}

/** A track's class index by its primary genre, null-safe. */
export function classIndexOfTrack(
  classification: IconClassification | null,
  track: Track,
): number | null {
  if (classification === null || track.genre === null) return null
  return classification.classOf.get(genreComponents(track.genre)[0]) ?? null
}
