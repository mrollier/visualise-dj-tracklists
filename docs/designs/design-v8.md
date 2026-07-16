# Design v8 — Eighteen issues after using v7

Eighteen issues from real sessions with v7 (docs/ISSUES.md), headlined by a retry
state machine on the hub, icon modes decoupled from the combo criterion, BPM
matching at metric ratios, a seven-part Tracks-view upgrade, and the unification
of named sets with the suggestion browser. This document records the design
decided with Michiel before implementation (2026-07-16).

## The issues and their resolutions

| #   | Issue                                          | Resolution                                                                                                                                                          |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Track count in the Playlists title superfluous | The Playlists summary reads just "2/9" again (reverting part of v7 issue 8); the Filters summary keeps the track totals                                                |
| 2   | Retry hidden when Force appears                | The ring shows whenever the last hub pick can still be swapped — including in force state, where retrying the previous step matters most (§A)                          |
| 3   | Retry should degrade, not disappear            | Retry → **force retry** (animated morph, + a ⟲ restore-original button) → **reset-only** when everything has been tried. NO auto-reset — the user decides (§A)         |
| 4   | Criterion method reshuffles the icons          | Node shapes never follow the combo criterion any more: the clusters mode is pinned to the hybrid space, and the new default doesn't cluster at all (§B)                |
| 5   | Playlist-based icons; study the clustering     | An `iconMode` setting: **genre families** (curated tree, the new default), **playlists** (first selected wins), **clusters** (hybrid-pinned legacy) (§B)                |
| 6   | Half/double to advanced; 2/3 time; unit time   | Advanced → **Key & BPM** holds ± unit time (default ON), ± half/double, ± 2/3 time (3:2, triplet ↔ four-on-the-floor); the combo panel warns when unit time is off (§C) |
| 7   | Hybrid should top the method list              | `METHOD_PICK_ORDER` (hybrid first) drives both method dropdowns; `GENRE_METHODS` keeps the simple→rich order for the map's chips and colours                            |
| 8   | BPM tolerance down to 0%                       | The % input accepts 0 = exact-BPM match (the core already treated 0 correctly; a test pins it)                                                                          |
| 9   | Focus card overlaps the legend                 | The selected-track card docks bottom-RIGHT (beside the zoom controls); while it shows, the legend's right bound retreats so the two can never collide                   |
| 10  | Minor/major-only option                        | A both/minor/major segmented control in the key criterion block — semantically a FILTER (`filters.keyRing`); the excluded ring's sector tint fades out (§D)             |
| 11  | Draggable genre nodes                          | Pointer-based dragging pins the node under the cursor and reheats the simulation; release lets it re-settle. Pure play, nothing persisted                              |
| 12  | 'exact' does nothing on the genre map          | Correct, provably: one node per NORMALIZED label means identical labels are the same node. The chip is gone; criterion=exact shows a one-line note                      |
| 13  | Method chips wrap to two lines                 | Five chips (after dropping 'exact') on one `nowrap` line — the old `max-width: 70%` + `flex-wrap: wrap` was the culprit                                                |
| 14  | Edge tooltips unusable in dense maps           | The **pair inspector**: click genre A, click genre B → a docked card locks with every method's score and a ● for methods currently drawing the pair (§E)                |
| 15  | Seven Tracks-view improvements                 | See §F — sort persistence, header-drag column order, optional Album/Date added/Length columns, star ratings, pin-lit ★, and the ＋→position cell                        |
| 16  | Force should prefer ±2/±7 semitones            | Forced ranking adds `KEY_AFFINITY_BONUS` (0.3) when the keys match under relaxed +2/+7 opts (vinyl-aware) — below the 0.5 genre weight, so it re-ranks near-ties (§A)   |
| 17  | Advanced menu: closed first, then remembered   | All sections fold on first open; `settings.advancedOpen` remembers what the user keeps open, across sessions (§G — with a Svelte 5 war story)                           |
| 18  | Sets and the suggestion browser are one thing  | `suggestionHistory` is gone: ◀/▶ + the dropdown browse ≤ 8 named sets; ✨ regenerates an untouched set IN PLACE, else starts a new one (§H)                              |

Decisions taken with the user: no auto-reset when the retry cycle exhausts
(reset-only waits for ⟲); retry scope stays hub-placed picks; icon modes are all
three (families default); playlist-icon conflicts resolve to the first selected
playlist in panel order, size then panel order caps the symbol budget; ✨
regenerates in place; append affordance in the Tracks view is the ＋ cell that
becomes the position number (double-click removed there); Album + Date added are
the new model fields; column reorder is header drag; the unit-time-off warning
ships.

## §A The retry state machine and the forced key preference

`retryState(neighbours, tracklist, lastPick, triedIds, visibleIds)` in
suggest.ts replaces `retryAlternativeExists` with four states:

- **retry** — the anchor still has an unused, untried criteria-matching
  neighbour (for the opener slot: any unused, untried visible track).
- **force-retry** — matching options exhausted, but an untried visible track
  remains: the ring adopts the force palette (animated dash morph) and grows a
  ⟲ button that restores the slot's ORIGINAL pick and reopens the cycle.
- **reset-only** — everything has been tried: the ring dims to a trace, only ⟲
  acts, and nothing happens automatically.
- **none** — no valid pick to swap, or a lone original with no alternatives.

The view tracks `originalPickId` (set on each fresh hub pick, surviving
retries, dying with the invalidation effect) and `triedIds` (the cycle's
exclusions; ⟲ clears them). The ring is now visible in the hub's force state —
issue 2's complaint — because the state machine looks at the LAST pick, not the
next one.

Forced picks (issue 16): the forced ranking adds 0.3 when
`keysNearlyMatch(anchor, candidate)` — the key criterion evaluated with plusTwo
and plusSeven forced on, vinyl mode still respected. Normal (edge-gated)
ranking is unchanged, pinned by a test.

## §B Icon modes (supersedes criterion-coupled clustering)

`settings.iconMode`:

- **families** (default): each primary genre maps to its family — the first
  family-level node on its primary lineage in the curated genre tree, where
  family level = the root's children with 'electronic' replaced by ITS children
  (house, techno, trance, breakbeat, …). Deterministic, explainable, and never
  reshuffles under criterion changes. Unknown labels stay circles.
- **playlists**: a track's class is the FIRST selected playlist (panel order)
  containing it; beyond the symbol budget the largest playlists keep a symbol
  (ties: panel order). The genre map falls back to circles here — its nodes are
  genres, which have no single playlist.
- **clusters**: v7's average-linkage similarity clustering, now pinned to the
  hybrid space — the combo criterion's method no longer moves icons (issue 4).

All modes share `IconClassification` (`classOf` keyed by genre label or track
id + `keyedBy`), resolved through `classIndexOfTrack` so the views don't care.
`maxGenreClasses` caps the symbol classes in every mode; class 0 (largest)
keeps the circle.

## §C BPM at metric ratios

`criteria.bpm` grows `unitTime` (default ON) and `twoThirds` alongside
`halfDouble`; `bpmCompatibleRatio` tries every enabled ratio (1; 2 and ½;
3∕2 and ⅔), each within the same % tolerance, unit first. 2/3 time links
triplet and four-on-the-floor worlds (128 ↔ 192). Vinyl mode needs no special
case: an exact 3:2 metric ratio leaves the platter speed unchanged, so the
existing residual-semitone formula covers it (a test pins this). The combo
panel shows the active ratio set and turns warning-coloured when unit time is
off — that switch deliberately strips the ordinary matches, and with all three
ratios off the BPM criterion is evaluable but never true (legal, loudly hinted,
never silently re-enabled).

## §D The minor/major filter

`filters.keyRing: 'both' | 'minor' | 'major'` — a visibility filter living in
`applyFilters` (keyless tracks always pass), CONTROLLED from the key criterion
block because that is where Michiel reaches for it. The wheel answers the
toggle beyond nodes vanishing: the excluded ring's twelve sector tints fade to
15% with a CSS transition and their key labels mute. `playlistScopedLibrary`
deliberately ignores it, like every non-playlist filter.

## §E The genre-map pair inspector

Click a node → highlight + "click a second genre to compare" hint card; click a
second → a docked card (top-right, fixed position — not mouse-following) locks
with the pair's score under every map method and a ● marking methods that
currently draw the pair (the criterion method uses the criterion's REAL pair
set, others the score floor). A third click starts a fresh selection;
background click or ✕ clears; the locked pair's edges render heavier. Dragging
(issue 11) never counts as a select-click — suppression works by time window,
not a consumable flag, so a swallowed click can never leak onto the next one.

## §F The Tracks view, part two

- **Sort persistence**: the sort lives in a session store, surviving view
  switches (not persisted — like `viewMode`).
- **Columns**: `settings.trackColumns` is an ordered list = membership AND
  position. The advanced menu's **Tracks table** section toggles membership
  (all ten fields: the classic seven + Album, Date added, Length); dragging a
  header reorders. Album and DateAdded are new Track model fields read from
  the Rekordbox XML (DateAdded is when the file entered the library — the XML
  carries no release date beyond Year); old saves parse them as null and gain
  them on re-import.
- **Stars**: ratings render as ★★★★☆ (numeric sort unchanged).
- **Pin ⇒ ★**: a pinned opener/closer shows its ★ as on and disabled —
  derived display ("included via pin"), the mustInclude store is untouched.
- **The ＋/position cell**: a fixed first column; ＋ (hover-visible) appends,
  and once the track is in the ACTIVE set the cell shows its 1-based position
  number(s) — Michiel's seventh point folded into the sixth. Double-click
  append is REMOVED in this view (it fought text selection), and rows are
  `user-select: none`.

## §G Advanced-menu section memory

`settings.advancedOpen` (default `[]` — everything folds on first use)
remembers the open sections across sessions. Svelte 5 lesson, recorded because
it cost three attempts: `<details open={expr}>` is a CONTROLLED attribute —
Svelte re-asserts the declared value after every user toggle, so both a
reactive and a static one-way attribute permanently slam the sections shut.
The working shape is `bind:open` (a local mirror initialised from settings)
plus a **synchronous** `ontoggle` persister — a deferred `$effect` is discarded
when the panel unmounts right after a toggle and silently forgets the change.

## §H Sets are the suggestion browser

`suggestionHistory`/`suggestionIndex` are deleted. The set panel's header now
reads ◀ [dropdown] ▶ ✎ ＋ 🗑, navigating at most **8** sets (`MAX_SETS`;
loading a save with more keeps the first eight). One **✨ Suggest** button:

- Active set untouched generator output (✨ badge) or empty → regenerate **in
  place**. Each regeneration is a single store write, so **Cmd+Z steps back
  through successive suggestions** — the old ◀-history restored through the
  undo stack, per set and better scoped.
- Active set hand-edited → a NEW set is created and generated into (next
  ordinal name); the edited set is never overwritten.
- Cap reached and the active set hand-edited → ✨ disables with an explanatory
  title; ＋ likewise disables at eight.

Pins and must-include marks stay session-global and are NOT set edits — pinning
a closer on a generated set keeps it regenerable in place.

## Non-goals

Auto-reset when the retry cycle exhausts (the ⟲ waits for the user); retrying
non-hub tracks (generator/manual edits are covered by undo); per-set pins
(unchanged from v6/v7); playlist icons on the genre map; persisting the Tracks
sort or the view mode; a release-date field (the Rekordbox XML only carries
Year and DateAdded).
