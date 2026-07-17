# Design v9 — Twenty issues after using v8

Twenty issues from real sessions with v8 (docs/ISSUES.md), headlined by the death of
jitter (same-key tracks now repel deterministically along their arc), edges that only
appear in focus mode, the complete Rekordbox metadata set as optional columns, and a
column-order model that never forgets a position. This document records the design
decided with Michiel before implementation (2026-07-17).

## The issues and their resolutions

| #   | Issue                                         | Resolution                                                                                                                                                  |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Re-jitter option confusing                    | The ↻ button leaves the UI (kept commented in AdvancedMenu); with §A's deterministic relaxation there is nothing left to re-roll                              |
| 2   | Colour scheme skips checkboxes/sliders        | `accent-color: var(--accent)` on the global control rule — native checkboxes, radios, ranges and progress bars now follow blue/aqua/violet                     |
| 3   | Reset-to-defaults button                      | A button at the panel's foot resets every advanced setting (settings sans `theme`, plus the advanced-owned criteria toggles); filters/playlists/sets untouched |
| 4   | Genres view icons + legend                    | The genre map always classifies by genre families (ignores `iconMode`), gains a shape legend at the bottom; the icon-mode control is labelled "Wheel view"     |
| 5   | Genre-node dragging inoperative               | Root cause: d3-zoom's native `mousedown` starts a pan before Svelte's *delegated* `stopPropagation` runs. Fix: `zoomBehavior.filter` rejects node-target events |
| 6   | Minor/major belongs with the filters          | The ring switch moves from the key-criterion block to the Filters section — the store field (`filters.keyRing`) was already a filter (v8 §D)                   |
| 7   | Genres dropdown nested oddly                  | Genres is promoted to a top-level section (Playlists / Filters / Genres), summary count "5/9" — same pattern as Playlists; nested same-width details broke hierarchy |
| 8   | Too many edges                                | Combo edges render only in focus mode: a star around the selected track by default; `focusClusterEdges` (advanced) adds neighbour↔neighbour edges (§B)         |
| 9   | Max symbol classes slider                     | Now a number input (2–6)                                                                                                                                     |
| 10  | Column options ≠ XML metadata                 | All 16 remaining Rekordbox attributes become Track fields + columns (26 total): composer, grouping, kind, size, disc/track number, bit/sample rate, comments, play count, remixer, label, mix, colour, date modified, last played (§C) |
| 11  | Sample data missing album/length/date         | `pack()` enriches rows: curated artist→album maps + hash-deterministic durations, dateAdded and sparse extras, ~10% deliberate gaps (§C)                        |
| 12  | Column toggle forgets position                | `trackColumns` becomes the full ordering of ALL columns; a separate `hiddenColumns` list carries visibility — position is structurally never lost (§D)          |
| 13  | Stars/pins on the left                        | The ★/⏮/⏭ cell moves to the left-most column, the ＋/position cell beside it                                                                                  |
| 14  | Click position to remove                      | Hovering an in-set position shows ✕; clicking removes every occurrence from the active set (Tracks-view duplicate-append retires with it)                      |
| 15  | Header star                                   | A ★ in the tags header stars every track in the current filtered view; when all are starred, clicking clears them; lit iff all visible are starred             |
| 16  | Filters should scope the Tracks view          | The table now reads `visibleLibrary` (full filters incl. keyRing), not just the playlist scope                                                                |
| 17  | Jitter → bounded repulsion                    | `relaxSlotAngles`: a deterministic 1-D angular relaxation per slot — fixed radius, ±(7.5°·spread) bounds, analytic overlap cutoff, graceful saturation (§A)     |
| 18  | Set names: size, arrows, duplicates, ordinals | Bigger name display, ◀/▶ removed, auto-suffix "Name (2)" on clashes, ordinal naming counts sets ("Third Set" after two renames) (§E)                           |
| 19  | Focus card clutters the wheel                 | The selected-track card moves to the bottom of the right aside — bottom-right of the app, under the set panel (§F)                                            |
| 20  | Hover linkage from the set list               | A shared `hoveredId` store: hovering a set row halos the wheel node and tints the Tracks row (§F)                                                             |

Decisions taken with Michiel: issue 17 resolved by deterministic angular relaxation
(over d3-force and greedy beeswarm); issue 10 at full scope — every XML attribute, not a
curated subset; issue 18 name clashes resolved by auto-suffix, file-manager style.

## §A Slot placement: relaxation instead of jitter

`relaxSlotAngles(nodes, halfSpreadDeg, nodeRadius, iterations?)` in layout.ts replaces
the hash-ordered even fan. Each node's only free variable is its angle; radius stays
pinned to its value (BPM by default). Two nodes can only overlap when their radii differ
by less than two node radii — `minAngularGapDeg(r1, r2, p)` gives the exact chord-based
angular gap they need, zero beyond the cutoff. The solver: sort by radius (ties by id),
spread evenly as the initial guess, then a fixed number of passes push violating pairs
apart symmetrically, clamping to ±halfSpread. Deterministic by construction — no RNG, no
convergence check — so `jitterSeed` goes dead (the field survives in settings to spare a
migration; the ↻ button is commented out) and `slotAngleOffsets` retires. When a slot
genuinely cannot fit its tracks the forces cancel into an even squeeze; nothing special
happens at saturation. `slotSpreadFactor` survives as the hard bound (`half = 7.5 ×
factor`). Angles are computed against the settled target radial domain, not the tweened
one, so the relaxation runs once per real change while radii keep animating.

## §B Edges only in focus

`computeEdges`, the `edges` store and the `neighbours` adjacency are untouched — the
suggestion engine, retry machine and Tracks-view neighbour highlight all feed on them.
Only rendering changes: `focusEdges(edges, selectedId, includeCluster)` (combos.ts)
returns nothing without a selection, the incident star with one, and adds
neighbour↔neighbour edges when `settings.focusClusterEdges` is on (default off — little
star graphs, as requested). Star edges draw bright (`focusEdgeOpacity`, simplified to
its live branch), cluster edges at the base `edgeOpacity`. Walk edges are untouched and
always visible. Follow-up noted, not built: pruning the O(n²) `computeEdges` if criteria
changes ever feel slow at 2k tracks.

## §C The full metadata set

Sixteen new nullable Track fields — strings `composer, grouping, kind, comments,
remixer, label, mix, colour`; date strings `dateModified, lastPlayed` (lexical-sortable
'YYYY-MM-DD', like `dateAdded`); numbers `size, discNumber, trackNumber, bitRate,
sampleRate, playCount`. The Rekordbox parser reads all of them; `PlayCount="0"` is a
real zero, not null (pinned by test — the bpm `>0` idiom must not be copied). Existing
sort comparators cover every new field (strings locale, numbers numeric, dates lexical,
missing sinks). `sanitizeTrack` gains per-field guards; no save-version bump — missing
keys parse to null. `buildReport`'s five metadata axes are deliberately unchanged: a
library without remixers is not "missing metadata". Sample packs keep their 7-slot Row
tuple; `pack()` and the classic mapper enrich rows with curated artist→album maps and
hash-deterministic durations/dateAdded/sparse extras, with ~10% gaps for realism.

## §D Column order that survives hiding

`settings.trackColumns` now always holds ALL columns in display order;
`settings.hiddenColumns` holds visibility. Toggling a column edits only the hidden list,
so re-enabling restores the exact previous position — including custom drag order.
`src/core/columns.ts` centralises `ALL_TRACK_COLUMNS`, `COLUMN_LABELS` (ending the
AdvancedMenu/TracksView duplication), `visibleColumns` and the pure `migrateColumns`:
old saves keep their order, gain the missing fields appended in canonical order and
hidden, and can never end up all-hidden (title is forced back on).

## §E Set names

The ◀/▶ arrows go; the name `<select>` grows. `nextSetName` starts its ordinal scan at
the set COUNT, so two renamed sets are followed by "Third Set" — the v8 logic scanned
current names and handed out "First Set" again. `uniqueSetName` auto-suffixes clashes
("Name (2)", "(3)"…) in rename and create, and save-loading normalises pre-existing
duplicates the same way.

## §F The focus card and the hover thread

The selected-track card leaves the wheel (and takes the legend-retreat hack with it) and
docks at the bottom of the right aside — visible regardless of which right panel is
open. A new `hoveredId` store threads hover from the set list outward: the wheel node
gets a subtle halo (no size change), the Tracks row a subtle tint.

## Non-goals

Auto-anything on saturation (§A squeezes, never hides); lazy edge computation (§B gates
rendering only); a Colour swatch renderer (raw text in v9); persisting hover or focus
state; per-set column layouts; retiring `jitterSeed` from saved settings (dead field,
kept to spare a migration).
