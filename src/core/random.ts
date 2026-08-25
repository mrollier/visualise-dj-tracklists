/**
 * mulberry32: a tiny deterministic PRNG. Suggestions use it so "new
 * suggestion" can explore (different seeds) while every suggestion stays
 * reproducible (same seed → same set).
 */
export function mulberry32(seed: number): () => number {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A stable pseudo-random value in [0, 1) for an id under a given seed:
 * FNV-1a over the id, xor'd with the seed, whitened through one mulberry32
 * step. It ordered the wheel's same-key fans until v9 (issues 1 + 17)
 * replaced that with the deterministic relaxation in layout.ts, which is
 * also why settings.jitterSeed is dead. The only caller left is the sample
 * generator in data/enrich.ts.
 */
export function hashUnit(id: string, seed: number): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return mulberry32(h ^ seed)()
}
