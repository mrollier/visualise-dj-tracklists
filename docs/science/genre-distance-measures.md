# Distance measures in genre space

Technical choices, the evidence behind them, a plan for what comes next, and the
blind spots where more research is needed. Sources cited as `[name]` are local
PDFs in [`docs/articles/`](../articles/); the research reports that led to them
live in [`docs/research/`](../research/). Written 2026-07-16, after v6.

## 1. Why the app needs a genre distance

Four features consume one number, `sim(labelA, labelB) ∈ [0,1]`:

1. **Combo edges** — the genre criterion contributes a match when two tracks'
   genres are close enough ([`src/core/combos.ts`](../../src/core/combos.ts)).
2. **Genre classes** — average-linkage clustering in the selected method's
   space assigns node shapes ([`src/core/genreClasses.ts`](../../src/core/genreClasses.ts)).
3. **The genre map** — screen distance in the force layout approximates
   `1 − sim` ([`src/lib/GenreMapView.svelte`](../../src/lib/GenreMapView.svelte)).
4. **Set suggestions** — the walk generator scores candidate transitions
   partly on genre closeness ([`src/core/suggest.ts`](../../src/core/suggest.ts)).

Hard constraints, in force since v1: client-side and offline (no backend, no
upload), a redistributable data pack of at most a few MB, symmetric scores in
[0,1], and **label-space only** — the app never sees audio, so all distance
must come from the genre *strings* in the user's library.

## 2. The six shipped methods and their grounding

| Method | Computation | Primary source |
| --- | --- | --- |
| Exact | normalized labels identical (aliases unify) | [schreiber2015] normalization rules |
| Lexical | token-set Jaccard after normalization | — (standard IR) |
| Graph | `decay^shortestPath` over a curated relation graph | [—] Rada et al. 1989 |
| Taxonomy | Lin similarity, intrinsic information content, over a hand-rooted DAG | [lin1998]; Seco et al. 2004 (intrinsic IC) |
| Embedding | co-occurrence → PPMI → truncated SVD → cosine → Mutual Proximity | [levy2014]; [schnitzer2012]; [bogdanov2019] (data) |
| Hybrid *(default)* | the embedding retrofitted toward the curated tree | [epure2020]; Faruqui et al. 2015 (retrofitting) |

Pipeline constants, all in
[`scripts/build-genre-embedding.mjs`](../../scripts/build-genre-embedding.mjs) /
[`scripts/genre-pack-lib.mjs`](../../scripts/genre-pack-lib.mjs):
co-occurrence pairs below **10** recordings are floored out (rare-pair noise);
SVD dimension **d = 32**, chosen by `--sweep` over d ∈ {16, 24, 32, 48, 64}
against the built-in triplet eval; per-label **top-20** neighbour lists;
umbrella labels (`electronic`, `electronica`, `dance`, `pop`, `rock`, `music`)
damped **×0.5** and excluded from runtime rankings; retrofit runs **10**
iterations at α = 1. The runtime matcher defaults to **mutual top-k (k = 5)**
with a 0.2 threshold floor; genre-class merging gates at similarity **0.25**.
The data behind the pack is the AcousticBrainz genre dataset [bogdanov2019] —
1.96 M recordings over its three openly licensed sources (Discogs, Last.fm,
Tagtraum; the AllMusic portion is research-only and excluded).

## 3. Technical choices and why they were made

**Truncated SVD, not random projection.** The Mistral research report
recommended PPMI + random projection for cost reasons; our dimension sweep
found SVD strictly better on the triplet eval at identical pack size, and
[levy2014] supplies the theory: PPMI + SVD is implicitly the same
factorization as skip-gram word2vec, so we get "word2vec for genre labels"
without shipping a neural net. At a ~700-label vocabulary the SVD costs
seconds at build time and nothing at runtime — the cost argument only applies
to vocabularies orders of magnitude larger.

**Mutual Proximity, blended — not raw.** High-dimensional similarity spaces
develop hubs: a few labels become everyone's nearest neighbour
(Radovanović et al. 2010). MP [schnitzer2012] rescales each pairwise score by
how mutual the closeness is. Applied alone it *saturated* (nearly everything
became either 0 or 1), so the pack ships `MP × max(0, cosine)` — MP fixes the
ranking, cosine keeps the magnitude informative.

**Umbrella damping.** "Electronic" co-occurs with everything, so any
co-occurrence method makes it a similarity hub that would connect house to
gabber through the parent. Damping ×0.5 at build time plus exclusion from
runtime rankings is a blunt instrument that works; §5(d) flags it as
unvalidated.

**Mutual top-k as the default matching mode.** A single global threshold
cannot serve both dense regions (the electronic cluster, where everything
scores ≥ 0.3 against everything) and sparse ones (a lone jazz label). Rank-based
mutual top-k self-calibrates to the library's local density — both research
reports independently flagged this failure mode of global thresholds. The
classic threshold mode remains for users who want it.

**Hybrid as the default method.** Retrofitting the data-driven embedding
toward the curated tree ([epure2020]'s approach, algorithm from Faruqui 2015)
scores 100 % on the triplet eval versus the plain embedding's 91 %, and gives
tree-only club genres (liquid drum & bass, melodic techno) usable vectors that
co-occurrence data alone is too sparse to provide.

**Symmetry by construction.** Similarity is arguably asymmetric — a subgenre
is "more similar" to its parent than the reverse ([tversky1977]) — but every
consumer in the app (undirected edges, clustering, force layout) needs one
number per pair, so all six methods are symmetric by design. This is a
deliberate simplification, revisited in §5(c).

**The pack format.** Per-label top-20 neighbour lists rather than raw vectors:
O(vocabulary) space, O(1) lookup, and unknown labels degrade gracefully to the
lexical fallback instead of failing.

## 4. What the 2019–2025 literature changes — and the plan

The deep-learning wave mostly moved *audio* representation (MERT, MuQ,
foundation-model surveys), which our label-only constraint sidesteps for now.
Four shifts do matter here:

1. **Joint text–audio spaces** (CLAP — Wu et al. 2023, arXiv:2211.06687;
   MuLan — Huang et al. 2022, arXiv:2208.12415). Their *text towers* embed any
   genre string — including labels no dataset ever tagged — into a space
   trained against actual music. This attacks our out-of-vocabulary problem at
   the root and, since LAION-CLAP is permissively licensed, could lift the
   CC BY-NC-SA inheritance the AcousticBrainz pack carries.
2. **Hyperbolic geometry** (Schmeier et al. 2019, arXiv:1907.12378). Poincaré
   embeddings make taxonomy distance and embedding distance the *same*
   distance — the principled version of what our retrofit approximates.
3. **Conditional similarity** (Lee et al. 2020, arXiv:2008.03720). One learned
   metric with user-weightable genre/mood/instrument/tempo axes — the
   deep-learning mirror of our criteria panel, and the natural frame for the
   planned weighted-edges feature.
4. **LLM-era label semantics** (Epure et al., EMNLP 2020, arXiv:2010.06325;
   LLM zero-shot genre annotation, arXiv:2410.08321). Genre meaning is
   culture- and annotator-dependent; LLMs are now credible normalizers of
   messy labels.

### The plan, in order

| # | Step | What it answers | Effort / gate |
| --- | --- | --- | --- |
| P1 | **Coverage instrumentation**: measure, for a real imported library, what fraction of its normalized genre labels hit the pack vocabulary / the tree / only the lexical fallback; surface the number in the import ⓘ report | how big the OOV problem actually is — every later step is sized by this | small; do first |
| P2 | **CLAP-text pack experiment**: encode the current vocabulary + tree labels with the LAION-CLAP text encoder offline; emit the *same* neighbour-list pack format; score on the 40-triplet eval against hybrid | whether a permissively-licensed, OOV-capable vector source can replace or join the AcousticBrainz pack | medium; gate: ≥ hybrid's triplet accuracy before any UI work |
| P3 | **Grow the eval**: extend the 40 hand-authored triplets toward the research report's proposed ~200 DJ-adjudicated triplets (external judges, not the author) | whether our method ranking is real or self-confirmation | small to start, human-time bound |
| P4 | **Hyperbolic experiment**: Poincaré embedding fit on the same co-occurrence data, tree edges as supervision; compare on P3's eval | whether one geometry can subsume the embedding/taxonomy/hybrid trio | research-grade; only if P2 leaves headroom |
| P5 | **Audio embeddings** (Essentia.js first, MERT-class later) | genre distance for tracks with *no* label at all | large; existing roadmap item, unchanged |

P1 and P2 are independent of each other and of the app's feature roadmap;
neither changes any user-facing behaviour until its gate passes.

## 5. Blind spots — where more research is required

**(a) User-defined labels → useful vocabulary.** The central one. Real
Rekordbox libraries contain labels that are *personal conventions*, not genre
names: "Peak Time / Driving", "warm up", "melodic 124", "1997 rave", labels in
other languages, artist names used as genres. The current chain —
normalization → alias table → delimiter splitting → lexical fallback — handles
spelling variants of *known* genres but does nothing principled with the rest:
an unknown label silently degrades to token overlap, which scores "melodic
124" ≈ 0 against everything. We don't yet know (i) how common such labels are
in real libraries (P1 measures this), (ii) whether they should map to genres
at all or be recognized as a different *kind* of tag (mood/energy/slot
descriptors that Rekordbox users routinely put in the genre field), or
(iii) which resolver is right — edit-distance guessing is cheap and dumb, a
CLAP text tower embeds arbitrary strings natively (P2), an LLM pass at import
time is the most capable and the least local-first. Research needed before
building anything.

**(b) No external ground truth.** The 40 triplets were written by us, for the
genres we care about, and the hybrid method was tuned until it aced them. That
is a smoke test, not an evaluation; a method ranking based on it is circular.
The literature's standard fix is human-judged pairs/triplets with inter-rater
agreement ([sordo2018] did exactly this for taxonomy-vs-folksonomy). P3 is the
smallest honest version.

**(c) Asymmetry.** Tversky's directionality (subgenre→parent ≠
parent→subgenre) is real in genre space, and both research reports raise it.
Everything downstream assumes symmetry, and no user has complained — but
"deep house matches house" pulling *all* house tracks toward a deep-house
anchor is a quiet consequence worth studying when suggestion quality gets
attention.

**(d) Magic numbers.** Umbrella damping ×0.5, the 0.2 threshold floor, k = 5,
merge gate 0.25, decay per graph hop — none has been validated beyond "looks
right on the sample packs". A proper eval (P3) would let these be fit rather
than guessed.

**(e) Vocabulary drift and recency.** The AcousticBrainz ground truth predates
2019. Genres that emerged or exploded since — hyperpop, phonk, amapiano, hard
techno's revival, afro house — are missing or underweighted in the
co-occurrence data, and only the hand-curated tree covers some of them. A
static pack ages; we have no refresh strategy. (A CLAP-text pack, P2, ages
more slowly since the encoder generalizes to unseen strings.)

**(f) Cultural and multilingual semantics.** Epure et al. showed genre
annotations differ *systematically* across language communities — the same
label doesn't mean the same music. Our normalization is English-centric. Low
priority for a single-user tool, worth knowing about if the app ever ships a
multilingual pack.

**(g) Licence ceiling.** The shipped pack inherits CC BY-NC-SA from
AcousticBrainz, which is fine for this private, non-commercial app but caps
any future distribution. P2 doubles as the escape hatch.

## References

Local PDFs in [`docs/articles/`](../articles/): [tversky1977] Tversky,
*Features of Similarity*; [lin1998] Lin, *An Information-Theoretic Definition
of Similarity*; [aucouturier2003] Aucouturier & Pachet, *Representing Musical
Genre: A State of the Art*; [li2005] Li & Ogihara; [schnitzer2012] Schnitzer
et al., *Local and Global Scaling Reduce Hubs in Space*; [sturm2013] Sturm &
Gouyon; [levy2014] Levy & Goldberg, *Neural Word Embedding as Implicit Matrix
Factorization*; [hirai2015] Hirai et al., *MusicMixer*; [schreiber2015],
[schreiber2016] Schreiber; [sordo2018] Sordo et al., *The Quest for Musical
Genres* (ISMIR **2008** — the file is named `sordo2018.pdf`); [bogdanov2019]
Bogdanov et al., *The AcousticBrainz Genre Dataset*; [epure2020] Epure et al.,
*Multilingual Music Genre Embeddings*.

Recent (arXiv, not yet downloaded — list with links in the 2026-07-16
conversation): CLAP 2211.06687 · MuLan 2208.12415 · Musical Word Embedding
2404.13569 · MERT 2306.00107 · MuQ 2501.01108 · Foundation-models survey
2408.14340 · Poincaré music recs 1907.12378 · Artist-similarity GNN
(TISMIR 5(1), 2022) · Disentangled metric learning 2008.03720 · Genre
perception across cultures 2010.06325.
