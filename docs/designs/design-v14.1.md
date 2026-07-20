# Design v14.1 — code-clean wave

A hygiene release, not a feature one. After v14 shipped the nineteen-issue
review backlog, three exploration passes surveyed the repo for what a
professional clean-up should address: dead code, lenient quality gates, two
recorded bugs, the persist "migration sanitize pass" the v14 ledger deferred,
the stores param-shadowing hazard, and the biggest duplication clusters. This
doc records what shipped across twelve workstreams (one green commit each,
`4fb32c9..HEAD`) and — as important — what was **deliberately left alone**, so
the next survey doesn't re-flag settled decisions.

## What shipped

**Gates (WS1, WS3, WS4).** Three tightenings, each fixing whatever it surfaced:

- `scripts/screenshot.mjs` now sets `process.exitCode = 1` when its `errors[]`
  accumulator is non-empty. It was an unenforced E2E — reporting failures to
  the console and always exiting 0. Now a broken flow fails the run, which the
  later workstreams relied on to prove zoom/link-mode/sliders still worked.
- `tsconfig.app.json` gained `noUnusedLocals` + `noUnusedParameters` (inherited
  by `tsconfig.tests.json`). After the dead-export removal the codebase was
  already clean enough that these surfaced **zero** findings — verified active
  by a probe-and-revert.
- ESLint moved from `recommended` to `recommendedTypeChecked` with
  `projectService`. `.svelte` files are **deliberately scoped out** of the
  type-aware rules (typed linting doesn't carry cleanly through
  `svelte-eslint-parser`'s block structure — the `.ts` core is where the value
  is), as are `scripts/`/config `.mjs`/`.js` (outside the app's tsconfig
  graph). Surfaced eight `no-unnecessary-type-assertion` findings: six casts
  dropped, two kept as load-bearing (dropping them widens `Array.from` /
  `.toUpperCase()` inference to `string`, which `tsc` then rejects). No
  floating-promise or misused-promise findings existed.

**Persist hardening (WS6).** The recorded "migration sanitize pass". The
migration code leaked untyped garbage through `{...defaults, ...raw}` spreads
for any field not explicitly whitelisted. Now every layer sanitises
field-by-field:

- A `finiteOr(value, fallback, {min, max, mode})` helper replaces the three
  hand-rolled numeric guards, preserving their **distinct** semantics: the
  same-key spread clamps into `[0, 2]`; the jitter seed is finite-checked with
  no clamp; the manual-edge weight rejects out-of-range to the default (a
  stored 15 becomes 5, **not** clamped to 10).
- `migrateCriteria`'s `bpm`/`year` are built field-by-field like `key`/`genre`
  already were, dropping unknown keys.
- Settings are rebuilt field-by-field against the **actual** AdvancedMenu
  slider ranges (edgeOpacity `[0, 0.9]`, suggestLength `[2, 99]`,
  maxGenreClasses `[1, 8]`, …), literal-checked where the type is a union.
- `sanitizePlaylist` guards each entry (object, non-empty `name`, string-only
  `trackIds`); trackIds are **not** pruned to known ids — playlists mirror the
  source XML and unknown ids are inert, so pruning would alter a valid save.

The binding constraint throughout: **valid saves round-trip byte-identically**;
only malformed input now resolves to defaults. Two idempotent round-trip pin
tests (built via `serializeProject` to avoid key-order fragility) guard it.

**Two recorded bugs (WS7, WS8).**

- **Colour-chip honest display.** The colour filter rendered chips only for
  colours in the selected playlists, but the stored selection could retain an
  out-of-scope colour after a playlist switch — filtering the library
  invisibly, with no chip to clear. A pure `colourChipOptions(scoped,
  selected)` helper now surfaces out-of-scope selections as dimmed, dashed,
  removable chips. No store-write change (persist/undo stay untouched).
- **Hand-edits close the ⚡ force window.** The forced-count banner and force
  button could describe a set the user had since hand-edited. A single
  `closeForceWindow()` now funnels the two existing reset paths plus the three
  in-panel hand-edits — `removeAt`, `move` (only on an actual move), and the
  Clear button (a third path the survey missed).

**Naming & narrowing (WS9).** The `stores.ts` derived callbacks that consume
the `effective*` stores were reading with raw-store param names (`$filters`
for `effectiveFilters`, etc.) — the recorded shadowing hazard; renamed to
match the layer actually consumed. Non-null assertions removed in `iconClasses`
and the m3u importer via proper const-capture narrowing. `combos.ts` unified
its `cfg`/`config` params to `criteria`.

**Shared helpers (WS10, WS11).** The approved duplication clusters, extracted
without splitting the big view files:

- `src/lib/viewZoom.ts` — `createViewZoom` shares the d3-zoom setup between the
  wheel and genre map. The zoom behaviour and selection live in **closure
  variables**; components hold only primitive `$state` (`zoomTransform`,
  `zoomK`) written from the `onZoom` callback — the d3-ownership hazard demands
  no d3 object ever enters a Svelte `$state` proxy. An optional `filter`
  preserves the genre map's node-drag gesture rejection.
- `src/lib/shapeSymbols.ts` — the shared shape-path cache (the two views' symbol
  arrays were byte-identical), a plain `Map` in a `.ts` module (retiring the
  `svelte/prefer-svelte-reactivity` disable).
- `selectOrLink(id)` in `stores.ts` — the verbatim link-mode click block shared
  by the wheel and Tracks view.
- `src/lib/SliderRow.svelte` — the labelled range-slider row, six AdvancedMenu
  sliders converted, `bind:value` composing through a `$bindable` prop into the
  store subfields (proven live before the rest were converted).
- `--bounce-transition` CSS token replaces three copies of the spring easing;
  `SPARKLE_BURST_MS` (module export) coordinates the burst animation with its
  clearing timeout, which were two independent literals (550 / 600).

**Test hygiene (WS5).** Nine per-file `track()` factories consolidated into one
`tests/helpers.ts` superset (each file's own defaults spelled out at its call
sites, never branched into the shared factory); a missing fake-timer restore
added in `undoStore.test.ts`.

## Deliberate non-goals

Recorded so they aren't re-proposed as findings:

- **The single-arm / two-arm walk loops in `suggest.ts` are NOT deduplicated.**
  Their `rand()` call order is load-bearing for the ⚡ strict-prefix and
  seam-fill proofs; a "cleaner" merge would change PRNG consumption and break
  determinism.
- **`ManualEdge.a`/`b` are NOT renamed** to `sourceId`/`targetId` (as
  `ComboEdge` uses) — they're persisted schema v6.
- **WheelView / GenreMapView / AdvancedMenu are NOT split** into sub-components
  — shared-helper extraction only, by decision. The big files stay whole.
- **`noUncheckedIndexedAccess` and `strictTypeChecked` were not adopted** — the
  moderate tier was chosen; these are a possible future pass.
- **`.svelte` files are excluded from type-aware lint** (rationale above).
- **`scripts/` remains outside every tsconfig.** `scripts/genre-pack-lib.d.mts`
  is a hand-written declaration unverified against its `.mjs` implementation. A
  `tsconfig.scripts.json` with `checkJs` is a candidate v15 item, not done here.
- **Dead-export policy:** symbols with zero external importers lost their
  `export` (or were deleted if wholly unused); symbols imported only by tests
  are deliberate testing seams and stay exported.

## Deferred (v15 candidates)

- Bring `scripts/` under a `checkJs` tsconfig so `genre-pack-lib.d.mts` is
  verified.
- `migrateCriteria`'s numeric fields (e.g. `maxPercent`) still pass a
  wrong-typed value through via `??` (matching the pre-existing `key`/`genre`
  behaviour) — a stricter numeric guard is a future tightening, not a v14.1
  regression.
- The `noUncheckedIndexedAccess` / `strictTypeChecked` step-up.
