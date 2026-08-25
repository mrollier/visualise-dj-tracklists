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

Every slice was handed v14.1's `## Deliberate non-goals` list first, so the
settled decisions — `suggest.ts`'s PRNG-order lock, `ManualEdge.a`/`b`, not
splitting the three big views, `.svelte` outside type-aware lint, test-only
exports — were out of bounds rather than re-proposed. They were, and none came
back.

**181 findings.** The forty-seven that cleared the bar are fixed here, recorded
as thirty-four entries; the remaining 134 are in
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
overrides, with a comment explaining exactly this trap. Two were lost
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
- A browser step in CI. Playwright is already a devDependency and the probe
  runs again, but it still reports nine failures that need adjudicating before
  it can gate anything.
- Coverage collection. `vitest run --coverage` as a reported number, not a
  gate.

## Verified

Every commit is green on `npm run lint && npm test && npm run check &&
npm run build`. The test count is unchanged at **971 passing, 1 skipped** —
this wave fixed defects that no test reached rather than changing behaviour any
test asserts.

`node scripts/screenshot.mjs` was run against a live `npm run dev` repeatedly
through the repair; it now reaches the hub/constellation block instead of dying
at step three, and its nine remaining failures are recorded rather than guessed
at.

**Not verified.** Nothing in this wave was checked on Firefox or Safari; the
`FileSystemDirectoryHandle` guard is exactly the kind of thing that wants one.
The reduced-motion fixes were reasoned from the cascade, not observed under
`prefers-reduced-motion` emulation. And no project save was round-tripped
through a real Rekordbox library — the persist changes are covered by the
suite's own round-trip pins, which is the constraint v14.1 set and which still
binds: valid saves round-trip byte-identically, and only malformed input
resolves to defaults.
