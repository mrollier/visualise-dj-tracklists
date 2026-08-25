# Design v32 — code-clean wave

The second whole-repo hygiene pass, eighteen releases after
[design-v14.1.md](design-v14.1.md) did the first. Michiel asked for a full
review driven by the code-review plugin, then the ponytail plugin, then the
typescript skill. Two of those three do not do what their names suggest here,
and saying so up front is part of the record.

The repo was healthy going in: `lint`, `test` (971 passing), `check` and
`build` were all green on `main`, there is not one `any` or `@ts-expect-error`
in the tree, and `src/core/**` is covered by an importing test to the last
module. What the review found is concentrated in three places instead: the
load path for hand-edited saves, the parts of the audio preview that carry no
test at all, and a browser probe that has been silently dead since v18.

## What the tools actually are

- **The code-review plugin is a GitHub PR commenter.** It fetches a PR with
  `gh`, fans out five Sonnet reviewers, scores every finding with Haiku and
  drops anything under 80 confidence, then posts a `gh pr comment`. With a
  clean `main` and only two bot Cloudflare PRs open, it had no target. The
  **built-in `code-review` skill** — path/branch target plus an effort level —
  is what drove the fourteen slices below. The plugin is the right tool once
  this branch has a PR, which is where it doubles as an independent check on
  the wave itself.
- **Ponytail's skills were not registered in the session** (installed the same
  morning, after the skill snapshot), so `/ponytail-audit` did not resolve;
  its `SKILL.md` was followed directly instead. Two of its commands are dead
  on arrival in this repo anyway: `/ponytail-debt` harvests `ponytail:`
  comments and there are none, and `/ponytail-gain` prints benchmark medians.
  Ponytail also declares correctness, security and performance out of scope,
  which is why it ran after the correctness pass rather than before it.
- **The `typescript` skill is a TypeScript-handbook basics skill** (prefer
  inference, explicit return types, no `any`). This repo is already stricter
  than that on every axis, so it was used only against what the review
  surfaced.

## How it was reviewed

Fourteen slices, one skill invocation each, sized so no slice mixed unrelated
subsystems: the three densest core modules; the rest of `core/*.ts`; genre and
the pack builders; importers and exporters at max effort (a trust boundary);
persistence at max effort (a data-loss surface); the state layer; audio at max
effort (its `src/lib/audio/` half has no test); `WheelView.svelte` split into
script-plus-markup and style; the Tracks pair; the Advanced panel and its
sections; the remaining components; and the scripts, tsconfigs, eslint config
and CI.

Every slice was handed v14.1's `## The ponytail audit

Ponytail's own output, in its format — one line per finding, biggest cut
first, `applied` where this wave took it and `open` where it did not.
Correctness, security and performance are out of scope for this pass by the
skill's own rules; anything that surfaced there went back into the review pile
instead.

```
native: d3 declared but never imported; every call site imports a submodule.
        The six submodules directly. [package.json]                    applied
delete: edgeOffset builds a one-element list then returns early on
        length < 2. Nothing; unwrap the <g> too. [GenreMapView.svelte:471]
                                                                       applied
delete: nine ALIASES keys cleanupGenre rewrites before the lookup.
        Nothing; the cleaned form's own entry answers them. [genre.ts:65]
                                                                       applied
delete: coverageText, MIME_CANDIDATES, FORMAT_NOTES exports — no importer.
        Nothing. [playerStore.ts:91, formats.ts:22,72]                 applied
delete: transition on a `right` nothing changes. Nothing. [WheelView:2127]
                                                                       applied
shrink: manualEdges rebuilds a knownIds Set already in scope. The outer one.
        [persist.ts:483]                                               applied
shrink: the artist term hand-summed into four `extra` builders. One shared
        tip-aware term set. [suggest.ts:401,486,492,725]     open — PRNG-locked
shrink: three blob-download paths. One saveBlob in exportName.ts.
        [TracklistPanel:153, TopBar:170, portraitPng:6]                    open
shrink: zoom wrappers + button markup duplicated over a shared helper.
        One component. [WheelView:777,1482, GenreMapView:337,630]           open
shrink: defaults restored in three places, each a different field set.
        One reset. [reset.ts:13,30, persistence.ts:259, stores.ts:288]      open
shrink: portrait re-declares the theme palette "by eye" and the wheel's
        geometry constants. Import both. [exporters/portrait.ts:41,77]      open
shrink: toggleFilterVisible and togglePanelVisible are the same function.
        One, taking a clear callback. [AdvancedMenu.svelte:91,112]          open
shrink: the two verdict notes are copy-paste with inconsistent guards.
        One {#each} over [{glyph, count}]. [TracklistPanel.svelte:485]      open
shrink: CSV header list and value list are parallel arrays. One
        [header, accessor] mapping. [exporters/csv.ts:3,26]                 open
shrink: fileFor duplicated verbatim in both audio backends, each with a
        dead branch; yieldToPaint inlined twice more. source.ts.
        [fsaSource.ts:78, pickerSource.ts:51]                               open
shrink: emptyHint re-implements reasonFor's precedence chain. One helper in
        core/audio/reasons.ts. [PlayerBar.svelte:87]                        open
shrink: the ten-clause version chain and the literal 10 in four places.
        PROJECT_VERSION + a range test. [persist.ts:246]                    open
shrink: `revealing` derived by hand in two components and inverted into a
        third. One exported store. [WheelView:675, TracklistPanel:59,61]    open
shrink: bpm/year/duration hand-roll posNum four lines above them.
        posNum. [importers/rekordbox.ts:97]                                 open
shrink: the extension-strip regex in four places, two forms. location.ts.
        [m3u.ts:22, id3.ts:22, TracklistPanel:48, TopBar:102]                open
yagni:  PANEL_FILTER_KEYS parallel to PANEL_FILTERS. Derive one from the
        other. [marks.ts:30]                                                open
yagni:  hubBusy is a pure alias for revealing. Reference revealing.
        [WheelView.svelte:808]                                              open
delete: settings.jitterSeed, dead since v9. Nothing.
        [settings.ts:125]                                 open — persisted schema
stdlib: String()+options localeCompare per comparison, no cached collator.
        One module-level Intl.Collator. [trackSort.ts:65]         open — perf
native: music-metadata ships ~15 parser chunks for one ID3 read. A narrower
        entry point, if one exists. [TopBar.svelte:48]                      open

net: -33 lines and -19 installed packages applied; roughly -190 lines more
     open, of which the suggest.ts one is refused outright (v14.1 locks the
     PRNG call order) and jitterSeed is blocked on the persisted schema.
```

Two ponytail commands are not run because they cannot say anything here:
`/ponytail-debt` harvests `ponytail:` comments and the repo has none, and
`/ponytail-gain` prints benchmark medians rather than repo numbers — its own
honesty boundary forbids a per-repo figure, which is the only figure that
would have been worth having.

Note the direction of the wave overall: `src/` grew by 84 lines net. That is
the correct shape for a pass whose main product is guards and the comments
explaining them — the deletions are real, and they are smaller than the
correctness work.

## Deliberate non-goals` list first, so the
settled decisions — `suggest.ts`'s PRNG-order lock, `ManualEdge.a`/`b`, not
splitting the three big views, `.svelte` outside type-aware lint, test-only
exports — were out of bounds rather than re-proposed. They were, and none came
back.

**181 findings.** The fifty-eight that cleared the bar are fixed here — the
forty-seven the review raised plus the nine the revived browser probe surfaced
and one it caught live — recorded as thirty-eight entries; the remaining 134
are in
[../ISSUES.md](../ISSUES.md) under `## Open — v32 code review`, because the
bar for touching code in a hygiene wave is deliberately high: behaviour-
preserving, provable or test-covered, no persisted-schema change, nothing
visual — and when in doubt, an issue rather than a commit.

## What shipped

**Prototype reach at every lookup keyed by user data.** The alias table, the
genre tree, the neighbour pack, both importer header maps and the two audio
format tables are plain object literals indexed by strings that arrive from a
library, a CSV or a filename. A genre, a header or an extension named
`constructor` resolved to an inherited function. Each was a crash, not a
curiosity: `normalizeGenre` returned the Object constructor and took the
coverage panel down; the CSV header map returned a function, which aborted the
whole import inside papaparse's `stripBom`; and `formatVerdict` threw out of
`resolveTrack` into `linkFolder`'s catch, **which unlinks the user's music
folder**. Every read goes through `Object.hasOwn` now, and the pack's three
reads share one private accessor so a fourth cannot skip the guard.

**The load path.** `parseProject` sanitises every field it knows about but let
four things through that the app cannot survive. Duplicate track ids: both
track views key their `{#each}` on `track.id`, so a repeat throws Svelte's
`each_key_duplicate` and the Tracks table and the wheel stop rendering. A
repeat in `settings.visibleFilters` does the same to the left filter panel —
every in-app write path guarded with `.includes`, the load path did not. An
empty-string track id, which collides with the suggestion engine's
"no successor" sentinel and made the hub score candidates against a phantom
track (`sanitizeSet` has rejected it since v3). And a document that is not an
object: `parseProject('null')` threw a raw TypeError, which TopBar shows
verbatim. `sanitizeTrack` and `sanitizeSet` also moved onto the `isRecord`
helper the file already defines, so a JSON array no longer passes as a record.

**Storage resilience.** `restoreAutosave` did two unsafe things in one catch
block. It called `localStorage.removeItem` in recovery — which throws again in
exactly the environments that made the read fail, and that rejection escaped
into App's component body, so the user got a blank page instead of an
empty-library app. And it treated any parse failure as proof the data was
garbage, so a save this build cannot read was deleted rather than left for the
build that can. `resetEverything` also never cleared `manualEdges`, though it
is the wider wipe and `replaceLibrary` has always cleared them: `hasUserWork()`
stayed true over a freshly wiped app.

**Two comparisons that were only deterministic per locale.**
`normalizeArtist` used `toLocaleLowerCase` for an identity key, so under tr-TR
the same project and the same seed produced a different constellation on a
different machine — against `suggest.ts`'s own promise. `relaxSlotAngles` broke
same-radius ties with `localeCompare`, so a key's fan (and the portrait
rendered through the same function) depended on the host's collation.

**Five guards that were missing rather than wrong.** `startTour` was not
re-entrant, and the replay button stays clickable during the tour because the
backdrop is `pointer-events: none` — a second press overwrote `tourSnapshot`
with the demo, and the user's real library, already autosaved over, was gone.
`loadRootHandle` evaluated `FileSystemDirectoryHandle` unconditionally, and
`instanceof` always evaluates its right-hand side, so on a browser without
File System Access `startPlayer` raised an unhandled rejection at startup.
DeckRow's range cleared `dragging` on `pointerup`, which runs before `change`,
so a seek jumped backwards or did nothing. `migrateColumns` called
`splice(indexOf('title'), 1)` with no `-1` guard. And `walkRevealPlan` sized
`stepMs` on a different span than `totalMs` measures.

**Seven CSS defects the cascade was hiding.** Two were source-order no-ops:
the reduced-motion overrides for `.dot.playing` and `.playing-halo` sat 280
lines before the unconditional rules that set those animations, at identical
specificity — so the audible star kept breathing under `prefers-reduced-motion`
in a file that already carries a second media block, placed after the rules it
overrides, with a comment explaining exactly this trap. That fix was itself
half-wrong and the pull-request review caught it: the second media block is
placed after the rules *it* overrides, not after these two, so moving the
overrides into it left them 60 lines early and still no-opping. They now sit in
a block of their own, below `@keyframes halo-breathe`. Two were lost
tiebreaks: `.hub.warning` beat the plain `:hover`/`:focus-visible` rule, so the
force hub had no hover feedback and no visible keyboard focus at all, and
`.dot.in-walk` beat `.dot.selected`, so a selected star already in the
constellation lost its selection stroke — the common case, since every hub pick
selects what it added. One was a hole: `.hub.disabled { pointer-events: none }`
plus v31's wider `hubInert` sent a centre click to the bare `<svg>`, whose
background handler clears the selection. One was a repaint: lifting
`.hover-ring` above the node layer in v31 also lifted its translucent fill from
behind the star to on top of it. And `--bounce-transition` had no
reduced-motion escape anywhere.

**Deletion.** Nine `ALIASES` keys that lookups can never reach, because
`cleanupGenre` rewrites those spellings before the table is consulted — all
nine verified to resolve identically through the cleaned form.
`GenreMapView`'s `edgeOffset`, which builds a one-element list and then returns
early on `length < 2`, so it always returned the empty string while every drawn
edge paid for the call and an empty `<g>`. A `transition: right` on a `right`
nothing changes. `coverageText` and two exported format tables with no importer
anywhere.

**The dependency.** `package.json` declared `d3`, which no file imports: every
call site imports a submodule, resolving only through npm hoisting `d3`'s
transitive graph — a layout npm does not guarantee. The six submodules and
their `@types` are declared directly now, which drops nineteen packages from
`node_modules`.

**The browser probe.** `scripts/screenshot.mjs` has been unrunnable since v18.
It aborted at line 49 on a renamed button, and because the whole 1,700-line
flow is top-level await with `browser.close()` only on the happy path, that
abort printed nothing, set no exit code and leaked a Chrome process. Eighteen
releases of UI drift accumulated behind a silent hang. It now has an abort
handler, the whole `set` → `constellation` rename, column indices derived from
the header labels rather than counted by hand, idempotent section opens at all
fifteen call sites, and waits where v31 made the UI settle before it speaks.

Two of its assertions had been **passing while testing nothing**: the BPM sort
check parsed the Title column, so both comparisons were `NaN > NaN`, and the
header-star alignment guard measured a class that has not existed since v18
and skipped itself on the miss. Both are real now.

The revived probe immediately earned its keep by catching a live bug: hiding a
filter row clears the filter from the store, but `FiltersSection` kept the
row's local input entry, so re-showing it displayed a range that was not
applied and the next keystroke silently re-applied the other half of it.

**The gates.** CI hardcoded `node-version: 20`, which makes `setup-node` ignore
`.nvmrc` — and `.nvmrc`, like the Cloudflare environment, says 22.
`tsconfig.tests.json` claimed `src/**/*.ts` as well, so `npm run check`
compiled the whole src tree twice.

## Deliberate non-goals

Recorded, as in v14.1, so the next survey does not re-flag settled decisions.
Everything on v14.1's own list still stands and is not repeated here.

- **The big view files are still not split.** v14.1 settled this; the review
  was told so and did not re-propose it. `WheelView.svelte` was reviewed in
  three slices, which is a reviewing technique, not a plan to divide the file.
- **The state layer stays classic `writable`/`derived` stores**, with runes
  only inside components. "Migrate to runes" is a rewrite, not a finding.
- **`noUncheckedIndexedAccess` was measured, not adopted.** Enabled over
  `src/**/*.ts` alone it produces **137 errors**, concentrated in
  `layout.ts` (33), `exporters/portrait.ts` (26), `suggest.ts` (16) and
  `genreClasses.ts` (13) — and that is before any `.svelte` file. It is a wave
  of its own, and this is the number v14.1 deferred without one.
- **`scripts/` is still outside every tsconfig, and the hand-written
  `genre-pack-lib.d.mts` is still unverified.** v14.1 deferred "bring scripts/
  under a checkJs tsconfig" as the fix; v32 tried it and it is not one. A
  scripts tsconfig containing both the `.mjs` and its `.d.mts` typechecks
  clean **with a declared export the implementation does not have** — proven
  by adding one. Deleting the declaration to infer from the `.mjs` instead
  fails the other way: inference gives `{}` for the pack shapes and the test
  suite stops typechecking. The two halves have to be edited together, and the
  declaration now says so. A full `strict` + `checkJs` config over all of
  `scripts/` reports 73 errors, which is a separate decision.
- **No DOM test harness was added.** All 28 `.svelte` files, 10,877 lines, have
  no test, and `vite.config.ts` pins `environment: 'node'`. Installing jsdom
  or Testing Library is a dependency decision for Michiel, and the repo's own
  architecture rule — pure core, thin view layer — says the answer is
  extracting logic into `.ts` instead. Recorded as an issue, not taken.
- **`settings.jitterSeed` stays.** It is dead (v9), but it is in the persisted
  schema, and this wave changes no persisted schema.
- **`papaparse` and `fast-xml-parser` stay.** Single call sites each, but CSV
  quoting and XML entities are exactly the edge cases hand-rolling gets wrong.

## Deferred

- The 134 open findings in [../ISSUES.md](../ISSUES.md) `## Open — v32 code
  review`, of which the severe ones are listed first.
- **`src/data/genre-embedding.json` is 827 KB and statically imported at
  `core/genre.ts:3`**, so it is bundled into the eager entry chunk — the whole
  928 KB of `dist/assets/index-*.js` is essentially that file, and first paint
  waits on it. Lazy `import()`, a fetched asset, or a pruned pack are all real
  architecture calls rather than cleanups.
- A browser step in CI. Now unblocked — the probe exits 0 and Playwright is
  already a devDependency — but deliberately left undone: a CI step that cannot
  be run locally before pushing should be verified by whoever can watch it go
  red. The recipe is in ISSUES.md.
- Coverage collection. `vitest run --coverage` as a reported number, not a
  gate.

## Verified

Every commit is green on `npm run lint && npm test && npm run check &&
npm run build`. The test count is unchanged at **971 passing, 1 skipped** —
this wave fixed defects that no test reached rather than changing behaviour any
test asserts.

`node scripts/screenshot.mjs` was run against a live `npm run dev` repeatedly
through the repair. **It exits 0** — 194 assertions and 40 screenshots, twelve
clean runs across two sessions — for the first time since v18.

It took several passes to earn that, and the reason is worth recording because
it is not a Playwright problem. Roughly one run in three failed in the
vinyl-mode / unit-time block, and the root cause is that **`.combo-edge` draws
the suggestion edges around the SELECTED track only** (v9 issue 8,
`WheelView.svelte:1060`). Both checks were counting "edges around whatever
happened to be selected" — and what is selected depends on the hub, which
seeds its PRNG from `Math.random()` (the finding recorded below). The block now
selects a known star by label before measuring anything.

Three smaller things fell out of the same investigation. The playlist scoping
never applied: `getByRole('button', { name: 'None' }).first()` in the left
aside was resolving to the wrong section, so the "Classic demo only" setup was
running against all 264 tracks. `onlyCriterion` passed through a zero-enabled
state, which leaves the threshold at 1 with nothing that can satisfy it and the
graph comes back empty — the wanted criterion is enabled first now. And vinyl
mode reads the BPM settings even while the BPM criterion is off
(`combos.ts:222` calls `bpmCompatibleRatio`), so the block resets the Advanced
panel to defaults first, which is what pins the key moves and the BPM metric
ratios (`reset.ts:30`).

One last thing the hunt turned up: with no dev server the script produced
`ERR_CONNECTION_REFUSED` buried in the error list, which reads like an app
failure — two of the runs that looked flaky were exactly that, a dev server
killed underneath them. It now says what it is and exits 2.

The vinyl check also stopped counting edges. Vinyl mode compares keys *after*
the pitch shift beatmatching implies (`combos.ts:216`), so it re-wires the
graph rather than shrinking it — the count can land on the same number while
the edges themselves differ, which is how that assertion was both flaky and
weak. It fingerprints the edge geometry now. The hub-disable check likewise
waits for the append it depends on rather than sampling a state that only
arrives after the reveal window.

The persisted-state constraint was checked directly rather than inferred: the
full sample collection — 264 tracks, 13 playlists, a set, a manual edge, and
the default criteria/filters/settings — was serialised, parsed and re-serialised
on `main` and on this branch and compared. **225,696 bytes, byte-identical.**
Valid saves round-trip exactly as they did before; only malformed input now
resolves to defaults, which is the constraint v14.1 set and which still binds.

**Not verified.** Nothing in this wave was checked on Firefox or Safari; the
`FileSystemDirectoryHandle` guard is exactly the kind of thing that wants one.
The reduced-motion fixes were reasoned from the cascade, not observed under
`prefers-reduced-motion` emulation -- and that is precisely how one of them
shipped broken and had to be caught by a reader instead. And no project save
was round-tripped
through a real Rekordbox library — the persist changes are covered by the
suite's own round-trip pins, which is the constraint v14.1 set and which still
binds: valid saves round-trip byte-identically, and only malformed input
resolves to defaults.

## The pull-request review

The wave's own findings all came from the same reviewer. To get an independent
read, the branch was pushed as
[PR #3](https://github.com/mrollier/visualise-dj-tracklists/pull/3) and the
`code-review` plugin run against it -- five reviewers over the diff (repo
conventions, a shallow bug scan, git blame and history, prior pull-request
comments, and code-comment compliance), each surfaced issue then scored 0-100
for confidence by a separate pass, anything under 80 dropped.

Three candidates surfaced; one survived.

- **100 -- the reduced-motion no-op above.** Real, and the reviewer proved it
  by compiling the component with `svelte/compiler` and comparing byte offsets
  in the emitted CSS rather than trusting the source read. Fixed before the
  merge.
- **50 -- a stale comment paragraph in `screenshot.mjs`.** Leftover draft text
  describing the pre-`s` Clear as unconditional, sitting directly above the
  corrected paragraph that describes it as optional, which is what the code
  does. Deleted, though it scored below the bar.
- **0 -- the removed `onpointerup` in `DeckRow.svelte`.** The bug scan read the
  deletion as leaving `dragging` stuck true. The history reviewer had already
  cleared it and the scorer agreed: `change` fires on release whether or not
  the value moved, and `pointerup` running *first* was the actual defect the
  deletion fixed. A useful demonstration that the confidence pass earns its
  keep -- two of the three reviewers' hits were noise.

The four reviewers that found nothing are a result too. Between them they
checked the diff against v14.1's `## Deliberate non-goals`, against the `main`
version of the `ISSUES.md` ledger, against `git blame` on every touched hunk,
and against the comments surrounding each change -- and found no re-litigated
decision, no reintroduced bug, and no deleted line that a past commit had added
on purpose.
