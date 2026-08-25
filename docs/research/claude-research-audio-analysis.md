# Local audio analysis for Zodiac Tracker — feasibility report & integration roadmap

**Status: report only.** Michiel's explicit instruction (2026-08-14): do a full and thorough analysis of how this could (or could not) work in practice — **do not build yet**. Decisions already taken by Michiel: open-sourcing the app under AGPL is acceptable; Python sidecar for the heavy batch; analysed values may feed the wheel/combo engine as first-class, badge-marked fallback.

> **Unparked 2026-08-25.** WS1 (the provenance layer) is being built on branch `v33-audio-analysis-provenance`. This report is no longer wholly current — it predates the codebase by two schema versions and one subsystem. Read it alongside [designs/design-v33-audio-analysis-provenance.md](../designs/design-v33-audio-analysis-provenance.md), which supersedes it on four points: the schema target (v8 → no bump at all, the schema is now v10), the matcher (v28's `core/audio/pathMatch.ts` replaces the proposed `src/core/match.ts` extraction), the calibration set (see the correction below), and the localStorage estimate (§4's "300–500 KB, fits" is ~2× low and the project would breach the 5 MB cap).

## Context

Michiel wants the option to analyse tracks with incomplete metadata (e.g. missing BPM) inside the app, given the track's original file path and a locally available file — plus Mixed-In-Key-style "feel" properties (energy, happiness/mood), using open-source software. "Essentia.js opt-in local audio analysis" has been a deferred roadmap item since design-v1; this report turns it into a concrete, validated architecture.

## 1. What the repo already recorded (prior art)

- **No audio analysis code exists.** Zero hits for AudioContext/decodeAudioData/essentia/aubio/meyda/wasm in src/. Only audio-adjacent dependency: `music-metadata` (tag reading, dynamically imported in TopBar.svelte:49).
- Essentia.js is a **deliberately deferred, opt-in roadmap item** across five years of docs: design-v1.md:9,84 · design-v12.md:19,127 (non-goal "no Essentia.js analysis yet") · IDEAS.md:41-50 · science/genre-distance-measures.md P5 (audio embeddings for blank-genre tracks) · README.md:372.
- `energy` today = regex over Rekordbox Comments for MIK "Energy N" tags (`energyFromComments`, model.ts:95). ~~Only ~20 of 2080 tracks carry the tag — those 20 double as a free calibration set for analysed energy.~~ **CORRECTED 2026-08-25 (v33):** the collection carries **6**, not ~20 — values 4, 4, 5, 6, 6, 7, plus one unparseable "Very high energy". Three of the six are by the same artist, all sit between 112 and 128 BPM, and all are house-adjacent. That is a biased anecdote, not a calibration set, and the Pearson-r plan in §5 WS2 cannot be run over it. See [designs/design-v33-audio-analysis-provenance.md](../designs/design-v33-audio-analysis-provenance.md) for what the follow-up research concluded instead — in short, buying Mixed In Key as a ~1986-track *training* set, and three corrections to the model plan below (there is no EffNet arousal head; the output tensor is `(valence, arousal)`; MIK Energy is absolute, so a decile map cannot reproduce it).
- **Track model already carries the absolute file path**: `location` parsed from Rekordbox XML (rekordbox.ts:121), persisted (persist.ts:161), decoded back to a filesystem path in exporters/m3u.ts:4-11. Basename matcher exists (importers/m3u.ts:20-53 `buildMatcher`).
- **Product principles that must survive**: README.md:258 "deliberately not a key/BPM analyzer"; ISSUES.md:490 V1 "the app never edits track metadata" (hand-editor built v12, removed v14); design-v12.md:129 "no backend, no accounts, no upload — ever"; model.ts "Missing metadata is null, never a guess".
- **The actual gap in Michiel's library** (docs/rekordbox/collection.xml, 2080 tracks): 22 missing BPM, 33 missing key, **303 missing genre**. BPM/key is a ~1–2% gap-fill; feel/energy applies to all 2080; the science doc says only audio analysis (P5) reaches the 303 blank-genre tracks. Caution: several missing-BPM entries are Rekordbox sampler one-shots (`.../Sampler/OSC_SAMPLER/PRESET ONESHOT/NOISE.wav`) — argues for confidence gating and path excludes.
- **Existing precedent for the recommended shape**: `scripts/build-genre-embedding.mjs` → `src/data/genre-embedding.json` → `src/core/genre.ts`, with pure helpers in `genre-pack-lib.mjs` covered by `tests/genre-pack.test.ts` — "heavy computation offline, compact pack consumed by the client" is already this repo's pattern.
- **Single choke point for augmentation**: every view (Wheel, Tracks, GenreMap, filters, combo engine) consumes derived `visibleLibrary` (stores.ts:372), so one layer inserted upstream propagates analysed values everywhere automatically.

## 2. Open-source landscape (researched 2026-08)

| Need | Option | Verdict |
|---|---|---|
| BPM | **essentia.js** RhythmExtractor2013 / PercivalBpmEstimator (WASM, AGPL-3.0) | Accurate, confidence output; stale (v0.1.3, June 2022) but functional |
| BPM | **web-audio-beat-detector** / realtime-bpm-analyzer (MIT, tiny) | ~1–2 BPM on electronic music, 90–180 default range; permissive fallback |
| Key | **essentia.js / Essentia** KeyExtractor (`edma` profile) | Returns classical key strings — existing `normalizeKey` (keys.ts:43) already converts to CamelotKey; strength value gates confidence |
| Key | **libkeyfinder** (Mixxx's detector, GPLv3) via emscripten (webKeyFinder proves the port) | MIK-lineage accuracy; custom WASM+FFTW build to maintain; now unlocked by AGPL decision, revisit only if KeyExtractor disappoints |
| Energy/mood | **MTG Essentia TF models**: emoMusic arousal/valence regression (closest analogue to MIK Energy 1–10), mood_happy/sad/aggressive/relaxed/party, danceability | Run on embeddings (one MusiCNN pass serves all heads); **CC BY-NC-SA 4.0** (non-commercial — fine for this personal app) |
| Energy (cheap) | RMS loudness + onset density heuristic | No ML, no NC licence; weak MIK correlation — documented fallback, not primary |
| Genre (P5) | Discogs-EffNet embeddings + genre head (400 Discogs labels) | Only route to the 303 blank-genre tracks; heavy; research-gated |
| Batch runtime | **essentia-tensorflow** pip (fresh macOS arm64 wheels, May 2026) | Actively maintained, first-class model support — carries the heavy load |

Platform constraint: **a browser cannot open a file from a path string.** In-browser access = File System Access API directory grant (Chromium-only; persistable handles, Chrome 122+ persistent permission) + basename matching, or drag-drop fallback. A repo-local script has no such limits — it opens files by decoded `Location` path directly.

## 3. Recommended architecture: sidecar-first hybrid ("analysis pack")

**One provenance layer, two producers.**

- **Core:** a file-keyed **analysis sidecar** — separate provenance layer in the project JSON (schema v8) that never writes into Rekordbox-sourced Track fields. Analysed values fill nulls only, at a derived-store layer, badge-marked everywhere.
- **Primary producer — offline Python script** (`scripts/analyse-audio.py`, essentia-tensorflow): reads collection.xml or saved project JSON, opens files by path, runs BPM (RhythmExtractor2013 multifeature, confidence-gated), key (KeyExtractor edma → Camelot), one MusiCNN embedding pass → arousal/valence energy + happiness + danceability. Writes sidecar JSON incrementally (resumable, `--exclude Sampler/`), prints fill counts + Pearson r against the 20 MIK-tagged tracks. **Delivers both asks end-to-end.**
- **Secondary producer — in-app browser analyser** (gap-fill convenience): File System Access directory grant over `~/Music/rekordbox` (single root, verified in his XML), match by location/basename, decode via `decodeAudioData` on main thread, transfer mono Float32Array (zero-copy) to a Web Worker running essentia.js WASM for BPM+key on the ~55 gap tracks (≈4–7 s/track ⇒ 4–6 min). Drag-drop fallback for non-Chromium. With the AGPL decision, this can ship in the public bundle (lazy `await import()` like music-metadata; WASM in public/, cached by sw.js).

**Why not all-in-browser for everything:** feel models for 2080 tracks = ~15–40 MB model downloads + 2–5 s/track ⇒ 1.5–3 h in a tab holding a directory grant — fragile vs a resumable script; essentia.js's TF.js path is the stalest part of a stale package; and the NC-licensed models shouldn't ship in the public bundle anyway. The genre-pack precedent already blesses the offline-script shape.

**Licence posture (Michiel: open-sourcing is fine):** relicense repo **AGPL-3.0** so essentia.js WASM can ship publicly; also unlocks libkeyfinder (GPLv3) later. MTG models stay CC BY-NC-SA → keep the models themselves out of the shipped bundle (script-side only). Sidecar *outputs* (numbers per track) are derived metadata in Michiel's own project file — displaying them in the app is fine.

## 4. Data model & persistence (never-edit invariant)

Sidecar format (new `src/core/analysis.ts`):

```jsonc
{
  "zodiacAnalysis": 1,
  "run": { "analysedAt": "…", "tool": "essentia-tensorflow 2.1b6", "models": ["…"] },
  "tracks": {
    "/Users/…/track.mp3": {
      "bpm": 128.02, "bpmConf": 0.93,
      "key": "8A",   "keyConf": 0.81,
      "energy": 7, "happiness": 0.62, "danceability": 0.88
    }
  }
}
```

- **Keyed by full decoded path**; matched in-app by exact `track.location` first, lowercased-basename fallback — matcher logic extracted from m3u.ts into shared `src/core/match.ts`. Ambiguous basename fallbacks skipped and reported.
- **Confidence gating honours "null, never a guess"**: below-threshold BPM/key written as null (conf recorded) — sampler one-shots never get a fabricated key. Thresholds tuned against the 20 MIK calibration tracks.
- **Energy conflict policy**: MIK "Energy N" from Comments wins where present; analysed energy fills the other ~2060.
- **Persist v8**: `Project.version: 8`, `analysis: AnalysisSidecar | null`; parseProject accepts v1–8, sanitizes every entry (same untrusted-JSON discipline as sanitizeTrack). `analysisStore` joins autosave/applyProject in persistence.ts. **Deliberate exception:** `replaceLibrary` does *not* clear analysis (file-keyed; must survive XML re-import — a 3-hour batch cannot be disposable); `resetEverything` clears it. Size ≈ 300–500 KB for 2080 entries — fits localStorage; fallback: strip analysis from autosave copy only. **Raw embeddings never enter the project** (WS5 ships neighbour lists, like the genre pack).
- **Augmentation layer in stores.ts**: `analysisByTrackId` derived from [library, analysisStore]; `augmentedLibrary` fills nulls and feeds `visibleLibrary` (stores.ts:372) in place of `library` — wheel gutter, combos, filters, table all update with zero engine changes. `analysedFieldsById` drives provenance UI (e.g. `≈128`, dotted underline, tooltip "analysed locally — not from Rekordbox") in TracksView + SelectedTrackCard. Raw `library` keeps feeding persist/undo untouched (same pattern as the easy-mode `effective*` layer, stores.ts:250-267). Per Michiel: **first-class fallback** — keyless tracks leave the gutter and grow combo edges.

## 5. Phased workstreams (for when he greenlights)

- **WS1 — Provenance layer** (pure TS, no audio): analysis.ts types/sanitizer/merge + arousal→energy mapping, match.ts extraction, persist v8, stores augmentation, sidecar import via existing Import button (detect `zodiacAnalysis` discriminator; ImportReport-style note: "BPM filled 19/22, key 30/33, energy 2,041; 6 below confidence; 12 files not found"), provenance badges. Vitest (node env, all pure): sanitize/reject, v7→v8 round-trip, null-fill-only (non-null Rekordbox value never replaced), matching incl. collisions, energy mapping edges, conflict policy. Deliverable: hand-written sidecar lights up the app.
- **WS2 — Offline analyser**: `scripts/analyse-audio.py` + pure helpers in `scripts/analysis-lib.mjs` (location decoding, resumable merge, confidence gate) with vitest coverage, mirroring genre-pack-lib precedent. Model execution verified by real-library run + fixture-WAV smoke test. **Full user value lands here.**
- **WS3 — In-app gap-fill analyser**: AnalysisPanel.svelte (folder grant / drag-drop, progress per-track postMessage, cancel = flag + worker.terminate; partial results commit per-track), analyser.ts orchestration, worker.ts (essentia.js WASM BPM+key). First IndexedDB use (persisted directory handle — tiny, isolated). Tests: orchestration with mocked worker/decoder adapters; real WASM verified manually (vitest node env has no AudioContext/WASM-audio).
- **WS4 — Feel surfaces**: `happiness` joins TrackSortField (trackSort.ts:10) + property registry (properties.ts:61 → filter/column for free), optionally radial/colour axis unions. Analysed energy flows into existing energy axis via augmentation already.
- **WS5 — P5 genre tie-in** (research-gated, separate): script emits Discogs-EffNet top-k audio-neighbour lists as second sidecar section for the 303 blank-genre tracks; genre engine gains audio fallback for null-genre pairs; gate on triplet-eval like P2.
- **Also**: README positioning amendment ("…and fills only what Rekordbox left blank, locally, provenance-marked"), AGPL relicense commit, IDEAS.md status flip, design-v19-style doc.

## 6. Risks & mitigations

- **essentia.js staleness (0.1.3, 2022)**: pin exactly; narrow `Analyser` interface so web-audio-beat-detector/libkeyfinder/aubio can swap per-feature. Python side actively maintained — that's why it carries the heavy load.
- **Half/double-time BPM**: fold into 70–180 preferred octave; combo engine's halfDouble handling tolerates residuals.
- **Quality vs Rekordbox/MIK**: fill-nulls-only, never contradict; confidence gating; MIK-tag correlation reported before trusting energy.
- **Files moved since export / basename collisions / sampler junk**: full-path-first matching, reported counts, path excludes.
- **Chromium-only FS Access**: acceptable for n=1; drag-drop fallback; script route browser-independent.

## 7. Verification (when built)

WS1/WS2 helpers: vitest in node env (pure logic only). Script: run against the real 2080-track library; check fill counts (expect ≈19/22 BPM, ≈30/33 key after gating), Pearson r vs the 20 MIK energy tags, spot-check analysed keys against Rekordbox for a sample of *known*-key tracks (accuracy proxy). In-app: manual run over the ~55 gap tracks in Chromium + drag-drop path in Safari/Firefox; confirm keyless tracks leave the wheel gutter with badges; confirm project save/load round-trips v8; confirm public bundle contains no NC model weights.

## 8. Immediate next step (per Michiel's "don't build yet")

Record this as the updated Essentia.js roadmap entry: add a pointer in docs/IDEAS.md (or ISSUES.md backlog per his issues-first mode) referencing this report; no code changes.
