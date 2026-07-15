# visualise-dj-tracklists

A local-first web app that shows a DJ library as a **graph** instead of a list: tracks are
nodes on a Camelot-wheel polar view, suggested combos are edges computed from tunable
matching criteria (key adjacency, BPM, genre similarity, year), and a tracklist is a
visible **walk** woven through that structure.

Your library never leaves your machine — there is no backend, no account, no upload.

![The Camelot wheel with a demo set](docs/screenshots/wheel-with-set.png)

## What it does

- **Import** a Rekordbox XML collection export, a CSV, tagged audio files (ID3/Vorbis/MP4,
  read in the browser), or an **M3U8 playlist** — playlists become your set, matched
  against the library, ready to reorder. Playlist entries that aren't in the library yet
  automatically pick up their metadata when you import the collection XML later. Or load
  one of **ten themed sample libraries** (advanced menu), each with a demo set.
- **See the web**: key as angle on a 24-slot Camelot wheel (every harmonically compatible
  key angularly adjacent, minor/major sectors tinted), switchable radius (BPM / rating /
  year), node colour on its own axis. Tracks without a key sit in a labelled gutter at
  their true BPM. Zoom to resolve detail — node disks keep their size while the
  structure magnifies. When your library spans **clearly different genre families**,
  each family gets its own node shape (circle, square, triangle, …) — clustered in
  whichever similarity space you selected, capped by a "max genre classes" setting.
- **Map the genres**: a second central view (Wheel | Genres switch) lays your library's
  genres out with a force simulation — screen distance approximates the distance
  measure. Toggleable per-method edge overlays show where the six similarity methods
  agree and disagree; hovering a link lists every method's score for that pair, and a
  "show nearby genres" toggle ghosts in related genres you don't own yet.
- **Filter**: BPM / year / rating ranges (pre-filled with your library's actual extremes)
  plus an alphabetical genre checklist decide what participates in the graph at all.
- **Tune the criteria**: key / BPM / genre / year each toggleable and ranged; an edge
  appears when at least _N_ of the enabled criteria match. Missing metadata never blocks
  a combo. **Half/double-time** BPM matching links 85 ↔ 170 worlds; **vinyl mode**
  accounts for pitch: beatmatching on turntables transposes the key along with the
  tempo, and keys are compared after that shift.
- **Match genres that aren't spelled the same**: six selectable similarity methods
  (see below) with sourced explainers in the advanced menu. The criterion defaults to
  **mutual top-k** matching — each genre links to its k nearest genres in _your_
  library when the closeness is mutual — which self-calibrates across dense
  (electronic) and sparse genre regions; a classic score threshold remains available.
  Umbrella tags ("Electronic", "Dance") never drive a match, and multi-genre fields
  ("House / Techno") match through their best component.
- **Weave a set**: click to focus, double-click to append, or press the wheel's centre
  **＋ next** button to slot in the best next track (it inserts _between_ tracks when
  your selection sits mid-set). **Suggest a set** generates a full walk; the ◀ / ▶
  arrows step back to earlier suggestions or generate fresh ones — no confirmations.
  An **adventurousness** setting controls how much dissonance the generator embraces,
  with continuous genre similarity always part of the ranking.
- **Take it with you**: export the set as M3U8 (Rekordbox re-imports it) or CSV; save the
  whole project as JSON. Everything autosaves to the browser; a Reset button (with
  confirmation) wipes the slate.

![The advanced menu over the filtered wheel](docs/screenshots/advanced-filters.png)

## Genre similarity

"Tech House" and "Techno" are different strings but not unrelated music. The genre
criterion supports six methods (advanced menu → Genre matching), implementing the
recommendations of a literature review on genre distance measures
([docs/designs/design-v4.md](docs/designs/design-v4.md) has the design; the full report
lives in [docs/research/](docs/research/)):

| Method              | How it works                                                                                  | Data                                                              | Grounding                            |
| ------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| Exact               | normalized labels must be identical (aliases like DnB → Drum & Bass still unify)              | none                                                              | Schreiber 2015 (tag normalization)   |
| Lexical _(default)_ | token-set Jaccard after normalization ("melodic house" ~ "house")                             | none                                                              | —                                    |
| Graph               | decay^(shortest path) over a curated genre-relation graph                                     | [src/data/genre-graph.json](src/data/genre-graph.json) — editable | Rada et al. 1989                     |
| Taxonomy            | Lin similarity over a rooted genre DAG with intrinsic information content                     | [src/data/genre-tree.json](src/data/genre-tree.json) — editable   | Lin 1998; Seco et al. 2004           |
| Embedding           | mutual-proximity-corrected similarity between tag co-occurrence embeddings                    | [src/data/genre-embedding.json](src/data/genre-embedding.json)    | Levy & Goldberg 2014; Schnitzer 2012 |
| Hybrid              | the embedding retrofitted toward the curated tree — data plus lineage, best subgenre coverage | same pack, `hybrid` section                                       | Epure et al. 2020 (retrofitting)     |

The bundled pack is built from the
[MediaEval AcousticBrainz Genre Dataset](https://mtg.github.io/acousticbrainz-genre-dataset/)
(ground-truth annotations for ~2 million recordings from Discogs, Last.fm and Tagtraum;
**CC BY-NC-SA 4.0** — the pack is a derived work, so it inherits the non-commercial
share-alike terms). Pipeline: label co-occurrence → PPMI (rare-pair noise floor) →
**truncated SVD** (d=32, chosen by sweeping dimensions against a built-in triplet eval) →
cosine → **Mutual Proximity** (hubness fix) → per-label top-20 neighbour lists, umbrella
tags damped. The hybrid section retrofits the embedding toward
[genre-tree.json](src/data/genre-tree.json), which also gives tree-only club genres
(liquid drum & bass, melodic techno, …) usable vectors — it scores 100% on the triplet
eval vs the plain embedding's 91%. To rebuild:

```sh
# download the three open *-train.tsv.bz2 ground-truth files from
# https://zenodo.org/records/2553414 into data/acousticbrainz/ and bunzip2 them
node scripts/build-genre-embedding.mjs --from-acousticbrainz data/acousticbrainz
node scripts/build-genre-embedding.mjs --from-acousticbrainz data/acousticbrainz --sweep  # dimension sweep
node scripts/build-genre-embedding.mjs   # graph-diffusion starter pack instead
```

Unknown labels fall back to lexical similarity in the graph, taxonomy, embedding and
hybrid methods.

![The genre map view with method overlays and nearby-genre ghosts](docs/screenshots/genre-map.png)

## Development

```sh
npm install
npm run dev      # start the app
npm test         # unit tests (keys, combos, genre, filters, importers, exporters, suggest, persistence, samples)
npm run lint     # eslint + prettier check
npm run check    # svelte-check + tsc
npm run build    # production build
node scripts/screenshot.mjs out/   # drive the app headlessly through every flow (needs dev server)
```

The core (`src/core/`) is pure TypeScript with no DOM or Svelte imports — the graph
logic is reusable and fully unit-tested. The Svelte components in `src/lib/` are a thin
view layer over it.

## Background & roadmap

The concept — track set graphs, track vector walks, and DJ "fingerprints" as statistics
over walks — is laid out in the concept paper at
[docs/visualise-dj-tracklists.pdf](docs/visualise-dj-tracklists.pdf); the v1 design and
decisions live in [docs/designs/](docs/designs/).

Planned next (in rough order): force-layout "free" view for _tracks_ (the genre map
already ships the d3-force groundwork), weighted edges with per-criterion weight
sliders, walk-quality metrics (the first step toward DJ fingerprints),
insert-between-via-edge-drag, a sortable library table view, undo/redo,
multiple named sets per project, Rekordbox-XML playlist export, a 3D "set journey"
tunnel view, opt-in local audio analysis (Essentia.js), and fingerprint analytics over
imported tracklists.
