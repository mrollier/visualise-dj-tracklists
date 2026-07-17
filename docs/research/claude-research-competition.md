# Competitive Landscape: DJ Library Visualization, Harmonic Set-Planning & Track-Suggestion Tools

## TL;DR
- **Your core concept — a whole DJ library rendered as a spatial node-network laid out ON a Camelot Wheel, with a set drawn as a visible "walk"/path through it — appears genuinely unoccupied.** No existing product or open-source project was confirmed doing this exact combination; the closest partial matches only draw a *set's* tracks as a path (HarmonySet) or use the graph/TSP idea internally without a library-wide wheel-node visualization (RodrigoDeRosa's "raver", academic auto-DJs).
- **Almost every other individual feature you have is already well-served**: harmonic set-ordering (DJ.Studio, Mixgraph, HarmonySet), track suggestion (rekordbox Related Tracks, Mixgraph Live Mode, VirtualDJ AIPrompt, djay Automix AI), library management with Rekordbox XML import (Lexicon, MIXO), and Camelot key analysis (Mixed In Key, every mainstream DJ app). Your differentiation is the *synthesis and framing*, not any single primitive.
- **Genuinely differentiated in the current landscape**: (1) tracklist-as-graph-walk visualization, (2) multi-method interchangeable genre distance (exact/lexical/taxonomy-tree/co-occurrence embeddings/hybrid), (3) strict local-first/no-account/no-backend, and (4) "vinyl-mode" strict pitch-shifted key matching as an explicit suggestion criterion. These four together have no confirmed equivalent.

## Key Findings

**The landscape splits into six clusters, and your app straddles three of them (visualization + set-planning + suggestion) that are usually sold separately.**

1. **Dedicated harmonic-mixing / Camelot tools** (Mixed In Key, Tunebat, SongData.io, countless interactive-wheel widgets) — these analyze key/BPM and show a *single* Camelot wheel as a picker, but none lay out your library as positioned nodes.
2. **Visual set-builders / auto-sequencers** (DJ.Studio, Mixgraph, HarmonySet, Mixlog) — the most direct competitors. They order tracks harmonically and increasingly use "flow/path/journey" language, but present sets as timelines or slot-lists, not as a graph walk over a wheel.
3. **Mainstream DJ software suggestion features** (rekordbox Related Tracks/Track Suggestion, Serato, Traktor, VirtualDJ 2026 AIPrompt, djay Pro AI Automix, Engine DJ) — recommendation and key-matching, but list-based, live-performance-oriented, no library graph.
4. **DJ library managers** (Lexicon, MIXO, beaTunes, Rekord Buddy [defunct]) — Rekordbox XML/TXT/M3U import, smart playlists, some "similar tracks" discovery, but no graph view or set-path.
5. **Streaming-adjacent / general music-network visualizers** (Every Noise at Once [frozen], Music-Map/Gnoosic, Chosic, Ameo's Music Galaxy) — these DO visualize music as a network/map, but of *artists/genres*, not your local library keyed to Camelot, and not DJ set-oriented.
6. **Academic / hobbyist graph & auto-mix research** (Bittner et al.; Vande Veire & De Bie; Hirai's MusicMixer; TSP playlist formulations) — the theoretical backbone for "playlist as graph traversal," but produced non-visual command-line software at most.

**The Spotify audio-features API deprecation is a material tailwind for your local-first approach.** On November 27, 2024, Spotify's developer blog announced that new Web API use cases could no longer access Audio Features, Audio Analysis, Related Artists, Recommendations, and Get Featured Playlists; TechCrunch reported the same day that the change was aimed at "developers who it believes have been misusing its API, including by scraping data." As of mid-2026 there is still no official replacement (per FreqBlog/DEV Community, "Eighteen months later, there is still no official replacement"). Any competitor that relied on Spotify for key/BPM/energy data lost it — a direct argument for a tool that runs entirely on files the user already has.

## Details

### Cluster 1 — Dedicated harmonic-mixing / Camelot tools

**Mixed In Key** (maker: Mixed In Key LLC; desktop Win/Mac; paid). The original harmonic-mixing key-detection software that popularized the Camelot Wheel. (On origins: Mixed In Key's own interview with system creator Mark Davis traces the notation to the print "Harmonic Keys Magazine" of the late 1980s, which Davis continued "under the name Camelot Sound"; secondary sources conflict on the exact year — 1980s vs 1990 vs later — so treat any single date as unverified.) Does: key/harmonic ✓, BPM ✓, energy ratings ✓; genre ✗; graph/network ✗. Library-as-graph ✗; set-as-path ✗. Suggestion: shows compatible keys, not a next-track engine over your library. Import/export: writes Camelot codes to ID3 tags read by all DJ software. Status: actively maintained (v11). *This is your reference for key-detection accuracy, not a visualization competitor.*

**Tunebat** (web + analyzer; freemium/ad-supported). A database of 70M+ tracks with key, BPM, Camelot, energy, danceability; advanced search by key/BPM; harmonic-match recommendations. Independent analysis (Parrser, "The Spotify API Collapse") notes Tunebat is "the largest of these with over one million monthly visitors, built its entire 70M+ track database on Spotify's analysis. Its core database is now frozen at pre-deprecation data." Does: key ✓ BPM ✓ genre-ish ✓ graph ✗. Status: live as of 2026 (now leans on its own analyzer + the frozen catalog). SongData.io is a close analogue (per-song BPM/key page + up to 50 harmonic-match recommendations, Spotify-playlist import). Both are lookup/search tools, not library visualizers, and both are cautionary examples of Spotify-data dependence.

Numerous GitHub interactive-wheel widgets exist (geeves/camelot-wheel; jackbittiner/camelot-wheel with a `getCamelotRoute()` utility; NRec22/harmonic-mixing-generator; a mic-based real-time chord-detection Camelot wheel). All are single-wheel references or CLI generators — none plot a library as nodes.

### Cluster 2 — Visual set-builders / auto-sequencers (your closest competitors)

**DJ.Studio** (maker: Siebrand Dijkstra; desktop; paid subscription/license). A "DAW for DJs" — timeline-based mix builder. Its **Harmonize** (formerly Automix) feature checks "millions of possible tracklist orders" and returns the order with the most harmonically-compatible ("green") transitions; it can also insert a bridging track to fix a clash. Does: key/harmonic ✓ BPM ✓ genre ✗ graph/network ✗ (it's a timeline). Library-as-graph ✗; set-as-path ✗ (linear timeline). Suggestion/auto-sequencing ✓ (whole-set optimization by key/BPM, with lockable start/end tracks and a Key↔BPM weighting slider). Import: rekordbox, Serato, Traktor, Engine DJ, VirtualDJ, iTunes, Mixed In Key, plus Spotify/YouTube; export back to rekordbox with hot cues. Local: desktop app, but account-based. Status: actively maintained. **The tool most overlapping with your suggestion engine's *whole-set* optimization — study its Harmonize weighting UI closely.**

**Mixgraph** (mixgraph.io; web + iOS + Android; freemium, "Pro" subscription). "Visual DJ set builder" with real-time "chemistry" scoring across **six dimensions** — harmonic (Camelot), rhythmic (BPM), energy, groove, mood (valence), vocal-clash — into a 0–100 score. **Flow Builder** (plan sets, drag-to-reorder, live-updating scores, energy-arc view, AI set generation) and **Live Mode** (real-time next-track suggestions in <200ms, scored against a 147k+/400k+ catalog, filtered by energy intent). Does: key ✓ BPM ✓ genre ✓ graph/network **partial** — uses "flow/path" language and shows an energy arc, but the UI is slot/timeline-based, **not** a wheel-node graph. Library-as-graph ✗; set-as-path ✗ (scored slot sequence). Suggestion ✓ (six-dimension chemistry). Import: Rekordbox library import (Pro). Local: cloud/account-based. Status: actively maintained, "in active development." **Your single most important competitor to try — closest in ambition (visual, multi-dimensional, suggestion-driven, Rekordbox import) even though it is cloud-based and not a graph-on-wheel.**

**HarmonySet / harmonic-flow** (roneni/harmonic-flow on GitHub; harmonyset.com; web, Next.js/TypeScript; ~0 stars, brand new, actively committed). Playlist harmonic-optimizer. Models the playlist as a **Traveling Salesman Problem** (track=node; distance=harmonic+BPM+energy), solved via Held-Karp, returning an optimized order + quality score + a **"circle-of-fifths path visualization"** ("see your set's harmonic journey mapped visually"). Import: Rekordbox/Traktor/Serato exports. **The closest confirmed tool to your "set as a path" idea** — but it draws only the *set's* tracks as a journey on a circle of fifths, NOT the whole library as positioned nodes, and it is a re-orderer, not a library explorer. Status: very new/unproven. **Watch closely / read the source.**

**Mixlog** (maker: Ita Vero; mobile, all-platform; alpha). A "DJ sidekick"/note-taking app to log good transitions ("Combos") and plan sessions/setlists, with suggestions based on a playlist and a "Tunelog" reference database. Does: key/harmonic ✓ (remembers harmonic transitions across playlists) BPM ✓ genre ~ graph ✗. Suggestion ✓ (suggests untried combos). Export: DJ software + streaming; Rekordbox/USB. Status: early alpha. Complementary framing (logging what worked) rather than graph visualization.

### Cluster 3 — Mainstream DJ software suggestion & key features

**rekordbox** (AlphaTheta/Pioneer DJ; desktop + mobile; freemium). **Related Tracks / Track Suggestion** is the built-in analogue to your suggestion engine: it recommends up to 5 categories — **Era** (similar year/BPM), **Mood** (similar genre/BPM/structure), **Association** (label/composer), plus **Collection Radar** and **Streaming Radar** (AI-learned "similar musical characteristics") — plus BPM+Key / same-genre / same-artist criteria, most with adjustable parameters (BPM range, related-key, year). Also **Intelligent Playlists** (rule-based). Does: key ✓ BPM ✓ genre ✓ graph ✗. Suggestion ✓ (criteria-adjustable, list-based, live-oriented). Import/export: native Rekordbox XML/collection. Status: actively maintained. **Your suggestion criteria overlap heavily with Related Tracks' adjustable filters — but rekordbox has no graph view and no BPM-progression-shape or vinyl-mode controls.**

**Serato DJ Pro** (Serato; desktop; freemium + paid expansions). Key display in Camelot/Classical/Open Key/Original Tag; secondary-sort library into harmonic order; **Key Sync / Key Shift** (via Pitch 'n Time DJ) with a blue indicator for harmonically suitable pitch-shifts. Smart Crates (rule-based). Does: key ✓ BPM ✓ genre ~ graph ✗. Suggestion: limited (no Related-Tracks equivalent). Status: active. *Serato's Key Shift indicator is the closest mainstream analogue to your "vinyl-mode" pitch-shifted matching concept — but it's a live per-deck tool, not a library-wide suggestion criterion.*

**Traktor Pro** (Native Instruments; desktop; paid). Uses Open Key Notation; Key Widget shows resulting key + semitone offset when Key Lock engaged; magnifying-glass shortcut to list all harmonically-compatible library tracks. Does: key ✓ BPM ✓ genre ~ graph ✗. Suggestion: filter-based, no true recommendation engine. Status: active.

**VirtualDJ 2026** (Atomix; desktop; free without controller, paid Pro). New **AIPrompt** folder: natural-language queries return track suggestions *from your own collection* with reasons; plus AI lyrics-on-waveform, AI set-builder, Fluid Beatgrid, "Recommend Next," and long-standing "Advanced Harmonic Mixing." Does: key ✓ BPM ✓ genre ✓ graph ✗. Suggestion ✓ (AI, library-aware). Status: actively maintained (2026 + "Part 2"). **The most advanced mainstream in-library suggestion feature — but no graph, and cloud/AI-dependent for some features.**

**Algoriddim djay Pro (AI)** (Algoriddim; Mac/Win/iOS/Android/Vision Pro; freemium). **Automix** with AI-suggested compatible next tracks (based on the playing song) and **Automix AI** transitions; Neural Mix stem separation; taps TIDAL/streaming recommendation engines. Does: key ✓ BPM ✓ genre ~ graph ✗. Suggestion ✓. Import: Rekordbox library/cues. Status: active.

**Engine DJ / Engine OS** (Denon DJ / inMusic; desktop + Prime hardware; free software). **Smartlists** (rule-based, auto-updating on BPM/key/genre/tags/date), Camelot key display/sort, and a hardware **harmonic compatibility filter** (overlapping-circles icon showing only compatible tracks while browsing). **No** true Related-Tracks/recommendation engine as of mid-2026 (users are actively requesting a "Play Next"/related-tracks feature that doesn't exist). No graph/network view. Status: active but behind rekordbox on suggestion.

**Mixxx** (community; desktop; free open-source). BPM + key detection to "find the next track," harmonic sort, controller mapping. No library graph or recommendation engine. Status: active OSS.

### Cluster 4 — DJ library managers

**Lexicon DJ** (maker: Lexicon; Win/Mac + mobile; freemium + subscription). Central library manager & converter across Rekordbox, Serato, Traktor, VirtualDJ, Engine DJ, djay Pro, iTunes; smartlists; **Track Discovery** (recommends new tracks similar to a selected playlist that you don't own yet) and **Mixable Tracks**; energy/danceability/happiness custom fields; dark/light theme; undo history; local API + plugin support. Does: key ✓ BPM ✓ genre ✓ graph ✗. Library-as-graph ✗; set-as-path ✗. Import/export: the most comprehensive Rekordbox XML in/out on the market. Local: desktop (cloud backup optional). Status: actively maintained. **Your benchmark for Rekordbox XML round-tripping and smartlist logic — but no visualization or set-path.**

**MIXO** (MIXO DJ Ltd; desktop Mac/Win/Linux + iOS/Android; freemium, "Gold" subscription). Cloud-based library sync/conversion/management across Serato, Traktor, Rekordbox, VirtualDJ, djay Pro AI, Engine DJ; metadata/cue/beatgrid editing; Rekordbox USB export. **No graph, no Camelot-wheel network, no set-as-path.** Standard player/waveform UI. Status: actively maintained (updates through late 2025). Not a competitor on your concept.

**beaTunes** (tagtraum industries; Win/Mac; paid trial). Analyzes BPM, key (Open Key), "color" (timbre similarity), segments; **Matchlists** (seed-song + soft-rule playlists) and **"Play similar songs"**; a playlist "transition" column flagging genre/tempo/key changes; Beatport integration. Explicitly cites Kell & Tzanetakis on timbre-driven DJ set transitions. Does: key ✓ BPM ✓ genre ~ graph ✗. Suggestion ✓ (color/BPM similarity). Import/export: iTunes; export to Traktor/Rekordbox. Status: mature/maintained. **Its "color" similarity and transition-warning column are conceptual cousins to your genre-distance methods and walk-visualization — worth a look.**

**Rekord Buddy** (Next Audio Labs / Damien Clarke). **DEFUNCT** — discontinued October 2020; site is a placeholder; repo taken down (Codeberg/Wayback backups won't build). Predates current Rekordbox/Serato/Traktor versions. Lexicon is its de-facto successor.

### Cluster 5 — General music-network visualizers (adjacent, not DJ-specific)

**Every Noise at Once** (Glenn McDonald, ex-Echo Nest/Spotify). The canonical genre-space scatter-plot/map with sample playback. **Effectively frozen.** McDonald was one of the 1,500 employees (17% of the workforce) laid off by Spotify on December 4, 2023; he and his team had categorized about one million artists into 6,291 named genres. Losing access to internal Spotify data, he can no longer maintain the site, which stopped updating in February 2024 and now shows a static snapshot of its final state (confirmed still frozen as of April 2026). Visualizes genres, not your library or Camelot keys — a cautionary tale about depending on Spotify data.

**Music-Map / Gnoosic** (Gnod / Marek Gibney; web; free). Crowdsourced similar-artist *maps* — enter an artist, get a proximity graph of related artists (proximity = co-listening). Running since 2005, still live. **A true network/graph visualization of music** — but of artists via collaborative filtering, not your local tracks keyed to Camelot, and not DJ-set-oriented. **Chosic's Music Artists Map** is a modern equivalent (clickable, genre-angle layout, popularity color-coding, Spotify previews).

**Music Galaxy** (Casey "Ameo" Primozic; web/WebGL). 3D interactive galaxy of musical artists built with **node2vec graph embeddings** over Spotify's artist-relationship graph. **Directly relevant technically**: it's exactly the "graph embedding of co-occurrence data → spatial visualization" approach you propose for genre embeddings, applied to artists. **Read this project's two write-ups before building your embedding view.** Not DJ/Camelot/library-specific.

Academic/hobby graph tools also exist (MusicBrainz-based MusicianMap; Last.fm force-directed graphs; arXiv "Analysis and Visualization of Musical Structure using Networks" using music21 + NetworkX for symbolic scores). None are DJ-library or Camelot-set tools.

### Cluster 6 — Academic auto-mix / playlist-as-graph research

**Bittner et al., "Automatic Playlist Sequencing and Transitions"** (ISMIR 2017, Spotify). Foundational: it **models playlist sequencing as a graph-traversal problem** (songs = vertices weighted by acoustic/musical similarity). The paper explicitly proposes "the Shortest Hamiltonian Cycle, an NP-complete problem (also known as the Traveling Salesman Problem)… the resulting playlist will have smooth transitions, even when repeated in a loop," with crossfades as a separate optimization. This is the academic validation of your "set as a walk through a weighted graph" framing — but it produced a research method inside Spotify, not usable software, and no visualization.

**Vande Veire & De Bie, "From raw audio to a seamless mix"** (EURASIP 2018) — the first fully-automatic comprehensive DJ system for drum & bass. **Open-source code IS available** (github.com/lenvdv/auto-dj, a Python-3 port lenvdv/dnb-autodj-3, and an EDM fork ddman1101/Auto-DJ). Research-grade CLI auto-mixer (beat/downbeat tracking, structural segmentation, cue/crossfade selection). Usable but **non-visual**; no graph or Camelot-wheel view.

**Hirai et al., "MusicMixer"** (ACM ACE 2015) — computer-aided DJ using beat + latent-topic (chroma) similarity; DJ picks from system-suggested candidates. **No public/downloadable software found** (papers only). Non-visual; similarity-matrix, not a Camelot graph.

Also in the literature: Kell & Tzanetakis (timbre in DJ set transitions, cited by beaTunes); Kim et al. (highlight-detection DJ mixing); a 2025 Dagstuhl "Temporal Considerations in DJ Mix IR and Generation." The consistent theme: **the "playlist/DJ set as graph traversal / TSP" idea is well-established in research, so it is not novel as an algorithm — but nobody has shipped it as an interactive library-on-a-Camelot-wheel visualization for practicing DJs.**

## Comparison Table

| Tool | Maker | Platform | Cost | Key/Harm | BPM | Genre | Graph viz | Library-as-network | Set-as-path/walk | Suggestion basis | Rekordbox I/O | Local-first | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **visualise-dj-tracklists** (yours) | you | Web (client-only) | free/OSS(?) | ✓ (+vinyl mode) | ✓ (+shape) | ✓ multi-method | ✓ (Camelot wheel + genre map) | ✓ | ✓ | key/BPM-shape/genre/rating/adventurousness | XML+TXT+M3U8 import | ✓ full | building |
| Mixed In Key | MIK LLC | Desktop | paid | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | compatible-key display | tag write | ✓ | active |
| Tunebat / SongData.io | resp. | Web | free/freemium | ✓ | ✓ | ~ | ✗ | ✗ | ✗ | harmonic match, seed tracks | ✗ | ✗ (cloud) | active (data frozen) |
| DJ.Studio | S. Dijkstra | Desktop | paid | ✓ | ✓ | ✗ | ✗ (timeline) | ✗ | ✗ | whole-set Harmonize (key/BPM) | XML in + export w/cues | ✗ (account) | active |
| **Mixgraph** | Mixgraph | Web+iOS+Android | freemium | ✓ | ✓ | ✓ | partial (energy arc) | ✗ | ✗ (scored slots) | 6-dim "chemistry" | RB import | ✗ (cloud) | active |
| HarmonySet | roneni | Web | free/OSS | ✓ | ✓ | ~ | partial (circle-of-5ths) | ✗ | ~ (set path only) | TSP (harmonic+BPM+energy) | RB/Serato/Traktor import | ~ | new/unproven |
| Mixlog | Ita Vero | Mobile | freemium | ✓ | ✓ | ~ | ✗ | ✗ | ✗ | logged combos + playlist | export RB/USB | ~ | alpha |
| rekordbox | AlphaTheta | Desktop+mobile | freemium | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | Related Tracks (Era/Mood/Assoc/Radar/BPM+Key) | native | ✓ (local files) | active |
| Serato DJ Pro | Serato | Desktop | freemium | ✓ (+Key Sync/Shift) | ✓ | ~ | ✗ | ✗ | ✗ | Smart Crates | via convert | ✓ | active |
| Traktor Pro | Native Instr. | Desktop | paid | ✓ (Open Key) | ✓ | ~ | ✗ | ✗ | ✗ | compat-key filter | via convert | ✓ | active |
| VirtualDJ 2026 | Atomix | Desktop | free/Pro | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | AIPrompt (NL, in-library) | via convert | ~ (AI cloud) | active |
| djay Pro AI | Algoriddim | Mac/Win/iOS/etc | freemium | ✓ | ✓ | ~ | ✗ | ✗ | ✗ | Automix AI + streaming recs | RB import | ~ | active |
| Engine DJ | Denon/inMusic | Desktop+HW | free | ✓ (compat filter) | ✓ | ✓ (smartlists) | ✗ | ✗ | ✗ | Smartlists only (no recs) | via convert | ✓ | active |
| Mixxx | community | Desktop | free/OSS | ✓ | ✓ | ~ | ✗ | ✗ | ✗ | harmonic sort | import | ✓ | active |
| Lexicon DJ | Lexicon | Desktop+mobile | freemium | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | Track Discovery / Mixable | best-in-class XML I/O | ✓ | active |
| MIXO | MIXO Ltd | Desktop+mobile | freemium | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ (sync/convert only) | full I/O | ✗ (cloud) | active |
| beaTunes | tagtraum | Desktop | paid | ✓ (Open Key) | ✓ | ~ | ✗ | ✗ | ✗ (transition column) | Matchlists / color similarity | export RB/Traktor | ✓ | active |
| Rekord Buddy | Next Audio Labs | Desktop | — | ✓ | ✓ | ~ | ✗ | ✗ | ✗ | ✗ | XML | ✓ | **defunct (2020)** |
| Every Noise at Once | G. McDonald | Web | free | ✗ | ✗ | ✓ | ✓ (genre map) | ✗ (genres) | ✗ | ✗ | ✗ | ✗ | **frozen (Feb 2024)** |
| Music-Map/Gnoosic/Chosic | Gnod/Chosic | Web | free | ✗ | ✗ | ✓ | ✓ (artist graph) | ✗ (artists) | ✗ | collaborative filtering | ✗ | ✗ | active |
| Music Galaxy | C. Primozic | Web/WebGL | free/OSS | ✗ | ✗ | ✓ | ✓ (node2vec 3D) | ✗ (artists) | ✗ | graph embedding | ✗ | ~ | project |
| Bittner et al. (research) | Spotify | paper | — | ✓ | ✓ | ✓ | ✗ | conceptual (graph/TSP) | conceptual | graph traversal | — | — | research |
| Vande Veire auto-dj | Ghent Univ | CLI/OSS | free | ✓ | ✓ | ✗ | ✗ | ✗ | audio-feature auto-mix | ✗ | ~ | research code |

*(✓ = yes; ~ = partial/limited; ✗ = no. Some cloud/local and genre marks are inferred from feature descriptions rather than confirmed hands-on — flagged in Caveats.)*

## Where your app significantly overlaps existing tools (be honest)

- **Harmonic set-ordering is a crowded space.** DJ.Studio's Harmonize, Mixgraph's Flow Builder, and HarmonySet all take a pool of tracks and produce a harmonically-sensible order. Your suggestion engine's *whole-set* aspect is not new; DJ.Studio even inserts bridging tracks to fix key clashes.
- **Criteria-adjustable next-track suggestion already ships in mainstream software.** rekordbox Related Tracks (adjustable BPM range, related-key, era/mood/association), VirtualDJ AIPrompt, and Mixgraph Live Mode all do "given current track + criteria → suggest next." Your key/BPM/genre/rating knobs overlap directly with rekordbox's.
- **Rekordbox XML/TXT/M3U import + smart filtering + undo/redo + themes** are table stakes — Lexicon and MIXO do the import/round-tripping far more comprehensively than you likely will, and Lexicon has undo history and dark/light themes too.
- **Camelot key analysis and single-wheel pickers** are utterly commoditized (Mixed In Key + every DJ app + dozens of free web widgets).
- **Genre/timbre-based similarity for suggestions** exists in beaTunes ("color"), Lexicon Track Discovery, and Mixgraph's mood/groove dimensions — so "beyond flat genre tags" is directionally not unique, even if your *specific methods* are.
- **"Playlist as graph traversal"** is a solved research idea (Bittner et al./TSP), so the underlying algorithm is not novel IP.

## What appears genuinely differentiated or missing from the landscape

- **Tracklist-as-a-walk over a library-wide Camelot-wheel graph — unoccupied.** Your strongest, most defensible differentiator. No confirmed tool lays out the *entire* library as key-positioned nodes and draws the *set* as a visible connecting path. HarmonySet draws a set path on a circle of fifths but not the full library; Mixgraph shows an energy arc, not a wheel graph. The *combination* is the moat.
- **Multi-method, interchangeable genre-distance (exact / lexical / taxonomy-tree / co-occurrence embeddings / hybrid retrofit).** No competitor exposes swappable genre-distance algorithms. beaTunes has one "color" model; Mixgraph has one proprietary "mood/groove" score. Offering *interchangeable* methods (and a hand-built genre tree) is novel for a DJ tool.
- **Strict local-first / no-account / no-cloud / no-backend.** Distinctive and increasingly valuable. Mixgraph, MIXO, DJ.Studio, Tunebat, and VirtualDJ's AI features are cloud/account-dependent; the Spotify API deprecation and Every Noise's freeze show the fragility of cloud-data dependence. Lexicon, beaTunes, Mixxx, and desktop rekordbox are local but not browser-based/client-only. A pure in-browser tool that never uploads files is a clean, marketable position.
- **"Vinyl-mode" strict pitch-shifted key matching as an explicit suggestion criterion.** Serato's Key Sync/Shift indicator is the nearest analogue but is a live per-deck feature, not a library-wide planning criterion. Framing pitch-shift-compatibility as a suggestion filter for *set planning* appears unique.
- **BPM-progression *shape* (steady/rising/falling/sawtooth) as a tunable suggestion parameter.** Competitors optimize for BPM *closeness* or a single "energy arc." Explicit user-selectable progression shapes were not found elsewhere.
- **Pre-set-planning focus (not live, not tagging).** A deliberate niche between live software (rekordbox/Serato/Traktor) and library managers (Lexicon/MIXO) — closest to DJ.Studio and Mixgraph, but with a visualization-first rather than timeline-first identity.

## Recommendations

**Stage 1 — Validate the moat before building more (do now).**
1. **Try Mixgraph** (web + app, free tier) end-to-end with a Rekordbox import. It is your closest competitor in ambition. Confirm firsthand that its set view is slot/arc-based and *not* a wheel-node graph — if so, your visualization differentiation holds. *Threshold that changes the plan: if Mixgraph ships a Camelot-wheel node graph with a set-path, your primary moat is threatened and you should re-prioritize toward genre-distance methods + local-first.*
2. **Read the HarmonySet source** (github.com/roneni/harmonic-flow) and its circle-of-fifths path visualization — the only confirmed "set as path" implementation. Decide whether your graph-walk is meaningfully richer (whole library vs set-only; wheel-node layout vs circle-of-fifths).
3. **Study Ameo's Music Galaxy write-ups** before implementing your co-occurrence genre embeddings — it's the same node2vec-style technique and will save you time.

**Stage 2 — Match table stakes without over-investing.**
4. **Benchmark Rekordbox XML import against Lexicon.** You don't need Lexicon's breadth, but your import must handle real-world messy collections. Test with a large (10k+ track) export early.
5. **Study rekordbox Related Tracks and DJ.Studio Harmonize UIs** for suggestion-criteria interaction patterns — don't reinvent the weighting-slider UX.

**Stage 3 — Lean hard into the differentiators in positioning.**
6. Lead marketing with the three things nobody else confirmedly has: **graph-walk visualization, local-first/no-account, and multi-method genre distance.** Make the Spotify-API-deprecation story ("your data never leaves your machine; nothing to break when an API dies") an explicit selling point.
7. Treat **vinyl-mode** and **BPM-progression-shape** as signature power-user features — they're small to build and genuinely uncommon.

**Signals that should change your plan:**
- If Mixgraph or DJ.Studio ships a library-as-graph-on-wheel view → your core moat erodes; pivot emphasis to genre-distance methods + local-first.
- If a maintained open-source project appears combining Camelot-wheel node layout + set-path → consider contributing/forking rather than building from scratch.
- If you ever want cloud features, remember every cloud-dependent competitor is exposed to API/label data restrictions — staying local is a strategic hedge, not just a technical choice.

## Caveats

- **Cloud/local and "no graph" classifications for Mixgraph and DJ.Studio are strongly indicated by their own documentation but not verified by me hands-on (no screenshots).** Verify their privacy/data-handling docs before publicly claiming where they store your library.
- **Some "genre" marks and local-first classifications in the table are inferred** from feature descriptions, not tested.
- **The "unoccupied" claim is a negative — impossible to prove exhaustively.** No confirming example was found across GitHub topic pages, commercial tools, and academic literature, and a targeted research pass agreed. But niche or unindexed hobby projects (e.g., private Obsidian/Neo4j music graphs) could exist. Frame your differentiation as "no *established/maintained* tool does this," not "this has never been attempted."
- **HarmonySet is very new (~0 stars)** and could either fizzle or rapidly become a direct competitor — monitor it.
- **Every Noise at Once and Rekord Buddy are effectively dead**; treat them as cautionary examples (Spotify-data dependence; abandonment risk), not live competition.
- **On Camelot Wheel origins**, sources conflict on the invention year (Mixed In Key/Mark Davis cite the late 1980s; other guides say 1990 or later) — don't cite a single date authoritatively.
- Fast-moving category: VirtualDJ, rekordbox, and djay ship AI features frequently, and Mixgraph is in active development — re-scan the landscape before any major launch.