import genreGraph from '../data/genre-graph.json'
import genreTree from '../data/genre-tree.json'
import embeddingPack from '../data/genre-embedding.json'

/**
 * Genre similarity (concept paper's "linking unidentical genres").
 *
 * All methods return a similarity in [0, 1]; the genre combo criterion passes
 * when similarity >= the configured threshold. Methods, roughly in order of
 * sophistication (see README for the literature background):
 * - exact:     normalized labels must be identical (v1 behaviour).
 * - lexical:   token overlap after normalization ("tech house" ~ "deep house").
 * - graph:     decay^(shortest path) over the curated genre-relation graph.
 * - embedding: cosine similarity between vectors from the bundled data pack.
 * Graph and embedding fall back to lexical when a label is unknown to them.
 */
export type GenreMethod = 'exact' | 'lexical' | 'graph' | 'taxonomy' | 'embedding'

export const GENRE_METHODS: readonly GenreMethod[] = [
  'exact',
  'lexical',
  'graph',
  'taxonomy',
  'embedding',
]

/** Decay per graph step: neighbours score 0.6, two steps 0.36, ... */
const GRAPH_DECAY = 0.6

const ALIASES: Record<string, string> = {
  dnb: 'drum & bass',
  'd & b': 'drum & bass',
  'drum n bass': 'drum & bass',
  'drum and bass': 'drum & bass',
  "drum'n'bass": 'drum & bass',
  'jungle music': 'jungle',
  rnb: 'r&b',
  'r & b': 'r&b',
  'r n b': 'r&b',
  'rhythm & blues': 'r&b',
  'rhythm and blues': 'r&b',
  'hip-hop': 'hip hop',
  hiphop: 'hip hop',
  'psy trance': 'psytrance',
  'psy-trance': 'psytrance',
  'drum&bass': 'drum & bass',
  'uk bass': 'bassline',
  'nu-disco': 'nu disco',
  'indie-dance': 'indie dance',
  'intelligent dance music': 'idm',
  'melodic house & techno': 'melodic house',
  'organic house / downtempo': 'organic house',
  'two step': '2 step',
  'two-step': '2 step',
}

export function normalizeGenre(label: string): string {
  let s = label
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
  s = s.replace(/\s*&\s*/g, ' & ').replace(/\s+and\s+/g, ' & ')
  s = s.replace(/\s+/g, ' ').trim()
  // Apply the alias table both before and after separator cleanup so entries
  // like "drum'n'bass" (apostrophes survive the cleanup) still resolve.
  return ALIASES[s] ?? s
}

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(/[\s&]+/).filter(Boolean))
}

function lexicalSimilarity(a: string, b: string): number {
  if (a === b) return 1
  const ta = tokens(a)
  const tb = tokens(b)
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared++
  const union = ta.size + tb.size - shared
  return union === 0 ? 0 : shared / union
}

// --- graph method -----------------------------------------------------------
const adjacency = new Map<string, string[]>()
for (const [a, b] of genreGraph.edges as [string, string][]) {
  if (!adjacency.has(a)) adjacency.set(a, [])
  if (!adjacency.has(b)) adjacency.set(b, [])
  adjacency.get(a)!.push(b)
  adjacency.get(b)!.push(a)
}

/** BFS shortest path between two known graph nodes; Infinity if disconnected. */
function graphDistance(a: string, b: string): number {
  if (a === b) return 0
  const visited = new Set([a])
  let frontier = [a]
  let depth = 0
  while (frontier.length > 0) {
    depth++
    const next: string[] = []
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (neighbour === b) return depth
        if (!visited.has(neighbour)) {
          visited.add(neighbour)
          next.push(neighbour)
        }
      }
    }
    frontier = next
  }
  return Infinity
}

// --- taxonomy method (Lin over the rooted genre DAG) --------------------------
// Lin (1998): sim = 2·IC(LCA) / (IC(a) + IC(b)), with intrinsic information
// content IC(n) = 1 − log(descendants(n)+1)/log(N) (Seco et al. 2004). Deep,
// specific common ancestors score high; umbrella nodes near the root have
// IC ≈ 0 and cannot produce strong matches.
const treeParents = genreTree.parents as Record<string, string[]>

const treeAncestors = new Map<string, Set<string>>() // label → ancestors incl. self

function ancestorsOf(label: string): Set<string> {
  const cached = treeAncestors.get(label)
  if (cached !== undefined) return cached
  const set = new Set([label])
  treeAncestors.set(label, set) // guards against accidental cycles
  for (const parent of treeParents[label] ?? []) {
    for (const ancestor of ancestorsOf(parent)) set.add(ancestor)
  }
  return set
}

const treeIC = new Map<string, number>()
{
  const nodes = new Set<string>([genreTree.root, ...Object.keys(treeParents)])
  const descendants = new Map<string, number>()
  for (const node of nodes) {
    for (const ancestor of ancestorsOf(node)) {
      if (ancestor !== node) descendants.set(ancestor, (descendants.get(ancestor) ?? 0) + 1)
    }
  }
  const logN = Math.log(nodes.size)
  for (const node of nodes) {
    treeIC.set(node, 1 - Math.log((descendants.get(node) ?? 0) + 1) / logN)
  }
}

function linSimilarity(a: string, b: string): number {
  const icA = treeIC.get(a)!
  const icB = treeIC.get(b)!
  if (icA + icB === 0) return 0
  let lcaIC = 0
  const ancestorsB = ancestorsOf(b)
  for (const ancestor of ancestorsOf(a)) {
    if (ancestorsB.has(ancestor)) lcaIC = Math.max(lcaIC, treeIC.get(ancestor)!)
  }
  return (2 * lcaIC) / (icA + icB)
}

// --- embedding method --------------------------------------------------------
// Pack v2 (see scripts/build-genre-embedding.mjs): per-label top-k neighbour
// lists with mutual-proximity scores in [0,1]. Pairs absent from both lists
// are genuinely dissimilar and score 0; umbrella labels arrive pre-damped.
type NeighbourLists = Record<string, [string, number][]>
const neighbourLists = embeddingPack.embedding as unknown as NeighbourLists

/** Umbrella tags ("electronic", …) that must never drive a genre match. */
export const UMBRELLA_GENRES: readonly string[] = embeddingPack.umbrella

// Space/&-collapsed spelling → canonical pack label ("eurodance" → the pack's
// own key), so "Euro Dance" and "Eurodance" resolve to the same entry.
const squashedToPackLabel = new Map<string, string>()
for (const label of Object.keys(neighbourLists)) {
  squashedToPackLabel.set(label.replace(/[\s&']+/g, ''), label)
}

/** Pack lookup: exact normalized label, else its space/&-collapsed spelling. */
function packLabel(label: string): string | undefined {
  if (label in neighbourLists) return label
  return squashedToPackLabel.get(label.replace(/[\s&']+/g, ''))
}

/** Score between two canonical pack labels; either side's list may hold it. */
function packSimilarity(a: string, b: string): number {
  const hit =
    neighbourLists[a]?.find(([label]) => label === b) ??
    neighbourLists[b]?.find(([label]) => label === a)
  return hit === undefined ? 0 : hit[1]
}

export function genreSimilarity(rawA: string, rawB: string, method: GenreMethod): number {
  const a = normalizeGenre(rawA)
  const b = normalizeGenre(rawB)
  if (a === b) return 1
  switch (method) {
    case 'exact':
      return 0
    case 'lexical':
      return lexicalSimilarity(a, b)
    case 'graph': {
      if (!adjacency.has(a) || !adjacency.has(b)) return lexicalSimilarity(a, b)
      const d = graphDistance(a, b)
      return d === Infinity ? 0 : GRAPH_DECAY ** d
    }
    case 'taxonomy': {
      if (!treeIC.has(a) || !treeIC.has(b)) return lexicalSimilarity(a, b)
      return linSimilarity(a, b)
    }
    case 'embedding': {
      const pa = packLabel(a)
      const pb = packLabel(b)
      if (pa === undefined || pb === undefined) return lexicalSimilarity(a, b)
      if (pa === pb) return 1
      return packSimilarity(pa, pb)
    }
  }
}
