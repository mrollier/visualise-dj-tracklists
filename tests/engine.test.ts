import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as engine from '../src/lib/audio/engine'

/**
 * The engine module has no module-level side effects — `new AudioContext` and
 * `new Audio` only run inside ensureContext() — so it imports cleanly in the
 * node test env with stubbed globals. State is reset between tests through
 * dispose(), which is itself the path under test here.
 */

type FakeGainParam = {
  value: number
  cancelScheduledValues: ReturnType<typeof vi.fn>
  setValueAtTime: ReturnType<typeof vi.fn>
  linearRampToValueAtTime: ReturnType<typeof vi.fn>
}

/** Every GainNode any context ever created, in creation order (slot 0, slot 1, ...). */
const createdGains: { gain: FakeGainParam; connect: () => void }[] = []

class FakeAudio {
  paused = true
  ended = false
  preload = ''
  currentTime = 0
  duration = NaN
  error = null
  addEventListener() {}
  removeEventListener() {}
  play() {
    this.paused = false
    return Promise.resolve()
  }
  pause() {
    this.paused = true
  }
  removeAttribute() {}
  load() {}
}

class FakeAudioContext {
  currentTime = 0
  destination = {}
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
  createDynamicsCompressor() {
    return {
      threshold: { value: 0 },
      knee: { value: 0 },
      ratio: { value: 0 },
      attack: { value: 0 },
      release: { value: 0 },
      connect() {},
    }
  }
  createMediaElementSource() {
    return { connect() {} }
  }
  createGain() {
    const node = {
      gain: {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect() {},
    }
    createdGains.push(node)
    return node
  }
}

describe('engine duck bookkeeping across dispose (v40, Codex bug 3)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('AudioContext', FakeAudioContext)
    createdGains.length = 0
  })

  afterEach(() => {
    engine.dispose()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  test('a duck timer surviving dispose() cannot poison the counter for the next graph', async () => {
    engine.ensureContext()
    await engine.play('b')
    // Pausing a sounding deck ducks the slot first: ducks[1] = 1, timer armed.
    engine.pause('b')
    // The feature is toggled off before the 12 ms de-click timer fires.
    engine.dispose()
    // The late callback runs against the zeroed counter.
    vi.advanceTimersByTime(20)
    // A fresh graph must still honour gain commands on that slot.
    engine.ensureContext()
    engine.setGains(0.25, 0.75)
    // Slots 2 and 3 belong to the second context (0 and 1 died with the first).
    expect(createdGains).toHaveLength(4)
    const slotB = createdGains[3]
    expect(slotB.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.75, expect.any(Number))
  })
})
