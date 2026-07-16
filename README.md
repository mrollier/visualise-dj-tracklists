# visualise-dj-tracklists

A local-first web app that shows a DJ library as a **graph** instead of a list: tracks are
nodes on a Camelot-wheel polar view, suggested combos are edges computed from tunable
matching criteria (key adjacency, BPM, genre similarity, year), and a tracklist is a
visible **walk** woven through that structure.

Your library never leaves your machine — there is no backend, no account, no upload.

![The Camelot wheel with a demo set](docs/screenshots/wheel-with-set.png)

## What it does

- **Import** a Rekordbox XML collection export, a **Rekordbox playlist TXT export**
  (the UTF-16 tab-separated table — it becomes the library, a ready-checked playlist
  named after the file, _and_ your set in playlist order), a CSV, tagged audio files
  (ID3/Vorbis/MP4, read in the browser), or an **M3U8 playlist** — M3U8s become your
  set, matched against the library, and entries that aren't in the library yet pick
  up their metadata when you import the collection XML later. The **Load sample**
  button loads one **Sample collection**: ten themed fictional crates plus the
  classic demo, each as a playlist, behaving exactly like an imported collection.
- **Work per playlist**: any collection with playlists (XML or the sample) starts
  with an **empty wheel** and a Playlists panel on the left — toggle the playlists
  you want (plus a "Not in a playlist" bucket for the rest) instead of drowning in
  2000 nodes.
- **See the web**: key as angle on a 24-slot Camelot wheel (every harmonically compatible
  key angularly adjacent, minor/major sectors tinted), switchable radius (BPM / rating /
  year), node colour on its own axis. Tracks without a key sit in a labelled gutter at
  their true BPM. Zoom to resolve detail — node disks keep their size while the
  structure magnifies. When your library spans **clearly different genre families**,
  each family gets its own node shape (circle, square, triangle, …) — clustered in
  whichever similarity space you selected, capped by a "max genre classes" setting.
- **Nodes that hold still**: every track's angle is a property of your _library_,
  not of the current filters — filtering and playlist toggling only make nodes
  appear or disappear, leaving gaps in the same-key fans, so nothing ever shuffles
  around while you narrow down. Same-key fans spread evenly in a **stable random
  order** (no artificial BPM sweep); a ↻ button re-shuffles them, and the spread
  itself scales from 0 to 1. The one deliberate exception is the **radial axis**:
  tighten the min/max of the value shown as radius and the rings, ticks and radii
  glide to the new range (and back, via each filter's ↺ reset). The legend lists
  only the genre classes you can currently see, and disappears when the symbols
  make no distinction. Rating and year rings only sit on whole values.
- **Map the genres**: a second central view (Wheel | Genres | Tracks switch) lays your
  library's genres out with a force simulation — screen distance approximates the
  distance measure. Toggleable per-method edge overlays show where the six similarity
  methods agree and disagree — the overlay for your **active criterion method draws
  exactly the pairs the criterion links**, k/threshold included; hovering a link lists
  every method's score for that pair, and a "show nearby genres" toggle ghosts in
  related genres you don't own yet.
- **Browse the tracks**: the third central view is a classic sortable table of the
  selected playlists — every column sortable (keys in Camelot order, missing values
  last), clicking a row selects it everywhere and highlights its combo neighbours,
  double-click appends it to the set. Per-row toggles mark a track **essential** (★)
  or pin it as the **opener/closer** of generated sets; tagged tracks wear a subtle
  ring on the wheel.
- **Filter**: BPM / year / rating ranges plus a genre checklist **scoped to the
  selected playlists** decide what participates in the graph at all. Ranges pre-fill
  with the whole numbers just outside the selected playlists' actual extremes, reset
  to them with a ↺ per range (and whenever you toggle playlists), and a min can never
  cross its max. The filter header counts visible tracks against the playlist
  selection; the playlists header carries the selection's track total.
- **Tune the criteria**: key / BPM / genre / year each toggleable and ranged; an edge
  appears when at least _N_ of the enabled criteria match. Missing metadata never blocks
  a combo. The BPM tolerance defaults to **±8%** — the pitch range of a classic
  Technics fader. **Half/double-time** BPM matching links 85 ↔ 170 worlds; the **+2**
  and **+7-semitone** key moves toggle independently; **vinyl mode** models the physics
  of beatmatching on turntables — pitch shifts the key with the tempo, so keys are
  always compared _after_ that shift: same-key tracks at different tempos detune apart,
  and clean-semitone gaps transpose into new matches. Toggling it visibly rewires the
  graph.
- **Match genres that aren't spelled the same**: six selectable similarity methods
  (see below) — the dropdown sits right in the combo panel, sourced explainers and
  parameters in the advanced menu. The criterion defaults to the **hybrid** method
  with **mutual top-k** matching — each genre links to its k nearest genres in
  _your_ library when the closeness is mutual — which self-calibrates across dense
  (electronic) and sparse genre regions; a classic score threshold remains available.
  Umbrella tags ("Electronic", "Dance") never drive a match, and multi-genre fields
  ("House / Techno") match through their best component.
- **Weave a set**: click to focus (a card shows the selection's details), double-click
  to append (the same track can appear twice — just not back-to-back), or press the
  wheel's centre **＋ next** button to slot in the best next track (it inserts
  _between_ tracks when your selection sits mid-set; the selection then follows the
  pick, so pressing again continues from the head). A dashed **retry** ring appears
  around the hub while an alternative exists — clicking it swaps the last pick for a
  different one. When no track matches your criteria from there, the button pulses
  into a warning-coloured **force** state — clicking it knowingly breaks the rules
  with the closest non-matching pick — and it greys out once every visible track is
  in the set. **Cmd+Z / Cmd+Shift+Z** undo and redo set edits and selection changes.
  **Suggest a set** generates a full walk from a **random opener** each time; the
  ◀ / ▶ arrows step back to earlier suggestions or generate fresh ones.
- **Keep several sets**: the set panel's header is a switcher over **named sets** —
  ＋ starts a "Second Set" (then Third, …), ✎ renames inline, and a subtle ✨ badge
  marks a set that is untouched generator output (it disappears on the first manual
  edit). All sets persist with the project.
- **Shape the generated order**: pick the opening/closing track and the essential
  (must-include) tracks in the **Tracks view** — the same pins as 📌 on the set's
  first/last rows; with both ends set, the walk grows from both ends inward. The
  advanced menu's **Set & suggestions** section lists those choices (with ✕ to
  remove), and sets the **BPM progression** — steady, rising, falling, or a sawtooth
  that builds and drops in cycles — plus an **adventurousness** setting for how much
  dissonance the generator embraces.
- **Make it yours**: the advanced settings live in the right panel (swapping with
  the set) as collapsible sections, so the wheel reacts live while you tune
  without a wall of controls. The **colour scheme** (blue / aqua / violet) tints the
  whole app — accents, the set path, the genre map — not just the nodes; a ☀/☾
  switch flips between the dark and light theme (fresh visitors follow the system
  preference). The top bar stays lean: the imported collection's name plus an ⓘ
  whose tooltip holds the import details.
- **Take it with you**: export the set as M3U8 (Rekordbox re-imports it) or CSV; save
  the whole project as JSON — every export asks for a filename first. Everything
  autosaves to the browser; a Reset button (with confirmation) wipes the slate.

![A Rekordbox collection with the playlists panel](docs/screenshots/playlists.png)

![The Tracks table view with set tags](docs/screenshots/tracks-view.png)

![The advanced settings beside the wheel](docs/screenshots/advanced-filters.png)

![The light theme](docs/screenshots/light-mode.png)

## Genre similarity

"Tech House" and "Techno" are different strings but not unrelated music. The genre
criterion supports six methods (picked in the combo panel; parameters and sourced
explainers in advanced menu → Genre matching), implementing the
recommendations of a literature review on genre distance measures
([docs/designs/design-v4.md](docs/designs/design-v4.md) has the design; the research
reports live in [docs/research/](docs/research/), and
[docs/science/genre-distance-measures.md](docs/science/genre-distance-measures.md)
documents the technical choices, the evidence behind them, and the open questions):

| Method             | How it works                                                                                  | Data                                                              | Grounding                            |
| ------------------ | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------ |
| Exact              | normalized labels must be identical (aliases like DnB → Drum & Bass still unify)              | none                                                              | Schreiber 2015 (tag normalization)   |
| Lexical            | token-set Jaccard after normalization ("melodic house" ~ "house")                             | none                                                              | —                                    |
| Graph              | decay^(shortest path) over a curated genre-relation graph                                     | [src/data/genre-graph.json](src/data/genre-graph.json) — editable | Rada et al. 1989                     |
| Taxonomy           | Lin similarity over a rooted genre DAG with intrinsic information content                     | [src/data/genre-tree.json](src/data/genre-tree.json) — editable   | Lin 1998; Seco et al. 2004           |
| Embedding          | mutual-proximity-corrected similarity between tag co-occurrence embeddings                    | [src/data/genre-embedding.json](src/data/genre-embedding.json)    | Levy & Goldberg 2014; Schnitzer 2012 |
| Hybrid _(default)_ | the embedding retrofitted toward the curated tree — data plus lineage, best subgenre coverage | same pack, `hybrid` section                                       | Epure et al. 2020 (retrofitting)     |

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
npm test         # unit tests (keys, combos, genre, filters, importers, exporters, suggest, sets, history, persistence, samples)
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
insert-between-via-edge-drag, Rekordbox-XML playlist export, a 3D "set journey"
tunnel view, opt-in local audio analysis (Essentia.js), and fingerprint analytics over
imported tracklists.
