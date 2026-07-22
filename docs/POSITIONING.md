# Positioning — where this app sits, and how it stays itself

A synthesis of two independent competitive-landscape reports
([chatgpt-research-competition.md](research/chatgpt-research-competition.md),
[claude-research-competition.md](research/claude-research-competition.md)), checked
against primary sources where the reports disagreed, plus the branding conclusions
drawn from them (2026-07-17).

## The position in one paragraph

This app is a **map, not a logbook**. It renders an entire DJ library as a graph —
tracks as nodes anchored to a 24-slot harmonic key wheel, playable transitions as edges
computed from stated, tunable criteria — and draws a set as a visible **walk**
through that structure. It is prospective (what *could* you play next?), visual
(the answer is a shape, not a ranked list), explainable (every edge exists for a
reason you can read), and strictly local (no backend, no account, no upload). It
plans; it does not remember.

## The landscape in six clusters

Both reports converge on the same taxonomy. The app straddles clusters 2, 3 and 5 —
a combination usually sold as three separate products.

1. **Harmonic-key tools** (Mixed In Key, Tunebat, SongData.io, countless wheel
   widgets): analyse key/BPM, show a single Camelot wheel as a *picker*. Nobody
   lays out a library on it.
2. **Visual set-builders / auto-sequencers** (DJ.Studio, Mixgraph, HarmonySet,
   Mixlog): the closest neighbours. They order or score sets and increasingly use
   "flow/path/journey" language, but present sets as timelines or slot lists.
3. **Mainstream DJ software suggestion features** (rekordbox Related Tracks,
   VirtualDJ AIPrompt, djay Automix AI, Engine Smartlists): list-based,
   live-performance-oriented, no library graph.
4. **Library managers** (Lexicon, MIXO, beaTunes): best-in-class Rekordbox
   round-tripping and smart playlists, no visualisation, no set-as-path.
5. **Music-network visualisers** (Every Noise at Once, Music-Map, Ameo's Music
   Galaxy): true graph visualisations — but of *artists and genres* in general,
   not of your library, and not set-oriented.
6. **Academic auto-mix research** (Bittner et al. 2017; Vande Veire & De Bie 2018;
   Hirai's MusicMixer): the theoretical backbone — "playlist as graph traversal /
   TSP" is established science that never shipped as an interactive visual tool.

### The eight closest tools

| Tool | What it is | Graph of the library | Set as a path | Local-first | Confidence |
| --- | --- | --- | --- | --- | --- |
| **Mixgraph** (web/iOS/Android) | Visual set-builder; six-dimension "chemistry" score, Flow Builder, Live Mode | ✗ (slot list + energy arc) | ✗ | ✗ (cloud, account) | docs only, not hands-on |
| **DJ.Studio** (desktop) | "DAW for DJs"; Harmonize reorders a whole set for key/BPM | ✗ (timeline) | ✗ | ~ (desktop, account-based) | docs only |
| **HarmonySet** (web, OSS, new) | TSP playlist re-orderer with a circle-of-fifths path drawing | ✗ | ~ (set only, not over a library) | ~ | source is public; very young |
| **Mixlog** (web/mobile, cloud) | "A logbook for your DJ brain" — logs Combos, preps Sessions, theory-based suggestions | ✗ | ✗ | ✗ (cloud, account) | verified on mixlog.app |
| **DJOID** (desktop) | Graph Playlists + force-directed Scatter Map over compatibility | ✓ (force-directed, not wheel-anchored) | ~ (path through its graph) | ✓ | docs only |
| **Vibes** (desktop) | Canvas set-builder; tracks arranged by hand with connecting arrows | ~ (manual spatial canvas) | ~ (hand-drawn chains) | ✓ | docs only |
| **Lexicon** (desktop) | Library manager/converter; Track Discovery, Mixable Tracks | ✗ | ✗ | ✓ (cloud backup optional) | docs only |
| **rekordbox Related Tracks** (desktop) | Criteria-adjustable next-track lists (BPM+Key, Era, Mood, Association) | ✗ | ✗ | ✓ | first-hand |

"Confidence" is honest: most marks come from the tools' own documentation, not
hands-on testing — see [Caveats](#caveats-and-corrections).

## Where we genuinely overlap (be honest)

- **Key/BPM analysis and single-wheel pickers are commoditised.** Mixed In Key,
  every mainstream DJ app, and dozens of free widgets do this. We don't even
  analyse audio — we read what Rekordbox already computed. That's a feature
  (nothing to get wrong), not a moat.
- **Criteria-based next-track suggestion ships in rekordbox today.** Related
  Tracks with adjustable BPM range and related-key overlaps directly with our
  criteria panel. VirtualDJ's AIPrompt and Mixgraph's Live Mode go further with AI.
- **Harmonic whole-set ordering is a crowded niche.** DJ.Studio's Harmonize,
  Mixgraph's Flow Builder and HarmonySet's TSP solver all exist and are good.
- **"Set as graph traversal" is not novel IP.** Bittner et al. (ISMIR 2017) framed
  playlist sequencing as a Hamiltonian-path problem a decade ago. The algorithm is
  public science.
- **Rekordbox import, undo, themes, smart filtering** are table stakes; Lexicon
  does the import breadth far more comprehensively than we ever will.

The differentiation is therefore **the synthesis and the framing**, not any single
primitive.

## The moats

Five things no established tool combines, and most don't have at all:

1. **The whole library as a graph on the harmonic key wheel, with the set as a visible
   walk.** Unoccupied. HarmonySet draws only the *set's* tracks on a circle of
   fifths; DJOID's graphs are force-directed blobs; Mixgraph shows an energy arc.
   Nobody anchors every track of a library to its harmonic position and threads
   the set through it. This is the identity — lead every description with it.
2. **Multi-method, interchangeable genre distance.** Exact, lexical, curated
   taxonomy tree, co-occurrence embeddings (a real AcousticBrainz pack, 1.96M
   recordings), graph distance, and a hybrid — swappable live, inspectable per
   pair. Competitors ship at most one opaque similarity score.
3. **Strictly local-first: no backend, no account, no upload, in the browser.**
   The November 2024 Spotify audio-features API shutdown froze Tunebat's 70M-track
   database and (with the 2023 layoffs) ended Every Noise at Once. Every
   cloud-dependent competitor carries that risk. Files that never leave the
   machine can't be taken away.
4. **Turntablist-grade matching criteria as *planning* inputs**: vinyl mode
   (pitch-coupled key matching), metric BPM ratios (half/double, 2/3 time), BPM
   progression shapes. Serato's Key Shift indicator is the nearest analogue and it
   is a live per-deck feature, not a library-wide planning criterion.
5. **Explainability as a brand pillar.** Every edge exists because of criteria you
   set and can read; the pair inspector shows every method's score for any two
   genres; suggestions say why. The landscape trend is the opposite — black-box
   "AI chemistry" scores. "No magic numbers" is a position worth stating out loud.

## Mixlog, specifically

Mixlog ([mixlog.app](https://mixlog.app), Ita Vero) calls itself **"a logbook for
your DJ brain"**: it logs *Combos* — transitions you played and liked — so you
never forget a great one, preps Sessions, imports from Rekordbox/Traktor/Spotify/
Discogs, and suggests tunes "based on music theory and your personal preferences."
It is cloud-connected and account-based, and its value compounds with use: the
more you log, the more it knows.

**What we share**: both start from a Rekordbox library, both help prepare a set
before the gig, both have a suggestion engine with music theory inside.

**The axis of difference is time.** Mixlog looks *backward*: its ground truth is
the transitions you actually played — empirical, personal, accumulated, synced.
This app looks *forward*: its ground truth is the structure of the library
itself — theoretical, exhaustive, computed fresh from criteria every time. Mixlog
remembers your journeys; this draws the map. A logbook gets better the more you
write in it; a map is complete on day one and never knows where you've been.
The architectures follow from that: a logbook must persist and sync (cloud,
account); a map can be stateless and local (no account, no upload).

**The codified boundary (a hard non-goal)**: this app will never log the
transitions you actually played, keep a play history, or build a personal combo
database. That is Mixlog's ground, deliberately left to it. Our roadmap's "DJ
fingerprints" are statistics over *imported, existing* tracklists — analysis of
documents you hand it, never a recording of your behaviour.

**Friendly interop (only with Ita Vero's blessing — it touches Mixlog's core
data)**: the products compose naturally precisely because they don't overlap.
A planned walk here could export as a Mixlog Session to practice against; logged
Mixlog Combos could import as personal edge boosts ("you've played this
transition — the map marks the road as travelled"). Worth a conversation over a
beer, not a feature to build unilaterally.

## Brand identity

**Positioning statement**: *A map of everything you could play. Your DJ library as
a living graph on the harmonic key wheel — every playable transition drawn, every set a
visible walk, every suggestion explainable, and nothing ever leaves your machine.*

**Tagline options**:

- "The map, not the logbook."
- "See every set you haven't played yet."
- "Your library is a graph. Walk it."
- "Plan the walk, play the set."

**Name candidates** (web-collision-checked 2026-07-17 against the DJ/music-app
space; none trademark-searched — do that before any public launch):

| Candidate | Why | Check |
| --- | --- | --- |
| **Setwalk** | The literal identity: a set is a walk through the graph | clean |
| **Cratewalk** | DJ-native (crate digging) + graph walk; warm, memorable | clean, but the "crate-" prefix space is busy (Crates.app, Crate Connect, Crate Hackers) |
| **Keyweave** | The set woven through the key wheel; matches the README's own language | clean |
| **Keyplane** | Geometric, graph-theory flavour; the wheel as a coordinate plane | clean |
| **Harmonic Atlas** | The map metaphor head-on | no direct collision found; generic enough that squatters are likely |

**Rejected**: *Wheelhouse* (collides with Wheelhouse Beats, a music practice app);
anything containing **Camelot** (Mixed In Key actively brands the Camelot Wheel,
and Audio Modeling ships a live-performance product literally named Camelot —
legal risk and confusion for zero gain).

**Voice**: graph-theory honesty. Say "computed from criteria you set", never
"AI-powered". Show the formula when asked. The app's personality is a knowledgeable
friend with a whiteboard, not an oracle.

## Actionable points

Ordered; effort in parentheses.

1. **Try Mixgraph hands-on** with a Rekordbox export (an evening). It is the
   closest competitor in ambition. Confirm first-hand that its set view is
   slot/arc-based and not a wheel graph. *If Mixgraph ever ships a library-wide
   wheel-node graph, moat #1 erodes — re-weight positioning toward genre-distance
   methods and local-first.*
2. **Read HarmonySet's source** (github.com/roneni/harmonic-flow; an afternoon) —
   the only shipped set-as-path drawing. Verify our graph-walk is meaningfully
   richer (whole library vs set-only) and watch the repo: it is new, tiny, and
   could either fizzle or grow into the direct competitor.
3. **Study DJ.Studio's Harmonize weighting UI before building our per-criterion
   weight sliders** (an hour of videos/docs) — the roadmap already contains
   weighted edges; don't reinvent that interaction pattern blind.
4. **Benchmark the XML import against Lexicon on a 10k+ collection** (an evening).
   Ours handled 2,080 real tracks in ~2s; Lexicon is the bar for messy real-world
   exports (odd encodings, missing fields, duplicate TrackIDs).
5. **Adopt a pre-launch re-scan habit** (recurring, 30 min): HarmonySet commits,
   Mixgraph changelog, VirtualDJ/rekordbox release notes. The category moves fast;
   both reports date quickly.
6. **Re-verify every competitor claim before making public comparisons** — most
   table marks are documentation-inferred, and one report contained outright
   errors (see Caveats). Never publish a comparison table sourced from an AI
   research pass without hands-on checks.
7. **Run the Mixlog paragraphs in the README past your friend** (a coffee). The
   framing is complimentary and the boundary is in his favour, but he should hear
   it from you, not find it in a repo.

## Opportunities

Beyond the current roadmap, in rough order of leverage:

- **Own the Spotify-collapse story.** "Nothing to break when an API dies" is the
  local-first pitch with a named villain and two corpses (Tunebat's frozen
  database, Every Noise at Once). One README sentence and one blog post when
  going public.
- **The set as artwork.** The walk over the wheel is already a beautiful object —
  export it as a standalone SVG/PNG poster (title, date, tracklist down the side).
  DJs share set photos constantly; a *set portrait* is shareable marketing that
  costs one render function. No other tool produces an artefact like it.
- **Local-first sharing.** A set + criteria packed into a URL fragment (compact
  JSON, no server, nothing stored) makes sets shareable without betraying the
  no-backend principle. "Send someone your walk" — they see it drawn over their
  *own* library, which is a genuinely new kind of conversation between DJs.
- **DJ fingerprints as the signature analytic.** Walk-quality metrics over
  *imported* tracklists (yours or festival sets scraped by hand) grow into "this
  DJ tends to +2 energy jumps and 8-step key orbits" — analysis nobody else does,
  cleanly inside the non-goal (documents in, never behaviour recorded).
- **The genre data as its own contribution.** The curated genre tree and the
  AcousticBrainz PPMI embedding pack (1.96M recordings) are useful beyond this
  app; publishing them as a standalone dataset/package earns citations, users,
  and goodwill — and makes moat #2 visible.
- **The wheel as a teaching instrument.** The app *shows* why harmonic mixing
  works instead of asserting it. A "learn" mode or a short illustrated guide
  (sample pack + guided walk) targets the large beginner audience that currently
  learns the harmonic key wheel from static blog diagrams — every one of the top
  search results for "harmonic mixing wheel" is a text explainer, not an instrument.
- **Mixlog interop** — see above; a conversation first, a feature maybe.

## Caveats and corrections

- **The two source reports disagree and contain errors.** The ChatGPT report
  attributes DJ.Studio to Mixed In Key — wrong (it is Siebrand Dijkstra's company;
  Mixed In Key merely partners/integrates). It also describes Mixlog as web-only
  where the Claude report says mobile alpha; mixlog.app itself resolves this
  (cross-platform, cloud-centred). Treat both reports as leads, not facts.
- **Most table marks are inferred from vendor documentation**, not hands-on use —
  in particular Mixgraph's and DJ.Studio's cloud/local behaviour and "no graph"
  status. Verify before repeating publicly.
- **"Unoccupied" is a negative claim.** Two independent research passes found no
  established tool drawing a library-wide harmonic key graph with a set walk — but
  unindexed hobby projects can exist. Say "no *established, maintained* tool does
  this", never "this has never been attempted".
- **Names are collision-checked, not trademark-cleared.** A real trademark search
  is required before shipping any of the candidates.
- **The category is fast-moving.** VirtualDJ, rekordbox and djay ship AI features
  continuously; Mixgraph is in active development; HarmonySet is weeks old.
  Re-scan the landscape before any launch decision.
