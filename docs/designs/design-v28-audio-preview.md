# Design v28 — audio preview

A two-deck audition bar under the top bar. Select a track to load it, press
play to hear it, pin it, and crossfade a second track against it. The point is
to check a combo **by ear** rather than by metadata — which matters most for
manual combos, where metadata is exactly what the user is overriding.

Off by default, behind one Advanced Settings toggle.

## Why the reversal

`design-v12.md:127` lists "No local audio preview (declined)" among the
non-goals, with no recorded reason. Reversed deliberately in v28.

The decline was a scope call, not a principled one. Nothing about playing a
track locally crosses the POSITIONING boundary, provided the app keeps
**remembering nothing**: audio is read from the user's own machine, never
uploaded, and nothing about what was heard is recorded. No play count is
incremented, no history is written, no player state enters the saved project.
The "it plans, it doesn't remember" claim (`README.md:284-289`) survives by
construction, not by discipline — the player's stores live in
`src/lib/audio/`, not `src/stores.ts`, so `startAutosave`'s subscription list
cannot reach them.

What has changed since v12 is that the value became clear: the app tells you
two tracks *should* work. Nothing until now let you find out whether they
actually do.

## The constraint everything else follows from

**A browser cannot open a file from a path string.** `Track.location` holds
`file://localhost/Users/…/Track.mp3` verbatim, but that is only text to a web
page — `fetch('file://…')` and `<audio src="file:///…">` are both blocked from
an https origin, deliberately, in every browser. Rekordbox handing us the path
changes nothing.

So the path is not the key to the door. It is the **index** we match against a
folder the user grants. And Firefox — a hard requirement — does not implement
`showDirectoryPicker` and has objected to it on principle, so its ceiling is
one folder pick per session.

Hence the hybrid: Chromium gets a directory handle stored in IndexedDB and
reconnects silently; everything else gets `<input webkitdirectory>` and picks
once a session. Both funnel into one `AudioSource` interface, and the
difference is confined to enumeration and to turning a handle back into a
`File`.

Worse for matching: with the FSA backend the granted root's absolute path is
**unobservable** — a `FileSystemDirectoryHandle` exposes only `.name`. So
rerooting a stored absolute path onto the grant is not merely fragile, it is
impossible. Prefix matching was never an option.

## Matching

Bucket the folder's files on folded basename; break collisions on the deepest
shared path suffix; refuse ties.

The suffix is the part of a path that travels with the files
(`House/2019/Track.mp3`); the prefix belongs to the machine. A library that
moved from `/Users/old/Music` to `/Volumes/DJ` therefore matches with zero
configuration, and a unique basename needs no shared folder structure at all.

**NFC folding is load-bearing.** macOS APFS hands filenames to the File API in
NFD; Rekordbox's XML carries NFC. Without normalising both sides, every
accented artist silently fails to match. Extracting `src/core/location.ts`
also fixed this in the M3U importer, which had the same latent bug.

Ties resolve to `ambiguous`, never a guess. The M3U importer can afford an
"artist - title" fallback because a wrong metadata row is visible and
recoverable; silently playing the **wrong audio file** would corrupt the exact
judgement this feature exists to support, invisibly.

## The graph

```
audio0 ─ MediaElementAudioSourceNode ─ gain0 ─┐
                                              ├─ destination
audio1 ─ MediaElementAudioSourceNode ─ gain1 ─┘
```

`<audio>` streaming, not `decodeAudioData` — decoding a ten-minute FLAC would
cost ~100 MB and a multi-second stall, and streaming gives `currentTime`,
`duration` and seeking for free.

Three traps worth recording:

- `createMediaElementSource(el)` may be called **once per element, ever**. A
  second call throws and permanently bricks it. The two elements and their
  source nodes are built once; loading a track only swaps `src`.
- A routed element emits **nothing** while the context is suspended — no
  error, no clue. `ensureContext()` resumes on every play, not just the first,
  and must be the first synchronous statement of a click handler because
  Safari wants the resume in the gesture's own task.
- There is no AudioContext until a click pays for one, so nothing knows a
  track's duration before its first play. Gating the play button on a known
  duration deadlocks the deck — found in the browser, not in tests.

Crossfade is a **unity plateau** (v28.1, see below): the deck the fader points
at stays at 1.0 across its whole half and only the far deck tapers away, so
centre is both tracks at full level.

Pinning emits a **role swap**, not a reload: the playing element keeps going
at its exact position. Reloading deck A from deck B's file at 0:00 would
restart the audio mid-listen, which is the opposite of what "pin this" means.

## Testing shape

`vitest` runs `environment: 'node'` with no jsdom and no component testing, so
every decision that can be wrong is a pure function in `src/core/audio/` and
`src/lib/audio/` is glue that is correct by inspection. The deck reducer
returns **effects** rather than acting, which is what lets the state machine —
including the element-swap decision — be covered without a DOM. 61 new unit
tests across path folding, matching, format verdicts, coverage, reason copy,
the reducer, the crossfade curve and playhead maths.

The rest was verified by driving a real browser against a folder of generated
audio and a library whose paths point at a different machine. That is what
surfaced the deadlock above, a missing reason label, and the promote-state
bug — none of which unit tests could have reached.

## Declined

- **Tauri.** The only route to genuinely zero prompts, since a desktop shell
  can read `Track.location` directly. Out of scope: two build targets, macOS
  signing and notarisation, and no more Cloudflare-Pages-only deploy. Revisit
  if the once-a-session pick proves genuinely annoying — that would be the
  PWA disappointing in the sense `IDEAS.md:70` means.
- **Waveform overview.** Needs a full decode per track. The plain progress
  line ships first; a waveform is a separate feature, not a detail of this one.
- **Tie-breaking ambiguous matches on file size.** Makes the matcher async and
  impure for a case where "ambiguous" is already the honest answer.
- **An "artist - title" fallback** when the path misses. See above: a wrong
  file is worse than no file.
- **Keyboard shortcuts.** The global handler (`App.svelte:29-50`) guards form
  fields only, so a global Space would break activation of every `<button>`
  and `<summary>` in the app. Click-only sidesteps it entirely.
- **A master gain / volume slider.** The OS has a volume knob. This is about
  a *user-facing* level control; the output-bus limiter added in v28.1 is a
  non-adjustable safety net with no UI, and is not the same thing. A master
  *trim* is separately declined below, for a stronger reason.
- **Driving the player from the set panel, combo edges or the constellation.**
  Selection-driven only for now.

## Revised after first use (v28.1)

Four things the first version got wrong, or as right as the platform then
allowed.

### The crossfader was attenuating the listening position

Equal power (`cos`/`sin`) puts each deck at -3 dB in the centre, so a track
only reached full level with the fader hard over. That curve is correct for a
DJ **transition**, where the two signals are meant to sum to one constant
programme and the move passes *through* the middle. This is a **comparison**
tool: the centre is where you sit, and both candidates belong at their own
level there.

The deck the fader points at now holds 1.0 across its whole half; only the far
deck tapers. `cos` is even, so one term serves both, and its zero derivative at
the origin joins taper to plateau without an audible kink.

**Consequence, and why the fix is not a trim.** Two modern club masters summed
at unity run well past full scale and hard-clip at the destination — crunch at
exactly the position the change exists to make usable. A -3 dB master trim
would reproduce the old centre level *exactly* and undo the whole change, so
the answer belongs at the output stage: one `DynamicsCompressorNode` between
the gains and the destination (threshold -1, knee 0, ratio 20, attack 3 ms,
release 100 ms). A single deck only touches it on true peaks. Both decks share
the node, so its few milliseconds of latency cannot pull them out of alignment
with each other.

### The crossfader was too loud a UI element

A full-width horizontal slider with `A`/`B` end letters took a whole row under
a bar specified as minimal. It is now a small vertical fader in its own 22px
column, spanning both deck rows, so it costs **no height at all** — the pinned
bar went from three rows to two. Two hairline nubs flank the track at centre
so "both at full level" is findable by eye.

`writing-mode: vertical-lr` is the standard recipe and now the only one needed
(Chrome 124+, Firefox 120+, Safari 16.5+, all shipped by 2023 — no
`orient="vertical"` legacy attribute). Default `direction: ltr` puts the
*lowest* value at the top, and `min="-1"` is deck A, which is the top row, so
nothing inverts.

*Trap, found in the browser:* `height: 100%` on that input resolves against a
grid row whose own height depends on the input, and Chromium settles the
circularity by stretching the fader to the full viewport — a 913px bar. The
input is absolutely positioned with `top: 0; bottom: 0` instead, which takes it
out of flow so it cannot feed back into row sizing.

### Deselecting killed playback

Shipped as a recorded standing objection, and it was right: clicking bare wheel
background (`WheelView.svelte:901`) or empty left-panel space
(`CriteriaPanel.svelte:79`) clears `selectedId`, and re-clicking a node to
dismiss its focus star is a constant gesture. All three cut deck B mid-listen.

Deselection now **latches** while deck B is playing. A paused deck still
clears, which is what keeps the bar able to return to its empty state. The
reducer stays pure — the caller reports `engine.isPlaying('b')` on the event.

### The picker opened nowhere

Chromium's `showDirectoryPicker` accepts only well-known directory names, so
it gets `startIn: 'music'` for the first pick (`id` already made it reopen
where the app last picked). `<input type="file" webkitdirectory>` — all that
Firefox and Safari offer — accepts **no hint of any kind**. There is no API;
this is a platform limit, not an omission.

What is left is to show the path, since the library already carries it.
`commonAncestorPath` folds every `Track.location` down to the deepest folder
they share, and it appears as a copy button beside the link control — paste it
with ⌘⇧G in the macOS open panel, Ctrl+L in GTK and Windows dialogs. Folded
comparison with original spelling for display, so a library whose XML
disagrees about case or Unicode form still resolves to one hint. Below two
shared segments it returns null: one outlier track on the Desktop collapses
the prefix, and `/Users` helps nobody.

The control itself moved into `FolderLinkControl.svelte`, used by both the bar
(the discovery path) and Advanced → Preview (the one you can come back to), so
the two cannot drift apart.

### Also declined in v28.1

- **A master trim to buy headroom.** -3 dB reproduces the old centre level
  exactly. It would undo the change it was meant to support.
- **An eject button on deck B.** Latching removes the only way to empty the
  deck, but pausing then clicking away already does it, and the bar was
  specified as minimal.
- **A setting for latch-versus-clear.** One behaviour, chosen; a toggle here
  would be clutter over a distinction most users would never articulate.

### Polish, second pass (v28.2)

Seven follow-ups from continued use, none of which changed the architecture:

- **The fader column is reserved even while empty**, so pinning a track no
  longer shifts the transport sideways; the input paints above the centre-tick
  nubs (they and the positioned input paint in DOM order, which had put the
  right nub in front of the thumb); and double-clicking snaps to centre.
- **Both decks are always named.** Deck B was anonymous until something was
  pinned. A name longer than the label column cycles: glide to the end, hold,
  glide home, forever — distance-proportional duration, plain ellipsis under
  reduced motion (`src/lib/marquee.ts`).
- **The audible tracks breathe** in the wheel (dot opacity — the path's
  transform attribute carries its position, so opacity is the safe channel)
  and in the Tracks view (row tint). Driven by the decks/playing stores,
  all-false when the preview is off.
- **`dispose()` no longer clears the deck-event listener set.** playerStore
  registers its listener once at app start, so toggling the preview off and on
  left the rebuilt graph emitting metadata/time events to nobody: duration
  missing, seek dead, play/pause deceptively fine. The set belongs to the
  store's lifetime, not the graph's.
- A neighbour, not the player: the Tracks view's Artist column had collapsed —
  the measured colgroup left the first alpha column (Artist, not Title as its
  comment claimed) as a bare `<col>` that fixed layout squeezed to nothing
  once the pinned columns outgrew the pane. Every column is measured now.

## Known limitation

AIFF and ALAC. Chrome plays neither; Safari plays both. A Rekordbox library
heavy in either will show "format unsupported in this browser" for those
tracks. This is why the coverage read-out exists rather than being guessed at:
after linking a folder the bar reports, e.g., `2043 of 2080 playable · 31
unsupported format · 6 not found`.
