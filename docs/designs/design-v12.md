# Design v12 — The ideas backlog, fun first

Unlike v9–v11 (issue-driven polish), v12 comes from a full triage of docs/IDEAS.md:
every idea assessed for feasibility against the app's constraints (local-first, no
backend, no upload, label-space genre data), thirteen alignment questions answered by
Michiel, and the survivors shaped into fourteen workstreams under an explicit lens —
**fun & intuitive first**, substance riding along. The two open items from
docs/ISSUES.md (BPM default, hotkeys) fold in as WS14. Rejected and deferred ideas are
recorded with reasons in the restructured [IDEAS.md](../IDEAS.md). This document records
the design decided with Michiel before implementation (2026-07-17/18).

## Decisions taken with Michiel

| Topic | Decision |
| --- | --- |
| Priority lens | **Fun & intuitive first**; science stays background (P-plan gated in the science doc) |
| User-defined edges | **In**, as forward-looking *planning annotations* — never a play log; the POSITIONING boundary with Mixlog survives in spirit |
| Genre OOV (~21% of tagged tracks on the real library) | Offline curation (tree nodes + normalization fixes + coverage report) **plus** build-time LLM alias mining; runtime LLM rejected (not local-first) |
| Audio parameters | Cheap first: parse Mixed-In-Key-style "Energy N" from Comments; Essentia.js stays a roadmap item |
| Fun elements | Walk-draw animation, set-portrait export, celebration micro-moments; local audio preview declined |
| Easy mode | Hard toggle, minimal surface (wheel + playlists + ✨ + set panel) |
| Packaging | PWA first; Tauri only if the PWA disappoints; website embed = static deploy |
| Public-facing default | Guided demo on the sample collection (the "teaching instrument") |
| Importers | v13 wave: flexible column mapping first, then VirtualDJ, Discogs CSV, Traktor/Serato |
| Vinyl | Minimal now: per-track flag + manual key/BPM/genre entry; Discogs later on top |
| Sample data | One purpose-built genre-atlas pack spanning the genre space |

## The workstreams

| WS  | Title                        | Summary                                                                                                 |
| --- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0   | Docs reconciled              | ISSUES stub restored, IDEAS.md → statused backlog, this document                                          |
| 1   | Walk-draw animation          | On ✨/⚡ the walk traces itself over the wheel, tracklist rows cascading in sync (§A)                      |
| 2   | Celebration micro-moments    | Button burst, completion shimmer, star-cycle transitions — CSS-first, reduced-motion aware (§A)           |
| 3   | Set portrait export          | The walk as a standalone SVG/PNG poster: title, date, tracklist down the side (§B)                        |
| 4   | Easy mode                    | `settings.uiMode` hard toggle; easy = wheel + playlists + ✨ + set panel, visibility-only (§C)            |
| 5   | Genre offline curation       | ~15 tree nodes (free-tekno cluster, regional funk, garage…) + four normalization fixes (§D)               |
| 6   | Coverage report              | P1 productised: the import ⓘ reports how much of the library the similarity data covers (§D)              |
| 7   | LLM alias mining             | Build-time only: unresolved labels mapped to known genres during development, shipped static (§D)         |
| 8   | Energy from Comments         | MIK-style "Energy N" parsed at import; a registry property (filter/column/radius) (§E)                    |
| 9   | Manual edges                 | Planning annotations, schema v5; always drawn dashed; suggestion bonus (§F)                               |
| 10  | Genre-atlas pack             | A 12th sample pack spanning jazz→gabber so the genre views demo well                                      |
| 11  | PWA                          | Installable, offline-capable — the "double-click app" at near-zero cost                                   |
| 12  | Guided demo tour             | First-run overlay on the sample collection; replayable; the embed default (§C)                            |
| 13  | Vinyl minimal                | `isVinyl` flag + manual key/BPM/genre entry for undigitised records (§G)                                  |
| 14  | Stub issues                  | Default BPM tolerance 8% (Technics pitch bend); settings-undo + a small hotkey set (§H)                   |

Order: 0 → 1/2 → 4 → 3 → 14 → 5/6/7 → 8 → 9 → 10 → 12 → 11 → 13.

## §A The fun layer

The walk-draw animation is purely presentational: ✨ still writes the regenerated set in
a single store write (v8 §H), so Cmd+Z semantics are untouched; the wheel then draws the
walk edge-by-edge (staggered stroke-dashoffset reveal, nodes lighting up as reached) and
the tracklist rows cascade in matching order. It also fires on ⚡ force-to-length
completion. Micro-moments stay subtle: a burst on ✨/⚡, a one-off shimmer when a set
reaches its target length, smooth transitions on the star cycle. Everything respects
`prefers-reduced-motion` and adds no dependencies.

## §B The set portrait

`src/core/exporters/portrait.ts` renders a self-contained SVG — wheel, walk, node
positions from the same layout code the app uses, with title, date and the tracklist
down the side — and rasterises to PNG via canvas. Export button in the set panel, using
the established filename-prompt + `ensureExtension` pattern. Works in both themes.

## §C Easy mode and the guided tour

`settings.uiMode: 'advanced' | 'easy'` (persisted). Easy shows the wheel, Playlists, ✨
and the set panel; CriteriaPanel, Filters/Genres sections, AdvancedMenu and the TopBar
Radius/Colour selects hide. Visibility only — no setting changes underneath, so flipping
back restores everything exactly. Existing saves default to advanced; a fresh visitor
starts easy with the guided tour: a dismissible 4–6-step overlay over the sample
collection (wheel → focus edges → ✨ walk → your set → the toggle), replayable from the
status ⓘ. The tour doubles as the public-facing default when the static build is
embedded in a website.

## §D Genre substance (offline only)

The science doc's shelved list ships: ~15 curated-tree nodes (the free-tekno cluster,
Turkish/Persian Funk, Garage, Acid Trance, Future Garage, Minimal House, New Beat,
Jumpstyle, Electro Swing, UK Hardcore) with sensible lineage — the tree now also feeds
icon families and the v10 umbrella merge — plus four TDD-sized normalization fixes
(periods; en/em dashes as separators; alias lookup before the `and→&` rewrite;
keep-whole compound aliases). The pack rebuilds; the triplet eval must stay green.
Coverage instrumentation (P1) lands in the import report: "N of M tagged tracks have
genres outside the similarity data — top: …". Alias mining is build-time only: a script
dumps unresolved labels frequency-ranked, Claude maps them to known genres during
development (with a reject class for non-genres), and reviewed results ship as static
alias data. The runtime never calls an LLM.

## §E Energy

Comments have been Track fields since v9. Import derives `energy: number | null` from
MIK-style tokens ("Energy 7"); the v11 properties registry gains the field (number kind,
filterable), which buys the column and range filter outright; the radius selector gains
an Energy option. Missing energy never blocks anything. Energy as a combo criterion or
progression shape is deliberately deferred until the field proves itself as a filter.

## §F Manual edges

Project schema v5: `manualEdges: { a, b, tag? }[]` — unordered pairs, optional short tag
("mashup", "tested"). Created from the selected-track card; drawn always (dashed accent)
— deliberate and few, they are exempt from the focus-only rule like walk edges, and
compose with the threshold-0 symbolic complete graph. The suggestion scorer grants a
manual-edge bonus (both the edge-gated and force rankers), aligned with the mustInclude
pattern. Undo-integrated; saves round-trip.

## §G Vinyl minimal

`track.isVinyl` plus manual key/BPM/genre editing for records with no digital file.
Registry-aware. Vinyl-mode comparison semantics stay global; per-node semantics are
recorded as a discussion point, not built.

## §H The stub issues

Default BPM tolerance becomes 8% — the pitch-bend range of a classic Technics — for
fresh state only (stored settings keep their value). Undo extends to advanced-settings
changes, and a small hotkey set arrives ("not too many"): the exact keys are decided
during the workstream, favouring ✨, view switching, and Escape consistency.

## Non-goals

- No play logging, play history, or personal combo database — manual edges are planning
  marks, not records of performed transitions (the POSITIONING boundary).
- No runtime LLM calls, no backend, no accounts, no upload — ever.
- No local audio preview (declined), no Essentia.js analysis yet (roadmap), no CLAP pack
  (gated behind P2 in the science doc).
- No importer wave in v12 (flexible column mapping, VirtualDJ, Discogs, Traktor/Serato
  are shaped for v13); no Rekordbox-XML export yet (roadmap).
- No Tauri unless the PWA disappoints.

## Implementation amendments (recorded after the build, 2026-07-18)

- **Fresh visitors start in the full UI, not easy mode.** §C planned easy as the
  first-run default; forcing it would have invalidated every E2E flow for
  marginal gain, so the default stays `advanced` and the tour's last step
  teaches the toggle instead. The guided tour fires on the first-ever sample
  load and replays from the status ⓘ.
- **The walk reveal caps at ~4 s.** A 99-track walk would have drawn for 14 s;
  `walkRevealPlan` compresses the per-step delay for long walks (floor 40 ms),
  and both views animate from the plan's own `stepMs`.
- **The pack widened to top-24 neighbours.** The 22 new curated labels entered
  the vocabulary and displaced big genres (techno fell out of electro's top-20,
  turning a passing triplet into a 0-vs-0 tie); four wider slots absorb the
  growth. Hybrid holds 100% on the grown 33-triplet eval; the pack is 824 KB.
- **Mining outcomes** (WS7): 18 aliases + 4 extra tree nodes (balkan under the
  new folk node, thai funk, jackin house, halftime) on top of WS5's 18. The
  real 2080-track library went from 369 tracks (20.8%) outside the similarity
  data to **49 (2.8%)**, and what remains is almost entirely the deliberate
  reject class (non-genres like "Nieuw!!!", "90s", site watermarks). The miner
  lives on as `tests/mine-genre-aliases.dev.test.ts` (env-gated).
- **`isVinyl` stays out of the properties registry** — every registry kind is
  range-shaped and a boolean isn't; it's a card-level flag until a 'flag' kind
  exists (the same deliberate gap as v11's colour-checklist non-goal).
- **Energy is also a radius/colour axis**, and the Genre Atlas pack carries
  MIK-style "Energy N" comments so the axis demos out of the box.
- **Settings undo excludes the chrome** — theme, uiMode and advancedOpen never
  enter the tuning snapshot, and tuning-only changes debounce (350 ms) so a
  slider drag is one undo step. Manual-edge marks are work edits: immediate.
- **The genre map's centre gravity now scales with node count** (√-scaled above
  22 nodes) — the atlas-sized vocabulary pushed the fringe out of frame under
  the fixed v6 strength.
