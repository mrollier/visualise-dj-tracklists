# Issues — open

Nothing open right now. All nineteen items from the v13 review resolved in
**v14** ([designs/design-v14.md](designs/design-v14.md) has the per-issue
design notes, the S1 reservation algorithm, the effective-store layer and the
schema-v6 change list). The list below records what actually shipped —
including the few places the implementation deviated from the original plan,
kept honest so nothing is silently reopened.

## Resolved in v14

**Filters (F1–F4)**

1. **F1** — Numeric filter values truncated by their spin arrows. Fixed: the
   number boxes get their own width budget (`flex: 1 1 68px`, tabular numerals)
   so 4-digit years and 3-digit BPM stay legible with the spinner clear of the
   value. Holds for any numeric filter, not just the defaults.
2. **F2** — Text filters are now a **bounded A–Z first-letter range** (plus one
   `#` catch-all bucket for non-letter/diacritic starts), stepped through two
   selects like the numeric ranges. Applies uniformly to every name-like text
   property (artist, title, genre, album, composer, grouping, remixer, label,
   mix).
3. **F3** — The **Kind** filter is a **lossy / lossless / both** quality
   selector, mapping the raw format strings (MP3/AAC… vs WAV/AIFF/FLAC/ALAC…)
   onto the DJ-relevant choice. Unknown formats pass the filter.
4. **F4** — Field-nature filters: **Location** and **Comments** get a
   **"contains"** substring search; **Colour** gets a **chip multi-select**
   scoped to the Rekordbox tags present in the selected playlists; low-value
   numerics stay opt-in ranges. All driven off the existing `filterable` flag
   plus the new per-property `kind`.

**Sample data (D1–D2)**

5. **D1** — The sample dataset is enriched so **every filterable property is
   populated** across the set (composer, grouping, remixer, mix, colour, kind,
   bit/sample rate, size, track/disc number, date modified, last played,
   location), all deterministically id-hashed, with deliberate gaps on some
   tracks. _Deviation from the plan:_ the plan assumed `enrichTrack` re-rolled
   the authored `year`; it never did (the local `year` only builds the
   `dateAdded` anchor), so that true invariant was pinned by test rather than
   "corrected".
6. **D2** — Loading the sample now **auto-selects the Classic demo playlist**
   so the app opens on a populated wheel. Scoped to the sample only — user
   imports still start empty, and the genuine empty state ("Nothing to show
   yet") is preserved for deselected playlists / over-tight filters.

**Combo criteria (C1–C2)**

7. **C1** — Enabling a criterion **always** requires it now: the threshold ticks
   up by one (`min(threshold + 1, enabledCount)`) from any state, including a
   deliberate 0. The old "only from require-all" special case is gone.
8. **C2** — Criteria gained a **demanded (locked)** state via a per-row 🔒
   toggle (not a cycling tri-state checkbox). A pair is a combo when **every
   demanded criterion matches** AND total matched ≥ N; the locked count is a
   **floor** on N (locked boxes can't be unchecked). A demanded criterion that
   can't be evaluated (value missing either side) forms **no edge** — stricter
   than the shrink-the-denominator rule, which still applies to desired
   criteria. `evaluateCombo` uses a flag, never an early return, so `matched`
   stays populated for the forced-pool scorer.

**Set builder (S1–S3)**

9. **S1** — Essential (★ must-include) tracks are a **hard guarantee**, not a
   soft bias: a reservation forces every pending essential in before the walk
   ends (harmonious positions first, a criteria-breaking edge only as a last
   resort), immune to the adventurousness knob. If essentials outnumber the set
   length they all still go in. The guarantee can force edges even in plain ✨.
10. **S2** — **⚡ Force to N continues the short walk in place** by replaying the
    same seed/inputs with `force`, instead of rolling a fresh set. _Nuance:_
    for a single-arm walk this is a **strict prefix** extension; for a pinned-end
    (two-arm) walk it is **arm-stability seam-fill** (the start-arm prefix and
    end-arm suffix are kept, forced picks fill only the broken seam). Plain ✨
    still rolls a fresh set each press.
11. **S3** — The manual-edge preference is now tunable: a **manual-combo pull**
    weight (`manualEdgeWeight`, default 5 = the old `MANUAL_EDGE_BONUS`
    constant) in advanced → Set & suggestions dials how hard walks route through
    marked roads.

**Tracks view (T1)**

12. **T1** — **🔗 link mode works in the Tracks view too**: with link mode armed,
    clicking a different row toggles the manual edge (mirroring the wheel,
    including the non-resetting disarm so several partners chain). A crosshair
    cursor cues the armed state.

**Easy mode (E1)**

13. **E1** — Easy mode now **computes with defaults** (default criteria, no
    filters, default settings) via a derived **effective-store layer**, fully
    independent of the stored advanced config — which is preserved untouched and
    restored on returning to All controls. ★/pins/🔗 are hidden and inert; the
    playlist and created set stay shared. Tour copy updated.

**Track metadata (V1)**

14. **V1** — The hand-enter metadata editor (the `.edit-grid`) and the `isVinyl`
    field are **removed** end-to-end; the app never edits track metadata. The
    freed card space simply goes away. The unrelated **global** `key.vinylMode`
    criterion toggle is untouched (per-track vinyl marking stays rejected).

**Selected-track panel (R1)**

15. **R1** — The right rail has a **fixed width** (`280px`, `flex-shrink: 0`) and
    the `.link-hint` copy **wraps within it** (`overflow-wrap`, `min-width: 0`)
    instead of stretching the whole section.

**Wheel view (W1–W4)**

16. **W1** — Narrowing the key range now **fades the excluded keys' angular
    wedges**, not just their markers. _Deviation from the plan's wording:_ this
    reuses the existing **opacity fade** that the major/minor toggle already
    plays (that toggle _is_ a fade, not a geometric collapse) — extended to
    key-range exclusion via a shared `keyExcluded` helper on sectors and labels.
17. **W2** — Deleting a hovered track now **clears `hoveredId`**, so the wheel's
    blue hover-halo no longer lingers (fixed on `removeAt` and clear-all).
18. **W3** — In focus mode the **manual dashed roads dim** too: an edge incident
    to the selection stays bright, the rest fade to the node-dim factor.
19. **W4** — The same-key spread slider runs **0–2** now (still defaulting to 1,
    byte-identical at 1 and 0). The mapping is piecewise — `0 → 0°`, `1 → 4°`,
    `2 → 7.5°` — and accounts for the node radius so the node's _edge_ (not its
    centre) kisses the ±7.5° wedge boundary at factor 2.

## Schema

The persisted project bumped to **version 6** in one step (WS2), covering the
whole v14 wave: the WS2 text-range → new-kind migration (old string tuples drop
on load), the WS4 `demanded` flags (whitelisted with explicit boolean coercion,
threshold re-floored to the locked count), the WS1 `isVinyl` drop, the WS7
`slotSpreadFactor` clamp widening to 0–2, and the WS5 `manualEdgeWeight`
(clamped finite 0–10, else the default 5). Details in
[designs/design-v14.md](designs/design-v14.md).
