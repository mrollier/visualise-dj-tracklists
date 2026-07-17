# Design v10 — Twenty-four refinements after using v9

A polish pass, not a new pillar. Twenty-four items from real v9 sessions (docs/ISSUES.md,
numbered 1–22 plus 4b and three "Additional issues" bullets): combo-criteria ergonomics, the
same-key wheel spread finally centred and bounded, the genre map draggable at last, a big
Tracks-view first-column simplification, and a long tail of advanced-settings tidy-ups. No data
model change, no backend. This records the design decided with Michiel before implementation
(2026-07-17).

Two reusable pieces carry many of the issues: a hover **info-icon** (`InfoTooltip.svelte`) that
retires long inline explanations, and a **rating-box** control (`RatingBoxes.svelte`) that
replaces the require-N-of-M slider with discrete boxes.

## The issues and their resolutions

| #   | Issue                                                | Resolution                                                                                                                              |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Params locked when a criterion is off                | Drop the `disabled` bindings — BPM %, year tolerance stay editable regardless of the enable toggle                                       |
| 2   | Genre method selectable in the criteria panel        | The method selector leaves the criteria panel (advanced-only); a subtle note there shows the chosen method + current key settings (§A)  |
| 3   | Require-N-of-M is a slider                            | Discrete `RatingBoxes` — one box per enabled criterion, fill k to require k (star-rating semantics) (§F)                                 |
| 4   | "Missing data never blocks a combo" always shown     | Folded behind an `InfoTooltip` next to the threshold                                                                                    |
| 4b  | All filters always visible                            | Advanced Settings gains a "Filters shown" checklist; Date-added ticks on by default, the rest are opt-in (§E)                            |
| 5   | Same-key cloud drifts counter-clockwise, near-touch   | `relaxSlotAngles` re-centres to mean-0 after its sweep; fan-out capped at ±4° so neighbouring keys never touch (§A)                     |
| 6   | Focus card ignores first/last pins                    | The bottom-right card reflects and toggles `pinnedFirst`/`pinnedLast`, not just the star                                                 |
| 7   | Minor-only switch flashes the major wedges            | The sector opacity transition (500ms) is aligned to the 600ms radial tween so it no longer settles early and "pops"                      |
| 8   | Genre nodes still ungrabbable                          | A transparent hit-shape covers each node's symbol **and** label, so the whole node is grabbable; the label gap no longer leaks to pan (§B) |
| 9   | Genre-map re-layout too fast                          | `alphaDecay` lowered (0.02→0.006) — the animation cools ~3× slower and stays legible                                                     |
| 10  | Max symbol classes range + umbrella names             | Range 1–8; when families exceed the cap they merge into their genre-tree parent ("electronic") rather than dropping to circles (§C)      |
| 11  | Node-icons control active off the wheel               | Greyed when the view is not the wheel (it only affects the wheel)                                                                        |
| 12  | Long advanced explanations always shown               | Folded behind `InfoTooltip`s                                                                                                            |
| 13  | Four icons crowd the first column                     | One click-cycle star per row: off → ★ → ⏮ first → ⏭ last → off, skipping first/last when another track holds that pin (§D)               |
| 14  | Header star hidden / misaligned                       | The header star sits in the star column, aligned with the row stars, revealed on header hover                                            |
| 15  | No metadata-rich view of the set                      | A toggle on the position header shows only in-set tracks, ordered by position, with all columns                                          |
| 16  | Genre-map method overlay stacks, never clears          | The overlay is single-select: choosing a method (chip or criterion) replaces the previous one instead of accumulating (§B)               |
| 17  | k-nearest is a slider up to 15                        | A 1–8 number stepper (discrete, k>8 is meaningless)                                                                                     |
| 18  | Key & BPM block is text-heavy                          | Hints fold behind `InfoTooltip`s; parenthetical asides dropped from labels                                                              |
| 19  | ±2/3 label wraps under its checkbox                    | Label sits next to the checkbox, like the sibling rows                                                                                  |
| 20  | Edge-opacity slider greyed but present off-focus       | Rendered only in focus (wheel + a selection) — edges are focus-only since v9, so the slider appears only when they do                    |
| 21  | Max symbol classes floor of 2                          | Floor lowered to 1 (a single class = shapes off, all circles) — folded into #10                                                         |
| 22  | Tracks-table column list runs long                     | Wrapped in a fixed-height scroll box, like the Genres/Playlists lists                                                                   |
| +   | Reset leaves inert controls active                     | With an empty library, controls that do nothing are greyed; only Import and Load-sample stay live                                        |
| +   | Sample collection is opaque                            | An info icon by Load-sample reports track count and missing metadata (reuses `buildReport`)                                              |
| +   | Clear wipes the set silently                            | Clear now asks for confirmation (reuses `ConfirmDialog`)                                                                                 |

Decisions taken with Michiel: 4b resolved by an advanced "Filters shown" checklist (Date-added
default-on); 13 resolved by a click-cycle star that skips a pin stage already held by another
track; 10's umbrella collapse walks the curated genre tree.

## §A Wheel: centred spread, notes over selectors

`relaxSlotAngles` (layout.ts) placed same-key nodes correctly in the passes but its final
de-overlap sweep only ever pushed clockwise and then shifted the whole cloud down, so the
centroid drifted counter-clockwise off the key's centre line and the low edge could pass below
`−half`. The fix re-centres the settled offsets to mean-0 (subtract their mean) after the sweep,
so a key's weight sits on its angle again. The fan-out bound drops from ±7.5° to ±4°
(`half = 4 × slotSpreadFactor` in WheelView) — nodes now stay well inside the ±7.5° key wedge,
which the sweep had let brush against the neighbouring slot. The wedge geometry itself is
unchanged.

The genre-method `<select>` leaves the criteria panel (it lives in the advanced menu already);
in its place a subtle note in the style of the BPM ratio note states the chosen method, and the
key criterion gains a matching note of its current settings (+2 / +7 / vinyl). Parameters no
longer disable with their criterion — a DJ can dial a tolerance in before switching the criterion
on.

## §B Genre map: grabbable nodes, one overlay

Dragging failed because only the small symbol path was hit-testable: a press on the label
(`pointer-events:none`) or the empty part of the node group fell through to d3-zoom, which panned
the canvas. Each node now carries a transparent hit-shape covering both symbol and label, so
`event.target.closest('.genre-node')` always matches and the existing `fx/fy` pin drag runs. The
surrounding nodes still drift to follow — that is the intended "natural" settle — but the whole
re-layout is slowed (`alphaDecay` 0.02→0.006) so it can be followed.

The method overlay was a multi-select `SvelteSet`: switching the criterion method *added* a chip
and never removed the old one, so overlays accumulated. It becomes a single `overlayMethod`;
selecting a method — by chip or by changing the criterion — replaces the previous overlay, and
clicking the active chip clears it. One method's edges at a time, which is also less crowded.

## §C Umbrella genre families

Beyond the class cap, `genreFamilyClasses` truncated the smallest families to plain circles.
Now, when families exceed `maxGenreClasses`, the smallest merge into their **umbrella** — the
parent one level up the curated genre tree (`umbrellaFor`: house/techno/trance → electronic; a
root child → music) — accumulating size under the umbrella label, repeating until the count fits.
The cap floor drops to 1 (a single class renders everything as the class-0 circle, i.e. shapes
off). Determinism is preserved (size desc, label tie-break). Truncation only happens if merging
cannot reduce further.

## §D One click-cycle star

The tags cell's three buttons (★/⏮/⏭) plus the ＋/position cell put four controls in the left
margin. They collapse to a single star per row that cycles on click:
`none → must-include → forced-first → forced-last → none`. The rare pins are deliberate but
reachable; the common toggle is one click on and cycles off. Because only one track can be first
and one last, the cycle **skips** the first (or last) stage when another track already holds it —
a pure `nextStarState(current, firstTakenByOther, lastTakenByOther)` in core decides the next
state, and the cell writes `mustInclude`/`pinnedFirst`/`pinnedLast` to match. The position cell
(column 2) and its ✕-to-remove behaviour are unchanged. The header star keeps its star-all /
clear-all behaviour, now aligned in the star column and revealed on header hover. A separate
toggle on the position header switches the whole table to an in-set-only, position-ordered view
with full metadata columns (column sorting is suspended in that mode).

## §E Filters: Date-added default, the rest opt-in

`LibraryFilters` gains `dateAdded: [string, string] | null`, filtered by lexical range over the
`YYYY-MM-DD` field (null dates excluded while active). `AppSettings` gains
`visibleFilters: FilterKey[]` (`'bpm' | 'year' | 'rating' | 'dateAdded'`), default `['dateAdded']`;
old saves back-fill to that default in `parseProject`. The left Filters section renders only the
range rows whose key is in `visibleFilters`; an advanced "Filters shown" checklist toggles them.
Genres, Playlists and the Keys ring stay as their own always-visible sections — they are not part
of this range-filter split.

## §F Shared UI and the rest

`InfoTooltip.svelte` lifts the import-report popover pattern from TopBar — an ⓘ button revealing a
`role="tooltip"` panel on hover/focus — and backs issues 4, 12, 18 and the sample info icon.
`RatingBoxes.svelte` renders N boxes; filling k sets the value to k, clicking the top box steps
down — the require-N-of-M control (issue 3). k-nearest and max-classes stay plain number inputs
(discrete, not sliders). The edge-opacity slider renders only when the wheel has a selection
(issue 20). The column list scrolls in a fixed-height box (issue 22). With an empty library the
inert controls grey out, Import and Load-sample excepted; the sample info icon runs `buildReport`
over the bundled collection; Clear routes through `ConfirmDialog`.

## Non-goals

- No change to the data model, importers, or persisted `Track` shape (only `AppSettings` and
  `LibraryFilters` grow, each with a back-fill migration).
- The umbrella merge uses the existing curated tree — no new taxonomy authoring; some parent
  labels are intentionally generic ("electronic", "music").
- The in-set-only Tracks view reuses the existing columns; it does not add set-specific columns.
- Long-press is not used for the star cycle (click-cycle chosen for discoverability and keyboard
  reach); the four-icon layout is retired outright.
