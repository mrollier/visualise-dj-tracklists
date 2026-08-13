# Issues — open

Eleven items below, from Michiel's UX review of v17 — ready for planning.
For history: the legal item plus five UX defects from that pass shipped in
**v17** (branch `v17-ux-review`), on top of the 13-item live review resolved
in **v16**, the v14 UI review resolved in **v15**, and all nineteen v13 items
resolved in **v14** ([designs/design-v14.md](designs/design-v14.md) has the
older per-issue notes). Each "Resolved" list records what actually shipped.

## Open — v18 UX review

Eleven items in Michiel's own numbering. 3 and 8 are one workstream; 11
bundles four smaller animation fixes lettered a–d, tied back to 2, 7 and 10.

1. **Loading the sample collection over itself silently wipes real work.**
   The confirmation today only fires for a genuinely different library, so
   re-loading the sample over an active session destroys every
   constellation, ★ mark, manual combo and filter, with no warning and no
   undo. Both the Load-sample button and the tour's entry points will
   confirm whenever any user work exists, over any library including the
   sample; a fresh app never sees the dialog.
2. **The wheel's minor/major toggle animation ends in a colour snap, not a
   fade.** The sector tint's opacity fade isn't smooth through its last
   frame, and the ring's stars pop onto it instantly while the wedge is
   still fading underneath. Fix: sectors cross-fade `fill` between
   precomputed tints instead of fading opacity, and the stars join the same
   fade mechanism built for every filter change (see 11b).
3. **Tracks-view header ★/🔗 bulk-mutate the whole view — star everything
   visible, delete every manual combo — which is dangerous and rarely what's
   wanted.** Both retire as destructive actions and become filter toggles
   instead: show only ★ tracks, or only tracks with a manual combo. Bulk
   _removal_ stays possible — scoped to the selected playlists, or the whole
   library when none are selected — moved into Advanced options behind a
   confirm; one workstream with issue 8, which supplies the matching filter
   rows.
4. **The 🔗 icon changes appearance on row hover while a track is selected,
   for no reason.** With a selection live every row is already a valid link
   target, so the hover-triggered reveal only adds flicker. Every row's 🔗
   becomes faintly visible for as long as a track stays selected; hover
   changes only the cursor, and the selected/partner icons keep their full
   accent.
5. **The constellation panel's ↑/↓ buttons are redundant now that v17 added
   drag-and-drop reordering.** Hide them on fine-pointer (mouse/trackpad)
   setups; keep them for touch, since HTML5 drag doesn't fire there, and for
   keyboard focus on any device.
6. **The combo-criteria "must match" 🔒 locks don't line up.** Each is
   `position: absolute` at a fixed top offset, so rows of different heights
   (BPM wraps to two lines) throw it out of alignment with the rest. Move
   every lock into its row's normal flex flow, fixed-width so 🔒 ↔ 🔓 can't
   shift the row, anchored to the first line.
7. **The wheel-centre "retry" / "force retry" state word sits low, and only
   the thin ring edge is clickable.** Curve the word along the ring's lower
   arc instead — the app's first `<textPath>` — and widen the click target
   from the dashed edge to the whole outer donut, from the `+` hub's
   boundary out past the words; ⟲ reset stays where it is.
8. **Add optional filters for ★ tracks and tracks with a manual combo, off
   by default.** They land as two new rows in the Advanced-options
   Track-properties grid — the same grid whose property _columns_ are
   already on by default — but the new filter checkboxes start unchecked,
   so neither appears in the Filters panel until switched on. One
   workstream with issue 3, which repoints the Tracks-view header ★/🔗 at
   these two flags.
9. **The favicon is a stale purple Figma lightning bolt, unrelated to the
   app.** Replace it with the Big Dipper's four **bowl** stars connected by
   thin lines, drawn in the wheel's own palette, on a tile that stays
   legible at 16px in both light and dark browser chrome.
10. **Filtering out a constellation member (e.g. a max-BPM cap) silently
    breaks the walk — its arrows just vanish.** Render hidden members
    instead as small, dim, non-interactive ghost stars at their true wheel
    position, joined by dashed, dimmed arrows, so the constellation still
    reads as one connected path even with some of it filtered out of view.
11. **Four more micro-animations, all with a `prefers-reduced-motion`
    escape:**
    - **(a)** Swapping the Radius axis morphs each star directly from its
      old orbit to its new one, staggered in a clockwise sweep — which also
      fixes a rim-pinning artifact in the current tween, by construction.
    - **(b)** Stars fade in and out on every filter change instead of
      popping (ties to 2, which needs the same mechanism for sectors).
    - **(c)** The retry ring eases in and out instead of appearing and
      vanishing outright (ties to 7).
    - **(d)** A walk member cross-fades between its star and ghost states
      instead of swapping instantly (ties to 10).

## Resolved in v17

A legal item plus five UX defects, dictated in one pass. Numbered 1 and 3–7:
Michiel jumped from the first item to "as a third issue", so there is no
issue 2. One green commit each on `v17-ux-review`; no schema change. Three of
the six turned out to be something other than what they looked like — noted
per item.

1. **Trademark: the wheel is no longer branded "the Camelot wheel".**
   "Camelot" / "Camelot Wheel" is a Mixed In Key mark ([legal/README.md](../legal/README.md)
   §1, whose pre-publish checkbox this ticks). Every user-facing mention now
   says **"harmonic key wheel"**: the PWA manifest, the onboarding paragraph,
   the guided-tour step, the key-criterion tooltip, the wheel's `aria-label`,
   plus `README.md` and `docs/POSITIONING.md`. What deliberately stayed: the
   1A–12B **notation** references ("keys in Camelot order", "the key by
   Camelot number") — functional, descriptive use that legal/README §1
   explicitly blesses and that DJs search for — and every internal identifier
   (`CamelotKey`, `ALL_CAMELOT_KEYS`, `camelotNumber`, the importers, the
   tests). A new `tests/branding.test.ts` fails the build if the phrase
   returns to a user-facing file. _Bundled in:_ the app rebranded to Zodiac
   Tracker in v16 but `manifest.webmanifest`, `README.md` and `package.json`
   still carried `visualise-dj-tracklists`; all three now match.

3. **Tracks view: the bulk ★ asks first — and every ★ is now undoable.**
   _Worse than reported:_ undo never covered the star marks
   (`undoStore` snapshotted only `manualEdges`), so a mis-clicked header ★
   was unrecoverable, not merely annoying. Two fixes: `UndoSnapshot` gains a
   `pins` field (`mustInclude` + `pinnedFirst` + `pinnedLast`), making every
   star action a Cmd+Z step; and the header ★ now opens a `ConfirmDialog` in
   **both** directions, naming the live count ("Mark all 33 tracks in this
   view as essential?"). Files: `core/history.ts`, `lib/undoStore.ts`,
   `lib/TracksView.svelte`.

4. **Tracks view: the clear-all ✕ moved onto the 🔗 it belongs to.** It was
   an 8px speck absolutely positioned off the icon's top-right corner,
   drifting outside the 26px column. The 🔗 now hides on hover/focus and the
   ✕ overlays it — the same in-place glyph swap the in-set position button
   already uses. _Deviation from the plan:_ a `display: none` swap (the
   position button's exact idiom) shrank the button 27px → 21px, because ✕ is
   a narrower glyph than the emoji; caught in the browser pass, so the 🔗
   keeps its box via `visibility` and the ✕ sits absolutely centred over it.
   Confirm-on-click is untouched. File: `lib/TracksView.svelte`.

5. **Wheel: a double-click inserts after the selected track.** _Not a missing
   feature — a bug._ `addTrackToSet` had spliced after the selection since
   v14 (S5) and was unit-tested; the wheel destroyed the anchor before it was
   read. A double-click delivers `click, click, dblclick`: the first click
   moved the selection onto the double-clicked node, the second hit
   `selectOrLink`'s toggle-off branch and set it to `null`, so `ondblclick`
   saw no selection and appended. Now the second click of a burst is inert
   (`event.detail > 1`) and the double-click passes the pre-burst selection
   explicitly — `addTrackToSet(newId, anchorId?)`, defaulting to the live
   selection so the Tracks ＋ button and the `+` key are unchanged. _Also
   fixes, unreported:_ a wheel double-click used to leave the selection
   cleared. Files: `stores.ts`, `lib/WheelView.svelte`; the empty-set hint
   copy was corrected to match.

6. **Constellation panel: drag-and-drop reordering.** Rows are draggable with
   an accent **insertion line** marking the destination gap (top/bottom half
   of the hovered row picks the side) — Rekordbox/Spotify behaviour, chosen
   over highlighting the displaced row. The ↑/↓ buttons stay as the touch and
   keyboard path, and both routes go through one `reorder(from, insertAt)`
   over a shared, unit-tested `moveItem()` gap-index helper in `core/sets.ts`
   — positional, not identity-based, since a set may hold the same track
   twice. HTML5 DnD, matching the column-header drag already in the Tracks
   view; no new dependency.

7. **Set panel: shorter button, one-paragraph tooltip, shorter default names.**
   - The suggest button drops its tail: "✨ Suggest a constellation".
   - _The tooltip was a CSS bug, not the copy._ `InfoTooltip` forced
     `:global(strong) { display: block }`, so the inline
     `<strong>constellation</strong>` broke the sentence into three lines.
     `strong` is inline again; the two report-style tooltips
     (`SelectedTrackCard`, `TopBar`) wrap their heading in the `<span>` that
     already carries the block rule.
   - Default set names drop the noun — "First", "Second", …, "13" — because
     the 190px dropdown ellipsis-cut "First Constellation". Pre-v17 saves
     shed it on load too, via `shortenLegacySetName`: only **exact** old
     defaults match, so a hand-picked name is never touched, and the
     migration runs before the duplicate-suffix pass so a collapse into an
     existing "First" still gets its " (2)". No schema bump — names are
     free-form strings.

**Verified in the browser** (Playwright over the running dev server, sample
library loaded): 22 checks covering all six issues — including the exact
reported scenario for #5 (three-track constellation, middle track selected,
double-click a fourth node → it lands at position 3) and a real
mouse-driven drag for #6.

Michiel's live review of the app (13 items) shipped in
**v16** below (branch `v16-ux-review`), on top of the v14 UI review resolved
in **v15** and all nineteen v13 items resolved in **v14**
([designs/design-v14.md](designs/design-v14.md) has the older per-issue notes).
Each "Resolved" list records what actually shipped.

## Resolved in v16

Michiel rebranded the app to **Zodiac Tracker** (a set is now a
"constellation") and did a full live UX pass. Thirteen items, one green,
independently-verified commit each on `v16-ux-review`; no schema change.

1. **Sidebar checkbox labels no longer drag-select.** The real annoyance was
   accidentally selecting the label letters, not accidental toggling — so the
   whole row stays clickable (bigger target) and the text gets
   `user-select: none` (Playlists/Genres/Criteria). File: those three
   sidebar sections.
2. **Combo-criteria rows fit on one line.** Year's unit shortened to "y"; the
   Key and Genre inline hints + their moves/method notes fold into
   `InfoTooltip` popovers (which also point to advanced settings). File:
   `lib/CriteriaPanel.svelte`.
3. **Click empty sidebar/set-panel space to deselect a track.** An `onclick`
   on each aside clears `selectedId` only when `e.target === e.currentTarget`
   (the panel's own padding), so every control is excluded for free —
   mirroring the wheel's background-click deselect. Files:
   `lib/CriteriaPanel.svelte`, `lib/TracklistPanel.svelte`.
4. **Easy mode: stable top-bar + Playlists fills the sidebar.** The wheel-only
   view-switch / Radius / Colour / ⚙ Advanced groups now hide via
   `visibility` (keeping their layout box) and the mode toggle gets a fixed
   min-width, so the surviving buttons never shift; the criteria aside becomes
   a flex column and PlaylistsSection gains a `fill` prop so the list claims
   the freed height (scrolls only when it overflows). Files: `lib/TopBar.svelte`,
   `lib/CriteriaPanel.svelte`, `lib/PlaylistsSection.svelte`.
5. **Advanced Track-properties header aligns with its checkboxes.** The header
   moved inside the scroll list as a sticky row (with `scrollbar-gutter:
   stable`), so it shares the exact gutter instead of a guessed 24px pad that
   broke under macOS overlay scrollbars. File: `lib/AdvancedMenu.svelte`.
6. **Filters numeric boxes tightened to a fixed 58px.** They were `flex: 1 1`
   and grew to fill the row (~63px); now grow:0 at 58px (still fits a 4-digit
   year + spinner) with the range-reset right-aligned. File:
   `lib/FiltersSection.svelte`.
7. **Tracks view: tighter leading columns, hover-✕ clear-all, stable manual
   column.** ★/☰/🔗 columns narrowed and their cells de-padded; the header
   clear-all is now the same 🔗 as the rows, revealing a small ✕ on hover; the
   manual column's width is pinned so it no longer resizes when a selection
   swaps the count for the icon. File: `lib/TracksView.svelte`.
8. **Rekordbox colour renders as a swatch, not raw hex.** The colour cell
   draws a chip of the tag's colour (`0xRRGGBB` → `#RRGGBB`) with the palette
   name as its title; null stays "—". File: `lib/TracksView.svelte`.
9. **Same-key spread only moves overlapping notes.** `relaxSlotAngles` now
   splits a slot into connected components of the overlap graph and pins every
   radially-isolated node to centre, relaxing each multi-node component on its
   own — a lone track no longer drifts off-centre just because others share
   its slot. TDD. File: `core/layout.ts`.
10. **Genre-aware 1–10 energy across all sample packs incl. Classic demo.**
    Energy moved into `enrichTrack` (a `genreEnergyBaseline` per style + ±1
    id-hash jitter + a matching "Energy N" comment), so the auto-loaded
    Classic pack — and every pack — colours/sizes by energy instead of being
    blank. Retired the BPM-only `withEnergy`. TDD. Files: `data/enrich.ts`,
    `data/samples.ts`.
11. **Narrow-window robustness.** The three central views (wheel/genres/tracks)
    are wrapped in a `.center-scroll` and floored at 680px, so a narrow window
    scrolls only the central pane while the fixed sidebars stay put; the wheel
    and genre-map legends go single-line (scroll within their bar). Files:
    `App.svelte`, `lib/WheelView.svelte`, `lib/GenreMapView.svelte`.
12. **Rebrand to Zodiac Tracker; "set" → "constellation".** App header/title
    and every user-facing "set" noun renamed (dropdown, New/Delete/Rename,
    ✨ Suggest, pins, dialogs, Portrait footer, default "First Constellation"
    names), plus a new InfoTooltip explaining the term. Internal identifiers
    and the localStorage keys stay, so existing autosaves still load. Files:
    `index.html`, `core/sets.ts`, `core/exporters/portrait.ts`, and the
    user-facing components.
13. **Guided tour rebuilt as spotlight coachmarks.** Eight steps dim the app
    and highlight the real element each describes (`data-tour` anchors); the
    tour runs on a controlled demo (Classic + Key/BPM, wheel + constellation
    panel, full mode), and a replay snapshots the user's work so the last step
    can "Keep this demo" or "Return to my work". Files: `lib/tour.ts`,
    `lib/TourOverlay.svelte`, + anchors across the app.

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
