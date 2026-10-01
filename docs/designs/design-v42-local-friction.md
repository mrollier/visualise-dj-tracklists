# v42 — play every track, find it fast, keep the helper running

Status: design approved in conversation on 2026-09-30. This document is the spec
for the implementation plan.

## Goal

Three things get in the way of using the app on Michiel's MacBook, in this order
of annoyance:

1. **Tracks that will not play.** Chrome cannot decode AIFF or ALAC.
2. **The music folder.** Chrome asks to Reconnect every session, Safari (used
   for the AIFFs) asks for the folder again every session, and linking scans
   for a long time.
3. **The analysis helper.** It has to be started by hand in a Terminal, and it
   only answers pages on `localhost`, so it needs `npm run dev` as well.

The app stays a web app. A native desktop shell (Tauri or Electron) was
considered and set aside: it runs the same JavaScript on the same machine, so
it is not faster, and every one of these three problems can be solved in the
browser. The way to get a window of its own is to install the web app from
Chrome.

## What was measured

| Fact | Value |
|---|---|
| Tracks in the collection | 2081 |
| Formats | 1206 MP3, 772 AIFF, 94 WAV, 8 ALAC, 1 AAC |
| Tracks Chrome cannot play | 780 (37%): every AIFF and ALAC |
| AIFF variants (read from the file headers) | 686 plain AIFF 16-bit, 83 plain AIFF 24-bit, 3 missing files; no AIFF-C |
| AIFF size | median 63 MB, p90 95 MB, max 247 MB |
| Reading one AIFF from the SD card | 0.5–0.7 s for 46–62 MB |
| Byte-swapping 80 MB in JavaScript | 47 ms (16-bit), 22 ms (24-bit) |
| Linked folder `/Volumes/SD 1TB/Music` | 60,665 files in 15,500 folders |
| `find` over the SD card, cold | 26 s |
| AIFF paths from the XML that open as written | 769 of 772 (the 3 are the missing files) |
| Chrome version | 154 (persistent folder permissions since 122) |

## Part 1: AIFF plays in Chrome

### Behaviour

A track load today runs: resolve the file → `source.fileFor(handle)` →
`engine.loadDeck(deck, file)`. Between the last two steps, a file whose
extension is `aif` or `aiff` is converted to WAV **when the browser cannot play
AIFF itself** (`canPlayType('audio/aiff') === ''`). Safari plays AIFF natively
and gets the file untouched.

The existing stale-load guard (`playerStore` keeps the most recent load each
deck was asked for) runs after the conversion, so a quick click on another
track still abandons the old one.

### Converter

New pure module `src/core/audio/aiff.ts`:

- `aiffToWav(bytes: ArrayBuffer): Blob | null`
- Parses `FORM`/`AIFF`, then walks the chunks, honouring the pad byte after an
  odd-sized chunk.
  - From `COMM` it takes the channels, the sample frames, the bit depth, and the
    sample rate, which is stored as an 80-bit extended float.
  - From `SSND` it takes the offset and the block size.
- Swaps each sample's byte order in place: 16-bit and 24-bit, from big-endian
  to little-endian. The audio bytes are never copied: the result is a `Blob` of
  a 44-byte WAV header plus a view of the swapped `SSND` data.
- Returns `null` for anything it does not handle: `AIFC` (compressed or
  otherwise), bit depths other than 16 and 24, a missing `COMM`/`SSND`, or a
  truncated file. The caller then passes the original file on, and the element
  fails with the usual note.
- Runs on the main thread (about 50 ms for a large file).
  `ponytail:` a Worker is the upgrade path if a stutter is ever measured.

`engine.loadDeck` takes a `Blob` rather than a `File`: `URL.createObjectURL`
accepts either.

### What changes on screen

- The probe `playerStore` installs (`setProbe`) reports AIFF MIME types as
  playable whenever the converter will run. The coverage line counts AIFFs as
  playable, and "unsupported format" drops to the ALAC files.
- `AIFF_NOTE` in `src/core/audio/formats.ts` stops telling people to use
  Safari. It explains that this particular AIFF uses a variant the app cannot
  convert (compressed AIFF-C) and how to convert it.
- The `m4a` note gains the one-time fix for ALAC: Rekordbox's "Convert file
  format" to AIFF. Converting there keeps the cue points and the collection
  entry, and the result now plays through the converter.

### Tests

- `tests/aiff.test.ts`
  - Builds AIFF files in code: mono and stereo; 16- and 24-bit;
    44.1/48/96 kHz; an extra odd-sized chunk before `SSND`; a non-zero `SSND`
    offset.
  - Checks every WAV header field and the swapped sample bytes.
  - Returns `null` for `AIFC`, 8-bit, truncated files and non-AIFF bytes.
- The 80-bit sample-rate decoder is pinned on the three common rates.
- Browser probe (`scripts/screenshot.mjs`): a generated 24-bit stereo AIFF is
  converted and loaded into an `<audio>` element in Chromium. It must reach
  `loadedmetadata` with the right duration and no `error`. This proves Chrome
  accepts the 24-bit WAV.
- By hand: Michiel plays several of his own AIFFs, both 16- and 24-bit, and
  seeks in them.

### Cost accepted

Click-to-sound for an AIFF is the time to read the whole file: about 0.6 s at
the median, about 1 s at p90, up to about 3 s for the largest. Memory peaks at about twice the file's size per loading deck: the bytes read from disk, plus the WAV Blob's own copy. Streaming the conversion through the service
worker (instant start, flat memory) was declined. It needs about a day more,
and the service worker only runs in production builds, so it could not be
probed in dev. It stays the recorded upgrade path.

## Part 2: The folder resolves by path

### Behaviour

For the File System Access source (Chrome, Edge), linking or restoring a folder
no longer walks it.

- The granted handle exposes only its name, for example `Music`.
- For each library location, the app looks for the segments after an
  occurrence of that name:
  - `/Volumes/SD 1TB/Music/Artist/Album/x.aiff` → `Artist/Album/x.aiff`
  - The lookup follows those segments with `getDirectoryHandle`, ending in
    `getFileHandle`.
  - If the name occurs more than once, the deepest occurrence is tried first,
    then the others.
- Directory lookups are memoised per source, so a folder shared by many tracks
  is resolved once. Lookups run with limited concurrency (8).
- The found files build the same `FileIndex` the scan builds today, with each
  entry's path relative to the root. So `resolveTrack`, `matchLocation`, the
  coverage report and the unplayable notes do not change at all.

**Fallback.** When fewer than half of the library's tracks that have a location
are found this way, the source falls back to today's full walk
(`openFsaSource`). That covers a library that moved machines, or a folder whose
name does not appear in the paths. A track that is simply missing is reported
"not found", as today, and does not trigger a walk.

**Interface change.** `AudioSource.index` becomes
`indexFor(locations: readonly string[]): Promise<FileIndex<AudioHandle>>`.

- The path-based source looks up only locations it has not tried before, and
  returns the index of everything found so far.
- The walking source and the picker source (Firefox, Safari) return their fixed
  index.
- `reindex()` in `sourceStore.ts`, the only reader of `.index`, awaits it with
  the library's locations. A re-import therefore looks up just the new tracks.
- The existing `matchRun` guard still abandons a pass that a newer link or
  import overtook.

**Progress.** While looking up, the bar reads "Finding tracks… N of M" (the
existing `indexProgress`, with a phase for it) instead of the scan count.

**Reconnect every session.** No code. Installed web apps keep File System
Access permissions automatically (Chrome 122+), and `restoreSavedFolder()`
already adopts a folder whose permission is `granted` without a click. It is
verified by hand, see below. Safari is no longer needed for AIFF, so its
per-session folder prompt stops mattering.

### Tests

- `tests/pathMatch.test.ts` (or a new `folderPaths.test.ts`) tests the
  route-from-location helper:
  - root name present once, present twice, absent;
  - accented segments in NFC against NFD;
  - `file://localhost` locations;
  - Windows drive letters.
- The fallback rule: below half found → walk; at or above half → no walk.
- A fake directory handle that counts `getDirectoryHandle` and `getFileHandle`
  calls proves:
  - each shared folder is looked up once;
  - a second `indexFor` with two new locations performs only their lookups;
  - a missing file is a miss, not an exception.
- Timing on the real card, by hand in Chrome: time from Link (and from reload)
  to the coverage line, before and after.

## Part 3: The helper is always there

### Origin

`analyse-audio.py --serve` also accepts the deployed site's origin,
`https://zodiac-tracker.michielrollier.workers.dev`, as one exact string next
to the existing `localhost`/`127.0.0.1` pattern. Look-alike hosts stay refused.
Chrome's local-network-access prompt appears once for the site, and the
browser remembers the answer.

### Launch agent (macOS)

- `--install-agent` writes `~/Library/LaunchAgents/app.zodiac-tracker.helper.plist`
  with `plistlib` and loads it with `launchctl bootstrap gui/<uid>`. The file
  holds:

  | Key | Value |
  |---|---|
  | `ProgramArguments` | this interpreter (`sys.executable`), this script's absolute path, `--serve`, and any other flags given at install (for example `--write-tags`, `--port`) |
  | `WorkingDirectory` | the repo root, because the defaults such as `scripts/models` are relative to it |
  | `RunAtLoad` | true |
  | `KeepAlive` | true |
  | `StandardOutPath`, `StandardErrorPath` | `~/Library/Logs/zodiac-tracker-helper.log` |

- Installing again replaces the agent (bootout, then bootstrap).
- `--uninstall-agent` boots it out and deletes the file.
- Both refuse politely on anything but macOS.
- Idle cost stays small: the models load lazily on the first analysis
  (`_load_models`).
- **Known risk:** a background process needs macOS permission to read a
  removable volume. Expect one prompt. If macOS denies silently instead, the
  README documents the toggle under System Settings → Privacy & Security.

### Auto-connect in the app

- A successful Connect stores `localStorage['vdt-helper'] = '1'`, wrapped in
  try/catch.
- The flag lives in this browser only: it is not in the project or the
  autosave, so a shared project never makes someone else's app contact their
  machine.
- When the Advanced analysis section opens and the flag is set, `connectHelper()`
  runs by itself.
- The app still never contacts localhost at start-up, and never for anyone who
  did not press Connect.
- If the helper does not answer, the section shows the Connect button as
  today. The flag stays set, because the helper may simply not be running yet.

### Tests

- Python (the script's `--self-test`):
  - The plist the installer builds has the interpreter, script path, working
    directory and passed-through flags.
  - The origin check accepts the site, `localhost:5173` and
    `127.0.0.1:4173`.
  - It refuses `https://zodiac-tracker.michielrollier.workers.dev.evil.com`,
    `http://zodiac-tracker.michielrollier.workers.dev` and
    `https://evil.workers.dev`.
- `tests/analysisHelper.test.ts`:
  - A successful connect sets the flag.
  - Opening the section with the flag connects without a click.
  - Without the flag, opening makes no request.
  - A storage that throws does not break Connect.
- By hand: install the agent, log out and in, then use the live site with no
  Terminal open. Start an analysis of a playlist on the SD card.

## Out of scope

- A native desktop app (Tauri or Electron). Revisit only if a need appears that
  the browser cannot meet.
- An ALAC decoder in the app. There are 8 files; converting them once is
  cheaper.
- Streaming AIFF conversion through the service worker (the upgrade path in
  Part 1).
- Caching the folder scan (Part 2 makes the scan the fallback, not the norm).
- Starting the helper on Windows or Linux.
- Reacting to the SD card being plugged in after the app opened (not reported
  as a problem).

## Verification

Every part ends with `npm run check`, `npm run lint`, `npm test`,
`npm run build` and the Playwright probe (`node scripts/screenshot.mjs out/`
against the dev server), plus the helper's `--self-test`.

Checked by hand with Michiel, on the live site installed as an app in Chrome:

1. Link `/Volumes/SD 1TB/Music`, note the time to the coverage line, quit, and
   reopen. There is no Reconnect, and the coverage line returns quickly.
2. Play a 16-bit and a 24-bit AIFF, and seek in each. The coverage line shows
   only the ALAC files as unsupported.
3. With the launch agent installed and no Terminal open, the analysis section
   connects on open and analyses a playlist.
