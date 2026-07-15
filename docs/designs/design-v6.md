# Design v6 — Sixteen issues after using v5

Sixteen issues from real sessions with v5 (docs/ISSUES.md), covering filter
ergonomics, wheel-geometry corrections, a new set-order feature, the sample-library
consolidation, and top-bar decluttering. This document records the design decided
with Michiel before implementation (2026-07-15). Two items deliberately reverse
documented v5 decisions; both reversals are called out below.

## The issues and their resolutions

| #   | Issue                                              | Resolution                                                                                                                                            |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Filter min can exceed max                          | `clampRange` pulls the edited side to the other bound; the store gets the clamped range on every keystroke, the boxes are rewritten only on blur/enter |
| 2   | Radial limits should rescale the wheel             | The radial scale's domain = the active filter for the radial metric, falling back to the playlist selection's extent — **partial reversal of v5 §A** (§A) |
| 3   | Per-range reset buttons                            | A ↺ per range restores `[floor(min), ceil(max)]` of the **playlist-scoped** extremes (approval caveat, §A)                                            |
| 4   | Legend limited to visible symbols                  | Classes without visible tracks are **omitted** (not dimmed); the whole legend hides at ≤ 1 distinct visible symbol — **reversal of v5 remark 3** (§B)  |
| 5   | Set-order preferences submenu                      | New "Set order" section: opener/closer pickers promoted from the 📌 pins, must-include marks, BPM progression curves (§C)                              |
| 6   | One sample collection instead of packs             | All 11 packs load together as playlists in a single "Sample collection", behaving exactly like an XML import; demo sets and ◀/▶ cycling dropped (§D)   |
| 7   | Import stats crowd the top bar                     | Status shows the collection name + an ⓘ icon; the full report appears in a hover/focus tooltip (§E)                                                    |
| 8   | Empty hint centred on the screen                   | The "Nothing to show yet" card is a `foreignObject` anchored on the wheel's true centre (CX, CY) inside the viewBox                                    |
| 9   | Filters shuffle node angles                        | Slot fan-out (and gutter stacking) computed over the **full library**; filtering leaves gaps in the fans, nothing moves (§A)                           |
| 10  | Genre method: default hybrid, dropdown in panel    | `DEFAULT_CRITERIA.genre.method = 'hybrid'`; the method select joins the combo panel's Genre row; mode/k/threshold stay advanced-only (§F)              |
| 11  | Next button should signal + allow forcing          | The hub turns warning-coloured with a brief pulse when the anchor's neighbourhood is exhausted; clicking then forces the best non-matching track (§C)  |
| 12  | Disconnected genre-map components drift out        | `forceCenter` replaced with gentle `forceX`/`forceY` gravity (0.05); ghost neighbours repel at 0.6× charge (§G)                                        |
| 13  | 'Genres' clips in a crowded top row                | #7 shrinks the status; header wraps, view switch is nowrap/no-shrink, name ellipsises; bonus: the wheel legend is right-bounded so it can't cover panels |
| 14  | TXT import should use the collection view          | The TXT yields a playlist named after the file, **toggled on**, while still loading the file order as the set (decided with Michiel, §E)               |
| 15  | Name exports before saving                         | Project/M3U8/CSV exports prompt for a filename (prefilled with the sensible default); cancel aborts; the extension is appended when missing            |
| 16  | Advanced menu shows everything at once             | Sections become native `<details>` groups; "Set order" starts open, the tuning sections folded                                                         |

Decisions taken with the user: pins are *promoted* into the Set order section (one
mechanism, two entry points); must-include is flagged on the selected track; the
progression curves shipped are any/steady/rising/falling/sawtooth; the sample
collection drops the per-pack demo sets; the TXT playlist starts toggled on with the
set kept. Approval caveat: v5's static background is **not** wholesale undone — only
the radial axis rescales, elegantly (tweened), and filter defaults are scoped to the
selected playlists, resetting when the playlist toggles change.

## §A Wheel geometry: what is static, what follows the filter

v5 froze the whole frame to the full library. v6 splits that rule in two:

- **Angles became more static.** Slot fan-out and gutter stacking run over the
  *full library*, and only visible placements render. A track's angle is now a pure
  function of (library, spread setting) — filters and playlist toggles make nodes
  appear or disappear, leaving gaps in the fans. (Previously the fan was computed
  from the visible set, so every filter keystroke reshuffled the angular indices —
  the "jitter" of issue 9.) Per-slot ordering sorts by raw radial value, then id,
  so it is independent of the radial domain too.
- **The radial axis follows its filter.** `radialDomain(filterRange, extent)` in
  `src/core/scales.ts`: the active min/max for the radial metric wins; the fallback
  is the **playlist-scoped** extent (`playlistScopedLibrary` — the library filtered
  by the playlist selection only). Degenerate domains widen by ±1. The domain is
  `.nice()`d once up front, then the two endpoints ride a 350 ms `Tween`
  (cubicOut): rings, tick positions and node radii glide through the interpolated
  scale instead of jumping; tick *values* come from the settled target so labels
  never churn mid-animation. The scale is clamped, so mid-tween values (and placed
  but hidden tracks) can never overshoot the band. Colour domain, genre classes,
  symbols and sector geometry stay library-anchored as in v5.

Filter plumbing (issues 1/3 + caveat): `clampRange` guarantees min ≤ max at the
store level on every keystroke while only rewriting the input boxes on change, so
clamping never fights mid-typing. Range defaults seed from
`wholeExtent(playlist-scoped extents)` = `[floor(min), ceil(max)]`; the per-range ↺
commits exactly that. **Toggling playlists resets all three ranges** to the new
selection's whole-number extremes — deliberate (an explicit request): a stale range
from another playlist would silently hide tracks. Loaded projects still restore
their saved ranges (the seeding effect never writes to the store on library
replacement).

## §B Legend: omit, don't dim

v5 kept every genre-class chip and greyed out filtered-away ones. In practice the
grey chips read as clutter once the fans themselves show gaps (§A), so v6 shows
only classes with ≥ 1 visible track and hides the legend entirely when the visible
nodes carry ≤ 1 distinct symbol. Symbol *assignment* still indexes the full-library
clustering, so a genre keeps its shape while classes come and go.

## §C Set weaving v2: order preferences and the force button

- **Pins are library-scoped now** (behaviour change): the pruning effect clears a
  pin (or must-include mark) only when its track leaves the *library*, not the set.
  This is what lets the Set order pickers work before any set exists. The 📌 row
  buttons and the pickers are two views of the same `pinnedFirst`/`pinnedLast`
  stores.
- **Must-include** (`mustInclude` store, session-only like the pins): marked on the
  **selected-track card** — a new persistent card (bottom-left of the wheel) that
  finally gives selection a home for details plus the "☆ must include" toggle; the
  Set order section lists the marks with ✕ removal. In the generator, pending
  must-include candidates get `MUST_INCLUDE_BONUS = 5`, strictly above the maximum
  matched-criteria score (4), until placed. **Biased, not guaranteed**: a mark that
  never neighbours the walk's tip, or a walk that fills up first, skips it — the
  walk never breaks the combo-edge rule for a mark.
- **BPM progression** (`settings.bpmProgression`, persisted via the settings
  merge — old saves backfill to `'any'`): `progressionFit(current, candidate,
  step, progression) ∈ [0,1]` with `rising = 1/(1+e^(−Δ/2))` (logistic on the
  signed BPM step), `falling = 1 − rising`, `steady = 1/(1+|Δ|/3)`, and
  `sawtooth` = rising with every `SAWTOOTH_PERIOD`(=4)th transition a falling
  breather. Weight 0.8, below the matched-criteria unit weight, so it re-ranks
  ties and near-ties without overriding harmonic matches. Missing BPMs are neutral
  (0.5). `'any'` adds **no term at all** — every pre-v6 walk is reproduced exactly
  (regression-pinned in the tests). The backward-growing arm of a pinned-closer
  walk sees time reversed (rising ↔ falling); its sawtooth phase is an
  approximation, since that arm's final play positions aren't known while it grows.
- **Forced next (issue 11)**: `nextAnchorId`/`nextExhausted` (shared with the view,
  so hub state and hub action can't drift) detect when the anchor has no unused
  combo neighbour. The hub then wears `.warning` — walk-bright ring, brief pulse,
  label "force" — and `suggestNext(..., { force: true })` ranks **all** unused
  tracks by the same score with the edge gate ignored. Null now only means every
  track is already in the set.

## §D One sample collection

`SAMPLE_COLLECTION` = all 11 packs (classic demo + 10 themed) flattened into one
library with a playlist per pack. "Load sample" loads it through `replaceLibrary`
and from there it *is* an imported collection: empty wheel, playlists panel, toggle
what you want to work in. Demo sets, the ◀/▶ cycling history and the advanced-menu
pack picker are gone (decided with Michiel — "Suggest a set" fills the demo-set
role). Track ids (`${packId}-${i}`) are unchanged, so `isSampleLibrary` and the
confirm-once behaviour still work.

## §E Top bar and imports

The status is just the collection name plus an ⓘ whose hover/focus tooltip carries
the full report (total, missing-per-field summary, skipped count, notes). The
header wraps on narrow windows; the view switch never shrinks or wraps its labels;
the name ellipsises. A TXT import now passes
`playlists: [{ name: file-without-extension, trackIds }]` and the new
`replaceLibrary` option `selectedPlaylists: [name]`, so the playlists panel shows
the file as a checked playlist while the set still loads in file order. Exports go
through `promptExportName` (prompt prefilled with the library-derived default;
`ensureExtension` appends the suffix case-insensitively; cancel aborts).

## §F Genre method defaults

`hybrid` — the recommended method since the v4 evaluation — is now the default,
and the method select sits in the combo panel's Genre row (parameters stay in the
advanced menu). Save semantics: projects that stored a method explicitly keep it
(no forced upgrade, regression-pinned); legacy saves *missing* the field inherit
`hybrid` via the migration fallback.

## §G Genre map containment

`forceCenter` only re-centres the mean of all nodes, so components with no links
drifted apart indefinitely under the −260 charge (worst with all method overlays
off). Replaced by weak `forceX`/`forceY` gravity (`CONTAIN_STRENGTH = 0.05`)
toward the canvas centre; ghost neighbours repel at −160 (0.6×) so "show nearby
genres" doesn't blow the map up. Verified visually with the full sample collection:
all nodes (including fully isolated ones) stay in frame, and connected layouts are
not visibly compressed.

## Non-goals

- Guaranteed must-include placement (a constrained-walk problem; the bias is
  documented as such in the UI copy).
- Progression-aware seam repair for two-armed walks (the seam is still not
  guaranteed to be a combo edge — v5 §C stands).
- Persisting pins/must-include marks in the project file (session-only, like the
  suggestion history).
- Per-pack sample loading (fold the packs' descriptions into playlist UI later if
  ever missed).
