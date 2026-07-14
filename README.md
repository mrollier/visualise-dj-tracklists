# visualise-dj-tracklists

A local-first web app that shows a DJ library as a **graph** instead of a list: tracks are
nodes on a Camelot-wheel polar view, suggested combos are edges computed from tunable
matching criteria (key adjacency, BPM, genre, year, rating), and a tracklist is a visible
**walk** woven through that structure.

Your library never leaves your machine — there is no backend, no account, no upload.

## Status

Early development. See [docs/design-v1.md](docs/design-v1.md) for the full v1 design and
roadmap, and [docs/visualise-dj-tracklists.pdf](docs/visualise-dj-tracklists.pdf) for the
original concept paper.

## Development

```sh
npm install
npm run dev      # start the app
npm test         # run unit tests
npm run lint     # eslint + prettier check
npm run check    # svelte-check + tsc
npm run build    # production build
```

## V1 scope

- Import a library from a Rekordbox XML export or CSV (ID3 tags later)
- Camelot wheel view: key as angle, switchable radial axis (BPM / rating / year)
- Tunable combo criteria with an N-of-M threshold, edges re-render live
- Build, reorder and export (M3U8 / CSV) a tracklist as a highlighted walk
