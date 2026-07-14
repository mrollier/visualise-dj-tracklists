# visualise-dj-tracklists

A local-first web app that shows a DJ library as a **graph** instead of a list: tracks are
nodes on a Camelot-wheel polar view, suggested combos are edges computed from tunable
matching criteria (key adjacency, BPM, genre, year, rating), and a tracklist is a visible
**walk** woven through that structure.

Your library never leaves your machine — there is no backend, no account, no upload.

![The Camelot wheel with a three-track set](docs/screenshots/wheel-with-set.png)

## What it does (v1)

- **Import** a Rekordbox XML collection export, a CSV, or tagged audio files
  (ID3/Vorbis/MP4 tags, read in the browser) — or just load the bundled sample library.
- **See the web**: key as angle on a 24-slot Camelot wheel (arranged so every harmonically
  compatible key is angularly adjacent), a switchable radial axis (BPM / rating / year),
  node colour by rating.
- **Tune the criteria**: each of key / BPM / genre / year / rating can be toggled and
  ranged; an edge appears when at least _N_ of the enabled criteria match. Missing
  metadata never blocks a combo — only criteria known on both sides count.
- **Weave a set**: click a node to focus its neighbourhood, double-click to append it to
  your set. The walk is drawn on the wheel; every transition shows which criteria it
  satisfies. Reorder or remove tracks in the side panel.
- **Take it with you**: export the set as M3U8 (Rekordbox re-imports it) or CSV; save the
  whole project as JSON. Everything also autosaves to the browser.

![Focus dimming and track tooltip](docs/screenshots/focus-tooltip.png)

## Development

```sh
npm install
npm run dev      # start the app
npm test         # unit tests (core: keys, combos, importers, exporters, persistence)
npm run lint     # eslint + prettier check
npm run check    # svelte-check + tsc
npm run build    # production build
node scripts/screenshot.mjs out/   # drive the app headlessly + screenshots (needs dev server)
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
per-criterion weight sliders, insert-between-via-edge-drag, a 3D "set journey" tunnel
view, opt-in local audio analysis (Essentia.js), and DJ fingerprint analytics over
imported tracklists.
