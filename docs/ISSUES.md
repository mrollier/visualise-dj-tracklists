# Issues — open

What is known to be wrong or unfinished today. Every item was re-checked
against the code on 2026-09-30 (v41); anything fixed, obsolete or purely
historical was dropped. Resolved items, decision records and older review
notes live in git: `git log -p -- docs/ISSUES.md`. Item numbers cited by older
design docs and code comments (for example "v32 #74") refer to that history.

Items marked **(Wave B)** are scheduled in the v41 plan.

## Performance ceilings (deliberate; keep the upgrade paths)

- Combo computation is O(n²) on the main thread (`src/stores.ts`, ponytail
  note). **(Wave B)** replaces the materialised edge list with a lazy graph; a
  Web Worker plus candidate bucketing stays the next step if that is not
  enough.
- Same-slot wheel layout is O(m²) and the wheel draws one SVG node per track
  (`src/core/layout.ts`, ponytail note). **(Wave B)** guards large visible
  counts; canvas or level-of-detail rendering is a separate product decision.
- The genre pack (440 KB after v41) is imported eagerly into the entry chunk
  (`src/core/genre.ts`). Deferring it needs a readiness gate, because the
  matchers are synchronous derived stores. Measure first paint on real
  hardware before spending this.
- `music-metadata` is imported dynamically for one ID3 read
  (`src/lib/TopBar.svelte`) but ships about fifteen parser chunks; check for a
  narrower entry point.

## Tour and app start-up

- The tour forces `uiMode: 'advanced'` (`src/lib/tour.ts`), but `endTour`
  restores only the three panel switches. An easy-mode user who picks "Keep
  this demo" is left in, and autosaved in, the advanced UI.
- `endTour(true)` restores through `applyProject`, which never resets
  `rightPanel`, so an Advanced panel opened during the tour stays open in easy
  mode with its toggle hidden.
- The tour's saved panel switches (`panelsBefore`) live in module memory. The
  autosave no longer writes during the tour, so a reload is harmless, but the
  state still does not survive one.
- `startTheme`, `startAutosave`, `startUndo` and `startPlayer` subscribe with
  no teardown (`src/App.svelte`), so HMR double-subscribes and `startTheme`
  stacks `matchMedia` listeners.
- `TourOverlay` keeps window resize and capture-phase scroll listeners for the
  whole session, so every panel scroll calls `measure()` for a tour that is
  almost never running.
- The coachmark height is a fixed 195 px guess (`TourOverlay.svelte`), so a
  taller step overflows the viewport and hides Next/Done.

## Suggestion engine

- The `avoidSameArtist` penalty can steer the greedy walk into a dead end and
  end it early, contradicting the doc comment in `src/core/suggest.ts`.
- `SAME_ARTIST_PENALTY` (4) sits below `MUST_INCLUDE_BONUS` (5), so an
  essential by the same artist takes the colliding slot although slot
  reservation already guarantees it a later one. The bonus's comment also says
  it is "strictly above the maximum matched-criteria score (4 criteria)", but
  energy is a fifth criterion, so a full match plus the genre/BPM sweeteners
  can now outrank it.
- In a two-arm walk, `startExtra`/`endExtra` score the artist only against
  their own tip, so the seam slot can go to a track that collides with the
  other arm.
- The hub adds a second `scoreCandidate` for the successor, which puts its
  artist penalty on about twice the scoring scale: half as strong there.
- The artist term is hand-summed into four `extra` builders, so each new
  per-transition preference must be copied four times. A merge must keep
  `rand()` consumption unchanged.
- `randomStart` calls `neighbours(id)` for every track just to test its
  length, allocating an (n−1)-element array per track on the complete graph.
  **(Wave B)**
- `sameArtist` re-normalises the current tip's artist once per candidate;
  once per step would do.
- The engine defaults `avoidSameArtist` to false while the app ships true
  (`src/core/settings.ts`), so a new caller or test gets the opposite of the
  product.
- The hub seeds with `Math.random()` (`src/lib/WheelView.svelte`) while ✨
  starts at seed 0, against the "every suggestion is reproducible" doc in
  `suggest.ts`. Hub bug reports cannot be reproduced.
- The test "hub weighs both sides of the seam" is vacuous
  (`tests/suggest.test.ts`): only the two non-Alpha tracks are left as
  candidates.

## Combo criteria

- `toggleDemanded` does not enforce demanded ⇒ enabled
  (`src/core/combos.ts`), and `migrateCriteria` loads
  `{enabled: false, demanded: true}` as is, so re-enabling brings a criterion
  back already locked.
- With every criterion off, the panel reads "Require 0 of 0" while
  `RatingBoxes` shows one box, and clicking it to 0 turns every visible pair
  into a combo.
- A cleared `<input type="number" bind:value>` writes `null` into criteria and
  settings (`CriteriaPanel.svelte`, `AdvancedMenu.svelte`); the BPM tolerance,
  for example, silently becomes exact-only, and the null is saved.

## Filters and marks

- `colourChipOptions` compares colours case-sensitively while the filter
  lowercases (`src/core/filter.ts`), so a case mismatch shows a phantom
  out-of-scope chip.
- `audioQuality` classifies ALAC in `.m4a` (and WMA Lossless) as lossy, so the
  lossless filter drops those tracks.
- The genre checklist compares case-sensitively (`GenresSection.svelte`) while
  the filter lowercases, so a save with different casing shows every box
  unticked while still filtering.
- A playlist toggle issues one `filters.update` per numeric row
  (`FiltersSection.svelte`), running the combo pass several times per click.
- Filter ranges are seeded only when `$library` changes, so descriptor rows
  seeded before an analysis file arrives stay blank until ↺ is pressed.
- `PANEL_FILTER_KEYS` and `PANEL_FILTERS` are two hand-kept lists
  (`src/core/marks.ts`); persist whitelists from one and back-fills from the
  other.
- `toggleFilterVisible` and `togglePanelVisible` are near-duplicates that have
  already drifted (`AdvancedMenu.svelte`).
- The Advanced panel's window Escape handler is unguarded, so an Escape meant
  for a dialog or pinned tooltip also closes the panel.

## Persistence, undo and constellations

- `shortenLegacySetName` runs on every load with no version gate, so a set the
  user named "Constellation 3" becomes "3".
- `migrateCriteria` copies numbers and booleans with `??`, so a hand-edited
  `maxPercent: "12"` reaches the engine as a string.
- `sanitizeProject` does not dedupe playlist names while `PlaylistsSection`
  keys its `{#each}` on the name, so a duplicate in a loaded project throws
  `each_key_duplicate`. The Rekordbox importer already dedupes.
- A no-op `tracklist.update` (appending a track already there, a drop that
  moves nothing) still clears `generated`, which drops the ✨ badge and can
  disable ✨ at `MAX_SETS`.
- Undo restores `settings.visibleFilters` but not `filters`, so Cmd+Z after a
  header ★ toggle can hide the row of a filter that is still active.
- Undo treats `colorScheme`, `trackColumns` and `hiddenColumns` as tuning, so
  Cmd+Z repaints the palette and reshuffles the table.
- Opening a project `.json` never resets the undo stack unless the active set
  id changes, so re-opening the same file lets one Cmd+Z apply pre-load state.
- `ConfirmDialog` clears `onConfirm` only on confirm, so a cancelled load keeps
  the whole parsed project alive.
- A non-Rekordbox `.txt` import reads the file twice (`TopBar.svelte`).

## The wheel

- Zoom-layer label fonts are fixed px while radii divide by `zoomK`, so labels
  grow up to 8× and collide at high zoom.
- Only `hubSuggest` waits for the reveal; `addToTracklist`, the `+` key,
  `hubRetry` and `hubReset` still fire mid-cascade.
- The retry ring renders and spins mid-reveal (`hubRetryState` has no reveal
  gate), and `hubRetry` has no busy guard.
- Folding `!hubBusy` into `hubForce` strips an earned force state on every
  generate and replays an unrequested double pulse.
- `hoveredNode` linear-scans `paintedNodes` instead of using `walkNodeById`,
  and so misses ghost walk stars hidden by filters.
- The four-way hub state is written out three times and has drifted (busy plus
  all-used never says the constellation is complete); `hubBusy` is an alias of
  `revealing`, which WheelView and TracklistPanel each derive separately.
- Keyboard focus on a dimmed star is nearly invisible: the focus ring sits
  inside a group at opacity 0.12.
- `walk-glow` hardcodes `brightness(1.7)`, which fades instead of flaring in
  the light theme.
- Popover and dialog shadows are dark-only literals repeated in five files; a
  per-theme `--shadow-popover` token fixes both problems.

## Constellation panel

- The ⚡/🎤 notes survive a hand-edit of a full-length walk (the clearing
  effect requires `shortSnapshot !== null`), and after a full clear they read
  "of −1" above the empty state.
- The 🎤 note checks the live `avoidSameArtist` setting while its count came
  from the generating run, and the drift guard ignores settings.
- Row and gap drag handlers accept foreign drags and paint an insertion line
  nothing clears; an early return on `dragIndex === null` fixes it.
- The list-level drop applies the last-hovered gap rather than the release
  position.
- The ⚡ offer waits out the whole cascade, and pressing ✨ or `s` meanwhile
  rolls a fresh seed and discards the short-walk snapshot.
- The pinned ⏮/⏭ indicator relies on `color`, and the glyphs carry no VS15
  (`src/core/pins.ts`), so it is invisible where they render as colour emoji.
- The pin's `onmousedown` `preventDefault` papers over `.actions` switching
  from `display:none` to `inline-flex`, and blocks row drag from the pin in
  Firefox.
- Gating the verdict notes on `settled` moves the list shift to when the user
  starts reading; the two notes use inconsistent guards, and `cancelDrag`
  duplicates `endDrag`.

## Genre map, tooltips and genre data

- Genre nodes have `role="button"` with `tabindex="-1"`, so selection and pair
  comparison are mouse-only and the Enter handler is dead.
- `legendClasses` derives from `positioned`, which changes every simulation
  tick, although it depends only on the labels.
- The node `onmousedown` `stopPropagation` does nothing under Svelte 5 event
  delegation; the zoom filter is what blocks the pan.
- `InfoTooltip`'s `onblur` unmounts it when tabbing into its own content, and
  a pinned tooltip never repositions on scroll.
- `genreComponents` falls back to the raw label when splitting yields one part,
  so "House," becomes `house,` and matches nothing.
- The demo's `genreEnergyBaseline` matches raw genres instead of normalised
  ones (`src/data/enrich.ts`), so Liquid Funk and Neurofunk outrank their Drum
  & Bass parent.
- Demo `lastPlayed`/`dateModified` can land in the future and are independent
  of each other.

## Genre pack builder (scripts)

- The builder's `cleanLabel` has drifted from the runtime `cleanupGenre`; the
  pack still carries keys the runtime never emits, such as
  `contemporary r & b`.
- `--dims` is parsed with `Number()` and never validated, so a missing value
  silently writes a pack with no neighbours.
- `--sweep` re-runs the full Jacobi decomposition per dimension; hoisting it
  makes the sweep about 5× cheaper.
- In `scripts/genre-pack-lib.mjs`, `jacobiEigen` has an absolute epsilon and no
  convergence signal, `tripletAccuracy` can divide by zero, and
  `mutualProximity` divides by n−1.
- `embedRows` can return fewer dimensions than requested while `writePack`
  records the requested number.

## Import and export

- The M3U `#EXTINF` regex requires an integer duration and a comma, so
  fractional or comma-less lines lose their metadata and create duplicate
  placeholders.
- Unmatched M3U entries without `#EXTINF` get a case-folded title.
- The M3U report counts only new placeholders and files "not found" under
  errors instead of notes.
- Poster: keyless badges stack off the canvas, `libraryName` is not clipped,
  `padStart` spaces collapse in SVG text, and the default date is the UTC date
  (`src/core/exporters/portrait.ts`).
- CSV `cell()` does not quote a lone `\r`; headers and values are parallel
  arrays, and the export drops `album`/`dateAdded`, so an export/re-import
  round trip loses metadata.
- In the Rekordbox importer, `bpm`/`year`/`duration` hand-roll the `posNum`
  helper defined just above them.

## Audio preview

- `PlayerBar` linear-scans the library in `titleOf`/`extensionFor`, and
  `emptyHint` re-implements `reasonFor`'s precedence.
- The deck event handler scans the library on every `timeupdate` to recompute
  a duration that changes only on `meta`.
- `reindex`'s empty-library early return does not bump `matchRun`, so an
  in-flight pass can republish stale resolutions after a Reset.
- With no library loaded, `adopt` sets `ready` while `coverage` stays null, so
  `FolderLinkControl` offers "Link music folder…" while `PlayerBar` says the
  folder is linked.
- During a re-link, `source` switches immediately but resolutions publish only
  at the end, so audio plays from the old folder meanwhile.
- `pickerSource`'s `?? 'your music folder'` never fires for an empty relative
  path; it should be `||`.
- `fileFor` and the inline yield are duplicated in both file backends, although
  `sourceStore.ts` already exports `yieldToPaint`.
- `FolderLinkControl` evaluates `fallbackPath` before its guard and recomputes
  `folderHint` over the whole library on every click.

## Analysis

- An analysed key that `normalizeKey` rejects is dropped without a counter, so
  a spelling drift in the analyser would vanish without trace.
- None of the four descriptor columns (arousal, valence, danceability,
  happiness) has been validated against the 18 anchor tracks; only
  danceability has evidence beyond a glance.

## Tooling, tests and deploy

- Nothing runs `scripts/screenshot.mjs` automatically, and CI has no browser
  step, so probe assertions rot between manual runs.
- Two probe checks no longer test what they claim: "folded on first open" runs
  after earlier blocks opened the panel, and "first toggle from dark system
  theme" runs after the theme was toggled twice.
- There is no component-test harness (vitest runs in `node`) and no coverage
  report.
- `src/lib/{tour,viewZoom,theme,marquee,portraitPng}.ts`, `fsaSource.ts`,
  `pickerSource.ts` and `handleStore.ts` have no tests; the M3U8 and
  empty-playlist fixtures are used only by the probe.
- `scripts/build-genre-embedding.mjs` and `scripts/render-icons.mjs` are
  untested and outside every tsconfig.
- `index.html` uses root-absolute asset paths while the manifest and service
  worker are relative and Vite sets no `base`, so the PWA breaks under a
  subpath. Commit to root-only or go fully relative.
