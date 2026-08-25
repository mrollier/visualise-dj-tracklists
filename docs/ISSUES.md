# Issues — open

The whole-repo code-clean wave resolved in **v32** (branch `v32-code-clean`,
[designs/design-v32-code-clean.md](designs/design-v32-code-clean.md)) — the
second hygiene pass after v14.1's, and the first to raise more findings than
it could safely fix — on top of Michiel's six-item constellation review
resolved in **v31** (branch `v31-constellation-review`), on top of the three-panel collapse wave resolved
in **v30** (branch `v30-collapsible-panels`), Michiel's ten-item review of the
audio preview resolved in **v29** (branch `v29-player-review`), the permanent
filter-group wave resolved in
**v23** (branch `v23-filter-group`), the Tracks-header visibility defect
resolved in **v22** (branch `v22-tracks-header`), both constellation-edge
defects resolved in **v21** (branch `v21-edges`), the two wheel-animation
defects resolved in **v20** (branch `v20-motion`), the five z-order
paint-order fixes shipped in **v19** (branch `v19-zorder`), the eleven
items from Michiel's UX review of v17 shipped in **v18** (branch
`v18-ux-wave`), the legal item plus five UX defects from that pass
resolved in **v17** (branch `v17-ux-review`), the 13-item live review
resolved in **v16**, the v14 UI review resolved in **v15**, and all
nineteen v13 items resolved in **v14**
([designs/design-v14.md](designs/design-v14.md) has the older per-issue notes).
Each "Resolved" list records what actually shipped.

## Open — v19 z-order review

One item from a review of SVG rendering in WheelView.svelte carries over:
the wheel's paint order itself is fixed now (see Resolved in v19 below), but
labels still don't counter-scale under zoom.

1. **Fonts don't counter-scale under zoom.** At high zoom (k up to 8), node
   radii divide by the zoom factor but font sizes don't, causing labels to
   grow up to 8×, collide with the rim, and crop at the viewBox.

## Open — tooling

All three of the `scripts/screenshot.mjs` defects this section carried since
v20/v22/v23 are fixed in **v32** — along with eleven more the script had
accumulated, and the missing try/finally that turned every one of them into a
silent hang rather than a reported failure. See `## Resolved in v32` below.

What is left of this section is the part v32 could not settle: after the
repair the script reaches the hub/constellation block instead of dying at step
three, and reports nine failures that each need adjudicating as live defect or
stale expectation. They are item 1 of `## Open — v32 code review` below,
together with the two assertions that no longer test what their comments say
they test.

## Open — v32 code review

The whole-repo review recorded in
[designs/design-v32-code-clean.md](designs/design-v32-code-clean.md) raised
181 findings across fourteen slices. The forty-seven that were safe to change
are folded into the thirty-four entries under `## Resolved in v32`; these 134
are the rest, grouped by subsystem and ordered so the reachable data-loss ones
come first.
Nothing here was judged safe to change in a hygiene wave: each either changes
behaviour, touches a persisted schema, changes what is on screen, or needs a
decision that is Michiel's rather than the reviewer's.

**Severe — reachable data loss or a dead control**

1. **A second `startTour` during the tour is guarded now, but the panel
   switches are still module memory.** `panelsBefore` (`tour.ts:48`) lives in
   a module variable while the switches it captures are written straight into
   the autosaved `settings`. Reload or close the tab mid-tour and `endTour`
   never runs: `audioPreview` — a default-off feature that spins up an
   AudioContext — is left permanently on with nothing that knows to revert it.
   `TOUR_SEEN_KEY` was deliberately kept outside the project autosave for
   exactly this class of problem.

2. **`enterDemoView` forces `uiMode: 'advanced'` but `endTour` reverts only
   the three panel switches.** `uiMode` is not in `PanelSwitches`
   (`tour.ts:51`), so an easy-mode user who replays the tour is dumped into
   the full Advanced UI they deliberately put away, and it is autosaved. The
   revert is a hand-written per-field ternary trio rather than a loop over the
   captured keys, so a fourth forced field will drift out the same way.

3. **Reconnecting a remembered music folder deletes the grant it is trying to
   use.** `reconnect()` (`sourceStore.ts:177`) walks the whole directory tree
   before it asks for permission, so `entries()` rejects on the still-`prompt`
   handle and the catch runs `forgetFolder()`, which wipes `pendingHandle` and
   the stored handle. Reconnect can never succeed. Even read charitably,
   `ensurePermission()` on the next line runs after a multi-second awaited
   walk, by which time transient user activation has expired. Permission must
   be requested first, inside the gesture.

4. **A failure while picking a NEW folder tears down the working one.**
   `linkFolder`'s blanket catch (`sourceStore.ts:136`) calls `forgetFolder()`,
   so a network volume dropping mid-walk — or `saveRootHandle` rejecting —
   removes the previously linked folder from memory and from IndexedDB.
   `adopt` has not replaced `source` yet at that point, so the old grant was
   still perfectly usable.

5. **A late duck timeout kills the crossfader for the rest of the session.**
   `dispose()` (`engine.ts:299`) zeroes the `ducks` counters without
   cancelling the pending `whileSilenced` timeouts. A timer that fires after
   it decrements to −1, so the `=== 0` test never passes again, `commandGain`
   never calls `rampTo`, every gain sits at the GainNode default of 1 and
   `applyGains(0, 1)` cannot mute the unpinned deck. Only another `dispose`
   resets it. The fix is tracking and clearing the in-flight timers, not just
   resetting the counters.

6. **A track that fails to resolve leaves the previous one playing under a UI
   that says it stopped.** The `load` effect (`playerStore.ts:152`) resets the
   deck UI and schedules a preload but never touches the media element, so
   when `materialise` returns false the element still holds the old blob URL
   and is still audible. Clicking the same track again is a reducer no-op, so
   there is no retry — only a third track stops the sound.

7. **A stale `deckError` permanently disables a deck's transport.**
   `materialise` never clears it on success (`playerStore.ts:188`), and
   nothing clears it when a reindex re-resolves the track as playable. The
   only writers of `null` are `resetDeckUi` and `suspendPreview`, so re-
   linking the correct folder leaves the play button greyed out with "file not
   found in …" over a track that now resolves fine.

8. **Unpinning a deck can replace the track you kept.** The `promote` handler
   (`playerStore.ts:129`) swaps `materialised` and `pendingSeek` but not
   `wanted`, `preloadTimers` or `busy`, so a pending load aimed at the
   discarded deck lands on the promoted element and tears down the pinned
   track mid-listen. The underlying shape is the problem: per-deck state is
   spread over five records plus four stores, and promote has to remember each
   one. One `DeckRuntime` object per deck would make promote a destructuring
   swap and this class of bug unrepresentable.

**Suggestion engine**

9. **`avoidSameArtist` can make a walk stop short, and it defaults ON.** The
   penalty is applied to the immediate step, but the greedy walk can be
   diverted into a cul-de-sac and end early — verified against a four-node
   graph where the preference turns a full-length walk into one two short,
   popping the ⚡ offer. `suggest.ts:70`'s own doc says the preference "can
   never cut a walk short"; that holds for the step, not the path.

10. **`SAME_ARTIST_PENALTY` (4) sits below `MUST_INCLUDE_BONUS` (5).**
   `suggest.ts:118`. A must-include track by the current tip's artist is
   pulled into the colliding slot even though slot reservation (`pending.size
   >= slotsLeft`) already guaranteed it a later, clean one. The bonus is only
   a bias; the reservation is the guarantee, so ranking it above the penalty
   defeats the preference without buying safety.

11. **A two-arm walk never scores the artist against the other arm's tip.**
   `suggest.ts:486`. `startExtra` compares only against the start tip, so a
   candidate that collides with the pinned closer is unpenalised there, and
   `chooseStart` breaks the tie in the start arm's favour — the seam slot goes
   to the colliding track. `towards()` already establishes the look-at-the-
   other-tip pattern for genre.

12. **The hub applies the same flat penalty on roughly twice the scoring
   scale.** `suggest.ts:729`. `suggestNext` adds a full second
   `scoreCandidate` for the successor side, giving ~9.2 of spread where the
   constant was calibrated against `suggestWalk`'s ~4.6, so the preference is
   about half as strong in the hub as in the generator.

13. **The artist term is hand-summed into four separate `extra` builders**
   (`suggest.ts:401`, `:486`, `:492`, `:725`), the fourth differing in shape.
   The seam blindness above is a direct consequence, and the next per-
   transition preference multiplies the copy again. Note v14.1's non-goal: any
   merge must prove `rand()` consumption is unchanged.

14. **`buildNeighbours` runs an O(degree) `Array.includes` scan per edge
   insertion** (`suggest.ts:246`) although `computeEdges` already emits each
   undirected pair exactly once, so the guard can never fire on that pass. On
   a large library at a low threshold this is seconds of blocking work on
   every ✨ press.

15. **`randomStart` calls `neighbours(id)` for every track purely to test
   `.length > 0`** (`suggest.ts:271`). Under the complete-graph branch that
   allocates an (n−1)-element array per track — ~100M element copies for a 10k
   library — before picking a single opener.

16. **`artistTerm` re-normalises `current.artist` once per candidate instead
   of once per step** (`suggest.ts:351`), so a forced step in a 10k library
   performs ~20,000 trims/lowercases/regex replaces where 10,001 would do.

17. **`toggleDemanded` does not enforce `demanded ⇒ enabled`.**
   `combos.ts:393`. `parseProject` reads `demanded` independently of
   `enabled`, so a save carrying `{enabled: false, demanded: true}` loads
   intact and a later re-enable comes back already locked — contradicting the
   comment's "a re-enable must come back unlocked".

18. **The "hub weighs both sides of the seam" test is vacuous.**
   `tests/suggest.test.ts:1326` passes with `avoidSameArtist: false` and would
   pass if the successor-side branch were deleted: `used` already excludes
   every alternative, so the assertion is unconditionally true. A pool with a
   third same-artist track still available would actually exercise it.

**Filtering, marks and properties**

19. **`colourChipOptions` compares colours case-sensitively while
   `passesProperty` compares them lowercased** (`filter.ts:271`), so a stored
   `0xff007f` against a library spelling of `0xFF007F` renders the colour
   twice — once in scope and once as a phantom "dropped out of scope" chip.

20. **`audioQuality` classifies Apple Lossless in an `.m4a` container as
   lossy** (`filter.ts:50`): `LOSSLESS` matches only the literals
   `alac`/`apple lossless`, and Rekordbox writes the container name ("M4A
   File"). Filtering to lossless silently loses every ALAC track. Same for WMA
   Lossless.

21. **`genreFamilyClasses` guards on the pre-cap family count**
   (`iconClasses.ts:104`), so `maxGenreClasses = 1` returns a one-class legend
   with every node a circle. Both sibling icon modes return `null` for the
   same input.

22. **`playlistClasses` keys its class map by playlist NAME**
   (`iconClasses.ts:133`). The Rekordbox importer de-dupes names, but
   `persist.ts:509` reloads saved playlists with no dedupe pass and
   `stores.ts:531` selects by name, so two selected playlists sharing a name
   collapse into one class — and can drop the count below two, which returns
   `null` and removes every node shape from the wheel.

23. **`bestPair` defaults to `[0, 0]`** (`genreClasses.ts:48`): if no pair
   ever beats `best = -1` the merge self-merges cluster 0 and then deletes it,
   dropping every label it held into unclassed circles. Reachable the moment a
   similarity method can return NaN.

24. **`PANEL_FILTER_KEYS` and `PANEL_FILTERS` are two parallel hand-maintained
   lists** (`marks.ts:30`) — exactly the drift `PANEL_FILTERS`' own doc says
   it eliminated. `persist.ts` builds its whitelist from one and back-fills
   from the other, so a row in one and not the other is silently dropped from
   every saved `visibleFilters`.

25. **`sortTracks` pays for collator negotiation on every comparison**
   (`trackSort.ts:65`): `String(va).localeCompare(String(vb), undefined,
   {sensitivity:'base'})` runs ~130k times for a 10k library, and passing an
   options object defeats the engine's fast path. There is no cached
   `Intl.Collator` anywhere in `src/`.

26. **`familyOfLabel` never caches a null result** (`iconClasses.ts:99`), so
   `genreFamilyOf` re-walks the genre tree once per TRACK rather than once per
   distinct label — on a derived that re-runs whenever the scoped library,
   playlists, filters or settings change.

27. **The genre similarity matrix computes both `(a,b)` and `(b,a)` plus the
   diagonal** (`genreClasses.ts:37`): L² calls where L(L−1)/2 distinct values
   exist, on the costliest similarity path.

28. **`pairKey` concatenates two labels with no separator**
   (`genreMap.ts:18`), so `pairKey('ab','c')` and `pairKey('a','bc')` collide.
   Latent — zero collisions across the 114 curated labels — but genre labels
   are the user's own strings, and a collision silently promotes an unrelated
   edge to the compare-pair tier.

29. **`freshFirstSet` stores the caller's array by reference**
   (`sets.ts:112`), so a `TrackSet` in the store can alias a caller-owned
   array; a later mutation changes the active set in place without notifying
   Svelte. Every other constructor in the module is value-returning.

30. **A stale genre list makes unticking a genre enable them all.**
   `GenresSection.svelte:17` compares `next.length >= $scopedGenres.length`,
   and nothing resets `filters.genres` on a playlist switch, so a three-item
   selection against a two-genre scope writes `null` — the opposite of the
   user's click. `genreSummary` shows the state as "3/2" beforehand.

31. **`activeGenres` compares case-sensitively while `applyFilters`
   lowercases** (`GenresSection.svelte:25`), so a save whose casing differs
   from the library's first-seen spelling renders every checkbox unticked
   while the filter is active — and ticking one appends a duplicate case pair.

32. **Clearing a number input writes `null` into the store.**
   `CriteriaPanel.svelte:152` (and `:191`, `:254`; `AdvancedMenu.svelte:368`,
   `:528`, `:629`) use `bind:value` on `<input type="number">`, and Svelte's
   `to_number('')` is `null`. `bpmCompatibleRatio` then computes
   `(null/100)*low === 0`, so the BPM criterion silently becomes exact-only —
   and the `null` persists into the save. `persist.ts:354` already sanitises
   these on LOAD; the input path has no guard, and `FiltersSection`
   deliberately avoids `bind:value` for this reason.

33. **`resetToDefaults` leaves an active filter with no row to clear it.**
   `AdvancedMenu.svelte:78` restores `settings.visibleFilters` without
   clearing the property filters that fall out of it, so a typed Artist filter
   keeps hiding tracks with no control anywhere. The confirm dialog promises
   "Filters … are kept" — they are kept and hidden. Every other write path to
   `visibleFilters` maintains the invariant.

34. **The Advanced panel's window Escape handler is unguarded**
   (`AdvancedMenu.svelte:305`), so an Escape meant for a modal `ConfirmDialog`
   or a pinned `InfoTooltip` also closes the whole panel.
   `WheelView.svelte:950` guards its own Escape for exactly this collision.

35. **A playlist toggle fires one `filters.update` per visible numeric row**
   (`FiltersSection.svelte:126`), so one checkbox click runs the O(n²) combo
   pass three times. Batch the resets into one update.

36. **With every criterion disabled the head and the boxes disagree**
   (`CriteriaPanel.svelte:282`): the text reads "Require 0 of 0" while
   `RatingBoxes` renders one filled box, and clicking it sends threshold 0,
   which makes `computeComboView` declare every pair a combo — n(n−1)/2 edges,
   with the label unchanged.

37. **The date branch of `commit` skips `clampRange`**
   (`FiltersSection.svelte:188`), unlike the numeric branch, so an inverted
   date range is accepted and the table empties with no reflect. `clampRange`
   is already generic over `number | string` and ISO dates sort lexically.

38. **`fallbackPath` is evaluated before the guard that would make it
   unnecessary** (`FolderLinkControl.svelte:219`): with a folder already
   linked, a full-library `folderHint` walk runs on every track click and the
   result is discarded.

39. **`folderHint` recomputes `commonAncestorPath` over the whole library
   whenever `preferred` changes** (`FolderLinkControl.svelte:72`), though the
   suggested path depends only on `$library` — 2,000 URL decodes per click on
   a 2,000-track collection. Only the example half depends on `preferred`.

40. **`genrePairCount` runs an O(g²) pass on every library or criteria
   change** (`AdvancedMenu.svelte:194`) — ~11k similarity evaluations at 150
   labels, including on slider drags that cannot affect it, since a collapsed
   `<details>` still renders its children. It also reads raw `$criteria`
   rather than `effectiveCriteria`, so easy mode reports a number the wheel
   does not use.

41. **`PlaylistsSection` keys its `{#each}` and its counts Map on
   `playlist.name`** (`:62`), which is not unique — an unnamed NODE yields
   `''`, and a "Club / Warmup" playlist collides with a Warmup inside a Club
   folder. Svelte throws `each_key_duplicate` and the whole left panel goes
   down.

42. **`toggleFilterVisible` and `togglePanelVisible` are the same function
   twice** (`AdvancedMenu.svelte:112`), differing only in the one-line clear
   branch — and they have already drifted: one deletes from
   `filters.properties` inline while the other routes through
   `clearPanelFilter`.

**Genre matching and the pack builders**

43. **`genreComponents` falls back to the raw label when splitting yields one
   distinct component** (`genre.ts:164`), so trailing or repeated separators
   leak punctuation: "House," stays `house,` and "House, House" becomes
   `house, house`. Neither reaches the pack or the tree, so every similarity
   method degrades to 0 and coverage counts the track as outside. Returning
   `parts` when `parts.length >= 1` fixes it.

44. **`genreEnergyBaseline` regex-matches the raw genre instead of routing
   through `normalizeGenre`** (`enrich.ts:90`). Measured against the shipped
   packs: Liquid Funk (11 tracks) and Neurofunk (3) miss the table entirely
   and get energy 9 from the BPM curve — higher than their parent Drum & Bass
   at 8, inverting the intended order. Also affects "Drum and Bass", "Hip-
   Hop", "Trip-Hop", "Psy-Trance", "Two-Step", Funk, 2 Step and Bassline.
   `ALIASES` already canonicalises every one.

45. **`linSimilarity` dereferences `treeIC` for ancestors that were never
   added to the IC node set** (`genre.ts:257`): `nodes` is built from the root
   plus `Object.keys(treeParents)`, so a parent that appears only as a value
   has no entry, `Math.max(lcaIC, undefined)` is NaN, and the pair silently
   stops matching. `genre-tree.json`'s own readme invites editing, which makes
   this a live trap.

46. **Nothing is memoised in `genreSimilarity`/`labelSimilarity`**
   (`genre.ts:412`). The all-pairs combo scan runs ~2.1M calls on a
   2,000-track library, each re-splitting both labels, re-allocating two Sets,
   and for the graph method re-running a BFS. The vocabulary is ~100 labels,
   so the cache would be tiny.

47. **`cleanLabel` in the pack builder has drifted from the `cleanupGenre` it
   says it mirrors** (`build-genre-embedding.mjs:189`): it omits period
   stripping, the en/em dashes in the separator class, and the `r & b` repair.
   The shipped pack already carries the key `contemporary r & b`, which the
   runtime can never emit, and `folk, world, & country`, which the runtime
   always aliases to `folk`.

48. **`--dims` is parsed with `Number()` and never validated** (`build-genre-
   embedding.mjs:368`): a missing or non-numeric value gives NaN, `slice(0,
   NaN)` is `slice(0, 0)`, and the script silently overwrites the pack with an
   entry per label and no neighbours at all.

49. **`--sweep` recomputes the full Jacobi eigendecomposition for each
   candidate dimension** (`build-genre-embedding.mjs:345`) although only the
   truncation differs — the decomposition is the dominant cost, so hoisting it
   makes the sweep ~5× cheaper.

50. **`jacobiEigen` returns no convergence signal** (`genre-pack-lib.mjs:18`):
   the break condition is an absolute `off < 1e-12` that scales with neither n
   nor matrix magnitude, and an exhausted sweep budget returns the partially-
   diagonalised diagonal as if it were the eigenvalues.

51. **`tripletAccuracy` divides by `triplets.length` unguarded** (`genre-pack-
   lib.mjs:225`), so a filtered corpus that leaves no triplets logs `NaN%` as
   a validation score and writes the pack anyway.

52. **`mutualProximity` divides by `n − 1`** (`genre-pack-lib.mjs:149`), so a
   single-label vocabulary produces an all-NaN matrix that is silently dropped
   by the `score > 0` filter — an empty pack with no error.

53. **`embedRows` silently returns rows narrower than the requested dims**
   (`genre-pack-lib.mjs:62`) when too few eigenvalues are positive, and
   `writePack` still records the requested number in both the `dims` field and
   the `_readme`.

54. **The demo library carries dates in the future** (`enrich.ts:190`):
   `lastPlayed` adds up to 600 days and `dateModified` up to 400 to an anchor
   as late as 2025-12-28, so some sample tracks are stamped 2027. `lastPlayed`
   is also independent of `dateModified`, so a track can be played long after
   it was added but modified days later.

**Import and export**

55. **The EXTINF regex requires an integer duration and a comma**
   (`importers/m3u.ts:61`), so a playlist with fractional seconds — what VLC,
   foobar2000 and Traktor all write — loses both the duration and the
   artist/title, fails to match the library, and creates a duplicate bare
   track. `#EXTINF:-1` with no comma fails identically.

56. **The fallback title uses `basenameOf`, which is the case-folded matching
   key** (`importers/m3u.ts:77`), so every EXTINF-less entry enters the
   library lower-cased. The existing test misses it because its fixture
   filename is already lower-case.

57. **`buildReport(newTracks, …)` counts only newly-created placeholders**
   (`importers/m3u.ts:101`), so a 30-entry playlist that matches the library
   entirely reports "0 tracks imported".

58. **The "not found in the library" message is pushed into `report.errors`**
   (`importers/m3u.ts:97`), which the UI renders as a skipped-row count — five
   unmatched entries read as "1 skipped". `ImportReport.notes` exists for
   exactly this.

59. **Keyless walk tracks stack off the bottom of the poster**
   (`exporters/portrait.ts:210`): a fixed 40px stride with no clamp or wrap
   puts badge 15 onward below the 800px canvas and over the footer. This is
   the normal state after importing an M3U with no collection loaded, where
   every track is keyless.

60. **Windows drive-letter locations export as `/C:/Music/x.mp3`**
   (`exporters/m3u.ts:18`), which no Windows player resolves — while
   `location.ts`'s `formatPath` already handles exactly this case for the
   folder hint.

61. **A newline in a title or artist splits one M3U entry into two**
   (`exporters/m3u.ts:17`). The stray line does not start with `#`, so every
   reader — including this repo's own importer — treats it as a track.
   Reachable from a CSV import with a quoted multi-line field.

62. **`libraryName` goes into the poster meta line unclipped**
   (`exporters/portrait.ts:287`) while `setName` is clipped to 26 characters,
   so an ordinary export filename runs past the panel and off the 1200px
   canvas. `clip()` is used one line above.

63. **`padStart(2, ' ')` is a no-op inside SVG text**
   (`exporters/portrait.ts:307`): XML strips the leading space with no
   `xml:space="preserve"`, so rows 1–9 render narrower than 10+ and the titles
   after them do not line up — the exact misalignment the padding was added to
   prevent.

64. **The default poster date is the UTC date** (`exporters/portrait.ts:189`),
   so a poster exported at 01:15 in Brussels is stamped with yesterday.

65. **`cell()` quotes `"`, `,` and `\n` but not a lone `\r`**
   (`exporters/csv.ts:18`), which RFC-4180 readers treat as a record
   separator, splitting the row and dropping its remaining columns.

66. **The CSV header list and value list are two hand-maintained parallel
   arrays** (`exporters/csv.ts:26`), and the export drops `album` and
   `dateAdded` although the importer maps both — so an export/import round
   trip loses metadata. One `[header, accessor]` mapping would fix both
   halves.

67. **`bpm`, `year` and `duration` hand-roll the `posNum` helper defined four
   lines above them** (`importers/rekordbox.ts:97`).

68. **The extension-strip regex is duplicated in four places in two
   inconsistent forms** (`importers/m3u.ts:22`, `importers/id3.ts:22`,
   `TracklistPanel.svelte:48` use `/\.[a-z0-9]+$/i`; `TopBar.svelte:102` uses
   `/\.[^.]+$/`). `location.ts` is the established home for filename folding
   and is already imported by both m3u files.

**Persistence and settings**

69. **A quota-exceeded autosave is swallowed with no signal**
   (`persistence.ts:230`), so the previous, smaller save silently stays as the
   thing that restores next launch. Reusing `serializeProject`'s 2-space
   pretty-print — written for the human-readable file export — makes the quota
   arrive ~1.5× sooner: measured 1.51 MB versus 1.02 MB for 2,000 tracks.

70. **`shortenLegacySetName` runs on every load with no version gate**
   (`persist.ts:294`), so a set the user deliberately named "Constellation 3"
   is rewritten to "3" and re-persisted on every reload. `sets.ts:41` claims a
   name the user chose is never touched; the visibleFilters back-fills next to
   it ARE version-gated.

71. **`migrateCriteria` copies enum and numeric fields straight through with
   `??`** (`persist.ts:136`), so `method: 'bogus'` reaches `labelSimilarity`,
   whose switch has no default clause — it returns undefined and the genre
   criterion silently stops matching library-wide, with no error anywhere.
   `maxPercent: '12'` likewise leaks a string into a numeric field. The
   block's own comment says non-booleans never leak; only `demanded` is
   actually guarded.

72. **The supported-version check is a ten-clause `!==` chain and the literal
   10 appears in four places** (`persist.ts:246`, the `Project` interface, the
   return literal, `persistence.ts:41`). A `PROJECT_VERSION` constant plus a
   range test expresses the rule once.

73. **`avoidSameArtist` defaults to `true` as an app setting and `false` as an
   engine option** (`settings.ts:130` versus `suggest.ts:339`, `:693`), so any
   new caller that omits it — or any test written against the engine defaults
   — gets the opposite of what the app ships.

**State, undo, theme**

74. **A no-op `appendToSet` still clears the `generated` flag**
   (`stores.ts:165`): re-adding the track that is already last writes through
   `writeActiveTrackIds(fn, false)`, so the ✨ badge disappears,
   `canRegenerateInPlace` flips false, the ⚡ window closes and an undo step is
   burned — from an edit that changed nothing.

75. **Undo can hide a filter row that is still filtering.** `tuningOf` keeps
   `settings.visibleFilters` while `filters` is deliberately untracked
   (`undoStore.ts:75`), so Cmd+Z after a header ★ toggle restores the hidden
   row but leaves `filters.marks.starredOnly` true — the wheel stays narrowed
   with no visible control, and in easy or in-set-only mode there is no way
   back at all.

76. **`tuningOf` excludes theme, uiMode and advancedOpen as chrome but keeps
   `colorScheme`, `trackColumns` and `hiddenColumns`** (`undoStore.ts:64`), so
   Cmd+Z repaints the palette and reshuffles the Tracks table — against the
   module doc's own "undo never flips the theme".

77. **"The stack resets on library replacement" rides on `activeSetId`
   changing value** (`undoStore.ts:199`). Svelte's writable suppresses a set
   of an identical string, so re-opening the same `.json` never fires
   `resetUndo`, and one Cmd+Z applies post-save state over the freshly loaded
   document.

78. **`deleteSet` writes `sets` before `activeSetId`** (`stores.ts:231`),
   leaving a synchronous window in which `activeSetOf` falls back to
   `$sets[0]`: `undoStore` records a bogus step attributing the wrong tracks,
   and with a marks filter on, `computeComboView` runs a full O(n²) pass on
   the wrong constellation before the next line corrects it.

79. **Easy mode renders a split palette.** `theme.ts:32` stamps the accent
   variables from raw `settings.colorScheme` while the wheel's node ramp reads
   `effectiveSettings.colorScheme`, which easy mode resets to the default — so
   a violet scheme leaves violet chrome around blue nodes. `colorScheme` is
   pure chrome and belongs in the preserve list next to `theme`.

80. **`effectiveSettings` allocates a fresh object on every settings write**
   (`stores.ts:285`), so toggling a panel or flipping the theme re-runs
   `computeGenreClasses` and `computeFocusEdges` over the whole scoped
   library. The cost is already visible as band-aids — `displaced.ts:63`'s
   `numericMapsEqual` and `WheelView.svelte:375`'s guard both exist to absorb
   it. The local `distinct()` at `stores.ts:311` fixes it at the source.

81. **`endTour(true)` re-enters easy mode through `applyProject`**, skipping
   the `linkArmed.set(false)` / `rightPanel.set('set')` guards `toggleUiMode`
   documents (`tour.ts:100`). Easy mode hides the 🔗 button, so link mode stays
   armed invisibly and the next-but-one wheel click toggles a persisted manual
   combo instead of selecting. `TopBar.svelte:228` guards the other entry
   point.

82. **`startUndo`, `startAutosave`, `startPlayer` and `startTheme` are not
   idempotent and have no teardown.** Each call adds permanent subscriptions;
   `tests/undoStore.test.ts` calls `startUndo` once per test, and it stays
   correct only because `record` no-ops on an identical snapshot. `startTheme`
   additionally registers a `matchMedia` listener from App's component body,
   so HMR double-stamps the document.

**The wheel**

83. **Only the hub is gated on the reveal window.** `hubInert` gates
   `hubSuggest` (`WheelView.svelte:811`), but `addToTracklist` (`:1330`), the
   `+` keydown (`:1334`), `hubRetry` (`:852`) and `hubReset` (`:888`) all
   still fire mid-cascade. `revealPlan` then recomputes every delay while
   `{#key $walkRevealTick}` does not re-key, so running animations keep their
   old delays on re-matched elements. Three booleans on one of five entry
   points is a bandaid; the gate belongs at the shared reveal/mutation
   boundary.

84. **`hubRetryState` has no reveal gate at all** (`WheelView.svelte:826`), so
   the retry ring mounts and — when the neighbourhood is exhausted — spins its
   dash offset while the stars are still cascading in: the exact "speaks
   before the constellation stands still" behaviour v31 #2 set out to fix.
   `hubRetry` also has no `hubBusy` guard, so clicking it mid-reveal bumps a
   second reveal on top of the first.

85. **Folding `!hubBusy` into `hubForce` strips an already-earned force
   state** (`WheelView.svelte:810`), so an exhausted hub flips out of force
   and back on every generate — dropping `.warning`, reverting the label to
   "next", and restarting `hub-pulse` for an unrequested 1.2s double pulse at
   the visual centre of the wheel. v31 #2 needed the recomputation deferred,
   not the state suppressed.

86. **`hoveredNode` linear-scans `paintedNodes`** (`WheelView.svelte:944`)
   although `nodeById` is the same set as an O(1) Map three lines away — and
   `paintedNodes` invalidates on every deck play/pause, selection and hover,
   so the scan runs on unrelated changes, including when `$hoveredId` is null.

87. **Resolving the hover ring against `paintedNodes` misses the case it
   exists for**: a walk member the filters hide renders as a ghost star at a
   real position, but it is not in `visibleNodes`, so hovering its set-list
   row gives no ring. `walkNodeById` (`:622`) is the map built for exactly
   this question.

88. **The four-way hub state is spelled out three times**
   (`WheelView.svelte:1438`): the `aria-label` chain, the `<title>` chain and
   the class/label booleans. They have already drifted — with `hubBusy &&
   hubAllUsed` the announcement says "Drawing the constellation" and never
   mentions the set is complete.

89. **`revealing` is derived by hand in two components and inverted into a
   third spelling** (`WheelView.svelte:675`, `TracklistPanel.svelte:59`,
   `:61`), while `stores.ts:105` grew a reduced-motion short-circuit whose
   entire purpose is to serve them. One exported `walkRevealing` derived next
   to `bumpWalkReveal` would give both views a single source.

90. **`hubBusy` is a pure alias for `revealing`** (`WheelView.svelte:808`) — a
   second reactive node that adds a name but no meaning and a 130-line hop for
   anyone chasing why the hub is dead.

91. **Keyboard focus on an off-criteria star is invisible**
   (`WheelView.svelte:2055`). `.node` sets `outline: none` and its
   replacement, `.node:focus-visible .dot`, is a descendant of a group whose
   `opacity` attribute is 0.12 for out-of-focus nodes, so the indicator
   composites to 0.12 alpha; `.tag-ring` lands at 0.066. v31 #6 identified
   group-opacity multiplication as the bug class and lifted only the hover
   ring out of it — the fix was applied to one element rather than to the
   mechanism.

92. **`walk-glow` hardcodes `brightness(1.7)`** (`WheelView.svelte:1741`),
   which inverts in the light theme where `--walk-bright` (#8a5a00) is
   deliberately DARKER than `--walk` (#a86f00) — so a completed constellation
   fades out instead of flaring.

93. **The tooltip shadow is a hardcoded dark-theme literal**
   (`WheelView.svelte:2205`), `rgba(0,0,0,0.5)`, with no light override and no
   token — and the same literal is repeated at `InfoTooltip.svelte:126` and
   `GenreMapView.svelte:962`, with `rgba(0,0,0,0.6)` at
   `ResetDialog.svelte:36` and `ConfirmDialog.svelte:45`. A `--shadow-popover`
   token per theme removes both the theme gap and the duplication.

**The Tracks view and the constellation panel**

94. **The ⚡ and 🎤 verdict notes survive a hand-edit of a FULL-length walk**
   (`TracklistPanel.svelte:485`). The clearing effect at `:259` is guarded on
   `shortSnapshot !== null`, which is null for a walk that reached its length,
   so the numerator freezes while the denominator tracks the live list — and
   after a full clear both render "of −1", above the empty-state branch that
   would have hidden them.

95. **A drag-drop that moves nothing still clears the `generated` flag**
   (`TracklistPanel.svelte:95`): release a row where you picked it up and the
   ✨ badge goes, `canRegenerateInPlace` flips false, and at `MAX_SETS = 8` the
   suggest button turns off entirely with "All 8 constellations are hand-
   edited". The `if (moved)` guard below is self-defeating.

96. **The 🎤 note's visibility reads the live setting while its count came from
   the generation run** (`TracklistPanel.svelte:494`). `countSameArtist` runs
   unconditionally, so re-ticking "avoid two tracks by the same artist" pops
   in a note describing a walk the preference never influenced — and unticking
   hides a truthful one. Toggling settings does not close the ⚡ window either;
   the drift guard at `:267` watches only the visible library and the
   criteria.

97. **`dragOverGap`/`dragOverRow` accept a foreign drag**
   (`TracklistPanel.svelte:127`): dragging a Tracks-view column header across
   the constellation list paints an insertion line that nothing clears,
   because the drop and `dragend` both land on the foreign source. A
   `dragIndex === null` early return fixes both halves.

98. **The ⚡ offer lags the click by the whole cascade**
   (`TracklistPanel.svelte:234`) — 2.9s for a 15-track walk, up to 4.8s. The
   button morphs under the cursor seconds after the press, and pressing ✨ or
   `s` in the meantime rolls a fresh seed and discards the `shortSnapshot` the
   ⚡ was meant to extend.

99. **The `<ol>`-level drag handlers accept a drop in the list's empty area**
   (`TracklistPanel.svelte:520`) and apply the last-hovered gap rather than
   the release position. Before this change the browser rejected those drops.

100. **The pinned indicator now depends on the glyph resolving to a text-
   presentation font** (`TracklistPanel.svelte:902`): `color: var(--accent)`
   replaced `filter: grayscale(1)`, and Chrome on Windows and Android
   routinely renders ⏮/⏭ as colour emoji, where `color` is a no-op and only
   `opacity: 0.5 → 1` remains. The removed line was the cross-platform-safe
   half.

101. **Cancelling the pin's mousedown default is a per-button bandaid over a
   row-wide layout shift** (`TracklistPanel.svelte:591`): the real cause is
   `.actions` going from `display: none` to `inline-flex` on `:focus-within`
   while `.row` is `flex: 1`. Reserving the arrows' width fixes it for every
   control in the row. Firefox also treats `preventDefault` on mousedown as
   cancelling the native drag, so grabbing the pin to drag a row stops working
   there.

102. **Gating the notes on `settled` reschedules the layout shove rather than
   removing it** (`TracklistPanel.svelte:65`): the `<ol>` still shrinks by two
   lines, now at the exact moment the user starts reading it.

103. **The two verdict notes are copy-paste with inconsistent guards**
   (`TracklistPanel.svelte:494`): the ⚡ note tests `!== null && > 0` while the
   🎤 note tests only `!== null`, though both variables are normalised to null
   when zero — so one check is dead and the denominator bug has to be fixed
   twice. `cancelDrag` likewise duplicates the reset `endDrag` already
   performs inline.

**The genre map and the remaining components**

104. **Genre nodes advertise a control that cannot be operated**
   (`GenreMapView.svelte:569`): `role="button"` and an Enter handler on an
   element with `tabindex="-1"`, so the node-selection and pair-comparison
   feature is mouse-only and the handler is dead code.

105. **The criterion-pair lookup hand-rolls `pairKey`'s encoding without its
   ordering normalisation** (`GenreMapView.svelte:160`), so it is correct only
   by the unstated invariant that `labels` is sorted — while the sibling
   lookup at `:446` calls `pairKey` properly. Re-sorting `labels` for any
   reason silently draws zero criterion edges.

106. **`legendClasses` derives from `positioned`**
   (`GenreMapView.svelte:193`), which the force simulation replaces on every
   tick, so a full loop plus a Map rebuild runs ~60 times a second for an
   answer that depends only on `labels`.

107. **`onmousedown={(e) => e.stopPropagation()}` on genre nodes is inert**
   (`GenreMapView.svelte:576`): Svelte 5 delegates `mousedown` to the app
   root, which runs long after d3-zoom's own listener on the `<svg>`. The
   `createViewZoom` `filter` option is what actually suppresses the pan, and
   its comment says so — leaving the handler in makes a future edit to that
   filter look safe when it is not.

108. **`onpointerup` was the cause of the lost seek, and the same shape is
   worth auditing elsewhere**: any handler that clears a drag flag before the
   input's own `change` event fires will have the value written back
   underneath it.

109. **`InfoTooltip`'s `onblur` makes interactive tooltip content unreachable
   by keyboard** (`:78`): tabbing from the ⓘ to the "Show the guided tour"
   button inside the tooltip unmounts it and drops focus to `<body>`. The
   component's header comment claims links inside stay reachable; that only
   holds for the click-to-pin path.

110. **A pinned `InfoTooltip` never repositions** (`:32`): the positioning
   effect runs only on show, so scrolling the panel leaves the fixed panel
   frozen at the old viewport coordinates. `TourOverlay` solves the same
   problem with resize and capture-phase scroll listeners.

111. **`CARD_H` is a hardcoded 195px guess of the coachmark height**
   (`TourOverlay.svelte:110`); step 4's body wraps to roughly 235px, so the
   card overflows the viewport bottom and the Next/Done row is cut off.

112. **`TourOverlay` installs resize and capture-phase scroll listeners for
   the whole app session** (`:101`) — the effect has no dependencies and the
   component is always mounted, so every scroll of any panel calls `measure()`
   for a tour that is almost never running.

113. **`ConfirmDialog` never clears `onConfirm` on cancel or Escape** (`:23`),
   so the closure — and the entire parsed `Project` it captures on the load
   path — stays retained for the rest of the session.

114. **`PlayerBar` linear-scans `$library` in `titleOf` and `extensionFor`**
   (`:42`, `:82`) although `stores.ts:543` already exports a `trackById` Map,
   and `emptyHint` (`:87`) re-implements the precedence chain `reasonFor`
   encodes — the one thing `reasonFor` exists to make impossible.

115. **`saveProject` duplicates `TracklistPanel`'s `saveBlob` verbatim**
   (`TopBar.svelte:167`), and `portraitPng.ts:6` is a third object-URL path;
   all three files already import from the shared `exportName.ts`, which is
   the natural home. `TopBar.svelte:90` also reads a non-Rekordbox `.txt` from
   disk twice — once as an ArrayBuffer to sniff it, then again as text.

116. **The deck event handler linear-scans the library on every `timeupdate`**
   (`playerStore.ts:345`) — roughly eight times a second with both decks
   loaded — to recompute a duration that only changes on `'meta'`. On a 20k
   library that is 160k string comparisons a second on the thread painting the
   wheel, which is the starvation `engine.ts` blames for mid-track dropouts.

117. **`reindex`'s empty-library early return does not bump `matchRun`**
   (`sourceStore.ts:95`), so an in-flight chunked pass survives a Reset and
   republishes thousands of stale resolutions and a coverage line over an
   empty library. `forgetFolder` bumps it; this path does not.

118. **`adopt` reports ready while the folder control reads it as unlinked**
   (`sourceStore.ts:84`): with no library loaded, `reindex` leaves `coverage`
   null and `sourceState` goes to `'ready'`, but `FolderLinkControl` requires
   both and falls through to the "Link music folder…" button while `PlayerBar`
   says the folder is linked.

119. **`reindex` publishes the new resolution map only at the end**
   (`sourceStore.ts:112`), so throughout a re-link `currentSource()` is the
   new source while `resolutionFor` hands out the old folder's handles — audio
   plays out of the folder the user just moved away from. The `file instanceof
   File` branches in both backends exist because handles can cross sources
   like this.

120. **`?? 'your music folder'` cannot fire for an empty
   `webkitRelativePath`** (`pickerSource.ts:20`), because `''` is not nullish
   — so the user is told `file not found in ""`. `usePickedFiles` gets this
   right with `|| null` two lines later.

121. **`fileFor` is duplicated verbatim between the two audio backends**
   (`fsaSource.ts:78`, `pickerSource.ts:51`), each carrying a branch its own
   backend can never take, and `yieldToPaint` is re-implemented inline in both
   although `sourceStore.ts:51` names it.

**Tooling, the browser probe and the gates**

122. **Nine assertions fail on the revived probe and need adjudicating.**
   After the v32 repair `scripts/screenshot.mjs` reaches the hub/constellation
   block instead of dying at step three, and reports: the hub not appending (8
   → 8) and the three checks that cascade from it; the short-walk stall
   scenario not manifesting; an exhausted anchor not switching the hub to its
   warning state; the ⚡ morph not appearing; 197 nodes drifting under a
   threshold 0→1 change, which the script calls a determinism failure; and two
   playlist-reveal checks. Each is either a live defect or a stale
   expectation, and the difference has to be established one at a time — the
   hub ones in particular smell like leftover script state (a panel pseudo-
   filter left on "only" would make `hubAllUsed` legitimately true).

123. **The "all advanced sections start folded on FIRST open" assertion no
   longer runs on a first open** (`screenshot.mjs:318`): the v14 WS2 block
   above it already opens the panel and toggles a section, so the check now
   only verifies that the script closed what it itself opened.

124. **The "first toggle from the emulated dark system preference" check runs
   after the theme has been explicitly toggled twice**
   (`screenshot.mjs:1665`), so it reads a stored value rather than the
   `colorScheme: 'dark'` emulation the top of the file sets up for it.

125. **`index.html` hardcodes root-absolute asset paths** (`:9`) while
   `manifest.webmanifest` uses `start_url: "."` and `scope: "."` and `sw.js`
   caches relatively. Under any subpath the manifest 404s and the PWA silently
   stops being installable while the service worker still registers. Either
   commit to root-only or make the HTML relative and set Vite's `base`.

126. **CI runs no browser check** (`.github/workflows/ci.yml`), which is why
   eighteen releases of UI drift accumulated in the only end-to-end script.
   Playwright is already a devDependency; the step is waiting on the nine
   failures above.

127. **No coverage is collected anywhere.** `vitest run --coverage` as a
   reported number rather than a gate would at least make the gaps below
   visible.

**Test gaps, ranked**

128. **`src/lib/audio/` is 1,143 lines with no test at all** —
   `playerStore.ts` (375), `engine.ts` (306), `sourceStore.ts` (228),
   `fsaSource.ts` (88), `handleStore.ts` (58), `pickerSource.ts` (54),
   `source.ts` (34). It is the largest untested cluster in the repo and the
   newest code in it, and eight of the severe findings above live there. The
   pure half (`src/core/audio/`) is fully covered, so the seam is already in
   the right place: what is missing is tests for the effectful side, which the
   reducer shape makes tractable.

129. **All 28 `.svelte` files, 10,877 lines, have no test.**
   `vite.config.ts:8` pins `environment: 'node'` and no DOM harness is
   installed. Adding jsdom or Testing Library is a dependency decision; the
   repo's own architecture rule says the answer is extracting logic into `.ts`
   instead, which is a wave of its own.

130. **`src/lib/{tour,viewZoom,theme,marquee,portraitPng,exportName}.ts` — 319
   lines, no test.** `tour.ts` alone holds two of the severe findings above.

131. **`tests/fixtures/playlist.m3u8` and `empty-playlist.txt` are used only
   by the browser probe**, never by a unit test — so the M3U8 and empty-
   playlist import paths have no fast coverage at all.

132. **`scripts/build-genre-embedding.mjs` (374 lines) and `scripts/render-
   icons.mjs` (105) have no test and are in no tsconfig.** Six of the pack-
   builder findings above are in the first of them.

**Bundle and dependencies**

133. **`src/data/genre-embedding.json` is 827 KB and statically imported at
   `core/genre.ts:3`**, so it lands in the eager entry chunk:
   `dist/assets/index-*.js` is 928 KB and essentially IS that file, and first
   paint waits on parsing it — including for users who never touch genre
   similarity. The options are a dynamic `import()` behind first use, moving
   it to `public/` and fetching it, or pruning the pack from top-24 neighbours
   to fewer. All three are architecture calls, which is why v32 measured it
   rather than changing it.

134. **`music-metadata` is dynamically imported once for an ID3 read**
   (`TopBar.svelte:48`) but ships roughly fifteen parser chunks — MP4,
   Matroska, Asf, Musepack, Dsdiff, Dsf, Ogg, Flac, APEv2. Worth checking
   whether a narrower entry point exists.


## Resolved in v32

Branch `v32-code-clean`. A whole-repo hygiene wave, eighteen releases after
v14.1 did the first one: fourteen review slices raised 181 findings, of which
these thirty-four are what was safe to change without altering behaviour, a
persisted schema, or anything on screen. Full method, the tool corrections it
starts from, and the deliberate non-goals are in
[designs/design-v32-code-clean.md](designs/design-v32-code-clean.md); the
remaining 134 findings are in `## Open — v32 code review` above.

1. **Genre, header and format lookups no longer reach `Object.prototype`.**
   The alias table, the genre tree, the neighbour pack, both importer header
   maps and the two audio format tables are plain object literals indexed by
   strings that arrive from user data, so a genre, a CSV header or a file
   extension named `constructor` resolved to an inherited function. Each was a
   crash: `normalizeGenre` returned the Object constructor and took the
   coverage panel down; the CSV header map returned a function, which aborted
   the whole import inside papaparse's `stripBom`; and `formatVerdict` threw
   out of `resolveTrack` into `linkFolder`'s catch, which unlinks the user's
   music folder. Every read goes through `Object.hasOwn`, and the pack's three
   reads share one private accessor so a fourth cannot skip the guard.

2. **Duplicate track ids are dropped on load.** Both track views key their
   `{#each}` on `track.id`, so a repeat in a hand-edited save threw Svelte's
   `each_key_duplicate` and the Tracks table and the wheel stopped rendering.
   First entry wins.

3. **`settings.visibleFilters` is deduped as well as whitelisted on load.** A
   repeat did the same to the left filter panel, which keys its rows on the
   property key. Every in-app write path already guarded with `.includes`; the
   load path did not.

4. **An empty-string track id is rejected.** It collides with the suggestion
   engine's "no successor" sentinel, so a blank-id track in the library made
   the hub score every candidate against a phantom successor. `sanitizeSet`
   has rejected it since v3; `sanitizeTrack` now applies the same rule.

5. **`parseProject('null')` gives the friendly error again.** The version was
   read before the document was proved to be an object, so a truncated or
   wrong `.json` showed the user a raw `Cannot read properties of null
   (reading version)` — TopBar renders `e.message` verbatim. The `isRecord`
   helper already in the file now guards it, and `sanitizeTrack`/`sanitizeSet`
   moved onto it too, so a JSON array no longer passes as a record.

6. **`restoreAutosave` no longer destroys the save it failed to read.** The
   catch called `localStorage.removeItem`, which throws again in exactly the
   environments that made the read fail — site data blocked, Safari private
   mode — and that rejection escaped into App's component body, so the user
   got a blank page instead of an empty-library app. The read is guarded on
   its own now, and a save this build cannot parse is left for the build that
   can rather than deleted.

7. **`resetEverything` clears `manualEdges`.** It is the wider wipe and
   `replaceLibrary` has always cleared them, so orphaned 🔗 edges survived a
   full reset: `hasUserWork()` stayed true over a freshly wiped app, the
   replace-library and replay-tour dialogs fired for work that no longer
   existed, and a save exported edges pointing at ids that were gone.

8. **Artist identity is host-independent.** `normalizeArtist` used
   `toLocaleLowerCase` for what is an identity key, so under tr-TR "IIO" and
   "iiO" did not fold together and the same project with the same seed
   produced a different constellation on a different machine — against
   `suggest.ts`'s own promise that every suggestion is reproducible via its
   seed.

9. **The wheel's fan tie-break is host-independent.** `relaxSlotAngles` broke
   same-radius ties with `localeCompare`, so the angular order of a key's fan
   — and the portrait PNG rendered through the same function — depended on the
   host's collation, in a function documented as deterministic by
   construction. Plain code-unit order is both deterministic and cheaper.

10. **`startTour` is re-entrant-safe.** The replay button stays clickable
   during the tour because the backdrop is `pointer-events: none`, and
   `sampleLoadNeedsConfirmation()` is false over the demo library, so a second
   press overwrote `tourSnapshot` with the demo — and the user's real library,
   already autosaved over, was gone.

11. **`loadRootHandle` no longer throws on browsers without File System
   Access.** `instanceof` always evaluates its right-hand side, and
   `startPlayer` calls `restoreSavedFolder` on every browser, so an undefined
   `FileSystemDirectoryHandle` raised an unhandled rejection at startup. The
   module already guarded `indexedDB` the same way.

12. **A seek on the player bar lands where you dropped it.** DeckRow cleared
   `dragging` on `pointerup`, which runs before the range's `change` event, so
   Svelte rewrote the input back to the stale playhead and the seek either
   jumped backwards or silently did nothing. `onchange` already clears the
   flag; the extra handler was both redundant and the cause.

13. **`migrateColumns` cannot un-hide the wrong column.**
   `splice(indexOf('title'), 1)` with no `-1` guard removes the LAST element
   when the index is missing, instead of forcing the title column back on.

14. **A continue-in-place reveal stays inside its own time budget.**
   `walkRevealPlan` sized `stepMs` on `to - from` while `totalMs` measures `to
   - origin`, so a reveal that continues from the previous walk overshot
   `MAX_REVEAL_TOTAL_MS` by exactly one step.

15. **Reduced motion actually stops the audible star breathing.** The
   overrides for `.dot.playing` and `.playing-halo` sat ~280 lines before the
   unconditional rules that set those animations, at identical specificity, so
   they lost the cascade tiebreak and both animations ran regardless. The file
   already carries a second media block placed after the rules it overrides,
   with a comment describing this exact trap; the two rules live there now.
   The same block also only disabled `.sector`'s 0.6s transition while the key
   labels, manual edges and retry ring cross-fade on the same events — all
   four are covered.

16. **The force hub has hover feedback and a visible keyboard focus again.**
   `.hub.warning .hub-circle` is declared after `.hub:hover/:focus-visible
   .hub-circle` at equal specificity and won the tiebreak, and `.hub` sets
   `outline: none`, so a keyboard user could not tell the hub was focused at
   all. The author had already solved this for the retry ring; the hub now has
   the matching rule.

17. **A selected star that is in the constellation keeps its selection
   stroke.** `.dot.in-walk` is declared after `.dot.selected` at identical
   specificity, so it won — and since every hub pick selects the track it just
   added, that was the common case, not a corner one.

18. **Clicking the greyed hub no longer clears the selection.** `.hub.disabled
   { pointer-events: none }` plus v31's wider `hubInert` meant a click
   anywhere in the hub disc during the whole reveal window hit the bare
   `<svg>`, whose background handler deselects — so an impatient click dropped
   the anchor the next hub press was about to insert after. Only the painted
   children go inert now; `.hub-hit` stays live and absorbs the click, which
   also makes the `<title>` explaining the state hoverable again.

19. **The hover ring is a ring, not a disc.** Lifting it above the node layer
   in v31 also lifted its translucent accent fill from behind the star to on
   top of it, so it washed the colour of the star it marks — worst on the
   0.12-opacity off-criteria stars the change exists to reveal.

20. **`--bounce-transition` honours reduced motion.** The 160ms overshoot
   token is consumed by four `:active` states across TracksView and
   TracklistPanel, and none of them had an escape. Overriding the token once
   in `app.css` covers every consumer, present and future.

21. **`.hub-reset` is brought in line with the other three interactive SVG
   groups** — `outline: none` plus a `:focus-visible` glyph rule to match its
   existing `:hover` one.

22. **Nine unreachable `ALIASES` keys deleted.** Lookups happen after
   `cleanupGenre`, which rewrites those spellings before the table is
   consulted, so `hip-hop`, `drum and bass`, `r & b` and six others were never
   hit — all nine verified to resolve identically through the cleaned form. A
   comment now says why adding such a key is a silent no-op rather than extra
   coverage.

23. **`edgeOffset` deleted from the genre map.** It builds a list of at most
   one method and then returns early on `length < 2`, so it always returned
   the empty string while every drawn edge paid for the call and an empty
   `<g>` wrapper.

24. **`.legend { transition: right }` deleted** — `right` is a static literal
   that nothing anywhere changes, and the declaration advertised a responsive
   behaviour that does not exist.

25. **`coverageText` and two exported format tables deleted or un-exported** —
   no importer in `src` or `tests` (v14.1's dead-export policy).

26. **`package.json` depends on the d3 modules the code actually imports.** It
   declared `d3`, which no file imports: every call site imports a submodule,
   resolving only through npm hoisting `d3`'s transitive graph. The six
   (`d3-color`, `d3-scale`, `d3-shape`, `d3-selection`, `d3-zoom`, `d3-force`)
   and their `@types` are declared directly now, which drops nineteen packages
   from `node_modules`.

27. **Hiding and re-showing a filter row no longer resurrects a range that is
   not applied.** Hiding clears the filter from the store, but
   `FiltersSection` kept the row's local input entry, so the row came back
   displaying the old bounds — and the next keystroke silently re-applied the
   untouched half of them. Entries for rows that have gone are dropped. Found
   by the revived browser probe below, which is the first thing it caught.

28. **The browser probe runs again.** `scripts/screenshot.mjs` had been
   unrunnable since v18: it aborted at line 49 on a button renamed "Skip the
   tour", and because the whole 1,700-line flow is top-level await with
   `browser.close()` only on the happy path, that abort printed nothing, set
   no exit code and leaked a Chrome process — so eighteen releases of UI drift
   accumulated behind a silent hang. It now has an abort handler that prints
   the summary, closes the browser and exits 1.

29. **The probe's `set` → `constellation` rename.** Suggest / New / Delete /
   Rename / Clear, plus the "Constellation & suggestions" section; "View" is
   the last advanced section now, not that one.

30. **Two probe assertions had been passing while testing nothing.** The BPM
   sort check read the Title column, so both its comparisons were `NaN > NaN`
   — always false, so a genuinely broken sort reported as passing — and the
   header-star alignment guard measured `.header-star`, a class that has not
   existed since v18, then skipped itself on the miss. Column indices are
   derived from the header labels now, the alignment guard points at `th.tags-
   col .header-toggle`, and a miss is a failure.

31. **The probe's remaining staleness.** The Track-properties table has 32
   rows, not 28 (28 properties + 4 panel filters — and the ISSUES entry for
   this was itself stale at 29). Section opens go through the idempotent
   helper, which existed but was used at three of fifteen call sites, so a
   blind click closed a section the app remembers open and the next line drove
   a hidden control. Waits were added where v31 made the UI settle before it
   speaks. The quality filter is a two-button multi-select with no "both", the
   key rings are two independent toggles, the genre method note moved into an
   `InfoTooltip`, default set names lost their noun in v17, the ▲▼ arrows need
   focus inside the row on a fine pointer, and the tour's demo view leaves Key
   + BPM criteria only — the script restores the five-criterion default before
   exercising them.

32. **CI reads `.nvmrc`.** It hardcoded `node-version: 20`, which makes
   `setup-node` ignore the file — and `.nvmrc`, like the Cloudflare build
   environment, says 22.

33. **`npm run check` stopped compiling `src/` twice.** `tsconfig.tests.json`
   claimed `src/**/*.ts` as well as `tests/**/*.ts`, overlapping
   `tsconfig.app.json`; the test files import what they exercise, so
   TypeScript still pulls every src module into the program.

34. **Four comments that describe code that is gone.** `settings.ts` and
   `persist.ts` both still said "three permanent panel pseudo-keys" (four
   since v25); `wholeExtent`'s doc block had been orphaned from its function
   by a later insertion and read as `colourChipOptions`'s; and `hashUnit`
   still described ordering the wheel's same-key fans, a mechanism v9 replaced
   and whose dead `settings.jitterSeed` the settings file already documents as
   dead. `genre-pack-lib.d.mts` also records what v32 learned about v14.1's
   deferred checkJs item: a scripts tsconfig containing both the `.mjs` and
   the `.d.mts` typechecks clean with a declared export the implementation
   does not have — proven by adding one — and deleting the declaration to
   infer from the `.mjs` fails the other way. The two halves have to be edited
   together.

## Resolved in v31

Branch `v31-constellation-review`. Michiel's six-item review of the
constellation: one preference the generator was missing, and five defects
across the set list and the wheel hub.

1. **Suggested constellations steer away from two tracks by the same artist
   back to back.** A soft penalty (`SAME_ARTIST_PENALTY = 4` in `suggest.ts`),
   not a ban — pitched above the practical matched-criteria spread so a
   same-artist candidate loses to any reasonable alternative, and below
   `MUST_INCLUDE_BONUS` / `MANUAL_EDGE_BONUS` (5) so a guaranteed essential and
   a hand-marked combo still outrank the preference. It rides in the existing
   `extra` score term, which BOTH `rankedCandidates` and `forcedCandidates`
   receive, so the plain and ⚡ runs still consume the PRNG identically and a
   force continues a short walk in place (the v14 S2 invariant). Because it is
   a preference rather than a filter, a walk is never cut short by it.
   Artist equality is trim/case/whitespace-insensitive on the whole field —
   "X feat. Y" is not "X" — and an unknown artist never matches another
   unknown. `SuggestedWalk` gained `sameArtist`, counted over the EMITTED ids
   rather than tallied per step, so it also sees the two-arm seam and the
   pinned anchors, neither of which is ever scored. The set panel reports it
   under the walk (`🎤 n of m transitions stay with the same artist.`) beside
   the ⚡ forced-count note, worded as a plain count and never as a claim of
   impossibility: with a soft penalty a step can also land there because the
   alternative was far worse, or through adventurous sampling. New Advanced
   toggle `avoidSameArtist` in "Constellation & suggestions", **on by default**
   — so easy mode inherits it — and additive in `persist.ts` with no schema
   bump. The wheel hub's own picks honour it too, weighing BOTH sides of the
   seam it inserts into.

2. **The hub only offers "force" once the constellation stands still.**
   `hubExhausted` is derived from `$tracklist`, which is written the instant a
   walk is generated — so the button used to flip to "force" before the cascade
   had drawn a single star. The hub is now inert and silent for the whole draw
   (`hubBusy` / `hubForce` / `hubInert`), then settles into `next` / `force` /
   greyed-out. The same standstill rule governs the panel: the ⚡ Force button,
   the `s` hotkey it answers, and both verdict notes now wait for `settled`.
   Beyond consistency that fixes a real defect — the notes used to pop in
   mid-cascade and shove the still-animating rows down the panel. Under
   `prefers-reduced-motion` there is no reveal to wait out (the walk-draw, the
   pulses and the row cascade are all off in CSS), so `bumpWalkReveal` now
   closes the window in the same breath instead of holding these gates for
   seconds against an animation nobody is being shown.

3. **A dropped row reorders immediately instead of snapping back first.**
   `ondragover`/`ondrop` lived only on the track rows, never on the thin
   `key · bpm` transition rows between them — and the insertion line is drawn
   AT the gap, which is exactly where those rows sit, so aiming at the line
   often meant releasing over a non-target. The browser then rejected the drop,
   played its ~400ms snap-back of the ghost to the source, and fired `dragend`
   only afterwards — and `dragend` was what performed the reorder. The `<ol>`
   accepts the drop now (`dragover` bubbles, so accepting at the ancestor
   accepts anywhere in the list) and owns the single `ondrop` path; each
   transition row reports its exact gap via `dragOverGap`. `dragend` became
   `cancelDrag`, which clears the drag without reordering — so a release
   outside the panel now cancels instead of applying the last-known gap.

4. **The pin on the first/last row takes one click again.** Mousedown focused
   the button, `.track:focus-within` flipped the ↑/↓ arrows from `display:
   none` into flow, `.row` (`flex: 1`) absorbed the ~45px, and the pin — which
   sits BEFORE `.actions` — slid left out from under the cursor. Mouseup landed
   on an arrow, so the click resolved on the `<li>`, which has no handler, and
   the first press only ever revealed the arrows. The pin now cancels its
   mousedown default, which suppresses focus and with it the whole shift.
   Keyboard focus is untouched: Tab still reaches it.

5. **One pair of first/last glyphs, everywhere.** The set list drew a 📌
   pushpin for the idea that the Tracks-view star and the selected-track card
   both draw as ⏮/⏭ — and those two carried the glyphs as duplicated string
   literals. `PIN_FIRST_GLYPH` / `PIN_LAST_GLYPH` now live in `core/pins.ts`,
   which already owns the pin state machine, and all three surfaces read them.
   The pushpin's `filter: grayscale(1)` went with it (a no-op on a monochrome
   glyph that would only have muted the pinned state); pinned is the accent
   colour at full opacity.

6. **The set-list hover ring survives the focus dim.** The ring was a child of
   the node group, whose `opacity` attribute carries the dim, so its own
   `opacity: .8` multiplied down to ≈0.1 — it vanished on precisely the stars
   it exists for, the off-criteria ones you cannot otherwise find. It is its
   own layer now (11, between the gutter tick numbers and the hub), painting at
   full strength over a star that keeps its dim: "this one doesn't match" stays
   true, and the ring only says where it is. Same coordinates, so nothing else
   moved; the hovered node's paint-order raise stays.

## Resolved in v30

Branch `v30-collapsible-panels`; design notes in
[designs/design-v30-collapsible-panels.md](designs/design-v30-collapsible-panels.md),
and — for the review pass that followed — in
[designs/design-v30.1-panel-tabs-and-link.md](designs/design-v30.1-panel-tabs-and-link.md).
One request — make the three panels collapsible — whose consequences reached
further than the toggles.

1. **Every panel now collapses, from its own edge or from Advanced.** Each of
   the three has a chevron button sitting ON its boundary, positioned against
   the CENTRAL column's edges rather than against a rail width — those edges are
   the boundaries in every combination of collapses, so no button has to know a
   number and none is recomputed. A collapsed rail's button docks inside the
   window rather than straddling a seam that has become the window edge.
   Collapsing CLIPS: the rail is an `overflow: hidden` wrapper that goes to
   `width: 0` while the panel inside keeps its own width, so the left panel's
   uncontrolled `<details>` fold state and its scroll position both survive, and
   `inert` keeps what is clipped out of the tab order. Instant, no animation —
   the wheel re-rasterises on every layout frame and v29 spent a workstream
   keeping that work off the audio thread.

   **Revised in v30.1**, after living with it. Straddling the seam meant half of
   each button was drawn on the panel's own contents, worst at the top where it
   landed on the deck row's seek line beside the transport. Each is a TAB now:
   flat against the boundary, rounded into the central view, protruding only
   that way. The positioning is untouched, so a collapse still moves them for
   free; only the direction of the overhang changed — which also retires
   `.tucked`, since a button that never crosses the seam can never hang outside
   the window. The ink is a sliver, so an invisible cushion brings each tab up
   to the 24px pointer target, growing into the view only: a cushion reaching
   back over the panel would take clicks from the contents this was fixing.
   And the central pane RESERVES the strip they occupy — `--panel-tab` is both
   how far a tab protrudes and how much padding `.center-scroll` keeps on those
   three edges. Without it the tabs were merely off the panels and still on
   content: the top one sat on the Tracks view's KEY header, the side ones on
   its ★ and rating columns.

2. **The bar is genuinely nested now, not aligned by arithmetic.** `.player`
   moved inside the central column, so v29 #6's three-column grid with two empty
   spacer columns sized to `--left-rail` / `--right-rail` is gone: the bar spans
   the central pane because it is a child of it, and there is no number left to
   drift. It sits outside `.center-scroll`, so a narrow window still scrolls the
   wheel against its 680px floor without dragging the transport with it. The two
   panels that were still hardcoding `280px` now read `var(--right-rail)`.

3. **Hiding the bar keeps the session.** `audioPreview` IS the top panel's
   switch — one concept, since a bar you cannot see is a bar you cannot stop —
   so hiding it still disposes the AudioContext. What was pinned, what was
   clicked, each deck's position and the fader are snapshotted first and handed
   back, PAUSED where they were, when the bar returns. A track that left the
   library meanwhile is dropped by `reduceDecks`'s own `library` case. The
   position is parked in a `pendingSeek` and applied on the `meta` deck event,
   because `currentTime` before `loadedmetadata` is unreliable. Nothing was
   suspended on a project load or a first switch-on, so that path returns before
   touching the engine and no context is built without a gesture.

4. **The chip fits, in both directions.** Its width now answers to the player
   bar via a CSS container query rather than to the right rail: written out when
   there is room, a bare `✓` / `⚠` / `Link…` when there is not, with everything
   it drops already in the ⓘ and the `title` — and the ⓘ is unconditional in the
   bar, since in the short form it is the only place the numbers are. Its height
   cannot move the bar any more: the scan block is a row rather than a label
   stacked above its progress bar, and the empty deck's hint truncates instead of
   wrapping. The bar's height depends on one deck or two, and on nothing else.
   Separately, at 860px with both rails showing the deck row's `flex: 0 0 22ch`
   label could not shrink and pushed the lock button over the right-hand panel;
   it is `flex: 0 1 22ch` now (both rows shrink against the same width, so the
   seek lines still line up) with `.decks` clipping as a backstop.

5. **Advanced settings gained a View section, which is what Preview became.**
   Three checkboxes, one per panel, with the music-folder control still nested
   under the top one. The section id went `audio` → `view` and deliberately did
   not keep the old one — the section's contents genuinely changed, so it starts
   folded once. ⚙ Advanced borrows the right rail and that borrow OVERRIDES the
   collapse, since pressing ⚙ has to produce a panel either way; the right
   button steps aside entirely while Advanced shows, and the row carries a hint
   saying it takes effect once Advanced closes.

6. **Two additive settings, no schema bump.** `showLeftPanel` / `showRightPanel`
   default to true, which is the layout every earlier save was written from, so
   an older save resolves to it with no migration. They join `theme` and
   `audioPreview` as chrome: excluded from Cmd+Z, surviving "Return to default
   settings", and passed through the easy-mode overlay.

7. **The tour keeps working, and got two robustness fixes.** It stashes all
   three panel switches, forces them on (every step points at something inside
   one of them) and restores them on both exits. `TourOverlay` now re-measures on
   a panel change — it watched only step changes, resize and scroll — and treats
   a zero-size target as no target: `getBoundingClientRect()` on a clipped
   element is all zeros rather than null, so the spotlight used to become a 12px
   hole in the top-left corner instead of falling back to the plain dim.

8. **The link control, revisited (v30.1).** Three complaints, one knot. Before a
   folder was linked the bar's button read `Link` / `music` / `folder…` on three
   lines, and a taller button is a taller bar — the one thing entry 4 says
   depends on the deck count and nothing else. The copyable suggested-path chip
   was the widest thing in `.source` and was squeezing it, and a squeezed button
   was free to wrap its own text because nothing said otherwise. So bar labels
   are `nowrap` (the panel stays exempt — its long coverage read-out fits the
   rail by wrapping), and the chip is panel-only: Advanced → View is the
   management surface, and since no browser opens a picker at a path, the
   copy-then-⌘⇧G route is still the only one there is. The adaptive label needed
   nothing but the room. Separately, the ⓘ's worked example named the first track
   in the library with a path — nothing in particular, and often nothing on
   screen; it now names the track last CLICKED, else the first the filters leave
   standing, both drawn from what is visible. `folderHint` takes the candidates
   as an optional second argument, so every existing call is unchanged, and the
   suggested FOLDER still reads the whole library: what gets linked has to cover
   everything, not just what survives the filters.

**Verified in the browser.** Three Playwright probes against a real import, a
real music folder (mp3, FLAC and a deliberately unplayable AIFF) and the sample
collection: 18 + 20 + 13 checks, zero console errors. Geometry to 1px in every
combination of collapses; the chip long and short with an identical bar height
and its ⓘ escaping the bar's new `overflow: hidden`; play/hide/show returning the
same deck at the same position, paused; the ⚙ override both ways; a collapsed
panel surviving a reload; two decks exactly one row taller than one; and the tour
replayed with all three panels put away, every step spotlighting a real element
and all three returning to collapsed at the end. **v30.1 added a fourth probe**
— 25 checks: every tab clearing the panel it controls in both states and staying
inside the window, the cushion reaching outward but not back, the bar the same
height and one line at both widths, no path chip in the bar and exactly one in
Advanced → View, and the ⓘ following each click while the suggested folder holds
still. The first three still pass unchanged, apart from one assertion that was
checking the retired straddle.


## Resolved in v29

Michiel's review of the v28 audition bar, shipped on `v29-player-review`. Full
rationale, the declined alternatives and what the browser pass did and did not
reach are in
[designs/design-v29-player-review.md](designs/design-v29-player-review.md).

**Supersedes a v28.1 decision.** The deselection *latch* — clearing the
selection while deck B plays being a no-op — is gone. It existed because the
deck followed `selectedId`; now that the deck follows the click itself, a
select event cannot carry null and there is nothing left to latch against.
`DeckEvent`'s select case loses `bPlaying` with it.

**Not reached by this wave:** whether the cracks are actually gone. A probe can
prove the de-click ramps exist and the graph is built with a playback-sized
buffer; only listening on a real library proves the noise stopped. The
`MEDIA_ERR_DECODE` branch is also unit-tested only — Chrome does not raise it
for a corrupted FLAC, it decodes the intact header and fires `ended`.

1. **The bar renders with no library loaded.** `PlayerBar.svelte:75` drops
   `&& $library.length > 0`, which contradicted the component's own principle
   two lines above it — a hidden bar cannot distinguish "off" from "broken".
   `emptyHint` gains a first branch naming the missing import, and a second
   for a folder already linked, since linking before importing works.
   Files: `lib/PlayerBar.svelte`.
2. **Linking a folder reports both of its passes, behind the repo's first
   progress bar.** New `lib/ProgressBar.svelte` (`value`/`max`/`label`/`width`;
   indeterminate when `value` is absent, because an FSA walk has no total until
   it finishes). `sourceStore` replaces `indexedCount` with an `indexProgress`
   store carrying `{phase, done, total}` for `'scanning'` and `'matching'`.
   Three defects fell out of it: `rootName` was only set inside `adopt()` after
   the walk, so a first link read `Scanning… 0`; `usePickedFiles` set
   `'indexing'` and adopted in one synchronous tick, so on Firefox and Safari
   the state never painted; and `'ready'` was set before the match pass, so the
   control briefly fell back to "Link music folder…" with a folder linked.
   `openPickerSource` is async and chunked (merging per-chunk `buildFileIndex`
   results, so the pure builder stays the builder), `reindex` yields every 2000
   tracks under a run token, and `adopt` awaits it.
   Files: `lib/ProgressBar.svelte`, `lib/audio/sourceStore.ts`,
   `lib/audio/pickerSource.ts`, `lib/FolderLinkControl.svelte`.
3. **The folder hint is a worked example, not a bare path.** New pure
   `folderHint(tracks)` in `core/location.ts` returns `{example: {label, path,
   folder}, suggested, scattered}` — this track, where it claims to live, and
   therefore the folder to link — falling back to the example's own folder when
   `commonAncestorPath` collapses (one track on another volume used to leave no
   hint at all). It renders through the shared ⓘ in both layouts, and again
   when a link matched nothing, where `✓ 0 of 2080 playable` read like success.
   `formatPath` is extracted so the example and the ancestor agree about
   Windows drive letters. Files: `core/location.ts`,
   `lib/FolderLinkControl.svelte`.
4. **The audible track breathes where it can be seen.** Three causes, and the
   animation was the smallest. `nodeOpacity` (`WheelView.svelte`) exempts
   audible ids from the 0.12 focus dim, which multiplied with the keyframes to
   breathe an unselected audible star between 0.12 and 0.054. A `paintedNodes`
   derived — used only by the node `{#each}`, so `nodeById`/`walkNodeById`/the
   ghost split keep their order — sorts audible above selected above hovered,
   which wins the click as well as the overlap, since SVG hit-testing follows
   paint order. And because a dot at opacity 1 has nowhere brighter to go, the
   peak moves into a `.playing-halo` circle behind the star, in phase with it;
   the dot's dip softens to 0.65. Both views run at 1.6s. The Tracks view's
   peak tint rises to 22%/40% and its reduced-motion fallback to 16%/34% — at
   22% it matched `tr.selected` exactly, so a still audible selected row was
   indistinguishable from a silent one — and the wheel gains the static
   fallback it never had. Files: `lib/WheelView.svelte`, `lib/TracksView.svelte`.
5. **The transport de-clicks, and the graph is built for playback.**
   `engine.ts` gains `whileSilenced(slot, action)`: fade to zero over 8 ms,
   act, fade back over 14 ms to the level that slot was *commanded* to — a new
   per-slot `commanded` array, indexed by slot rather than deck so a promote
   cannot move it. It wraps `pause`, `seek`, `loadDeck` and `clearDeck`; a
   paused element is acted on synchronously (it cannot click), and the returned
   promise lets `materialise` await a load before playing it. `setGains` stops
   stacking `setTargetAtTime` events that never arrive and ramps explicitly.
   For the dropouts: `latencyHint: 'playback'`, `preload = 'auto'` on a loaded
   element, no redundant `element.load()` after assigning `src`, a 200 ms
   debounce plus a `wanted` token on the speculative pre-load, and a
   re-entrancy guard on `togglePlay`. Pin and unpin recentre the fader, which
   was never reset. The limiter is deliberately untouched — see the design doc.
   Also fixed here: `linkFolder`/`reconnect` had no `try/catch`, so a throw
   mid-walk stranded `sourceState` on `'indexing'` for the session, and
   `FolderLinkControl`'s copy timer was never cleared on unmount.
   Files: `lib/audio/engine.ts`, `lib/audio/playerStore.ts`,
   `lib/audio/sourceStore.ts`, `lib/FolderLinkControl.svelte`.
6. **The bar is a three-column grid matching the app's own layout.**
   `--left-rail: 250px` and `--right-rail: 280px` join `app.css`'s `:root` and
   replace the bare pixels in `CriteriaPanel.svelte` and `App.svelte`;
   `.player` becomes `grid-template-columns: var(--left-rail) minmax(0, 1fr)
   var(--right-rail)` with no horizontal padding of its own, so column 2 starts
   exactly at the central pane's left edge. Both side columns stay reserved
   when the right rail is absent. The chip compresses via a new pure
   `coverageShort` (`2043/2080 playable`), with the breakdown behind an ⓘ, one
   line per reason; `layout="panel"` keeps `coverageLine` in full. Measured in
   the browser: the decks share both edges of the central pane to within 1px.
   Files: `src/app.css`, `lib/PlayerBar.svelte`, `lib/CriteriaPanel.svelte`,
   `App.svelte`, `core/audio/coverage.ts`, `lib/FolderLinkControl.svelte`.
7. **Every reason says what happened, why, and what to do.** `reasons.ts`
   gains `reasonDetail` beside `reasonLabel` and a `decode-failed` reason;
   `formats.ts` gains `FORMAT_NOTES` and `formatNote(extension)`. The short
   line names the format (`this browser can’t play AIFF`) and the ⓘ beside it
   in `DeckRow.svelte` carries the rest — that Chrome and Firefox ship no AIFF
   decoder while Safari does, that an unplayable `.m4a` is almost certainly
   ALAC, and what to do about either. `ReasonContext.raised` distinguishes
   `canPlayType` predicting no decoder from the element opening the file and
   refusing it, and `playerStore` splits the media error codes it used to
   collapse: 4 stays `unsupported`, 3 becomes `decode-failed` (a damaged file,
   not a missing codec), anything else `read-error` — whose copy now admits
   damage as a cause, since a file that decodes to nothing fires `ended` rather
   than `error`. New `tests/reasons.test.ts`; the copy checks that lived in
   `tests/audio-coverage.test.ts` move into it.
   Files: `core/audio/reasons.ts`, `core/audio/formats.ts`,
   `lib/PlayerBar.svelte`, `lib/DeckRow.svelte`, `lib/audio/playerStore.ts`.
8. **Unpinning keeps the top track instead of discarding it.** `reduceDecks`'s
   `'unlock'` returns `{a: null, aLocked: false, b: state.a}` with `[promote,
   clear a]` — the mirror of `'lock'` — so the pinned element goes on playing,
   uninterrupted, as the single deck B. `promote`'s interpretation in
   `playerStore` becomes a symmetric swap of `materialised`; the old `a = b;
   b = null` was only correct going up. The lock button's `title` says what
   unpinning now does. Files: `core/audio/decks.ts`,
   `lib/audio/playerStore.ts`, `lib/DeckRow.svelte`.
9. **The preview has a tour step.** `data-tour="preview"` on the bar and a step
   after "What decides a combo", where the argument for it lives: the criteria
   decide a combo by metadata, this judges the same combo by ear.
   `enterDemoView` stashes `audioPreview` and forces it on so there is a real
   bar to spotlight; `endTour` restores it on both exits, including "keep this
   demo" where `applyProject` never runs, and leaves alone a switch the user
   turned off themselves. Files: `lib/TourOverlay.svelte`, `lib/tour.ts`,
   `lib/PlayerBar.svelte`.
10. **The deck follows a direct track click, not the selection.** New
    `clickedTrackId` in `stores.ts`, set by `selectOrLink` — already the one
    choke point shared by the wheel star, Enter on a focused star and the
    Tracks-view row — and set even when the click deselects, since clicking a
    track is still a click on that track. `playerStore` subscribes to it
    instead of `selectedId`. The set panel's row button
    (`TracklistPanel.svelte:519`) writes `selectedId` directly and stays out,
    matching v28's decline of driving the player from the constellation. The
    copy follows: "select a track to load it" becomes "click a track to hear
    it", and the fader speaks of the clicked track rather than the selection.
    Files: `stores.ts`, `lib/audio/playerStore.ts`, `core/audio/decks.ts`,
    `lib/PlayerBar.svelte`.

**Verified in the browser**: two standalone Playwright probes (not added to
`scripts/screenshot.mjs`, which has three stale selectors recorded under *Open
— tooling* and gates nothing). Chromium via the chrome-channel fallback, fresh
`localStorage`, a generated folder holding one file per format plus a corrupted
FLAC, and a Rekordbox XML whose paths point at a volume that does not exist, so
the suffix matcher does real work. 32 checks pass with zero console errors,
covering items 1, 3, 4, 6, 7, 8 and 10 — including a 1px comparison of the
decks against the central pane's box, an exact `✓ 5/7 playable`, and a playing
deck surviving a background click, Escape and two view switches. A second probe
catches the progress bar mid-scan of a 6,000-file folder (item 2) and drives
the tour to the preview step and out again (item 9). Both themes and a 3× halo
capture were reviewed by eye. Item 5 is by ear, on a real library.

## Resolved in v28

Audio preview shipped on `v28-audio-preview`: a two-deck audition bar under
the top bar, off by default behind Advanced settings → Preview → **Listen to
tracks**. Selecting a track loads deck B; the padlock pins it to deck A and
reveals a second row plus a small vertical crossfader. Full rationale and the
declined alternatives are in `designs/design-v28-audio-preview.md`.

**Reverses a recorded decision:** `designs/design-v12.md:127` listed "No local
audio preview (declined)". That was a scope call, not a principled one — the
POSITIONING boundary is about *remembering*, and this records nothing.

Three bugs were found by driving a real browser against a folder of generated
audio and a library whose paths point at a different machine, none of which
unit tests could have reached: the play button gated on a duration that cannot
be known before the first play (a deadlock); unplayable tracks showed a dead
progress line because the bar consulted only errors the media element had
raised, never the static resolution; and promoting a deck swapped the elements
without swapping the UI state describing them.

**Revised in v28.1**, after living with it. The standing stray-click
objection recorded when v28 shipped was correct and is resolved: deselection
now *latches* while deck B is playing, and only clears a paused deck. The
crossfader shrank to a small vertical fader beside both rows (costing no bar
height, where the horizontal one cost a whole row) and stopped attenuating the
centre — the deck it points at now holds unity across its half, since this is
a comparison tool and the centre is the listening position, not a transition
to pass through. Two decks at unity clip, so the output bus gained a
non-adjustable limiter; a master trim was declined because -3 dB reproduces
the old centre level exactly. Finally, the folder picker now opens at ~/Music
on Chromium (`startIn`), and everywhere else shows the library's own deepest
shared folder as a copy button, because `<input webkitdirectory>` accepts no
start location at all — a platform limit, not an omission.

**Polished in v28.2**: the fader column stays reserved while unlocked so
pinning never shifts the transport; the fader thumb paints above the
centre-tick nubs; double-click centres it; both decks are always named, with
an overflow marquee that cycles long titles (`src/lib/marquee.ts`); the
audible tracks breathe in the wheel (dot opacity) and the Tracks view (row
tint); and `engine.dispose()` no longer clears the deck-event listener set —
it belongs to the store, which registers once at app start, so toggling the
preview off/on had killed duration and seek on the rebuilt graph. The same
wave fixed the collapsed Artist column: the measured colgroup's one elastic
`<col>` (Artist, not Title as its comment claimed) was squeezed to nothing
under table-layout: fixed; every column is measured now.

**Still open:** `scripts/screenshot.mjs` gained no probe for the bar. The
script has three stale selectors already recorded under "Open — tooling" and
is not a CI gate, so adding to it would not have been checked by anything —
it belongs in the same separate tooling pass.

## Resolved in v23

The permanent panel-filter wave shipped on `v23-filter-group`: ★ Starred and
🔗 Combos, previously ad-hoc marks filters, join 🎵 Keys as three permanent
rows in the left panel and gain matching visibility controls in the
Tracks-view header — all three driven off one new registry,
`core/marks.ts`'s `PANEL_FILTERS`, with the older marks-only `MARK_FILTERS`
now *derived* from it instead of hand-rolled a second time. **Rejected:** a
second, parallel registry just for the Keys row — it would re-create the
exact label/aria drift the v18 review already fixed once; widening the
shared `.filter-label` column to fit the longer pseudo-row labels — the
250px panel has only ~12px of slack and the property number boxes already
sit at their 52px `min-width` floor, so the pseudo rows opt out of that
column instead; a dedicated ♪ column in the Tracks view — it would repeat
the A/B ring the Key cell's glyph already carries; and folding the sort
direction into the ♪ cycle — a fourth cycle stop would make "sorted by key
descending, minor only" unreachable and give the Key header a different
shape than the other 27.

1. **`core/marks.ts` gains a single registry, `PANEL_FILTERS`, for the three
   permanent panel rows.** `PANEL_FILTER_KEYS = ['starred', 'combos',
   'keys']`, `PanelFilterKey`, `isPanelFilterKey` and `PanelFilterMeta` back
   it; each entry carries a `label` (`'★ Starred'`, `'🔗 Combos'`, `'🎵
   Keys'`), a glyph-free `aria` string (`'Starred'`, `'Manual combos'`,
   `'Key rings'`), and an optional `flag` naming the `MarksFilter` boolean
   it drives (`starredOnly` / `comboOnly`; absent for `keys`, which drives
   `filters.keyRings` instead). `MARK_FILTERS` is now the subset of
   `PANEL_FILTERS` carrying a `flag`, computed with a type-narrowing
   `.filter()`, not a second literal list — `MARK_FILTER_KEYS`,
   `MarkFilterKey` and `isMarkFilterKey` are retired. `DEFAULT_SETTINGS.
   visibleFilters` becomes `['bpm', 'year', 'rating', 'starred', 'combos',
   'keys']`. The project schema bumps 7 → 8: `persist.ts:427`'s
   `parseProject` back-fills any of the three pseudo-keys missing from a
   save's `visibleFilters` when `version < 8`, and trusts schema 8+ saves
   verbatim, so a deliberate hide made after this wave survives a reload.
   `stores.ts` gains `clearPanelFilter(key)`, the one function every
   hide-path (panel checkbox, header toggle) now routes through to
   neutralise whichever mechanism a row drives before it disappears — a
   marks flag via the existing `setMarkFilter`, or `keyRings` reset to
   `{minor: true, major: true}` directly.
   Files: `core/marks.ts`, `core/persist.ts`, `stores.ts`.
2. **The left panel and the advanced menu both render the three rows from
   `PANEL_FILTERS`, not their own hand-rolled copies.** `FiltersSection.
   svelte` replaces its old `markRows` `{#each}` and the hardcoded Keys row
   with one `{#each panelRows as m}` over the registry, wearing a `.pseudo`
   class (opts the row out of the shared 52px `.filter-label` width — the
   panel has no slack left to widen it for everyone) and `.group-top` on
   the first row (the single divider between the property ranges above and
   the marks/ring group below). `AdvancedMenu.svelte`'s "Track properties"
   table grows one `.prop-row.pseudo` per registry entry, each a single
   shared checkbox spanning the column and filter cells (`aria-label="{aria}
   filter and column"`, never the emoji — a screen reader would otherwise
   speak its Unicode name, the same v18 review fix `PANEL_FILTERS`'s own
   doc comment records) wired through `togglePanelVisible`, which calls
   `clearPanelFilter` on hide. The old `resetToDefaults` loop that
   hand-cleared the marks flags is gone — resetting `visibleFilters` to the
   registry-derived default now does the same job.
   Files: `lib/FiltersSection.svelte`, `lib/AdvancedMenu.svelte`.
3. **The Tracks view gates its ★/🔗 columns on `visibleFilters` and gains a
   ♪ ring quick filter in the Key column header.** `showStarCol`,
   `showComboCol` and `showKeyRings` read `$settings.visibleFilters`
   directly (not `effectiveFilters` — easy mode neutralising the underlying
   filter must not also hide the column-visibility choice); `<th
   class="tags-col">` and `<th class="manual-col">` (and their matching
   `<td>`s) wrap in those flags, and `colCount` follows: `(showStarCol ? 1
   : 0) + 1 + (!easy && showComboCol ? 1 : 0) + columns.length`, so the
   `.empty-row`'s `colspan` always matches however many `<th>`s the header
   actually renders. The ♪ button sits beside `.sort` inside the Key
   column's `<th>`, gated on `showKeyRings && !easy && !inSetOnly`, and
   cycles `filters.keyRings` through three named stops — `♪` (both rings,
   not `.on`), `♪A` (minor only, `.on`), `♪B` (major only, `.on`) — back to
   `♪`; a fourth, panel-only state (both rings off) is reachable from the
   left panel's independent toggles and rejoins the cycle at its start
   rather than stopping on it. A follow-up fix commit replaced the button's
   original absolutely-positioned overlay with a `.th-inner` normal-flow
   flex wrapper around `.sort` and `.key-ring`, matching the `.lock`
   precedent in `CriteriaPanel.svelte:330-336` — an in-flow flex sibling
   with a fixed 26px width, so the ♪ ↔ ♪A ↔ ♪B glyph swap never shifts the
   sort label or the ▲/▼ triangle beside it.
   Files: `lib/TracksView.svelte`.

**Verified in the browser**: this wave's browser pass was deliberately
scoped down to the one silent-failure mode a review flagged — a `colCount`
miscount, whose only symptom is a misaligned empty-state row — rather than
the full (a)-(h) checklist originally drafted for this task. Standalone
Playwright probe (`task4-probe-colspan.mjs`, launched against `npm run dev`
on `http://localhost:5173`, chromium via the chrome-channel fallback, fresh
`localStorage`, the sample library loaded, guided tour dismissed by its
real `aria-label` with a dispatched click) drove the Tracks view into its
empty state (every playlist deselected) in four configurations and
compared the `.empty-row` `<td>`'s `colspan` against the live `<thead th>`
count: both ★ and 🔗 shown, 10 vs 10; ★ hidden alone, 9 vs 9; 🔗 hidden
alone, 9 vs 9; both hidden, 8 vs 8 — 5/5 checks (the four colspan
comparisons plus a zero-console/page-error check), one theme only, no
discrimination step run. Everything else in the wave — the panel row order
and divider, the switch alignment, the ♪ cycle's three stops, the ★/🔗/♪
visibility toggles themselves, the schema-8 back-fill, the ♪-button fit
beside the Key sort label, and the light theme — was reviewed by eye rather
than measured in this pass.

## Resolved in v22

The Tracks-view header defect Michiel reported, shipped on
`v22-tracks-header`. One CSS idiom moved: the header's ★ and 🔗 quick
filters stop riding `.tag`, the shared row-icon base, and get a
self-contained `.header-toggle` ruleset modelled on the ☰ set-only toggle
that sits between them and never had the problem. Nothing else in the
header changed — every `{#if}` gate, `class:on`, `disabled`, `title`,
`aria-*` and `onclick` is untouched. Which controls render (`!easy`,
`!inSetOnly`) and when they disable (`starToggleDisabled`,
`comboToggleDisabled`) were already right; only their visibility while
enabled was wrong.

1. **The header ★ and 🔗 quick filters now stay visible the moment they
   become usable, instead of vanishing exactly then.** Both buttons in
   `lib/TracksView.svelte` carried `class="tag header-toggle"`, and `.tag`
   is the _row_-icon idiom: `opacity: 0`, revealed by `tbody tr:hover` so a
   dense table is not a wall of glyphs. A `<th>` never matches `tbody
   tr:hover`, so the header's only three escapes from that zero were
   `.tag.on` (opacity 1 while the filter is lit), `:disabled` (0.4), and a
   `thead:hover / :focus-within` reveal rule — which produced the exact
   inversion reported. With nothing starred, `starToggleDisabled` is true,
   so the button is _disabled_ and paints at 0.4: **visible**. Star one
   track and it becomes _enabled_, falls back to `.tag`'s `opacity: 0`, and
   **disappears**, returning only while the pointer sits on the column
   headers. Same story for 🔗 against `$manualEdges.length`. The control was
   visible only while it was useless. The fix takes `.tag` off the two
   buttons rather than patching a resting opacity onto it, because that
   `opacity: 0` is load-bearing for everything else `.tag` serves — up to
   500 row stars, plus a `.tag` 🔗 in every manual-combo cell once a row is
   selected — and a resting opacity on the shared base would have made every
   one of them permanently visible, which is the thing `.tag` exists to
   prevent. It would also have been a patch on top of a patch: the header
   buttons already needed `.tag.header-toggle {
   padding: 8px 6px }` to undo `.tag`'s dense-row padding, and
   `.tag.header-toggle:disabled` to out-specify the hover reveal. All three
   reconciliation blocks were deleted with the class; the one thing worth
   keeping from `.tag`, the springy `var(--bounce-transition)` press, is
   restated explicitly along with the `:active { transform: scale(0.75) }`
   that `.tag` kept in a separate rule — without it the transition would
   animate nothing. Ordering inside the new ruleset is deliberate:
   `:disabled` follows `:hover` at equal specificity, so a disabled toggle
   never picks up the accent colour. Against the global button reset in
   `app.css`, `.header-toggle` (0,1,0) beats `button` (0,0,1) and
   `.header-toggle:disabled` (0,2,0) beats `button:disabled { opacity: 0.45
   }` (0,1,1), and `border: none` makes `button:hover:not(:disabled)`'s
   border rule inert. Resulting progression, the same one the ☰ already had:
   nothing to filter → dim 0.4 and inert; something to filter → full
   `--ink-muted` and live; filter lit → `--accent`. `table.has-selection
   td.manual .tag:not(.on)` is scoped to `td.manual` and never reached the
   header 🔗 in `th.manual-col`, so it stays exactly as it is. The README's
   Tracks-view sentence was stale twice over and is rewritten to match: it
   described a header ★ "revealed on header hover" — the reveal this wave
   deletes — that "stars the whole view at once", the bulk action retired
   in v18 when the header became a filter toggle, and it omitted the header
   🔗 entirely. Files: `lib/TracksView.svelte`, `README.md` (outside
   `src/`).

**Verified in the browser** (standalone Playwright probe over the running
dev server, sample library loaded, fresh `localStorage`, guided tour
dismissed by its real `aria-label` with a dispatched click): 86/86 checks —
with the pointer parked at the bottom-left corner and
`document.activeElement` blurred after every click, so that `thead:hover`
and `thead:focus-within` were asserted to match zero elements at all 17
measurement points — the two escapes that used to mask the bug. Measured,
per theme: the header ★ with
nothing starred, `disabled` at `opacity: 0.4`, hit-testable via
`elementFromPoint`; the same button after one row star was clicked,
`opacity: 1` — never 0 — enabled, painting `--ink-muted` exactly
(`rgb(138, 136, 128)` dark, `rgb(125, 123, 114)` light); lit by a click,
`.on` at `--accent` (`rgb(39, 166, 196)` / `rgb(13, 125, 153)`) and still
`opacity: 1`; cleared again and still `opacity: 1` back at `--ink-muted`;
all six of those repeated for the header 🔗, disabled first, then with a
manual combo created by selecting a row and clicking a partner's 🔗 cell;
the ☰ `.pos-toggle` snapshotted at all seven measurement points per theme
and identical every time (`opacity: 0.4`, `--ink-muted`, disabled — the set
stays empty throughout); no row regression, an unmarked row ★ still
`opacity: 0` at rest, 0.65 on row hover and 1 when `.on` at rest; the
header ★ still centred over the row stars to 0.0px with no element
anywhere carrying the stale `.header-star` class; and cleanup between the
two theme runs returning both toggles to disabled. The load-bearing check
(b) was shown to discriminate rather than merely pass: re-injecting the
pre-v22 cascade (`.header-toggle { opacity: 0 }` plus the three escapes)
into the live page made that same enabled header ★ measure `opacity: 0`
while everything else held, and the control screenshot reproduces the
reported symptom with the ★ gone and the ☰ and 🔗 still in place — both
themes, zero console errors and zero page errors.

## Resolved in v21

Both constellation-edge defects from the v21 edge review, shipped on
`v21-edges`. A new `core/walkArrow.ts` holds the change's geometry in one
place — `WALK_CHEVRON_VIEW_BOX`, `_D`, `_SIZE`, `_REF`, `_STROKE`,
`_MIN_EDGE`, plus `walkChevronMid`, the one piece with behaviour to
unit-test — because the walk is drawn twice, by `lib/WheelView.svelte` on
the wheel and by `core/exporters/portrait.ts` in the poster, and each
carried its own duplicated arrow marker. Both renderers now draw a walk
edge as a three-point `<polyline>` (`a → mid → b`) wearing a small open
chevron on `marker-mid`, instead of a `<line>` with a solid `marker-end`
arrowhead: SVG places and orients a mid-marker at the interior vertex for
free, and `orient="auto"` on a collinear vertex bisects to exactly the line
direction, so the direction cue needs no `atan2` (there is none anywhere in
`src/`), no second element per edge and no per-frame transform. Rejected: a
separately rotated `<path>` per edge — it doubles the element count and
needs direction maths the codebase does not have.

1. **Out-of-view walk edges now thin and fade instead of dashing.**
   `.walk-edge.ghost` (`lib/WheelView.svelte`) drops its `5 5` dash and says
   "an endpoint is off the filtered wheel" as `stroke-width: 1` with
   `stroke-opacity: 0.35`, against a normal edge's 2 and 1. The dash was
   surrendered to manual combos because `.manual-edge`'s `6 5` was
   near-indistinguishable from it on the same canvas, one walk-coloured and
   one accent-coloured; dashes on the wheel now mean one thing only, a combo
   the user marked by hand. Rejected: re-tuning the ghost to a wider,
   more distinct dash — the wheel already spends `3 5` on the missing-data
   fallback ring (`.gridline.dashed`), `4 4` on the centre hub's ring
   (`.hub-circle`), and `2 5` on the retry ring (`.retry-ring`, tightening
   to `2 3` on hover or force-retry) whenever a hub suggestion is live, so
   a fifth pattern — sixth counting that hover state — would have had
   nothing left to tell it apart from those three and `.manual-edge`.
   `stroke-opacity` rather than plain `opacity` is load-bearing:
   `.walk-edge.reveal` animates `opacity` with `animation-fill-mode:
   forwards`, so a dimming parked on that
   property would not survive the reveal. Files: `lib/WheelView.svelte`.
2. **The walk's direction mark now sits mid-edge and holds its size under
   zoom.** `walkChevronMid` (`core/walkArrow.ts`) returns the vertex to hang
   the chevron on — the plain midpoint — or `null` below
   `WALK_CHEVRON_MIN_EDGE` (16 user units), where the two nodes' r=11 hit
   discs already overlap and a marker between them is clutter rather than
   information (the drawn star itself is r=5, or 7 selected); a
   two-point polyline has no interior vertex, so the unconditionally set
   `marker-mid` is simply inert there. The midpoint has clear canvas, which
   the old `#walk-arrow` never did: it pinned its tip to the target node's
   centre (`refX="9"`) while the wheel paints edges at layer 5 and nodes at
   layer 9, so the star buried it and only its flanks showed. It was also
   oversized — `markerWidth="7"` with `markerUnits` left to default to
   `strokeWidth` is 14 user units beside the r=11 hit disc. The chevron
   takes `markerUnits="userSpaceOnUse"` instead, which decouples it from the
   edge's stroke-width so a ghost's 1px hairline cannot silently halve it,
   and on the wheel its `markerWidth`/`markerHeight` are
   `WALK_CHEVRON_SIZE / zoomK`, counter-scaling the way every node there
   already does (`r={11 / zoomK}`) — the old arrow ballooned at high zoom
   precisely because it did not. The export needs no counter-scale (a poster
   has no zoom) and drops the old `trim`/`x2`/`y2` shortening with the
   arrowhead it existed to protect: the line now simply runs under the r=11
   badge, which is painted afterwards with an opaque page-coloured ring.
   `fill: none` on the polyline, in the wheel's CSS and in the export
   string, is required rather than belt-and-braces — a `<polyline>` defaults
   to a black fill, and three collinear points only happen to enclose no
   area. Files: `core/walkArrow.ts` (new), `lib/WheelView.svelte`,
   `core/exporters/portrait.ts`.

**Deviation:** the plan asked the close-out to confirm the chevron under a
third of the old arrowhead's footprint "in both dimensions". The chevron's
path spans 2.70 × 4.68 user units against the old solid head's 12.6 × 11.2
— 21% along the line, 42% across it, exactly what the plan's own design
section predicted (~2.7 × 4.7 user units); no value in the sanctioned 8–12
tuning range for `WALK_CHEVRON_SIZE` reaches a third across (that would
need 7.2 or less), so the constants shipped untouched and the bar, not the
mark, is what was wrong. Including the chevron's ~1.53-unit round-capped
stroke, its visual bounding box runs roughly 4.2 × 6.2 user units against
the old head's 12.6 × 11.2 — about 19% of its area by bounding box, about
13% by actual ink.

**Verified in the browser** (Playwright over the running dev server, sample
library loaded across every playlist, fresh `localStorage`): 13/13 checks —
a rating filter pushed walk members off the wheel and their eight ghost
edges computed `stroke-dasharray: none` at `stroke-width: 1px` and
`stroke-opacity: 0.35` while the solid ones held 2px and 1; all 14 walk
edges rendered as `<polyline>` with computed `fill: none`, no element
anywhere in the wheel's SVG carried a `marker-end`, and the 13 edges at or
over the 16-unit threshold each carried three points and a `marker-mid`
against the one shorter edge's two; the chevron's path measured 2.70 × 4.68
user units — about 19% of the old arrowhead's area by bounding box (~4.2 ×
6.2 user units including its stroke), about 13% by ink — with 3.62 user
units of clearance between its leading tip and the nearest endpoint node's
r=11 hit-disc rim; a pointer-anchored zoom to k=4 shrank `markerWidth` from
9 to 2.25 user units and left the chevron's measured screen ink unchanged
at 2.73 × 4.73px (0.0% drift); `.manual-edge` still computed `6px 5px`, and
the wheel carried four dash patterns at rest — `.gridline.dashed` 3 5,
`.manual-edge` 6 5, `.hub-circle` 4 4, and `.retry-ring` 2 5 (tightening to
2 3 on hover or force-retry, five counting that state) — none of them a
walk edge; the reveal still dash-draws, `stroke-dashoffset` sampled over
298 rAF frames running 1 → 0 through 15 intermediate values, while a fresh
reduced-motion context held it at 0 with opacity 1 in every sampled frame;
and the portrait exporter's SVG, rendered into a page and screenshotted,
showed 14 chevron-carrying walk polylines, zero `marker-end` holders and
lines meeting the numbered badges cleanly — both themes, zoomed in and out,
zero console or page errors.

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

**v8** (v23) — ★ Starred, 🔗 Combos and 🎵 Keys became permanent left-panel
rows instead of ad-hoc controls, so `settings.visibleFilters` can now carry
their three pseudo-keys alongside every real `TrackSortField`. The back-fill
is version-gated rather than unconditional: `parseProject` (`persist.ts:427`)
only pushes a missing pseudo-key when `version < 8`, trusting a schema-8+
save's `visibleFilters` verbatim. Without the gate, a returning user's
deliberate hide of, say, 🎵 Keys could never survive a reload — every load
would silently re-add it; without the back-fill itself, every pre-v23 save
would silently lose the Keys row (and, before this wave, ★/🔗 could already
be hidden as ordinary marks filters) on its first load under the new code.
`parseProject` accepts v1–v8.
