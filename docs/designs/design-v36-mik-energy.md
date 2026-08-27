# v36 — Mixed In Key energy: the purchase, the parser, and the removal of analysed energy

Shipped 2026-08-27, on `main`. Closes the energy thread that v33 opened, v34
measured, and ISSUES items 8, 9, 11 and 12 tracked.

## 1. The registered test, and its verdict

Mixed In Key was bought and run against the seven anchor tracks whose pass/fail
thresholds were fixed in advance in section 0.2 of the v34 design. Results:

| Track | BPM | Threshold | MIK | Verdict |
| --- | --- | --- | --- | --- |
| Just Jungle — Ere Dread `.wav` | 170 | ≥ 8 | 7 | miss (−1) |
| Dub-Liner — The Kill `.mp3` | 175 | ≥ 8 | 8 | pass |
| SPK — Looper `.aiff` | 175 | ≥ 8 | 6 | miss (−2) |
| Fresh — Gatekeeper `.mp3` | 174 | ≥ 8 | 7 | miss (−1) |
| Versa & Rowl — Zodiac `.mp3` | 168 | ≤ 5 | 5 | pass, on the boundary |
| Clouds — Arkhangelsk Nightmare `.mp3` | 140 | ≥ 8 | 7 | miss (−1) |
| Traumprinz — Ambient 006 `.aiff` | 122 | ≤ 3 | 3 | pass, on the boundary |

By the letter of the registered rule this is 4 of 7 missed — but the outcome
fell into a gap the registration never anticipated: Zodiac (the tempo-reading
discriminator) passed while the fast material landed at 6–7 instead of
clearing 8. The ordering was perfect on all seven — every 9.5-labelled track
scored above Zodiac, which scored above Ambient — and MIK beat the shipped
energy on magnitude (MAE 2.21 vs 2.64 against Michiel's labels). Reading:
**MIK is not a tempo meter, it hears something real, but it compresses the top
of the scale on fast breakbeat material.** The purchase was kept.

## 2. What MIK wrote, library-wide

Michiel configured MIK to write Key (Camelot) + Energy into the file Comment
tag with the Tempo tag write disabled, ran the full library, and used
Rekordbox's Reload Tags to pull the comments into its database (note: Reload
Tags is reported to clobber Rekordbox-only fields on some setups — it was
verified safe here before the batch). The re-export is
`docs/rekordbox/collection-energy-tagged.xml`.

Coverage: **2041 of 2051 real tracks (99.5%)** carry a MIK energy — including
all 64 WAVs and all 772 AIFFs, so the v34 prediction that MIK cannot tag WAV
was wrong in practice: the value reaches the app through Rekordbox's database
and XML export regardless of what landed in the file. The 10 untagged tracks
mostly carry pre-existing prose comments MIK left alone. Every observed
comment is `key - Energy N` or `key - Energy N - <old prose>` — MIK prepends
and preserves.

## 3. MIK energy vs the v34 analysed energy (2033 tracks with both)

- **Distribution**: MIK is compressed — sd 1.04 vs 1.61, 87% of the library
  on 5–7, no 1s and no 10s in 2000+ tracks. Means match (6.02 vs 5.93).
- **Agreement**: MAE 1.13, 71% within ±1, Pearson r = +0.48.
- **Tempo entanglement**: MIK energy vs Rekordbox BPM r = **+0.17** — it is
  not reading tempo (Michiel's own labels correlate +0.77 with BPM).
- **Where they diverge is exactly the analysed energy's measured failure
  zone**: below 155 BPM the two track each other (r ≈ 0.55 per band); above
  155 the analysed energy drops (mean 5.4–5.5) while MIK holds (6.2), and
  the largest per-track disagreements are almost all jungle/DnB where MIK is
  4–5 levels higher — the direction Michiel's labels say is correct. Jungle,
  the largest genre, shows the biggest genre-level gap (MIK 6.59 vs 5.51).
- **Against the 17 tagged anchors**: MIK r = **+0.911** / Spearman +0.870 —
  better than the analysed energy (+0.828) and better than BPM (+0.762).
  Raw MAE 2.26 (the compression); a linear rescale fitted on the anchors
  reaches leave-one-out MAE 1.12. **Michiel decided against any rescale:
  MIK values are displayed exactly as MIK wrote them.**

## 4. What shipped

### The parser (`parseMikComment`, model.ts)

Handles all eight MIK comment formats — key, tempo and energy in either
order, energy worded (`Energy 7`) or bare (`7`), keys with an optional
leading zero (`05A`). Splits on space-padded hyphens so `hip-hop` and
`Track 7 - remix` never parse; comment keys are Camelot-only by shape so
prose like `d-floor` cannot become a key. `energyFromComments` delegates to
it, upgrading both existing call sites (import and project load) untouched.

### Key/BPM source preference (settings)

Two advanced settings, `keySource` and `bpmSource`
(`'rekordbox' | 'comments'`, default `'rekordbox'`), in the Key & BPM
section. With `'comments'`, the MIK token wins and a track without one keeps
its Rekordbox value — the fallback chain is comment → Rekordbox → analysis
sidecar. Applied in a derived layer (`sourced`, stores.ts) before the sidecar
merge, so toggling is live, exports and persistence keep raw Rekordbox truth,
and a `distinct` guard keeps unrelated settings churn out of the O(n²) combo
view. The set panel now resolves through `augmentedTrackById` so its
transition chips agree with the wheel (also closing the v33 gap where
analysis-filled keys never reached it); its `.m3u8`/`.csv` exports still
resolve raw.

### Analysed energy removed

Energy now has **exactly one source: the `Energy N` comment token.** The
arousal-derived fallback (`energyOf`, `energyFromArousal`, the 3.5–7.5 band)
is deleted, `AnalysisEntry` no longer accepts an `energy` field, the merge
never fills or badges energy, and the import summary no longer mentions it.
A track without the token keeps an honest null rather than an inferior
estimate — MIK simply won this comparison, and forcing a model-derived number
into the gaps would blur the one field that is now trustworthy. The four v35
descriptors (arousal, valence, danceability, happiness) are untouched: they
remain display-only, badge-marked, and cleanly separated from energy.

## 5. Loose ends, deliberately left

1. **The 30 sampler one-shots carry `Energy 4`-style comments** (MIK tagged
   them like everything else), so they import with a real energy the v34
   design said they should never have. Cosmetic; revisit only if they ever
   pollute a filter extent.
2. **10 real tracks are untagged** (8 with old prose comments). A MIK re-scan
   or a hand-typed token closes them; their energy is null until then, which
   is now the honest state rather than a gap to fill.
3. **No rescale of MIK's compressed scale**, by decision — the fitted map
   (label ≈ 2.12 × MIK − 5.22, LOO MAE 1.12) is recorded here in case the
   compression ever starts to bite in practice, but the values shown are
   MIK's own.
