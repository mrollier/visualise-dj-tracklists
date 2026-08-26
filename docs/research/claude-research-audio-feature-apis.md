# Audio-feature APIs — can Spotify, Beatport or any service feed the descriptors?

Research only, 2026-08-26. No code shipped in this wave.

While reworking the sample collection's generated descriptors, "Spotify audio
features" came up as the instrument behind almost all published per-genre
numbers, and Michiel asked the natural follow-up: is that data something the
app could access and integrate — and if not Spotify, then Beatport or a
similar service? Three parallel research passes (Spotify's API status and
terms; Beatport and the store/streaming APIs; the post-2024 replacement
services) were run against primary sources on 2026-08-26. Live-probed claims
are marked as such below.

**Decision: integrate none of them. Spotify's door is closed on four
independent axes and was never reopened; Beatport's cupboard is empty — it has
no audio descriptors at all; every other store either has nothing or forbids
exactly our use in its terms; and the replacement services are either resold
pre-2024 Spotify data or upload-based cloud analysers that contradict the
app's local-first position while seeing less of this library than the
pipeline we already run.** The app already computes the same class of signal
locally, on the actual files, with full coverage of the white labels no
catalogue service has ever heard of. The real gap is validation against
Michiel's ear — the pending Mixed In Key seven-track test — not data access.

Read alongside
[claude-research-sentiment-alternatives.md](claude-research-sentiment-alternatives.md)
(same day, the *analysis-tool* alternatives — beaTunes, Sononym, cloud mood
APIs) and [POSITIONING.md](../POSITIONING.md) (moat #3, strict local-first).
This document covers the *data-service* alternatives.

## What "Spotify audio features" actually were

Nine per-track numbers — energy, valence, danceability, acousticness,
instrumentalness, liveness, speechiness (0–1), plus tempo, key, mode and
loudness — inherited from The Echo Nest, the MIT Media Lab spin-off Spotify
bought in 2014. They were keyed by Spotify track ID: an ID-lookup into a
catalogue, never an analyser you could point at a file.

Two things deflate the aura before any access question:

- **Independent validation is unflattering.** Panda, Malheiro & Paiva (SMC
  2021) found the valence-quadrant classification substantially below the
  music-emotion-recognition state of the art, and a 2025 validation study for
  music-psychology research measured the human–Spotify **valence correlation
  at r ≈ .18** — energy agreed substantially, danceability poorly. These were
  never gold-standard numbers; they were the *available* numbers.
- **They are the same class of signal we already produce.** A neural model,
  trained on somebody's catalogue, emitting affect and danceability scalars —
  exactly what `emomusic-msd-musicnn` and friends do in the v34 sidecar,
  except ours runs on the user's actual audio with nothing leaving the
  machine. "The literature uses Spotify features" means the literature used a
  different proprietary instrument, not a better one.

## Spotify — closed on four independent axes

Any one of these kills the integration; all four hold simultaneously.

1. **The endpoints are gone (2024-11-27, permanent).** Spotify's own
   developer blog removed `audio-features`, `audio-analysis`,
   recommendations, related-artists, 30-second previews and the editorial
   playlist endpoints for every app not already holding extended-quota access
   on that date. Non-grandfathered apps get **HTTP 403**. As of mid-2026
   there has been no reversal, partial restoration, or announced replacement
   — only further tightening.
2. **Extended quota is unreachable (since 2025-05-15).** Applications are
   accepted only from legally registered businesses, via a company email, for
   an already-launched service with **≥ 250,000 monthly active users**.
   Individuals are excluded outright. The criteria require the scale before
   granting the access — and nothing states extended quota restores the
   deprecated endpoints for post-2024 apps anyway.
3. **Development mode cannot distribute an app (since 2026-02/03).** App
   owner must hold Premium; **maximum 5 authenticated users per app** (down
   from 25); one client ID per developer; batch fetches removed; search
   capped at `limit=10`; bucketed quotas returning 429. Even if the feature
   endpoints existed, a dev-mode app is a five-person private tool.
4. **The terms forbid our use even for grandfathered apps (v10, effective
   2025-05-15).** No ingesting Spotify content into ML models (Terms
   §IV.2.a.i, Policy §III.14); no "new or derived listenership metrics,
   benchmarking, functionality" (Policy **§III.13** — this app *is* derived
   metrics); no storage beyond what is "strictly necessary to operate" the
   app, with old data deleted (§IV.3.a.i); Spotify-branded attribution with
   link-backs (Policy §II.4). A persistent local library enriched with
   Spotify numbers is a list of the forbidden things.

The practical matching model would have been broken regardless: features were
keyed by Spotify ID, so a local-file app would search by artist/title first —
and the white-label jungle, tekno and bandcamp rips that define this library
are exactly what a mainstream catalogue does not carry.

## Beatport — no descriptors exist, and no door either

The plausible-sounding candidate turns out to be doubly empty.

- **The v4 track object has no audio descriptors.** Its schema carries
  artists, remixers, release, label, genre/sub-genre, `bpm`, `key` (with
  Camelot name), length, price, dates, ISRC, sample URL, and editorial flags
  (`is_hype`, `is_classic`). No energy, no mood, no valence, no
  danceability — nothing. The two useful fields, BPM and key, are the two the
  app already reads from Rekordbox. Beatport's 2026 metadata investment is AI
  *detection* (the Beatdapp partnership flagging AI-generated uploads at
  ingestion), not descriptor enrichment.
- **Access is partner-gated with a decade-long record of refusing indies.**
  No open signup; requests go through a login-walled Partner Portal, and the
  approved audience is streaming/commerce integrations in rekordbox, Serato,
  Engine, Traktor, djay and CDJ firmware. Community history: hobby requests
  unanswered for over a year, a €10/yr plugin refused as "commercial use",
  Music Assistant's maintainer declining to even apply. No fee schedule is
  published anywhere. The one OSS workaround (beets-beatport4 authenticating
  as the user with Beatport's own scraped web client ID) is unsanctioned and
  one rotation from breaking.
- **The terms close the loop.** API content is licensed for display on "your
  Beatport approved domain", "as delivered", with no reproduction or
  redistribution — and a blanket prohibition on using content or metadata for
  text/data mining or ML. Persisting Beatport metadata into a local library
  is the prohibited shape even before the descriptor gap.

## The other stores and streamers

| Service | Descriptor-ish fields | Access | Terms verdict |
| --- | --- | --- | --- |
| Apple Music API | none (no BPM, no key, no mood) | paid developer account | moot — nothing to take |
| Deezer | `bpm` (patchy; 0 = unknown), `gain` | **no new API tokens issued** | moot |
| Tidal | `bpm`, `key`/`keyScale`, `toneTags` (e.g. "Happy"), `popularity` | self-service OAuth | **non-commercial only; temporary caching only; "no databases of TIDAL Content"** |
| SoundCloud | `bpm`, `genre`, `key_signature` — all uploader-supplied | requires Artist Pro subscription | session caching only; no AI input |

Tidal is the only major service in 2026 exposing anything mood-like to third
parties, and its developer terms forbid precisely our use: persisting the
values into a local library database. The fill rate of `toneTags` is unknown
(unverified without credentials) and its vocabulary is closed.

One genuinely interesting find, filed as an idea rather than an integration:
Apple's **Music Understanding framework** (WWDC26) does on-device analysis —
beats, key, loudness, structure, and a tempo-independent **"pace"** signal
defined as musical event density. It is Swift-only and Apple-platform-only,
so unusable from this stack, but *pace* is a directly borrowable concept for
the energy work: an event-density term is computable from Essentia onset
features and is exactly the kind of signal the >155 BPM failure mode calls
for. See next steps.

## The replacement cottage industry (2024–2026)

Spotify's shutdown spawned a shelf of "audio features API" services. They
sort into two honest categories, and both fail here.

**Resold or cached Spotify-era data.** Tunebat (frozen catalogue, already on
file as a positioning corpse), SongData.io (no public API), Musicstax
(pivoted to analytics), SoundNet (RapidAPI lookup, scales unverified),
Musicae ("Spotify's exact JSON, 250M pre-analyzed tracks, no uploads" — a
provenance red flag in one sentence), Soundcharts (~$250+/month, provenance
undisclosed), GetSongBPM (real open API, but BPM+key only, mandatory
backlink). Frozen numbers from a dead instrument, of opaque legality, for
tracks we can already characterise — and an ID/metadata lookup can never
cover unreleased and white-label content at all.

**Real analysers, hosted.** ReccoBeats (free, no key, CORS verified open —
but its upload path takes 30-second clips max 5 MB, its methodology is
undocumented, and no published benchmark validates it; "as is", no SLA, may
block any IP). SoundStat (paid per track, but keyed *exclusively* by Spotify
ID — no upload, no search — so coverage of this library rounds to its
mainstream sliver). Cyanite (the serious B2B option: rich taxonomy on its own
scales, upload-only, quoted around €290/month plus per-analysis fees).
AIMS (enterprise sales-only, sync-licensing product category). Musiio's
public product is gone — every domain now redirects to soundcloud.com.
AcousticBrainz remains a read-only archive frozen at June 2022 (API verified
live, still answering; still the same Essentia family we run, minus four
years of releases).

Cross-cutting problems for a no-backend app: any keyed service means shipping
the key client-side; any upload service means streaming the user's audio to a
third party, which is the one thing the app promises never to do; and an
unvalidated hosted instrument cannot validate ours — it would be a second
unvalidated number next to the first.

## Why integration would be wrong even if a door were open

- **It adopts the dependency our pitch buries.** POSITIONING.md's moat #3 is
  strict local-first, argued with two corpses: Tunebat's frozen database and
  Every Noise at Once — both killed by the exact API this question asks
  about. "Own the Spotify-collapse story" is a listed opportunity. Building
  on a features API would trade the moat for the risk it warns against.
- **The valuable thing Spotify had is the thing we don't need.** Its features
  covered a 100M-track catalogue — tracks you *don't* own. A library
  visualiser characterises tracks you *do* own, and for those, local analysis
  is strictly better: full coverage including white labels, no matching
  problem, no terms, no key, no outage.
- **The bottleneck is trust, not data.** v34's lesson (shipping a number
  nobody validated, then finding plain BPM beat it) applies to external
  numbers with extra force: they arrive with unknown provenance and r ≈ .18
  valence pedigree. The registered next step — the Mixed In Key seven-track
  test through the already-built import path — moves the actual bottleneck.

## Next steps

1. **Integrate nothing.** No issue opened; this document is the record.
2. **Bank the marketing ammunition.** The positioning story got stronger
   since it was written: February 2026 gutted development mode to five users,
   and the 2025 validation study (valence r ≈ .18) undercuts the aura of the
   numbers everyone lost. One README sentence and a blog paragraph when the
   app goes public — no code.
3. **Steal the one good idea: pace.** When the energy ensemble work
   (claude-research-sentiment-alternatives.md, stage 1) happens, add an
   event-density candidate signal alongside the arousal heads and BPM term —
   Apple's tempo-independent "pace" concept, approximated with Essentia onset
   rate. It targets the measured >155 BPM failure directly and scores against
   `scripts/anchor-signals.json` without re-running audio.
4. **Curiosity-only, not a decision input:** ReccoBeats' upload endpoint on a
   few anchor clips would show what a free hosted analyser says about the
   same audio — same status as the beaTunes trial note in the sibling
   document: costs an idle half-hour, decides nothing.

## Rejected — do not re-propose without new evidence

- **Spotify Web API audio features** — endpoints 403 since 2024-11-27;
  extended quota needs a registered business with 250K MAU; dev mode caps at
  5 users; terms ban ML ingestion, derived metrics and persistent storage
  even for grandfathered apps. Re-open only if Spotify ships an indie-
  accessible path to the feature endpoints (no sign of one; trend is the
  opposite).
- **Beatport API** — carries no audio descriptors at all; partner-gated with
  a decade of refused indie requests; terms bar redistribution, persistence
  and TDM. Re-open only if Beatport both ships descriptors and opens
  developer signup.
- **Tidal / Deezer / Apple Music / SoundCloud metadata** — nothing beyond
  what Rekordbox provides, or terms that forbid persisting it, or both.
- **Spotify-clone lookup APIs** (Tunebat, SongData, Musicae, Soundcharts,
  SoundNet, SoundStat, GetSongBPM) — cached or opaque-provenance catalogue
  data, ID-keyed, blind to white labels.
- **Hosted upload analysers** (Cyanite, AIMS, ReccoBeats-as-dependency,
  Brizm, FreqBlog) — re-states the sibling document's cloud-API rejection
  with fresh evidence: paid or SLA-free, unvalidated, and require uploading
  the user's audio. Re-open only if one publishes validated accuracy *and*
  the app's local-first position is deliberately renegotiated — two decisions,
  not one.
- **Musiio** — public product gone; all domains redirect to soundcloud.com.
- **AcousticBrainz as a data source** — still frozen at June 2022; rejection
  reasons in the sibling document unchanged.

## Sources

Primary, all accessed 2026-08-26 unless dated:

- [Spotify: Introducing some changes to our Web API](https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api)
  (2024-11-27) — the deprecation
- [Spotify: Updating the criteria for Web API extended access](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)
  (2025-04-15) and [quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes)
  — the 250K-MAU business requirement
- [Spotify: February 2026 migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)
  — 5-user dev mode, search `limit=10`, quota buckets
- [Spotify Developer Terms](https://developer.spotify.com/terms) and
  [Policy](https://developer.spotify.com/policy) (v10, effective 2025-05-15)
  — §IV.2.a.i, §IV.3.a.i, Policy §III.13/§III.14, §II.4
- Panda, Malheiro & Paiva,
  [How Does the Spotify API Compare to the MER State of the Art?](https://eden.dei.uc.pt/~ruipedro/publications/Conferences/SMC_2021_Panda.pdf)
  (SMC 2021); plus the 2025 validation study for music-psychology research
  (ResearchGate 395985412) — valence r ≈ .18
- [Beatport v4 track schema (reverse-engineered gist)](https://gist.github.com/kemo/506ca56e35b9506ee5233bc4d773c1c8)
  (updated 2026-02-05) and [beets-beatport4](https://github.com/Samik081/beets-beatport4)
  — no descriptor fields; the unsanctioned auth workaround
- [Music Assistant discussion #4039](https://github.com/orgs/music-assistant/discussions/4039)
  (2025-11) — Beatport partner-gating in practice
- [Apple Music API Songs.Attributes](https://developer.apple.com/documentation/applemusicapi/songs/attributes-data.dictionary)
  and [WWDC26 session 253: Music Understanding](https://developer.apple.com/videos/play/wwdc2026/253/)
  — no API descriptors; the on-device framework and "pace"
- [Tidal API reference/OpenAPI](https://tidal-music.github.io/tidal-api-reference/tidal-api-oas.json)
  (v1.10.111) and [Developer Terms 2.0](https://developer.tidal.com/documentation/guidelines-developer-terms-2_0)
  (effective 2024-01-15) — `toneTags`; non-commercial, no-database terms
- [SoundCloud public OpenAPI](https://raw.githubusercontent.com/soundcloud/api/master/openapi/api.yaml)
  and [API Terms of Use](https://developers.soundcloud.com/docs/api/terms-of-use)
  (effective 2024-03-30)
- [Deezer developer FAQ](https://support.deezer.com/hc/en-gb/articles/360011538897-Deezer-FAQs-For-Developers)
  and community confirmation that no new tokens are issued (2026-05)
- [ReccoBeats docs](https://reccobeats.com/docs/documentation/rate-limiting)
  (live-probed: CORS open, Spotify-schema payloads, 30-s/5 MB upload cap),
  [SoundStat](https://soundstat.info/) (live-probed: Spotify-ID-keyed only),
  [Cyanite API docs](https://api-docs.cyanite.ai/docs/audio-analysis-v6-classifier/),
  [Soundcharts Audio Features API](https://soundcharts.com/en/audio-features-api),
  [AIMS](https://www.aimsapi.com/)
- Musiio domains live-probed 2026-08-26: musiio.com, docs.musiio.com,
  tag.musiio.com all 301 → soundcloud.com; api.musiio.com NXDOMAIN
- [AcousticBrainz](https://acousticbrainz.org/) — live-probed: API still
  answering, data frozen at 2022; and
  [MetaBrainz's shutdown post](https://blog.metabrainz.org/2022/02/16/acousticbrainz-making-a-hard-decision-to-end-the-project/)
- [HN: Spotify has shut down several API endpoints](https://news.ycombinator.com/item?id=42260481)
  (2024-11-27) — the ecosystem reaction
