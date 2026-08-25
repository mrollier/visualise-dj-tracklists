# Design v33 — audio-analysis provenance layer (WS1)

The first workstream of the audio-analysis design in
[../research/claude-research-audio-analysis.md](../research/claude-research-audio-analysis.md).
Pure TypeScript: the sidecar format, the merge semantics, and the provenance
UI. No Python, no audio libraries, no new dependencies.

WS1 ships before any analyser exists, and that ordering is the point. It fixes
the JSON contract WS2 must write against, and a multi-hour batch over 2080
files is far too expensive a way to discover a schema mistake. Its acceptance
bar is therefore "a hand-written sidecar lights up the app", not "real data
flows".

## The constraint everything else follows from

**Rekordbox metadata is authoritative and is never overwritten.** Its key and
BPM analysis is better than anything this feature will invoke, and the app has
said so since v1 — `README.md` ("deliberately not a key/BPM analyzer"),
`ISSUES.md` V1 ("the app never edits track metadata"), `model.ts:3` ("Missing
metadata is null, never a guess").

This is enforced structurally rather than by policy. Analysis data lives in its
own store, keyed by file path, and joins tracks only in a *derived* layer. The
raw `library` store — which feeds persistence, the importers and the CSV
exporter — is never touched, so a non-null Rekordbox value is not merely
deprioritised by the merge, it is unreachable by it.

### The positioning tension, named

`README.md:296` says the app is "deliberately **not** a key/BPM analyzer (it
reads what Rekordbox already computed)", while `README.md:411` roadmaps
"opt-in local audio analysis". Those survive together only because of how this
is built: opt-in, fill-nulls-only, badge-marked. The claim will need an honest
qualifier when WS2 lands. Recorded here so the review that notices it does not
have to relitigate the design. `tests/branding.test.ts` guards the Camelot
trademark wording only, so nothing fails automatically.

## What it buys

Measured against the real collection (`docs/rekordbox/collection.xml`, 2080
tracks, verified 2026-08-25): **22 tracks missing BPM, 33 missing key**, 305
missing genre. Genre is out of scope — only WS5's embeddings reach it.

The 33 keyless tracks currently sit in the wheel's gutter and grow no combo
edges whatsoever. Moving them onto the ring is the visible payoff, and it is
the acceptance test.

Also present: 31 Rekordbox sampler one-shots
(`…/Sampler/OSC_SAMPLER/PRESET ONESHOT/NOISE.wav`). Several are among the
missing-BPM entries. They are why confidence gating exists — a one-shot must
never acquire a key.

## The sidecar

```jsonc
{
  "zodiacAnalysis": 1,
  "run": { "analysedAt": "…", "tool": "essentia-tensorflow 2.1b6", "models": ["…"] },
  "tracks": {
    "/Users/…/track.mp3": {
      "bpm": 128.02, "bpmConf": 0.93,
      "key": "8A",   "keyConf": 0.81,
      "arousal": 0.71, "valence": 0.62,
      "energy": 7, "happiness": 0.62, "danceability": 0.88
    }
  }
}
```

`zodiacAnalysis: 1` is the sidecar's own format version, independent of the
project schema number, and doubles as the import discriminator. `tracks` is
keyed by full decoded absolute path — the one identifier an offline script
walking the filesystem and a `Track` parsed from Rekordbox XML both possess.

**Two routes to energy, and the direct one wins.** `energy` is a direct 1–10
value from a producer that already has one (a Mixed In Key export, a hand
correction). `arousal`/`valence` are raw model output, from which the app
derives energy via `energyFromArousal()`. A present `energy` is used as-is;
otherwise energy is derived. Never both.

This is what makes the layer producer-agnostic, which the report names as its
whole purpose ("one provenance layer, two producers"). It also means the
unsettled calibration question cannot invalidate the format.

**Confidence gating** honours "null, never a guess": a below-threshold BPM or
key is written as `null` with its confidence still recorded, so the value is
absent but the fact that it was attempted is not.

`happiness` and `danceability` are stored in the sidecar and read from it
directly. They are **not** merged onto `Track`, which has no such fields;
adding them would touch `EMPTY_TRACK_FIELDS`, `TRACK_PROPERTIES` and
`migrateColumns`, and would break the pinned counts in `tests/properties.test.ts`
and `tests/columns.test.ts`. That is WS4. `mergeAnalysis` fills exactly three
fields: `bpm`, `key`, `energy`.

## Matching

No new matcher. v28 shipped `core/audio/pathMatch.ts` for the audio preview:
bucket by folded basename, break ties on common suffix depth, and **refuse
ambiguous ties rather than guess**. Its header comment argues the case, and the
case is identical here — attaching the wrong BPM and key to a track would
corrupt the exact judgement this feature exists to support, invisibly and
permanently.

The report predates v28 and proposed extracting a matcher from
`importers/m3u.ts` instead. That one does a plain `byBasename.set(...)`, so two
files sharing a basename silently overwrite each other, last one wins. For an
M3U import a wrong match is a visible, recoverable metadata row; here it would
not be. Do not extract a second matcher.

```ts
const index = buildFileIndex(
  Object.keys(sidecar.tracks).map((key) => ({ path: locationSegments(key), handle: key })),
)
const m = matchLocation(index, track.location)   // 'hit' | 'ambiguous' | 'miss'
```

Three notes:

- **Feed the two sides asymmetrically.** Sidecar keys are already decoded
  absolute paths; `Track.location` is a percent-encoded `file://localhost/…`
  URL. `matchLocation` decodes, which is right for the track side and wrong for
  the sidecar side — a filename genuinely containing `%20` would become a
  space. Build the index with `foldSegments(key.split('/').filter(Boolean))`.
- Run the sidecar's key string through `normalizeKey` (the `persist.ts:176`
  precedent), or `"8A "` or `"Ab minor"` lands raw in a `CamelotKey` field.
- `matchSegments` returns `depth: 0` when a basename bucket holds one entry.
  Fine here, but `depth` is free — report depth-0 hits alongside the ambiguous
  count.

## The graph

```
  library (raw) ──┬─────────────────────────────► persistence, importers
                  │                                CSV export, trackById
                  │
                  └──► augmentedLibrary ──┬──► visibleLibrary ──► combos, edges
       analysis ──────►                   ├──► playlistScopedLibrary
                                          ├──► WheelView (six reads)
                                          └──► TracksView column widths
```

**The wheel places nodes from the full raw library, in six separate reads** —
`WheelView.svelte:207, 285, 422, 582, 594, 627` — and decides gutter-versus-ring
on `track.key === null`. So repointing only `visibleLibrary` and
`playlistScopedLibrary` would leave a filled-key track parked in the gutter
while the Tracks table showed it correctly, with the radial domain and node
placement disagreeing about energy. The headline benefit would be silently
absent. All six move.

**`trackById` stays raw**, and this is a correctness requirement, not a
preference. `walkTracks` (`TracklistPanel.svelte:53`) resolves through it and
feeds the CSV export; `exporters/csv.ts` writes precisely the headers
`importers/csv.ts` maps back onto `Track`. Augmenting it would create a
two-click path — export CSV, re-import — after which analysed values *are* the
library, indistinguishable from Rekordbox truth and impossible to un-apply. Its
actual consumers only resolve membership by id and need nothing filled.

Also staying raw: `FiltersSection.svelte:106` (an identity sentinel for "fresh
library" — augmenting it would reseed the panel on every analysis change),
`TopBar`'s M3U re-match (it writes back), and everything reading only `.length`,
ids or `location`.

**`augmentedLibrary` returns the `$library` array itself** when the sidecar is
null or fills nothing — the idiom `applyPlaylistFilter` already uses
(`filter.ts:402`). Two lines, and it makes the app byte-identical to today
whenever the feature is unused. Without it, `TracklistPanel:263-269`
reference-compares `$visibleLibrary` and an analysis load would close the ⚡
force window.

**No new store diamond.** `stores.ts:344-352` documents a two-level diamond
that escapes Svelte's pending-bit guard. `augmentedLibrary` neither creates
another nor worsens it: nothing else feeding `visibleLibrary` descends from
`library` or `analysis`, and taking index 0 preserves every existing relative
subscribe order.

## Persistence

**No schema bump.** `analysis` is additive with a safe default, matching the
`audioPreview` (v28), `showLeftPanel`/`showRightPanel` (v30) and
`avoidSameArtist` (v31) precedent, each already commented as such in
`persist.ts`. An old save has no key, gets `null`, behaves exactly as today.

The argument against bumping is stronger than cost. `parseProject` throws on an
unknown version, and `restoreAutosave` deliberately preserves a save it cannot
read — "a rolled-back bundle meeting a newer schema may still be readable by
the next one". Bumping would make any bundle rollback brick autosave restore
entirely — library, sets, filters, all of it — over one optional field an older
build would have ignored.

Lifecycle:

- `replaceLibrary()` — **unchanged**. It clears `manualEdges` because ids do
  not survive a re-import; the sidecar is path-keyed and must survive one. A
  multi-hour batch is not disposable. Adding nothing to this function is the
  entire discipline.
- `resetEverything()` — clears `analysis`.
- `startAutosave()` — subscribes `analysis`.
- `applyProject()` — must set `analysis`, or the tour's save/restore drops it
  on "return to my work".

### The quota breach

The report estimated the sidecar at 300–500 KB and concluded it fits
localStorage. Measured, serialised the way `serializeProject` actually does it
(`JSON.stringify(project, null, 2)`):

| | UTF-16 bytes |
| --- | --- |
| tracks array today, pretty | 3.4 MB |
| sidecar for 2080 entries, pretty | 1.6 MB |
| project total after this change | **≈5.1 MB** |

Against a 5 MB per-origin cap. Mean decoded path length is 96 characters across
2080 locations, so the keys alone are 200 KB. This is Michiel's own library; it
breaches.

The failure mode is worse than the breach. `startAutosave` swallows
`QuotaExceededError` (`persistence.ts:241-243`), so the *whole project* would
stop autosaving — sets, filters, criteria — silently, from a feature nobody
would connect to the loss.

Two fixes, both in this wave. First, drop the indent for the autosave copy
only: `JSON.stringify(currentProject())` rather than `serializeProject(...)`.
`serializeProject` stays for the file download, where hand-editable pretty JSON
is the point, and `parseProject` does not care about whitespace. That alone
takes the total to ≈3.9 MB. Second, stop swallowing the error — set a store
flag in the catch and surface it next to the library name.

## The import seam

The `.json` branch of `onFileChosen` (`TopBar.svelte:79-87`) hands the file
straight to `parseProject`, which throws on a sidecar. Parse the text once,
check the `zodiacAnalysis` discriminator, route before `parseProject` sees it.

A sidecar import must **not** raise the replace-library confirmation — it adds
a layer, it does not replace the library. It reports through `lastImportReport`
in the established style:

> BPM filled 19/22, key 30/33, energy 2041; 6 below confidence; 12 files not found

## Provenance UI

`analysedFieldsById` (`Map<trackId, Set<field>>`) drives the marking.

`TracksView` renders every column except `rating` and `colour` through one
generic `<td>{formatPropertyValue(track, field)}</td>` (`:689-697`), and bpm,
key and energy all sit in that branch — so the badge is a single edit there.
`SelectedTrackCard` is per-field markup (`:59-66`) with Key, BPM and Genre and
no Energy row at all; the same two attributes go on two `<dd>`s.

**A dotted underline plus a native `title`, not the report's `≈128` glyph.**
`TracksView` uses `table-layout: fixed` with a `<colgroup>` whose widths are
canvas-measured from the full library (`:85-109`), and cells are `nowrap` with
no `overflow: hidden` outside `.ellipsis` — an over-wide cell spills rather
than ellipsising. A prefix glyph costs width the colgroup does not know about.
The underline costs none.

The measurement pass must itself read the augmented store, since
`formatPropertyValue` returns `—` for a null BPM today and `128.02` is wider. A
sidecar load will therefore reflow columns; that is acceptable, being a
library-level change like an import, but the v24 invariant comment at `:84`
says no filter or mark toggle may reflow a column and needs extending or it
reads as broken.

Not `InfoTooltip` per cell — each instance mounts a fixed-position panel, runs
an `$effect` and registers window listeners; 500 rows × 3 columns is a
non-starter. Use it once, to explain what the marker means.

Analysed **energy** is the least trustworthy field and applies to the most
tracks. The badge is doing real work there, not decoration.

## Testing shape

`tests/analysis.test.ts`, node env, all pure — mirroring the
`src/core/*.ts` ↔ `tests/*.test.ts` convention. The invariant test ("a non-null
Rekordbox value is never replaced") is written first. Also: sanitize/reject
field by field; hit, miss and ambiguous matching; `location: null` is a miss;
confidence gating yields null; `energyFromArousal()` boundaries and direct-
`energy` precedence; `augmentedLibrary` returns the same array reference when
nothing is filled; CSV export emits Rekordbox truth.

`tests/effective.test.ts` is the precedent — the `effective*` layer is the same
shape and is node-testable.

`sanitizeAnalysis` must `isRecord`-guard the `tracks` map itself, not only its
entries, or a hand-edited `"tracks": []` becomes an object with numeric keys.

Energy precedence needs no code and no special case: `energyFromComments`
already runs inside both `sanitizeTrack` and the Rekordbox importer, so a Mixed
In Key tag is a non-null `energy` before the merge ever sees it. Fill-nulls-only
gives it precedence for free. Assert it; do not build it.

**What the suite cannot catch.** `.svelte` files have no coverage in this repo.
The six `WheelView` reads and the column-width pass are invisible to CI — they
will pass green and be wrong on screen. `scripts/screenshot.mjs` is the only
gate that sees them, and it has a documented history of passing green while
stale, so it needs new assertions rather than trust.

## The calibration question

The report claims "~20 MIK-tagged tracks double as a free calibration set" for
analysed energy, and plans for WS2 to print a Pearson r against them.

**The collection holds six.** Values 4, 4, 5, 6, 6, 7, plus one unparseable
"Very high energy". Three of the six are by the same artist, all fall between
112 and 128 BPM, and all are house-adjacent — no techno, no jungle, no ambient,
all of which the library contains. It is not merely a small calibration set, it
is a biased one, and a correlation over n=6 is meaningless. Correct the report
in place so WS2 does not chase a statistic that does not exist.

Incidentally, those comments carry Mixed In Key's *key* estimate too, and two
of five disagree with Rekordbox (`8A` vs `7A`, `7B` vs `6A`). Real disagreement
between two respected tools on real tracks — which is why the sidecar keeps the
analysed value even where Rekordbox has one, stored and unsurfaced, so a later
disagreement report costs no re-analysis.

### What the research concluded (2026-08-25)

Decisions here are WS2's, recorded now so the work is not redone.

**Mixed In Key is worth buying as a training set, not as the pipeline.** MIK 11
is €58 one-time (~€70 with VAT), native Apple Silicon, three machines, 30-day
refund. It tags MP3, AIFF and M4A; only WAV is excluded, where their FAQ says
verbatim that "it analyzes, but it doesn't tag the files". For this library
that is 94 files — coverage is 1986/2080, **95.5%**. It writes `Energy N` into
Comments, Rekordbox's *Reload Tags* re-reads file metadata without re-analysing
waveforms or beatgrids, and `energyFromComments` already parses the result —
which is exactly why the six existing tags match the regex. MIK wrote them.

So €58 does not buy a calibration set of six; it buys ~1986 labelled tracks in
the right genres. Fitting the arousal curve against those lets the analyser
reproduce MIK on the 94 WAVs and on every future track with no ongoing
dependency — cheaper than hand-rating the 50–60 tracks the literature calls the
floor, and better data.

**Three corrections to the report's technical plan**, from primary sources:

- There is **no EffNet-Discogs arousal/valence head**. MTG trained one for the
  MusAV paper and never released it, and that paper found EffNet embeddings
  "consistently worst in the case of arousal". Use `emomusic-msd-musicnn-2` or
  `emomusic-audioset-vggish-2`; never `muse-*` (arousal Pearson 0.11).
- The output tensor is **`(valence, arousal)` — arousal is index 1**, despite
  the model being named `arousal_valence`. Range is the annotation range [1, 9],
  but the head is a linear regressor trained on unnormalised targets, so
  predictions fall outside it. Clamp, and average the per-patch predictions
  (~3 s window, ~1.5 s hop) over the track.
- Arousal is predicted **well**: ~86% pairwise ordering accuracy on MusAV's
  external validation, better than Spotify's own `energy` feature (83.3%), with
  MTG stating they "consider the 'energy' descriptor in the Spotify API as
  arousal". MTG's published metrics have a transposed CCC column; true arousal
  CCC is ~0.81.

**Mixed In Key Energy is absolute, not library-relative** — settled by patent
US 8,865,993 B2, which correlates a track against a fixed database of
human-rated reference compositions, measuring beat-aligned percussive transient
density across 14 frequency bands. Not loudness, not BPM. This rules out the
tempting shortcut: a decile map over the library would not reproduce MIK. A
dance library genuinely clusters at 6–8 — MIK's own documentation says level 10
is rare across their entire Beatport collection — so equal deciles would
fabricate 1s and 10s that do not exist and clash with the six real values.

**Public datasets.** The one useful anchor is **DEAM** (1.3 GB, free): the
emoMusic head was trained on `song_id` 2–1000, so `song_id > 1000` yields 1058
genuinely held-out clips with 1–9 arousal labels on the model's own scale. Its
labels sit at mean 4.81, sd 1.29 and never reach the ends of the scale, so
model output will be compressed — the map needed is a stretch, not a rescale.
AcousticBrainz is still live and CC0 but carries no energy or arousal, only
pre-deep-learning SVM classifiers. Spotify's `energy` endpoint closed to new
apps in November 2024 and its terms forbid the scraped dumps. The Million Song
Dataset's energy field was never populated.

**For WS2's environment:** install only `essentia-tensorflow`, never alongside
`essentia` — they own the same namespace, which is what broke the one open
arm64 issue. It bundles libtensorflow (115 MB wheel), needs only
`numpy`/`pyyaml`/`six`, and has arm64 wheels for Python 3.9–3.14. Import is
`from essentia.standard import TensorflowPredictMusiCNN`. Budget 2–4 hours
single-threaded for 2080 tracks, well under an hour across cores; load the
model once per process. Models are CC BY-NC-SA 4.0 — redistributable with
attribution and ShareAlike, so they may be vendored, though keeping them
script-side is simpler. The binding constraint is NonCommercial, not AGPL.

Worth extracting in the same pass: `mood_party`, `mood_aggressive`,
`mood_relaxed`, `onset_rate` and `beats_loudness_band_ratio`. The patent says
MIK measures beat-aligned transient density, so those are conceptually closer
to it than arousal is, and having them on disk makes testing that free. Verify
class index order empirically — MTG's prose and JSON disagree for several heads.

## Deliberate non-goals

Recorded, as in v14.1 and v32, so the next survey does not re-flag settled
decisions.

- **No Python, no audio libraries, no new dependencies.** That is WS2.
- **No disagreement UI.** Analysed values are stored where Rekordbox already
  has one, but nothing surfaces them this wave.
- **No calibration slider.** `energyFromArousal()` ships as a pure function over
  a named constant, marked with a `ponytail:` comment naming the upgrade path.
- **No `src/core/match.ts` extraction.** v28's matcher is better.
- **`happiness` / `danceability` are stored but never merged onto `Track`.**
- **No undo integration.** `undoStore` snapshots sets, selection, settings,
  criteria and marks — never the library. An analysis load should not be
  undoable and will not be. Do not add `analysis` to `tuningOf`.
- **No schema bump.**
- **No decile/percentile energy mapping**, for the reasons above.

## Deferred

- **WS2**, the offline analyser, and the Mixed In Key purchase decision that
  precedes it.
- **WS3**, the in-app essentia.js gap-fill analyser.
- **WS4**, `happiness` and `danceability` joining `TrackSortField` and the
  property registry.
- **WS5**, genre embeddings for the 305 blank-genre tracks.
- **The README positioning qualifier**, due when WS2 lands.
- **A per-track disagreement report** over analysed-versus-Rekordbox values.
  The data will already be stored; only the surface is missing.

## Verified

_To fill in as the wave lands._

## Not verified

_To fill in as the wave lands._
