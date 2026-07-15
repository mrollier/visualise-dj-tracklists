// Builds src/data/genre-embedding.json for the 'embedding' (and, once
// retrofitted, 'hybrid') genre-similarity methods.
//
// Pipeline (docs/design-v4.md §A, following the genre-distance research
// report in docs/): label co-occurrence → PPMI → truncated SVD
// (W = U_d·Σ_d^0.5, Levy & Goldberg 2014) → cosine → Mutual Proximity
// (Schnitzer et al. 2012, hubness fix) → per-label top-k neighbour lists
// with umbrella labels damped.
//
// Modes:
//   node scripts/build-genre-embedding.mjs
//     Starter pack: symmetrized diffusion over the curated genre graph fed
//     through the same pipeline. Placeholder so everything works without
//     the AcousticBrainz download.
//
//   node scripts/build-genre-embedding.mjs --from-acousticbrainz <dir> [--dims N] [--sweep]
//     The real thing: MediaEval AcousticBrainz genre dataset ground-truth
//     TSVs (header line; recordingmbid, releasegroupmbid, then labels,
//     subgenres as "genre---subgenre"). Download the discogs, lastfm and
//     tagtraum train TSVs from https://zenodo.org/records/2553414
//     (CC BY-NC-SA 4.0) and bunzip2 them into <dir>. --sweep scores
//     d ∈ {16,24,32,48,64} on the built-in triplet eval and exits.
import { createReadStream, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import {
  blendScores,
  cosineMatrix,
  embedRows,
  mutualProximity,
  ppmiMatrix,
  topNeighbours,
  tripletAccuracy,
} from './genre-pack-lib.mjs'

const OUT = 'src/data/genre-embedding.json'
const DEFAULT_DIMS = 32
const TOP_K = 20

// Frequent umbrella tags whose co-occurrence with everything would otherwise
// make them universal neighbours (hubness): damped ×0.5 at build time and
// excluded as ranking candidates at runtime.
const UMBRELLA = ['electronic', 'electronica', 'dance', 'pop', 'rock', 'music']

// Hand-authored (anchor, near, far) triplets for the --sweep dimension pick.
// Electronic-heavy, mirroring the app's audience; labels must be canonical.
const TRIPLETS = [
  ['techno', 'tech house', 'jazz'],
  ['techno', 'minimal techno', 'folk'],
  ['techno', 'detroit techno', 'country'],
  ['techno', 'hard techno', 'soul'],
  ['house', 'deep house', 'heavy metal'],
  ['house', 'tech house', 'punk'],
  ['house', 'garage house', 'black metal'],
  ['deep house', 'tech house', 'gabber'],
  ['deep house', 'soulful house', 'thrash metal'],
  ['progressive house', 'progressive trance', 'ska'],
  ['trance', 'progressive trance', 'punk'],
  ['trance', 'psytrance', 'blues'],
  ['psytrance', 'goa trance', 'blues'],
  ['drum & bass', 'jungle', 'country'],
  ['drum & bass', 'breakbeat', 'flamenco'],
  ['dubstep', 'drum & bass', 'disco'],
  ['dubstep', 'grime', 'classical'],
  ['breakbeat', 'big beat', 'opera'],
  ['idm', 'ambient', 'salsa'],
  ['ambient', 'downtempo', 'hardcore'],
  ['downtempo', 'trip hop', 'power metal'],
  ['trip hop', 'hip hop', 'hardstyle'],
  ['hip hop', 'r&b', 'techno'],
  ['r&b', 'soul', 'gabber'],
  ['soul', 'funk', 'noise'],
  ['funk', 'disco', 'death metal'],
  ['disco', 'italo disco', 'grindcore'],
  ['disco', 'house', 'doom metal'],
  ['electro', 'techno', 'folk'],
  ['electro', 'electro house', 'reggae'],
  ['hardcore', 'gabber', 'smooth jazz'],
  ['hardstyle', 'hardcore', 'soul'],
  ['garage house', 'deep house', 'grunge'],
  ['uk garage', '2 step', 'symphonic metal'],
  ['jungle', 'ragga', 'baroque'],
  ['acid house', 'acid techno', 'gospel'],
  ['chicago house', 'house', 'emo'],
  ['synthpop', 'new wave', 'drum & bass'],
  ['new wave', 'post punk', 'psytrance'],
  ['reggae', 'dub', 'eurodance'],
]

/** Full v2 pipeline from a symmetric association matrix to neighbour lists. */
function neighbourLists(labels, matrix, dims) {
  const cos = cosineMatrix(embedRows(matrix, dims))
  const scores = blendScores(mutualProximity(cos), cos)
  return topNeighbours(labels, scores, TOP_K, UMBRELLA)
}

function packSimilarity(lists) {
  return (a, b) => {
    const hit = lists[a]?.find(([label]) => label === b) ?? lists[b]?.find(([label]) => label === a)
    return hit ? hit[1] : 0
  }
}

function writePack(source, labels, lists, dims) {
  const embedding = {}
  for (const label of labels) {
    embedding[label] = lists[label].map(([other, score]) => [other, Number(score.toFixed(3))])
  }
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        _readme:
          `Genre neighbour pack (source: ${source}). Per-label top-${TOP_K} neighbours with ` +
          `mutual-proximity similarity scores in [0,1] (PPMI → truncated SVD d=${dims} → ` +
          `cosine → Mutual Proximity; umbrella labels damped ×0.5). Pairs absent from both ` +
          `lists score 0. Regenerate with scripts/build-genre-embedding.mjs.`,
        source,
        dims,
        k: TOP_K,
        umbrella: UMBRELLA,
        embedding,
      },
      null,
      1,
    ) + '\n',
  )
  console.log(`Wrote ${OUT}: ${labels.length} genres, top-${TOP_K} lists (d=${dims}, ${source})`)
}

// Mirror of src/core/genre.ts normalizeGenre's separator cleanup, so pack
// keys line up with what the app looks up at runtime.
function cleanLabel(raw) {
  let s = raw
    .trim()
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
  s = s.replace(/\s*&\s*/g, ' & ').replace(/\s+and\s+/g, ' & ')
  return s.replace(/\s+/g, ' ').trim()
}

// Source-specific spellings mapped to the app's canonical genre names.
const SPELLINGS = {
  'drum n bass': 'drum & bass',
  drumnbass: 'drum & bass',
  "drum'n'bass": 'drum & bass',
  rnb: 'r&b',
  'rhythm & blues': 'r&b',
  hiphop: 'hip hop',
  raphiphop: 'hip hop',
  'psy trance': 'psytrance',
  minimal: 'minimal techno', // the dataset's "minimal" is club minimal
}

function buildFromGraph(dims) {
  const graph = JSON.parse(readFileSync('src/data/genre-graph.json', 'utf-8'))
  const genres = [...new Set(graph.edges.flat())].sort()
  const index = new Map(genres.map((g, i) => [g, i]))
  const n = genres.length

  const adj = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const [a, b] of graph.edges) {
    adj[index.get(a)][index.get(b)] = 1
    adj[index.get(b)][index.get(a)] = 1
  }
  const degree = adj.map((row) => row.reduce((s, v) => s + v, 0))

  // M = (I + D^-1 A) / 2; rows of M^3 as diffusion features, symmetrized so
  // the SVD pipeline gets the symmetric association matrix it expects.
  const step = (rows) =>
    rows.map((row) => {
      const next = new Array(n).fill(0)
      for (let j = 0; j < n; j++) {
        if (row[j] === 0) continue
        next[j] += row[j] / 2
        for (let k = 0; k < n; k++) {
          if (adj[j][k] === 1) next[k] += row[j] / (2 * degree[j])
        }
      }
      return next
    })
  let rows = Array.from({ length: n }, (_, i) => {
    const row = new Array(n).fill(0)
    row[i] = 1
    return row
  })
  for (let t = 0; t < 3; t++) rows = step(rows)
  const sym = rows.map((row, i) => row.map((v, j) => (v + rows[j][i]) / 2))

  const lists = neighbourLists(genres, sym, dims)
  writePack('curated-graph-diffusion (starter pack)', genres, lists, dims)
}

async function readAcousticBrainz(dir) {
  // Count label co-occurrences per recording across all TSVs in `dir`.
  // Cells are "genre" or "genre---subgenre"; both levels count as labels.
  const cooc = new Map() // "a\tb" -> count (a < b)
  const counts = new Map() // label -> count
  let recordings = 0
  const files = readdirSync(dir).filter((f) => f.endsWith('.tsv'))
  if (files.length === 0) throw new Error(`No .tsv files in ${dir}`)
  for (const file of files) {
    const lines = createInterface({
      input: createReadStream(join(dir, file)),
      crlfDelay: Infinity,
    })
    for await (const line of lines) {
      const cells = line.split('\t')
      if (cells[0] === 'recordingmbid') continue // header
      const labels = new Set()
      for (const cell of cells.slice(2)) {
        for (const part of cell.split('---')) {
          const label = cleanLabel(part)
          if (label !== '') labels.add(SPELLINGS[label] ?? label)
        }
      }
      if (labels.size === 0) continue
      recordings++
      const sorted = [...labels].sort()
      for (const l of sorted) counts.set(l, (counts.get(l) ?? 0) + 1)
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = `${sorted[i]}\t${sorted[j]}`
          cooc.set(key, (cooc.get(key) ?? 0) + 1)
        }
      }
    }
    console.log(`read ${file}`)
  }

  // The sources spell the same genre differently ("deep house" vs
  // "deephouse"): merge every label into its spaced variant when one exists.
  const bySquashed = new Map()
  for (const label of counts.keys()) {
    const squashed = label.replace(/[\s&']+/g, '')
    if (!bySquashed.has(squashed)) bySquashed.set(squashed, [])
    bySquashed.get(squashed).push(label)
  }
  const canonical = new Map()
  for (const variants of bySquashed.values()) {
    const target =
      variants.find((v) => v.includes(' ') || v.includes('&')) ??
      variants.sort((a, b) => counts.get(b) - counts.get(a))[0]
    for (const v of variants) canonical.set(v, target)
  }
  const mergedCounts = new Map()
  for (const [label, count] of counts) {
    const c = canonical.get(label)
    mergedCounts.set(c, (mergedCounts.get(c) ?? 0) + count)
  }
  const mergedCooc = new Map()
  for (const [key, count] of cooc) {
    const [a, b] = key.split('\t').map((l) => canonical.get(l))
    if (a === b) continue
    const merged = [a, b].sort().join('\t')
    mergedCooc.set(merged, (mergedCooc.get(merged) ?? 0) + count)
  }

  // Vocabulary: the most frequent labels overall — plus every curated-graph
  // label with enough data. The dataset spans all of music, so a plain
  // top-400 squeezes out exactly the club genres this app is about.
  const curated = new Set(
    JSON.parse(readFileSync('src/data/genre-graph.json', 'utf-8')).edges.flat(),
  )
  const genres = [
    ...new Set([
      ...[...mergedCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 400)
        .map(([g]) => g),
      ...[...mergedCounts.entries()]
        .filter(([g, count]) => curated.has(g) && count >= 30)
        .map(([g]) => g),
    ]),
  ].sort()
  // Rare co-tag pairs (a handful of recordings out of ~2M) produce spurious
  // PMI spikes; a minimum pair count keeps the matrix to real associations.
  const ppmi = ppmiMatrix(genres, mergedCounts, mergedCooc, recordings, { minCount: 10 })
  return { genres, ppmi, recordings }
}

async function buildFromAcousticBrainz(dir, dims, sweep) {
  const { genres, ppmi, recordings } = await readAcousticBrainz(dir)
  const known = new Set(genres)
  const triplets = TRIPLETS.filter((t) => t.every((label) => known.has(label)))

  if (sweep) {
    console.log(`sweep over ${triplets.length}/${TRIPLETS.length} usable triplets:`)
    for (const d of [16, 24, 32, 48, 64]) {
      const lists = neighbourLists(genres, ppmi, d)
      const acc = tripletAccuracy(packSimilarity(lists), triplets)
      console.log(`  d=${String(d).padStart(2)}  triplet accuracy ${(acc * 100).toFixed(1)}%`)
    }
    return
  }

  const lists = neighbourLists(genres, ppmi, dims)
  const acc = tripletAccuracy(packSimilarity(lists), triplets)
  console.log(
    `triplet accuracy at d=${dims}: ${(acc * 100).toFixed(1)}% (${triplets.length} triplets)`,
  )
  writePack(
    `acousticbrainz-ppmi-svd-mp (${recordings} recordings; MediaEval AcousticBrainz Genre Dataset, CC BY-NC-SA 4.0)`,
    genres,
    lists,
    dims,
  )
}

const args = process.argv.slice(2)
const dimsArg = args.indexOf('--dims')
const dims = dimsArg !== -1 ? Number(args[dimsArg + 1]) : DEFAULT_DIMS
if (args[0] === '--from-acousticbrainz') {
  if (!args[1]) throw new Error('Usage: --from-acousticbrainz <dir with .tsv files>')
  await buildFromAcousticBrainz(args[1], dims, args.includes('--sweep'))
} else {
  buildFromGraph(dims)
}
