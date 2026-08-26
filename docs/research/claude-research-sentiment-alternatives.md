# Sentiment analysis and combo inputs — what else exists, and what we decided

Research only, 2026-08-26. No code shipped in this wave.

Michiel asked whether existing software — beaTunes, Sononym, Tunebat and
similar — would do the job better than the `essentia-tensorflow` pipeline v34
built, and asked for sentiment descriptors beyond "energy", which is a Mixed In
Key coinage rather than a standard descriptor.

**Decision: buy and integrate none of them. Use the pipeline we already have,
properly, in three gated stages.** The reasoning is below; the short version is
that every alternative is either downstream of Essentia, frozen, or built for a
different problem — and `scripts/fetch-models.sh` currently downloads four
model files out of a zoo publishing roughly forty families.

Read alongside [designs/design-v34-offline-analyser.md](../designs/design-v34-offline-analyser.md)
(§0.1 and §0.2 in particular) and [ISSUES.md](../ISSUES.md) items 11–13.

## Why the question was fair

v34 shipped energy for 2036 tracks from one model head,
`emomusic-msd-musicnn`. Two measurements then undercut it:

- Energy is unreliable above ~155 BPM, which is a quarter of the library and
  its largest genre. `r(bpm, arousal) = -0.066` library-wide, with arousal
  following an inverted U peaking at 125–140 BPM.
- Plain Rekordbox BPM predicts Michiel's own 18 anchor labels **better** than
  the shipped energy: leave-one-out mean absolute error 1.60 against 2.31.

Shipping a number that a free column beats is a good reason to check whether
someone else has solved this.

## The alternatives, and why each one fails

### beaTunes — rejected, but its best idea is already ours

tagtraum industries, $34.95 perpetual, two-week trial, v5.2.36 (January 2026).
It analyses BPM and key, computes a proprietary timbre similarity called
"color", builds Matchlists, and shows a transition-warning column. It writes
ID3 tags and exports to Rekordbox, so on paper the delivery path is the same
one Mixed In Key uses and that `energyFromComments` (`model.ts:95`) already
reads.

**The decisive fact: beaTunes' mood is not audio-derived.** It infers mood from
Last.fm tags or from AcousticBrainz data. Both fail here:

- Last.fm tags are sparse to absent for underground jungle, tekno, acidcore and
  bandcamp-purchase white labels, which is most of this library.
- AcousticBrainz *is* Essentia. Its high-level mood classifiers are the same
  family of models we already run ourselves, so routing through beaTunes buys a
  worse copy of our own output.

Its one genuinely proprietary signal, "color", **explicitly does not export** —
it is a beaTunes-internal concept and never reaches Rekordbox.

And the part of beaTunes worth having turns out to be free. Its tempo engine is
TempoCNN (Schreiber & Müller, ISMIR 2018 — Schreiber is beaTunes' author), and
TempoCNN is published in the Essentia model zoo as `deeptemp-k16-3.pb`. It
returns `global_tempo`, `local_tempo` and `local_tempo_probabilities`, which is
exactly the material for diagnosing the half- and two-thirds-time BPM errors
v34 measured and deliberately left alone.

Verdict: reject as a dependency. Because it has a real trial, a 30-minute run
over the seven anchor tracks in design-v34 §0.2 costs nothing if curiosity
strikes — but it is not a decision input.

### Sononym — wrong tool

A sample browser. Its similarity search is documented as excelling on "short
one-shots… containing minimal harmonic content, such as drums, percussion and
found sounds", with monophonic stable-pitch samples working well. It is built
for browsing a drum library, not for characterising six-minute DJ tracks.
Nothing about it targets the problem. Reject.

### Tunebat — frozen, and already on file as a cautionary tale

Its 70M-track database was built on Spotify's audio-features API, which shut
down in November 2024, and the catalogue is frozen at pre-deprecation data.
This is already recorded in
[claude-research-competition.md](claude-research-competition.md) and named in
[POSITIONING.md](../POSITIONING.md) as a worked example of cloud-data
dependence — one of the two "corpses" the local-first pitch stands on. It is a
web lookup service with no local batch mode and no bulk export. Reject.

### AcousticBrainz — free, open, and killed by its own maintainers for quality

CC0, roughly 7.5 million recordings keyed by MusicBrainz ID, high-level mood
(happy / sad / aggressive / relaxed / party) included, and the full dump is
still downloadable, frozen at June 2022.

Rejected for a reason worth recording loudly: **MetaBrainz shut it down because
the data quality was not good enough.** That is an authoritative negative
result about precisely the class of Essentia mood classifiers this document
recommends expanding into, from the people who ran them at the largest scale
anyone has. It is the single strongest argument for the validation gates below.

Practically it also fails twice over: joining it to this library needs AcoustID
fingerprinting to obtain MusicBrainz IDs, and MBID coverage for white-label
jungle and bandcamp rips will be poor.

### Cloud APIs (Cyanite and similar) — rejected on positioning

Account-bound, paid, cloud-resident. Directly contradicts the strict
local-first, no-account, no-backend position that
[POSITIONING.md](../POSITIONING.md) identifies as one of this app's few
genuinely distinctive claims. Not evaluated further.

## What Essentia already gives us and we are not using

We use one embedding backbone (`msd-musicnn`) and one affect head
(`emomusic`). The zoo publishes each task across up to four backbones.

| Available | What it gives | Note |
| --- | --- | --- |
| `emomusic`, `deam`, `muse` | three independent arousal/valence regressors, each on MusiCNN **and** VGGish | six affect estimates; heads are 50–80 KB |
| `mood_aggressive`, `mood_party`, `mood_happy`, `mood_relaxed`, `mood_sad`, `mood_electronic`, `mood_acoustic` | binary mood classifiers | **all have Discogs-EffNet variants** |
| `mtg_jamendo_moodtheme` | 56 mood and theme tags (party, dark, energetic, powerful, uplifting, melancholic, relaxing, …) | the honest answer to "sentiment beyond energy" |
| `timbre` | bright / dark | EffNet only |
| `voice_instrumental` | vocal presence | easiest of all to falsify by ear |
| `approachability`, `engagement` | 2-class, 3-class and regression variants | EffNet only |
| `genre_discogs400`, `genre_discogs519` | 400/519 Discogs genre labels, plus newer MAEST transformer variants | the route to the 303 blank-genre tracks (WS5) |
| `deeptemp-k16-3.pb` | TempoCNN, with `local_tempo_probabilities` | beaTunes' tempo engine, open |

**Discogs-EffNet embeddings matter** because they are trained on Discogs, which
is far more electronic than the Million Song Dataset that MusiCNN learned from.
That is the out-of-distribution problem we measured, addressed at the
representation rather than by rescaling.

### The constraint that shapes the energy recommendation

**There is no `-discogs-effnet` variant of `emomusic`, `deam` or `muse`.**
Arousal and valence exist only on `msd-musicnn` and `audioset-vggish`. This was
already recorded during v33 research ("there is no EffNet arousal head") and is
re-verified here against the model zoo, because it is the one fact that decides
what the energy fix can and cannot be.

So the route to Discogs-trained affect is the binary mood heads, not arousal.
Our own 18-anchor shootout supports that: `aggressive_effnet` placed second
overall at ρ +0.784 and was **the only candidate whose residual tempo slope was
positive** (+0.059, against MusiCNN arousal's −0.401). The Discogs-embedding
effect shows up empirically in exactly the place the theory predicts.

### Supporting literature

Ching & Widmer, *A Study on the Data Distribution Gap in Music Emotion
Recognition* (arXiv:2510.04688), investigate five dimensional-emotion datasets
including EmoMusic and DEAM, "demonstrate the problem of out-of-distribution
generalization in a systematic experiment", and find that a combination of
several diverse training sets yields "substantially improved cross-dataset
generalization". That is the published form of the failure v34 measured on this
library, and it is the argument for ensembling `emomusic`, `deam` and `muse`
rather than picking one.

## The decision

Do not buy or integrate any of the four. Use what we already have, in three
stages, each gated before the next begins.

**The gate exists because v34's mistake was shipping a number nobody had
validated.** Adding 56 mood tags without validation would be that mistake times
fifty-six, and AcousticBrainz is the precedent for where that ends. Every stage
validates against the 18 anchors in `scripts/anchors.csv` plus the
genre-ordering check before anything reaches `Track`.

### 1. Energy (first, because it is measured broken)

Ensemble arousal across `emomusic` / `deam` / `muse` × MusiCNN and VGGish, add
at least one Discogs-EffNet mood head, and add BPM as an explicit term —
design-v34 §0.1 records why the earlier "never blend BPM" ruling no longer
holds.

Acceptance, both required:

- beat leave-one-out MAE **1.60** on the anchors, which is what plain BPM
  scores;
- stop ranking 170 BPM below 146 within the eleven tracks Michiel called
  equally maximal.

Cost: one re-run. The embeddings dominate runtime, so adding VGGish and EffNet
alongside MusiCNN roughly triples the 122-minute pass; the heads themselves are
free. `scripts/anchor-signals.json` already holds seven signals for the 18
anchors, so a candidate formula can be scored without touching audio at all.

### 2. Descriptors (second)

Prefer what a human can falsify by ear, in this order:

1. `voice_instrumental` — vocal presence. Trivially checkable, immediately
   useful to a DJ, and the safest first addition.
2. `timbre` — bright / dark.
3. `danceability` — already in the sidecar for all 2040 tracks, so it costs no
   re-analysis, and v34 observed it ordering the library **better than energy
   did** (Turkish Funk 0.62, Funk 0.85, every dance genre 0.90–0.98).
4. `mtg_jamendo_moodtheme` — 56 tags, last and most sceptically. Cite
   AcousticBrainz when tempted to ship these unvalidated.

Promoting any of them to a real `Track` property is WS4-shaped work: a
`TRACK_PROPERTIES` entry (`properties.ts:61`, which buys filter and column for
free), `TrackSortField` (`trackSort.ts:10`), `EMPTY_TRACK_FIELDS`,
`migrateColumns`, and the pinned counts in `tests/properties.test.ts` and
`tests/columns.test.ts`.

### 3. Suggestions (third)

Michiel's explicit choice: **better inputs into the existing deterministic
criteria.** No similarity engine, no embeddings in the combo graph.

The pushback behind that choice, recorded so it is not relitigated: audio
similarity is not the same as mixes-well. Two tracks that sound alike often
make a dull transition, and contrast is frequently the point. A
nearest-neighbour engine would also be unexplainable to the user and would
duplicate what the wheel already shows geometrically, against the "map, not the
logbook" position.

## Rejected — do not re-propose without new evidence

Mirroring the WS3 precedent at the top of design-v34, so nobody re-derives
these:

- **beaTunes** — mood is Last.fm/AcousticBrainz-derived, not audio-derived;
  "color" does not export; its tempo model is already ours for free.
- **Sononym** — sample browser, wrong problem.
- **Tunebat** — database frozen at pre-November-2024 Spotify data; cloud only.
- **AcousticBrainz** — shut down by its own maintainers for data quality;
  needs fingerprinting; frozen June 2022.
- **Cloud mood APIs** — contradict the local-first position.
- **An audio-similarity combo engine** — rejected on design, not on capability.

## Sources

- [Mixed In Key FAQ](https://mixedinkey.com/faq/mixed-in-key/) — the delivery
  path comparison and the 30-day refund terms
- [beaTunes support: mood tags](http://help.beatunes.com/discussions/problems/45711-mood-tag-wont-write-to-tagfield-in-mp3/page/1)
  and [beaTunes FAQ](https://www.beatunes.com/en/beatunes-faq.html) — mood
  inferred from Last.fm tags or AcousticBrainz; "color" is proprietary and does
  not export
- [Sononym](https://www.sononym.net/) and
  [MusicRadar's review](https://www.musicradar.com/reviews/sononym-sononym) —
  similarity search scope
- [MetaBrainz: ending AcousticBrainz](https://blog.metabrainz.org/2022/02/16/acousticbrainz-making-a-hard-decision-to-end-the-project/)
  and the [AcousticBrainz downloads page](https://acousticbrainz.org/download)
- [Essentia model zoo](https://essentia.upf.edu/models) — the full inventory,
  including the absent EffNet arousal head
- Ching & Widmer, [arXiv:2510.04688](https://arxiv.org/abs/2510.04688)
- Schreiber & Müller, *A Single-Step Approach to Musical Tempo Estimation Using
  a Convolutional Neural Network*, ISMIR 2018 — TempoCNN
