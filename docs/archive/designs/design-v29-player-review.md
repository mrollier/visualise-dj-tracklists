# Design v29 — the player review

Ten items from Michiel after living with the v28 audition bar against a real
library. They are not ten unrelated bugs. Three things were wrong with it: it
misrepresented its own state, it was aimed at the wrong thing, and what it
showed and played was not good enough.

Nothing here changes the architecture v28 set down — the pure core in
`src/core/audio/`, the glue in `src/lib/audio/`, the reducer that returns
effects rather than acting. Most of the wave is a correction of what those
pieces were pointed at.

## The deck should follow the click, not the selection

`playerStore` subscribed to `selectedId`, and `selectedId` moves for a dozen
reasons that are not "the user clicked a track": the wheel hub's suggest,
retry and ⟲ picks (`WheelView.svelte:829`, `:863`, `:876`), undo and redo
restoring a captured selection (`undoStore.ts:91` — and *every* selection
change records an undo step, so Cmd+Z can move it as a side effect of undoing
something else), bare background clicks in three places, Escape, a project
load, a library replacement.

So the deck kept changing under people. v28.1 answered the loudest symptom
with a **latch**: deselecting while deck B is playing became a no-op. That was
a patch over the wrong thing, and this wave removes it — not by tuning it, but
by making it unreachable.

`selectOrLink` (`stores.ts`) is already the one choke point every direct track
click passes through: the wheel star's `onclick`, Enter on a focused star, and
the Tracks-view row. It now announces the click on a new `clickedTrackId`
store, and the player subscribes to that. The event carries an id, never null,
so `DeckEvent`'s select case loses `bPlaying` along with the latch branch:
**latching is structural now rather than conditional.**

The store direction matters. `stores.ts` must not import `playerStore`, which
already imports `stores` — a store the player subscribes to keeps that arrow
pointing one way.

The set panel's row button (`TracklistPanel.svelte:519`) writes `selectedId`
directly and deliberately stays out, matching v28's recorded decline of driving
the player from the constellation.

## Unpinning should keep the track it is named after

The padlock on the top row says "Unpin the top track", and `'unlock'` cleared
deck A and kept deck B — it discarded the very track the button acts on.

It now emits the same `promote`-then-`clear` pair `'lock'` does, in the other
direction: the pinned element goes on playing, uninterrupted, as the single
deck B, and whatever deck B held is what goes. The role swap is what makes it
silent — reloading the same file at 0:00 would restart the audio mid-listen,
which is exactly as wrong for "keep only this one" as v28 found it for "pin
this one".

`promote`'s interpretation in `playerStore` becomes a **symmetric** swap of
`materialised`. The old one-directional `a = b; b = null` was only ever correct
going up; the `clear` that always follows nulls whichever side is discarded.

Selection is deliberately not touched: with the change above, the deck and the
app's selection are independent, and the breathing highlight already says
which track is audible.

## The cracks

Two symptoms, reported separately, with two different causes. Michiel's own
report is what scoped this: a click exactly on play / pause / track change, and
random dropouts mid-track with no gesture — **not** a constant crunch on loud
material, which is what would have implicated the output limiter.

**The clicks are missing gain ramps.** `pause()`, the `element.pause()` before
a `src` swap, `removeAttribute('src')` and the bare `currentTime =` seek all
stop the waveform dead on an arbitrary sample. Every one now runs inside
`whileSilenced`: fade the slot to zero over 8 ms, act, fade back over 14 ms. A
*paused* element cannot click, so it is acted on synchronously — which keeps
the ordinary "load then play" path free of any deferral — and the returned
promise resolves once the action has really run, so `materialise` can await a
load before playing it.

The fade has to return to the level the slot was actually commanded to, not an
assumed 1, so the engine records `commanded` per slot. Indexed by slot rather
than by deck: a promote moves the letters and not the nodes, and an element
keeping its level across the swap is what makes the swap inaudible.

`setGains` also stops stacking `setTargetAtTime` events. An exponential
approach never arrives, and every `oninput` of the fader used to schedule
another one on top of the last, so the level chased a target it never reached.
It is cancel + `setValueAtTime` + `linearRampToValueAtTime` now. Pin and unpin
recentre the fader too — it was never reset, so pinning with the fader parked
off-centre stepped the surviving deck's level.

**The dropouts are starvation.** Four changes, in descending order of
suspicion:

- `new AudioContext({ latencyHint: 'playback' })`. The default `'interactive'`
  asks for the smallest buffer the device will give, which is right for an
  instrument and wrong here: nothing in this app responds to input in real
  time, and the main thread is busy painting up to 500 SVG stars under d3
  zoom. A starved render quantum is a dropout.
- `preload = 'auto'` on a loaded element (empty ones stay `'metadata'`), so it
  buffers ahead instead of streaming from cold off an external drive.
- The redundant `element.load()` after assigning `src` is gone. Assigning
  `src` already runs the resource-selection algorithm; the extra call ran it a
  second time, tearing the media pipeline down and rebuilding it underneath
  whatever the other deck was playing. `clearDeck` keeps its `load()`, where
  removing the attribute genuinely needs one.
- The speculative pre-load is debounced by 200 ms and token-checked. Clicking
  through the wheel used to start a media pipeline per track passed, and a
  slow `fileFor` could land a stale file after a newer click. `togglePlay`
  gains a re-entrancy guard for the same reason — it awaits a load between its
  own `isPlaying` check and `play()`.

**The limiter is deliberately untouched.** It only shows up as continuous
crunch on loud material, which is not a symptom that was reported. If the
above does not clear the noise it is the next suspect, and the experiment is
to bypass it whenever one deck's commanded gain is zero and A/B the two.

## Saying what is actually happening

Four items, one theme: the bar knew things it did not say.

**It vanished with no library.** The gate was `$settings.audioPreview &&
$library.length > 0`, which contradicts the principle written three lines
above it in the same file: *a hidden bar cannot distinguish "off" from
"broken"*. Switching the setting on produced nothing at all, which reads as a
broken setting rather than a missing import. It renders now and says which of
the two things is missing; linking the folder before importing is a perfectly
good order and still works.

**Linking a folder is two long passes, and only the first was visible** — as a
bare running integer. Both are named now, behind the repo's first progress bar
(`ProgressBar.svelte`): determinate where the total can be known, honestly
indeterminate where it cannot, since an FSA walk discovers the tree as it
goes. Three separate defects came out of looking at it: `rootName` was only
set inside `adopt()` *after* the walk, so a first link read `Scanning… 0` with
no folder in it; `usePickedFiles` set `'indexing'` and adopted in the same
synchronous tick, so on Firefox and Safari — the only browsers that take that
path — the state never painted at all; and `'ready'` was set *before* the
match pass, so the control briefly fell back to "Link music folder…" with a
folder already linked. Both the picker index and the match are chunked so the
bar can paint, and `adopt` now awaits the match.

**Which folder to link** was a bare shared-ancestor path, which never said why
it was the right one and disappeared entirely — `commonAncestorPath` returns
null below two shared segments — as soon as one track sat on another volume.
The new pure `folderHint` carries the worked example instead: this track, the
path it claims, therefore this folder. It falls back to the example's own
folder when the library is scattered, so there is always something to paste.
The tip also appears after a link that matched nothing, where `✓ 0 of 2080
playable` read like a success and almost always means the wrong folder.

**Why a track will not play** was one short line. Every reason has two levels
now: `reasonLabel` for the row, `reasonDetail` for the ⓘ beside it, from one
reason and one context so the two cannot disagree. `FORMAT_NOTES` carries the
per-format explanation — AIFF is the one a Rekordbox library hits most, and
"format unsupported in this browser" never mentioned that Safari plays it and
Chrome ships no decoder at all. Two facts that used to read identically are
now separated: `canPlayType` predicting no decoder versus the element opening
the file and refusing it, and a file refused outright
(`MEDIA_ERR_SRC_NOT_SUPPORTED`) versus one that decoded halfway and gave up
(`MEDIA_ERR_DECODE`) — the second is a damaged file, not a missing codec.

## The transport belongs over the view it describes

The bar was a plain flex row, so the decks were centred over the whole window
while the wheel they describe sits between a 250px left panel and a 280px
right rail. It is a three-column grid now, matching the app's own layout, and
both widths become `--left-rail` / `--right-rail` in `app.css` — declared once
rather than repeated as bare pixels in three components, which is how they
would come apart.

The side columns stay reserved when the right rail is absent (an empty
library), for the same reason the fader column is reserved when nothing is
pinned: importing a library must not shunt the transport sideways.

To fit the right rail the coverage read-out compresses to `2043/2080
playable`, with the breakdown that used to push the decks off centre moving
behind an ⓘ, one line per reason. Advanced → Preview keeps the full line,
where there is room for it.

This aligns the transport **block** with the central pane. The seek line
itself starts after the play button and the 22ch label, so it is inset from
the pane's left edge; centring the line itself would mean restructuring the
deck row, which is not what the item asked for.

## Making the audible track visible

Three causes, and the smallest of them was the animation.

The **focus dim** multiplied with the breathing keyframes. `nodeOpacity` drops
out-of-focus nodes to 0.12, so an audible star that was not also the selected
one breathed between 0.12 and 0.054 — invisible, which is the opposite of what
"you are hearing this one" needs to say. The audible track is exempt from that
dim now.

**Paint order** never depended on selection or playback. SVG has no z-index,
so the last star drawn wins both the overlap and the click; a `paintedNodes`
derived sorts audible above selected above hovered. It is a separate derived
used only by the `{#each}` — `visibleNodes` also feeds `nodeById`,
`walkNodeById` and the ghost split, none of which want their order disturbed —
and it is stable within each band, so nothing else shuffles.

And a star at **full opacity has nowhere brighter to go**, which is what made
"brighter peak" impossible to satisfy on the dot alone. The peak moves into a
halo behind it, the same idiom as the existing `.hover-ring` and `.tag-ring`,
in phase with the dot so the star is fullest and the glow widest at the same
instant. The dot's own dip softens from 0.45 to 0.65 so it never recedes.
Opacity only on both, for the reason v28.2 already recorded: the path's
`transform` attribute carries its position, so a CSS transform would tear it
off the wheel.

Both views speed up from 2.6s to 1.6s. The Tracks view's peak tint rises above
the static tint a merely-selected row wears, and its reduced-motion fallback
rises with it — at 22% it used to *match* `tr.selected` exactly, so an audible
selected row was indistinguishable from a silent one. The wheel gains the
still fallback it never had.

## The preview joins the tour

The bar had no `data-tour` anchor and no step, and since "Listen to tracks"
defaults to off, a first-run user was never shown the feature exists.

The step sits straight after "What decides a combo", because that is the
argument for it: the criteria decide a combo by its metadata, and this judges
the same combo by ear — which matters most for a manual combo, where metadata
is exactly what the user is overriding.

`enterDemoView` switches the preview on so there is a real bar to spotlight
and `endTour` puts it back, on **both** exits — including "keep this demo",
where `applyProject` never runs, and a first-run tour, which has no snapshot
at all. A switch the user turned off themselves during the tour is left off.

## Declined

- **Setting the app's selection from the player.** Unpinning could have
  selected the surviving track, so the wheel highlighted it. The player takes
  input from the app; making it also drive the app's state is a second
  direction of coupling to maintain, and the breathing already says which
  track is audible.
- **Leaving the tour's preview switch on afterwards.** More discoverable, but
  it silently changes a default-off setting behind the user's back. The step
  names where the switch lives instead.
- **A master trim, again.** Declined in v28.1 for the same reason: -3 dB
  reproduces the old centre level exactly and undoes the curve.
- **Touching the limiter on suspicion.** It is the obvious suspect for audio
  distortion and the reported symptoms do not fit it. Changing it in the same
  wave as five real fixes would have made the result unattributable.
- **Adding a probe to `scripts/screenshot.mjs`.** It has three stale selectors
  already recorded under *Open — tooling* and is not a CI gate, so anything
  added would be checked by nothing. This wave's browser pass ran as a
  standalone probe, as v23's and v28's did.
- **A dedicated "damaged file" reason.** A file that decodes to nothing fires
  `ended`, not `error`, so it is not distinguishable from a zero-length one.
  The read-error copy admits damage as a cause instead.

## Verified in the browser

Two standalone Playwright probes against `npm run dev`, chromium via the
chrome-channel fallback, fresh `localStorage`, a generated folder holding one
file per format (mp3, wav, flac, aiff, ALAC m4a) plus a deliberately corrupted
FLAC, and a Rekordbox XML whose paths point at `/Volumes/OldDrive` — a machine
that does not exist, so the suffix matcher is doing real work.

**32 checks, all passing, zero console errors.** The bar renders with no
library and says what is missing; the folder tip names Dusky — Nightmares, its
full path and the folder to link; the decks share both edges of the central
pane to within 1px; the coverage chip reads exactly `✓ 5/7 playable` (AIFF
unsupported, one file genuinely absent) with the breakdown behind its ⓘ; a
background click, Escape and two view switches leave a playing deck untouched;
the audible star wears its halo, paints last and is not dimmed by another
track's focus; pinning and then unpinning leaves the *pinned* track playing as
the single row; an AIFF names its format and its detail names Safari and the
conversion targets. A second probe against a 6,000-file folder catches the
progress bar mid-scan, and drives the tour to the preview step, confirms the
spotlight lands on the bar itself, and confirms the switch is off again
afterwards. Both themes and a 3× halo capture were reviewed by eye.

**Not verified, and why.** The cracks themselves: whether they are gone is
Michiel's ear, on his own library and his own hardware — the probe can prove
the ramps exist and the graph is built, not that the noise stopped. And the
`MEDIA_ERR_DECODE` branch: Chrome does not raise it for a corrupted FLAC — it
decodes the intact header, fires `ended` immediately and rejects `play()` with
`AbortError` — so that branch is covered by unit tests only. What the probe
does check is that a damaged file is not blamed on its format.

## Testing shape

Unchanged from v28: vitest runs `environment: 'node'` with no DOM, so
everything that can be wrong stays a pure function. This wave adds
`tests/reasons.test.ts` (new — `reasons.ts` had no test file of its own, and
the copy checks that lived in `audio-coverage.test.ts` move into it),
`folderHint` cases in `tests/location.test.ts`, `coverageShort` in
`tests/audio-coverage.test.ts`, and rewrites the deck reducer's click and
unlock cases. 947 tests pass.
