# v41 — the full review: fewer things, done well

A whole-repo review on 2026-09-30 asked one question of every feature: does it make
the app a genuine pleasure to work with? It checked the README's claims against the
code and running tests, measured the hot paths, and found that features had been
shipping faster than known defects closed. This document records what was decided and
what Wave A (branch `v41-wave-a`) changed. Wave B (scale) and Wave C (Quick find)
follow.

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

## Calls made during implementation

- File-name matching is used only for M3U placeholders: in a real collection,
  "01 Intro.mp3" is not one track.
- `svelte.config.js` stays, even though it is empty. Without it, vite-plugin-svelte
  logs a fallback notice on every run.
- Taking the autosave over from another tab happens in place. The first version
  reloaded the page, and the reloaded page could race the lock release.
- Removing version tags from code comments happens in one pass after Wave B, not
  file by file.
