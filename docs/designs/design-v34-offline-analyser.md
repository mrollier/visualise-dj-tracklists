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

The v33 `energyFromArousal` was a linear stretch of the model's **nominal**
annotation range [1, 9] onto [1, 10] — which is barely a stretch at all. The
DEAM research anticipated the problem: emoMusic's labels sit near the middle
of their scale and never reach the ends, so model output is compressed and
"the map you need is a stretch, not a rescale".

Measured over the real collection, arousal spans 3.20–7.63 with a standard
deviation near 0.5, and the v33 curve put **159 of the first 175 tracks at
energy 6 or 7**. A near-constant energy is worse than no energy: it adds an
almost-always-matching criterion to every pair, quietly loosening the combo
threshold library-wide while conveying nothing.

The fix is one pair of constants, not a new mechanism: stretch from the
observed arousal range rather than the nominal one, keeping the map linear so
the distribution's shape survives. That is deliberately **not** a decile or
percentile map — those fabricate a uniform spread and would clash with the six
real Mixed In Key values the library already carries, which fill-nulls-only
leaves untouched.

### DEAM was tried as a calibration, and made it worse

The obvious objection to constants chosen by bracketing is that they are still
judgement. So the transform was fitted properly against DEAM (1802 clips,
CC BY-NC), running the same pipeline over the whole set and regressing human
arousal on predicted arousal. Three findings, all negative for the idea and
all worth keeping:

- **The published accuracy is in-sample.** DEAM partitions as 744 clips at
  `song_id ≤ 1000`, 1000 at 1001–2000, 58 above 2000. Our pipeline scores
  **r = +0.846 on the 1001–2000 block** against MTG's published 0.821, and
  **r = +0.525 on the other 802**. Reproducing the published figure on exactly
  one block, and only that block, identifies it as the training set. **Real
  held-out arousal accuracy is r ≈ 0.53, not 0.82.**
- **The de-shrinkage slope is not stable across genres**, which was the
  standing objection to transferring it to an out-of-distribution library:
  Rock 0.38, Folk 0.44, Blues 0.48, Pop 0.58, Country 0.67, Jazz 0.70,
  Electronic 0.78, Classical 0.83. More than 2× spread, so no single transfer
  is defensible.
- **Applied, it compresses rather than stretches.** Note the OLS slope is
  attenuated by the correlation and is the wrong tool for rescaling a
  distribution; variance matching gives the band [1.38, 8.18]. Against the
  real library:

  | band | resulting energy histogram |
  | --- | --- |
  | **3.5–7.5 (shipped)** | 1:7 2:37 3:107 4:229 5:388 6:509 7:426 8:244 9:86 10:7 |
  | DEAM variance-matched | 3:2 4:24 5:190 6:587 7:802 8:401 9:34 |
  | DEAM OLS | 5:214 6:1329 7:495 |

  Both fitted alternatives collapse the library back towards the two-value
  failure the refit existed to fix.

The library sits **inside** DEAM's predicted range (2039/2040), so this is
interpolation rather than extrapolation — the fit fails on genre instability,
not on coverage. Conclusion: keep the bracketed band, and keep the measured
r ≈ 0.53 as the honest description of the signal underneath it.

### Where the energy is wrong, specifically

Ranking the library's own genres by mean analysed energy is the strongest
available in-distribution test, because it needs no annotation and uses tags
that already exist. Most of it is right — Lo-Fi lowest at 4.11, Hardtrance
highest at 7.57, Goa Trance 7.25, and `Techno Melancholic` (5.95) correctly
below plain `Techno` (6.48), which is a sub-genre separated by mood alone.

**Jungle is wrong, and it is the largest genre in the library.** 374 tracks at
a mean of 5.49, thirteenth of sixteen, below Funk. The cause is measurable:

```
r(bpm, arousal) = -0.066

tempo band     n     mean arousal
0-110        138         5.23
110-125      516         5.62
125-140      541         5.99   <- peak
140-155      216         5.98
155-175      494         5.49
175-300      135         5.49
```

Arousal follows an inverted U peaking at 125–140 BPM — where MusiCNN's
Million-Song training data and DEAM both live — and falls away above 155. The
model has effectively never heard 167 BPM breakbeat, so it under-rates it
systematically rather than randomly.

This is a **semantic** mismatch, not merely imprecision: `Track.energy` is
documented as Mixed-In-Key-style, and MIK's patent defines energy as
beat-aligned percussive transient density, which jungle has in abundance.

Two candidate fixes were tested on a 130-track sample and both rejected:

- **Non-ML transient descriptors.** `OnsetRate` barely separates the genres at
  all (Hardtrance 5.69, House 5.65, Jungle 5.55, Italo 5.54, Techno 5.43,
  Lo-Fi 5.11), and puts Jungle mid-pack again. It does not recover the
  intuition. One suggestive signal survives for later: the high-band share of
  beat loudness picks Jungle out clearly (0.130 against House 0.101, Techno
  0.057, Lo-Fi 0.035) — the amen-break snare and hat energy. That is a lead,
  not a fix; building a formula on one descriptor and no labels is exactly the
  confident-wrong-number failure this whole layer exists to avoid.
- **Blending tempo into energy.** Rejected on design grounds rather than
  measurement: BPM is already its own combo criterion and its own radial axis,
  so folding it into energy would make the energy criterion partly a duplicate
  and let the combo engine double-count tempo.

So energy ships accurate-ish for the house/techno/disco half of the library
and unreliable for the jungle quarter. It is opt-in, badge-marked and removable
by deleting the sidecar, which is what makes shipping it honest — but it is the
first thing to say in any hand-over.

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
- **No Pearson r against the six MIK tags.** n=6, three by the same artist,
  all 112–128 BPM and house-adjacent. v33 already struck that plan from the
  report. (The *purchase*, separately, was reopened on 2026-08-26 and is now
  the recommended next move — see section 0.2.)
- **No in-app energy labelling feature.** Michiel proposed shipping a pairwise
  A/B comparison UI so users could teach the app their own energy scale.
  Rejected on three grounds. The measured defect is a **ranking** failure from
  a model that never heard 167 BPM breakbeat — identical for every user with
  jungle, so it wants fixing once and centrally, not re-learned per user. What
  genuinely varies between DJs is where the 1–10 boundaries sit, and rescaling
  was already measured not to repair a ranking failure. Fitting a blend
  honestly needs a few hundred pairs, so shipping it puts two or three hours of
  listening between a new user and a working energy axis, on an app whose pitch
  is "drop your XML in". And 772 of the collection's tracks are AIFF, which
  Chromium never plays — a listening feature is blind to 37% of the library in
  the browser build. What survives is the same labelling done **offline, once,
  by Michiel**, feeding a curve that ships for everyone. If a learn-from-the-user
  feature is ever wanted, the right target is **transitions**, not energy —
  "did this blend work?" trains what the app is actually for, whereas energy is
  a means to that end.
- **No manual energy override — yet.** The small product residue of the
  rejected labelling feature: "this is a 9, not a 6", slotting into the v33
  provenance layer as a third tier above analysed and Rekordbox. The
  architecture already has the shape for it. Not built, not scoped.
- **No half/double-time correction.** Three of the first twenty tracks came
  back at 1/2 or 2/3 of the Rekordbox tempo — a real hardcore/gabber failure
  mode. It is not worth fixing, because analysed BPM fills **zero** real
  tracks; the value is only ever stored for a future disagreement report.
- **No `happiness`/`danceability` on `Track`.** Stored in the sidecar only;
  promoting them is WS4 and costs registry and column-migration work.
- **No disagreement UI.** The data is now genuinely there for every track, but
  see Not verified for why the surface should wait.
- **No genre embeddings.** WS5, research-gated.

## Next steps, ranked

Written for whoever picks this up next, human or agent. The ordering is by
value per unit of effort. **Sections 0, 0.1 and 0.2 are the live ones**;
everything from 1 onward predates them and is kept for the reasoning, not the
recommendation. If you read only one thing, read 0.1 — it says the shipped
energy is beaten by a column we already have for free.

### 0. The anchor labels exist, and they changed the ranking

Michiel supplied 18 labelled tracks on 2026-08-26 — eleven he called
"invincible" and seven "spaced-out couch potatoes". They are recorded below so
they survive as a **test set**, which is what they turned out to be good for.

| label | track | BPM | arousal | E (3.5–7.5) |
| --- | --- | --- | --- | --- |
| 9.5 | DJ Warlock — Hallucination | 146 | 6.88 | 9 |
| 9.5 | Clouds — Arkhangelsk Nightmare | 140 | 6.68 | 8 |
| 9.5 | Salvatore Ganacci — Horse (Schacke Remix) | 146 | 6.49 | 8 |
| 9.5 | Bollini Verdi — Pump Ton Acid | 172 | 6.30 | 7 |
| 9.5 | Fresh — Gatekeeper | 174 | 5.82 | 6 |
| 9.5 | slowthai — Doorman | 175 | 5.74 | 6 |
| 9.5 | Dub-Liner — The Kill | 175 | 5.72 | 6 |
| 9.5 | SPK — Looper | 175 | 5.69 | 6 |
| 9.5 | Timo Maas & Gary D. — Die Herdplatte 100 | 163 | 5.66 | 6 |
| 9.5 | Nesh Mayday — Push It Badly | 170 | 5.00 | 4 |
| 9.5 | Just Jungle — Ere Dread | 170 | 4.82 | 4 |
| 3.5 | Versa & Rowl — Zodiac | 168 | 4.42 | 3 |
| 3.5 | Yung Lean — Agony (dj poolboi Remix) | 110 | 4.57 | 3 |
| 3.5 | Herbert — It's Only (DJ Koze Remix) | 118 | 4.08 | 2 |
| 3.0 | Nu — Fool (Ft. Jo Ke) | 114 | 4.46 | 3 |
| 2.0 | Leafar Legov — Hidden Treasure | 127 | 4.24 | 3 |
| 2.0 | Shackleton — Blood On My Hands | 128 | 5.37 | 5 |
| 1.5 | Traumprinz — Ambient 006 | 122 | 3.58 | 1 |

**The low end is already well calibrated.** Ambient 006 — his own "best
example" — lands on 1, and five of the seven quiet tracks fall within a step of
his label. Overall the model correlates with his judgement at **r = +0.783**,
far better than DEAM's held-out 0.525: on his own material it ranks better than
the public benchmark suggests.

**The high end fails, and the reason is now precise.** Within the eleven tracks
he called equally maximal, **r(bpm, arousal) = −0.707** — the model orders them
by tempo, backwards. The three at 140–146 BPM take the top three places; every
170–175 BPM track sits below them.

That is a **ranking** failure, so no rescaling can repair it. Refitting the band
on these anchors was tried and is instructive: mean error improves from 2.31 to
1.47 steps, but the implied band [3.67, 6.18] pushes **669 of 2040 tracks onto
energy 10** and 1285 onto 8–10. It buys the anchors at the cost of the library,
because a stretch cannot move a track past one the model placed above it.

**Consequences for what to do next**, which reorder the sections below:

- **Keep the 3.5–7.5 band.** Both fitted alternatives — DEAM's and the
  anchors' — are worse across the library.
- **The anchors are an acceptance test, not a calibration.** Any candidate fix
  must put the eleven above the seven *and* stop ranking 170 BPM below 146.
- **More anchors would help only in the middle.** The set is bimodal by
  construction, which is what makes the variance-matched fit over-stretch
  (label sd 3.35 against prediction sd 0.93). Five tracks he would call 5–6
  would tame it — but only after the ranking is fixed.

### 0.1 Plain BPM beats the shipped energy (measured 2026-08-26)

Michiel pushed back on the phrase "tempo bias", correctly: energy and tempo
*are* correlated in the real world, so a signal that tracks tempo is not
thereby wrong. The pushback survived measurement and changed the conclusion.

Across the 18 anchors, **r(BPM, Michiel's label) = +0.773**. The relationship
is real and strong in his own judgement, and nothing should try to remove it.
What section 0's −0.707 measured was never that correlation but the
**residual** — how much the model still varies with tempo once the label is
held fixed. Within the eleven tracks he called equally 9.5 that residual is
Spearman −0.401 for the shipped MusiCNN arousal and −0.050 for the VGGish head.
That is error shaped like tempo, not signal. The bathroom-scale test: heavy
people do weigh more, but a scale that reads light for tall people is found by
weighing people of *equal* true weight.

The library-wide `r(bpm, arousal) = -0.066` is the same fact from the other
side. The model ought to show something near +0.773 and shows nothing, because
the inverted U gives it the correct slope below 140 BPM and the inverted one
above 155, netting to zero.

Leave-one-out mean absolute error on the 18 anchors, label scale 1–10:

```
  BPM alone                 1.60
  arousal_musicnn alone     1.66
  arousal_vggish alone      1.10
  BPM + arousal_musicnn     1.15
  BPM + arousal_vggish      0.90
  predict the mean          3.23   <- baseline
  what currently ships      2.31
```

**Plain Rekordbox BPM predicts Michiel's energy labels better than the energy
this wave shipped.** That is the most consequential number in this document.
It reframes the model's job: not to predict energy, but to predict the part BPM
cannot know — that a 140 BPM ambient dub and a 140 BPM techno roller are worlds
apart. Under that framing a tempo-shaped model error is bad precisely because
it *cancels* a free and accurate tempo term instead of complementing it.

The caveat that must travel with the table: the anchors are bimodal and
genre-typical — the highs are fast, the lows are slow — so BPM looks better
here than it would on mid-range material. **The label set that would settle it
is same-tempo pairs with different energy**, e.g. two tracks near 140 where one
is a 9 and one is a 3. That is the test BPM structurally cannot pass, so it
isolates what the model actually contributes. `Versa & Rowl — Zodiac` (168 BPM,
labelled 3.5) is the one such track that already exists, and the current model
gets it right at 3 — this pipeline is not uniformly bad, it is bad in one
specific place.

**The model-swap question is settled elsewhere.** A survey of the alternatives
(beaTunes, Sononym, Tunebat, AcousticBrainz, cloud APIs) and a full inventory
of the Essentia heads we are not using is in
[research/claude-research-sentiment-alternatives.md](../research/claude-research-sentiment-alternatives.md).
Short version: buy none of them, ensemble the three arousal datasets we already
have access to, and note that **no `-discogs-effnet` arousal head exists**, so
electronic-trained embeddings reach affect only via the binary mood heads.

The labels and every measured signal are committed so this survives the
session: `scripts/anchors.csv` (`path,label,group`, the format
`calibrate-arousal.py --labels` takes) and `scripts/anchor-signals.json`
(Rekordbox BPM plus seven candidate model outputs per track — the shootout
data). Section 0's table is the same 18 tracks in readable form.

### 0.2 The Mixed In Key route — the cheapest exit, and the test that decides it

Reopened 2026-08-26 and now the recommended next move, superseding the
"no Mixed In Key purchase" non-goal above.

**The import path is already built and shipping.** `energyFromComments`
(`model.ts:95`) parses MIK's `Energy N` token out of Rekordbox Comments, added
in v12 WS8. Six tracks in the collection prove it end to end. So this is not an
engineering project — it is: run MIK, let it tag, re-export the XML, import.
Zero new code, no import format to design.

The open-source objection Michiel raised does not bite here: reading a file
another program produced is not a dependency, the app already imports from
closed-source Rekordbox, and energy is optional — the wheel works without it.
His objection was aimed at bundling an engine, which this is not.

**Tagging by format**, checked against MIK's FAQ and community and against the
collection itself:

| | count | tagging |
| --- | --- | --- |
| `.mp3` | 1205 (57.9%) | ID3v2 — fine |
| `.aiff` | 772 (37.1%) | ID3 in an AIFF chunk — fine |
| `.m4a` | 9 (0.4%) | iTunes atoms — fine |
| `.wav` | 94 (4.5%) | no agreed chunk — **MIK will not tag these** |

WAV is a RIFF container with no tagging convention the DJ ecosystem ever
agreed on, so this is a format limitation rather than a MIK defect — Rekordbox's
own WAV tag support is equally patchy. Of the 94, **30 are Rekordbox sampler
one-shots that must never carry an energy anyway**, leaving 64 real tracks:
3.1% of the library. AIFF is confirmed good from two directions — MIK's
community names it as the format to use when WAV fails, and **282 of the 772
AIFFs in this collection already carry Comments that survived to the XML
export**.

The gap does not block the route, because the app reads Rekordbox's XML and a
path-keyed sidecar, not the files. Options for the 64, in order of preference:
leave them null (already a first-class state — gutter placement, criterion
skipped); convert a MIK export into the sidecar format `analyse-audio.py`
already writes (~30 lines); type them into Rekordbox by hand. Do **not**
convert WAV to AIFF — it changes 64 paths and breaks Rekordbox's references.

**There is no trial.** MIK's FAQ offers a 30-day no-questions money-back
guarantee instead, which is what makes the test below risk-free.

**The test, with pass/fail registered in advance** so the result cannot be
rationalised afterwards:

| Track | BPM | Michiel | App now | MIK must show |
| --- | --- | --- | --- | --- |
| Just Jungle — Ere Dread `.wav` | 170 | 9.5 | **4** | ≥ 8 |
| Dub-Liner — The Kill `.mp3` | 175 | 9.5 | 6 | ≥ 8 |
| SPK — Looper `.aiff` | 175 | 9.5 | 6 | ≥ 8 |
| Fresh — Gatekeeper `.mp3` | 174 | 9.5 | 6 | ≥ 8 |
| **Versa & Rowl — Zodiac** `.mp3` | **168** | **3.5** | 3 | **≤ 5** |
| Clouds — Arkhangelsk Nightmare `.mp3` | 140 | 9.5 | 8 | ≥ 8 |
| Traumprinz — Ambient 006 `.aiff` | 122 | 1.5 | 1 | ≤ 3 |

**Zodiac decides it.** It is 168 BPM and labelled 3.5. If MIK returns 8+ for
it, MIK is reading tempo — which Rekordbox gives us free — and it should be
refunded. If it returns ≤ 5 while the jungle comes back ≥ 8, MIK hears
something this pipeline cannot, and the purchase closes the whole problem.

Formats are mixed deliberately so one session answers the second question too:
does `Energy N` actually reach the AIFF Comments? A community report says AIFF
sometimes receives key only. Check with
`ffprobe -v quiet -show_entries format_tags=comment -of csv=p=0 <file>`. Expect
nothing for `Ere Dread.wav` — read its energy off MIK's screen.

Outcomes: jungle ≥ 8 and Zodiac ≤ 5 with AIFF tagged → buy, delete the sidecar,
this thread closes. Same but AIFF untagged → the numbers are right but cannot be
delivered, and a sidecar converter becomes real work. Zodiac ≥ 8 → refund.

### 1. Ten anchor tracks (Michiel, ~10 minutes) — superseded by section 0

Name roughly five tracks you would call energy 1–2 and five you would call
9–10. Those pin `AROUSAL_MIN` and `AROUSAL_MAX` in
`src/core/analysis.ts` directly, in your genres and your taste — the only
calibration in this whole investigation that is genuinely in-distribution.
Write them as `path,label` and run:

```sh
scripts/.venv/bin/python scripts/calibrate-arousal.py \
  --sidecar scripts/out/library.analysis.json --labels scripts/anchors.csv --scale energy
```

Ten labels cannot fit a curve, but the band is only two numbers and the
extremes are exactly what determines them. This dominates both €58 of Mixed In
Key and 1.3 GB of DEAM, which is what the sections above spent their effort
establishing.

**Does file format bias any of this?** Checked, because the anchors are mostly
non-AIFF (Michiel auditions them in the app, and Chromium cannot play AIFF).
Format itself does not affect analysis — essentia decodes everything to PCM and
the model works on 16 kHz mel patches, well inside what MP3 preserves. The
correlation is indirect and real but small: AIFF skews faster and much more
jungle-heavy (mean 145 BPM, 219 of 763 tracks Jungle) than MP3 (135 BPM, 133 of
1204), and carries slightly lower mean arousal (5.55 against 5.77) — which is
the same tempo effect, not a format effect. So an all-MP3 anchor set
*understates* the problem rather than hiding it in a dangerous direction. No
reason to avoid AIFF when labelling; the analyser reads them fine (7 failures
in 763).

### 2. Fix the ranking failure — the anchors above are its acceptance test

The measured problem is that arousal peaks at 125–140 BPM and falls away above
155, so a quarter of the library is systematically under-rated. The one lead
worth pursuing is the **high-band share of beat loudness**, which separated
jungle cleanly in the 130-track probe (0.130 against House 0.101, Techno
0.057, Lo-Fi 0.035) where `OnsetRate` did not. It is also what Mixed In Key's
patent actually describes.

Shape of the work: add `OnsetRate` and `BeatsLoudness` to the same pass in
`analyse-audio.py` (they are non-ML, so no new model and no new licence), re-run
(~2 h, and the existing sidecar means only the new fields cost anything), then
test any candidate formula against **both** the anchor labels from (1) **and**
the genre ordering. Do not build the formula before the labels exist — an
invented blend is exactly the confident-wrong-number this layer exists to
prevent.

**Blending BPM into energy was rejected here and is no longer rejected.** The
original objection stands as a real cost — BPM is already its own combo
criterion and its own radial axis, so energy becomes a partial duplicate and
the combo engine can double-count tempo — but it was a *design* objection made
before anything was measured. Section 0.1 then measured that plain BPM predicts
Michiel's labels better than the energy this wave ships. A duplicate signal
that is right beats an independent one that is wrong, and the double-counting
is a criteria-defaults question rather than a blocker. Do not build the blend
before the same-tempo labels exist, though: the anchors are bimodal, which is
exactly what flatters BPM.

### 3. WS4 — `happiness` and `danceability` as real properties

Both are already in the sidecar for all 2040 tracks, so this costs no
re-analysis: `TrackSortField` (`trackSort.ts:10`), a `TRACK_PROPERTIES` entry
each (`properties.ts:61`, which buys filter and column for free),
`EMPTY_TRACK_FIELDS`, and `migrateColumns`. The pinned counts in
`tests/properties.test.ts` and `tests/columns.test.ts` (both 28) will need
updating — that is the work.

Worth noting `danceability` looked **more trustworthy than energy** in the run:
Turkish Funk 0.62, Funk 0.85, every dance genre 0.90–0.98. It orders the
library the way a listener would, which analysed energy does not.

### 4. Merge the stack

`v33-audio-analysis-provenance` and `v34-offline-analyser` are both unmerged
and stacked. Two waves of unreviewed work on one branch line is a growing
liability.

### 5. Only then, and probably not

- **The per-track disagreement report.** The data is stored for every track,
  but analysed key matched Rekordbox exactly on roughly 7 of 18 spot-checked
  tracks and BPM showed half- and two-thirds-time errors. The report would be
  mostly noise unless gated hard on confidence. Measure key accuracy properly
  first.
- **WS5** — Discogs-EffNet genre embeddings for the blank-genre tracks.
  Untouched and research-gated. Note the genre-ordering test above makes genre
  tags load-bearing for validating anything else, which raises WS5's value
  slightly.
- **The seven undecodable AIFFs.** Probably AIFF-C with an unusual compression
  type. Trivial either to diagnose or to ignore.
- **Do not revive WS3**, the in-app analyser, without re-measuring the gap it
  targets. See the top of this document.

## Verified

Gates: `npm test` 1032 passing, `npx eslint src tests scripts` clean,
`npm run check` 0 errors across 327 files, `npm run build` succeeds,
`node scripts/screenshot.mjs` exits 0 with no console errors.

**The real run.** 2040 of 2047 entries in 122 minutes across 8 workers, 30
sampler tracks excluded, 3 absent from disk, **7 AIFFs refused by the decoder**
("Invalid data found when processing input"). 500 tempos and 68 keys fall below
the app's confidence gate and are therefore never offered.

**Against the real collection**, through the app's own `sanitizeAnalysis` and
`mergeAnalysis`: `bpm 0/22, key 3/33, energy 2036 filled, 0 ambiguous`. Every
entry resolves to exactly one track, every emitted key parses, and the raw
track objects are byte-identical after the merge. The BPM figure is not a
failure — all 22 missing-BPM tracks are the excluded samplers.

**Against the six real Mixed In Key tags**, the only direct measurement against
the target scale that exists: mean absolute error **0.67 steps**, maximum 2.
Three exact, two off by one, one off by two. n=6 cannot calibrate, but it can
falsify, and it did not.

**Size.** The finished sidecar is **0.93 MB** UTF-16 compact, projecting to
3.83 MB against the 5 MB cap — the v33 estimate was accurate.

**Mutation-tested, not merely green.** Every assertion written after its
implementation was checked by breaking something and watching the intended
test die:

- percent-encoding one sidecar path key kills the resolve-to-one-track test
- emitting `F# dorian` kills the key-parses test
- an entry the sanitizer drops kills the survives-sanitize test
- making the merge write into the raw track kills the never-overwrite test
- a wrong Camelot target kills the key-spelling table
- **disabling the energy fill fires all three browser assertions** — the node
  stays dimmed at 0.55 opacity, never moves from (345, 436), and the
  missing-radial count holds at 29; with the fill live it is opacity 1 at
  (105, 536) and 24, exactly the five fixture entries

**Spot-checked against Rekordbox** on first contact: key matched exactly on
both tracks tried (`Ab major` = 4B, `C# minor` = 12A), and BPM to 0.02 on the
M4A. Essentia decodes AIFF, unlike Chromium.

**Added 2026-08-26, after the anchors.** `r(BPM, Michiel's label) = +0.773`
across the 18 anchors; leave-one-out MAE of 1.60 for BPM alone against 2.31 for
the shipped energy (section 0.1). File formats counted from the collection:
1205 mp3, 772 aiff, 94 wav, 9 m4a. Comments already present in the XML export
per format: 43.4% of mp3, **36.5% of aiff (282 tracks)**, 55.3% of wav — which
is what proves the AIFF tag → Rekordbox → XML → app route works on real data.
30 of the 94 WAVs are `/Sampler/` one-shots. Mixed In Key's FAQ confirms no
trial, a 30-day no-questions refund, and that WAV is analysed but not tagged.

## Not verified

- **`arousal_vggish` at library scale.** It wins the 18-anchor shootout
  (ρ +0.840 against MusiCNN's +0.781, residual tempo slope −0.050 against
  −0.401) but n=18 with seven candidates cannot separate that from noise. A
  330-track tempo-stratified run to check whether the inverted U disappears was
  started and killed — the throwaway script omitted the
  `TF_NUM_INTRAOP_THREADS`/`TF_NUM_INTEROP_THREADS` caps that
  `analyse-audio.py` sets, so six workers each spawned ~10 TF threads. Re-run
  with those two lines set, ~120 tracks, `--jobs 4`, printing incrementally.
- **The three-arousal ensemble and the EffNet mood heads.** Recommended in
  [research/claude-research-sentiment-alternatives.md](../research/claude-research-sentiment-alternatives.md)
  on the strength of the anchor shootout and Ching & Widmer (arXiv:2510.04688),
  but not run. Acceptance criteria are recorded there; nothing is measured yet.
- **Whether Mixed In Key handles fast material.** The whole basis of section
  0.2's recommendation is untested: all six existing MIK tags are 112–128 BPM
  and house-adjacent, so they say nothing about 165–175 BPM jungle. The seven
  tracks in 0.2 are the test.
- **Whether AIFF receives `Energy N` specifically.** AIFF tagging is confirmed;
  a community report claims AIFF sometimes gets key only where MP3 gets the
  full string. The two AIFFs in the 0.2 test set exist to settle this.
- **Analysed key accuracy is poor and was not fixed.** Over the first 20
  tracks, roughly 7 of 18 keys matched Rekordbox exactly, with several
  relative-major and parallel-minor confusions. It does not matter for this
  wave — analysed key fills exactly one real track — but it is why the
  deferred disagreement report would be mostly noise, and it should be
  measured properly before that report is built.
- **Analysed BPM has two-thirds and half-time errors** on fast material: three
  of the first twenty came back at 89, 110 and 111 against Rekordbox's 179,
  166 and 166. Two passed the confidence gate. Again harmless here, because
  analysed BPM fills zero real tracks.
- **The energy scale has no validation beyond n=6 and the genre ordering.**
  The 3.5–7.5 band brackets a measured range; it is not fitted to labels,
  because no usable label set exists — DEAM was tried and rejected above.
- **The `highBandRatio` lead is a single suggestive number** from 25 tracks per
  genre. It has not been tested as an energy signal, only observed to separate
  jungle.
- **The seven undecodable AIFFs were not diagnosed.** They may be AIFF-C with
  an unusual compression type; nothing was done beyond recording the failure.
- **Not tried on any library but Michiel's**, and the genre-ordering test is
  meaningless without genre tags, which not every collection has.
- **The quota warning path is still untested end to end.** The project fits
  with 1.2 MB to spare, so nothing exercised it.
