# Ideas — a statused backlog

Triaged 2026-07-18 against everything shipped through v11; the resulting v12 plan
lives in [designs/design-v12.md](designs/design-v12.md). Statuses: **done** ·
**v12** (planned) · **v14+** (backlog, shaped) · **rejected** (with why) ·
**research** (gated in
[science/genre-distance-measures.md](science/genre-distance-measures.md)).

## General

- **Proper A/B testing of buttons/switches** — **rejected** as formal A/B (n = 1
  user); easy mode (v12), the token-driven design system, and occasional "design
  lab" presets serve the same goal.

## Research

- **Read the ChatGPT/Mistral genre research, draw key conclusions** — **done**:
  [science/genre-distance-measures.md](science/genre-distance-measures.md)
  (2026-07-16), incl. the P1–P5 plan and a real-library coverage dry run (§6).

## Other existing products to explore and research

- **Mixed In Key / Mixlog / Mixgraph / …** — **done**:
  [POSITIONING.md](POSITIONING.md) (2026-07-17). Remaining follow-ups are
  hands-on time (Mixgraph evening, HarmonySet source read), not code.

## Ideas for other types of edges (combos)

- **Edges based on lyrics** — **rejected**: no local-first lyrics source
  (Genius/Musixmatch keys + ToS), weak fit for mostly-instrumental club music.
- **Edges based on sampling (WhoSampled)** — **rejected**: no public API
  (commercial licensing only; scraping violates ToS). A manual-edge tag
  ("sampled") covers the intent locally.
- **User-defined edges** — **v12**: manual *planning annotations* ("these would
  mix well"), never a play log — the Mixlog boundary in POSITIONING.md survives
  in spirit.
- **Edges from existing DJ mixes on Spotify** — **rejected** as stated (the
  relevant Spotify APIs died Nov 2024; mixes aren't tracklists). Reframed as
  **travelled edges** from imported tracklist documents — **v14+**, the "DJ
  fingerprints" roadmap item and the app's namesake.
- **Edges from musical rhyme (similar melodies in distinct keys)** —
  **research**: needs audio analysis; parked behind Essentia.js (P5).
- **Vinyl mode per node + user input for vinyl-only tracks** — **v12** minimal:
  per-track vinyl flag + manual key/BPM/genre entry; Discogs import lands on top
  in v14+.
- **Edges based on links between comments** — **v14+**: once Comments parsing
  lands (v12 energy), a shared-comment-tag criterion is cheap.
- **More parameters (energy, melody, …; analyse mp3s directly)** — split:
  **v12** parses Mixed-In-Key-style energy from Comments; direct audio analysis
  stays the Essentia.js roadmap item (**research**).

## Design ideas

- **Experiment with colours and fonts** — half-**done** (v7 accent tokens tint
  the whole app; v9 native controls follow them); font pairing remains a small
  backlog item.

## User Experience ideas

- **Make it more fun (e.g. spinning-wheel moment on generate)** — **v12**:
  walk-draw animation, celebration micro-moments, set-portrait export.
- **Easily insertable in my website** — **v12**: static deploy with the guided
  demo as the public-facing default.
- **Stand-alone double-click application** — **v12**: PWA first (installable,
  offline); Tauri only if the PWA disappoints.
- **Single-toggle easy mode / advanced mode** — **v12**: hard toggle, minimal
  surface (wheel + playlists + ✨ + set panel).

## Genre similarity ideas

- **More complete approach to genre distance** — **done** for now (six methods,
  hybrid default); deeper work (CLAP pack, hyperbolic geometry) is gated behind
  P2/P4 in the science doc (**research**).
- **A sample set relevant to genre space** — **v12**: a purpose-built genre-atlas
  pack spanning the space.
- **LLM normalisation of unrecognised genres (DnB ≈ D&B ≈ jungle)** — **v12**,
  local-first shape: offline curation (tree additions + normalization fixes +
  coverage report) plus build-time LLM alias mining; a runtime LLM call was
  considered and **rejected** (not local-first).

## Integration

- **Formats from other software (VirtualDJ, …)** — **v14+**: flexible
  column-mapping import first (the enabler), then VirtualDJ, Traktor/Serato.
- **Better playlist-export integration (different heading types)** — **v14+**:
  the column-mapping import step is exactly this.
- **Discogs export (vinyl collections)** — **v14+**, on top of v12's vinyl
  minimal.
- **Full integration inside Rekordbox (or open-source alternatives)** —
  **rejected** as stated: rekordbox has no plugin API. The real path is the
  Rekordbox-XML export round-trip (roadmap) so planned sets appear in rekordbox
  as playlists; watching Mixxx (OSS) stays an option.
