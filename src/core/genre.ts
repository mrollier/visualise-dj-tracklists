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
export type GenreMethod = 'exact' | 'lexical' | 'graph' | 'taxonomy' | 'embedding' | 'hybrid'

export const GENRE_METHODS: readonly GenreMethod[] = [
  'exact',
  'lexical',
  'graph',
  'taxonomy',
  'embedding',
  'hybrid',
]

/**
 * Dropdown order for method pickers: the recommended hybrid first, then by
 * decreasing sophistication. GENRE_METHODS keeps the simple→rich order the
 * genre map's chips and colours are keyed on.
 */
export const METHOD_PICK_ORDER: readonly GenreMethod[] = [
  'hybrid',
  'embedding',
  'taxonomy',
  'graph',
  'lexical',
  'exact',
]

/** Short UI labels for the criteria panel (the advanced menu holds the detail). */
export const METHOD_LABEL: Record<GenreMethod, string> = {
  exact: 'Exact match',
  lexical: 'Lexical',
  graph: 'Genre graph',
  taxonomy: 'Taxonomy',
  embedding: 'Embedding',
  hybrid: 'Hybrid',
}

/** Long labels with the parenthetical explainer, for the advanced menu. */
export const METHOD_LABEL_LONG: Record<GenreMethod, string> = {
  exact: 'Exact match',
  lexical: 'Lexical (word overlap)',
  graph: 'Genre graph (curated relations)',
  taxonomy: 'Taxonomy (Lin, rooted tree)',
  embedding: 'Embedding (co-occurrence pack)',
  hybrid: 'Hybrid (embedding + tree)',
}

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
  // Lookups happen after separator cleanup, so "Organic House / Downtempo"
  // (a Beatport category, not two genres) arrives with its slash spaced out.
  'organic house downtempo': 'organic house',
  'two step': '2 step',
  'two-step': '2 step',
  // v12 WS5: a bare "Garage" in a club library means the UK lineage, not
  // garage rock — the pack knows uk garage / garage house, never "garage".
  garage: 'uk garage',
  // Discogs ships one compound umbrella label; keep it whole (the comma stays
  // through cleanup, so the key carries it) instead of shredding a stray
  // "& country" component off it.
  'folk, world, & country': 'folk',
}

function cleanupGenre(label: string): string {
  let s = label
    .trim()
    .toLowerCase()
    // v12 WS5 (science doc §6.4): periods vanish ("U.K. Garage" → uk garage)
    // and en/em dashes separate like hyphens ("Pop – Synthpop").
    .replace(/\./g, '')
    .replace(/[-_/–—]+/g, ' ')
  s = s.replace(/\s*&\s*/g, ' & ').replace(/\s+and\s+/g, ' & ')
  // Known &-units survive inside longer labels: the and→& rewrite above must
  // not shred "Classic Soul And R&B" into `… r & b` past the alias table.
  s = s.replace(/\br & b\b/g, 'r&b')
  return s.replace(/\s+/g, ' ').trim()
}

export function normalizeGenre(label: string): string {
  // Apply the alias table after separator cleanup so entries like
  // "drum'n'bass" (apostrophes survive the cleanup) still resolve.
  const s = cleanupGenre(label)
  return ALIASES[s] ?? s
}

/**
 * Multi-genre fields ("House / Techno", "Melodic House, Techno") split into
 * their component genres; similarity then takes the best component pair.
 * '&' never separates — "Drum & Bass" is one genre — and compound labels the
 * alias table knows ("Organic House / Downtempo") stay whole.
 */
export function genreComponents(raw: string): string[] {
  // En/em dashes separate too (v12 WS5) — hyphens never do ("hip-hop").
  if (/[/,;–—]/.test(raw) && ALIASES[cleanupGenre(raw)] === undefined) {
    const parts = [
      ...new Set(
        raw
          .split(/[/,;–—]/)
          .map(normalizeGenre)
          .filter((s) => s !== ''),
      ),
    ]
    if (parts.length > 1) return parts
  }
  return [normalizeGenre(raw)]
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

// --- genre families (v8 issues 4+5) --------------------------------------------
// The icon-friendly level of the taxonomy: the root's children are too coarse
// for a club library ("electronic" would swallow everything), so 'electronic'
// is replaced by ITS children — house, techno, trance, breakbeat, … — while
// jazz, r&b, reggae and the other root children stand for themselves.
const FAMILY_LEVEL = new Set<string>()
{
  const childrenOf = (node: string): string[] =>
    Object.entries(treeParents)
      .filter(([, parents]) => parents.includes(node))
      .map(([label]) => label)
  for (const child of childrenOf(genreTree.root)) {
    if (child === 'electronic') for (const sub of childrenOf(child)) FAMILY_LEVEL.add(sub)
    else FAMILY_LEVEL.add(child)
  }
}

/**
 * The genre family a label belongs to: the first family-level node on its
 * primary lineage (each node's FIRST parent — the curated main ancestry).
 * Null for labels the tree does not know, and for umbrellas at or above the
 * family level ("electronic", "music").
 */
export function genreFamilyOf(rawLabel: string): string | null {
  let current: string | undefined = normalizeGenre(rawLabel)
  if (!(current in treeParents) && !FAMILY_LEVEL.has(current)) return null
  const seen = new Set<string>()
  while (current !== undefined && current !== genreTree.root && !seen.has(current)) {
    if (FAMILY_LEVEL.has(current)) return current
    seen.add(current)
    current = treeParents[current]?.[0]
  }
  return null
}

/**
 * The umbrella one level up from a family: its broadest direct parent in the
 * curated tree (lowest information content — nearest the root). house/techno
 * → 'electronic'; a root child like 'jazz' → the root 'music'. Null for the
 * root itself and for labels the tree does not know. Used to collapse families
 * into fewer classes when the symbol cap is tight (v10 issue 10).
 */
export function umbrellaFor(label: string): string | null {
  const norm = normalizeGenre(label)
  if (norm === genreTree.root) return null
  const parents = treeParents[norm]
  if (parents === undefined || parents.length === 0) return null
  let best: string | null = null
  let bestIC = Infinity
  for (const parent of parents) {
    const ic = treeIC.get(parent) ?? 1
    if (ic < bestIC || (ic === bestIC && (best === null || parent.localeCompare(best) < 0))) {
      bestIC = ic
      best = parent
    }
  }
  return best
}

// --- embedding & hybrid methods -----------------------------------------------
// Pack v2 (see scripts/build-genre-embedding.mjs): per-label top-k neighbour
// lists with mutual-proximity scores in [0,1]. Pairs absent from both lists
// are genuinely dissimilar and score 0; umbrella labels arrive pre-damped.
// 'hybrid' is the same embedding retrofitted toward the curated genre tree.
type NeighbourLists = Record<string, [string, number][]>

/** Umbrella tags ("electronic", …) that must never drive a genre match. */
export const UMBRELLA_GENRES: readonly string[] = embeddingPack.umbrella

class PackSection {
  private lists: NeighbourLists
  // Space/&-collapsed spelling → canonical pack label ("eurodance" → the
  // pack's own key), so "Euro Dance" and "Eurodance" hit the same entry.
  private squashed = new Map<string, string>()

  constructor(lists: NeighbourLists) {
    this.lists = lists
    for (const label of Object.keys(lists)) {
      this.squashed.set(label.replace(/[\s&']+/g, ''), label)
    }
  }

  /** Canonical pack label: exact match, else the space-collapsed spelling. */
  label(label: string): string | undefined {
    if (label in this.lists) return label
    return this.squashed.get(label.replace(/[\s&']+/g, ''))
  }

  /** The stored neighbour list of a canonical label (best first). */
  neighbours(label: string): [string, number][] {
    return this.lists[label] ?? []
  }

  /** Score between two canonical labels; either side's list may hold it. */
  score(a: string, b: string): number {
    const hit =
      this.lists[a]?.find(([label]) => label === b) ?? this.lists[b]?.find(([label]) => label === a)
    return hit === undefined ? 0 : hit[1]
  }

  similarity(a: string, b: string): number {
    const pa = this.label(a)
    const pb = this.label(b)
    if (pa === undefined || pb === undefined) return lexicalSimilarity(a, b)
    if (pa === pb) return 1
    return this.score(pa, pb)
  }
}

const embeddingSection = new PackSection(embeddingPack.embedding as unknown as NeighbourLists)
const hybridSection = new PackSection(embeddingPack.hybrid as unknown as NeighbourLists)

/**
 * A genre's nearest pack neighbours (hybrid section) — used by the genre map
 * to suggest nearby genres you don't own. Umbrella tags are skipped.
 */
export function packNeighbours(rawLabel: string, limit: number): [string, number][] {
  const canonical = hybridSection.label(normalizeGenre(rawLabel))
  if (canonical === undefined) return []
  const umbrella = new Set(UMBRELLA_GENRES)
  return hybridSection
    .neighbours(canonical)
    .filter(([label]) => !umbrella.has(label))
    .slice(0, limit)
}

/** Similarity between two already-normalized single genre labels. */
export function labelSimilarity(a: string, b: string, method: GenreMethod): number {
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
    case 'embedding':
      return embeddingSection.similarity(a, b)
    case 'hybrid':
      return hybridSection.similarity(a, b)
  }
}

export function genreSimilarity(rawA: string, rawB: string, method: GenreMethod): number {
  let best = 0
  for (const a of genreComponents(rawA)) {
    for (const b of genreComponents(rawB)) {
      best = Math.max(best, labelSimilarity(a, b, method))
      if (best === 1) return 1
    }
  }
  return best
}
