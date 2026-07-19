# Design v14 — closing the v13-review backlog

A broad round: the nineteen issues Michiel raised reviewing v13, grouped into
filters, sample data, combo criteria, the set builder, the Tracks view, easy
mode, metadata, the selected-track panel and the wheel. Every product question
was settled with the user before implementation (recorded in
[../ISSUES.md](../ISSUES.md) under "Decisions"); this doc records what actually
**shipped**, since a handful of details deviated from the original plan and the
design must reflect reality, not intent.

Delivered as seven implementation workstreams (WS1 metadata removal · WS2
filter kinds + schema v6 · WS3 sample enrichment + D2 · WS4 C1/C2 criteria ·
WS5 S1/S2/S3 set builder · WS6 easy-mode effective layer · WS7 wheel & views
polish), plus this verification pass (WS8).

## The issues

Nineteen, by area — full text in [../ISSUES.md](../ISSUES.md):

- **Filters** F1 (spinner-clipped numbers), F2 (text → A–Z range), F3 (Kind →
  quality), F4 (field-nature: contains / colour chips).
- **Sample data** D1 (enrich every filterable field), D2 (auto-select Classic
  demo on sample load).
- **Combo criteria** C1 (enable always requires), C2 (desired vs demanded lock).
- **Set builder** S1 (essentials guaranteed), S2 (⚡ continues, not restarts),
  S3 (tunable manual-combo preference).
- **Tracks view** T1 (link mode there too).
- **Easy mode** E1 (defaults-only, independent of advanced).
- **Metadata** V1 (remove hand-editing).
- **Selected panel** R1 (hint mustn't widen the rail).
- **Wheel** W1 (key-range collapses wedges), W2 (stale hover-halo), W3 (dim
  manual roads in focus), W4 (spread 0–2).

## Per-issue design notes

### Filters (F1–F4) — a `kind` per property

The filter engine already carried a `filterable` flag per property; v14 adds a
richer `PropertyKind` — `alpha | number | date | key | contains | colour |
quality` — so a control can match its field's nature without special-casing the
engine.

- **F1** — number boxes get their own width budget (`flex: 1 1 68px`,
  tabular numerals, spinner clear of the digits). General to any numeric filter,
  not just the defaults.
- **F2** — name-like text (artist, title, genre, album, composer, grouping,
  remixer, label, mix) becomes an **A–Z first-letter range** with a single `#`
  catch-all bucket (index 26, ordered after Z) for non-letter / diacritic
  starts. `alphaBucket('Éclair') → 26`, `alphaBucket('ZZ Top') → 25`. Two
  selects step min/max; the full A…# span writes `null` (filter off).
- **F3** — **Kind** → a **lossy / lossless / both** tri-state. `audioQuality`
  maps raw format strings via LOSSLESS/LOSSY regexes; unknown/absent formats
  pass the filter. "both" is the range's absence.
- **F4** — **Location** and **Comments** take a case-insensitive **contains**
  substring; **Colour** takes a **chip multi-select** of the raw Rekordbox tags
  present in the playlist-scoped library (`REKORDBOX_COLOURS` maps the raw
  `0xRRGGBB` values to palette names). Low-value numerics keep their range but
  stay opt-in.

### Sample data (D1, D2)

- **D1** — `enrichTrack` fills every filterable property deterministically (all
  id-hashed through the existing `u(salt)` idiom, each with its own null-gate),
  with correlated invariants: `bitRate` is null exactly when `kind` is,
  `size = durationSec × bitRate × 125`, `lastPlayed` present iff `playCount > 0`,
  `location`'s extension follows `kind`. Deliberate gaps on some tracks mimic a
  real library.
  - **Plan correction:** the plan assumed `enrichTrack` re-rolled the authored
    `year` (its line-26 local). It never did — that local only builds the
    `dateAdded` anchor string; the authored `year` from the sample rows always
    survived untouched. That true invariant is now pinned by test, and no
    behaviour was smuggled in. (The local was renamed `dateAddedAnchor` so the
    new date fields can reuse it — no computation change.)
- **D2** — `loadSampleCollection` passes `selectedPlaylists: [CLASSIC_PACK.name]`
  so the sample opens on a populated wheel. Scoped to the sample only; user
  imports stay empty, and the genuine empty state is preserved for a deselected
  playlist (re-homed in the screenshot smoke as "deselect Classic demo → hint").

### Combo criteria (C1, C2)

- **C1** — `toggleCriterion`'s enable branch is now
  `threshold = min(threshold + 1, after)` from **any** state (partial, zero, or
  require-all). Enabling a criterion always means requiring it.
- **C2** — each criterion sub-config gains a `demanded: boolean`. The model
  (Option A, one threshold): a pair is a combo when **every demanded criterion
  matches** AND `matched.length ≥ N`. `demandedCount` (enabled ∧ demanded) is a
  **floor** on the threshold — enforced in `toggleCriterion`, `toggleDemanded`,
  the panel's clamp `$effect`, `migrateCriteria`, and surfaced as locked,
  non-declinable boxes in `RatingBoxes` (`floor` prop).
  - `evaluateCombo` gained a `demandedFailed` flag and **no early return**:
    `isCombo = !demandedFailed && evaluable.length > 0 && matched.length ≥
    threshold`. The early-return temptation was avoided because a truncated
    `matched` would starve `scoreCandidate`'s forced-pool pairs. A demanded
    criterion missing on either side, or whose predicate fails, sets the flag
    (strict — no edge); desired criteria keep shrink-the-denominator.
  - The threshold-0 "symbolic complete graph" shortcut in both `combos.ts` and
    `suggest.ts` `buildNeighbours` is now gated on `demandedCount === 0` as well
    as `threshold === 0`.

### Set builder (S1, S2, S3)

**S1 — essentials as a hard guarantee** (see the algorithm below). Promoted from
a scored `MUST_INCLUDE_BONUS` to a reserved/forced placement, immune to the
`randomness` knob. The S1 essentials guarantee and the ⚡ force may seat a pair
that breaks a demanded (🔒) criterion — the forced counter reports it when this
happens — and this precedence (a hard guarantee or force outranks a demand) is
deliberate.

**S2 — ⚡ continues the short walk.** `TracklistPanel` stores the exact
`SuggestSnapshot` (seed, seedId, endId, length, randomness, progression,
must-includes, manual edges, weight) of a walk that stopped short;
⚡ replays it with `force: true` instead of `suggestSeed++`.
- _Single-arm_ walks get a **strict prefix**: the only `force`-conditional
  branch is the stall-point `if (!force) break`, so both runs consume the PRNG
  identically up to there — the forced walk reproduces the short one exactly,
  then forces onward.
- _Pinned-end (two-arm)_ walks get **arm-stability seam-fill**: output is
  `startArm ++ reverse(endArm)`, force only ever appends to the start arm and
  fills the broken seam, so the short walk's start-prefix and end-suffix are both
  preserved (verified by test, no algorithm change).
- The window closes on set-id change **and** on input drift (`$visibleLibrary`
  by reference, `$effectiveCriteria` by JSON key), mirroring the retry ring.
  Plain ✨ keeps rolling a fresh seed.

**S3 — tunable manual pull.** `SuggestOptions.manualEdgeWeight` (default 5) feeds
`manualTerm` and the hub's `scoreExtra`; a `manualEdgeWeight` setting (clamped
finite 0–10, else 5) exposes it in advanced → Set & suggestions. Default 5 = the
old `MANUAL_EDGE_BONUS` constant, which equals `MUST_INCLUDE_BONUS` — so at the
default a marked road ranks like an essential-strength edge.

#### The S1 reservation algorithm

`pending` is the set of not-yet-placed must-includes. `anchors = end === null ?
1 : 2` (a pinned start and/or end already consume slots). The walk target grows
so essentials always fit:

```
targetLength = max(length, anchors + pending.size)
```

**Single-arm loop** (`while walk.length < targetLength`):

```
slotsLeft          = targetLength - walk.length
mustPlaceEssential = pending.size >= slotsLeft      // no room to defer
```

- When `mustPlaceEssential`: try a **harmonious** step to a pending neighbour
  first; if none, **force** a criteria-breaking edge to a pending track.
- When not, but candidates are empty: **pending-first forcing** (essentials
  break criteria even without the user's `force` flag), then the pre-existing
  plain-`force`-gated fallback.

**Two-arm loop** (pinned end): the same reservation runs over
`startArm.length + endArm.length`; when `mustPlaceEssential` both arm candidate
pools are filtered to `pending`; a pending track reachable from neither arm is
**forced from the start arm** (the pinned end stays put). The both-stalled
branch carries the same pending-first → plain-force ladder.

Determinism is preserved by adding **no new conditional `rand()` calls** in the
reservation logic — the prefix/seam tests are the tripwire. Every placement does
`pending.delete(next)`; pinned endpoints are added to `visited` and pruned from
`pending`, so nothing is double-placed and the forced pool is never empty when
`pick` reads it. If essentials outnumber `length`, they all go in.

### Tracks view (T1)

`TracksView.selectRow` mirrors the wheel's link-mode intercept exactly: when
`linkArmed && selectedId !== null && id !== selectedId`, call `toggleManualEdge`
and return instead of the normal select/append. The wheel does **not** reset
`linkArmed` after a toggle (so partners chain), and neither does the table. A
`crosshair` cursor cues the armed state; the inner ＋/★ buttons keep their
`stopPropagation`.

### Easy mode (E1) — the effective-store layer

Easy mode was visibility-only over shared state, so a filter set in full mode
still bit in easy. v14 makes easy **compute with defaults** without ever mutating
the stored advanced writables — a new derived layer in `stores.ts`:

```
easy = derived(settings, s => s.uiMode === 'easy')   // primitive-boolean dedupe

effectiveCriteria    = easy ? structuredClone(DEFAULT_CRITERIA) : $criteria
effectiveFilters     = easy ? { ...EMPTY_FILTERS, playlists: $filters.playlists } : $filters
effectiveSettings    = easy ? { ...DEFAULT_SETTINGS, theme, uiMode, advancedOpen } : $settings
effectiveManualEdges = easy ? [] : $manualEdges
```

- **Boolean dedupe matters:** `easy` is a primitive derived, so it only fires on
  an actual mode flip — not on every settings keystroke — which keeps the
  effective stores from recompute-storming the O(n²) combo pipeline downstream.
- `structuredClone` guarantees the `DEFAULT_*` singletons are never aliased or
  mutated by a consumer.
- **What resets vs stays:** `effectiveFilters` keeps the shared **playlists** but
  resets properties/genres/keyRing; `effectiveSettings` resets engine values but
  keeps **chrome** (theme, uiMode, advancedOpen). The playlist and the created
  set stay shared across modes.
- The effective stores are swapped into the engine-consuming derivations
  (`visibleLibrary`, `comboView`, `focusEdges`, `genreMatcher`, `iconClasses`,
  `neighbours`) and the reachable component reads (`TracklistPanel`,
  `WheelView`); the raw writables are **never** touched. `persistence.ts` and
  `undoStore.ts` keep reading the **raw** stores, so easy's default-computing
  never disturbs what is saved or undone. Returning to All controls restores
  every stored value exactly.
- `manualEdges` was relocated up next to the other engine inputs so the derived
  layer consumes it with no TDZ (`npm run check` is the guard). ★/pins/🔗 are
  wrapped behind `{#if uiMode !== 'easy'}`; entering easy disarms `linkArmed`.

### Metadata (V1)

The `.edit-grid` hand-editor, the `isVinyl` field, `updateTrack`, and the
VINYL/✎ affordances are removed end-to-end (`model.ts`, `persist.ts`,
`rekordbox.ts`, `SelectedTrackCard.svelte`, `stores.ts`). A save carrying
`isVinyl` parses and simply drops it. The freed card space goes away. The
unrelated **global** `key.vinylMode` criterion (bpm-coupled key comparison)
stays — per-track vinyl marking remains rejected (mixed vinyl↔digital pairs need
a bounded pitch search not worth the complexity).

### Selected panel (R1)

The right rail is fixed (`.right-aside { width: 280px; flex-shrink: 0 }`);
`.selected-card { min-width: 0 }` and `.link-hint { overflow-wrap: break-word }`
let the (now two-line, wheel-and-Tracks) hint copy wrap within it rather than
stretch the section.

### Wheel (W1–W4)

- **W1 — fade, not geometric collapse.** The issue asked the key-range narrowing
  to "collapse the angular wedge … reusing the animation the major/minor toggle
  plays." That toggle's animation **is** a 0.6s opacity fade of `.excluded`
  sectors — not a geometric collapse — so W1 shipped as exactly that: a shared
  `keyExcluded(key)` helper (ring-exclusion OR camelot-number outside the active
  key range) drives `class:excluded` on both sectors and labels, which fade
  together via the existing animation. This is the honest reading of "the same
  small animation."
- **W2** — `removeAt` (and clear-all) now null `hoveredId`, killing the stale
  hover-halo when the hovered track is deleted.
- **W3** — `.manual-edge` gains `class:dim` when a node is selected and the edge
  is not incident to it; incident edges stay bright (0.75), the rest fade to
  0.12, matching the node dimming.
- **W4** — `spreadHalfDeg(factor, nodeRadius, r)` maps the slider piecewise:
  `0 → 0°`, `1 → 4°` (byte-identical to the old `4 × factor`), `2 → 7.5°`, using
  the group's minimum radius and `NODE_WORLD_RADIUS` so the node's **edge** (not
  centre) kisses the ±7.5° wedge at factor 2. Slider max raised 1 → 2, default
  still 1.

## Schema v6 — the change list

Bumped **once** (WS2), covering the whole wave; `parseProject` accepts 1–6.

| Source | Change | Migration |
| --- | --- | --- |
| WS2 | text ranges → `alpha`/`contains`/`colour`/`quality` kinds | old string tuples fail the new shape guards and **drop** on load; alpha clamps `[-3, 40.6] → [0, 26]` |
| WS4 | `demanded` flag ×4 on criteria | whitelisted `raw?.demanded === true` (absence/garbage → false); threshold then re-floored to `demandedCount` |
| WS1 | `isVinyl` removed from `Track` | ignored on parse, never re-serialized |
| WS7 | `slotSpreadFactor` clamp `[0,1] → [0,2]` | a saved 1.7 now survives instead of snapping to 1; legacy `slotSpreadDeg=7.5` still migrates to 1 |
| WS5 | `manualEdgeWeight` setting | clamped finite 0–10, else the default 5 |

The trap the WS4 round-trip test guards: without the explicit boolean coercion,
`demanded` vanishes on reload; without the re-floor, a saved partial threshold
could sit below the locked count.

## Verification

- Unit suites per area (filter, persist, properties, combos, suggest, samples,
  effective, layout) — full suite green (628 passed / 1 skipped at WS8).
  Notably: S1 guarantee asserted across seeds 0–19 at randomness 1; S2 strict
  prefix (single-arm) and seam-fill (two-arm) both pinned; C2 veto + populated
  `matched`; the schema-v6 migration-drop cases in both filter and persist tests.
- `npm run check` 0 errors, `npm run lint` clean.
- [../../scripts/screenshot.mjs](../../scripts/screenshot.mjs) refreshed for the
  v14 flows and run against `npm run dev` to a **zero-`errors[]`** finish: the
  re-homed empty-state check, alpha-range narrowing, quality tri-state hiding
  lossless, a criterion lock flooring the require row, ✨ placing a ★ essential,
  ⚡ preserving the short walk's leading rows, and easy mode hiding the
  criteria/filters and the ★/🔗 marks. README screenshots regenerated from the
  run.

## Non-goals / recorded rejections

- **Per-track vinyl marking** (V1) — the global toggle stays; mixed vinyl↔digital
  key matching needs a bounded pitch search not worth the risk.
- **A second threshold number** for demanded criteria (C2) — one floored
  threshold is simpler than "all demanded AND N of the rest".
- **Colour filter** may be dropped entirely if it proves fiddly — shipped, kept.
- Easy mode does **not** mutate stored advanced state — it computes past it.
