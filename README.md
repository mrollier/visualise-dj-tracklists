# visualise-dj-tracklists

A local-first web app that shows a DJ library as a **graph** instead of a list: tracks are
nodes on a Camelot-wheel polar view, suggested combos are edges computed from tunable
matching criteria (key adjacency, BPM, genre similarity, year), and a tracklist is a
visible **walk** woven through that structure.

Your library never leaves your machine — there is no backend, no account, no upload.

![The Camelot wheel with a suggested set](docs/screenshots/wheel-with-set.png)

## What it does

- **Import** a Rekordbox XML collection export, a CSV, tagged audio files (ID3/Vorbis/MP4,
  read in the browser), or an **M3U8 playlist** — playlists become your set, matched
  against the library, ready to reorder. Or just load the bundled sample library.
- **See the web**: key as angle on a 24-slot Camelot wheel (arranged so every harmonically
  compatible key is angularly adjacent), switchable radius (BPM / rating / year), node
  colour on its own axis (auto-complementary to the radius). Tracks without a key sit in
  a labelled gutter at their true BPM; the dashed centre ring marks "no value". Zoom and
  pan freely.
- **Filter**: BPM / year / rating ranges plus an alphabetical genre checklist decide what
  participates in the graph at all.
- **Tune the criteria**: key / BPM / genre / year each toggleable and ranged; an edge
  appears when at least _N_ of the enabled criteria match. Missing metadata never blocks
  a combo — only criteria known on both sides count.
- **Match genres that aren't spelled the same**: four selectable similarity methods
  (see below), with a threshold slider in the advanced menu.
- **Weave a set**: click to focus a neighbourhood, double-click to append; every
  transition shows which criteria it satisfies. Or press **Suggest a set** for a greedy
  walk from your selected track through the combo graph, then edit from there.
- **Take it with you**: export the set as M3U8 (Rekordbox re-imports it) or CSV; save the
  whole project as JSON. Everything autosaves to the browser; a Reset button (with
  confirmation) wipes the slate.

![Filters and the advanced menu](docs/screenshots/advanced-filters.png)

## Genre similarity

"Tech House" and "Techno" are different strings but not unrelated music. The genre
criterion supports four methods (advanced menu → Genre matching), grounded in the music
information retrieval literature on genre taxonomies and tag normalization:

| Method    | How it works                                                                     | Data                                                              |
| --------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Exact     | normalized labels must be identical (aliases like DnB → Drum & Bass still unify) | none                                                              |
| Lexical   | token overlap after normalization ("tech house" ~ "deep house")                  | none                                                              |
| Graph     | decay^(shortest path) over a curated genre-relation graph                        | [src/data/genre-graph.json](src/data/genre-graph.json) — editable |
| Embedding | cosine similarity between genre vectors                                          | [src/data/genre-embedding.json](src/data/genre-embedding.json)    |

The bundled embedding pack is a **starter** derived from the curated graph (diffusion +
random projection) so the pipeline works out of the box. To build a real co-occurrence
pack from the [AcousticBrainz genre dataset](https://mtg.github.io/acousticbrainz-genre-dataset/)
(CC-licensed TSVs; label co-occurrence → PPMI → projection):

```sh
node scripts/build-genre-embedding.mjs --from-acousticbrainz path/to/tsv-dir
```

Unknown labels fall back to lexical similarity in both the graph and embedding methods.

## Development

```sh
npm install
npm run dev      # start the app
npm test         # unit tests (keys, combos, genre, filters, importers, exporters, suggest, persistence)
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
per-criterion weight sliders, half/double-time BPM matching, walk-quality metrics
(the first step toward DJ fingerprints), insert-between-via-edge-drag, a 3D "set
journey" tunnel view, opt-in local audio analysis (Essentia.js), and fingerprint
analytics over imported tracklists.
