# Design v34 — offline audio analyser (WS2)

Branch `v34-offline-analyser`, stacked on `v33-audio-analysis-provenance`.
Second workstream of
[research/claude-research-audio-analysis.md](../research/claude-research-audio-analysis.md),
following [design-v33-audio-analysis-provenance.md](design-v33-audio-analysis-provenance.md).

v33 built the provenance layer and shipped it with a hand-written fixture and
**no producer**. This is the producer.

## The constraint everything else follows from

Unchanged from v33, and this wave does nothing to weaken it: **Rekordbox
metadata is authoritative and is unreachable by the merge.** The script writes
a file-path-keyed sidecar; `mergeAnalysis` fills nulls only, in a derived
layer; the raw `library` that feeds persistence, the importers and the CSV
exporter never sees an analysed value. The script cannot break that invariant
even by writing nonsense, which is exactly why WS1 was built first.

## Why WS2 and not WS3

WS3 — the in-app essentia.js analyser — was scoped first and rejected on
measurement, not preference. The research report sized its target at "the ~55
gap tracks". Against the real collection (2080 tracks) the gap is **3**:

| | count | what they are |
| --- | --- | --- |
| missing key | 33 | 30 are Rekordbox sampler content, 2 are Pioneer demo tracks |
| missing BPM | 22 | all 22 are sampler content, a subset of the above |
| **union, excluding sampler and demos** | **1** | Herbert — It's Only (DJ Koze Remix) |

The report added the two figures and counted the sampler junk it separately
warned about. 18 × `MERGE FX/MergeFX Sample Sound *.wav`, 8 × `GROOVE
CIRCUIT/4-Floor Breaks Kit/*.wav` and 4 × `OSC_SAMPLER/PRESET ONESHOT/*.wav`
must never acquire a key at all — they are the reason confidence gating exists.

A one-entry hand-written sidecar closes that gap with zero code, and the gap
cannot grow: Rekordbox analyses everything added to it. WS3 would have cost a
2.25 MB AGPL-3.0 WASM dependency last published in May 2022, a licence
one-way door, and a Chromium AIFF decode gap covering 37% of the library — for
one track.

WS2's payload is different and real: **energy for ~2074 tracks**, non-null on
6 today.

## What the script does

`scripts/analyse-audio.py`, `essentia-tensorflow 2.1b6.dev1438` in its own
venv on Python 3.14 (the only interpreter with a macOS arm64 wheel for this
release). Per track, one `MonoLoader` at 44.1 kHz — the files live on an
external drive, so a second load would double the run's I/O for nothing —
then:

- `RhythmExtractor2013(method='multifeature')` → BPM and confidence
- `KeyExtractor(profileType='edma')` → key, scale and strength
- `Resample` to 16 kHz → `TensorflowPredictMusiCNN` (`msd-musicnn-1.pb`,
  output `model/dense/BiasAdd`, 200-d) → one embedding, three heads:
  emoMusic arousal/valence, danceability, mood_happy

Model facts taken from the models' own JSON rather than from prose, because
the prose is wrong in places: `emomusic-msd-musicnn-2` declares
`classes: ["valence", "arousal"]`, so **arousal is index 1** despite the model
being named `arousal_valence`. Both classification heads put the positive
class at index 0.

### Three decisions worth the words

**It does not emit `energy`.** `energyOf` prefers a direct `energy` over
deriving one from `arousal` (`analysis.ts:286-292`), so a number written here
would freeze today's uncalibrated curve into a file that costs hours to
regenerate. Raw `arousal`/`valence` go in and the app derives — the whole
reason the format carries two routes.

**It emits classical key strings, not Camelot.** `normalizeKey` already
accepts `"F# minor"` (`keys.ts:37,66-75`); a second mapping in Python would be
a second thing to keep in sync. The risk this creates is specific and silent:
`mergeAnalysis` drops a key `normalizeKey` rejects **without incrementing any
counter** (`analysis.ts:205-210`). A spelling mismatch would cost the whole
batch with nothing reporting it, which is why `tests/analysis-contract.test.ts`
pins every tonic essentia can name against its Camelot target.

**It excludes `/Sampler/` by default.** Energy is *not* confidence-gated in
the merge (`analysis.ts:213-220`). Measured on `OSC_SAMPLER/PRESET
ONESHOT/NOISE.wav`: BPM confidence 0.00 and key strength 0.25 — both correctly
refused — but arousal 5.37 and danceability 0.898. Without the exclude, white
noise acquires an energy and joins the combo graph.

### Confidence, mapped honestly

`RhythmExtractor2013`'s confidence is on a 0–5.32 scale, not 0–1. Essentia's
own bands are: below 1.5 low, 1.5–3.5 moderate, above 3.5 high. Dividing by
3.0 puts "moderate" exactly at the app's `MIN_CONFIDENCE` of 0.5, so a
low-confidence tempo is refused rather than guessed. `KeyExtractor`'s strength
is already ~0–1 and is passed through.

## The blast radius

`energy` is not a decorative column. It is an enabled-by-default combo
criterion (`combos.ts:83`, `maxSteps: 2`, `threshold: 3`), a radial axis and a
colour axis (`persist.ts:64-65`), and a filterable number property
(`properties.ts:69`).

**This is not a new code path**, which was checked rather than assumed: the
sample collection already generates energy for ~88% of its tracks
(`enrich.ts:142-156`) and `tests/samples.test.ts:144-150` asserts "every pack
has energy coverage, with gaps". The wheel's radial machinery has always
handled a populated-with-gaps energy field — `radialValues` filters nulls
(`WheelView.svelte:120-121`), a null radial value renders dimmed at 0.55
opacity (`:694`) and parks below the wheel (`:261`). `tests/combos.test.ts`
builds its energy cases from explicit track factories, so there is no test
fallout either.

The risk is behavioural, on the real library:

1. **The combo graph densifies.** Today energy never enters `evaluable`
   (`combos.ts:284-287`). Afterwards `evaluable` grows from ~4 to ~5,
   `effectiveThreshold = Math.min(threshold, evaluable.length)` stops being
   clamped, and a ±2 window over a library clustered at 6–8 matches very
   often. Easy mode is unaffected — `EASY_CRITERIA` disables energy
   (`combos.ts:99`).
2. **An active energy range filter changes meaning.** `passesProperty` returns
   `true` for a null number (`filter.ts:305`), so today every track passes any
   energy range. Afterwards, tracks outside the range disappear from the
   wheel — and since `propertyExtents` derives the slider bounds from the data
   (`filter.ts:220-248`), a range saved when the extent was the six Mixed In
   Key values becomes genuinely aggressive against a 1–10 extent. This is the
   one most likely to look like a bug.

## The energy curve, and why it had to be refitted

*(This section records the measured outcome; see Verified below for the run.)*

The v33 `energyFromArousal` was a linear stretch of the model's **nominal**
annotation range [1, 9] onto [1, 10] — which is barely a stretch at all. The
DEAM research anticipated the problem: emoMusic's labels sit near the middle
of their scale and never reach the ends, so model output is compressed and
"the map you need is a stretch, not a rescale".

Measured on the first 20 real tracks, arousal spanned 4.08–6.68 with a
standard deviation of 0.56, and the v33 curve put **18 of 20 tracks at energy
6 or 7**. A near-constant energy is worse than no energy: it adds an
almost-always-matching criterion to every pair, quietly loosening the combo
threshold library-wide while conveying nothing.

The fix is one pair of constants, not a new mechanism: stretch from the
observed arousal range rather than the nominal one, keeping the map linear so
the distribution's shape survives. That is deliberately **not** a decile or
percentile map — those fabricate a uniform spread and would clash with the six
real Mixed In Key values the library already carries, which fill-nulls-only
leaves untouched.

## Licence posture

This is why WS2 dodges the door WS3 would have opened. `essentia-tensorflow`
is AGPL-3.0 and the MTG models are CC BY-NC-SA 4.0, but **neither ships in the
app bundle**. The analyser is a separate program that hands the app a JSON
file; the models are gitignored and downloaded on demand by
`scripts/fetch-models.sh`. The app's own licensing is unchanged, and the
MIT-plus-CC-BY option that `legal/README.md` recommends stays open.

The genre-pack precedent is the same shape: heavy computation offline, a
compact artefact consumed by the client.

## Testing shape

The producer is Python, so no unit test can reach its logic — which is why
`scripts/analysis-lib.mjs` (proposed in the research report by analogy with
`genre-pack-lib.mjs`) was **dropped rather than written**: there the producer
was JavaScript, and here a JS "pure helpers" module would have nothing real to
hold.

Three layers instead:

- **`--self-test` in the script.** A synthesised 120 BPM click train asserted
  within ±1 BPM, and a synthesised A-minor triad through `KeyExtractor`. One
  runnable check that fails if the pipeline breaks.
- **`tests/analysis-contract.test.ts`.** The key-spelling table always runs.
  The rest is skipped unless `ANALYSIS_SIDECAR` points at a produced file,
  because the collection is gitignored personal data and the sidecar takes
  hours to make. It asks the match question *backwards* from the merge — for
  every entry the script wrote, does it resolve to exactly one track? The
  merge's own `notFound` counts tracks with no entry, which is large and
  legitimate during a resumed or excluded run, so it cannot detect the failure
  that matters: Python and TypeScript disagreeing about a decoded path.
- **`scripts/screenshot.mjs`, the v34 block.** v33's block proves an analysed
  *key* moves a node between gutter and ring. Energy travels a different road:
  it is not in the node's `aria-label` at all, it lands on the radial scale.
  So the block sets Radius to Energy and reads the node's own geometry and
  opacity before and after the sidecar. Nothing in vitest reaches the
  placement pass.

## Deliberate non-goals

- **No in-app analyser.** WS3 is rejected on the evidence above, not deferred.
- **No Mixed In Key purchase and no Pearson r.** n=6, three by the same
  artist, all 112–128 BPM and house-adjacent. v33 already struck that plan
  from the report.
- **No half/double-time correction.** Three of the first twenty tracks came
  back at 1/2 or 2/3 of the Rekordbox tempo — a real hardcore/gabber failure
  mode. It is not worth fixing, because analysed BPM fills **zero** real
  tracks; the value is only ever stored for a future disagreement report.
- **No `happiness`/`danceability` on `Track`.** Stored in the sidecar only;
  promoting them is WS4 and costs registry and column-migration work.
- **No disagreement UI.** The data is now genuinely there for every track, but
  see Not verified for why the surface should wait.
- **No genre embeddings.** WS5, research-gated.

## Deferred

- **WS4** — `happiness` and `danceability` joining `TrackSortField` and the
  property registry.
- **WS5** — Discogs-EffNet genre embeddings for the blank-genre tracks.
- **A per-track disagreement report.** The data exists; the evidence below
  suggests the report would be mostly noise.
- **Refitting the energy curve against real labels**, if a labelled set ever
  arrives. Raw arousal in the sidecar keeps that an evening's work rather than
  a re-run.

## Verified

*(Filled in as the wave completes.)*

## Not verified

*(Filled in as the wave completes.)*
