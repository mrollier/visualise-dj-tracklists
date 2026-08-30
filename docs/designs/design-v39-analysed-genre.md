# v39 — The analysed genre: Discogs400 as a second opinion

Genre drives node shape, node colour, the genre map and one of the combo
criteria, and the real library's genres are thin: 160 distinct labels over 2080
tracks, 305 tracks with none at all, and a long tail nothing can use
(`Nieuw!!!`, `90s`, `Loop Samples`). The question was whether an open-source
model can supply a *second, independent* genre opinion that is fine-grained
rather than "everything is Electronic".

The answer had to be measured before anything was built, so the wave ran as a
measurement pass with a written go/no-go, then the app work, then a follow-up
(v39.1) that fixed what the first integration got wrong about *matching*.

Rule that never moves: the Rekordbox genre is **never overwritten**. The
prediction is a parallel value and a setting chooses which one the app reads,
exactly like v36's `keySource` / `bpmSource`.

## 1. The measurement, and the gate it had to pass

`--genre` (Discogs-EffNet embedding → `genre_discogs400` head, top 3 styles per
track) over the whole library, then `--genre-report`, which reads a finished
sidecar back and prints granularity, consistency and confidence — no audio.

| | |
|---|---|
| Coverage | 2046 / 2046 tracks, zero failures, ~30 min at 8 workers |
| Speed | EffNet **3.5× faster** than the v34 MusiCNN pass (2.9–3.7 s vs 10.1–13.9 s per track, 1 thread) |
| Granularity | 131 distinct styles predicted, top style 16% of the library |
| Consistency | NMI 0.554 against the DJ's own labels (constant predictor 0.000); reverse purity 0.51 against a 0.21 Jungle prior |
| Examples | Funky House → House 0.85, Tribe → **Tribal** 0.65, Jungle → Jungle 0.52, Turkish Funk → Funk ~0.30 |
| Junk in, junk out | his catch-all "Electronic" → House 0.17, as it should be |

The pre-registered gate (60% of labels with n ≥ 10 reaching a dominant style at
purity ≥ 0.5) **fails at cutoff 0** (42%) and **passes at 0.30** (64%, keeping
70% of the library). That is where the default confidence threshold comes from —
it was chosen by the data, not picked.

## 2. What ships in the analyser

- `--genre`: `MonoLoader(16 kHz)` → `TensorflowPredictEffnetDiscogs` →
  `TensorflowPredict2D`, mean over frames, top 3 written as
  `genre: [[label, score] × 3]`. It reuses `run_batch`, the worker pool, the
  excludes and `load_existing`, so a genre pass **augments** an existing
  sidecar instead of replacing the v34/v35 descriptors.
- `--genre-report`: the numbers in section 1, recomputable at any cutoff.
- `fetch-models.sh` gains the EffNet embedder, the head, and the head's `.json`
  (it carries the 400 class names the output vector indexes).
- `scripts/build-discogs-genres.mjs` → `src/data/discogs-genres.json`: the
  model's labels are `Parent---Style` over 15 Discogs top-level genres, so the
  taxonomy comes free. Only the 15 parents are a judgement call.

## 3. Shape in the app

- `Track.analysedGenre` / `analysedGenreScore` (registry entries 33 and 34, so
  the column and the filter come free), **stripped by `serializeProject`** —
  they are derived, and two dead keys × 2000 tracks is ~90 KB against a 5 MB
  localStorage cap.
- Substitution happens in `mergeAnalysis`, **not** `applySourcePreference`:
  that layer runs *before* the sidecar merge, so it cannot see a prediction.
  The threshold is read at merge time, so moving the slider re-decides without
  re-analysing anything.
- Settings `genreSource` (`rekordbox` | `analysis`) and `genreThreshold`, both
  additive, in the advanced menu's Genre matching section.
- 87% of predictions land on labels the curated alias table already knew; one
  alias was added (`synth pop` → `synthpop`).

## 4. The trap: never widen the genre tree for information content

`genre-tree.json` feeds Lin similarity, whose information content is computed
from the node set. Merging the 381 Discogs styles into it naively grows N from
114 to 440 and **raises every umbrella's IC** — `electronic` 0.043 → 0.176,
techno↔house 0.169 → **0.419**, techno↔jungle 0.095 → 0.307 — destroying the
"umbrellas near the root cannot drive a match" property Lin was chosen for.

So `treeParents` is widened for **lineage only**: `treeIC` and `FAMILY_LEVEL`
are built from `genreTree.parents` alone, and an added leaf simply gets IC 1
(having an IC at all is what routes it through Lin instead of the lexical
fallback). Curated pairs then score bit-for-bit as before — pinned in
`tests/genre.test.ts`. `FAMILY_LEVEL` stays curated for the same reason: the
widened tree hangs ~120 styles off `electronic`, which would turn a handful of
icon families into a hundred.

## 5. v39.1 — the confidence slider and the two vocabularies

The first integration also made the slider useless for matching, in two steps,
both worth recording.

**The false start.** Partial substitution splits the vocabulary: a threshold
that swaps one track of a pair to the model's word and leaves the other on the
DJ's puts "Tribal" beside "Tribe", which link in *no* method. The first fix
carried both labels in a `matchGenre` field, which removed the cost — and with
it every qualitative effect of the slider. Measured over the whole sweep:
334114 → 249831 matched pairs with **15 gains in total**. The only tracks it
could still move were the 384 with no genre of their own. Correctly identified
by Michiel as "the slider is a volume knob".

**The fix.** `matchGenre` is deleted. Instead `learnGenreBridge` reads the
library's own (label, predicted style) pairs — the vote is per genre
*component*, needs n ≥ 3 and a majority — and produces aliases: 26 on the real
library, including `tribe → tribal` 0.64, `jungle → drum & bass` 0.93,
`funky house → house` 0.86, `goa → goa trance` 1.00. `setGenreBridge` installs
them as module state from the `merged` derived in `stores.ts`, because every
matcher (wheel, genre map, set panel, suggestions) has to agree about what
matches; threading a table through eight call sites was the alternative.

They apply twice, and both halves are load-bearing:

- in `labelSimilarity` as `max(base, weight)` for every method **except**
  `exact`, which promises literal identity;
- **forced into `makeGenreMatcher`'s top-k**, subject to the criterion's own
  score floor. Measured necessity: on similarity alone the bridge was a total
  no-op, because `tribe` already has five neighbours above the 0.64 its vote
  earned (`tekno` 0.99, `acidcore` 0.97, `acid techno` 0.92). An alias claims
  two words are the same thing, not that they rank well.

Substitution now drives display **and** matching, so the slider does what a DJ
expects: a track the model calls Techno leaves its House neighbours and joins
the Techno ones, and raising the bar hands it back.

### Measured on the real library (default criteria, 2081 tracks, 2164240 pairs)

Rekordbox labels match 151285 pairs (6.99%) — the baseline every column is
compared against.

| threshold | matched | lost / gained vs previous | J vs Rekordbox |
|---|---|---|---|
| 0.0 | 331017 | — | 0.246 |
| 0.2 | 284741 | 53734 / 12921 | 0.288 |
| 0.3 | 247465 | 61930 / 24654 | 0.373 |
| 0.5 | 205166 | 28054 / 15259 | 0.593 |
| 0.8 | 177173 | 10786 / 4366 | 0.842 |

Losses *and* gains at every step: the combo set changes in kind, not only in
size. The bridge is worth **+11.4%** genre links at the default 0.3 (222134 →
247465). What it does not do is remove the mid-slider dip — 13.5% below a clean
interpolation of the endpoints without it, 12.5% with it. Most of that dip is
tracks genuinely changing neighbourhood, which is the point.

## 6. Verification

`tests/genre.test.ts` pins the curated similarities against the widened tree,
the bridge's gates (n ≥ 3, majority, per component, never self-aliasing) and
that clearing restores the previous numbers exactly; `tests/combos.test.ts`
pins that "Tribe" and "Tribal" do not link until the alias is installed and do
not link above the criterion's floor; `tests/analysis.test.ts` pins the
threshold behaviour, that switching back never blanks a genre, and that the
bridge is learned at every threshold. `scripts/screenshot.mjs` drives the flip
in a browser (Acid House / Dub Techno appear, 0.12 is refused, 0.8 falls back,
flipping back restores exactly) — adding a second `<select>` to that section
broke three existing locators that assumed one, now named by row.

Full suite green, `svelte-check` and lint clean.

## 7. Deliberately not built

A bipartite "your labels ↔ Discogs styles" view (the bridge is the data for it,
but it is a new view), kNN over the DJ's own labels using the EffNet embedding,
embedding cosine as a combo criterion, and `--write-tags` for genre — the
predicted style stays in the sidecar, never in a file tag.
