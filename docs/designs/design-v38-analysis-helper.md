# v38 — The analyser as a localhost helper, and descriptors in the tags

v34 shipped the offline analyser as a program you run in a terminal, and v35
surfaced its four descriptors as columns. The gap left over: getting results
*into the app* meant remembering a long command line, waiting, then finding the
sidecar in a file picker — for a playlist of twelve tracks as much as for the
whole library.

v38 closes it from both ends. The analyser can run as a small localhost helper
the app talks to, and it can write its own numbers into the files' comment tags
so they survive a Rekordbox round trip without a sidecar at all.

The app still never reads your disk on its own, and still never phones home:
the helper is a process **you** start, on 127.0.0.1, and the app only reaches
it while it is running.

## 1. `--serve`: one job, one machine, one origin

A stdlib `ThreadingHTTPServer` bound to 127.0.0.1 (default port 8765,
`--port` to move it). Three endpoints: `GET /status`, `POST /analyse`
(`{paths, writeTags, force}` → 202, or 409 while a job runs, or 400),
`GET /result`.

The security boundary is the `Origin` header, allow-listed against
`^https?://(localhost|127.0.0.1)(:port)?$`, and anything else gets 403. A
wildcard `Access-Control-Allow-Origin` would let any website you happen to have
open start a run on your machine — and, with `--write-tags`, modify your audio
files. A request with no `Origin` at all (curl) is allowed but gets no echo
back. The private-network preflight header is included so Chrome's PNA checks
pass.

One job at a time, guarded by a single lock: the analyser is CPU-bound across
every core, so a queue would only mean two runs finishing half as fast.
`run_batch()` was extracted out of `main()` so the CLI and the server share the
same pool, resume and flush machinery rather than growing a second copy.

## 2. `--write-tags`: the descriptors travel with the file

With `mutagen==1.47.0` (a new, optional dependency) the analyser appends a
compact token — `[A78V35D86H55]`, the four descriptors as 0–100 integers — to
each analysed file's comment tag: ID3 `COMM` (desc `''`) for MP3/AIFF/WAV,
`comment` for FLAC, `©cmt` for M4A.

`splice_token` strips any previous token and appends the new one, so it is
idempotent and **preserves Mixed In Key's own comment segments** — the app
parses those for key, BPM and energy, and eating them would cost more than the
token adds. Rounding is JavaScript's, not Python's: `floor(x + 0.5)`, never
banker's rounding, because the app re-derives the same integers from the same
floats. That cross-language contract is pinned by a shared vector
(`{5.37, 3.8, 0.898, 0.55}` ⇔ `[A55V35D90H55]`) asserted in both the Python
self-test and `tests/analysis-contract.test.ts`.

"Analyse first, tag later" works: a path already in the sidecar gets tagged
without `--force` re-analysing it.

## 3. The app side

- `parseDescriptorToken` (`model.ts`, beside `parseMikComment`) reads the
  bracket token at import. Its shape collides with none of the eight MIK
  comment formats.
- `mergeAnalysis` restructured: the `entryFor` join and the token fill run even
  with a null sidecar, so an XML-only import still gains descriptors. The token
  fills **nulls only**, so a matched sidecar entry — the precise original —
  always beats its own lossy export. A new `descriptorsFromComments` stat says
  where values came from.
- `mergeSidecars` (union, next wins per path) replaces the outright
  `analysis.set` in `TopBar`: a playlist-scoped helper run must **add to** a
  whole-library sidecar, never discard it. The union is bounded by unique file
  paths, so it costs the autosave nothing a full sidecar would not.
- New setting `analysisWriteTags` (default false, additive, no schema bump).

## 4. The panel

A seventh advanced section, "Sentiment analysis": an explainer, the scope and
an ETA (`estimateMinutes` = n / 16.7, the rate measured in v34), then one of
two states.

- **Helper online**: the write-tags checkbox, an Analyse button and a
  `ProgressBar`, polled every 2s through `src/lib/analysisHelper.ts`. The poll
  lives at module level so it survives closing the panel while a job runs, and
  fetches the result exactly once per `startedAt`.
- **Helper offline**: the `--serve` command in a copyable block, plus a button
  that exports the selected tracks' paths for `--paths-from`.

Verified end to end with synthesised WAVs through serve → write-tags → result.

## 5. Deliberately not built

Queueing, a cancel endpoint, auto-starting the helper, SSE instead of polling,
a port setting in the UI, tag writing from inside the browser, and any
Electron/Tauri packaging. Each was considered and each buys less than it costs
while one person runs one analysis at a time on one machine.
