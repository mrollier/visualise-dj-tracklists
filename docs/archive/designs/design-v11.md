# Design v11 — Sixteen refinements after using v10

Michiel walked through v10 and dictated sixteen issues (docs/ISSUES.md). One is a real
feature — a unified per-property columns + filters system — and the rest are polish:
threshold-box semantics, tooltip clamping and pinning, playlist-icon degradation, genre-map
physics, tracks-view guards, a dim-don't-disable consistency pass, confirmations, and a
force mode for full-set suggestion. Three forks were resolved during planning: threshold 0
is legal but the complete combo graph is represented symbolically (never materialized); key
ranges run over the Camelot number across both rings; genre is an ordinary text-filterable
property, ANDed with the existing Genres checklist.

## The issues and their resolutions

| # | Issue | Resolution |
| --- | --- | --- |
| 1 | Filters generalized to every property, unified with columns | One registry (`core/properties.ts`), one advanced table with Column/Filter checkboxes (§A) |
| 2a | Require-boxes can't reach zero | Floor drops to 0; complete graph goes symbolic (§B) |
| 2b | Enabling a criterion doesn't raise the requirement | `toggleCriterion` bumps threshold when it equalled the old count (§B) |
| 3 | Tooltips clip outside the app and behind the viewer | InfoTooltip goes `position: fixed`, viewport-clamped (§C) |
| 4 | Sample info icon in the wrong place | Deleted; the status ⓘ already appears after load, now noting the playlist count (§C) |
| 5 | Tooltips are hover-only; links unreachable; `cursor: help` | Click pins the tooltip open; outside-click/Escape dismiss; pointer cursor (§C) |
| 6 | Playlist icons mislead when classes < playlists | All circles + no legend below the cap; only full distinction or none (§D) |
| 7 | Wheel legend hint wraps ragged-left | Hint right-aligns via `margin-left: auto` (§D) |
| 8 | Node dragging feels dead; graph should follow | Label stops claiming grabbability; drag tows the whole graph via shifted gravity (§E) |
| 9 | Method-change relayout still too fast | `alphaDecay` 0.006 → 0.002, `velocityDecay` 0.55 → 0.6 (§E) |
| 10 | Header icons misaligned with row icons | Star and position columns get matching widths/centring (§F) |
| 11a | ☰ with an empty set is a dead end | Toggle disabled while the set is empty; auto-exits if the set empties (§F) |
| 11b | Sort triangle shown while set order rules | Triangle and `aria-sort` hidden in in-set-only mode (§F) |
| 12 | Off-view controls disabled inconsistently | One rule: dim + title, never disable (§G) |
| 13 | Reset-to-defaults fires instantly | ConfirmDialog before resetting (§G) |
| 14 | Selected-track card toggles too bulky | Icon row ★ ⏮ ⏭ + ⓘ (§F) |
| 15a | "Suggest a set from selection" misleading | "✨ Suggest a set from the wheel" (§H) |
| 15b | Short sets stop with no recourse | Button morphs to ⚡ force; forced steps counted and reported (§H) |
| 16 | "This cannot be undone" is false | Sentence dropped; Cmd+Z does undo it (§H) |

## §A One registry for track properties

`src/core/properties.ts` becomes the single source of truth for the 27 non-id `Track`
fields: key, label, kind (`text | number | date | key`), filterable flag, and an optional
cell formatter. `TrackSortField` gains `location` (26 → 27). `columns.ts` keeps its public
API but derives `ALL_TRACK_COLUMNS` / `COLUMN_LABELS` from the registry; TracksView's
`STRING_FIELDS` and `cellText` and AdvancedMenu's `FILTER_LABELS` die in favour of registry
lookups. `LibraryFilters` folds its four top-level ranges into
`properties: Partial<Record<TrackSortField, PropertyRange>>`; kind-aware evaluation gives
text properties case-insensitive prefix-ranges (artist "b"–"k" includes "kraftwerk"), key a
Camelot-number range (8–12 hits both rings; the ring switch composes), dates the existing
sentinel treatment (missing excluded — the documented asymmetry generalizes), numbers the
existing missing-passes ranges. The advanced menu replaces the "Filters shown" and "Tracks
table" checklists with one "Track properties" table — a row per property, Column and Filter
checkboxes, drag order preserved, hide-clears-filter kept. Defaults revert to BPM/Year/
Rating visible (Date-added opt-in). Projects bump to version 4; `migrateFilters` lifts
legacy shapes, and `migrateColumns` now sends newly-appended canonical fields (location) to
hidden so old saves don't sprout a surprise column.

## §B Threshold to zero, and rising with new criteria

The require-N boxes lose their floor: clicking the only filled box clears to "require 0 of
M". Zero means no gating — every visible pair is a combo — so the engine represents the
complete graph symbolically: `buildEdges` returns `complete: true` with an empty list, the
stats line computes n·(n−1)/2, focus mode synthesizes the selection's incident edges, and
the suggesters treat every unused track as a neighbour (the force pool already does). And
enabling a criterion now keeps the "require all" contract: `toggleCriterion` bumps the
threshold by one exactly when it equalled the previous enabled count, so 2-of-2 becomes
3-of-3 — while a deliberate require-0 stays 0.

## §C Tooltips that stay visible and pin open

InfoTooltip re-anchors with `position: fixed`, computing coordinates from the trigger on
reveal and clamping to the viewport (flipping above when there's no room below) — no more
clipping under the two `overflow-y: auto` panels or the central viewer. Clicking the ⓘ pins
the tooltip open until an outside click or Escape, so links inside (Lin 1998) are reachable;
hover still previews. The cursor is a plain pointer. TopBar's hand-rolled import-report
popover converts to the same component, and the sample button's separate info icon is
deleted — loading the sample already raises the import report next to "Sample collection",
which now notes the themed-playlist count.

## §D Wheel: honest playlist icons, tidy legend

Playlists have no umbrella tree, so a symbol cap below the playlist count can only
mislead — two shapes for three playlists reads as two playlists. Below the cap the wheel
now drops all distinction: every node is a circle and the legend chips disappear. The
bottom legend's trailing hint ("click: focus · double-click: add to set") right-aligns with
`margin-left: auto`, so an overflowing chip row wraps into a deliberate right-aligned line
instead of a ragged tail.

## §E Genre map: tow the graph, settle slower

The drag wiring was mechanically sound (a scripted repro moves nodes), but it felt dead:
labels pretended to be handles (SVG hit-tests glyph strokes only — most of a word is a
miss that starts a pan), and releasing snapped straight back. The label returns to
`pointer-events: none` as a plain caption. The felt fix is towing: while a node is dragged,
the weak `forceX`/`forceY` gravity targets shift by the drag displacement, so the entire
graph — linked or not — leans after the grabbed node through empty space; on release the
targets ease home and the slow cooling settles everything visibly. Method changes relax
about 3× slower again (`alphaDecay` 0.002, `velocityDecay` 0.6).

## §F Tracks view and the selected-track card

The star header and row stars share one centred column; the ☰ header and the per-row
position cells share another — matching widths, both centred. The ☰ toggle disables while
the set is empty (the empty-set dead end), and in-set-only mode auto-exits if the set
empties. While set order rules, the sort triangle and `aria-sort` hide; the stored sort is
untouched and returns on toggle-back. The selected-track card compresses its three labelled
toggles into an icon row — ★ ⏮ ⏭ — plus an ⓘ explaining the marks; states and titles stay.

## §G Advanced settings: dim, never disable

One rule replaces three idioms: a control whose effect is invisible in the current view is
dimmed (`.off-view` + explanatory title) but stays adjustable. Same-key spread and node
icons lose `disabled`; edge opacity and cluster interconnect render always but dim outside
wheel-focus; max symbol classes dims in the Tracks view; TopBar's Radius/Colour selects dim
instead of disabling off-wheel (the empty-library disable is a different rule and stays).
Genre matching, Key & BPM, and Set & suggestions shape combos and suggestions everywhere,
so they never dim. "Return to default settings" now opens a ConfirmDialog naming what it
resets before firing.

## §H Suggested sets: force to length

The button reads "✨ Suggest a set from the wheel". When a walk stops short of the target
length, the button morphs to warning styling — "⚡ Force to N" — mirroring the wheel hub.
Forcing reuses the hub's exact scorer: every unused track ranked by criteria score plus the
near-key affinity bonus, softmax-sampled with Adventurousness, applied at each stuck step
(both arms in two-ended walks force-extend from the start arm). `suggestWalk` returns
`{ ids, forced }`, and a notice under the button reports "{forced} of {N−1} steps forced".
The clear-set dialog loses its false "This cannot be undone." — Cmd+Z restores the set.

## Non-goals

No backend, no accounts, no new data sources. The Keys ring, Genres checklist, and
Playlists sections keep their dedicated homes — the properties table governs only the range
filters and table columns. Colour filters compare raw hex lexically (consistent, weak — a
future colour-checklist kind can replace it registry-side). Duration filters take seconds
while cells render m:ss. `sortValue`'s wheel-order key ranking deliberately differs from
the filter's Camelot-number range.
