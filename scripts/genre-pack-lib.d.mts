/**
 * Hand-written declarations for the plain-JS build-script module, so the
 * test suite typechecks (tsconfig.tests.json). NOT verified against the
 * implementation, and v32 established that it cannot cheaply be: the
 * tsconfig-with-checkJs route v14.1 deferred typechecks clean even with a
 * declared export the .mjs does not have (proven by adding one), and dropping
 * this file to infer from the .mjs instead gives `{}` for the pack shapes and
 * fails the suite. Edit both halves together. Matrices are dense row-major
 * `number[][]`; neighbour lists are `[label, score]` tuples, best first.
 */

export function jacobiEigen(
  matrix: number[][],
  maxSweeps?: number,
  eps?: number,
): { values: number[]; vectors: number[][] }

export function embedRows(
  matrix: number[][],
  dims: number,
  options?: { normalize?: boolean },
): number[][]

export function ppmiMatrix(
  labels: string[],
  counts: Map<string, number>,
  cooc: Map<string, number>,
  total: number,
  options?: { minCount?: number },
): number[][]

export function blendScores(mp: number[][], cosine: number[][]): number[][]

export function cosineMatrix(rows: number[][]): number[][]

export function mutualProximity(sim: number[][]): number[][]

export function topNeighbours(
  labels: string[],
  sim: number[][],
  k: number,
  umbrella: string[],
): Record<string, [string, number][]>

export function retrofit(
  rows: number[][],
  edges: [number, number][],
  options?: { alpha?: number; iterations?: number },
): number[][]

export function tripletAccuracy(
  simFn: (a: string, b: string) => number,
  triplets: string[][],
): number
