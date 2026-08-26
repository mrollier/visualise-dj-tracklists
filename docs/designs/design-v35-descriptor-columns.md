# v35 — the analysis descriptors become real properties

Branch `v35-descriptor-columns`, off `v34-offline-analyser`. This is v33's
deferred **WS4**, widened from two fields to four.

## What shipped

`arousal`, `valence`, `danceability` and `happiness` are now `Track` fields:
sortable Tracks-table columns and left-panel range filters, hidden by default
and opt-in from Advanced → Track properties, exactly like `energy`.

No re-analysis was needed. All four were already in the sidecar for every
track and already survived `sanitizeAnalysis`; `mergeAnalysis` simply threw
them away, because `AnalysedField` did not name them.

Measured over the real collection, through the real merge, by
`tests/analysis-contract.test.ts`:

```
arousal:       28-83%  over 2042 tracks
valence:       28-77%  over 2042 tracks
danceability:   2-100% over 2042 tracks
happiness:      0-99%  over 2042 tracks
```

The six-track gap between `energy 2036` and `descriptors 2042` is the tracks
carrying a Mixed In Key "Energy N" comment, which blocks the derived energy
and leaves the raw arousal to show anyway.

## The decisions worth keeping

**Whole percentages, stored on `Track`, not formatted at display.** Three
reasons, in order of how much they matter. `wholeExtent` floors and ceils, and
the filter boxes are `<input type="number">` at the default `step="1"` — a raw
0–1 domain collapses onto the boxes `0` and `1`, and the filter is unusable.
The column and the filter then share one unit. And it needs no new code in the
filter engine at all.

**The nominal model range, not the observed one.** `energyFromArousal`
stretches an eyeballed 3.5–7.5 band because energy is a combo criterion, and a
near-constant criterion always matches — which silently loosens the N-of-M
threshold library-wide. These four gate nothing, so there is nothing to
protect and no reason to add a second tuned constant. Mapping the nominal 1–9
instead leaves the emoMusic head's shrink towards its mean **visible**:
arousal really does only span 28–83%, and the column says so. The contract
test now pins that — if arousal ever reaches the ends of the scale, either the
model changed or someone swapped in an empirical band.

**Energy and Arousal are both shown, on different curves.** For any track
without a Mixed In Key comment they are the same measurement, and because the
two curves differ, one track can read Energy 10 and Arousal 83%. That is in
Energy's hint rather than hidden.

**One `descriptorsFilled` counter, not four.** Challenged in review as a
derived number. It is not: the run above reports `energy 2036, descriptors
2042`, and that six-track difference is exactly the MIK-tagged tracks.

**The provenance badge stays on descriptor cells.** The first draft exempted
them — every filled cell in these columns is analysed, so the dotted underline
marks the column rather than the value. Review pushed back and was right: that
argument justifies an *additional* column-level marker, never removing the
only signal that survives a screenshot. `analysisOnly` was cut back to one job,
grouping.

**One tooltip, on the group.** A per-row `InfoTooltip` was drafted and
removed. `.filter-label` is `overflow: hidden`, so it was clipped, and the row
markup is shared — a 16px icon steals width from the number boxes on the BPM
and Year rows too, in a 250px rail. Per-property hints are `title` attributes;
the collapsible group's summary carries the one real tooltip.

## Non-goals

- **No combo criterion and no radial axis.** Deliberate, and the point of the
  wave. Nothing unvalidated influences a suggested transition, so `combos.ts`,
  `RadialAxis`, `scales.ts` and `portrait.ts` are untouched.
- **No CSV export.** The 9-field contract is deliberately lossy, and keeping
  analysed values out of it is what stops an export/re-import laundering them
  back in as Rekordbox-looking truth.
- **No synthetic descriptors in the demo collection.** `enrich.ts` fakes an
  energy *and* the "Energy N" comment that would have produced it — it
  simulates a source. Nothing simulates an analysis run, so the four read `—`
  there and `tests/samples.test.ts` exempts `analysisOnly` properties from its
  every-filter-has-something-to-bite-on contract. Reversible: the counter-case
  is that a new user who opts the columns in sees four dead columns.
- **No schema bump.** Additive, like `audioPreview` (v28), the panel flags
  (v30), `avoidSameArtist` (v31) and `analysis` (v33).

## Verified

- `npm test` — 1048 passing, 6 skipped.
- `npm run check` — 0 errors across 327 files. Three sites enumerate `Track`'s
  keys explicitly (`persist.ts` `sanitizeTrack`, `importers/rekordbox.ts`, and
  `canonTrack` in `tests/persist.test.ts`); all three were compile-forced, and
  the four keys sit between `energy` and `playCount` in each, which the
  byte-identical round-trip pin requires.
- The real 2040-entry sidecar, through `mergeAnalysis`, produces the ranges
  above with every value a whole number inside 0–100.
- Removing the four `num(entry.x)` lines from `sanitizeTrack` was confirmed to
  turn the round-trip test red, so it tests what it claims to.
- **The browser probe** — `node scripts/screenshot.mjs` against `npm run dev`,
  exit 0, no console errors, across the v33, v34 and v35 blocks. v35's block
  pins what vitest cannot see: a descriptor cell renders `94%` and not `0.94`
  or `94`, it keeps its `td.analysed` underline, the column header carries its
  hint as a `title`, the Analysis group appears and opens with rows in it, and
  no filter's number box is squeezed below 40px by the group's wider labels.
  It caught two real defects on its first run — the probe's own `.prop-row`
  count (28 properties + 4 pseudo-rows) needed to go to 36, and the group's
  `<summary>` is unclickable because a nested `<details>` inside the collapsed
  Filters section is in the DOM but not visible.

## Not verified

- **`arousal`, `valence` and `happiness` as columns**, and the group's own
  tooltip panel. The probe drives `danceability` end to end and ticks
  `arousal`'s column on; the other two ride the same registry-driven path, so
  they are covered by construction rather than by assertion.
- **Whether any of the four is any good.** This wave surfaces numbers; it does
  not validate them. Only danceability has evidence beyond a glance: Spearman
  −0.047 against BPM on a 330-track sample, so unlike energy it is not a
  tempo meter in disguise, and its bottom tail is right by eye — the ten
  least-danceable tracks in the library are all Anatolian and Persian ballads.
- **Whether the filter boxes ever seed blank.** Review predicted they would:
  `FiltersSection`'s seeding `$effect` keys off the raw `$library` while the
  extents derive from the augmented one, so analysis arriving later cannot
  reseed. The probe shows the opposite in the case that matters — enabling the
  Danceability filter *after* a sidecar is loaded seeds it 38–94 from the real
  extents, because switching a row on seeds that row. The predicted failure
  needs the reverse order, a sidecar arriving while the row is already
  visible, which the probe does not cover. `↺` fills them either way.
- **`Danceability` still ellipsises to `Danceabi…`** in the filter row. The
  group's labels are 72px against the flat rows' 52px, and widening further
  buys the name at the cost of the number boxes, which have to hold `100`. The
  full text is on the label's `title`, and the group header supplies context.
- **Danceability's mapping is honest but not useful across its whole range.**
  Mean 0.921, and 79% of the library above 90%. It is a top-decile switch that
  separates ballads from dance tracks, not a ranking within dance tracks. The
  hint says so.

## Reconciling the record

`design-v34-offline-analyser.md` recorded "No `happiness`/`danceability` on
`Track`" as a non-goal and scoped WS4 to those two fields. This wave ships
four, adding `arousal` and `valence`, which v34 had explicitly kept raw.

`ISSUES.md` item 13 gates a **descriptors** stage behind anchor validation,
with `voice_instrumental` first. That gate is not overridden. It governs
numbers that change what the app *recommends* — a new model head joining the
combo criteria or the suggestion ranking. These four are display-only, cost no
new model, no new analysis run and no new eyeballed constant, and are already
computed. Anything that reaches `combos.ts` still waits for the anchors.
