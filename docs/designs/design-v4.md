# Design v4 — Research-grounded genre similarity, genre-class shapes, and a genre map view

Date: 2026-07-15. Status: approved.

## Context

The Claude Research report ([../research/claude-research-v1.md](../research/claude-research-v1.md))
reviewed distance measures between music genres and recommends: PPMI + **truncated SVD**
(not random projection) at our vocabulary size, **mutual proximity** (Schnitzer et al.
2012) to fix umbrella-label hubness, **mutual top-k** matching instead of a lone global
threshold, a **Lin/taxonomy** measure over a rooted tree, and a **hybrid** (embedding
retrofitted toward the curated tree, Epure et al. 2020) as the target architecture.

The app is private/non-commercial (user-confirmed), so the AcousticBrainz
CC BY-NC-SA data may stay: we keep the data, upgrade the math.

User decisions:

1. **Data**: keep the AcousticBrainz TSVs (in `data/acousticbrainz/`), rebuild with SVD + MP.
2. **Methods**: six selectable — Exact · Lexical · Graph · **Taxonomy (Lin)** ·
   **Embedding v2** · **Hybrid** — each with a richer explainer **linking to its
   sources**. Default stays Lexical.
3. **Criterion**: **mutual top-k** primary control, threshold kept as secondary filter.
4. **Shapes**: cluster the library's genres **in the currently selected similarity
   space**; max classes is user-configurable in the advanced menu (2–6, default 4).
   If the genres don't separate (≤1 cluster), everything stays circles.
5. **Genre map**: library genres only + a "show nearby genres" toggle (ghost nodes from
   pack neighbours); **toggleable per-method edge overlays** (colour-coded, hover shows
   all methods' scores); **force-directed** layout (d3-force, already bundled via `d3`).

## Design

### A. Pack pipeline v2 — `scripts/build-genre-embedding.mjs`

- Replace random projection with **truncated SVD**: PPMI matrix (≤400×400, symmetric) →
  Jacobi eigendecomposition in pure JS (no deps) → `W = U_d·Σ_d^0.5`, L2-normalised.
  Default d=32; `--dims` flag sweeps {16,24,32,48,64} and prints a built-in triplet-eval
  score (~40 hand-authored electronic triplets) to pick d.
- Cosine matrix over W → **Mutual Proximity** (gaussian approximation over each label's
  distance distribution) → symmetric scores in [0,1].
- **Umbrella list** (`electronic`, `dance`, `pop`, `rock`, `music`, `electronica`, plus
  tree depth-≤1 nodes): flagged in the pack; excluded as top-k neighbours, scores
  damped ×0.5.
- **Hybrid**: retrofit W toward the genre tree (Epure-style iterative averaging,
  ~10 iterations, tree edges mapped into pack vocabulary), then the same
  cosine→MP pipeline.
- **Pack format v2** (`src/data/genre-embedding.json`):
  `{ labels, umbrella, embedding: {label: [[neighbour, score]×k=20]}, hybrid: {…} }`,
  scores rounded to 3 decimals (~200–300 KB). Pairs outside top-k score 0 at runtime.
  Both the `--from-acousticbrainz` and graph-diffusion modes emit v2.

### B. Rooted genre tree — new `src/data/genre-tree.json`

- Hand-authored parent map (child → parent) rooted at `music`, covering the ~89 graph
  genres plus intermediate family nodes. `genre-graph.json` stays untouched for the
  Graph method.
- **Taxonomy method (Lin)** in `src/core/genre.ts`: intrinsic IC (Seco:
  `IC(n) = 1 − log(desc(n)+1)/log(N)`), `sim = 2·IC(LCA)/(IC(a)+IC(b))`, bounded [0,1].
  Unknown labels → lexical fallback (existing pattern).

### C. `src/core/genre.ts` API

- `GenreMethod` grows to `'exact'|'lexical'|'graph'|'taxonomy'|'embedding'|'hybrid'`.
- Embedding/hybrid switch from vector cosine to neighbour-list lookup.
- New `genreComponents(label)`: after aliasing, split multi-genre fields on `/` and `,`
  (never split a string that is itself a known label — protects "drum & bass");
  `genreSimilarity` aggregates component pairs with max.
- New `rankNeighbours(genre, vocabulary, method)` used by the top-k criterion and the map.
- **Mutual top-k predicate** in `src/core/combos.ts`: genre config becomes
  `{ enabled, method, mode: 'topk'|'threshold', k, threshold }` (defaults: `topk`, k=5,
  threshold 0.4 as secondary min-score). Top-k is computed over the **library's distinct
  genres** (memoised per method+vocabulary) — self-calibrating for every method.
  `exact` ignores mode.

### D. UI — advanced menu & criteria

- `AdvancedMenu.svelte`: 6 method options; explainer per method with 1–2 source links:
  Exact→Schreiber 2015, Lexical→token Jaccard, Graph→Rada 1989 (+ Resnik caveat),
  Taxonomy→Lin 1998/Seco 2004, Embedding→Levy & Goldberg 2014 + Schnitzer 2012,
  Hybrid→Epure 2020. Matching-mode control: radio "k nearest (mutual)" with k slider
  1–15 / "score threshold"; threshold slider remains as a secondary filter in top-k
  mode. New Display control: "Max genre classes" slider 2–6
  (`settings.maxGenreClasses`, default 4).
- `CriteriaPanel.svelte`: genre chip hint reflects mode ("top-5 mutual" vs "≥ 0.40").

### E. Genre-class shapes — new `src/core/genreClasses.ts` + WheelView

- `computeGenreClasses(genres, method, maxClasses)`: average-linkage agglomerative
  clustering over pairwise `genreSimilarity`; keep merging while clusters > maxClasses
  **or** closest pair ≥ 0.25 (the "clearly different" gate). Result k∈[1,x]; k=1 →
  `null` (all circles). Class label = most frequent genre in the cluster.
- Derived store `genreClasses` in `src/stores.ts` (visibleLibrary genres × method ×
  maxGenreClasses).
- `WheelView.svelte`: node `<circle>` becomes a `d3-shape` symbol path
  (circle/square/triangle/diamond/star/wye), `transform="translate(x,y) scale(1/zoomK)"`
  preserving zoom-stable sizing; unknown/missing genre → circle. Legend gains shape
  chips with class labels.

### F. Genre map view — new `src/lib/GenreMapView.svelte`

- View switch in `TopBar.svelte`: segmented "Wheel | Genres" (transient store
  `viewMode`, not persisted); `App.svelte` swaps the central view; side panels stay.
- Nodes: one per distinct normalised library genre, radius ∝ √(track count),
  symbol+colour by genre class (consistent with the wheel), text label. "Show nearby
  genres" checkbox → each library genre's top-3 pack neighbours as ghost nodes.
- Edges: per-method overlay chips (6 colour tokens), active criterion's method on by
  default, width/opacity ∝ score, floor 0.15. Hovering an edge → tooltip listing all
  six methods' scores.
- Layout: `d3-force` — `forceLink` (distance ∝ 1−mean score over enabled overlays),
  `forceManyBody`, `forceCollide`, `forceCenter`; reheat on toggle changes; zoom
  behaviour reused from WheelView.

## Non-goals / notes

- No Discogs dump (AcousticBrainz kept; NC licence acceptable — app stays
  non-commercial).
- `genre-graph.json` and the Graph method stay as-is.
- Default method remains **lexical**; hybrid is recommended in its explainer, not forced.
- Out of scope: node drag in the map, CLAP text embeddings, and the DJ-adjudicated
  triplet evaluation from the report (needs human judges — good future remark).
- Project schema stays version 2; new criteria/settings fields default in via merge.
