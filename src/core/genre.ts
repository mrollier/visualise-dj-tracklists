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

// Keys are matched AFTER cleanupGenre, so a key only earns its place if
// cleanupGenre leaves it alone. Hyphenated, "and"-spelled and period-bearing
// spellings ("hip-hop", "drum and bass", "r & b") never reach the table —
// they arrive already rewritten, and the cleaned form's own entry answers
// them. Adding one is a silent no-op, not extra coverage.
const ALIASES: Record<string, string> = {
  dnb: 'drum & bass',
  'd & b': 'drum & bass',
  'drum n bass': 'drum & bass',
  "drum'n'bass": 'drum & bass',
  'jungle music': 'jungle',
  rnb: 'r&b',
  'r n b': 'r&b',
  'rhythm & blues': 'r&b',
  hiphop: 'hip hop',
  'psy trance': 'psytrance',
  'uk bass': 'bassline',
  'intelligent dance music': 'idm',
  'melodic house & techno': 'melodic house',
  // Lookups happen after separator cleanup, so "Organic House / Downtempo"
  // (a Beatport category, not two genres) arrives with its slash spaced out.
  'organic house downtempo': 'organic house',
  'two step': '2 step',
  // v12 WS5: a bare "Garage" in a club library means the UK lineage, not
  // garage rock — the pack knows uk garage / garage house, never "garage".
  garage: 'uk garage',
  // Discogs ships one compound umbrella label; keep it whole (the comma stays
  // through cleanup, so the key carries it) instead of shredding a stray
  // "& country" component off it.
  'folk, world, & country': 'folk',
  // v12 WS7 — mined from a real 2080-track library (tests/mine-genre-
  // aliases.dev.test.ts): personal descriptors, shorthand and foreign
  // spellings mapped to their nearest known genre. Non-genres ("Nieuw!!!",
  // "90s", site watermarks) are deliberately NOT mapped — the reject class is
  // silence, so garbage stays visibly uncovered instead of confidently wrong.
  'techno melancholic': 'melodic techno',
  'techno melodieus': 'melodic techno',
  'house ethno': 'organic house',
  'techno rave': 'hard techno',
  'techno half tempo': 'techno',
  minimal: 'minimal techno',
  'soul & funk': 'funk',
  ndw: 'new wave',
  'classic soul & r&b': 'soul',
  'electronic house': 'electro house',
  electronique: 'electronic',
  'footwork jungle': 'footwork',
  nederpop: 'pop',
  'rock alternative': 'alternative rock',
  'alternative indie pop pop': 'indie pop',
  'indie rock dance rock indie rock': 'indie rock',
  'funk thai': 'thai funk',
  // In a club crate "psychedelic" points at the psy lineage, not psych rock.
  psychedelic: 'psytrance',
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
  return Object.hasOwn(ALIASES, s) ? ALIASES[s] : s
}

/**
 * Multi-genre fields ("House / Techno", "Melodic House, Techno") split into
 * their component genres; similarity then takes the best component pair.
 * '&' never separates — "Drum & Bass" is one genre — and compound labels the
 * alias table knows ("Organic House / Downtempo") stay whole.
 */
export function genreComponents(raw: string): string[] {
  // En/em dashes separate too (v12 WS5) — hyphens never do ("hip-hop").
  if (/[/,;–—]/.test(raw) && !Object.hasOwn(ALIASES, cleanupGenre(raw))) {
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
  for (const parent of Object.hasOwn(treeParents, label) ? treeParents[label] : []) {
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
  if (!Object.hasOwn(treeParents, current) && !FAMILY_LEVEL.has(current)) return null
  const seen = new Set<string>()
  while (current !== undefined && current !== genreTree.root && !seen.has(current)) {
    if (FAMILY_LEVEL.has(current)) return current
    seen.add(current)
    current = Object.hasOwn(treeParents, current) ? treeParents[current][0] : undefined
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
  const parents = Object.hasOwn(treeParents, norm) ? treeParents[norm] : undefined
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

  // The pack is a plain JSON object, so a genre literally named "constructor"
  // or "toString" would otherwise resolve to an inherited function. Every read
  // of `lists` goes through here.
  private own(label: string): [string, number][] | undefined {
    return Object.hasOwn(this.lists, label) ? this.lists[label] : undefined
  }

  /** Canonical pack label: exact match, else the space-collapsed spelling. */
  label(label: string): string | undefined {
    if (Object.hasOwn(this.lists, label)) return label
    return this.squashed.get(label.replace(/[\s&']+/g, ''))
  }

  /** The stored neighbour list of a canonical label (best first). */
  neighbours(label: string): [string, number][] {
    return this.own(label) ?? []
  }

  /** Score between two canonical labels; either side's list may hold it. */
  score(a: string, b: string): number {
    const hit =
      this.own(a)?.find(([label]) => label === b) ?? this.own(b)?.find(([label]) => label === a)
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

// --- coverage diagnostics (v12 WS6 — science doc P1, productised) --------------
// How much of a library the similarity data actually reaches, mirroring the
// runtime resolution chain: normalize → aliases → components → pack squashed
// lookup / tree membership, best component per track (max aggregation).

interface GenreCoverage {
  total: number
  /** Tracks with no genre at all — harmless, but only audio analysis reaches them. */
  blank: number
  tagged: number
  /** Tagged tracks whose best component never reaches the pack or the tree. */
  outside: number
  /** The subset of `outside` with zero token overlap — genre-invisible. */
  invisible: number
  /** Every uncovered normalized label with its track count, descending —
   * consumers slice what they need (the ⓘ shows three; the alias miner all). */
  top: { label: string; count: number }[]
}

let vocabTokens: Set<string> | null = null
function knownVocabularyTokens(): Set<string> {
  if (vocabTokens === null) {
    vocabTokens = new Set<string>()
    for (const label of Object.keys(embeddingPack.hybrid)) {
      for (const token of tokens(label)) vocabTokens.add(token)
    }
    for (const label of treeIC.keys()) {
      for (const token of tokens(label)) vocabTokens.add(token)
    }
  }
  return vocabTokens
}

export function computeGenreCoverage(tracks: readonly { genre: string | null }[]): GenreCoverage {
  const vocab = knownVocabularyTokens()
  let blank = 0
  let outside = 0
  let invisible = 0
  const uncoveredCounts = new Map<string, number>()
  for (const track of tracks) {
    const raw = track.genre?.trim() ?? ''
    if (raw === '') {
      blank++
      continue
    }
    let bestRank = 0 // 0 = invisible, 1 = lexical overlap, 2 = pack/tree
    const uncoveredHere: string[] = []
    for (const component of genreComponents(raw)) {
      const covered = hybridSection.label(component) !== undefined || treeIC.has(component)
      if (covered) {
        bestRank = 2
        continue
      }
      uncoveredHere.push(component)
      const overlaps = [...tokens(component)].some((token) => vocab.has(token))
      bestRank = Math.max(bestRank, overlaps ? 1 : 0)
    }
    if (bestRank < 2) {
      outside++
      if (bestRank === 0) invisible++
      for (const label of new Set(uncoveredHere)) {
        uncoveredCounts.set(label, (uncoveredCounts.get(label) ?? 0) + 1)
      }
    }
  }
  const top = [...uncoveredCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return {
    total: tracks.length,
    blank,
    tagged: tracks.length - blank,
    outside,
    invisible,
    top,
  }
}
