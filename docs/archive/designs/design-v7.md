# Design v7 — Eighteen issues after using v6

Eighteen issues from real sessions with v6 (docs/ISSUES.md), covering wheel-geometry
polish, three large builds (a Tracks table view, multiple named sets, undo), an
app-wide colour scheme, and one investigation (the "inert" k/threshold sliders).
This document records the design decided with Michiel before implementation
(2026-07-16). One item supersedes a documented v6 invariant; it is called out below.

## The issues and their resolutions

| #   | Issue                                             | Resolution                                                                                                                                                 |
| --- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Default BPM range should be 8%                    | `DEFAULT_CRITERIA.bpm.maxPercent` 10 → 8 — the pitch-bend range of a classic Technics 1210 fader; the criterion was already percentage-based                 |
| 2   | Hotkeys, at least Cmd+Z                           | Cmd+Z / Cmd+Shift+Z undo/redo covering set edits and selection changes ONLY — deliberately the app's single global shortcut this release (§E)               |
| 3   | Genre map flies in from the top left              | Nodes without a cached position spawn at the map centre (tiny deterministic offsets) instead of d3's origin-spiral default, then physics spreads them        |
| 4   | Radius/Colour meaningless off the wheel           | The top-bar Radius/Colour selects and the wheel-only Display sliders (spread, edge opacity) disable + grey with a tooltip when the wheel isn't active        |
| 5   | Animations slightly too fast                      | The radial-domain tween 350 → 600 ms; the genre-map simulation cools slower (alphaDecay 0.02) with more damping (velocityDecay 0.5)                         |
| 6   | Replace-library warning looks foreign             | A generic in-app `ConfirmDialog` (ResetDialog's `<dialog>` idiom) replaces the native confirm(); sample-over-sample still replaces silently                  |
| 7   | A third central "Tracks" view                     | A sortable metadata table over the selected playlists with shared selection, connected-row highlighting, double-click append, and set-tag toggles (§F)      |
| 8   | Playlist/filter counts                            | The Playlists summary becomes "2/9 · 214 tracks" (selection's track total); the Filters summary counts visible over the SELECTED PLAYLISTS, not the library |
| 9   | Parentheticals in the combo-panel method dropdown | Short labels (`METHOD_LABEL`) in the combo panel with "Hybrid — recommended"; the advanced menu keeps the long labels (`METHOD_LABEL_LONG`) + explainers    |
| 10  | Advanced settings reorder                         | "Set order" + "Suggestions" merge into one **Set & suggestions** section, LAST and open; opener/closer/essential are chosen in the Tracks view, the menu only lists them read-only with ✕ remove buttons (§F) |
| 11  | k-nearest/threshold radios wrap badly             | The two radios split into separate labels inside a no-wrap `.mode-row` (the shared label's `flex-wrap: wrap` was the culprit)                               |
| 12  | k/threshold seem to have no effect                | Diagnosed §G: the wheel respects them (masked); the genre map ignored them. Now the map draws the criterion's REAL matches and the menu shows a live pair count |
| 13  | Colour scheme should tint the whole app           | `ACCENT_TOKENS` per theme × scheme stamped on `<html>` by theme.ts; blue = the app.css defaults (unit-test-enforced sync); surfaces stay neutral (§H)       |
| 14  | Genre checklist/classes scoped to playlists       | `scopedGenres` and `genreClasses` derive from the playlist-scoped library — **supersedes the v6 §B "symbols never reshuffle" invariant across playlist toggles** (§B) |
| 15  | Edge opacity dead in focus mode                   | `focusEdgeOpacity(base, inFocus)` derives both focus opacities from the setting (base 0.35 reproduces the old 0.6/0.05 contrast)                            |
| 16  | Same-key spread feels artificial                  | Pushback accepted: not uniform random jitter (collides in dense slots) but a stable seeded random ORDER with even spacing; 0–1 spread factor + ↻ re-jitter (§A) |
| 17  | Hub: hit target, disable, random, follow, retry   | Hub painted last with an oversized hit disk; greys out when every visible track is used; random opener per press; selection follows every pick; a dashed retry ring swaps the last pick (§C) |
| 18  | Nameable sets, generated indicator                | Multiple named sets (roadmap feature pulled forward): project schema v3, a switcher in the set panel, ordinal default names, a ✨ badge on untouched generator output (§D) |

Decisions taken with the user: undo covers set edits + selection only; the Tracks
view also appends to the set (double-click); the jitter design is the even-spacing
counter-proposal; sets are truly multiple (not one renamable set); genre shapes keep
similarity clustering but scope it to the selected playlists; the colour scheme
tints the accent family only; the genre map is wired to the criterion parameters
AND the menu gets a live matched-pair count; no hotkeys beyond undo/redo.

## §A Same-key fan order: stable jitter, not sorted sweeps

v6 sorted each slot's fan by the raw radial value, which made every fan a tidy
diagonal sweep — angle correlated with BPM, reading as an artifact. v7 orders each
slot by `hashUnit(trackId, jitterSeed)` (FNV-1a whitened through one mulberry32
step): random-looking, but a pure function of the id and a persisted seed, so
angles still never move under filtering, reloads, or playlist toggles. Even
spacing across the window is kept — uniform random OFFSETS (the original request)
would visibly clump at ~85 tracks per slot. `slotSpreadDeg` became
`slotSpreadFactor` (0–1 of the ±7.5° half-slot window, default 1; old saves
migrate by division); the ↻ button beside the slider draws a new seed and is the
seed's only writer.

## §B Playlist-scoped genres (supersedes v6 §B in part)

The genre checklist (`scopedGenres`) and the shape clustering (`genreClasses`) now
derive from the playlist-scoped library instead of the whole collection: a
2000-track collection's full genre list drowned the playlist actually being
worked. Within a fixed playlist selection the v6 rule still holds — range/genre
filtering never re-clusters and symbols never reshuffle — but toggling playlists
deliberately re-clusters to the new selection. Persisted genre-filter entries
outside the current scope simply don't render.

## §C Hub v2

Five fixes in one place (WheelView):

- **Paint order**: the hub renders after edges and nodes with a transparent r=46
  hit disk — nothing steals its clicks any more.
- **Random opener**: the empty-set, no-selection pick uses `randomStart` under
  `mulberry32(seed)` with a per-session random seed base — pressing again
  explores; `bestConnected` is gone.
- **Follow the pick**: after every hub pick `selectedId` jumps to the added
  track, so repeated presses continue from the head.
- **All-used disable**: `hubAllUsed` (every visible track in the set) greys the
  hub out (`pointer-events: none`, `aria-disabled`) instead of silently no-oping.
- **Retry ring**: a dashed outer ring appears while `retryAlternativeExists`
  (pure, adjacency-map based) says a different pick is possible; clicking swaps
  the last hub pick in place via `suggestNext`'s new `excludeIds` option (earlier
  retries stay excluded, so it cycles). Any external set edit closes the window.

## §D Multiple named sets, project schema v3

`Project.version = 3`: `sets: TrackSet[]` (`{id, name, trackIds, generated}`) +
`activeSetId` replace the flat `tracklist`. v1/v2 saves migrate their tracklist
into one un-generated "First Set"; garbage entries sanitize like tracks do; the
storage key is unchanged (it names the slot, not the schema).

The stores keep the historical `tracklist: Writable<string[]>` API as a custom
store backed by the active set — its ~19 call sites did not change. Manual
`set`/`update` clears the set's `generated` flag; the generator writes through
`setGeneratedTracklist`, which sets it — that flag drives the subtle ✨ badge
("untouched generated set") in the panel header. The header holds the switcher
(a select over the sets), inline rename (no native prompt), ＋ (next ordinal
name: First, Second, … Twelfth, then "Set 13"), and 🗑 (disabled at one set;
deleting the last one clears it instead). Suggestion history stays global-session;
pins/must-include stay global-session and untouched by switching — both
documented simplifications, not oversights.

## §E Undo

`src/core/history.ts` is a pure past/present/future stack over
`{trackIds, generated, selectedId}` snapshots (dedupe on deep-equal, limit 100).
`src/lib/undoStore.ts` subscribes to the active set + selection and records
everything not caused by an undo/redo itself; Cmd+Z / Cmd+Shift+Z live on one
window listener in App.svelte, skipped inside text fields and open dialogs. The
stack resets on set switches, library replacement, and project loads — undo never
resurrects one set's tracks into another. A generator overwrite is exactly one
store write, hence one undo step, and the snapshot carries `generated`, so
undoing it restores both the tracks and the badge. Known quirk: `suggestionIndex`
is not snapshotted, so after undoing a generated set the ◀/▶ arrows may point one
entry off. Deliberate non-goals: undo for settings/filters/criteria, undoable set
switching or deletion, more hotkeys.

## §F The Tracks view and the thinner advanced menu

The third central view (`viewMode: 'tracks'`) is a classic DJ-software browser:
one row per track of the SELECTED PLAYLISTS (`playlistScopedLibrary` — the range
and genre filters deliberately do not apply; it is a management surface, not the
graph). Columns sort per `sortTracks`: strings by locale, numbers numerically,
keys in Camelot order ("2A" before "10A"), missing values sinking to the bottom
in both directions. Clicking a row toggles the global selection and highlights
combo neighbours (`.connected`); double-click appends via the shared
`appendToSet`. Per-row toggles — ★ essential (must-include), ⏮ opener, ⏭ closer —
write the same session stores as the 📌 pins, and every tagged track wears a
subtle accent `tag-ring` behind its wheel dot.

The advanced menu consequently slims down (issue 10): the opener/closer `<select>`
pickers are gone; "Set order" and "Suggestions" merged into **Set & suggestions**,
placed last and open by default (the tuning sections start folded), holding the
generation parameters plus a read-only list of the current opener/closer/essential
choices with ✕ removes and a "Choose in the Tracks view →" button.

## §G The k/threshold investigation (issue 12)

Diagnosis: the wheel DOES respect mode/k/threshold — `makeGenreMatcher` rebuilds
reactively — but the effect is masked twice over (an edge needs 3-of-4 criteria,
so genre rarely is the swing vote; identical labels always match regardless).
The genre map, however, ignored the parameters entirely: it drew its own edges
from `labelSimilarity` over a fixed score floor and even seeded its overlay set
non-reactively. Fix: `matchedGenrePairs(genres, cfg)` in combos.ts computes the
exact label pairs the criterion links; the map's overlay for the SELECTED method
draws precisely those pairs (other overlay methods and ghost edges keep the
similarity view as comparative context), the criterion's method re-joins the
overlays whenever it changes, and the advanced menu shows a live
"N genre pairs in your library match" count beside the sliders.

## §H App-wide colour schemes

Blue/Aqua/Violet stop being node-only: `ACCENT_TOKENS[theme][scheme]` in
scales.ts carries `--accent`, `--on-accent`, `--walk`, `--walk-bright` per theme,
and theme.ts stamps them inline on `<html>` whenever the theme OR the scheme
changes. app.css keeps the blue values as its defaults, and a unit test asserts
`ACCENT_TOKENS.*.blue` equals them — the same sync contract as `MISSING_COLORS`.
All accent/on-accent pairs pass WCAG AA (4.5:1, tested). Surfaces, sector tints
and the genre-map method-overlay palette stay neutral/unchanged; the ☀/☾ theme
toggle is orthogonal.

## Non-goals

Guaranteed must-include placement and per-set pins (unchanged from v6); undo for
anything beyond set edits + selection; table virtualization (2080 rows render
fine with `content-visibility: auto`); more hotkeys; per-scheme surface tinting.
