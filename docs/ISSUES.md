# Issues — open

Thirteen items below, from Michiel's live review of the app — ready for
planning. For history: everything from the v14 UI review shipped in **v15**
(branch `v15-open-issues`), on top of all nineteen items from the v13 review
resolved in **v14** ([designs/design-v14.md](designs/design-v14.md) has the
per-issue design notes, the S1 reservation algorithm, the effective-store
layer and the schema-v6 change list) — see the "Resolved" sections below.

1. **Checkbox rows toggle when clicking the label text, not just the box.**
   Playlists, Genres, and the combo-criteria rows (including BPM) each wrap
   `<input type="checkbox">` + its name in a single `<label>`
   (`PlaylistsSection.svelte`, `GenresSection.svelte`, `CriteriaPanel.svelte`),
   so clicking "UK Garage" or "Bass" toggles it exactly like clicking the box
   — standard HTML label behaviour, but not what Michiel wants. He wants the
   checkbox to be the only clickable target; the name/text next to it should
   do nothing. _Note for plan phase:_ this trades away the larger
   native-label click target (a common accessibility/usability convention) —
   worth a quick confirm before implementing, not a pushback blocker.

2. **Combo-criteria rows wrap to a second line in the 250px sidebar.**
   `CriteriaPanel.svelte`'s `.criterion label` is `flex-wrap: wrap`, so
   several rows spill past one line:
   - **Year within `<N>` years** — "years" wraps down alone. Shorten the
     trailing unit to **"y"**.
   - **Genre** — the inline hint span (`top-{k} mutual`, `same genre`, or
     `≥ {threshold}`) wraps. Replace it with an **info icon** (reuse
     `InfoTooltip`, already used for the threshold row) whose popover states
     the current method and notes it's changeable in **advanced settings**.
   - **Key** — the inline `adjacent on the wheel` hint should become the same
     kind of info icon next to the label (popover: what "adjacent" means +
     changeable in advanced settings), instead of trailing text.
   General rule: every criterion row (Key, BPM, Genre, Year, threshold) must
   fit on a **single line** at the sidebar's current width — no wrapping.

3. **Tracks view: the three leading columns run wide, the header trash icon
   should be a link icon, and the manual-combo column shifts width on
   selection.** `TracksView.svelte`:
   - The ★ (`.tags-col`, 30px), ☰ (`.pos-col`, 44px) and manual-combo
     (`.manual-col`, 30px) header columns, plus the shared `td { padding: 5px
     10px }`, add up to more horizontal space than the icons need — tighten
     all three.
   - The manual-combo column header currently clears every manual combo via
     a **🗑** button; swap it for the same **🔗** icon the row cells use — a
     confirmation dialog already fires on click (`manualClearConfirm`), so
     the icon doesn't need to telegraph "destructive" on its own.
   - Clicking a track changes that column's per-row content shape (blank/
     count text when nothing's selected → a `🔗` span/button once a track is
     selected), and since the table has no `table-layout: fixed` (columns
     auto-size to content), the whole **manual-col width shifts** on
     selection. Needs a layout fix (fixed table layout, or an explicit
     width/min-width matched between the header and every cell variant) so
     the column never moves regardless of what's showing.

4. **Deselect a track by clicking empty space in the sidebar or the set
   panel, not just by re-clicking it in the Tracks view.** Today the only
   way to clear `selectedId` from the keyboard/mouse (besides picking a
   different track) is re-clicking the same row (`selectOrLink`,
   `stores.ts:390`, toggles `current === id ? null : id`) or Escape while the
   advanced panel is open (`WheelView.svelte:489`). There's already a direct
   precedent for "click empty space to deselect": the wheel's own background
   click (`WheelView.svelte:497-499` — `onclick` on `.wheel-wrap` clears
   `selectedId` when `e.target.tagName === 'svg'`, i.e. the canvas itself,
   not a node). Michiel wants the same behaviour extended to the **left
   sidebar** (`CriteriaPanel.svelte`'s `<aside>` — Playlists/Filters/Genres/
   Combo-criteria) and the **right set panel** (`TracklistPanel.svelte`):
   clicking on genuinely empty space there (not a checkbox, row, button, or
   any other control — those keep doing what they already do) clears the
   selection.
   _Recommended approach for the plan phase:_ rather than an SVG-style
   tag check (these panels are nested HTML, not a flat canvas), attach one
   `onclick` at each panel's outer container and test
   `e.target === e.currentTarget` — true only when the click hit the
   container itself (its padding/gaps), false for any descendant, so every
   existing interactive child is excluded for free with no per-element
   deny-list to maintain. Two judgment calls worth confirming before
   implementing: (a) on the set panel, whether the listener sits on the
   whole panel (header + force controls included) or just the row-list
   area — attaching it panel-wide should be safe since real controls are
   separate elements and won't match `target === currentTarget`, but worth
   a quick live check; (b) whether the stat boxes at the top of the sidebar
   ("N tracks" / "N combo suggestions") should count as empty space (they're
   inert display, so probably yes).

5. **Easy mode: the top-bar buttons shift position, and the sidebar leaves
   dead space instead of letting Playlists fill it.** Two related layout
   issues in the same toggle (`TopBar.svelte` / `CriteriaPanel.svelte`):
   - The toolbar (`.controls`, a flex row) hides the view-switch group,
     Radius/Colour selects, and the ⚙ Advanced button behind
     `{#if !easy}` (`TopBar.svelte:235-283`, `307-317`) — removing them from
     the DOM entirely, so the flex row repacks and every button after them
     (Load sample, Import / load project…, Save project, the Easy
     mode/All-controls toggle, theme toggle, Reset) slides left. Michiel
     wants those surviving buttons to **stay exactly where they are**, so
     the empty gap itself communicates "options fell away" rather than a
     tighter row. _Recommended approach:_ swap the `{#if}` removal for a
     visibility toggle that keeps the hidden group's layout box (e.g.
     `visibility: hidden` on the group, or an explicit width reservation) so
     it still occupies its flex space while easy, instead of collapsing.
   - The sidebar (`CriteriaPanel.svelte`'s `<aside>`) hides Filters/Genres/
     Combo-criteria in easy mode, leaving only the stats + `PlaylistsSection`
     — which don't grow to fill the freed vertical space, so the column
     just ends early with blank space beneath it. Michiel wants
     **Playlists to expand and use all the available height** of the
     sidebar (falling back to its own internal scroll only if its content
     is too long to fit), rather than the sidebar as a whole scrolling with
     a short list stranded at the top. _Recommended approach:_ make
     `<aside>` a flex column and give the Playlists section (or its `<ul>`)
     `flex: 1; min-height: 0; overflow-y: auto` so it stretches when there's
     room and scrolls internally when there isn't — this should hold in
     advanced mode too, not just easy mode, whenever Playlists ends up being
     the last/only section with room to spare.

6. **Same-key spread nudges isolated (non-overlapping) notes off-centre too.**
   `relaxSlotAngles` (`core/layout.ts:33-116`) starts every node in a slot
   **evenly spread across the full ±halfSpreadDeg window** regardless of
   whether it actually risks overlapping anyone
   (`angles = order.map((_, i) => -halfSpreadDeg + i * 2*halfSpreadDeg/(n-1))`,
   line 47) — only afterwards does it compute which pairs actually violate
   `minAngularGapDeg` (the true overlap threshold) and push those apart. A
   node with **zero** violating pairs never receives any push
   (`contributions[k]` stays 0), so it just sits wherever that initial "spread
   across n slots" placement put it — off-centre purely because other nodes
   share its slot, even though none of them are close enough on the radius
   axis to actually overlap it. Michiel wants: a node only moves if it's
   genuinely in danger of overlapping another node in its slot; a truly
   isolated one stays dead-centre regardless of how many (non-overlapping)
   neighbours share the slot.
   _Root-cause fix direction (flagged as non-trivial — needs its own plan
   task, not a one-line tweak):_ the even-spread initialisation exists to
   give the iterative relaxation a sane starting point for pairs that DO
   need to be pushed apart, so it can't just be deleted. The fix likely needs
   to build the actual overlap graph from `minAngularGapDeg` pairs first,
   split slot members into **connected components** (groups of nodes that
   transitively risk overlapping each other), pin every node with no
   component (no violating pair with anyone) to angle 0, and only run the
   existing spread-then-relax machinery independently within each
   multi-node component — each centred on 0 the same way the current
   whole-slot recentring step already does at the end.

7. **Energy is effectively undefined in the sample library Michiel actually
   sees.** `energy` (`core/model.ts:40`) is documented and stored as a
   **Mixed-In-Key-style 1–10** value, parsed from a `Comments` "Energy N"
   tag (`energyFromComments`, `model.ts:95`) — but only the `genre-atlas`
   sample pack ever gets one, via `withEnergy()` (`data/samples.ts:475-486`,
   applied at line 430); every other pack, including **Classic demo**
   (`SAMPLE_TRACKS`, the pack auto-selected on sample load per D2) has
   `energy: null` throughout. So in the app's actual default view, Radius/
   Colour-by-energy has nothing to draw. **Confirmed with Michiel:** keep the
   **1–10** Mixed-In-Key scale (no range change) — the fix is data coverage,
   not the convention. Energy should be mocked in across the sample tracks
   generally, **including Classic demo** (the auto-loaded pack — otherwise
   its absence there reads as confusing/broken), with values that read as
   sensible for each track's genre/character, not just `withEnergy`'s current
   pure `round((bpm-60)/13)` formula, which ignores genre entirely (two
   genres at the same BPM get identical energy today).

8. **Rekordbox colour should render as an actual colour swatch, not the raw
   hex.** `Track.colour` is documented as "raw (e.g. `0xFF007F`); rendered as
   text for now" (`core/model.ts:47`) — a known placeholder. The Tracks view
   currently shows that raw string as-is. Render a small coloured square
   instead (`0xRRGGBB` → CSS `#RRGGBB` is a direct substring swap), reusing
   the existing `REKORDBOX_COLOURS` palette (`core/properties.ts:19-27`) for
   an accessible label/title (e.g. "Pink") on the swatch.

9. **Advanced settings: the Track-properties grid's "Filter" header doesn't
   line up over its checkboxes.** `AdvancedMenu.svelte`'s `.prop-head` (the
   "column"/"filter" label row, line 443) and `.prop-row` (the actual
   checkbox rows, in `.scroll-list` below it) share the same
   `grid-template-columns: 1fr 48px 48px`, but `.prop-head` carries an extra
   `padding: 2px 24px 2px 8px` (line 741) that `.prop-row` doesn't — a rough,
   fixed compensation for the scrollbar `.scroll-list` shows when the
   property list overflows, which throws the header's grid columns out of
   sync with the rows underneath whenever that compensation doesn't exactly
   match the real scrollbar width (differs by browser/OS/zoom). Likely fix:
   `scrollbar-gutter: stable` on `.scroll-list` so its content box never
   shifts when the scrollbar appears, then drop or shrink the header's
   manual 24px offset to match.

10. **Filters view: the numeric value boxes are wider than they need to be.**
    `FiltersSection.svelte`'s `input[type='number']` (line 436-441) got a
    `flex: 1 1 68px; min-width: 68px` in v14 (F1) specifically so a 4-digit
    year never gets clipped by the spin arrows. Michiel says it overshot —
    a few pixels can come off while the year (the widest value in any
    numeric filter) still stays fully visible. Needs a live check in the
    browser to find the tightest width that doesn't clip a 4-digit year
    (e.g. "2024") or a 3-digit BPM with the spinner still clear of the
    digits, rather than picking a number blind.

11. **Brand nomenclature: a "set" is now called a "constellation."** Michiel
    has committed to the name **Zodiac Tracker** for the app (confirmed —
    supersedes the same-day "Zodiac Constellation" note in
    [IDEAS.md](IDEAS.md), see that entry for the full history and the
    Mixlog-boundary tension worth being aware of) and wants the in-app term
    for a set to become **"constellation"**, matching the star-map framing
    of the wheel. Concretely:
    - The wheel's **"✨ Suggest a set from the wheel"** button
      (`TracklistPanel.svelte:407`) → "Suggest a constellation", with a
      hover/info explanation (an `InfoTooltip`, the pattern already used
      elsewhere in this panel) noting that "constellation" is this app's
      name for a set.
    - The **guided tour** (`TourOverlay.svelte:7-28`) needs the same
      nomenclature — at minimum step 3 ("Let it walk": "Press ✨ Suggest a
      set…") and step 4's title ("Your set lives on the right").
    - **Scope flag for the plan phase:** "set" appears in user-facing copy
      well beyond those two spots — roughly 48 lines across 13 `.svelte`
      files (buttons, titles, tooltip bodies, dialog copy — e.g. "Your set",
      "the active set", `ResetDialog`'s body text). Worth deciding up front
      whether this is a **full copy sweep** (every user-visible "set" becomes
      "constellation") or scoped to just the ✨ button + tour for now, since
      the former is a much larger, easy-to-miss-a-spot job. Internal code
      (variable/function/type names like `tracklist`, `activeSet`,
      `setInsert.test.ts`) is user-invisible and out of scope either way —
      only display strings change.

12. **The guided tour needs a bigger overhaul: a controlled demo state, real
    visual demonstrations, full app coverage, and an Easy-mode callout.**
    Today's tour (`tour.ts`, `TourOverlay.svelte`) is five short text steps
    in a floating card — "the app stays interactive so every step can be
    *done* while reading it" (its own doc comment) — triggered the first
    time `loadSample()` runs (`TopBar.svelte:180-188`, `maybeStartTour`), or
    replayed on demand from Advanced settings/the header link (`startTour`).
    Michiel wants substantially more:
    - **A controlled starting state**, not whatever's currently loaded: the
      **Classic demo** playlist (already the auto-selected pack on sample
      load, D2) and **exactly two combo criteria enabled — key + BPM**
      (matching the existing `EASY_CRITERIA` constant from Easy mode,
      `core/combos.ts`) — a clean, reproducible teaching setup rather than
      whatever criteria the session happens to be in.
    - **Real visual demonstrations, not just prose describing what to
      click** — each step should visually spotlight the actual UI element
      it's talking about and show the real reaction (e.g. the edge-fan
      appearing when a track is clicked, the walk actually drawing) so the
      relationships between tracks read clearly on their own, not just
      through text.
    - **Cover the full application**, not only the wheel + set panel +
      easy-mode blurb the current 5 steps touch — walk through the parts a
      first-time user needs to understand to use the app at all.
    - **Introduce Easy mode explicitly** as an on-ramp — a step telling the
      user that option exists if they'd rather start simple — the current
      tour only mentions it once, briefly, near the end.
    - **At the end of the tour, resolve the demo-state swap** (confirmed —
      this answers flag (a) below): when the tour was **replayed** over a
      real library (from Advanced settings or the header link), the last
      step offers a choice — **keep working with the demo sample** shown
      during the tour, or **return to what was loaded/set before "Replay
      the guided tour" was clicked** (library, playlists, criteria, filters,
      all of it, restored as they were). On the **first-run** path (the
      tour's default trigger, `maybeStartTour` on the very first sample
      load) there is nothing to return to yet, so this choice is skipped
      entirely — the tour just ends and the demo sample stays loaded, same
      as today.
    _Flag for the plan phase — this is a real redesign, not a copy tweak:_
    (a) forcing a specific criteria/playlist state conflicts a little with
    the tour's current "stays interactive, never hijacks your state"
    philosophy — now resolved by the end-of-tour choice above: snapshot the
    pre-replay project state (library, playlists, criteria, filters, sets)
    before swapping in the demo state, offer to restore it at the end, and
    skip the whole snapshot/restore/prompt dance on first-run since nothing
    preceded it; (b) "real visual demonstrations" implies the tour actively
    drives the UI (auto-selecting a track, auto-triggering a suggest) rather
    than just narrating — worth scoping which steps stay "go do this
    yourself" vs. which play themselves.

13. **The app isn't robust to a narrow browser window: the wheel shrinks to
    nothing and the legend collapses into a multi-line mess.** `<main>`
    (`App.svelte`) is a flex row of the left sidebar (fixed 250px), the
    central view, and the right set panel (fixed 280px, per issue R1's
    `flex-shrink: 0`). Only the central pane has no floor: `.wheel-wrap`
    (`WheelView.svelte:923-924`) is `flex: 1; min-width: 0` — the classic
    flex trick that lets a child shrink below its content size — so it
    keeps shrinking all the way to invisible as the window narrows. Its
    `.legend` (lines 1361-1376) already `flex-wrap: wrap`s to cope with
    less width, but that's exactly the "big mess" Michiel is describing —
    wrapping was the old fix for a pane that had no lower bound to stop
    shrinking at.
    **Confirmed with Michiel (scope):** only the **central pane** (wheel /
    genres / tracks — whichever is active) gets a floor and its own
    horizontal scroll; the sidebars stay fixed-width and fully visible
    always, exactly as today — the window itself never needs to scroll as
    a whole.
    - Give the central pane a real **`min-width`** (a concrete px value —
      needs a live check to find the point where the wheel stops reading
      as useful, e.g. via `npm run dev` + resizing the viewport, not a
      guessed number) instead of `min-width: 0`.
    - Once the window is narrower than sidebars + that floor, the **central
      pane alone** scrolls horizontally (`overflow-x: auto` on its
      container) — sidebars never move or squish.
    - **The legend**: Michiel's instinct is ellipsis-clipping, but invited a
      better solution if there is one. Recommendation: once the central
      pane has a real floor, drop `flex-wrap` back to **no-wrap** — a
      floored width should comfortably fit the legend on one line at
      standard content (colour scale + missing chip + shape chips + "your
      set" + the hint); if the shape-chip count still overflows on an
      unusually diverse library, let the legend's own bar
      `overflow-x: auto` (a tiny secondary scroller) rather than wrapping
      to multiple lines or guessing an ellipsis cutoff that hides which
      chip got dropped.
    - Worth a quick check whether Genres/Tracks central views have the same
      unbounded-shrink problem — this issue is framed around the wheel
      (what Michiel described) but the fix (a floor + scroll on whichever
      view sits in the central pane) should probably apply uniformly.

## Resolved in v15

Each "Resolved" list below records what actually shipped — including the few
places the implementation deviated from the original plan, kept honest so
nothing is silently reopened.

1. **F5** — The Kind and Keys filters became **two independent toggle
   buttons** each (`lossy`+`lossless`, `minor`+`major`), replacing the 3-way
   single-selects — fixing the clipped `both` label on Kind and letting the
   user deselect everything. Persisted shapes changed (`filters.keyRing`
   string → `keyRings {minor,major}`; quality range `{quality}` →
   `{qualities: []}`, where an **empty array is a real "both-off" state**,
   preserved on load, not dropped), so the project **schema bumped to v7**
   (`migrateFilters` maps old shapes; `parseProject` accepts v1–v7). Decision
   (confirmed with Michiel): the "missing value always passes" invariant is
   kept — keyless / unknown-format tracks show in every toggle combination,
   including all-off (verified live: both-off leaves only the 2 keyless
   sample tracks). Files: `core/filter.ts`, `core/persist.ts`,
   `lib/persistence.ts`, `lib/FiltersSection.svelte`, `lib/WheelView.svelte`.
2. **N1** — The Playlists sidebar header matched the darker `.micro-label`
   `--ink-muted` because — unlike Filters/Genres/Criteria — its scoped
   `summary` rule never set `color: var(--ink-secondary); font-weight: 600`
   (`.micro-label` was showing through, since the sibling sections'
   Svelte-scoped `summary` rule out-specifies the global class). Added the
   two declarations; all four headers now match. File:
   `lib/PlaylistsSection.svelte`.
3. **S4** — ⚡ Force to N now **resumes the reveal from the forced seam**
   instead of redrawing the on-screen prefix. `walkRevealPlan` gained an
   optional `{from,to}` animated node range (nodes/edges outside it render
   static — absent from `nodeDelays`, `null` in `edgeDelays`); `revealRange`
   diffs old vs new walk by longest common prefix **and** suffix, handling
   both S2 shapes (single-arm strict-prefix extension and pinned-end two-arm
   seam-fill). The force path captures the pre-write walk, sets a new
   `walkRevealRange` store, and both the wheel and set-list gate their
   per-item reveal on it; fresh ✨ resets it to null (full reveal). Verified
   live: fresh ✨ animates all edges; ⚡ animates only the new tail (5 static
   prefix + 9 tail edges of 14). Files: `core/walkReveal.ts`, `stores.ts`,
   `lib/TracklistPanel.svelte`, `lib/WheelView.svelte`.
4. **S5** — Adding a track now **inserts after the selected in-set track**.
   New `addTrackToSet(newId)` (`stores.ts`): when the selected track is in the
   active set, splice the new one right after its first occurrence; otherwise
   append (unchanged). Wired to **both** the wheel double-click and the
   Tracks-view ＋ (confirmed scope). A criteria-breaking insert goes through
   anyway — same trust as ★/🔗, no new block path. A `TracklistPanel` effect
   closes the ⚡ force window on any hand-edit that flips the set to
   non-generated, covering the wheel/Tracks paths that bypass `removeAt`/
   `move` (also closes a pre-existing wheel-append gap). Verified live:
   selecting the 2nd set track then ＋-ing a new one splices it at index 2.
5. **Criterion lock survives a disable/re-enable, fixed.** Unchecking a combo
   criterion left its 🔒 `demanded` flag set; re-enabling it came back locked
   without a fresh 🔒 press. `toggleCriterion` (`core/combos.ts:345`) now
   clears `demanded` whenever a criterion is disabled.
6. **Tracks-view manual-combo column.** A third narrow column next to ★/＋:
   unselected shows a per-row manual-combo count, selecting a track swaps that
   for clickable 🔗 icons on its actual partners (hover-reveal to add a new
   one), plus a header "clear all" with a confirmation dialog.
   `TracksView.svelte`.
7. **"Replay the guided tour" button in Advanced settings.** The only prior
   path was a link inside the header's import-details tooltip, which needs a
   live `$lastImportReport` to render at all — gone after any reload.
   `AdvancedMenu.svelte`.
8. **Easy mode's fixed criteria tightened to key + BPM, both required** (was
   3-of-4 across key/bpm/genre/year — too loose per Michiel's review). New
   `EASY_CRITERIA` constant (`core/combos.ts`), wired into `effectiveCriteria`
   (`stores.ts`). Confirmed on the sample library: 147 → 75 combo suggestions.
9. **Save/load discoverability + a real gap.** "Import…" relabeled to "Import
   / load project…" (it already auto-detects `.json`) and moved next to Save.
   Also found and fixed: loading a `.json` project silently overwrote the
   current library with no confirmation, unlike loading the sample collection
   — now gated behind the same in-app confirm dialog. `TopBar.svelte`.

## Resolved in v14

**Filters (F1–F4)**

1. **F1** — Numeric filter values truncated by their spin arrows. Fixed: the
   number boxes get their own width budget (`flex: 1 1 68px`, tabular numerals)
   so 4-digit years and 3-digit BPM stay legible with the spinner clear of the
   value. Holds for any numeric filter, not just the defaults.
2. **F2** — Text filters are now a **bounded A–Z first-letter range** (plus one
   `#` catch-all bucket for non-letter/diacritic starts), stepped through two
   selects like the numeric ranges. Applies uniformly to every name-like text
   property (artist, title, genre, album, composer, grouping, remixer, label,
   mix).
3. **F3** — The **Kind** filter is a **lossy / lossless / both** quality
   selector, mapping the raw format strings (MP3/AAC… vs WAV/AIFF/FLAC/ALAC…)
   onto the DJ-relevant choice. Unknown formats pass the filter.
4. **F4** — Field-nature filters: **Location** and **Comments** get a
   **"contains"** substring search; **Colour** gets a **chip multi-select**
   scoped to the Rekordbox tags present in the selected playlists; low-value
   numerics stay opt-in ranges. All driven off the existing `filterable` flag
   plus the new per-property `kind`.

**Sample data (D1–D2)**

5. **D1** — The sample dataset is enriched so **every filterable property is
   populated** across the set (composer, grouping, remixer, mix, colour, kind,
   bit/sample rate, size, track/disc number, date modified, last played,
   location), all deterministically id-hashed, with deliberate gaps on some
   tracks. _Deviation from the plan:_ the plan assumed `enrichTrack` re-rolled
   the authored `year`; it never did (the local `year` only builds the
   `dateAdded` anchor), so that true invariant was pinned by test rather than
   "corrected".
6. **D2** — Loading the sample now **auto-selects the Classic demo playlist**
   so the app opens on a populated wheel. Scoped to the sample only — user
   imports still start empty, and the genuine empty state ("Nothing to show
   yet") is preserved for deselected playlists / over-tight filters.

**Combo criteria (C1–C2)**

7. **C1** — Enabling a criterion **always** requires it now: the threshold ticks
   up by one (`min(threshold + 1, enabledCount)`) from any state, including a
   deliberate 0. The old "only from require-all" special case is gone.
8. **C2** — Criteria gained a **demanded (locked)** state via a per-row 🔒
   toggle (not a cycling tri-state checkbox). A pair is a combo when **every
   demanded criterion matches** AND total matched ≥ N; the locked count is a
   **floor** on N (locked boxes can't be unchecked). A demanded criterion that
   can't be evaluated (value missing either side) forms **no edge** — stricter
   than the shrink-the-denominator rule, which still applies to desired
   criteria. `evaluateCombo` uses a flag, never an early return, so `matched`
   stays populated for the forced-pool scorer.

**Set builder (S1–S3)**

9. **S1** — Essential (★ must-include) tracks are a **hard guarantee**, not a
   soft bias: a reservation forces every pending essential in before the walk
   ends (harmonious positions first, a criteria-breaking edge only as a last
   resort), immune to the adventurousness knob. If essentials outnumber the set
   length they all still go in. The guarantee can force edges even in plain ✨.
10. **S2** — **⚡ Force to N continues the short walk in place** by replaying the
    same seed/inputs with `force`, instead of rolling a fresh set. _Nuance:_
    for a single-arm walk this is a **strict prefix** extension; for a pinned-end
    (two-arm) walk it is **arm-stability seam-fill** (the start-arm prefix and
    end-arm suffix are kept, forced picks fill only the broken seam). Plain ✨
    still rolls a fresh set each press.
11. **S3** — The manual-edge preference is now tunable: a **manual-combo pull**
    weight (`manualEdgeWeight`, default 5 = the old `MANUAL_EDGE_BONUS`
    constant) in advanced → Set & suggestions dials how hard walks route through
    marked roads.

**Tracks view (T1)**

12. **T1** — **🔗 link mode works in the Tracks view too**: with link mode armed,
    clicking a different row toggles the manual edge (mirroring the wheel,
    including the non-resetting disarm so several partners chain). A crosshair
    cursor cues the armed state.

**Easy mode (E1)**

13. **E1** — Easy mode now **computes with defaults** (default criteria, no
    filters, default settings) via a derived **effective-store layer**, fully
    independent of the stored advanced config — which is preserved untouched and
    restored on returning to All controls. ★/pins/🔗 are hidden and inert; the
    playlist and created set stay shared. Tour copy updated.

**Track metadata (V1)**

14. **V1** — The hand-enter metadata editor (the `.edit-grid`) and the `isVinyl`
    field are **removed** end-to-end; the app never edits track metadata. The
    freed card space simply goes away. The unrelated **global** `key.vinylMode`
    criterion toggle is untouched (per-track vinyl marking stays rejected).

**Selected-track panel (R1)**

15. **R1** — The right rail has a **fixed width** (`280px`, `flex-shrink: 0`) and
    the `.link-hint` copy **wraps within it** (`overflow-wrap`, `min-width: 0`)
    instead of stretching the whole section.

**Wheel view (W1–W4)**

16. **W1** — Narrowing the key range now **fades the excluded keys' angular
    wedges**, not just their markers. _Deviation from the plan's wording:_ this
    reuses the existing **opacity fade** that the major/minor toggle already
    plays (that toggle _is_ a fade, not a geometric collapse) — extended to
    key-range exclusion via a shared `keyExcluded` helper on sectors and labels.
17. **W2** — Deleting a hovered track now **clears `hoveredId`**, so the wheel's
    blue hover-halo no longer lingers (fixed on `removeAt` and clear-all).
18. **W3** — In focus mode the **manual dashed roads dim** too: an edge incident
    to the selection stays bright, the rest fade to the node-dim factor.
19. **W4** — The same-key spread slider runs **0–2** now (still defaulting to 1,
    byte-identical at 1 and 0). The mapping is piecewise — `0 → 0°`, `1 → 4°`,
    `2 → 7.5°` — and accounts for the node radius so the node's _edge_ (not its
    centre) kisses the ±7.5° wedge boundary at factor 2.

## Schema

The persisted project bumped to **version 6** in one step (WS2), covering the
whole v14 wave: the WS2 text-range → new-kind migration (old string tuples drop
on load), the WS4 `demanded` flags (whitelisted with explicit boolean coercion,
threshold re-floored to the locked count), the WS1 `isVinyl` drop, the WS7
`slotSpreadFactor` clamp widening to 0–2, and the WS5 `manualEdgeWeight`
(clamped finite 0–10, else the default 5). Details in
[designs/design-v14.md](designs/design-v14.md).

**v7** (F5, v15) — `filters.keyRing` (string `'both'|'minor'|'major'`) became
`keyRings {minor,major}` (both booleans); the Kind quality range's `{quality}`
became `{qualities: []}`, where an empty array is a real both-off state and is
preserved on load, not dropped. `migrateFilters` maps both old shapes;
`parseProject` accepts v1–v7.
