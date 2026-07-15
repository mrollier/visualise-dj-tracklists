# Genre Distance & Similarity Measures for a DJ Library Visualisation App: A Source-Backed Report

## TL;DR

- **Ship a Discogs-derived genre pack, not your current MediaEval/AcousticBrainz one.** Your method #4 is built on data licensed **CC BY-NC-SA 4.0** (Discogs/Last.fm/Tagtraum subsets of the MediaEval AcousticBrainz Genre Dataset), which blocks any commercial release and forces ShareAlike on your whole pack; the Discogs **monthly data dumps are CC0 public domain** ("Our monthly data dumps are available under the the CC0 No Rights Reserved license") and carry exactly the genre+style pairs you need. This single change fixes your biggest legal risk and gives you cleaner, electronic-heavy data.
- **Merge your four methods into two: a normalized lexical/alias layer (keep #1+#2) and one distributional embedding (replace #4's PPMI+random-projection with PPMI+truncated SVD).** At 400–700 labels, random projection has *no* computational justification and is strictly worse than SVD on reconstruction error; SVD is trivially cheap at this scale. Keep the curated graph (#3) only as a hand-audited prior for the electronic core.
- **Genre similarity is genuinely asymmetric in the cognitive literature (Tversky), but a thresholded symmetric UI is defensible if you (a) symmetrize explicitly, (b) down-weight umbrella labels, and (c) apply a hubness correction (mutual proximity).** The umbrella-label-becomes-a-hub problem is a textbook instance of *hubness* in high-dimensional similarity spaces, which has a known, cheap fix. A single global threshold is the weakest link; the literature favours rank-based (top-k) criteria.

---

## Key Findings

1. **Genre is "intrinsically ill-defined"** (Aucouturier & Pachet 2003, *JNMR* 32(1):83–93). The paper classifies genre-representation approaches into "manual, prescriptive and emergent" categories and argues no precise definition survives scrutiny. Every measure you build is an approximation of a contested concept; there is no ground-truth genre-similarity function, only proxies. Design for robustness to disagreement, not for a "correct" answer.
2. **Four families of measure exist**: taxonomy/ontology-based (path, Wu–Palmer, Leacock–Chodorow, Resnik/Lin IC); distributional/co-occurrence (PMI/PPMI, PPMI+SVD, word2vec, node2vec); audio content-based (Essentia/AcousticBrainz features, learned embeddings — OpenL3, MusiCNN, CLAP); and hybrids. For a text-label-only, offline app, the distributional and taxonomy families are the practical choices; audio embeddings solve a different problem (per-track, not per-label) and add heavy dependencies.
3. **Licensing is the decisive constraint and it eliminates several "obvious" sources.** CC0/public-domain and shippable: Discogs data dumps, Wikidata. Non-commercial / not redistributable: Last.fm, MediaEval AcousticBrainz, musicmap.info, Every Noise at Once (frozen and Spotify-owned since 4 Dec 2023). Mixed/subtle: MusicBrainz (core is CC0 but tag-derived genre associations are CC BY-NC-SA 3.0).
4. **PPMI + truncated SVD dominates PPMI + random projection at your vocabulary size.** Levy & Goldberg (2014) established the PMI–SVD–word2vec equivalence and state directly that "exact factorization with SVD can achieve solutions that are at least as good as SGNS's solutions for word similarity tasks." Bingham & Mannila (2001) show random projection only *approaches* PCA quality and its whole point is escaping expensive decompositions — a non-issue for a 700×700 matrix. 24 dimensions is plausibly adequate but should be validated empirically.
5. **The hub problem has a named, cheap solution.** Umbrella labels ("Electronic") becoming universal neighbours is *hubness* (Radovanović, Nanopoulos & Ivanović 2010, *JMLR* 11:2487–2531; Schnitzer, Flexer et al.). Mutual Proximity (MP) and local scaling reduce it and conveniently output symmetric similarities in [0,1].
6. **A single global threshold is the weakest design choice.** Evaluation and recommendation literature both point toward rank-based / top-k neighbour criteria as better-calibrated across heterogeneous vocabularies.

---

## Details

### Q1 — Taxonomy of approaches

**(a) Taxonomy- and ontology-based measures.** These operate over a genre tree/graph with is-a (parent/derived) edges.

- **Path length / edge counting** (Rada et al. 1989): distance = number of edges on the shortest path; similarity is a decaying function of it. This is essentially **your method #3** (decay^shortest-path). Assumptions: all edges represent equal semantic distance — demonstrably false (Resnik's critique that a uniform edge distance "cannot account for the semantic variability of a single link"). Strength: interpretable, tiny, offline, handles the curated electronic core well. Failure modes: unseen labels get no node; distances are sensitive to how densely each region of the tree was hand-built; "Electronic"→everything is short.
- **Wu–Palmer**: `2·depth(LCA) / (depth(c1)+depth(c2))`, bounded [0,1], symmetric. Rewards a deep common ancestor. Good fit for a thresholded [0,1] UI. Needs a rooted tree with sensible depths.
- **Leacock–Chodorow**: `-log(pathlen / 2·D)` where D is taxonomy depth; unbounded, needs rescaling to [0,1].
- **Information-content measures — Resnik, Lin, Jiang–Conrath**: weight nodes by IC = −log p(concept). **Resnik** = IC of the lowest common ancestor (unbounded, and *identical for all pairs sharing that ancestor* — a real weakness). **Lin** = `2·IC(LCA)/(IC(c1)+IC(c2))`, bounded [0,1], symmetric — the best-behaved for your purposes. **Jiang–Conrath** is a distance. IC can be computed *intrinsically* from tree structure (Seco et al.) or *extrinsically* from corpus frequencies — the latter lets you fold in how often each genre actually appears in DJ libraries.
- Cost: all are O(tree depth) per pair, negligible. Data requirement: a curated tree, which you already have for ~90 electronic genres.

**(b) Co-occurrence / distributional measures.** Build a genre×context matrix (context = tracks, artists, playlists, or other genre co-tags), reweight, reduce, and take cosine.

- **PMI / PPMI**: `PMI(a,b)=log[p(a,b)/(p(a)p(b))]`; PPMI = max(0,PMI) to avoid −∞ and keep it factorizable. Standard, interpretable, captures "these genres get tagged together."
- **PPMI + SVD (LSA)**: truncated SVD gives dense low-rank vectors; cosine on `W = U·Σ^p` (Levy & Goldberg recommend p≈0.5, the symmetric variant). **This is the well-supported default.**
- **word2vec / GloVe**: Levy & Goldberg (2014, *Neural Word Embedding as Implicit Matrix Factorization*, NeurIPS 27:2177–2185) proved SGNS implicitly factorizes a shifted-PMI matrix — so at small vocabularies these buy you little over explicit PPMI+SVD, at the cost of a training loop.
- **node2vec / graph autoencoders on a genre graph**: relevant if you have a genre relation graph rather than co-occurrence counts; Deezer's work (Salha-Galvan, Hennequin) uses graph autoencoders in exactly this space.
- Assumptions: distributional hypothesis (genres appearing in similar contexts are similar). Strength: emergent, data-driven, captures cross-taxonomy synonymy ("DnB"↔"Drum & Bass" if they co-tag). Failure modes: **frequency/hubness bias** (popular umbrella tags co-occur with everything → hubs); unseen labels get no vector; quality depends entirely on the corpus. **This is your method #4.**

**(c) Audio content-based genre spaces.** Essentia/AcousticBrainz low-level features; learned embeddings — **OpenL3, MusiCNN, CLAP/MuLan**. CLAP (Contrastive Language-Audio Pretraining, Microsoft/LAION) is notable because it is a **joint text–audio space** trained with a symmetric InfoNCE contrastive objective: you can embed the *text string* of a genre label directly and get a vector even for an unseen label, then cosine-compare. This is the only route that natively solves "unseen label" without any co-occurrence data. But: it needs a bundled neural text encoder (tens–hundreds of MB), and its genre-label geometry is unvalidated for fine electronic subgenres. It also shifts you from per-label to per-track reasoning, which is a bigger architecture change. Recommend as an *experimental* branch, not the core.

**(d) Hybrids.** Combine a curated tree prior with distributional evidence (retrofitting: pull embedding vectors toward graph neighbours — Epure et al. 2020 use a modified retrofitting on multilingual genre graphs). This is the most promising direction for you: a hand-audited electronic core (trustworthy) + distributional fill-in for the long tail (coverage).

### Q2 — Data sources: licence & redistribution status

| Source | Licence | Can you ship it in an OSS/commercial app? |
|---|---|---|
| **Discogs monthly data dumps** | **CC0 (public domain)** — "Our monthly data dumps are available under the the CC0 No Rights Reserved license" (support.discogs.com; data.discogs.com) | **Yes, unconditionally** (dumps only; the *API* is separately governed and its "Restricted Data" is non-commercial/no-transfer). Genre + style pairs are in the dumps. **Best option.** |
| **MusicBrainz** | Core data CC0; **genre associations are tag-derived "supplementary" data → CC BY-NC-SA 3.0** (docs: "the association of genres with entities is done via user tags") | **Partial / risky.** The controlled genre list may be usable, but genre-to-entity associations come via user tags in the NC-licensed supplementary dump. Treat as NC unless you confirm otherwise. |
| **Wikidata** (stylistic-origin, subclass-of relations) | **CC0** | **Yes.** Good for cross-checking parent/derived edges. Coverage of niche electronic subgenres is patchy. |
| **DBpedia** | **CC BY-SA** | Yes with attribution + ShareAlike. Heavier than Wikidata; used by Epure et al. as a genre graph backbone. |
| **Last.fm tags** | **Non-commercial only; no sub-licensing; must credit; must not transfer** (API ToS: "You are permitted to use the Last.fm Data solely for non-commercial purposes… You must not sub-license the Last.fm Data to others") | **No.** Cannot bundle into a redistributable pack. Commercial use requires a separate agreement via partners@last.fm. |
| **MediaEval AcousticBrainz Genre Dataset** | **Discogs/Last.fm/Tagtraum subsets: CC BY-NC-SA 4.0; AllMusic subset: non-commercial research only, access-gated, no redistribution/modification without UPF permission** | **No for commercial; NC+ShareAlike even for OSS.** This is what **your method #4 is built on** — see the critical warning below. |
| **Every Noise at Once** | Spotify-internal data; **frozen since 4 Dec 2023**; no redistribution licence | **No.** Static snapshot, proprietary source, no legal basis to redistribute (see below). |
| **musicmap.info** | Proprietary (sells prints; commercial store); no open data licence | **No.** Excellent reference for *hand-building* your tree (234 intermediate genres, explicit primary/secondary/anti-links), but you cannot copy its relation data into a pack. |
| **Beatport taxonomy** | Proprietary; "curation across 36+ electronic sub-genres" (Beatport CEO letter, 2025), now expanding into open-format Hip-Hop/R&B/Pop/Latin/Caribbean/African | **No** (as a dataset). The *list of genre names* is factual and low-risk to mirror as a vocabulary, but the curated hierarchy is Beatport IP. |

**On Every Noise at Once:** the site froze on 4 December 2023 when creator Glenn McDonald was among the ~1,500 employees (17% of staff) cut in Spotify's third 2023 layoff round. His own site notice reads: *"With my layoff from Spotify on 2023-12-04, I lost the internal data-access required for ongoing updates to many parts of this site."* At freeze it mapped 6,291 named genres drawn from ~1 million artists. Spotify told Billboard Canada the frozen status is "likely to remain for the foreseeable future." The underlying data was always Echo Nest→Spotify proprietary; there is no licence under which you could redistribute it.

**Critical warning on your current method #4.** Your PPMI+random-projection pack is derived from the MediaEval AcousticBrainz Genre Dataset. Per the official Zenodo/MTG/MediaEval pages, the Discogs, Last.fm, and Tagtraum subsets are **CC BY-NC-SA 4.0** and the AllMusic subset is **"non-commercial scientific research purposes only"** with redistribution and modification prohibited without UPF permission. The verbatim licence statement (mtg.github.io/acousticbrainz-genre-dataset; multimediaeval.github.io/2018-AcousticBrainz-Genre-Task/data) is: *"The resulting genre metadata is licensed under CC BY-NC-SA 4.0 license, except for data extracted from the AllMusic database, which is released for non-commercial scientific research purposes only. Any publication of results based on the data extracts of the AllMusic database must cite AllMusic as the source of the data."* The AllMusic terms (Zenodo record 2554044, access-restricted) add: *"You may not redistribute, publically communicate or modify it, unless expressly permitted by the Universitat Pompeu Fabra (UPF) or by applicable law."* Consequences:
- **Commercial shipping is blocked** by the NC clause (CC BY-NC-SA 4.0 §1(i): NonCommercial means "not primarily intended for or directed towards commercial advantage or monetary compensation").
- Even for a free/OSS app, **ShareAlike forces your entire derived pack under BY-NC-SA 4.0**, and a co-occurrence matrix or embedding *is* an adaptation that inherits those terms.
- Crucially, the licence attaches to the **genre annotation labels themselves** ("genre metadata"), not merely the Essentia audio features — so the annotation-derived co-occurrence data you used is squarely covered.
- The dataset pages contain **no explicit clause about redistributing a derived artifact**, so the safest reading is that the standard CC terms travel with it (this is an inference — see Caveats).
- **Fix:** rebuild the same PPMI vectors from the **Discogs CC0 dump**, which contains the same genre/style vocabulary at larger scale and imposes no downstream restrictions.

### Q3 — Key papers (full citations)

- **Aucouturier, J.-J. & Pachet, F. (2003).** *Representing Musical Genre: A State of the Art.* Journal of New Music Research 32(1):83–93. DOI:10.1076/jnmr.32.1.83.16801. — The foundational "genre is ill-defined" argument; distinguishes manual, prescriptive, emergent approaches.
- **Bogdanov, D., Porter, A., Schreiber, H., Urbano, J. & Oramas, S. (2019).** *The AcousticBrainz Genre Dataset: Multi-Source, Multi-Level, Multi-Label, and Large-Scale.* ISMIR 2019 (archives.ismir.net/ismir2019/paper/000042.pdf). — The four-taxonomy dataset (Discogs, Last.fm, Tagtraum, AllMusic); the reference for cross-community genre disagreement. Full intersection of dev sets = 247,716 recordings.
- **Schreiber, H. (2015).** *Improving Genre Annotations for the Million Song Dataset.* ISMIR 2015 (archives.ismir.net/ismir2015/paper/000102.pdf). — Free-text tag→genre mapping, label normalization, majority-vote ground truth. The basis for your alias-table / "Schreiber-style" normalization.
- **Schreiber, H. (2016).** *Genre Ontology Learning: Comparing Curated with Crowd-Sourced Ontologies.* ISMIR 2016:400–406. — Directly compares hand-built vs crowd-derived genre ontologies; relevant to your #3-vs-#4 question.
- **Sordo, M., Celma, Ò., Blech, M. & Guaus, E. (2008).** *The Quest for Musical Genres: Do the Experts and the Wisdom of Crowds Agree?* ISMIR 2008. — Builds genre similarity from Last.fm tags (per-artist genre-tag frequency vectors, SVD to 50 dims), compares to an expert taxonomy via a path-distance folksonomy with a virtual root and cross-branch penalty. **The closest prior art to what you are building.**
- **Sordo, M., Laurier, C. & Celma, Ò. (2007).** *Annotating Music Collections: How Content-Based Similarity Helps to Propagate Labels.* ISMIR 2007.
- **Epure, E. V., Salha, G. & Hennequin, R. (2020).** *Multilingual Music Genre Embeddings for Effective Cross-Lingual Music Item Annotation.* ISMIR 2020 (arXiv:2009.07755; CC BY 4.0; code at github.com/deezer/MultilingualMusicGenreEmbedding). — Genre "translation" across inconsistent tag systems via embeddings + retrofitting on a DBpedia genre graph. Directly relevant to your messy-vocabulary problem. See also the companion *Leveraging Knowledge Bases and Parallel Annotations for Music Genre Translation* (Hennequin et al., ISMIR 2019).
- **Levy, O. & Goldberg, Y. (2014).** *Neural Word Embedding as Implicit Matrix Factorization.* NeurIPS 27:2177–2185. — SGNS ≈ factorizing shifted PMI; states "exact factorization with SVD can achieve solutions that are at least as good as SGNS's solutions for word similarity tasks." Practical advice: factor PPMI (not shifted) with SVD, use `W=U·Σ^0.5`.
- **Bingham, E. & Mannila, H. (2001).** *Random Projection in Dimensionality Reduction: Applications to Image and Text Data.* KDD 2001:245–250. DOI:10.1145/502512.502546. — RP preserves distances "comparably to PCA"; its purpose is avoiding expensive decompositions on huge matrices.
- **Schnitzer, D., Flexer, A., Schedl, M. & Widmer, G. (2012).** *Local and Global Scaling Reduce Hubs in Space.* JMLR 13:2871–2902. — Mutual Proximity; the canonical hubness-reduction method for music similarity.
- **Flexer, A., Schnitzer, D. & Schlüter, J. (2012).** *A MIREX Meta-analysis of Hubness in Audio Music Similarity.* ISMIR 2012 (Best Paper). — Establishes hubness as pervasive in music similarity. See also **Flexer & Stevens (2016/2017)**, *Mutual proximity graphs for improved reachability in music recommendation*, JNMR.
- **Radovanović, M., Nanopoulos, A. & Ivanović, M. (2010).** *Hubs in Space: Popular Nearest Neighbors in High-Dimensional Data.* JMLR 11:2487–2531 (jmlr.org/papers/v11/radovanovic10a). — The general hubness result.
- **Tversky, A. (1977).** *Features of Similarity.* Psychological Review 84:327–352. — Similarity is asymmetric; "the variant is more similar to the prototype than vice versa." The theoretical warrant for treating subgenre→parent ≠ parent→subgenre.
- **Sturm, B. L. (2014).** *The State of the Art Ten Years After a State of the Art: Future Research in Music Genre Recognition.* JNMR 43(2):147. Plus Sturm's *A Survey of Evaluation in Music Genre Recognition* (2012). — The reference for how (badly) genre tasks are usually evaluated.

### Q4 — Semantics questions, argued from the literature

**Should genre similarity be symmetric?** *Cognitively, no.* Tversky (1977) showed similarity judgments are systematically asymmetric — "the variant is more similar to the prototype than vice versa" — so a listener will rate "Liquid DnB is like Drum & Bass" higher than the reverse. Set-containment and KL-based measures capture this: the **Tversky index** is asymmetric (and generalizes Jaccard/Dice — "Because of the inherent asymmetry, the Tversky index does not meet the criteria for a similarity metric"), and **containment similarity** `|A∩B|/|A|` explicitly privileges the query's size. *But* your UI applies one global threshold to draw an undirected edge, so you need a symmetric score in [0,1]. The defensible resolution, straight from the measurement literature: **compute the two directional scores and symmetrize explicitly** — either the symmetric Tversky variant (using max/min of the distinctive-feature terms, a documented option) or `sim = min(dir(A→B), dir(B→A))` if you want an edge only when *both* directions are close. Document the choice: `min` is conservative (fewer spurious edges through umbrella parents), `max` is permissive. Wu–Palmer and Lin are already symmetric and bounded, which is why they are attractive for a thresholded UI. **Recommendation: keep the stored score symmetric, but derive it from an explicit symmetrization of a directional measure rather than pretending asymmetry doesn't exist.**

**Multi-genre and umbrella labels.** Two distinct problems:
- *Multi-genre fields* ("Melodic House & Techno"): parse into components at ingest, compute similarity per component, and aggregate (max or mean). Do **not** treat the concatenated string as an atomic label — it will match nothing. (Note musicmap's own convention: "/" indicates synonyms, "&" a combination of closely related sibling genres — a useful parsing heuristic.)
- *Umbrella labels* ("Electronic", "Dance") becoming similarity hubs: this is precisely **hubness** (Radovanović et al. 2010). High-frequency general tags co-occur with everything, so their vectors sit near the centroid and become everyone's nearest neighbour — the same pathology Flexer/Schnitzer document in audio spaces. Three cheap, literature-backed mitigations: (1) **PPMI weighting** already suppresses frequency bias by dividing out marginal probabilities; (2) **Mutual Proximity** (Schnitzer et al. 2012) rescales each pairwise distance by how surprising it is given each point's neighbour distribution — it demotes hubs and, usefully, returns a symmetric probability in [0,1]; (3) **down-weight or blacklist** a small set of known umbrella tags (assign them low IC / high depth in the tree so they never clear the threshold except against near-identical labels). Use all three.

**Single global threshold vs per-genre / top-k.** A single global threshold is the weakest part of your current design. Because different regions of genre space have different densities (electronic is finely subdivided; "World" is coarse), one threshold over-connects dense regions and isolates sparse ones — a direct consequence of the hubness/scaling analysis. The literature on neighbour-based recommendation and on mutual-proximity graphs (Flexer & Stevens 2016) favours **rank-based criteria: keep each genre's top-k nearest neighbours** (optionally mutual: an edge only if each is in the other's top-k). This is self-normalizing across densities. **Recommendation: expose the UI slider as a top-k / mutual-k control, or apply mutual proximity before thresholding so the single threshold operates on rescaled, density-corrected scores.**

### Q5 — Evaluation methodology

**How the field evaluates genre similarity.** (i) **Correlation with an expert taxonomy** — Sordo et al. 2008 compare crowd-derived similarity to an expert genre tree. (ii) **Human-judgment datasets** — triplet or pairwise "is A more similar to B or C?" tasks; Sturm's surveys stress that genre evaluation is riddled with faulty ground truth and label leakage. (iii) **Downstream task performance** — playlist continuation / recommendation accuracy (RecSys Challenge 2018 / Million Playlist Dataset). Important caveat: recent work finds artist co-occurrence, not genre, often dominates continuation accuracy — genre similarity is a comparatively weak downstream signal, so don't over-index on it.

**A concrete, low-effort evaluation you can run for your four methods.**
1. **Build a gold set of ordered genre pairs.** Draw ~150–250 genre *triplets* (anchor, near, far) from your actual library vocabulary, weighted toward electronic. Example: (Deep House | Tech House | Gabber) — anchor should be closer to "near" than "far." Source candidate triplets from your curated tree + Discogs style co-occurrence, then **have 3–5 DJs adjudicate each triplet** (keep only triplets with ≥⅔ agreement; report Cohen's/Fleiss' κ). This mirrors Sordo's expert-vs-crowd design.
2. **Metrics.** For each method compute **triplet/pairwise accuracy** (fraction of triplets where sim(anchor,near) > sim(anchor,far)) — robust and interpretable. Secondarily, build a small ranked list per anchor and report **Spearman ρ** against the median human ranking. Pairwise accuracy is more reliable than Spearman at small n because it doesn't assume a full total order.
3. **How many judgments.** For pairwise accuracy, ~200 adjudicated triplets give a 95% CI of roughly ±7% — enough to separate a good method from a bad one, not enough to split hairs between two close methods. If you want to distinguish methods differing by <5%, budget ~400–500 triplets. Prioritize breadth of vocabulary over depth of repetition.
4. **Also report coverage**: fraction of your real library's genre pairs each method can score at all (lexical and embedding methods fail on unseen labels differently). A method that's accurate on 40% of pairs may be worse in practice than a blunter method covering 95%.

### Q6 — Actionable recommendation

**Ranked recommendation of measures to adopt/improve:**

1. **Hybrid: curated electronic tree (Lin/Wu–Palmer) + Discogs-CC0 PPMI+SVD embedding, fused by retrofitting.** Trustworthy core + long-tail coverage. This is the target architecture.
2. **Discogs-CC0 PPMI + truncated SVD (24–64 dims), cosine, then mutual-proximity rescaling.** Your #4, rebuilt on legal data with the right reducer and a hubness fix. Standalone-viable.
3. **Normalized lexical (alias table + token-set Jaccard).** Keep as the first pass and as the unseen-label fallback — cheap, transparent, no data pack.
4. **Curated graph decay^path (your #3).** Keep *only* as a hand-audited prior feeding the hybrid; retire it as a standalone measure (path-length's equal-edge assumption is unsound — Resnik).
5. **CLAP text-embedding branch.** Experimental; the only clean answer to truly unseen labels, but heavy and unvalidated for subgenres.

**Verdict on your four existing methods:** **Keep & merge #1+#2** (normalization is prerequisite infrastructure for everything else). **Replace the data behind #4** (MediaEval→Discogs CC0) **and replace random projection with truncated SVD.** **Demote #3** to a prior. Net: four methods become a two-layer system (lexical gate → embedding+tree hybrid).

**PPMI + random projection vs PPMI + truncated SVD at 400–700 labels — the direct answer.** Random projection (Johnson–Lindenstrauss / Bingham & Mannila 2001) exists to make dimensionality reduction *tractable on very large matrices* by avoiding an eigendecomposition; it preserves pairwise distances only *in expectation, with variance*, and Bingham & Mannila's own framing is that it gives results "comparable to" — not better than — PCA. At 400–700 labels your PPMI matrix is at most ~700×700; a truncated SVD is milliseconds and trivial memory. So RP's *only* advantage is irrelevant here, while its *cost* (added noise, no optimal-rank guarantee) is live. **Truncated SVD is the Eckart–Young optimal low-rank approximation and will lose strictly less signal than RP at equal dimension** — and Levy & Goldberg confirm exact SVD factorization is "at least as good as" the neural alternative for similarity tasks. Therefore: **yes, PPMI + random projection is losing meaningful precision versus PPMI + truncated SVD at your scale, for no compensating benefit.** Practical settings: factor **PPMI** (not shifted PPMI) with SVD, use `W = U_d·Σ_d^{0.5}`, cosine similarity. On dimensionality: 24 dims may be adequate for ~700 labels but is at the low end; sweep d ∈ {16, 24, 32, 48, 64} on your triplet eval and pick by pairwise accuracy — don't assume 24 is right.

**Concrete build steps (input → processing → pack → function):**
1. **Input:** latest Discogs monthly dump (CC0) from data.discogs.com. Extract `(release → genre[], style[])`.
2. **Normalize:** apply your Schreiber-style alias table + separator cleanup to both Discogs styles and incoming ID3/Rekordbox labels so they share one vocabulary (~400–700 canonical labels after collapsing).
3. **Co-occurrence:** build a genre×genre (or genre×style) co-occurrence count matrix from releases; compute PPMI.
4. **Reduce:** truncated SVD to d (swept, default ~32); `W=U·Σ^0.5`; L2-normalize rows.
5. **Hubness fix:** apply mutual proximity to the cosine-similarity matrix → symmetric scores in [0,1].
6. **Fuse (optional, phase 2):** retrofit W toward your curated electronic tree's neighbours (Epure-style) so hand-knowledge overrides sparse data.
7. **Pack format:** ship a small quantized matrix — either the d-dim vectors (700×32 float16 ≈ 45 KB) or, simplest, a **precomputed sparse top-k neighbour list per label** (label → [(neighbour, score)×k]) as JSON/MessagePack, well under 1 MB. This also makes the client-side lookup O(1) and sidesteps shipping the full model.
8. **Similarity function:** `similarity(a,b)` = look up symmetrized MP score if both labels known; else fall back to token-set Jaccard on normalized strings; edge exists iff in top-k (mutual) OR score ≥ t. Return in [0,1].
9. **Licence hygiene:** pack is CC0-derived → you may license it freely; add attribution to Discogs as courtesy (not legally required for CC0).

---

## Summary Comparison Table

| Method | Data needed | Licence of that data | Offline-feasible | Handles unseen labels | Symmetric | Granularity | Evidence of quality |
|---|---|---|---|---|---|---|---|
| **#1 Exact match + alias norm** | Alias table (self-authored) | Yours | ✅ trivial | Partial (only via aliases) | ✅ | Exact | Necessary infra; Schreiber-style normalization is standard practice |
| **#2 Token-set Jaccard** | None | n/a | ✅ trivial | ✅ (string-based) | ✅ | Lexical, coarse | Reasonable baseline; no semantic knowledge |
| **#3 Curated graph decay^path** | Hand-built tree (~90 genres) | Yours (musicmap/Beatport as reference only) | ✅ | ❌ (no node) | ✅ | Fine, but hand-limited | Path-length has known flaws (Resnik); good as prior |
| **#4 PPMI + random projection (current)** | MediaEval AcousticBrainz | ⚠️ CC BY-NC-SA 4.0 / NC-only | ✅ | ❌ | ✅ (cosine) | Fine | RP suboptimal at this scale; **licence blocks release** |
| **#4′ PPMI + truncated SVD (proposed)** | Discogs dump | ✅ CC0 | ✅ | ❌ (needs co-occurrence) | ✅ (+MP) | Fine | Levy & Goldberg: SVD "at least as good"; Eckart–Young optimal |
| **Taxonomy Lin/Wu–Palmer** | Rooted tree + IC | Yours / CC0 (Wikidata) | ✅ | ❌ | ✅ | Fine | Well-established in NLP; bounded [0,1] |
| **Hybrid (tree + embedding, retrofit)** | Tree + Discogs | ✅ CC0 + yours | ✅ | Partial | ✅ | Fine | Epure et al. 2020 (retrofitting) |
| **CLAP text embedding** | Pretrained CLAP model | Model licence varies (check) | ⚠️ large model | ✅ (text encoder) | ✅ (cosine) | Open-vocab | Strong zero-shot audio results; **unvalidated for subgenre labels** |

---

## Implementation Brief (hand to a developer)

**Goal:** replace the current genre-similarity subsystem with a legally-shippable, better-calibrated one that returns a symmetric score in [0,1] and behaves well under a single UI control.

**Do this, in order:**
1. **Remove** the MediaEval/AcousticBrainz-derived embedding pack from any public/commercial build (licence: CC BY-NC-SA 4.0 + NC-research-only — not redistributable commercially).
2. **Fetch** the latest Discogs monthly dump (CC0, data.discogs.com). Parse releases → `genre[]` + `style[]`.
3. **Normalize** all labels (Discogs + incoming Rekordbox/ID3) through the existing alias table; produce one canonical vocabulary (~400–700 labels). Parse "&"/"/"-joined multi-genre strings into components.
4. **Compute** genre×genre co-occurrence counts over releases → PPMI matrix.
5. **Reduce** with truncated SVD; embedding `W = U_d·Σ_d^{0.5}`, L2-normalized; d swept over {16,24,32,48,64}, default 32. (Not random projection.)
6. **Cosine** → similarity matrix → apply **Mutual Proximity** (Schnitzer et al. 2012) for symmetric, hub-corrected scores in [0,1].
7. **Blacklist/down-weight** umbrella labels ("Electronic", "Dance", "Music") so they don't form hub edges.
8. **Export** a per-label top-k neighbour list (k≈15) as JSON/MessagePack (<1 MB). This is the shippable pack.
9. **Runtime `similarity(a,b)`:** if both labels in pack → symmetrized MP score; else → token-set Jaccard on normalized strings. Draw an edge iff mutual-top-k OR score ≥ t. Expose **k** (and t as secondary filter) in the UI, not just t.
10. **Validate** on a 200-triplet DJ-adjudicated test set (pairwise accuracy + coverage); report inter-annotator κ. Only promote a method that beats normalized-Jaccard on coverage-weighted accuracy.

**Pack licence:** CC0-derived → license freely; credit Discogs as courtesy.

---

## Recommendations (staged)

**Stage 0 — Immediate (legal):** Stop distributing the MediaEval-derived embedding pack in any build you intend to release publicly or commercially; it is CC BY-NC-SA 4.0 / NC-research-only. This is the one item with legal, not just quality, stakes.

**Stage 1 — Rebuild on CC0 (1–2 days):** Regenerate PPMI vectors from the Discogs dump; swap random projection for truncated SVD (`W=U·Σ^0.5`); sweep d. Ship as a top-k neighbour JSON. Benchmark against your existing four methods on a 200-triplet DJ-adjudicated eval.

**Stage 2 — Fix the hub & threshold problems (2–4 days):** Add mutual-proximity rescaling; change the UI criterion from a single global threshold to mutual top-k (expose k, keep t as a secondary filter). Blacklist/down-weight umbrella labels.

**Stage 3 — Hybrid (1–2 weeks):** Retrofit the Discogs embedding toward your hand-audited electronic tree. This is where accuracy on your core users' vocabulary will jump.

**Stage 4 — Optional / research:** Prototype a CLAP text-embedding fallback for unseen labels; evaluate whether the accuracy gain justifies the model-size cost.

**Benchmarks that would change the plan:** If the triplet eval shows the SVD embedding *underperforms* plain normalized Jaccard on coverage-weighted accuracy, keep the system lexical-first and treat the embedding as advisory. If CLAP text embeddings clear ~80% pairwise accuracy on electronic subgenres, promote it from experimental to a first-class unseen-label handler. If mutual-proximity doesn't measurably cut umbrella-label edges, fall back to explicit umbrella blacklisting.

---

## Caveats & open problems (flagged honestly)

- **No ground truth exists.** Aucouturier & Pachet's "ill-defined" verdict is not rhetorical — every number in your eval is agreement-with-humans, not correctness. Report inter-annotator κ alongside every accuracy figure.
- **The literature is thin on *genre-label* similarity specifically.** Most MIR work is on *track/artist* similarity or *classification*, not on a similarity function *between genre labels*. Sordo 2008 and Epure 2020 are the closest, and neither targets a DJ-mixing use case or electronic-subgenre granularity. You are partly in un-charted territory; don't expect a citable "correct" method.
- **MusicBrainz genre licensing is genuinely ambiguous** in public docs (core CC0 vs tag-derived associations CC BY-NC-SA 3.0). If you want to use it, get written confirmation from MetaBrainz rather than relying on my reading. (MetaBrainz also asks, on a "moral basis," that commercial users of even CC0 datasets support the foundation.)
- **"NC" derived-artifact status is an inference.** The MediaEval pages don't explicitly address redistributing a co-occurrence matrix/embedding; the conservative reading (CC terms travel) is mine, not the authors'. For certainty, ask UPF — or, better, just use Discogs and moot the question.
- **CLAP model licence is unverified here** — confirm the specific checkpoint's licence (LAION-CLAP vs Microsoft msclap differ) before bundling.
- **Hubness reduction can over-correct**, occasionally severing genuinely central genres. Validate MP on your eval, don't apply it blindly.
- **24 vs higher dimensions is unresolved** without your data; treat any specific d as a hypothesis to test, not a recommendation.
- **Discogs "style" ≠ Beatport/Rekordbox vocabulary.** Discogs styles are crowd-sourced and skew toward its collector base; some fine club-oriented distinctions (e.g., "Peak Time / Driving Techno") are Beatport-native and may map poorly. Your alias table bridges this, but the mapping is manual work and a persistent maintenance cost.
- **Genre space is non-stationary.** Beatport added Brazilian Funk as a standalone genre in 2025 and keeps splitting subgenres; any static pack ages. Plan a refresh cadence tied to Discogs dump releases (monthly).