# visualise-dj-tracklists — v1 design & implementation plan

## Context

Michiel's working paper ([docs/visualise-dj-tracklists.pdf](docs/visualise-dj-tracklists.pdf)) proposes representing a DJ's library as a graph: tracks are **nodes** with metadata vectors (Camelot key, BPM, genre, year, rating…), suggested combos are **edges** formed when tunable criteria match, and a tracklist is a **walk** through the graph. V1 goal (user-confirmed): a clean, intuitive, local-first web app that lets a DJ import their library, see it on a Camelot-wheel polar view, tune combo criteria, and hand-build an ordered tracklist as a visible walk — "keep it simple at first." DJ-fingerprint analytics, 3D tunnel view, force layout, and auto-suggestion are explicitly deferred to the roadmap.

Key research findings baked into this design:
- Competing tools (Mixed In Key, DJ.Studio, MixOrMiss, various free Camelot widgets) all output *linear lists*; none show the library as an explorable graph with a walk overlaid. That's the differentiator.
- Spotify's audio-features API was deprecated Nov 2024 (403 for new apps) → no Spotify-derived data in v1. Metadata comes from the user's own Rekordbox library export; open-source local analysis (Essentia/KeyFinder) is a deferred, opt-in fallback.
- ISMIR 2020 (arXiv:2008.10267, 1,557 mixes from 1001Tracklists) confirms DJs favour small key/tempo deltas — supports both the combo criteria defaults and the later fingerprint stage.

## Decisions (user-confirmed)

| Decision | Choice |
|---|---|
| Platform | Local-first static web app, no backend, no accounts |
| Stack | Vite + Svelte 5 + TypeScript, D3 (scales/drag/zoom) rendering SVG, Vitest |
| Imports (v1) | Rekordbox XML export + CSV; ID3 tag reading is milestone 6 (post-core) |
| Views (v1) | Camelot wheel polar view only (key = angle, switchable radius) |
| 3D "tunnel" | Deferred to roadmap ("set journey" view, time as depth) |
| Name / repo | `visualise-dj-tracklists`, private GitHub repo |

## Architecture

Static SPA. Pure-TypeScript core (no DOM) + thin Svelte view layer, so the graph logic is unit-testable and reusable later (fingerprints, tunnel).

```
src/
  core/                    # pure TS, no Svelte imports — fully unit-tested
    model.ts               # Track, Combo(Edge), Tracklist(Walk), CriteriaConfig types
    keys.ts                # key normalization: Camelot / Open Key / classical → Camelot; wheel geometry (angle per key, A/B ring)
    combos.ts              # edge computation: pairwise criteria matching, threshold mode (N-of-M), per-criterion predicates
    importers/
      rekordbox.ts         # Rekordbox XML → Track[]
      csv.ts               # CSV (header-mapped) → Track[]
    exporters/
      m3u.ts               # tracklist → M3U8 (Rekordbox re-importable)
      csv.ts               # tracklist → CSV
    persist.ts             # project save/load: JSON file export/import + localStorage autosave
  lib/                     # Svelte components
    WheelView.svelte       # SVG polar plot: nodes, edges, walk overlay, hover, focus-dimming
    TracklistPanel.svelte  # ordered list: add/remove/drag-reorder, per-transition quality chips
    CriteriaPanel.svelte   # per-criterion toggles + ranges + threshold slider (collapsed by default)
    ImportDialog.svelte, Tooltip.svelte, TopBar.svelte
  stores.ts                # Svelte stores: library, criteria, tracklist, selection (derived: edges)
  App.svelte, main.ts
tests/                     # Vitest: keys, combos, importers, exporters round-trips
docs/                      # existing PDF + design doc (copied from this plan at implementation)
```

## Data model & core behaviour

**Track**: `id, title, artist, key (normalized Camelot e.g. "8A" | null), bpm, genre, year, rating (0–5), durationSec?, source fields kept raw for debugging`.

**Combo criteria** (PDF Table 1 + Fig 1), each individually toggleable with adjustable range:
- Key: adjacent on Camelot wheel — same key, ±1 same letter, A↔B same number (optional advanced moves +2/+7 off by default)
- BPM: within ±X% (default 10%; half/double-time toggle later)
- Genre: exact match (v1)
- Year: within ±N years (default 5)
- Rating: within ±N stars (default 1)

**Threshold mode** (v1, matches PDF Fig 1): edge exists iff ≥ T of the enabled criteria match; T slider from 1 to (#enabled). Weighted edges (opacity/width by match strength) are roadmap.

**Missing-data policy** (PDF Appendix item 3, explicit): a track missing a value for criterion C neither passes nor fails C — C is excluded from that pair's denominator, i.e. threshold compares against criteria evaluable for both tracks. Tracks with no key sit in a small "unkeyed" sector; missing radial value renders at a marked fallback radius with reduced opacity. Import report lists per-field missing counts.

**Wheel view** (PDF Appendix items 1–2, 4): key = angle (Camelot order), radius = BPM | rating | year (dropdown; BPM default), node colour = third parameter (rating default), major/minor shown by a subtle outer ring (B/major slightly outside A/minor) — no toggle needed. Hover → tooltip with full metadata. Select a track → neighbours within degree ≤ k highlighted, rest dimmed. Edges of the current walk drawn distinctly (colour + arrowheads) above suggestion edges.

**Tracklist builder**: right-hand panel, linear list with artist/title/key/BPM (PDF item 5). Click a highlighted node (or list row) to append; drag rows to reorder; delete inline. Each consecutive pair shows a transition-quality chip (which criteria match). Non-matching transitions are *allowed* but visibly flagged — the tool advises, the DJ decides. Export: M3U8 + CSV. Autosave to localStorage; explicit project export/import as JSON.

**UX principles** (user asked for design-theory grounding): progressive disclosure (criteria panel collapsed; sensible defaults on load), direct manipulation with immediate feedback (criteria changes re-render edges live), recognition over recall (legend always visible), dark-first palette suited to DJ context, colourblind-safe node colour scale (load the `dataviz` skill before writing any chart/colour code).

## Implementation milestones

1. **Scaffold & repo** — Vite+Svelte+TS project, ESLint/Prettier, Vitest; `git init`, initial commit; private GitHub repo via `gh repo create visualise-dj-tracklists --private`; GitHub Actions CI (lint + test + build). README stub. Copy design doc into `docs/`.
2. **Core: keys + model** (TDD) — key normalization from Camelot/Open Key/classical notations, wheel geometry helpers; fixtures for all 24 keys + malformed input.
3. **Core: importers** (TDD) — Rekordbox XML parser (build fixture from a real export; user to supply one, else construct from the documented format), CSV with header auto-mapping; import report (counts, missing fields).
4. **Core: combo engine** (TDD) — criteria predicates, missing-data rule, threshold logic; property-style tests (symmetry, threshold monotonicity).
5. **Wheel view** — SVG polar rendering, radial-axis switcher, colour encoding, tooltips, selection + focus dimming, live re-render on criteria change. Sample dataset bundled so the app demos without an import.
6. **Tracklist builder + persistence + exports** — panel, walk overlay, transition chips, M3U8/CSV export, localStorage autosave, JSON project files. Then ID3 tag import (`music-metadata` in browser, files never uploaded).
7. **Polish & verify** — empty states, import errors, keyboard a11y basics, README with screenshots.

## Roadmap (explicitly out of v1)

Force-layout "free" view → weighted edges + per-criterion weight sliders → insert-between-via-edge-drag → 3D tunnel "set journey" view (three.js) → Essentia.js opt-in local audio analysis → 1001tracklists ingestion, walk metrics, DJ fingerprints → suggestion engine.

## Verification

- `npm test` — core coverage: key normalization table, importer fixtures (Rekordbox XML, CSV), combo-engine cases incl. missing data, exporter round-trips.
- `npm run build` + `npm run dev`, then end-to-end by hand (or Playwright later): import sample Rekordbox XML → tune criteria, watch edge count change → select track, see neighbours → build a 5-track walk → reorder → export M3U8 and re-open it; reload page → tracklist restored from autosave.
- CI green on GitHub before calling any milestone done.

## Non-goals / guardrails

No backend, no accounts, no Spotify API, no audio upload. No auto-generated tracklists in v1. Keep `core/` free of DOM/Svelte imports. Any file trending past ~300 lines gets split.
