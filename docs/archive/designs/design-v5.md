# Design v5 — Fifteen remarks after using v4

Fifteen usage remarks from the first real sessions with v4, covering bug fixes, UX
corrections, and three new features. This document records the design decided with
Michiel before implementation (2026-07-15).

## The remarks and their resolutions

| #   | Remark                                                     | Resolution                                                                                                                                        |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Genre toggle larger than Filters toggle                    | Nested "Genres" summary gets the same `micro-label` treatment as "Filters"                                                                        |
| 2   | Filtering rescales the wheel's axes                        | Radial domain, colour domain, and ticks derive from the **full library**; filters only add/remove nodes on a static background                    |
| 3   | Genre filtering reshuffles shapes and the legend           | Genre classes derive from the full library too; the legend always shows **all** classes, greying out those with no visible tracks                 |
| 4   | Same-key spread too wide                                   | `slotSpreadDeg` default and slider max become **7.5°** (half a 15° sector)                                                                        |
| 5   | Advanced menu overlaps the wheel                           | Advanced settings render **in the right aside** (where "Your set" lives), toggled — the wheel stays visible while adjusting                       |
| 6   | Vinyl mode has no visible effect                           | **Strict physical model** (below): keys compared *after* the beatmatch pitch shift — removes and adds edges                                       |
| 7   | Import real Rekordbox data (TXT playlist + collection XML) | TXT importer (UTF-16 TSV) → **library + set in playlist order**; XML gains a **Playlists panel** with per-playlist toggles, none on by default    |
| 8   | Generated sets always start with the same track            | Random first track by default; **pin toggles** on the set's first and last rows fix endpoints across regenerations                                |
| 9   | +2/+7 semitone moves are one toggle                        | Two independent checkboxes (`plusTwo`, `plusSeven`); saved `advancedMoves: true` migrates to both on                                              |
| 10  | Edge opacity / similarity floors stop at 0.05              | Slider minima become 0                                                                                                                            |
| 11  | Load Sample should cycle like set suggestions              | Sample-pack history with ◀ previous / new ▶ arrows; pool = the themed packs + the classic demo                                                    |
| 12  | Dark/light switch                                          | Token-based theming; default follows `prefers-color-scheme`, the switch overrides and persists                                                    |
| 13  | No value indicators on the gutter axis                     | Subtle numeric labels beside the existing tick crossbars                                                                                          |
| 14  | Fractional ticks (rating 4.6) are meaningless              | Rating and year ticks filtered to whole values                                                                                                    |
| 15  | Adding the same track twice crashes                        | Duplicates allowed (immediate repeats still blocked); the id-keyed walk-pair render becomes index-keyed                                           |

Decisions taken with the user: TXT import = library **and** set; the playlists panel
includes a **"Not in a playlist"** pseudo-playlist rather than an "entire collection"
toggle; vinyl mode uses the strict physical model; theme default follows the system.

## A. Static background (remarks 2, 3)

The wheel's frame — radial scale, ring ticks, colour domain, genre-class assignment,
legend — is a property of the **library**, not of the current filter state. All of it
now derives from `library`; only the node set derives from `visibleLibrary`. Filtering
(ranges, genres, playlists) adds or removes nodes on an unchanging background, and a
genre keeps its symbol no matter what is filtered. Legend chips for classes with no
visible tracks stay in place, greyed.

## B. Strict vinyl mode (remark 6)

Beatmatching on turntables changes pitch with tempo. If track B must be sped up 5% to
match track A, everything in B — including its key — shifts up ~0.85 semitone. The v4
implementation only *added* matches (plain same-key comparison still applied across any
tempo gap), so toggling it barely changed the graph. v5 models the physics:

- Both BPMs known and vinyl mode on → the un-shifted comparison **never** applies.
- The tempo ratio needed to beatmatch (within the BPM tolerance = the pitch-fader
  range, half/double bridges allowed) determines the pitch shift in semitones.
- Shift within ±0.35 st of a whole number → compare `key(A)` against `key(B)`
  transposed by that many semitones (+7 Camelot steps per semitone). Near-zero shift
  degrades to the plain comparison.
- Fractional shift (detuned) or unbeatmatchable gap → **no key match**.
- A missing BPM on either side falls back to the plain comparison.

Same-key tracks 5% apart in tempo therefore *lose* their key edge in vinyl mode, and
tracks a clean semitone apart *gain* one — the toggle now visibly rewires the graph.

## C. Set generator: random start, pinned endpoints (remark 8)

`suggestWalk` starts from a uniformly random connected track (drawn from the walk's
seeded PRNG, so the ◀/▶ history stays reproducible) instead of the deterministic
best-connected node. DJs often fix the opener and closer: the set's first and last rows
get pin toggles. A pinned first track seeds the walk; a pinned last track engages
**two-armed growth** — the walk grows from both endpoints, extending whichever arm has
the better candidate (with a small convergence bonus toward the other arm's tip), and
joins in the middle. The seam pair is not guaranteed to be a combo edge; the walk
renders it like any other transition.

## D. Rekordbox imports (remark 7)

**TXT playlist export** (`Unicode text, UTF-16 LE`, tab-separated, columns
`# / Artist / Track Title / Album / Genre / BPM / Rating(★ as asterisks) / Time(MM:SS) /
Key(Camelot) / Date Added`): a dedicated importer decodes by BOM, maps the header row,
and produces both a library and the set in file order — one file, full picture.

**Collection XML**: the importer now also reads `DJ_PLAYLISTS.PLAYLISTS` — a tree of
`NODE` elements (folders `Type=0`, playlists `Type=1`) whose members reference
collection `TrackID`s. Imported playlists appear in a new **Playlists** section at the
top of the left panel. When a collection carries playlists, **none are selected by
default** and the wheel starts empty (with a hint), because a 2000-track collection is
neither readable nor fast as one graph. A **"Not in a playlist"** pseudo-entry keeps
every track reachable. Playlist selection is a filter: it intersects with the range and
genre filters and never rescales the static background. Playlists and the selection
persist with the project (schema stays v2, merge-defaults).

The user's real exports live in `docs/rekordbox/` and are **gitignored** (personal
data); tests use small synthetic fixtures with the same shape.

## E. Layout & theming (remarks 5, 11, 12)

- The advanced settings move from a dropdown overlaying the wheel into the right
  aside, swapping with "Your set" (transient `rightPanel` store). Changes are visible
  live on the wheel.
- "Load sample" adopts the suggestion-history pattern: first click loads a random
  sample pack **with its demo set**; ◀/▶ browse the history / load fresh packs.
  Confirmation only guards non-sample libraries.
- Theming: the dark tokens stay on `:root`; a full light set lives under
  `:root[data-theme='light']`. First paint follows `prefers-color-scheme`; the TopBar
  sun/moon switch overrides and persists (`settings.theme`, `null` = system). The
  genre-map method palette and node ramps are re-validated against the light surface.

## F. Small fixes (remarks 1, 4, 9, 10, 13, 14, 15)

As per the table: consistent summary typography; 7.5° spread cap; independent +2/+7
checkboxes with migration; zero-floor sliders; labelled gutter ticks; integer-only
rating/year ticks; duplicate tracks allowed with index-keyed walk rendering.

## Non-goals

- No virtualisation for the full-collection worst case ("Not in a playlist" with
  ~1650 tracks selected) — playlist selection is the intended workflow.
- Pins and the right-panel mode are transient (not persisted), like the view switch.
- No new file formats beyond TXT/XML (M3U8, CSV, audio tags already exist).
