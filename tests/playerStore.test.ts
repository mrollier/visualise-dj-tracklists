import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

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
    fileFor: vi.fn(async (): Promise<unknown> => ({})),
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
