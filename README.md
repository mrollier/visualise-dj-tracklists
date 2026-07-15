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
  structure magnifies.
- **Filter**: BPM / year / rating ranges (pre-filled with your library's actual extremes)
  plus an alphabetical genre checklist decide what participates in the graph at all.
- **Tune the criteria**: key / BPM / genre / year each toggleable and ranged; an edge
  appears when at least _N_ of the enabled criteria match. Missing metadata never blocks
  a combo. **Half/double-time** BPM matching links 85 ↔ 170 worlds; **vinyl mode**
  accounts for pitch: beatmatching on turntables transposes the key along with the
  tempo, and keys are compared after that shift.
- **Match genres that aren't spelled the same**: four selectable similarity methods
  (see below), with a threshold slider and per-method explainers in the advanced menu.
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
criterion supports four methods (advanced menu → Genre matching), grounded in the music
information retrieval literature on genre taxonomies and tag normalization:

| Method              | How it works                                                                     | Data                                                              |
| ------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Exact               | normalized labels must be identical (aliases like DnB → Drum & Bass still unify) | none                                                              |
| Lexical _(default)_ | token overlap after normalization ("melodic house" ~ "house")                    | none                                                              |
| Graph               | decay^(shortest path) over a curated genre-relation graph                        | [src/data/genre-graph.json](src/data/genre-graph.json) — editable |
| Embedding           | cosine similarity between co-occurrence vectors                                  | [src/data/genre-embedding.json](src/data/genre-embedding.json)    |

The bundled embedding pack is built from the
[MediaEval AcousticBrainz Genre Dataset](https://mtg.github.io/acousticbrainz-genre-dataset/)
(ground-truth annotations for ~2 million recordings from Discogs, Last.fm and Tagtraum;
**CC BY-NC-SA 4.0** — the pack is a derived work, so it inherits the non-commercial
share-alike terms). Label co-occurrence → PPMI → random projection, 400 genres, 24 dims.
To rebuild it (or regenerate the graph-derived starter pack):

```sh
# download the three open *-train.tsv.bz2 ground-truth files from
# https://zenodo.org/records/2553414 into data/acousticbrainz/ and bunzip2 them
node scripts/build-genre-embedding.mjs --from-acousticbrainz data/acousticbrainz
node scripts/build-genre-embedding.mjs   # graph-diffusion starter pack instead
```

Unknown labels fall back to lexical similarity in both the graph and embedding methods.

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
decisions live in [docs/design-v1.md](docs/design-v1.md).

Planned next (in rough order): force-layout "free" view, weighted edges with
per-criterion weight sliders, walk-quality metrics (the first step toward DJ
fingerprints), insert-between-via-edge-drag, a sortable library table view, undo/redo,
multiple named sets per project, Rekordbox-XML playlist export, a 3D "set journey"
tunnel view, opt-in local audio analysis (Essentia.js), and fingerprint analytics over
imported tracklists.
