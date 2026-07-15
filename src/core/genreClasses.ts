import { genreComponents, labelSimilarity, type GenreMethod } from './genre'

/**
 * Genre classes for the wheel's node shapes (docs/designs/design-v4.md §E): the
 * library's genres, clustered in the *currently selected* similarity space,
 * so the shapes literally visualise the distance measure. Average-linkage
 * agglomerative clustering; two clusters merge while they are still similar
 * (≥ MERGE_SIM) or while there are more clusters than the user's maximum.
 * If everything collapses into one family there is nothing to distinguish —
 * the result is null and every node stays a circle.
 */
export interface GenreClassification {
  /** Normalized primary genre label → class index (0 = largest class). */
  classOf: Map<string, number>
  /** Per class: the label of its most common genre, and its track count. */
  classes: { label: string; size: number }[]
}

/** Clusters closer than this are not "clearly different" and keep merging. */
const MERGE_SIM = 0.25

export function computeGenreClasses(
  rawGenres: (string | null)[],
  method: GenreMethod,
  maxClasses: number,
): GenreClassification | null {
  // Track count per normalized primary genre (first component of the field).
  const counts = new Map<string, number>()
  for (const raw of rawGenres) {
    if (raw === null) continue
    const primary = genreComponents(raw)[0]
    counts.set(primary, (counts.get(primary) ?? 0) + 1)
  }
  const labels = [...counts.keys()].sort()
  if (labels.length < 2) return null

  const sim = labels.map((a) => labels.map((b) => labelSimilarity(a, b, method)))

  // Average-linkage agglomerative clustering over label indices.
  let clusters: number[][] = labels.map((_, i) => [i])
  const linkage = (x: number[], y: number[]): number => {
    let total = 0
    for (const i of x) for (const j of y) total += sim[i][j]
    return total / (x.length * y.length)
  }
  for (;;) {
    let best = -1
    let bestPair: [number, number] = [0, 0]
    for (let x = 0; x < clusters.length; x++) {
      for (let y = x + 1; y < clusters.length; y++) {
        const s = linkage(clusters[x], clusters[y])
        if (s > best) {
          best = s
          bestPair = [x, y]
        }
      }
    }
    if (clusters.length <= 1) break
    if (clusters.length <= maxClasses && best < MERGE_SIM) break
    const [x, y] = bestPair
    clusters[x] = [...clusters[x], ...clusters[y]].sort((a, b) => a - b)
    clusters = clusters.filter((_, i) => i !== y)
  }
  if (clusters.length <= 1) return null

  const clusterSize = (cluster: number[]) =>
    cluster.reduce((s, i) => s + (counts.get(labels[i]) ?? 0), 0)
  clusters.sort(
    (a, b) => clusterSize(b) - clusterSize(a) || labels[a[0]].localeCompare(labels[b[0]]),
  )

  const classOf = new Map<string, number>()
  const classes = clusters.map((cluster, index) => {
    for (const i of cluster) classOf.set(labels[i], index)
    const representative = [...cluster].sort(
      (a, b) => counts.get(labels[b])! - counts.get(labels[a])! || a - b,
    )[0]
    return { label: labels[representative], size: clusterSize(cluster) }
  })
  return { classOf, classes }
}
