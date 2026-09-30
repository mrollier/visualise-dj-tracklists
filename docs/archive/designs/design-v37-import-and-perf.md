# v37 — Import feedback and the big-library performance wave

Two related complaints about large libraries (~2k tracks today, 20k-track
Rekordbox XML as the stress case): importing a big XML froze the app for
10-20 seconds with no feedback, and once loaded, the wheel and the Tracks view
were slow to appear and laggy to interact with (parameter changes especially).
Both turned out to be dominated by avoidable work, not by inherent cost.

## 1. The import freeze: mostly wasted O(n²), computed twice

Profiling-by-reading found the 10-20s was **not** the XML parse (fast-xml-parser
handles 30-50 MB in ~2-6s). The bulk was `computeComboView` — O(n²) over the
full library — running **twice** during `replaceLibrary`: the old ordering set
`library` before `filters`, so the whole derived graph computed once against
the previous library's stale, permissive filters (pure waste) and again after
the playlist filter narrowed the wheel to empty.

### Fix: clear first, set last (`persistence.ts`)

`replaceLibrary` now writes `library.set([])` first and `library.set(tracks)`
last. Every intermediate store write propagates against an empty library
(trivial), and the single final set computes once, under the final filters.
For XML imports the wheel starts empty (no playlists selected), so the O(n²)
runs **zero** times at import — the import now costs roughly parse time.

A regression test in `tests/persistence.test.ts` subscribes `visibleLibrary`
during `replaceLibrary` and asserts the new library is never exposed to stale
filters (verified to fail under the old ordering).

### Feedback for the remaining seconds: phase labels in the TopBar

New `importStatus` store (label or null); `TopBar` sets it through the phases
"Reading {file}…" → "Parsing {file}…" → "Computing wheel…", each painted
before its blocking call via the exported `yieldToPaint()` (from
`sourceStore.ts`), rendered with the existing indeterminate `ProgressBar` in
the header status slot, and cleared in `finally` so a failed import never
strands the bar.

## 2. The interaction lag: per-pixel recomputes and per-pair string work

Every criteria input event — one store write per range-slider drag pixel, one
per number-input keystroke — reran the full O(n²) combo compute synchronously.
Inside that loop, `genreComponents` redid uncached regex + split +
normalisation work **twice per pair** (millions of string operations per
recompute). Unrelated settings writes (an edge-opacity drag) separately
retriggered the O(m²)-per-slot node relaxation, the genre reclassing and an
O(E) edge re-filter, because they all depended on the whole `effectiveSettings`
object, which re-emits on every write.

### What shipped

- **`genreComponents` memoised** (`genre.ts`): a module-level Map keyed by the
  raw genre string — the vocabulary is a few hundred entries; the pair loop
  hits it millions of times. The single biggest win for slider feel.
- **`throttled()` store helper** (`stores.ts`, next to `distinct()`): leading +
  trailing — the first write in an idle period passes through synchronously
  (checkbox toggles stay instant), bursts coalesce to at most one emission per
  250ms, and the last value always lands. `settledCriteria` feeds `comboView`
  and `genreMatcher`; everything else (UI bindings, undo, autosave, tests)
  keeps the synchronous `effectiveCriteria`. A slider drag now costs a handful
  of recomputes instead of one per pixel.
- **Settings slices** (extending the v36 `sourcePrefs` pattern): `focusEdges`
  reads a primitive `focusClusterEdges` projection, `iconClasses` reads a
  `distinct`-wrapped `{iconMode, maxGenreClasses}` slice, and the wheel's slot
  relaxation reads a throttled `slotSpreadFactor` export — so none of them
  react to settings they don't use.
- **Wheel micro-fixes** (`WheelView.svelte`): the gutter filter+sort hoisted
  out of the per-frame `nodes` derived (axis tweens stop paying O(n log n) per
  frame); `in-walk` looks up the existing `usedIds` Set instead of an
  O(walk)-per-node array scan; a loop-based `extent()` replaces
  `Math.min(...spread)` over the full library (also removes a stack-overflow
  risk past ~65k values).

## 3. Tracks view: measurement and sorting

- **Column widths survive remounts** (`TracksView.svelte`): the view is torn
  down on every wheel↔tracks switch, and re-measuring every text column ×
  the whole library in canvas (`measureText`) was the whole cost of coming
  back. A `<script module>` memo keyed by library reference + column list
  makes later mounts free, and measurement samples the first 2000 tracks
  (marked corner: a wider outlier beyond that spills its column).
- **One shared `Intl.Collator`** (`trackSort.ts`): `localeCompare` with an
  options object resolves a collator per call, at O(n log n) comparisons per
  sort. Tie-breaks on internal ids switched to code-unit order (the
  determinism-over-locale precedent from `layout.ts`).

## 4. Ceilings, deliberately kept (ponytail comments in code)

- `computeComboView` stays O(n²) — fine to ~3-5k visible tracks. It is a pure
  `(tracks, criteria)` function, so the recorded upgrade path is a Web Worker
  behind `derived`'s async form plus candidate bucketing, with no consumer
  changes.
- `relaxSlotAngles` stays O(m²) per Camelot slot — fine to ~200 tracks per
  slot; a sort-by-radius sweep is the noted upgrade if it ever profiles hot.
- Tier-2 items consciously skipped until a profile demands them:
  allocation-free `evaluateCombo`, threshold-mode pair caching, and
  virtualising the Tracks table (the 500-row cap covers it).

## 5. Tests

`tests/perfGates.test.ts` (new) pins the gates: criteria bursts coalesce with
a leading and a trailing emission; an edge-opacity write re-emits neither
`iconClasses` nor `focusEdges` nor `slotSpreadFactor`. `tests/genre.test.ts`
pins the memo; `tests/persistence.test.ts` pins the import ordering. Full
suite, `svelte-check` and lint all green.
