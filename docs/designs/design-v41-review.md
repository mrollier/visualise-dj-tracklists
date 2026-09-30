# v41 — the full review: fewer things, done well

A whole-repo review on 2026-09-30 asked one question of every feature: does it make
the app a genuine pleasure to work with? It checked the README's claims against the
code and running tests, measured the hot paths, and found that features had been
shipping faster than known defects closed. This document records what was decided and
what the three waves changed: Wave A (fixes and cuts), Wave B (scale to ~10k tracks)
and Wave C (Quick find). Each wave ended with a fresh review of the whole branch and
one fix pass.

## Decisions

| Topic | Decision |
|---|---|
| Audience | A product for other DJs, not only a personal tool |
| Scale | Libraries up to ~10k tracks must feel instant |
| Order of work | Fix and cut first, then scale, then new ideas |
| Genre matching | The hybrid pack only, with one knob (k) |
| Node shapes | Genre families only; playlist and cluster icon modes removed |
| ★ essentials, ⏮/⏭ pins | Saved per constellation (schema v11) |
| Re-importing a collection | Updates it in place; never silently drops work |
| Analysis features | Out of sight until analysis actually reaches the library |
| Docs | Only what is true today; history lives in git and in design docs |
| New idea | Quick find (`/`, ⌘K), in Wave C |
| Quick find scope | Visible tracks only; hidden matches are counted, filters never changed |
| A fully visible 10k wheel | Not the use case (playlists narrow it): the wheel stays SVG |

Ideas considered and not chosen: a keyboard walk over ranked next picks, "why not?"
explanations on set transitions, transition audition, and a set-shape sparkline
(recorded in [../IDEAS.md](../IDEAS.md)).

## What the review found

Confirmed by probes or by reading the exact code:

- Re-importing the collection XML silently kept only the active constellation
  (renamed "First") and dropped every other set, all manual combos, the playlist
  selection and the filters — with no confirmation and no undo.
- Replaying the tour overwrote the autosave with the demo; loading the sample deleted
  an imported analysis file; two open tabs overwrote each other's saves.
- Genre matching ranked genres against the *visible* library, so hiding one genre
  could flip whether two other genres matched.
- ★ essentials and pins were session-only.
- The hub's "+ next" and ✨ recomputed the whole combo graph on every press: 0.74 s
  per click at 2000 tracks, 38 s at 4000 with loose criteria.
- localStorage capped the autosave at about 6300 tracks.
- The "+7-semitone" key move is a one-semitone move (+7 on the wheel).
- Several audio deck bookkeeping errors, a service worker whose cache never rotated,
  and a README with stale counts and claims.

## What Wave A changed

- **Genre**: one method (hybrid, mutual top-k, one k), matched against the whole
  library; the pair card on the genre map shows similarity, whether the criterion
  links the pair, and their most specific shared family. The shipped pack halved
  (the entry chunk went from 965 KB to 742 KB).
- **Constellations** own their ★ and pins; the marks quick-filters persist with them.
- **Re-import** goes through `core/libraryUpdate.ts`: an ID only matches when the
  file or artist and title agree too, since Rekordbox TrackIDs repeat across
  databases. It asks first whenever work would be lost or the collection looks like a
  different one, and reports what changed. On the real library, the July and August
  exports match 2080 of 2080 tracks by ID in about 10 ms.
- **Autosave** lives in IndexedDB as two records (library and work), migrates the
  old localStorage save, keeps an unreadable save aside instead of losing it, never
  writes during the tour, and holds a Web Lock so a second tab opens read-only.
- **Exports** go through one `saveFile` (the native save dialog where the browser has
  one), ⌘S saves the project, and the poster is a plain PNG or SVG choice.
- **Audio**, **service worker**, **easy-mode palette**, **reset**, **Cmd+Z after a
  slider** and the **analysis surfaces** each got the fix listed in the git log.
- **Docs**: the README states only what the code does; design docs nothing links
  to moved to `docs/archive/`; [../ISSUES.md](../ISSUES.md) was re-checked item by
  item and now lists only what is still open (it had grown to 2900 lines, with
  a dozen fixed items still marked open).

The browser probe (`scripts/screenshot.mjs`) now also checks the in-place update, the
two-tab lock, undo from a focused slider, and the absence of analysis UI for a plain
collection.

## What Wave B changed

Measured on a laptop with 10k tracks.

- **The combo graph is lazy.** A track's partners are found by one O(n) scan the
  first time something asks, which is always one track at a time: the selection's star,
  the hub's anchor, a walk's tip. A track that can never pair (no metadata, or missing
  a demanded field) answers at once. A hub press went from 18.6 s to 18–54 ms and a ✨
  walk takes 107–152 ms. The pair count is exact up to 300k pairs, a fixed-seed estimate
  beyond ("≈ 3.5M"), and an upper bound when combos are rare ("< 750"). A differential
  test against the old full edge list (300 criteria shapes, 120 seeded suggestions)
  found every output identical.
- **Big wheels land instantly.** Above 1500 visible tracks glides are off, and a glide
  only places the stars it draws. A radius switch at 10k went from 1.25 s of stutter
  to one 350 ms frame.
- **The Tracks table is virtualised.** It mounts only the rows on screen, measures
  their real height, and tells assistive technology its full size. The 500-row cap is
  gone.
- **The genre map rests in ~8 s** instead of ~57 s.
- **Autosave** serialises the library only when it changed.
- **Comments** across `src/` describe the code as it is, without version tags.

## What Wave C changed

- **Quick find**: `/` or ⌘K (or the *Find a track* box above the left panel), type part
  of an artist or title, Enter. The pick is selected; the wheel centres on it at 3× or
  more, the Tracks table scrolls it to the middle, and the genre map hands over to the
  wheel. It searches what the wheel shows and counts what playlists or filters hide.
  A keystroke over 10k tracks takes a few milliseconds.

## Calls made during implementation

- File-name matching is used only for M3U placeholders: in a real collection,
  "01 Intro.mp3" is not one track.
- `svelte.config.js` stays, even though it is empty. Without it, vite-plugin-svelte
  logs a fallback notice on every run.
- Taking the autosave over from another tab happens in place. The first version
  reloaded the page, and the reloaded page could race the lock release.
- A second Rekordbox playlist TXT that shares tracks with the first updates the
  library and opens its playlist as a constellation of its own.
- The suggesters build their own lazy graph instead of reusing the store's: it costs
  nothing to build, and the store's graph follows throttled criteria while ✨ and the
  hub read the live ones.
- Seeded suggestions are unchanged by the lazy graph, including the random opener; its
  cost is one scan per track that could pair but has none.
- Re-sizing stars only at the end of a zoom gesture was measured and left out: the one
  slow zoom frame at 10k is the browser rasterising, not script.
- Test names and probe messages keep their version tags: they trace a check back to the
  change that introduced it.
- A Quick find pick selects the track but does not load it into the audio deck; a
  click still does. The search field is plain text, because Escape in a search field
  only clears it.
- The *Find a track* box sits in the left panel because the top bar is full at 1440 px.
- The genre map's cooling was tuned by measurement, not by eye; it is one pair of
  constants (`mapMotion` in `src/core/genreMap.ts`).
