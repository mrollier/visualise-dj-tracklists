# v42 Local Friction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Chrome, AIFF files play, a linked music folder opens in seconds
instead of being scanned file by file, and the analysis helper runs by itself
and connects from the live site.

**Architecture:**
- **AIFF:** a pure converter (`src/core/audio/aiff.ts`) rewraps plain AIFF as
  WAV in place. `playerStore.materialise` runs it between reading the file and
  loading the deck, but only when the browser cannot play AIFF.
- **Folder:** a pure path resolver (`src/core/audio/folderPaths.ts`) looks each
  library location up inside the granted folder. `fsaSource` uses it, and falls
  back to today's full walk when paths do not fit. `AudioSource.index` becomes
  `indexFor(locations)`.
- **Helper:** the Python helper gains a site origin and a launchd login agent.
  The app remembers a successful Connect in `localStorage` and reconnects when
  the analysis section opens.

**Tech Stack:**
- Svelte 5 + TypeScript + Vite, tests in Vitest (node environment), browser
  probe with Playwright (`scripts/screenshot.mjs`).
- Python 3.14 helper (`scripts/analyse-audio.py`, standard library only for the
  new code: `plistlib`, `subprocess`).

**Spec:** `docs/designs/design-v42-local-friction.md`

## Global Constraints

- Every task ends green on `npm run check`, `npm run lint` and `npm test`.
  - The last task also runs `npm run build` and the probe
    (`node scripts/screenshot.mjs out/` against `npm run dev` on :5173).
  - Python changes also pass
    `scripts/.venv/bin/python scripts/analyse-audio.py --self-test`.
- No new npm or Python dependencies.
- Comments describe what the code does now, in plain sentences, with no version
  tags ("v42") and no history.
- Match surrounding idiom: the `ponytail:` comment marks a deliberate ceiling
  with its upgrade path.
- Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Exact values from the spec:

  | What | Value |
  |---|---|
  | Site origin | `https://zodiac-tracker.michielrollier.workers.dev` |
  | Agent label | `app.zodiac-tracker.helper` |
  | Agent file | `~/Library/LaunchAgents/app.zodiac-tracker.helper.plist` |
  | Agent log | `~/Library/Logs/zodiac-tracker-helper.log` |
  | localStorage key | `vdt-helper` (value `'1'`) |
  | Lookup concurrency | 8 |
  | Walk fallback | fewer than half of the asked locations found |

- **Clarification of the spec (Task 1):** "returns null for a truncated file"
  means a file cut off before its `COMM` or `SSND` header is complete. A file
  whose audio stops early converts the frames that are there, because a
  partial track is still worth hearing.
- **Clarification of the spec (Task 3):** an empty list of locations counts as
  "fewer than half found" and walks. This keeps today's behaviour for a folder
  linked before any library exists, and still notices an unreachable drive.

## Review Focus

These are the input classes and failure modes most likely to bite, each with
its test added to the owning task:

1. **Two library entries that point at the same file** (a duplicate track, or
   two prefixes reaching the same route) must resolve as one file, not as
   "ambiguous".
   → Task 3, "two locations reaching one file stay one entry".
2. **A click on another track while a large AIFF is still being read** must
   abandon the old load.
   → Task 2, "a newer click during an AIFF read wins".
3. **The SD card unplugged when the app opens, with a library loaded,** must
   park the folder behind Reconnect, not show it as linked with everything
   "not found".
   → Task 4, "an unplugged drive at start parks the folder".
4. **A folder whose name appears twice in the path**
   (`/Volumes/Music/Music/x.mp3`) must still find the file.
   → Task 3, "the deepest occurrence is tried first, then shallower ones".
5. **A 24-bit mono AIFF with an odd number of audio bytes** must produce a WAV
   with its pad byte and correct sizes.
   → Task 1, "24-bit mono with an odd data length gets a pad byte".

---

### Task 1: The AIFF → WAV converter

**Files:**
- Create: `src/core/audio/aiff.ts`
- Create: `tests/aiffFixture.ts` (the AIFF byte builder; no vitest imports, so
  the browser probe can import it too)
- Create: `tests/aiff.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `aiffToWav(bytes: ArrayBuffer): Blob | null` (mutates `bytes` in place when
    it succeeds; the Blob's type is `audio/wav`)
  - `aiffBytes(opts: AiffFixture): ArrayBuffer` in `tests/aiffFixture.ts`, with
    ```ts
    interface AiffFixture {
      channels?: number
      bits?: number
      rate?: number
      samples: number[]
      ssndOffset?: number
      extra?: Uint8Array
      form?: string
      frames?: number
    }
    ```
  - `aiffChunk(id: string, body: Uint8Array): Uint8Array` in the same file.

- [ ] **Step 1: Write the fixture builder**

`tests/aiffFixture.ts`:

```ts
/**
 * Builds AIFF files in memory for the converter's tests and the browser probe.
 * Samples are signed integers at the given bit depth, interleaved by channel,
 * written big-endian as AIFF stores them.
 */
export interface AiffFixture {
  channels?: number
  bits?: number
  rate?: number
  samples: number[]
  /** Bytes of padding the SSND chunk declares before the audio starts. */
  ssndOffset?: number
  /** A whole chunk (use `aiffChunk`) placed between COMM and SSND. */
  extra?: Uint8Array
  form?: string
  /** The frame count COMM claims; defaults to the real one. */
  frames?: number
}

const ascii = (text: string) => new TextEncoder().encode(text)

/** An IFF chunk: id, big-endian size, body, and a pad byte after an odd body. */
export function aiffChunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2))
  out.set(ascii(id), 0)
  new DataView(out.buffer).setUint32(4, body.length)
  out.set(body, 8)
  return out
}

/** A sample rate as the 80-bit extended float COMM stores. Integer rates only. */
function extended80(rate: number): Uint8Array {
  const out = new Uint8Array(10)
  const view = new DataView(out.buffer)
  const exponent = Math.floor(Math.log2(rate))
  view.setUint16(0, exponent + 16383)
  view.setBigUint64(2, BigInt(rate) << BigInt(63 - exponent))
  return out
}

export function aiffBytes(opts: AiffFixture): ArrayBuffer {
  const { channels = 2, bits = 16, rate = 44100, samples, ssndOffset = 0, form = 'AIFF' } = opts
  const width = bits / 8
  const comm = new Uint8Array(18)
  const commView = new DataView(comm.buffer)
  commView.setInt16(0, channels)
  commView.setUint32(2, opts.frames ?? samples.length / channels)
  commView.setInt16(6, bits)
  comm.set(extended80(rate), 8)

  const ssnd = new Uint8Array(8 + ssndOffset + samples.length * width)
  new DataView(ssnd.buffer).setUint32(0, ssndOffset)
  samples.forEach((sample, i) => {
    for (let b = 0; b < width; b += 1) {
      ssnd[8 + ssndOffset + i * width + b] = (sample >> (8 * (width - 1 - b))) & 0xff
    }
  })

  const chunks = [aiffChunk('COMM', comm), ...(opts.extra ? [opts.extra] : []), aiffChunk('SSND', ssnd)]
  const formSize = 4 + chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(8 + formSize)
  out.set(ascii('FORM'), 0)
  new DataView(out.buffer).setUint32(4, formSize)
  out.set(ascii(form), 8)
  let at = 12
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out.buffer
}
```

- [ ] **Step 2: Write the failing tests**

`tests/aiff.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import { aiffToWav } from '../src/core/audio/aiff'
import { aiffBytes, aiffChunk } from './aiffFixture'

async function wavOf(blob: Blob | null) {
  expect(blob).not.toBeNull()
  const bytes = await blob!.arrayBuffer()
  const view = new DataView(bytes)
  const text = (at: number) => String.fromCharCode(...new Uint8Array(bytes, at, 4))
  return { blob: blob!, bytes, view, text }
}

/** A little-endian signed 24-bit sample. */
const int24 = (view: DataView, at: number) =>
  ((view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16)) << 8) >> 8

describe('aiffToWav', () => {
  test('16-bit stereo becomes PCM WAV with the same samples, little-endian', async () => {
    const samples = [1, -1, 32767, -32768, 258, -258]
    const { blob, view, text } = await wavOf(aiffToWav(aiffBytes({ samples })))
    expect(blob.type).toBe('audio/wav')
    expect(text(0)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 12)
    expect(text(8)).toBe('WAVE')
    expect(text(12)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(28, true)).toBe(44100 * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(text(36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(12)
    expect(samples.map((_, i) => view.getInt16(44 + i * 2, true))).toEqual(samples)
  })

  test('24-bit mono with an odd data length gets a pad byte', async () => {
    const samples = [1, -1, 8388607]
    const { bytes, view } = await wavOf(
      aiffToWav(aiffBytes({ channels: 1, bits: 24, rate: 48000, samples })),
    )
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(32, true)).toBe(3)
    expect(view.getUint16(34, true)).toBe(24)
    expect(view.getUint32(40, true)).toBe(9)
    expect(view.getUint32(4, true)).toBe(36 + 9 + 1)
    expect(bytes.byteLength).toBe(44 + 10)
    expect([0, 1, 2].map((i) => int24(view, 44 + i * 3))).toEqual(samples)
  })

  test('reads the 80-bit sample rate for 44.1, 48 and 96 kHz', async () => {
    for (const rate of [44100, 48000, 96000]) {
      const { view } = await wavOf(aiffToWav(aiffBytes({ rate, samples: [0, 0] })))
      expect(view.getUint32(24, true)).toBe(rate)
    }
  })

  test('skips other chunks, including an odd-sized one, to find SSND', async () => {
    const extra = aiffChunk('NAME', new TextEncoder().encode('abc'))
    const { view } = await wavOf(aiffToWav(aiffBytes({ samples: [5, 6], extra })))
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([5, 6])
  })

  test('honours the SSND offset before the audio', async () => {
    const { view } = await wavOf(aiffToWav(aiffBytes({ samples: [7, 8], ssndOffset: 4 })))
    expect(view.getUint32(40, true)).toBe(4)
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([7, 8])
  })

  test('audio that stops early converts the frames that are there', async () => {
    const { view } = await wavOf(aiffToWav(aiffBytes({ samples: [1, 2, 3, 4], frames: 10 })))
    expect(view.getUint32(40, true)).toBe(8)
  })

  test('refuses what it cannot convert', () => {
    expect(aiffToWav(aiffBytes({ samples: [0, 0], form: 'AIFC' }))).toBeNull()
    expect(aiffToWav(aiffBytes({ samples: [0, 0], bits: 8 }))).toBeNull()
    expect(aiffToWav(new TextEncoder().encode('RIFF....WAVEfmt ').buffer)).toBeNull()
    expect(aiffToWav(aiffBytes({ samples: [0, 0] }).slice(0, 20))).toBeNull()
    const commOnly = aiffBytes({ samples: [] }).slice(0, 12 + 8 + 18)
    expect(aiffToWav(commOnly)).toBeNull()
  })
})
```

- [ ] **Step 3: Run the tests and check they fail**

Run: `npx vitest run tests/aiff.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/audio/aiff"`.

- [ ] **Step 4: Write the converter**

`src/core/audio/aiff.ts`:

```ts
/**
 * AIFF → WAV, for browsers that ship no AIFF decoder (Chrome, Firefox).
 *
 * Plain AIFF and WAV hold the same uncompressed PCM; AIFF stores each sample
 * big-endian and WAV little-endian. So the conversion is a new 44-byte header
 * plus a byte swap per sample, done in place on the bytes read from disk: the
 * audio is never copied. Compressed AIFF-C and bit depths other than 16 and
 * 24 are refused (null), and the caller hands the file on untouched.
 */

const ascii = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  )

/** COMM's sample rate: an 80-bit IEEE extended float, big-endian. */
function extended80(view: DataView, at: number): number {
  const exponent = view.getUint16(at) & 0x7fff
  const mantissa = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6)
  return Math.round(mantissa * 2 ** (exponent - 16383 - 63))
}

function wavHeader(channels: number, rate: number, bits: number, dataLength: number): ArrayBuffer {
  const header = new DataView(new ArrayBuffer(44))
  const blockAlign = (channels * bits) / 8
  const write = (at: number, text: string) => {
    for (let i = 0; i < 4; i += 1) header.setUint8(at + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  // An odd data chunk is followed by a pad byte, which the RIFF size counts.
  header.setUint32(4, 36 + dataLength + (dataLength % 2), true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, channels, true)
  header.setUint32(24, rate, true)
  header.setUint32(28, rate * blockAlign, true)
  header.setUint16(32, blockAlign, true)
  header.setUint16(34, bits, true)
  write(36, 'data')
  header.setUint32(40, dataLength, true)
  return header.buffer
}

/** Reverse each sample's bytes: 16-bit swaps a pair, 24-bit swaps the outer two. */
function swapBytes(audio: Uint8Array, width: number): void {
  for (let i = 0; i + width <= audio.length; i += width) {
    const first = audio[i]
    audio[i] = audio[i + width - 1]
    audio[i + width - 1] = first
  }
}

export function aiffToWav(bytes: ArrayBuffer): Blob | null {
  const view = new DataView(bytes)
  if (bytes.byteLength < 12 || ascii(view, 0) !== 'FORM' || ascii(view, 8) !== 'AIFF') return null
  let channels = 0
  let frames = 0
  let bits = 0
  let rate = 0
  let dataStart = -1
  let dataLength = 0
  for (let at = 12; at + 8 <= bytes.byteLength; ) {
    const id = ascii(view, at)
    const size = view.getUint32(at + 4)
    const body = at + 8
    if (id === 'COMM' && body + 18 <= bytes.byteLength) {
      channels = view.getInt16(body)
      frames = view.getUint32(body + 2)
      bits = view.getInt16(body + 6)
      rate = extended80(view, body + 8)
    } else if (id === 'SSND' && body + 8 <= bytes.byteLength) {
      const offset = view.getUint32(body)
      dataStart = body + 8 + offset
      dataLength = size - 8 - offset
    }
    at = body + size + (size % 2)
  }
  if (channels < 1 || (bits !== 16 && bits !== 24) || rate <= 0 || dataStart < 0) return null
  const width = bits / 8
  const blockAlign = channels * width
  // The frame count, the chunk's size and the file's real end all bound the
  // audio; a file cut short plays what it has.
  const available = Math.min(frames * blockAlign, dataLength, bytes.byteLength - dataStart)
  const length = available - (available % blockAlign)
  if (length <= 0) return null
  const audio = new Uint8Array(bytes, dataStart, length)
  swapBytes(audio, width)
  const parts: BlobPart[] = [wavHeader(channels, rate, bits, length), audio]
  if (length % 2 === 1) parts.push(new Uint8Array(1))
  return new Blob(parts, { type: 'audio/wav' })
}
```

- [ ] **Step 5: Run the tests and check they pass**

Run: `npx vitest run tests/aiff.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Lint, type-check, commit**

Run: `npm run check && npm run lint`
Expected: 0 errors; lint clean. If Prettier complains, run `npx prettier --write` on
the three files and re-run.

```bash
git add src/core/audio/aiff.ts tests/aiff.test.ts tests/aiffFixture.ts
git commit -m "feat: convert plain AIFF to WAV for browsers without an AIFF decoder

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The player plays AIFF through the converter

**Files:**
- Modify: `src/lib/audio/playerStore.ts`
  - imports at the top
  - module state near `busy` (around line 50)
  - `materialise` (around line 168)
  - `startPlayer` (around line 320)
- Modify: `src/lib/audio/engine.ts:176` (`loadDeck` takes a `Blob`)
- Modify: `src/core/audio/formats.ts` (the `AIFF_NOTE` and `m4a` note)
- Modify: `README.md` (the "Check it by ear" paragraph, around line 285)
- Modify: `scripts/screenshot.mjs` (a new block before the final
  `console.log('CONSOLE ERRORS…`)
- Test: `tests/playerStore.test.ts` (a new `describe` at the end)

**Interfaces:**
- Consumes:
  - `aiffToWav(bytes: ArrayBuffer): Blob | null` from Task 1
  - `aiffBytes` from `tests/aiffFixture.ts`
- Produces: `engine.loadDeck(deck: DeckId, file: Blob): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/playerStore.test.ts`, and add `import { aiffBytes } from './aiffFixture'`
to its imports:

```ts
describe('AIFF on a browser without an AIFF decoder', () => {
  const stubAudio = (aiff: string) =>
    vi.stubGlobal(
      'Audio',
      class {
        canPlayType(mime: string) {
          return mime.includes('aiff') ? aiff : ''
        }
      },
    )

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    sourceMock.resolutionFor.mockReturnValue({ kind: 'playable', handle: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('an AIFF is rewrapped as WAV before it reaches the deck', async () => {
    stubAudio('')
    const file = new File([aiffBytes({ samples: [1, 2, 3, 4] })], 'Track.aiff')
    sourceMock.state.fileFor.mockReturnValue(Promise.resolve(file))
    const { stores } = await freshPlayer()

    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200)

    const loaded = (engineMock.loadDeck.mock.calls as unknown as [string, Blob][])[0][1]
    expect(loaded.type).toBe('audio/wav')
    expect(loaded.size).toBe(44 + 8)
  })

  test('a browser that plays AIFF gets the file untouched', async () => {
    stubAudio('maybe')
    const file = new File([aiffBytes({ samples: [1, 2] })], 'Track.aiff')
    sourceMock.state.fileFor.mockReturnValue(Promise.resolve(file))
    const { stores } = await freshPlayer()

    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200)

    expect((engineMock.loadDeck.mock.calls as unknown as [string, Blob][])[0][1]).toBe(file)
  })

  test('an AIFF the converter refuses goes to the deck as it is', async () => {
    stubAudio('')
    const file = new File([aiffBytes({ samples: [1, 2], form: 'AIFC' })], 'Track.aif')
    sourceMock.state.fileFor.mockReturnValue(Promise.resolve(file))
    const { stores } = await freshPlayer()

    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200)

    expect((engineMock.loadDeck.mock.calls as unknown as [string, Blob][])[0][1]).toBe(file)
  })

  test('a newer click during an AIFF read wins', async () => {
    stubAudio('')
    let release: (bytes: ArrayBuffer) => void = () => {}
    const slow = {
      name: 'Big.aiff',
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => (release = resolve)),
    }
    sourceMock.state.fileFor.mockReturnValueOnce(Promise.resolve(slow))
    sourceMock.state.fileFor.mockReturnValue(new Promise(() => {}))
    const { stores } = await freshPlayer()

    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200)
    stores.clickedTrackId.set('t2')
    release(aiffBytes({ samples: [1, 2] }))
    await vi.advanceTimersByTimeAsync(0)

    expect(engineMock.loadDeck).not.toHaveBeenCalled()
  })

  test('the coverage probe counts AIFF as playable', async () => {
    stubAudio('')
    await freshPlayer()
    const probe = (sourceMock.setProbe.mock.calls as unknown as [(mime: string) => boolean][])[0][0]
    expect(probe('audio/aiff')).toBe(true)
    expect(probe('audio/x-aiff')).toBe(true)
    expect(probe('audio/flac')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/playerStore.test.ts`
Expected: FAIL.
- "rewrapped" sees the original File, whose type is not `audio/wav`.
- "coverage probe" gets `false` for `audio/aiff`.
- "untouched", "refuses" and "newer click" may already pass; that is fine, since
  they pin behaviour the change must keep.

- [ ] **Step 3: Implement**

In `src/lib/audio/playerStore.ts`, add the import after the other `../../core/audio` imports:

```ts
import { aiffToWav } from '../../core/audio/aiff'
```

Add after the `busy` declaration:

```ts
/**
 * Chrome and Firefox cannot decode AIFF, so for them an AIFF is rewrapped as
 * WAV while it loads (same audio, other byte order). Safari plays it as it is.
 */
let rewrapAiff = false

/** The file in a form the element can play. */
async function playableForm(file: File): Promise<Blob> {
  if (!rewrapAiff || !/\.aiff?$/i.test(file.name)) return file
  // ponytail: reads the whole file first (about 0.6 s for a typical AIFF on an
  // SD card); streaming through the service worker is the upgrade if that wait
  // bothers.
  return aiffToWav(await file.arrayBuffer()) ?? file
}
```

In `materialise`, replace:

```ts
    const file = await source.fileFor(resolution.handle)
    // A newer click won while this one was reading the disk.
    if (wanted[deck] !== trackId) return false
    // Awaited: loadDeck fades a sounding deck down before it swaps `src`, so
    // the bytes are not in the element the instant the call returns.
    await engine.loadDeck(deck, file)
```

with:

```ts
    const file = await source.fileFor(resolution.handle)
    // A newer click won while this one was reading the disk.
    if (wanted[deck] !== trackId) return false
    const playable = await playableForm(file)
    if (wanted[deck] !== trackId) return false
    // Awaited: loadDeck fades a sounding deck down before it swaps `src`, so
    // the bytes are not in the element the instant the call returns.
    await engine.loadDeck(deck, playable)
```

In `startPlayer`, replace:

```ts
  const scratch = new Audio()
  setProbe((mime) => scratch.canPlayType(mime) !== '')
```

with:

```ts
  const scratch = new Audio()
  rewrapAiff = scratch.canPlayType('audio/aiff') === ''
  // An AIFF plays either way: natively, or rewrapped by playableForm.
  setProbe((mime) => mime.includes('aiff') || scratch.canPlayType(mime) !== '')
```

In `src/lib/audio/engine.ts`, change the signature
`export function loadDeck(deck: DeckId, file: File): Promise<void> {` to
`export function loadDeck(deck: DeckId, file: Blob): Promise<void> {`.

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/playerStore.test.ts tests/engine.test.ts`
Expected: PASS, all tests, including the 5 new ones.

- [ ] **Step 5: Update the notes a person reads**

In `src/core/audio/formats.ts`, replace the `AIFF_NOTE` constant with:

```ts
const AIFF_NOTE =
  'Plain AIFF plays in every browser here — where the browser has no AIFF decoder, ' +
  'the app rewraps it as WAV while it loads. This one uses a variant it cannot rewrap, ' +
  'most likely compressed AIFF-C: convert it with Rekordbox’s Convert File Format to AIFF.'
```

and the `m4a` entry with:

```ts
  m4a:
    'An .m4a holds either AAC, which every browser plays, or ALAC (Apple Lossless), ' +
    'which only Safari decodes — the extension is the same either way. ' +
    'An .m4a that will not play is almost certainly ALAC: convert it once with ' +
    'Rekordbox’s Convert File Format to AIFF, which keeps its cue points and plays everywhere.',
```

In `README.md`, in the "Check it by ear" bullet, replace the sentence

```
It then reports what it
  found — _2043 of 2080 playable · 31 unsupported format · 6 not found_ — and any
  track it can't play says why rather than failing silently.
```

with

```
It then reports what it
  found — _2072 of 2080 playable · 8 unsupported format_ — and any
  track it can't play says why rather than failing silently. AIFF plays in every
  browser: where there is no AIFF decoder (Chrome, Firefox) the app rewraps the file
  as WAV while it loads, which for a large file takes about a second.
```

Run: `npx vitest run tests/audio-formats.test.ts tests/audio-coverage.test.ts`
Expected: PASS (these pin verdicts, not note text).

- [ ] **Step 6: Add the browser probe**

In `scripts/screenshot.mjs`, insert before
`console.log('CONSOLE ERRORS:', errors.length ? errors : 'none')`:

```js
// AIFF: Chromium ships no AIFF decoder, so the app rewraps AIFF as WAV. A
// 24-bit stereo file, one second long, must load in a real <audio> element
// with its full duration: the proof that Chrome takes the 24-bit WAV.
{
  const result = await page.evaluate(async () => {
    const { aiffToWav } = await import('/src/core/audio/aiff.ts')
    const { aiffBytes } = await import('/tests/aiffFixture.ts')
    const samples = Array.from({ length: 48000 * 2 }, (_, i) =>
      Math.round(Math.sin(i / 20) * 1_000_000),
    )
    const blob = aiffToWav(aiffBytes({ bits: 24, rate: 48000, samples }))
    if (blob === null) return 'the converter refused'
    const audio = new Audio()
    audio.src = URL.createObjectURL(blob)
    return await new Promise((resolve) => {
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => resolve(`media error ${audio.error?.code}`)
    })
  })
  if (typeof result !== 'number' || Math.abs(result - 1) > 0.01)
    errors.push(`A 24-bit AIFF rewrapped as WAV should load with a 1 s duration — got ${result}`)
}
```

Run (dev server on :5173 in another shell, `npm run dev`):
`node scripts/screenshot.mjs out/`
Expected: exit code 0, `CONSOLE ERRORS: none`.

- [ ] **Step 7: Gate and commit**

Run: `npm run check && npm run lint && npm test`
Expected: 0 errors, lint clean, all tests pass.

```bash
git add src/lib/audio/playerStore.ts src/lib/audio/engine.ts src/core/audio/formats.ts README.md scripts/screenshot.mjs tests/playerStore.test.ts
git commit -m "feat: play AIFF in Chrome and Firefox by rewrapping it as WAV on load

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The path resolver

**Files:**
- Create: `src/core/audio/folderPaths.ts`
- Create: `tests/folderPaths.test.ts`

**Interfaces:**
- Consumes:
  - `foldSegment`, `locationSegments` from `src/core/location.ts`
  - `buildFileIndex`, `FileIndex`, `matchLocation` from
    `src/core/audio/pathMatch.ts`
- Produces:
  ```ts
  function routesUnder(rootName: string, location: string): string[][]
  interface Directory<F> {
    getDirectoryHandle(name: string): Promise<Directory<F>>
    getFileHandle(name: string): Promise<F>
  }
  function shouldWalk(found: number, asked: number): boolean
  interface PathLookup<F> { index: FileIndex<F>; found: number }
  function createPathResolver<F>(root: Directory<F>, rootName: string, concurrency?: number): {
    lookUp(
      locations: readonly string[],
      onProgress?: (done: number, total: number) => void,
    ): Promise<PathLookup<F>>
  }
  ```

- [ ] **Step 1: Write the failing tests**

`tests/folderPaths.test.ts`:

```ts
import { describe, expect, test } from 'vitest'
import {
  createPathResolver,
  type Directory,
  routesUnder,
  shouldWalk,
} from '../src/core/audio/folderPaths'
import { matchLocation } from '../src/core/audio/pathMatch'

/**
 * A granted folder holding `files` (paths relative to it). File handles are the
 * relative paths themselves, so a hit is easy to read. Every lookup is recorded.
 */
function fakeFolder(files: string[]) {
  const dirCalls: string[] = []
  const fileCalls: string[] = []
  const folder = (prefix: string): Directory<string> => ({
    getDirectoryHandle(name) {
      const path = `${prefix}${name}/`
      dirCalls.push(path)
      return files.some((f) => f.startsWith(path))
        ? Promise.resolve(folder(path))
        : Promise.reject(new DOMException('missing', 'NotFoundError'))
    },
    getFileHandle(name) {
      const path = `${prefix}${name}`
      fileCalls.push(path)
      return files.includes(path)
        ? Promise.resolve(path)
        : Promise.reject(new DOMException('missing', 'NotFoundError'))
    },
  })
  return { root: folder(''), dirCalls, fileCalls }
}

const loc = (path: string) => `file://localhost${encodeURI(path)}`

describe('routesUnder', () => {
  test('the route after the granted folder name', () => {
    expect(routesUnder('Music', loc('/Volumes/SD 1TB/Music/House/x.mp3'))).toEqual([
      ['House', 'x.mp3'],
    ])
  })

  test('every occurrence, deepest first', () => {
    expect(routesUnder('Music', loc('/Volumes/Music/Music/x.mp3'))).toEqual([
      ['x.mp3'],
      ['Music', 'x.mp3'],
    ])
  })

  test('no route when the name is absent, or only names the file', () => {
    expect(routesUnder('Music', loc('/Users/dj/Tunes/x.mp3'))).toEqual([])
    expect(routesUnder('Music', loc('/Users/dj/Music'))).toEqual([])
  })

  test('the folder name compares case- and accent-form-insensitively', () => {
    const nfd = 'Électro'.normalize('NFD')
    expect(routesUnder(nfd, loc('/Volumes/SD/électro/x.mp3'))).toEqual([['x.mp3']])
  })

  test('a Windows drive location', () => {
    expect(routesUnder('Music', 'file://localhost/C:/Users/dj/Music/x.mp3')).toEqual([['x.mp3']])
  })
})

describe('shouldWalk', () => {
  test('walks when fewer than half were found, or nothing was asked', () => {
    expect(shouldWalk(0, 0)).toBe(true)
    expect(shouldWalk(0, 10)).toBe(true)
    expect(shouldWalk(4, 10)).toBe(true)
    expect(shouldWalk(5, 10)).toBe(false)
    expect(shouldWalk(10, 10)).toBe(false)
  })
})

describe('createPathResolver', () => {
  const library = [
    loc('/Volumes/SD 1TB/Music/House/a.mp3'),
    loc('/Volumes/SD 1TB/Music/House/b.mp3'),
    loc('/Volumes/SD 1TB/Music/House/c.mp3'),
  ]

  test('finds each track along its path and builds a matching index', async () => {
    const { root } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3'])
    const { index, found } = await createPathResolver(root, 'Music').lookUp(library)
    expect(found).toBe(3)
    const hit = matchLocation(index, library[1])
    expect(hit.kind === 'hit' ? hit.entry.handle : hit.kind).toBe('House/b.mp3')
  })

  test('a folder shared by many tracks is looked up once', async () => {
    const { root, dirCalls } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3'])
    await createPathResolver(root, 'Music').lookUp(library)
    expect(dirCalls.filter((p) => p === 'House/')).toHaveLength(1)
  })

  test('a later call looks up only locations it has not tried', async () => {
    const { root, fileCalls } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3', 'd.mp3'])
    const resolver = createPathResolver(root, 'Music')
    await resolver.lookUp(library)
    const before = fileCalls.length
    const more = [...library, loc('/Volumes/SD 1TB/Music/d.mp3')]
    const { found, index } = await resolver.lookUp(more)
    expect(fileCalls.length - before).toBe(1)
    expect(found).toBe(4)
    expect(index.size).toBe(4)
  })

  test('a missing file is a miss, not an error', async () => {
    const { root } = fakeFolder(['House/a.mp3'])
    const { found, index } = await createPathResolver(root, 'Music').lookUp(library)
    expect(found).toBe(1)
    expect(matchLocation(index, library[2]).kind).toBe('miss')
  })

  test('the deepest occurrence is tried first, then shallower ones', async () => {
    const { root } = fakeFolder(['Music/x.mp3'])
    const { found } = await createPathResolver(root, 'Music').lookUp([
      loc('/Volumes/Music/Music/x.mp3'),
    ])
    expect(found).toBe(1)
  })

  test('two locations reaching one file stay one entry', async () => {
    const { root } = fakeFolder(['x.mp3'])
    const twins = [loc('/Users/dj/Music/x.mp3'), loc('/Volumes/SD/Music/x.mp3')]
    const { index, found } = await createPathResolver(root, 'Music').lookUp(twins)
    expect(found).toBe(2)
    expect(index.size).toBe(1)
    expect(twins.map((l) => matchLocation(index, l).kind)).toEqual(['hit', 'hit'])
  })

  test('reports progress and finishes at the total', async () => {
    const { root } = fakeFolder(['House/a.mp3', 'House/b.mp3', 'House/c.mp3'])
    const seen: [number, number][] = []
    await createPathResolver(root, 'Music').lookUp(library, (done, total) =>
      seen.push([done, total]),
    )
    expect(seen.at(-1)).toEqual([3, 3])
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/folderPaths.test.ts`
Expected: FAIL — `Failed to resolve import "../src/core/audio/folderPaths"`.

- [ ] **Step 3: Write the resolver**

`src/core/audio/folderPaths.ts`:

```ts
import { foldSegment, locationSegments } from '../location'
import { buildFileIndex, type FileIndex } from './pathMatch'

/**
 * Finding a library's files inside a granted folder by following their paths.
 *
 * A granted folder exposes only its name, but a Rekordbox location usually
 * runs through it: `/Volumes/SD 1TB/Music/House/x.aiff` under a folder named
 * `Music` is `House/x.aiff` inside it. Following that route costs a few small
 * lookups per track, where walking the folder reads every file on the drive —
 * 60,000 of them for one real library, to find 2,000.
 */

/** The routes inside a folder called `rootName` for one location, deepest occurrence first. */
export function routesUnder(rootName: string, location: string): string[][] {
  const segments = locationSegments(location)
  const root = foldSegment(rootName)
  const routes: string[][] = []
  // The last segment is the file itself, never the folder.
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (foldSegment(segments[i]) === root) routes.push(segments.slice(i + 1))
  }
  return routes
}

/** The part of a File System Access directory handle the resolver uses. */
export interface Directory<F> {
  getDirectoryHandle(name: string): Promise<Directory<F>>
  getFileHandle(name: string): Promise<F>
}

/**
 * Whether to fall back to walking the whole folder: when fewer than half the
 * locations were found, the paths do not run through this folder (the library
 * moved machines, or the folder was renamed). With nothing to look up, the
 * walk is also what tells a reachable folder from an unplugged drive.
 */
export function shouldWalk(found: number, asked: number): boolean {
  return asked === 0 || found * 2 < asked
}

export interface PathLookup<F> {
  /** Everything found so far, as the index the matcher reads. */
  index: FileIndex<F>
  /** How many of the locations just asked about were found. */
  found: number
}

export function createPathResolver<F>(root: Directory<F>, rootName: string, concurrency = 8) {
  const folders = new Map<string, Promise<Directory<F> | null>>()
  /** Location → the route key it resolved to, or null for a miss. */
  const tried = new Map<string, string | null>()
  /** Route key → file; keyed by route so two locations reaching one file stay one entry. */
  const files = new Map<string, { path: string[]; handle: F }>()

  function folder(route: readonly string[]): Promise<Directory<F> | null> {
    if (route.length === 0) return Promise.resolve(root)
    const key = route.join('/')
    let found = folders.get(key)
    if (found === undefined) {
      found = folder(route.slice(0, -1)).then((parent) =>
        parent === null
          ? null
          : parent.getDirectoryHandle(route[route.length - 1]).catch(() => null),
      )
      folders.set(key, found)
    }
    return found
  }

  async function resolve(location: string): Promise<string | null> {
    for (const route of routesUnder(rootName, location)) {
      const key = route.join('/')
      if (files.has(key)) return key
      const parent = await folder(route.slice(0, -1))
      if (parent === null) continue
      try {
        files.set(key, { path: route, handle: await parent.getFileHandle(route[route.length - 1]) })
        return key
      } catch {
        // Not at this depth; a shallower occurrence of the folder name may hold it.
      }
    }
    return null
  }

  async function lookUp(
    locations: readonly string[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<PathLookup<F>> {
    const fresh = [...new Set(locations)].filter((location) => !tried.has(location))
    let next = 0
    let done = 0
    const worker = async () => {
      while (next < fresh.length) {
        const location = fresh[next]
        next += 1
        tried.set(location, await resolve(location))
        done += 1
        if (done % 100 === 0) onProgress?.(done, fresh.length)
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, fresh.length) }, worker))
    if (fresh.length > 0) onProgress?.(fresh.length, fresh.length)
    const found = locations.filter((location) => (tried.get(location) ?? null) !== null).length
    return { index: buildFileIndex(files.values()), found }
  }

  return { lookUp }
}
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/folderPaths.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Lint, type-check, commit**

Run: `npm run check && npm run lint`
Expected: 0 errors, lint clean.

```bash
git add src/core/audio/folderPaths.ts tests/folderPaths.test.ts
git commit -m "feat: find a library's files in a granted folder by their paths

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The folder source resolves by path

**Files:**
- Modify: `src/lib/audio/source.ts` (`IndexProgress` moves here; `index` becomes `indexFor`)
- Modify: `src/lib/audio/fsaSource.ts` (the walk becomes `walkIndex`;
  `openFsaSource` takes the locations)
- Modify: `src/lib/audio/pickerSource.ts:53-59` (the returned object)
- Modify: `src/lib/audio/sourceStore.ts`
  - the `IndexPhase`/`IndexProgress` declarations (lines 27–41)
  - `reindex` (around lines 93–118)
  - `linkFolder`, `reconnect`, `restoreSavedFolder`, `reportScan`
- Modify: `src/lib/FolderLinkControl.svelte:98-107` (`scanText`)
- Test: `tests/sourceStore.test.ts` (a new `describe`)

**Interfaces:**
- Consumes: `createPathResolver`, `shouldWalk` from Task 3.
- Produces:
  ```ts
  // source.ts
  export type IndexPhase = 'finding' | 'scanning' | 'matching'
  export interface IndexProgress { phase: IndexPhase; done: number; total: number | null }
  interface AudioSource {
    readonly kind: 'fsa' | 'picker'
    readonly rootName: string
    indexFor(
      locations: readonly string[],
      onProgress?: (progress: IndexProgress) => void,
    ): Promise<FileIndex<AudioHandle>>
    fileFor(handle: AudioHandle): Promise<File>
    ensurePermission(): Promise<boolean>
  }
  // fsaSource.ts
  export async function openFsaSource(
    handle: FileSystemDirectoryHandle,
    locations: readonly string[],
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<AudioSource>
  ```
  `sourceStore.ts` keeps exporting `IndexPhase` and `IndexProgress` (re-exported
  from `source.ts`).

- [ ] **Step 1: Write the failing tests**

Append to `tests/sourceStore.test.ts`:

```ts
/**
 * A granted folder that answers path lookups (getDirectoryHandle /
 * getFileHandle) as well as a walk (entries), recording both.
 */
function pathHandle(opts: { name: string; files: string[]; unreachable?: boolean }) {
  const events: string[] = []
  const folder = (prefix: string): unknown => ({
    name: prefix === '' ? opts.name : prefix.split('/').at(-2),
    kind: 'directory',
    queryPermission: () => Promise.resolve('granted'),
    requestPermission: () => Promise.resolve('granted'),
    getDirectoryHandle(name: string) {
      const path = `${prefix}${name}/`
      events.push(`dir ${path}`)
      return !opts.unreachable && opts.files.some((f) => f.startsWith(path))
        ? Promise.resolve(folder(path))
        : Promise.reject(new DOMException('missing', 'NotFoundError'))
    },
    getFileHandle(name: string) {
      const path = `${prefix}${name}`
      events.push(`file ${path}`)
      return !opts.unreachable && opts.files.includes(path)
        ? Promise.resolve({ kind: 'file', name, path })
        : Promise.reject(new DOMException('missing', 'NotFoundError'))
    },
    entries() {
      events.push('iterate')
      function* iterate(): Generator<[string, { kind: 'file'; name: string }]> {
        if (opts.unreachable === true) throw new DOMException('gone', 'NotFoundError')
        for (const path of opts.files) {
          const name = path.split('/').at(-1)!
          yield [name, { kind: 'file', name }]
        }
      }
      return iterate()
    },
  })
  return { handle: folder('') as FileSystemDirectoryHandle, events }
}

describe('the folder resolves the library by path', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  const at = (path: string) => `file://localhost${encodeURI(path)}`

  async function withLibrary(locations: string[]) {
    const stores = await import('../src/stores')
    const { track } = await import('./helpers')
    stores.library.set(locations.map((location, i) => track({ id: `t${i}`, location })))
    return stores
  }

  test('a restored folder finds its tracks without walking', async () => {
    const { handle, events } = pathHandle({ name: 'Music', files: ['House/a.mp3', 'House/b.mp3'] })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    await withLibrary([at('/Volumes/SD 1TB/Music/House/a.mp3'), at('/Volumes/SD 1TB/Music/House/b.mp3')])
    const store = await freshStore()
    store.setProbe(() => true)

    await store.restoreSavedFolder()

    expect(events).not.toContain('iterate')
    expect(get(store.sourceState)).toBe('ready')
    expect(get(store.coverage)?.playable).toBe(2)
  })

  test('a library whose paths miss the folder falls back to the walk', async () => {
    const { handle, events } = pathHandle({ name: 'Music', files: ['a.mp3'] })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    await withLibrary([at('/Users/dj/Tunes/a.mp3')])
    const store = await freshStore()
    store.setProbe(() => true)

    await store.restoreSavedFolder()

    expect(events).toContain('iterate')
    expect(get(store.coverage)?.playable).toBe(1)
  })

  test('an unplugged drive at start parks the folder', async () => {
    const { handle } = pathHandle({ name: 'Music', files: ['House/a.mp3'], unreachable: true })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    await withLibrary([at('/Volumes/SD 1TB/Music/House/a.mp3')])
    const store = await freshStore()

    await store.restoreSavedFolder()

    expect(get(store.sourceState)).toBe('needs-permission')
    expect(handleStore.forgetRootHandle).not.toHaveBeenCalled()
  })

  test('a re-import looks up only the new tracks', async () => {
    const { handle, events } = pathHandle({ name: 'Music', files: ['House/a.mp3', 'House/b.mp3'] })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const stores = await withLibrary([at('/Volumes/SD 1TB/Music/House/a.mp3')])
    const store = await freshStore()
    store.setProbe(() => true)
    await store.restoreSavedFolder()
    const before = events.filter((e) => e.startsWith('file ')).length

    const { track } = await import('./helpers')
    stores.library.set([
      track({ id: 't0', location: at('/Volumes/SD 1TB/Music/House/a.mp3') }),
      track({ id: 't1', location: at('/Volumes/SD 1TB/Music/House/b.mp3') }),
    ])
    await store.reindex()

    expect(events.filter((e) => e.startsWith('file ')).length - before).toBe(1)
    expect(get(store.coverage)?.playable).toBe(2)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/sourceStore.test.ts`
Expected: FAIL.
- "without walking" sees `iterate` in the events.
- "re-import" makes more than 1 new `file` lookup, or none, because the old
  code walks instead.
- The other two may pass already; that is fine.

- [ ] **Step 3: Change the source interface**

`src/lib/audio/source.ts` already imports `FileIndex`. Add the progress types below
the `AudioHandle` type, and replace `index` in `AudioSource`:

```ts
/**
 * What a link is doing right now, so no phase runs in silence. `finding`
 * follows the library's paths into the folder; `scanning` walks the whole
 * folder when those paths do not fit it; `matching` pairs the library with
 * what was found.
 *
 * `total` is null when it cannot be known — a walk discovers the tree as it
 * goes, so the bar is honestly indeterminate there.
 */
export type IndexPhase = 'finding' | 'scanning' | 'matching'
export interface IndexProgress {
  phase: IndexPhase
  done: number
  total: number | null
}
```

In the `AudioSource` interface, replace `readonly index: FileIndex<AudioHandle>` with:

```ts
  /**
   * The files the given library locations resolve to. The Chromium source
   * looks up locations it has not seen before; the others return the index
   * they built when they opened.
   */
  indexFor(
    locations: readonly string[],
    onProgress?: (progress: IndexProgress) => void,
  ): Promise<FileIndex<AudioHandle>>
```

Replace the comment above `MAX_INDEXED_FILES` with:

```ts
/**
 * The cap on a whole-folder index. The picker has no choice but to enumerate
 * — the browser hands over a flat File[] — and the Chromium source walks only
 * when the library's own paths do not run through the granted folder.
 */
```

- [ ] **Step 4: Rebuild `fsaSource.ts` around the resolver**

In `src/lib/audio/fsaSource.ts`, replace the two import lines for `pathMatch` and
`./source` with these three (the `formats` import stays):

```ts
import { createPathResolver, shouldWalk } from '../../core/audio/folderPaths'
import { buildFileIndex, type FileIndex } from '../../core/audio/pathMatch'
import { type AudioHandle, type AudioSource, type IndexProgress, MAX_INDEXED_FILES } from './source'
```

Replace the whole `openFsaSource` function (its doc comment included) with:

```ts
/**
 * Walk the granted folder once and index what we find. Filtering by extension
 * during the walk matters: a Rekordbox folder is mostly .asd sidecars and
 * artwork. We never call getFile() here — on this backend that is an IPC
 * round-trip per file, and nothing about indexing needs the bytes.
 */
async function walkIndex(
  handle: FileSystemDirectoryHandle,
  onProgress?: (indexed: number) => void,
): Promise<FileIndex<AudioHandle>> {
  const entries: { path: string[]; handle: AudioHandle }[] = []
  for await (const entry of walk(handle, [])) {
    entries.push(entry)
    if (entries.length % 500 === 0) {
      onProgress?.(entries.length)
      // Let the browser paint the running count.
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (entries.length >= MAX_INDEXED_FILES) break
  }
  onProgress?.(entries.length)
  return buildFileIndex(entries)
}

/**
 * The Chromium source. Each library track is looked up along its own path
 * inside the granted folder, which costs a few lookups per track instead of
 * reading every file on the drive. When fewer than half the tracks are found
 * that way, the paths do not run through this folder, and it walks the whole
 * folder and matches by path suffix instead. The walk also throws when the
 * folder cannot be reached, which is how an unplugged drive is noticed.
 */
export async function openFsaSource(
  handle: FileSystemDirectoryHandle,
  locations: readonly string[],
  onProgress?: (progress: IndexProgress) => void,
): Promise<AudioSource> {
  const finding = (report?: (progress: IndexProgress) => void) => (done: number, total: number) =>
    report?.({ phase: 'finding', done, total })
  const base = {
    kind: 'fsa' as const,
    rootName: handle.name,
    fileFor: (file: AudioHandle) => (file instanceof File ? Promise.resolve(file) : file.getFile()),
    ensurePermission: () => requestReadPermission(handle),
  }
  const resolver = createPathResolver<FileSystemFileHandle>(handle, handle.name)
  const first = await resolver.lookUp(locations, finding(onProgress))
  if (shouldWalk(first.found, locations.length)) {
    const index = await walkIndex(handle, (done) =>
      onProgress?.({ phase: 'scanning', done, total: null }),
    )
    return { ...base, indexFor: () => Promise.resolve(index) }
  }
  return {
    ...base,
    indexFor: async (more, report) => (await resolver.lookUp(more, finding(report))).index,
  }
}
```

- [ ] **Step 5: The picker source returns its fixed index**

In `src/lib/audio/pickerSource.ts`, in the returned object replace `index,` with:

```ts
    indexFor: () => Promise.resolve(index),
```

- [ ] **Step 6: The store asks the source for the library's index**

In `src/lib/audio/sourceStore.ts`:

1. Replace the `IndexPhase`/`IndexProgress` declarations and their doc comment
   (lines 27–41) with a re-export:

   ```ts
   export type { IndexPhase, IndexProgress } from './source'
   ```

   Also add `type IndexProgress` to the existing `./source` import.

2. Add below `yieldToPaint`:

   ```ts
   function locationsOf(tracks: readonly Track[]): string[] {
     return tracks.flatMap((track) => (track.location === null ? [] : [track.location]))
   }

   function reportProgress(progress: IndexProgress): void {
     indexProgress.set(progress)
   }
   ```

   Add `import type { Track } from '../../core/model'`.

3. In `reindex`, replace:

   ```ts
     const run = ++matchRun
     const next = new Map<string, Resolution>()
     for (let i = 0; i < tracks.length; i += 1) {
       next.set(tracks[i].id, resolveTrack(tracks[i], against.index, probe))
   ```

   with:

   ```ts
     const run = ++matchRun
     const index = await against.indexFor(locationsOf(tracks), reportProgress)
     // A newer link or import overtook this one; its own pass owns the stores.
     if (run !== matchRun) return
     const next = new Map<string, Resolution>()
     for (let i = 0; i < tracks.length; i += 1) {
       next.set(tracks[i].id, resolveTrack(tracks[i], index, probe))
   ```

4. Replace each of the three calls `openFsaSource(handle, reportScan)` with
   `openFsaSource(handle, locationsOf(get(library)), reportProgress)`. They are in
   `linkFolder`, `reconnect` and `restoreSavedFolder`.

5. Delete `reportScan`; nothing else uses it. `beginScan` stays: it still marks
   the link as started, before the first progress arrives.

- [ ] **Step 7: Name the finding phase on screen**

In `src/lib/FolderLinkControl.svelte`, replace the body of `scanText`:

```ts
  const scanText = $derived.by(() => {
    const p = $indexProgress
    if (p === null) return 'Linking…'
    const where = $rootName === null ? '' : ` “${$rootName}”`
    if (p.phase === 'finding')
      return `Finding tracks in${where}… ${p.done.toLocaleString()} of ${p.total?.toLocaleString() ?? '?'}`
    if (p.phase === 'scanning')
      return p.total === null
        ? `Scanning${where}… ${p.done.toLocaleString()} files`
        : `Scanning${where}… ${p.done.toLocaleString()} of ${p.total.toLocaleString()}`
    return `Matching ${p.total?.toLocaleString() ?? ''} tracks…`
  })
```

Update its doc comment: "What the link is doing, in words. Every phase is
named, so none runs in silence."

- [ ] **Step 8: Run the tests and check they pass**

Run: `npx vitest run tests/sourceStore.test.ts tests/playerStore.test.ts tests/folderPaths.test.ts`
Expected: PASS, all tests. The original sourceStore tests still pass: with an
empty library they walk, exactly as before.

- [ ] **Step 9: Gate and commit**

Run: `npm run check && npm run lint && npm test`
Expected: 0 errors, lint clean, all tests pass.

```bash
git add src/lib/audio/source.ts src/lib/audio/fsaSource.ts src/lib/audio/pickerSource.ts src/lib/audio/sourceStore.ts src/lib/FolderLinkControl.svelte tests/sourceStore.test.ts
git commit -m "feat: open a linked folder by following the library's paths

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The helper accepts the site and starts at login

**Files:**
- Modify: `scripts/analyse-audio.py`
  - new module-level block after the imports: `SITE_ORIGIN`, `LOCAL_ORIGIN`,
    `origin_allowed`, `AGENT_LABEL`, `agent_plist`, `agent_path`,
    `install_agent`, `uninstall_agent`
  - `self_test()` (start of the function)
  - `serve()` (`origin_re` → `origin_allowed`)
  - `main()` (two flags and their dispatch)
- Modify: `README.md` (the "localhost helper" paragraph and the code block below it)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - CLI flags `--install-agent` and `--uninstall-agent`.
  - `origin_allowed(origin: str) -> bool`.
  - `agent_plist(python: str, script: Path, repo: Path, extra: list[str], log: Path) -> dict`.

- [ ] **Step 1: Write the failing self-test checks**

At the very start of `self_test()`'s body (before the descriptor-token contract), add:

```python
    # The helper answers only the app's own pages.
    allowed = [SITE_ORIGIN, "http://localhost:5173", "http://127.0.0.1:4173"]
    refused = [
        SITE_ORIGIN + ".evil.com",
        SITE_ORIGIN.replace("https://", "http://"),
        "https://evil.workers.dev",
        "null",
    ]
    if not all(origin_allowed(o) for o in allowed) or any(origin_allowed(o) for o in refused):
        print("FAIL: origin_allowed accepts or refuses the wrong origins", file=sys.stderr)
        return 1
    plist = agent_plist(
        "/venv/python", Path("/repo/scripts/analyse-audio.py"), Path("/repo"), ["--write-tags"], Path("/log")
    )
    expected_args = ["/venv/python", "/repo/scripts/analyse-audio.py", "--serve", "--write-tags"]
    if (
        plist["Label"] != AGENT_LABEL
        or plist["ProgramArguments"] != expected_args
        or plist["WorkingDirectory"] != "/repo"
        or plist["RunAtLoad"] is not True
        or plist["KeepAlive"] is not True
        or plist["StandardErrorPath"] != "/log"
    ):
        print(f"FAIL: agent_plist built {plist}", file=sys.stderr)
        return 1
    print("helper origins and login agent: OK")
```

- [ ] **Step 2: Run the self-test and check it fails**

Run: `scripts/.venv/bin/python scripts/analyse-audio.py --self-test`
Expected: FAIL with `NameError: name 'SITE_ORIGIN' is not defined`.

- [ ] **Step 3: Implement the origin check and the agent**

After the imports (after `from pathlib import Path` and any module constants that
follow it), add:

```python
# The deployed app. An exact match: a look-alike host never passes.
SITE_ORIGIN = "https://zodiac-tracker.michielrollier.workers.dev"
LOCAL_ORIGIN = re.compile(r"^https?://(localhost|127\.0\.0\.1)(:\d{1,5})?$")


def origin_allowed(origin: str) -> bool:
    """A browser request must come from the app: the deployed site or a local dev server."""
    return origin == SITE_ORIGIN or LOCAL_ORIGIN.match(origin) is not None


AGENT_LABEL = "app.zodiac-tracker.helper"


def agent_plist(python: str, script: Path, repo: Path, extra: list[str], log: Path) -> dict:
    """The launchd job that keeps the helper running. The working directory is
    the repo, because the defaults (scripts/models, scripts/out/…) are relative
    to it."""
    return {
        "Label": AGENT_LABEL,
        "ProgramArguments": [python, str(script), "--serve", *extra],
        "WorkingDirectory": str(repo),
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(log),
        "StandardErrorPath": str(log),
    }


def agent_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{AGENT_LABEL}.plist"


def install_agent(extra: list[str]) -> int:
    """macOS: start the helper at every login, with the flags given alongside
    --install-agent. Installing again replaces the running agent."""
    if sys.platform != "darwin":
        print("--install-agent is macOS only; start the helper with --serve", file=sys.stderr)
        return 2
    import plistlib
    import subprocess

    script = Path(__file__).resolve()
    log = Path.home() / "Library" / "Logs" / "zodiac-tracker-helper.log"
    path = agent_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    log.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(plistlib.dumps(agent_plist(sys.executable, script, script.parent.parent, extra, log)))
    domain = f"gui/{os.getuid()}"
    # A first install has nothing to stop; a reinstall stops the old agent.
    subprocess.run(["launchctl", "bootout", f"{domain}/{AGENT_LABEL}"], capture_output=True)
    # bootout can return before launchd has let go of the label, and bootstrap
    # then fails with an I/O error; a few seconds of retries cover it.
    for _ in range(5):
        result = subprocess.run(["launchctl", "bootstrap", domain, str(path)], capture_output=True, text=True)
        if result.returncode == 0:
            print(f"helper agent installed: {path}\nlog: {log}")
            return 0
        time.sleep(1)
    print(f"launchctl bootstrap failed: {result.stderr.strip()}", file=sys.stderr)
    return 1


def uninstall_agent() -> int:
    """macOS: stop the login agent and remove its file."""
    if sys.platform != "darwin":
        print("--uninstall-agent is macOS only", file=sys.stderr)
        return 2
    import subprocess

    subprocess.run(["launchctl", "bootout", f"gui/{os.getuid()}/{AGENT_LABEL}"], capture_output=True)
    agent_path().unlink(missing_ok=True)
    print(f"helper agent removed: {agent_path()}")
    return 0
```

In `serve()`:
- Delete the line `origin_re = re.compile(...)`.
- In `_origin`, replace `return origin_re.match(origin) is not None, origin` with
  `return origin_allowed(origin), origin`.
- Update the docstring sentence "browser requests additionally need a localhost
  Origin" to "browser requests additionally need the app's Origin (a local dev
  server or the deployed site)".

In `main()`, after the `--write-tags` argument, add:

```python
    parser.add_argument(
        "--install-agent",
        action="store_true",
        help="macOS: start the helper at every login, with the other flags given here",
    )
    parser.add_argument(
        "--uninstall-agent", action="store_true", help="macOS: stop and remove that login agent"
    )
```

After `if args.genre_report: return genre_report(...)`, add:

```python
    if args.uninstall_agent:
        return uninstall_agent()
```

Immediately before `if args.serve:`, which comes after the model and mutagen
checks so a broken setup is never installed, add:

```python
    if args.install_agent:
        extra = [a for a in sys.argv[1:] if a not in ("--install-agent", "--serve")]
        return install_agent(extra)
```

- [ ] **Step 4: Run the self-test and check it passes**

Run: `scripts/.venv/bin/python scripts/analyse-audio.py --self-test`
Expected: prints `helper origins and login agent: OK` and ends with `self-test OK`,
exit code 0.

- [ ] **Step 5: Document it in the README**

In `README.md`, replace the paragraph starting "The analyser can also run as the
app's **localhost helper**" up to and including the following
` ```sh … --serve … ``` ` block with:

````markdown
The analyser can also run as the app's **localhost helper**: start it with `--serve`,
press Connect in Advanced → Audio analysis, and analyse the selected playlists from
inside the app, with live progress, merging the result automatically. It answers the
deployed site and a local dev server, and nothing else. (Nothing contacts localhost
until you press Connect; after one successful Connect, this browser reconnects by
itself whenever you open the section.) The analysis columns, filters and the
genre-source switch appear once analysis actually matches your tracks.
`--write-tags` (or the section's checkbox) additionally writes a `[A78V35D86H55]`
descriptor token into each analysed file's Comment tag — Mixed In Key content is
preserved — so the descriptors travel with the files and come back in from any
Rekordbox XML after a Reload Tags.

```sh
scripts/.venv/bin/python scripts/analyse-audio.py --serve
```

On a Mac it can start by itself at every login instead. Run this once from the repo
folder, adding any flags the helper should keep (such as `--write-tags`):

```sh
scripts/.venv/bin/python scripts/analyse-audio.py --install-agent
scripts/.venv/bin/python scripts/analyse-audio.py --uninstall-agent   # to stop it
```

Its log is `~/Library/Logs/zodiac-tracker-helper.log`. A helper started this way
needs macOS's permission to read an external drive: allow it when asked, or turn it
on under System Settings → Privacy & Security → Files and Folders (Removable
Volumes) for the venv's Python.
````

- [ ] **Step 6: Lint and commit**

Run: `npm run lint`
Expected: clean (Prettier checks the README).

```bash
git add scripts/analyse-audio.py README.md
git commit -m "feat: the helper answers the deployed site and can start at login

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The app reconnects to a helper it has used

**Files:**
- Modify: `src/lib/analysisHelper.ts` (the module comment, `setPanelOpen`,
  `connectHelper`)
- Test: `tests/analysisHelper.test.ts` (a new `describe`)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new exports. Existing `setPanelOpen(open: boolean): void` and
  `connectHelper(): Promise<boolean>` change behaviour as below.

- [ ] **Step 1: Write the failing tests**

Append to `tests/analysisHelper.test.ts`:

```ts
describe('a helper this browser has used before', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  function storage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial))
    return {
      getItem: vi.fn((key: string) => items.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => void items.set(key, value)),
      items,
    }
  }

  const status = () =>
    vi.fn(() => Promise.resolve(new Response(JSON.stringify({ job: null }))))

  test('a successful Connect is remembered in this browser', async () => {
    const local = storage()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('fetch', status())
    const helper = await import('../src/lib/analysisHelper')

    await helper.connectHelper()

    expect(local.items.get('vdt-helper')).toBe('1')
  })

  test('opening the section reconnects by itself when remembered', async () => {
    vi.stubGlobal('localStorage', storage({ 'vdt-helper': '1' }))
    const fetch = status()
    vi.stubGlobal('fetch', fetch)
    const helper = await import('../src/lib/analysisHelper')

    helper.setPanelOpen(true)
    await vi.waitFor(() => expect(get(helper.helperConnected)).toBe(true))

    expect(fetch).toHaveBeenCalled()
    helper.setPanelOpen(false)
  })

  test('without the memory, opening the section sends nothing', async () => {
    vi.stubGlobal('localStorage', storage())
    const fetch = status()
    vi.stubGlobal('fetch', fetch)
    const helper = await import('../src/lib/analysisHelper')

    helper.setPanelOpen(true)
    await Promise.resolve()

    expect(fetch).not.toHaveBeenCalled()
    helper.setPanelOpen(false)
  })

  test('a storage that throws does not break Connect', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    vi.stubGlobal('fetch', status())
    const helper = await import('../src/lib/analysisHelper')

    expect(await helper.connectHelper()).toBe(true)
    helper.setPanelOpen(true)
    helper.setPanelOpen(false)
  })
})
```

- [ ] **Step 2: Run the tests and check they fail**

Run: `npx vitest run tests/analysisHelper.test.ts`
Expected: FAIL.
- "remembered in this browser": `vdt-helper` is undefined.
- "reconnects by itself": `waitFor` times out.

- [ ] **Step 3: Implement**

In `src/lib/analysisHelper.ts`, extend the module comment's second paragraph
("Nothing contacts localhost until the user presses Connect…") with:

```ts
 * A successful Connect is remembered in this browser (localStorage, never in
 * the project, so a shared project cannot make someone else's app call their
 * machine); from then on, opening the section connects by itself.
```

Add below `const HELPER_URL = …`:

```ts
const REMEMBER_KEY = 'vdt-helper'

function remembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1'
  } catch {
    return false
  }
}

function remember(): void {
  try {
    localStorage.setItem(REMEMBER_KEY, '1')
  } catch {
    // Blocked storage only costs the automatic reconnect.
  }
}
```

Replace `setPanelOpen`'s body:

```ts
export function setPanelOpen(open: boolean): void {
  panelOpen = open
  if (!open) return
  if (get(helperConnected)) {
    void refresh()
    ensureTimer()
  } else if (remembered()) {
    void connectHelper()
  }
}
```

In `connectHelper`, replace `if (connected) ensureTimer()` with:

```ts
  if (connected) {
    remember()
    ensureTimer()
  }
```

- [ ] **Step 4: Run the tests and check they pass**

Run: `npx vitest run tests/analysisHelper.test.ts`
Expected: PASS, all tests, including the earlier "opening the analysis section
sends nothing to localhost before Connect", which has no memory in node.

- [ ] **Step 5: Gate and commit**

Run: `npm run check && npm run lint && npm test`
Expected: 0 errors, lint clean, all tests pass.

```bash
git add src/lib/analysisHelper.ts tests/analysisHelper.test.ts
git commit -m "feat: reconnect to a helper this browser has used before

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Whole-branch verification and the checks by hand

**Files:**
- Modify: `docs/ISSUES.md`, only if the checks below turn up something to defer.

**Interfaces:**
- Consumes: everything above.
- Produces: a verified branch and a list of hand-check results for the final message.

- [ ] **Step 1: The full gate**

Run: `npm run check && npm run lint && npm test && npm run build`
Expected: 0 errors, lint clean, all tests pass, build OK.

- [ ] **Step 2: The probe**

Run, with `npm run dev` serving :5173: `node scripts/screenshot.mjs out/`
Expected: exit code 0, `CONSOLE ERRORS: none`.

- [ ] **Step 3: The helper's self-test**

Run: `scripts/.venv/bin/python scripts/analyse-audio.py --self-test`
Expected: `self-test OK`.

- [ ] **Step 4: Hand the checks to Michiel**

Deploying needs a merge and a push, which is his call. The checks run on the live
site, installed as an app in Chrome.
- **Before the merge:** time a Link of `/Volumes/SD 1TB/Music` on the current
  live site, as the "before" number.
- **After the merge:**
  1. Link `/Volumes/SD 1TB/Music` and note the time to the coverage line.
     Quit, reopen: no Reconnect, and the coverage line returns quickly.
  2. Play a 16-bit and a 24-bit AIFF and seek in each. The coverage line counts
     only the ALAC files as unsupported.
  3. Run `--install-agent`, log out and in, and with no Terminal open, open
     Advanced → Audio analysis and analyse a small playlist on the SD card.
     Note whether macOS asked for removable-volume access.
