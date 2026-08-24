# v30 — collapsible panels

Branch `v30-collapsible-panels`. One request from Michiel, with more inside it
than the sentence suggests.

## Thesis

The app was a fixed three-panel shell: 250px of playlists and filters on the
left, 280px of constellation on the right, and — since v28 — an audition bar
across the top. The wheel got whatever was left, which on a laptop is not much,
and there was no way to say _only the wheel, please_.

Each panel now collapses two ways: a button sitting on its own margin, and a
checkbox in a new **View** section of Advanced settings, which is what the
**Preview** section became.

Three of the ten decisions behind that changed more than the toggles did.

## The bar was never actually between the rails

v29 #6 lined the transport up with the central pane by arithmetic: `.player`
was a full-width strip above `<main>` whose three-column grid reserved two
empty spacer columns sized to `var(--left-rail)` and `var(--right-rail)`.

That works exactly as long as the rails hold those widths, which is the thing
this wave ends. And the numbers had already drifted: `TracklistPanel` and
`AdvancedMenu` were still hardcoding `280px` rather than reading the variable
ISSUES.md said they read, so changing `--right-rail` alone would have desynced
the rail from the panels inside it.

So the bar moved **inside** the central column. `<main>` is now a left rail, a
`.centre` column holding the bar above `.center-scroll`, and a right rail. The
alignment is structural: the bar spans the central pane because it _is_ a child
of the central pane, and no collapse can put the two out of step. The grid is
gone, the spacers with it, and the two panels now read the variable.

The bar deliberately sits **outside** `.center-scroll`, so the existing 680px
view floor still scrolls the wheel on a narrow window without dragging the
transport sideways with it.

## Collapsing clips; it never unmounts

`Playlists`, `Filters` and `Genres` are plain `<details>` with no bound `open` —
their fold state lives in uncontrolled DOM. An `{#if}` around the left panel
would have silently reset all three every time it was put away, and lost its
scroll position with them.

So each rail is a clipping wrapper: `overflow: hidden` at the rail's width,
`width: 0` when collapsed, with the panel inside keeping its own width. Nothing
reflows, nothing is destroyed, and a collapse changes exactly one number.
`inert` on the wrapper keeps what is clipped out of the tab order — verified,
along with the fold state and the scroll position surviving a round trip.

## The buttons position themselves against the seam

All three are absolutely positioned against `.centre`'s own edges, translated
back by half their size so they straddle the boundary. Those edges _are_ the
panel boundaries in every combination of collapses, so no button has to know a
rail width and none has to be recomputed. The top one is the same trick a level
down: `top: 100%` of the player slot is the bar's lower edge while the bar is
showing and — the slot being zero-height — the ribbon's lower edge when it is
not.

The one exception is a collapsed rail, where the seam is the window edge and
half the button would hang outside it. Those dock inside instead.

The chevron points the way the panel will go, so the button reads as an
instruction rather than a state. `aria-expanded` + `aria-controls` rather than
`aria-pressed`: this is a disclosure for a region that is still in the DOM.

## Hiding the bar suspends the session; it does not end it

The top panel has no flag of its own — `audioPreview` is it. One switch, because
a bar you cannot see is a bar you cannot stop, and v28's teardown of the
AudioContext is the right behaviour for that.

But the session is not the sound. What was pinned, what was clicked, where each
deck stood and where the fader sat are snapshotted before the graph goes, and
handed back when the bar returns — **paused** where they were. A track that left
the library in the meantime is dropped by `reduceDecks`'s own `library` case,
which is the same pruning a real import gets; nothing new was invented for it.

The restore's one subtlety is the seek. `currentTime` before `loadedmetadata` is
unreliable — the element has no duration to clamp against — so the position is
parked in a `pendingSeek` and consumed on the existing `meta` deck event. It is
cleared by a user seek, by a `clear` effect and by a new selection, and swapped
along with `materialised` on a promote.

Rebuilding the graph on the way back in is legal because showing the bar is
itself a gesture. When nothing was suspended — a project load, a first switch-on
— the function returns before touching the engine, so the pre-v30 property that
no context exists until a click pays for one is preserved exactly.

## Advanced → View

**Preview** grew into **View**: three checkboxes, one per panel, with the
music-folder control still nested under the top one. Its section id changed from
`audio` to `view` and deliberately did **not** keep the old one the way v11's
`filters`→`tracks` merge did — the section's contents genuinely changed, so an
old save's fold memory for the narrower thing is not memory of this one. It
costs one click, once.

The right-panel row carries a hint that it takes effect once Advanced closes.
That is the ⚙ override Michiel chose: Advanced borrows the right rail, and the
borrow wins, because pressing ⚙ has to produce a panel whether or not the rail
was put away. Its margin button steps aside entirely while Advanced is showing —
⚙ and Escape already close that.

## The chip answers to the bar, not to the rail

The folder/coverage chip was locked to the right rail's width. It now sits in a
CSS container query on `.player`, so it writes itself out when there is room and
shrinks to a bare `✓` / `⚠` / `Link…` when there is not — whatever it drops is
already in the ⓘ and the `title`, and the ⓘ is now unconditional in the bar
because in the short form it is the only place the numbers are.

Vertically, the rule Michiel asked for is that the bar's height depends on
whether one track is showing or two, and on nothing else. Two things broke it:
the scan block stacked its label above the progress bar (making the bar taller
for the length of a folder walk — it is a row in the bar now), and the empty
deck's hint wrapped onto a second line in a narrow bar (it truncates like every
other line in the row now).

## What the narrow window turned up

With both rails showing at 860px the central column is 330px, and the deck row's
`flex: 0 0 22ch` label could not shrink — so the lock button was pushed clean out
of the bar and painted over the right-hand panel. The label is `flex: 0 1 22ch`
now, which still lines deck A's and deck B's seek lines up (both shrink against
the same width), and `.decks` clips as a backstop. This predates v30; the bar was
simply never that narrow before, because it used to be as wide as the window.

## Declined

- **Animating the collapse.** The wheel re-rasterises on every layout frame, and
  v29 spent a whole workstream keeping main-thread work off the audio thread. An
  animated collapse under a playing deck is exactly that work. Instant.
- **Keyboard shortcuts.** Michiel's call. The hotkey set stays deliberately small.
- **Hover-revealed buttons.** Cleaner at rest, invisible to a first-time user.
- **Moving Advanced out of the right rail.** It would end the competition for
  that column, but it is a different wave.
- **A schema bump.** Both new fields are additive booleans whose default is the
  layout every earlier save was written from, so an old save resolves to it with
  no migration. They join `theme` and `audioPreview` as chrome: excluded from
  Cmd+Z, surviving "Return to default settings", and passed through the easy-mode
  overlay.

## Verified in the browser

Three Playwright probes against a real import, a real music folder (mp3, FLAC and
a deliberately unplayable AIFF) and the sample collection: 18 + 20 + 13 checks,
zero console errors.

Geometry to 1px in every combination — bar flush with the central pane with both
rails open, with one collapsed, with both. The chip long at 1440px and short at
820px with the bar's height identical either way, and its ⓘ escaping the bar's
new `overflow: hidden` (fixed positioning, no transformed ancestor). Play, hide,
show: the same deck, the same position, paused. The ⚙ override in both
directions. A collapsed panel surviving a reload. Two decks exactly one row
taller than one. The tour replayed with all three panels put away — every step
spotlights a real element, and all three go back to collapsed at the end.

Two robustness fixes fell out of that last one. `TourOverlay` re-measures on a
panel change (it watched only step changes, resize and scroll), and a zero-size
target now falls back to the plain dim: `getBoundingClientRect()` on a clipped
element is all zeros, not null, so the spotlight used to become a 12px hole in
the top-left corner.

## Testing shape

`src/core` gained no new module — there is no new pure logic here, only new
state and new layout. The state is covered where the repo already covers it:
`tests/persist.test.ts` (both fields in the byte-identical round-trip fixtures
with opposite values, plus missing-key and garbage cases), `tests/reset.test.ts`
and `tests/effective.test.ts`. Everything else is DOM-bound, and vitest runs
`environment: 'node'` with no component tests at all, so the browser pass is the
gate — the same division v28 and v29 used.
