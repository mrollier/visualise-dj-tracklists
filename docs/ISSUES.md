# Issues — open (v13 review)

Issues from the v13 review, grouped by area. Each entry carries a **type**
(bug / polish / feature / design / removal — often combined) and a rough
**priority** inferred from the review. Code references are given as clickable
links so the planning stage can jump straight to the relevant spot.

All product decisions have been settled with the user — the relevant entries
say **Resolved / Decision**, and the full list is recorded under "Decisions
(resolved)" at the end. Nothing is left for the planning stage to guess.

---

## Summary index

| ID | Issue | Type | Priority |
|----|-------|------|----------|
| **F1** | Numeric filter values truncated by spin arrows | bug | high |
| **F2** | Text filters → bounded alphabetical range | bug/polish | medium |
| **F3** | "Kind" filter → lossy/lossless/both selector | polish | low-medium |
| **F4** | Fields whose nature a range filter can't express (Location…) | design/polish | medium |
| **D1** | Enrich sample dataset to exercise every filter | bug | medium-high |
| **D2** | Auto-select "Classic demo" playlist on sample load | polish | low-medium |
| **C1** | Re-enabling a criterion should always auto-require it | bug | medium-high |
| **C2** | "Desired" vs "demanded" criteria (must-match lock) | feature | medium |
| **S1** | Essential (★ must-include) tracks guaranteed in the set | bug/design | high |
| **S2** | "Force to N" should continue the short walk, not restart | bug | medium |
| **S3** | Set-building preference for user-defined combos (tunable) | feature | low-medium |
| **T1** | Manual combo linking in the Tracks view too | feature | medium |
| **E1** | Easy mode should be defaults-only and independent | design | high |
| **V1** | Remove metadata editing (hand-enter) | removal | medium |
| **R1** | Combo-link hint text widens the whole right panel | bug | medium |
| **W1** | Key filter should collapse whole angular slices | polish | low |
| **W2** | Wheel hover-halo lingers after deleting hovered track | bug | low-medium |
| **W3** | Manual-combo dashed lines should dim in focus mode | polish | low-medium |
| **W4** | Extend same-key spread range to 0–2 | polish | low |

**Rough priority tiers** (for sequencing):
- **High:** F1, S1, E1
- **Medium-high:** D1, C1
- **Medium:** F2, F4, C2, S2, T1, V1, R1
- **Low-medium:** D2, F3, S3, W2, W3
- **Low:** W1, W4

---

## Filters panel (left)

### F1 — Numeric filter values are truncated by their spin arrows
**Type:** bug · **Priority:** high

The default filters (BPM, Year, Rating, Key) are the right set, but the numeric
inputs for **BPM** and especially **Year** are cut off: the up/down spinner
arrows overlap the value, so the number in the box is hard to read and the
control is awkward to use.

The value inside a filter box must always be fully visible, with the spinner
arrows sitting clear of it. This has to hold generally — not just for the
current filters, but for any additional filters added later.

### F2 — Text filters should be a bounded alphabetical range, not free text
**Type:** bug/polish · **Priority:** medium

Text-based filters (artist, and likewise composer, label, etc.) currently take
free-text input on both ends of the range, which is confusing — you can type
anything.

Instead they should behave like the numeric range filters: a bounded, ordered
domain you can step up and down. The intended domain is the alphabet **A–Z**
plus **one catch-all bucket** for everything non-alphabetical (shown as `*` or
some nicer equivalent — pick whatever reads cleanly). So the control moves
through the alphabet the same way the BPM control moves through numbers.

The range filters on the **first letter** of the field: e.g. A–M catches every
artist whose name starts with A through M.

Keep it simple and intuitive. This should apply uniformly to all text-type
filters, not just artist.

### F3 — "Kind" filter should be a quality selector, not free text
**Type:** polish · **Priority:** low-medium

The Kind filter is currently a free-text range like the others, which doesn't
fit a categorical field. The DJ-relevant decision is really about **audio
quality** — e.g. "only show tracks I have a lossless file for."

Proposed: replace it with a simple selector — **lossy / lossless / both**.

_Assessment: this is a good fit — it maps the raw `kind` values (MP3, AAC, …
vs. WAV, AIFF, FLAC, ALAC, …) onto the choice you actually care about, and
stays simple. Implementation note: we'll need an explicit lossy/lossless
mapping for the file formats present in the data. A fuller multi-select over
the exact formats is the obvious alternative, but that's more clicks for a
distinction you rarely need — recommend the tri-state unless a case for
per-format selection comes up._

### F4 — Some fields have a nature that a range filter can't express
**Type:** design/polish · **Priority:** medium

General principle: a filter control should match the **nature** of its field.
Right now every text field is forced into the same range control, which is
nonsensical for some. The clearest offender is **Location** (a file path) —
filtering it "between B and F" is meaningless and just confusing. Others have
the same problem to a lesser degree.

Good news: [properties.ts](src/core/properties.ts) already carries a
`filterable` flag on every property, added for exactly this — a property can
opt out of range filtering without special-casing the engine. So the fix is
mostly deciding, per field, what its filter should be (or that it shouldn't
have one).

Proposed treatment by field nature (to firm up in planning):

- **Path-like — Location:** first-letter range is meaningless (values share a
  path prefix). **Decision: a "contains" substring search** (not a range).
  _Primary case in this issue._
- **Free-form notes — Comments:** alphabetical range is near-useless.
  **Decision: a "contains" substring search** too.
- **Categorical — Colour:** it's a fixed set of Rekordbox colour tags, not an
  ordered range. **Decision: a chip multi-select**, offering only the colours
  **actually present in the current playlist**. If that scoping turns out
  confusing or fiddly in practice, it's acceptable to drop the Colour filter
  entirely.
- **Quality — Kind:** already covered by **F3** (lossy/lossless/both).
- **Low-value numerics — Size, Bit rate, Sample rate:** a numeric range is
  technically valid but rarely useful. Keep the range (harmless) but they stay
  opt-in, not default — no change strictly required.
- **Everything else** (artist, title, album, genre, composer, label, remixer,
  grouping, mix; the numerics; the dates; key): the A–Z range (**F2**),
  numeric range, date range and wheel treatment respectively all make sense —
  leave as is.

Net: the concrete asks are to give **Location** and **Comments** a "contains"
substring search, and give **Colour** a chip multi-select (limited to colours
present in the current playlist); the rest is confirmation.

## Sample data

### D1 — Enrich the sample dataset to exercise every filter
**Type:** bug · **Priority:** medium-high

The current sample dataset is missing many of the properties the filters act
on (e.g. **date added**, and various other filterable fields), so you can't
actually see a filter take effect while playing with the app.

Fill out the sample data — fully fictional is fine, it needn't be real — so
that every filterable property is populated across the set and each filter has
something to bite on.

Important: deliberately leave **some** fields incomplete on **some** tracks, to
mimic a real-world dataset where not everything is tagged.

### D2 — Auto-select the "Classic demo" playlist on sample load
**Type:** polish · **Priority:** low-medium

When the user loads the sample pack, automatically select the **Classic demo**
playlist ([`CLASSIC_PACK`, samples.ts:489-492](src/data/samples.ts#L489-L492))
so the app opens with a populated wheel rather than an empty view — a stronger
first impression.

**Assessment (agreed, with a caveat):** worth doing — a populated wheel beats an
empty one even though the empty-state message ("select a playlist / loosen the
filters") is already clear. **Scope it to the sample load only.** Do *not*
auto-select a playlist when a user imports their own library (no canonical
starter playlist exists there — it'd be presumptuous), and keep the clear
empty-state message for genuine empty states (deselected playlist, over-tight
filters). Pairs well with easy mode (E1) as the first-run experience.

## Combo criteria panel

### C1 — Re-enabling a criterion should always auto-require it
**Type:** bug · **Priority:** medium-high

Enabling a combo criterion should **always** add it to what's required — i.e.
the "require N of M" threshold should go up by one so the just-enabled
criterion counts. Today it only does this from the "require all" state, so the
behaviour is inconsistent:

- **Works:** at *require 3 of 3*, disabling then re-enabling genre goes
  3-of-3 → 2-of-2 (on disable) → back to **3-of-3** (on re-enable). Good.
- **Broken:** after dropping to a partial state (e.g. *require 2 of …*), doing
  the same disable/re-enable trick leaves the threshold **stuck** — it doesn't
  climb back up. Same when starting from *require 0 of …*: re-enabling a
  criterion doesn't tick it on.

**Root cause** — [`toggleCriterion` in combos.ts:310](src/core/combos.ts#L310):
the enable branch only bumps the threshold when `threshold === before` (you
were requiring *all* enabled criteria). In any partial or zero state that
condition is false, so the newly-enabled criterion isn't added to the
requirement.

**Fix direction:** on enable, always require the new criterion —
`threshold = min(threshold + 1, after)`. (Since `after = before + 1` and
`threshold ≤ before`, this is just `threshold + 1`.)

**Deliberate design change to note:** the current code comment says a
"deliberate zero requirement is left alone" on enable. This issue intentionally
overrides that — per the user, enabling a criterion always means requiring it,
including up from zero. Update the comment/intent accordingly.

**Relationship to C2:** if C2 is built, this auto-require behaviour becomes the
"enable → desired" half of that larger model. C1 is still worth doing on its
own as the immediate fix; plan the two together.

### C2 — "Desired" vs "demanded" criteria (must-match lock)
**Type:** feature · **Priority:** medium

Extend a criterion from a plain on/off into two states of "how required":

- **Desired** — enabled and part of the pool (today's behaviour): counts toward
  the "require N of M" threshold, but any N of the enabled criteria may be the
  ones that match.
- **Demanded** — a *hard* requirement: this criterion **must** match for a pair
  to form an edge.

**Chosen model (kept deliberately simple — Option A):** one threshold number,
no second count. A pair is a combo when **every demanded criterion matches**
AND **total matched ≥ N**. Since demanded criteria must match, they're always
among the N, so the familiar "require N of M" phrasing still holds.

**UI — lock affordance, NOT a tri-state cycling checkbox.** We explicitly
rejected a checkbox that cycles off → desired → demanded → off (hard to read
state, no way back, overloads two rows). Instead:

- Keep the existing on/off checkbox (on = desired).
- Add a small, obvious **lock icon** per enabled criterion; locked = demanded.
- State must be legible at a glance and dead easy to use — this was the user's
  firm requirement.

**Threshold coupling (the require row):** the number of locked criteria sets a
**floor** on N — you can't require fewer matches than the count of things that
must all match, and a locked criterion can't be unchecked in the require row.
This expresses the user's "different colour / impossible to turn off" idea as a
floor rather than a second number.

**Rejected alternative:** treating demanded criteria as a hard gate *outside*
the N-of-M ("all demanded AND at least N of the rest"). More expressive but
introduces a second number to reason about — rejected for simplicity.

**Resolved — missing data on a demanded criterion:** if a demanded criterion
can't be evaluated for a pair (value missing on either side), the pair forms
**no edge**. A demanded criterion that can't be confirmed to match fails the
pair. This is stricter than today's shrink-the-denominator rule
([combos.ts:236](src/core/combos.ts#L236)) and applies **only to demanded**
criteria — *desired* criteria keep the existing shrink-the-denominator
behaviour.

## Set builder / suggestions

### S1 — Essential (starred / must-include) tracks must be guaranteed in the set
**Type:** bug/design · **Priority:** high

If a track is starred as essential (`mustInclude`, the ★ toggle), the generated
set **must** contain it — full stop. Including an essential track outranks
honouring the combo criteria: if the only way to reach it is to break criteria
(force an edge), that's an acceptable trade. The user's words: the number-one
priority is that essential tracks are in, even at a high adventurousness rate.

**Current behaviour (the bug):** must-include is only a **soft bias**, not a
guarantee. [suggest.ts:296-302](src/core/suggest.ts#L296-L302) adds a
`MUST_INCLUDE_BONUS` to the candidate score and the comment says it outright:
"Biased, not guaranteed." It fails when:

1. The starred track never neighbours the walk's tip (so it's never a
   candidate), or the walk fills to `length` before placing it.
2. **Adventurousness makes it worse:** at high `randomness`,
   [`pick`](src/core/suggest.ts#L336) deliberately samples away from the top
   score, so even when the starred track is the best candidate the bonus can be
   ignored. The bias gets drowned out exactly when the user cares most.

**Desired behaviour:** essential tracks are a **hard guarantee**. Promote them
from a scored bonus to a reserved/forced placement:

- Ensure every pending must-include track is placed before the walk ends —
  reserve slots so filler can't crowd them out.
- If no criteria-satisfying route reaches a pending track, **force** it in
  (break a criterion, like the existing forced-pick path) rather than dropping
  it.
- Make placement immune to the randomness/adventurousness knob — adventurous
  sampling may reorder the *non-essential* choices, but must never cost an
  essential track its spot.

**Resolved:**
- If the number of must-include tracks exceeds the set `length`, **essentials
  take priority** — they all go in, even if that means the set is entirely (or
  almost entirely) essentials.
- Placement **tries harmonious positions first**, forcing only as a last resort.
- Interaction with pinned start/end (they already consume slots) is a planning
  detail to work out, not a product decision.

**Related:** see **S3** — set-building should also carry a tunable *preference
for user-defined combos*, which interacts with how walks are scored.

### S2 — "Force to N" should continue the short walk, not restart it
**Type:** bug · **Priority:** medium

When a full-set suggestion (✨) can't reach the target length under the combo
criteria, it stops short and offers **⚡ Force to N**. Pressing Force should
**continue the existing walk from where it got blocked**, appending forced
(criteria-breaking) picks until it reaches N — keeping the tracks already found.
Instead it **regenerates from scratch**, often picking a different first track.

**Root cause:** [`suggest(force)` in TracklistPanel.svelte:164-184](src/lib/TracklistPanel.svelte#L164-L184)
re-runs `suggestWalk` with `seed: suggestSeed++` — a **new** seed each press.
With nothing pinned/selected, `seedId` is null, so a new seed yields a new
random opener and a fresh walk.

**Fix direction (clean):** `suggestWalk` is deterministic for a given seed, and
the `force` flag only changes behaviour *at the stall point* — up to there,
candidates are non-empty so forcing doesn't alter the picks
([suggest.ts:330-335](src/core/suggest.ts#L330-L335)). So Force should **reuse
the same seed** (and same `seedId`/`endId`) as the short walk it's extending,
rather than incrementing. That reproduces the identical prefix and then forces
onward from exactly where it stopped. Store the seed used for the current short
walk so Force can reuse it (instead of `suggestSeed++`).

**Note:** the same-seed approach also covers the pinned-end (two-armed) case —
the arms are deterministic, so forcing fills the broken seam in place
([suggest.ts:391-406](src/core/suggest.ts#L391-L406)) rather than rebuilding.
Confirm the plain ✨ button keeps its "roll a fresh set each press" behaviour —
only ⚡ Force changes to continue-in-place.

### S3 — Set-building should prefer user-defined combos, tunable in advanced settings
**Type:** feature · **Priority:** low-medium

Set generation should have a **preference for user-defined combos** (manual
edges / "roads") — walks should lean toward routing through pairs the user has
marked as known-good. Crucially, the **strength of this preference should be
adjustable in advanced settings**, like the adventurousness knob.

**Current state:** the suggester already applies a *fixed* `MANUAL_EDGE_BONUS`
that nudges walk scoring toward manual edges
([suggest.ts](src/core/suggest.ts), used in the `manualTerm` scoring). This
issue asks to (a) confirm that preference is meaningfully strong, and (b)
**expose its strength as an advanced-settings control** (e.g. a
`manualEdgeWeight` setting) with a sensible default, wired into the walk
scoring so the user can dial how hard the set-builder favours their known-good
combos.

## Tracks view

### T1 — Manual combo linking should work in the Tracks view too
**Type:** feature · **Priority:** medium

The manual-combo feature (🔗 — mark a pair you know works) currently only works
in the **wheel** view. It should work in the **Tracks** view as well, with the
same flow the user proposed (and which matches the wheel): select one track,
press the 🔗 link icon (bottom-right in the selected-track card), then the next
track you pick in the Tracks view is marked/unmarked as a manual combo with the
original.

**Good news — the plumbing already exists and is shared:**
- [`linkArmed`](src/stores.ts#L332) — the armed state, toggled by the 🔗 button.
- [`toggleManualEdge(a, b)`](src/stores.ts#L322) — marks/unmarks the pair.
- The wheel's consumer is just
  [WheelView.svelte:337-340](src/lib/WheelView.svelte#L337-L340): when armed
  and a *different* node is clicked, toggle the manual edge.

So the Tracks view needs the mirror of that: when `linkArmed` is set and a row
other than the selected one is clicked, call `toggleManualEdge` instead of the
normal select/add-to-set behaviour — plus a visual cue that link mode is active
(as the wheel has). Small, self-contained addition.

## Easy mode

### E1 — Easy mode should be defaults-only and independent of advanced state
**Type:** design · **Priority:** high

Easy mode should be the **simplest possible** version of the app — a clean
first impression — and **independent** of the full ("All controls") mode. It
should always run on **default values for everything**: default combo criteria,
no filtering, default advanced settings. The user's only choice is the
**playlist**, and they can **create a set** from the wheel with those defaults.
No filters, no genre choosing, no advanced settings, no other machinery.

**Current behaviour (the problem):** easy mode is **visibility-only** over
*shared* state ([App.svelte:16-18](src/App.svelte#L16-L18): stored state
"survives untouched"; the `uiMode` toggle in
[TopBar.svelte:206-211](src/lib/TopBar.svelte#L206-L211) only flips visibility;
[CriteriaPanel.svelte:11-13](src/lib/CriteriaPanel.svelte#L11-L13) just hides
sections). So a filter changed in full mode still applies after switching to
easy — the two modes aren't separated. The tour copy even promises "exactly as
you left it."

**Desired behaviour:** when easy mode is on, the engine uses **defaults**
regardless of what's stored — `DEFAULT_CRITERIA`, no active filters, default
settings — so easy always looks pristine. Advanced tweaks are **preserved
untouched** in storage and restored when the user returns to All controls (that
"exactly as you left it" promise stays true for *advanced*, not easy). Cleanest
approach: easy mode *computes with* defaults rather than *mutating* the stored
advanced config.

**In easy mode the user can:** pick a playlist; see the wheel with default
criteria; press create-set (✨). **Hidden/inactive:** filters, genre map / genre
choosing, advanced settings, view switching (already wheel-only).

**Resolved:**
- The set-building extras (must-include ★, pins, manual combos 🔗) are
  **hidden/inactive** in easy mode. Easy is just "pick playlist → create set".
- Playlist selection and the created set **stay shared** with advanced mode (so
  switching to All controls shows the same set); only criteria/filters/settings
  are forced to defaults.
- Update the tour copy so it no longer implies easy inherits advanced state.

## Track metadata

### V1 — Remove metadata editing (hand-enter)
**Type:** removal · **Priority:** medium

The app currently lets you hand-enter key / BPM / genre etc. (the
[`.edit-grid` in SelectedTrackCard.svelte:257](src/lib/SelectedTrackCard.svelte#L257)).
This isn't useful: metadata should come from outside the app (Rekordbox and
friends), and this app should **not** edit track metadata in any way. Remove the
editing UI and any underlying edit/override state it depends on. The freed space
in the selected-track card just goes away — nothing replaces it.

**Considered and rejected — per-track vinyl marking.** We explored letting the
user mark *individual* tracks as vinyl (vinyl couples key to BPM; digital
key-lock does not), replacing the current **global** vinyl toggle
([`key.vinylMode`](src/core/combos.ts#L58), applied to every pair at
[combos.ts:181-189](src/core/combos.ts#L181-L189)). Decision: **do not build
this — keep the global "all vinyl or none" toggle as-is.**

Rationale: same-type pairs would be easy (vinyl↔vinyl = today's formula,
digital↔digital = plain key match), but the **mixed** pair is genuinely hard —
a vinyl track's played key depends on the exact BPM it's pitched to (a free
variable), so matching it to a fixed-key digital track needs a bounded pitch
search that isn't worth the complexity or the risk of confusing edges. A
middle option (vinyl-drift only for vinyl↔vinyl, labeled keys otherwise) was on
the table but the user opted for the simpler status quo. Recorded so this
isn't reopened without new reason.

## Selected-track panel (right)

### R1 — Combo-link hint text widens the whole right panel
**Type:** bug · **Priority:** medium

The manual-combo feature (🔗 — click another track on the wheel to mark/unmark a
combo you know works) is nice. But when armed, the blue hint text
[`.link-hint` "Click another track on the wheel to mark or unmark the combo."](src/lib/SelectedTrackCard.svelte#L176)
is too wide and pushes the **entire right-hand section wider**, which is wrong.

The panel's width must be respected. The hint text should wrap within it (here,
onto ~two lines) rather than forcing the panel to grow. A cleaner solution is
welcome, but the hard requirement is: **the panel width is fixed and content
wraps to fit** — no element may stretch the section.

Likely cause: the right panel sizes to its content rather than to a fixed/max
width, so a long single-line string expands it. Fix is probably at the panel
container (give the section a respected width/max-width) so its `<p>` children
wrap naturally.

## Wheel view

### W1 — Key filter should collapse whole angular slices, not just hide markers
**Type:** polish · **Priority:** low

A nice-to-have detail. When the Key filter's range (1–12) is narrowed,
currently only the note markers for the excluded keys disappear from the wheel,
while the angular slices remain.

Instead, narrowing the key range should make the entire angular wedge for each
excluded key collapse/disappear — reusing the same small animation that already
plays when toggling major-only / minor-only / both. So e.g. setting the range
to 5–12 should animate away the slices for keys 1–4 exactly the way the
major/minor toggle does today.

### W2 — Wheel hover-halo lingers after deleting the hovered track
**Type:** bug · **Priority:** low-medium

Hovering a track's name in the set list draws a blue halo around its note on
the wheel (good). But if you **delete** the track while hovering it, the halo
**stays** on the wheel even though the track — and your hover — are gone.

**Root cause:** [`removeAt` in TracklistPanel.svelte:67-68](src/lib/TracklistPanel.svelte#L67-L68)
splices the track out without clearing
[`hoveredId`](src/stores.ts#L48). Because the row element is removed on click,
its [`onmouseleave`](src/lib/TracklistPanel.svelte#L349) never fires, so
`hoveredId` keeps pointing at the deleted track and the halo persists.

**Fix:** clear `hoveredId` when a track is removed (null it, or clear when it
equals the removed id). Worth checking the other removal paths
(TracksView, clear-all) for the same stale-hover leak.

### W3 — Manual-combo dashed lines should dim in focus mode
**Type:** polish · **Priority:** low-medium

In the overview (nothing selected), user-defined combos show as dashed lines —
nice, keep that. But when you select a node and enter **focus mode**, everything
dims except the selection and its connected nodes, *while the manual-combo
dashed lines stay fully lit*. They should dim too (grayed a little, not gone),
consistent with the node dimming — so focus mode emphasises the selected node's
criteria-based suggested combos, and the manual lines recede.

**Current behaviour:** manual edges
([WheelView.svelte:631-644](src/lib/WheelView.svelte#L631-L644), class
`manual-edge`) are drawn "always visible… exempt from the focus-only rule" per
the code comment. Non-focused **nodes** already dim to `0.12` in focus mode
([WheelView.svelte:325](src/lib/WheelView.svelte#L325)).

**Change (decided):** when a node is selected, apply a dimming factor to the
manual dashed lines. A manual edge incident to the selection (both endpoints in
the focus set) stays **bright**; all other manual edges **dim** — matching the
node behaviour.

### W4 — Extend same-key spread range to 0–2 (default 1, max = wedge edge)
**Type:** polish · **Priority:** low

The **same-key spread** slider in advanced settings
([`slotSpreadFactor`](src/core/settings.ts#L88)) currently runs 0–1, where 1
gives a ±4° fan-out ([`half = 4 * slotSpreadFactor`](src/lib/WheelView.svelte#L201)).
Extend its range to **0–2**, still **defaulting to 1** (unchanged current
look). At **2**, the spread should reach its practical maximum: notes sitting
just on the edge of the key's **±7.5°** angular wedge. It's a bit messy at 2 —
intentionally — but lets the user push it to the limit.

**Mapping caveat:** don't just raise the slider max with the existing formula —
`4 × 2 = 8°` would overshoot the ±7.5° wedge. The map must be:
`0 → 0°`, `1 → 4°` (preserve today's default exactly), `2 → 7.5°` (wedge edge).
That's piecewise/interpolated, not a single linear `k × factor`. **Decision:**
account for the node radius (`NODE_WORLD_RADIUS`) so the node's *edge* (not its
centre) kisses the ±7.5° wedge boundary at factor 2.

---

## Decisions (resolved)

All previously-open product questions have been settled by the user. Recorded
here and folded into the issues above; the planning stage can treat these as
fixed.

1. **F4 — Location / Comments filtering:** a **"contains" substring search** for
   both (not a range, not fully non-filterable).
2. **F4 — Colour filter:** a **chip multi-select**, limited to colours **present
   in the current playlist**. Acceptable to drop entirely if it proves confusing.
3. **C2 — demanded criterion with missing data:** the pair forms **no edge**
   (strict; applies only to demanded criteria).
4. **S1 — more must-include tracks than set length:** **essentials take
   priority** (they all go in).
5. **S1 — essential placement:** **harmonious positions first**, force as a last
   resort. Plus a new requirement (see **S3**): a tunable preference for
   user-defined combos, adjustable in advanced settings.
6. **E1 — easy-mode scope:** ★ must-include / pins / 🔗 manual combos are
   **hidden** in easy mode; playlist + created set **stay shared** with advanced
   while criteria/filters/settings force to defaults.
7. **W3 — manual-edge dimming in focus:** edges **incident to the selection stay
   bright**; the rest dim.
8. **W4 — spread at max:** **account for node radius** so the node edge (not
   centre) kisses the ±7.5° wedge boundary at factor 2.
