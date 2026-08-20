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

Crossfade is equal-power (`cos`/`sin`), not linear. A linear fader delivers
half the power at centre, and centre is exactly where an A/B comparison sits.

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
- **A master gain / volume slider.** When the crossfader exists it *is* the
  level control. The OS has a volume knob.
- **Driving the player from the set panel, combo edges or the constellation.**
  Selection-driven only for now.

## Known limitation

AIFF and ALAC. Chrome plays neither; Safari plays both. A Rekordbox library
heavy in either will show "format unsupported in this browser" for those
tracks. This is why the coverage read-out exists rather than being guessed at:
after linking a folder the bar reports, e.g., `2043 of 2080 playable · 31
unsupported format · 6 not found`.
