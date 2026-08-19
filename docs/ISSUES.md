# Issues — open

Two constellation-edge defects logged in **v21** below (branch
`v21-edges`), on top of the two wheel-animation defects resolved in
**v20** (branch `v20-motion`), the five z-order paint-order fixes
shipped in **v19** (branch `v19-zorder`), the eleven items from
Michiel's UX review of v17 shipped in **v18** (branch `v18-ux-wave`),
the legal item plus five UX defects from that pass resolved in **v17**
(branch `v17-ux-review`), the 13-item live review resolved in **v16**,
the v14 UI review resolved in **v15**, and all nineteen v13 items
resolved in **v14**
([designs/design-v14.md](designs/design-v14.md) has the older per-issue notes).
Each "Resolved" list records what actually shipped.

## Open — v21 constellation edges

Two defects in the Constellation edge styling, spotted while scoping the
v21 restyle:

1. **The out-of-view dash collides with the manual-combo dash.**
   `WheelView.svelte:1576-1579` dashes edges leaving the viewport
   (`.walk-edge.ghost`) at `5 5` with `stroke-opacity: 0.4`, and
   `WheelView.svelte:1581-1584` dashes `.manual-edge` combos at a
   near-identical `6 5` — both on the wheel canvas, one walk-coloured and
   one accent-coloured, so "this edge exits the viewport" is visually
   indistinguishable from "this is a manual combo." The wheel already
   dashes two other, unrelated things: the fallback ring drawn when
   radial data is missing (`.gridline.dashed`, `WheelView.svelte:1469-1471`,
   drawn at `WheelView.svelte:962-969`) is `3 5`, and the centre hub
   button's ring (`.hub-circle`, `WheelView.svelte:1710-1715`, drawn at
   `WheelView.svelte:1344`) is `4 4` — the plain `.gridline` circles
   themselves (`WheelView.svelte:1463-1467`) carry no dash at all. On a
   separate canvas, the genre map's taxonomy method also dashes, at `6 4`
   (`GenreMapView.svelte:50`). That's four dash patterns already live on
   the wheel alone; a fifth for out-of-view state has nothing left to
   distinguish it from the closest one, `.manual-edge`'s `6 5`.
2. **The walk arrowhead is oversized and occluded.** The `#walk-arrow`
   marker (`WheelView.svelte:1029-1039`) sets `markerWidth="7"` without a
   `markerUnits` attribute, so it defaults to `strokeWidth` — at the walk
   edge's stroke-width of 2, that renders a 14-user-unit arrowhead beside
   an 11-unit star radius. `refX="9"` places the arrow's tip at the
   target node's centre, but the layer stack documented at
   `WheelView.svelte:903-922` paints edges at layer 5, under nodes at
   layer 9, so the tip is painted first and then buried under the star —
   only the arrow's flanks peek out past the node's edge.

## Open — v19 z-order review

One item from a review of SVG rendering in WheelView.svelte carries over:
the wheel's paint order itself is fixed now (see Resolved in v19 below), but
labels still don't counter-scale under zoom.

1. **Fonts don't counter-scale under zoom.** At high zoom (k up to 8), node
   radii divide by the zoom factor but font sizes don't, causing labels to
   grow up to 8×, collide with the rim, and crop at the viewBox.

## Open — tooling

One repository-tooling defect surfaced by the v20 browser-verification pass
(the probe worked around it; the script itself is untouched):

1. **`scripts/screenshot.mjs` clicks a tour button that no longer exists.**
   Line 49 targets a button named "Close the tour", but the tour overlay's
   close button is labelled "Skip the tour" (`TourOverlay.svelte`), so the
   script stalls at that step on a fresh profile where the guided tour opens.
   Fix is a one-word selector update — or better, target the overlay's
   stable `aria-label` and add a short timeout so a future rename fails
   loudly instead of hanging.

## Resolved in v20

Both wheel-animation defects from the v20 motion review, shipped on
`v20-motion`: the per-slot angle and the gutter x now ride a real animation
channel instead of snapping to their relaxed/banded target the instant it
changes. A new `core/displaced.ts` is the shared, pure "displaced scalar"
mechanism behind both fixes: `captureDisplaced` freezes each node's currently
DISPLAYED value — not the stale old target, the actual on-screen position,
mid-lerp or already settled — the moment a new target map is about to replace
the old one, so the node glides FROM there TO the new target instead of
jumping; `numericMapsEqual` skips the capture when a target map is rebuilt (a
fresh `$derived.by` instance) but lands on identical values, load-bearing
because an unrelated `$effectiveSettings` emission rebuilds `slotAngleById`
on every run and would otherwise restart an in-flight glide for nothing.
Because `target` is always read live, a change landing mid-flight — two
swaps back to back, a filter edit arriving mid-morph — is just another
capture against whatever is on screen that instant: this captured-displayed
retarget needs no special-casing for the interrupted case. During an axis
swap the angle rides the exact same per-node clock the radius already used
(`radialMorphProgress` off `morphTween`, staggered by the same clockwise
`radialMorphDelays` sweep from 12 o'clock), so a node's offset within its key
slot and its distance from centre arrive together, node by node; everywhere
else — a range-filter edit, the spread slider, a playlist switch, easy-mode —
both ride a plain uniform 600ms `displacedTween`.

1. **Wheel slot angles now glide instead of snapping.** The per-slot angle
   relaxation still solves once per target-map change, but the node's own
   displayed angle captures its current on-screen value and eases toward the
   freshly relaxed angle over the shared clock above, so a reposition — an
   axis swap, a radial range-filter edit, a playlist switch, easy-mode, the
   spread slider — no longer stutters angle-sharp, radius-smooth. Files:
   `core/displaced.ts` (new), `lib/WheelView.svelte`.
2. **Gutter stars now glide across band boundaries instead of sidestepping.**
   `gutterSlotX` (`core/layout.ts`) computes each unkeyed track's 16px-band
   membership and 14px fan position from its TARGET y — where the radius
   tween is headed — instead of the animated y of the moment, so which band
   a star belongs to, and its neighbours' x positions within that band, are
   decided once per target-map change and held fixed for the whole glide;
   only the displayed x itself, via the same captured-displayed retarget as
   1, still eases smoothly toward that stable target. A star crossing a
   16px y-band boundary mid-tween no longer jumps its x by 14px out of step
   with its still-easing y. Files: `core/layout.ts`, `lib/WheelView.svelte`.

**Verified in the browser** (Playwright over the running dev server, sample
library loaded across every playlist, fresh `localStorage`): 26/26 checks —
a real BPM range-filter edit on a keyed star sharing a multi-member key slot
glided its angle smoothly (66 intermediate frames, no single frame over half
the total move) with its radius still gliding alongside; a BPM→Rating axis
swap moved both angle and radius gradually for a star at each end of the
sweep, and the 6 o'clock star measurably started 12 frames after the
12-o'clock star, confirming the angle rides the radius's own clockwise sweep
delay; five gutter stars crossing the same axis swap never jumped x by more
than ~1.5px in one frame (well under the old 14px snap) while y eased
underneath, and every one settled back onto the 14px grid centred on
`GUTTER_X`; a fresh reduced-motion context repeated both the range-filter
and the axis-swap scenarios and settled within 0–1 frames each time; 264
settled node positions held to sub-pixel stability 300ms apart; both themes
screenshotted at rest — zero console or page errors across the whole pass.

## Resolved in v19

Five of the six z-order paint-order bugs found in a review of SVG rendering
in WheelView.svelte, shipped on `v19-zorder`. A template reorder + CSS, no
new logic: the wheel's static labels (tick, key, zone, gutter-tick) now
paint above every static chrome element and edge, wearing a `stroke`-based
halo (`paint-order: stroke`, `stroke-width: 3px`, `stroke` matching the live
`--surface` token) so a spoke, gridline, or edge crossing underneath never
cuts through their glyphs; `pointer-events: none` on the halo stops a label
from stealing a hover or click meant for the geometry below it.
**Deviation from the original framing:** the plan for defects 1, 2, 4 and 5
had imagined moving edges/chrome above labels; the shipped fix goes the other
way — labels above edges/chrome — because a label that disappears under live
geometry is a worse failure than a label that occasionally sits over a line
it was always going to cross anyway.

1. **Centre zone label no longer paints under the radial spokes.** The
   "no … value" label at the wheel's centre now paints in the static-labels
   layer, after all 24 spokes, with its halo covering the crossing strokes.
2. **The rim circle no longer passes through the outermost tick label's
   digits.** Tick labels paint after the rim (and after the gridlines and
   dashed fallback circle), so the rim's stroke never crosses their glyphs.
3. **Gutter star stacks no longer cover the gutter tick numbers.** Gutter
   tick numbers are the one deliberate exception to "labels above chrome,
   below data": they paint *above* the node stack, not below it, so the axis
   stays readable over a dense pile of stars; the halo's `pointer-events:
   none` keeps the stars underneath fully interactive. **Deviation:**
   repositioning the numbers off to the side (so data could stay on top
   everywhere) was considered and rejected — the tick stacks spread
   symmetrically on both sides of the gutter's vertical axis, so there is no
   side a repositioned label could move to without colliding with a
   different stack instead.
4. **Edges to missing-value gutter stars no longer cross the gutter "no
   value" label.** Folded into the labels-above-edges reorder (see the
   section intro) — walk/combo/manual edges all paint before the static
   labels now.
5. **Radial edges sweeping to the gutter no longer cross the key labels.**
   Same fix as 4: key labels paint after every edge class present.

Also part of this reorder, though not one of the six numbered defects: the
hub retry band now paints *under* the stars instead of above them, so a
fallback-ring star (r=70) sitting inside the retry hit band (r 46–70) wins
hover/click there instead of the ring stealing it. The tab-order change this
causes (retry reachable before the stars) is deliberate — the primary
next-track control should reach keyboard focus first. Files:
`lib/WheelView.svelte`.

**Verified in the browser** (Playwright over the running dev server, sample
library loaded across every playlist, fresh `localStorage`): 14/14 checks —
document-order assertions for all six ordering rules (tick-labels after the
rim, zone-labels after every spoke, key-labels after every present edge
class, gutter-tick-labels after every node, the retry band before the first
ghost/node, the hub last of all interactive groups), the halo's computed
`paint-order: stroke` / 3px `stroke-width` / `pointer-events: none` / stroke
colour matching the page's live `--surface` token across all four label
classes, a fallback-ring star winning `elementFromPoint` over the retry band
sitting under it, the centre zone label falling through to the geometry
beneath it instead of intercepting the click, and the ⟲ reset control absent
before any suggestion — both themes, zero console or page errors.

## Resolved in v18

Eleven items in Michiel's own numbering, all shipped on `v18-ux-wave`. 3 and
8 were one workstream (the header ★/🔗 change and its replacement filter
rows); 11 bundled four smaller animation fixes lettered a–d, tied back to 2,
7 and 10. No schema change — the new marks flags serialize but never load
active (see 3/8).

1. **Loading the sample collection over itself no longer silently wipes real
   work.** A new `hasUserWork()` catches what the old real-library check
   couldn't see — a track sitting in any set, a manual edge, or a
   session-only pin/mark, whatever the library underneath — and
   `sampleLoadNeedsConfirmation()` ORs it with that check. Both
   `loadSample()` and the guided tour's two entry points (TopBar, Advanced)
   now gate on it, sharing one dialog; a fresh app still sees no dialog on
   its first sample load. Files: `lib/persistence.ts`, `lib/TopBar.svelte`,
   `lib/AdvancedMenu.svelte`.
2. **The minor/major sector tint cross-fades its `fill` now, and the stars
   fade with it.** The wedge's excluded state used to fade `opacity`,
   snapping colour on the last frame; it now transitions between two
   precomputed `fill` tokens instead, and every wheel star fades in and out
   on any filter change — built once here and reused by the ghost cross-fade
   (10) and the retry ring's enter/exit (7/11c). Key-range exclusion still
   fades the label's opacity only. Files: `app.css`, `lib/WheelView.svelte`.
3. **Tracks-view header ★/🔗 retired as bulk-mutate actions and became
   filter toggles** — show only ★ tracks, or only tracks with a manual
   combo — with the old mark-all-★ and clear-all-🔗 dialogs, and their CSS,
   deleted outright. One workstream with 8, which supplies the matching
   rows. _Trap-proofing cluster, added in review:_ the first cut let the
   toggles unmount their own `<thead>` whenever the filtered table went
   empty, stranding the only control that could turn the filter back off —
   the empty state is now a spanning row inside `<tbody>`, so `<thead>`
   always stays mounted. Both header buttons also disable, with a title
   explaining why, whenever turning them on would do nothing, but are never
   disabled while already on, so a lit toggle can always be switched back
   off (the *active ⇒ visible* invariant, guaranteed by construction, not a
   separate check). Turning a flag on force-reveals its row in the Filters
   panel if hidden; "Reset to defaults" and the guided tour's "return to my
   work" both restore the flag too. All five write sites — both header
   buttons, the Filters panel's two buttons, the Advanced-menu
   hide-checkbox, and the reset path — now funnel through one
   `setMarkFilter`/`toggleMarkFilter` mutator in `stores.ts`, replacing five
   hand-rolled copies. The destructive bulk actions the header buttons
   dropped come back scoped, in Advanced → Track properties: two
   confirm-gated buttons with live counts ("Clear ★ marks (N)" / "Clear 🔗
   combos (N)"), acting on the selected playlists or the whole library when
   none are selected. _Deviation the plan didn't anticipate:_ its premise
   that a bulk clear is automatically one undo step was empirically false —
   clearing stars is three separate store writes (`mustInclude` plus both
   pins), and three sequential top-level `.set()` calls record three
   separate `undoStore` steps, not one, so a single Cmd+Z would only have
   undone the last of the three. A new `withOneUndoStep` helper
   (`lib/undoStore.ts`) batches a write into one recorded step — and is
   atomic on exception too, rolling every store it touched back to its
   pre-call snapshot and re-throwing rather than leaving a partial write
   recorded. Clearing combos doesn't need it: `manualEdges` is a single
   store, already inherently one step. Files: `lib/TracksView.svelte`,
   `lib/FiltersSection.svelte`, `lib/AdvancedMenu.svelte`, `stores.ts`,
   `core/marks.ts`, `lib/undoStore.ts`.
4. **Every row's 🔗 stays faintly visible for as long as a track is
   selected**, instead of only revealing on hover. A `.has-selection` class
   on the table dims every non-partner 🔗 to 0.35 opacity; partners and the
   selection's own icon keep full accent, and hover now changes only the
   cursor. File: `lib/TracksView.svelte`.
5. **The constellation panel's ↑/↓ hide on fine-pointer (mouse/trackpad)
   devices**, where drag-and-drop reorders instead; they stay for touch (no
   HTML5 drag there) and reappear on keyboard focus, via one `@media
   (pointer: fine)` rule. File: `lib/TracklistPanel.svelte`.
6. **The combo-criteria 🔒/🔓 locks moved into the row's normal flex flow**,
   fixed-width and anchored to the first line, instead of `position:
   absolute` at a fixed offset that drifted out of alignment whenever BPM
   wrapped to two lines. File: `lib/CriteriaPanel.svelte`.
7. **The retry/force-retry word curves along the ring's lower arc now** —
   the app's first `<textPath>` — **and the click target widened to the
   whole outer donut** (46→70px radius, up from the thin dashed edge alone),
   plus a scale-in/out transition on the retry ring and the ⟲ reset disc as
   they mount and unmount (11c). Files: `core/layout.ts` (new
   `lowerArcPath`), `lib/WheelView.svelte`.
8. **Two optional filters — ★ tracks and tracks with a manual combo —
   landed in the Advanced Track-properties grid**, off by default like the
   property columns' own filter checkboxes, wired to the same
   `filters.marks` flags issue 3's header buttons drive. _Deviation the plan
   didn't anticipate:_ marks filters **serialize but always load off** —
   `mustInclude` and the pins are session-only, so a persisted-active
   starred filter would silently blank the wheel on reload. `migrateFilters`
   never copies a saved `marks` value onto the parsed result, which *is* the
   reset (documented at the `return out` site, `core/filter.ts`). One
   workstream with 3.
9. **The favicon is the Big Dipper's four bowl stars, connected by thin
   lines, in the wheel's own palette.** Michiel picked variant B (teal
   stars, an amber "walk"-coloured connecting line) from four scratchpad
   candidates, with two corrections: uniform 4.5px stars (dropping an
   initial graded-size hierarchy), and a quadrilateral **re-derived from the
   four bowl stars' real cos(Dec)-corrected RA/Dec** so the shape reads as
   the true, asymmetric trapezoidal bowl rather than the more diamond-shaped
   placeholder first drawn. `scripts/render-icons.mjs` (Playwright, the
   `screenshot.mjs` idiom) rasterises the hand-written `public/favicon.svg`
   to the manifest's PNG sizes. _Review-fix addition:_ the plain
   `icon-512.png` render — rounded, transparent-cornered, correct for a
   browser tab — was also doing double duty as the manifest's `purpose:
   "maskable"` entry, where Dubhe (the bowl star farthest from centre) sat
   past the W3C/Chrome 40%-radius safe zone by about 4.4px. A **dedicated
   `icon-512-maskable.png`** now renders the same untouched SVG scaled 0.8×
   on a full-bleed opaque tile, clearing the safe circle with room to spare;
   the two `purpose: "any"` entries are untouched. Files: `public/favicon.svg`,
   `public/manifest.webmanifest`, `scripts/render-icons.mjs`.
10. **A constellation member the filters hide no longer breaks the walk's
    line.** It renders instead as a small, dim, non-interactive ghost star
    at its true wheel position, joined by dashed, dimmed arrows — the
    constellation still reads as one connected path with part of it
    filtered out of view. Combo and manual edges still simply don't render
    when an endpoint is hidden, unchanged. Files: `core/ghosts.ts` (new),
    `lib/WheelView.svelte`.
11. **Four more micro-animations, every one with a working
    `prefers-reduced-motion` escape:**
    - **(a)** Swapping the Radius axis morphs each star directly from its
      old orbit to its new one, delayed by a clockwise angular sweep,
      instead of jumping mid-tween and pinning at the rim until the domain
      caught up. _Review-fix finding:_ the first cut's reduced-motion path
      reproduced the exact rim-pinning bug it existed to fix — the domain
      tween's own retarget never respected `motionMs`, so under reduced
      motion the per-node morph snapped instantly while the domain was
      still animating at full length underneath it. Coupling the domain
      tween's duration to the same `motionMs(RADIAL_TWEEN_MS)` fixed the
      swap case and, as a side effect, closed a **pre-existing gap**: the
      rings/ticks now respect reduced motion on an ordinary filter-driven
      range edit too, which they never did before this task. Files:
      `core/radialMorph.ts` (new), `lib/WheelView.svelte`.
    - **(b)** Stars fade in and out on every filter change instead of
      popping, the same mechanism 2 reuses for sectors. Files:
      `lib/motion.ts` (new), `lib/WheelView.svelte`.
    - **(c)** The retry ring eases in and out instead of appearing and
      vanishing outright (folded into 7).
    - **(d)** A ghost member cross-fades with its star instead of swapping
      instantly (folded into 10, the same fade wrapper as (b)).

    _Close-out rider:_ two keyframes that predate this wave — the retry
    ring's force/spent dash-spin and the exhausted-hub pulse — had no
    reduced-motion escape of their own; both now do, closing out "every
    animation" for the wheel.

**Verified in the browser** (Playwright over the running dev server, sample
library loaded, fresh `localStorage`): 21/21 checks covering every issue above
plus the cross-cutting concerns — the load-sample guard and its cancel path,
both header toggles' narrow/restore/auto-reveal/disabled-guard/
empty-table-survives cycle, a scoped bulk clear undone in one `Cmd+Z`,
criteria-lock alignment, ghost stars under a tightened BPM filter (including
a manual edge losing its rendered line when an endpoint hides), the retry
ring's curved label and full-donut click target, the radial morph's settle
behaviour, the sector cross-fade, both themes, a full reduced-motion
sweep over the axis morph and the ring toggle, easy-mode round trip, reduced-
motion rider selectors live, and save/reload marks-off — zero console or page
errors across the whole pass.

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
