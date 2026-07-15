// Build-time math for the genre embedding pack (see docs/design-v4.md §A).
// Pure functions, no I/O — unit-tested in tests/genre-pack.test.ts.

/**
 * Eigendecomposition of a symmetric matrix via cyclic Jacobi rotations.
 * Fine for our sizes (≤ ~700×700). Returns { values, vectors } with
 * vectors[i][k] = component i of eigenvector k.
 */
export function jacobiEigen(matrix, maxSweeps = 60, eps = 1e-12) {
  const n = matrix.length
  const a = matrix.map((row) => row.slice())
  const v = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  )
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q]
    if (off < eps) break
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q])
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const c = 1 / Math.sqrt(t * t + 1)
        const s = t * c
        for (let i = 0; i < n; i++) {
          const aip = a[i][p]
          const aiq = a[i][q]
          a[i][p] = c * aip - s * aiq
          a[i][q] = s * aip + c * aiq
        }
        for (let i = 0; i < n; i++) {
          const api = a[p][i]
          const aqi = a[q][i]
          a[p][i] = c * api - s * aqi
          a[q][i] = s * api + c * aqi
        }
        for (let i = 0; i < n; i++) {
          const vip = v[i][p]
          const viq = v[i][q]
          v[i][p] = c * vip - s * viq
          v[i][q] = s * vip + c * viq
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors: v }
}

/**
 * Truncated SVD embedding of a symmetric matrix (Levy & Goldberg 2014:
 * W = U_d·Σ_d^0.5). Negative eigenvalues are discarded — PPMI matrices are
 * symmetric but not PSD, and only the positive spectrum is usable.
 */
export function embedRows(matrix, dims, { normalize = true } = {}) {
  const n = matrix.length
  const { values, vectors } = jacobiEigen(matrix)
  const order = values
    .map((value, i) => [value, i])
    .filter(([value]) => value > 1e-12)
    .sort((a, b) => b[0] - a[0])
    .slice(0, dims)
  const rows = Array.from({ length: n }, (_, i) =>
    order.map(([value, k]) => vectors[i][k] * Math.sqrt(value)),
  )
  if (!normalize) return rows
  return rows.map((row) => {
    const norm = Math.sqrt(row.reduce((s, x) => s + x * x, 0))
    return norm === 0 ? row : row.map((x) => x / norm)
  })
}

/**
 * Symmetric PPMI matrix from label counts and pair co-occurrence counts.
 * `minCount` drops pairs seen fewer times — rare pairs produce spurious PMI
 * spikes (a label tagged 30 times that co-occurs twice with "house" looks
 * deceptively related), the classic PMI bias toward rare events.
 */
export function ppmiMatrix(labels, counts, cooc, total, { minCount = 0 } = {}) {
  const index = new Map(labels.map((label, i) => [label, i]))
  const n = labels.length
  const m = Array.from({ length: n }, () => new Array(n).fill(0))
  for (const [key, count] of cooc) {
    if (count < minCount) continue
    const [a, b] = key.split('\t')
    if (!index.has(a) || !index.has(b)) continue
    const pmi = Math.log((count * total) / (counts.get(a) * counts.get(b)))
    if (pmi > 0) {
      m[index.get(a)][index.get(b)] = pmi
      m[index.get(b)][index.get(a)] = pmi
    }
  }
  return m
}

/**
 * Final pack score: mutual proximity × clamped cosine. MP alone saturates
 * near 1 for everything inside a tight cluster (it is a probability), which
 * destroys ranking resolution; cosine alone keeps hubs. The product keeps
 * MP's hub demotion and cosine's discrimination.
 */
export function blendScores(mp, cosine) {
  return mp.map((row, i) => row.map((p, j) => (i === j ? 1 : Math.max(0, cosine[i][j]) * p)))
}

/** Pairwise cosine similarity between rows. */
export function cosineMatrix(rows) {
  const n = rows.length
  const norms = rows.map((row) => Math.sqrt(row.reduce((s, x) => s + x * x, 0)))
  const sim = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    sim[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      if (norms[i] === 0 || norms[j] === 0) continue
      let dot = 0
      for (let d = 0; d < rows[i].length; d++) dot += rows[i][d] * rows[j][d]
      sim[i][j] = sim[j][i] = dot / (norms[i] * norms[j])
    }
  }
  return sim
}

function normalSurvival(x, mean, std) {
  if (std < 1e-12) return x < mean ? 1 : 0
  const z = (x - mean) / (std * Math.SQRT2)
  // Abramowitz & Stegun 7.1.26 erf approximation.
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = Math.sign(z) * (1 - poly * Math.exp(-z * z))
  return 0.5 * (1 - erf)
}

/**
 * Mutual Proximity (Schnitzer, Flexer et al. 2012), gaussian approximation:
 * rescales a similarity matrix so that a pair is close only if each point is
 * surprisingly close from the other's perspective. Demotes hubs (umbrella
 * labels near the centroid) and returns symmetric scores in [0, 1].
 */
export function mutualProximity(sim) {
  const n = sim.length
  const dist = sim.map((row) => row.map((s) => 1 - s))
  const mean = new Array(n).fill(0)
  const std = new Array(n).fill(0)
  for (let i = 0; i < n; i++) {
    let sum = 0
    for (let j = 0; j < n; j++) if (j !== i) sum += dist[i][j]
    mean[i] = sum / (n - 1)
    let sq = 0
    for (let j = 0; j < n; j++) if (j !== i) sq += (dist[i][j] - mean[i]) ** 2
    std[i] = Math.sqrt(sq / (n - 1))
  }
  const mp = Array.from({ length: n }, () => new Array(n).fill(0))
  for (let i = 0; i < n; i++) {
    mp[i][i] = 1
    for (let j = i + 1; j < n; j++) {
      const p =
        normalSurvival(dist[i][j], mean[i], std[i]) * normalSurvival(dist[i][j], mean[j], std[j])
      mp[i][j] = mp[j][i] = Math.min(1, Math.max(0, p))
    }
  }
  return mp
}

/**
 * Per-label top-k neighbour lists from a similarity matrix. Pairs involving
 * an umbrella label ("electronic", …) are damped ×0.5 before ranking so they
 * only surface against near-identical labels.
 */
export function topNeighbours(labels, sim, k, umbrella) {
  const umbrellaSet = new Set(umbrella)
  const lists = {}
  labels.forEach((label, i) => {
    const scored = []
    labels.forEach((other, j) => {
      if (j === i) return
      const damp = umbrellaSet.has(label) || umbrellaSet.has(other) ? 0.5 : 1
      const score = sim[i][j] * damp
      if (score > 0) scored.push([other, score])
    })
    scored.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    lists[label] = scored.slice(0, k)
  })
  return lists
}

/** Fraction of (anchor, near, far) triplets where sim(anchor,near) > sim(anchor,far). */
export function tripletAccuracy(simFn, triplets) {
  let correct = 0
  for (const [anchor, near, far] of triplets) {
    if (simFn(anchor, near) > simFn(anchor, far)) correct++
  }
  return correct / triplets.length
}
