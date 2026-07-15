import genreGraph from '../data/genre-graph.json'
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
export type GenreMethod = 'exact' | 'lexical' | 'graph' | 'embedding'

export const GENRE_METHODS: readonly GenreMethod[] = ['exact', 'lexical', 'graph', 'embedding']

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

// --- embedding method --------------------------------------------------------
const vectors = embeddingPack.vectors as Record<string, number[]>

/** Pack lookup: exact normalized label, else its space/&-collapsed spelling. */
function packVector(label: string): number[] | undefined {
  return vectors[label] ?? vectors[label.replace(/[\s&']+/g, '')]
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / Math.sqrt(na * nb)
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
    case 'embedding': {
      const va = packVector(a)
      const vb = packVector(b)
      if (va === undefined || vb === undefined) return lexicalSimilarity(a, b)
      return Math.max(0, Math.min(1, cosine(va, vb)))
    }
  }
}
