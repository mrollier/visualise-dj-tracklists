import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { EMPTY_TRACK_FIELDS } from '../src/core/model'
import { aiffBytes } from './aiffFixture'

/**
 * playerStore holds module-singleton deck bookkeeping (materialised, wanted),
 * so each test gets a fresh registry via vi.resetModules() + dynamic import.
 * The engine and sourceStore are mocked whole: these tests pin the store's
 * decisions — when it pauses, what it loads — not the audio graph.
 */

const engineMock = vi.hoisted(() => ({
  ensureContext: vi.fn(),
  hasContext: vi.fn(() => true),
  onDeckEvent: vi.fn(() => () => {}),
  promote: vi.fn(),
  clearDeck: vi.fn(),
  loadDeck: vi.fn(async () => {}),
  play: vi.fn(async () => {}),
  pause: vi.fn(),
  seek: vi.fn(),
  isPlaying: vi.fn(() => false),
  positionOf: vi.fn(() => ({ currentTime: 0, duration: NaN })),
  errorCodeOf: vi.fn(() => null),
  setGains: vi.fn(),
  dispose: vi.fn(),
}))

const sourceMock = vi.hoisted(() => {
  const state = {
    fileFor: vi.fn((): Promise<unknown> => Promise.resolve({})),
  }
  return {
    state,
    currentSource: vi.fn(() => ({ kind: 'fsa', rootName: 'Music', fileFor: state.fileFor })),
    resolutionFor: vi.fn(() => ({ kind: 'playable', handle: {} })),
    reindex: vi.fn(async () => {}),
    restoreSavedFolder: vi.fn(async () => {}),
    setProbe: vi.fn(),
  }
})

vi.mock('../src/lib/audio/engine', () => engineMock)
vi.mock('../src/lib/audio/sourceStore', () => ({
  currentSource: sourceMock.currentSource,
  resolutionFor: sourceMock.resolutionFor,
  reindex: sourceMock.reindex,
  restoreSavedFolder: sourceMock.restoreSavedFolder,
  setProbe: sourceMock.setProbe,
}))

async function freshPlayer() {
  const stores = await import('../src/stores')
  const player = await import('../src/lib/audio/playerStore')
  player.startPlayer()
  return { stores, player }
}

describe('playerStore load branch (v40, Codex bug 4 + debounce race)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal(
      'Audio',
      class {
        canPlayType() {
          return ''
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('bug 4: loading a new track silences the one still sounding', async () => {
    engineMock.isPlaying.mockReturnValue(true)
    const { stores } = await freshPlayer()

    stores.clickedTrackId.set('t1')

    expect(engineMock.pause).toHaveBeenCalledWith('b')
  })

  test('a paused deck is left alone on load — no gratuitous pause', async () => {
    engineMock.isPlaying.mockReturnValue(false)
    const { stores } = await freshPlayer()

    stores.clickedTrackId.set('t1')

    expect(engineMock.pause).not.toHaveBeenCalled()
  })

  test('debounce race: an in-flight materialise for the previous click must not land', async () => {
    const { stores } = await freshPlayer()
    let releaseFile: (file: unknown) => void = () => {}
    sourceMock.state.fileFor.mockReturnValue(
      new Promise((resolve) => {
        releaseFile = resolve
      }),
    )

    stores.clickedTrackId.set('t1')
    // The preload debounce fires and materialise('b', 't1') parks on fileFor.
    await vi.advanceTimersByTimeAsync(200)
    // A newer click arrives while t1's bytes are still being read.
    stores.clickedTrackId.set('t2')
    releaseFile({})
    await vi.advanceTimersByTimeAsync(0)

    // t1 lost the race; its bytes must not reach the element.
    expect(engineMock.loadDeck).not.toHaveBeenCalled()
  })
})

describe('deck bookkeeping (review fixes)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
    sourceMock.resolutionFor.mockReturnValue({ kind: 'playable', handle: {} })
    sourceMock.state.fileFor.mockReturnValue(Promise.resolve({}))
    vi.stubGlobal(
      'Audio',
      class {
        canPlayType() {
          return ''
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('re-clicking a track after the decks were cleared loads it again', async () => {
    const { stores, player } = await freshPlayer()
    const t1 = { ...EMPTY_TRACK_FIELDS, id: 't1', title: 'One' }
    stores.library.set([t1])
    stores.selectOrLink('t1')
    expect(get(player.decks).b).toBe('t1')
    stores.library.set([]) // a re-import clears the decks…
    stores.library.set([t1])
    expect(get(player.decks).b).toBeNull()
    stores.selectOrLink('t1') // …and the same click must still be heard
    expect(get(player.decks).b).toBe('t1')
  })

  test('an unplayable track leaves the verdict to the live resolution, not a frozen error', async () => {
    sourceMock.resolutionFor.mockReturnValue({ kind: 'unplayable', reason: 'not-found' } as never)
    const { stores, player } = await freshPlayer()
    stores.clickedTrackId.set('t1')
    await player.togglePlay('b')
    // Frozen here, the error outlived relinking the right folder (ISSUES #7).
    expect(get(player.deckError).b).toBeNull()
  })

  test('a play() interrupted by a newer load is not a read error', async () => {
    engineMock.play.mockRejectedValueOnce(new DOMException('interrupted', 'AbortError'))
    const { stores, player } = await freshPlayer()
    stores.clickedTrackId.set('t1')
    await player.togglePlay('b')
    expect(get(player.deckError).b).toBeNull()
  })

  test('unpinning never lets a load for the discarded track land on the kept one', async () => {
    const { stores, player } = await freshPlayer()
    stores.clickedTrackId.set('t0')
    await vi.advanceTimersByTimeAsync(200) // t0 is in deck B
    player.lockDeck() // …and pinned up to A
    let release: (file: unknown) => void = () => {}
    sourceMock.state.fileFor.mockReturnValue(new Promise((resolve) => (release = resolve)))
    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200) // t1's read is in flight for deck B
    engineMock.loadDeck.mockClear()
    player.unlockDeck() // t0 comes back down as B; t1 is discarded
    release({})
    await vi.advanceTimersByTimeAsync(0)
    expect(engineMock.loadDeck).not.toHaveBeenCalled()
  })

  test('pinning a deck while its play is still loading leaves both decks playable', async () => {
    const { stores, player } = await freshPlayer()
    let release: (file: unknown) => void = () => {}
    sourceMock.state.fileFor.mockReturnValue(new Promise((resolve) => (release = resolve)))
    stores.clickedTrackId.set('t0')
    const pending = player.togglePlay('b') // a slow drive: the read is in flight…
    player.lockDeck() // …when the user pins it up to A
    release({})
    await pending
    engineMock.play.mockClear()
    await player.togglePlay('a')
    expect(engineMock.play).toHaveBeenCalledWith('a')
  })
})

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

  test('Play during the preload’s AIFF read shares that read', async () => {
    stubAudio('')
    let release: (bytes: ArrayBuffer) => void = () => {}
    const reads = vi.fn(() => new Promise<ArrayBuffer>((resolve) => (release = resolve)))
    sourceMock.state.fileFor.mockReturnValue(
      Promise.resolve({ name: 'Big.aiff', arrayBuffer: reads }),
    )
    const { stores, player } = await freshPlayer()

    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200)
    const playing = player.togglePlay('b')
    await vi.advanceTimersByTimeAsync(0)
    release(aiffBytes({ samples: [1, 2] }))
    await playing

    expect(reads).toHaveBeenCalledTimes(1)
    expect(engineMock.loadDeck).toHaveBeenCalledTimes(1)
  })

  test('an AIFF read that went stale is not converted', async () => {
    stubAudio('')
    let release: (bytes: ArrayBuffer) => void = () => {}
    const slow = {
      name: 'Big.aiff',
      arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => (release = resolve)),
    }
    sourceMock.state.fileFor.mockReturnValueOnce(Promise.resolve(slow))
    sourceMock.state.fileFor.mockReturnValue(new Promise(() => {}))
    const { stores } = await freshPlayer()
    const bytes = aiffBytes({ samples: [1, 2] })

    stores.clickedTrackId.set('t1')
    await vi.advanceTimersByTimeAsync(200)
    stores.clickedTrackId.set('t2')
    release(bytes)
    await vi.advanceTimersByTimeAsync(0)

    // The audio starts at byte 54 and is still big-endian: no swap ran.
    expect(new DataView(bytes).getInt16(54)).toBe(1)
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
