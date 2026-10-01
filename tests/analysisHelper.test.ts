import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { estimateMinutes } from '../src/lib/analysisHelper'

describe('estimateMinutes (v38)', () => {
  test('scales from the measured v34 run rate — 2040 tracks in ~122 min', () => {
    expect(estimateMinutes(2040)).toBe(123)
  })

  test('a small playlist rounds up to at least one minute', () => {
    expect(estimateMinutes(1)).toBe(1)
    expect(estimateMinutes(0)).toBe(0)
  })
})

describe('the helper is contacted only on request', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  const answering = (job: unknown) =>
    vi.fn((url: string) =>
      Promise.resolve(
        url.endsWith('/status')
          ? new Response(JSON.stringify({ job }))
          : new Response('{}', { status: 500 }),
      ),
    )

  test('opening the analysis section sends nothing to localhost before Connect', async () => {
    const fetch = answering(null)
    vi.stubGlobal('fetch', fetch)
    const helper = await import('../src/lib/analysisHelper')
    helper.setPanelOpen(true)
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()
    helper.setPanelOpen(false)
  })

  test('Connect asks once and reports whether a helper answered', async () => {
    vi.stubGlobal('fetch', answering(null))
    const helper = await import('../src/lib/analysisHelper')
    expect(await helper.connectHelper()).toBe(true)
    expect(get(helper.helperConnected)).toBe(true)

    vi.resetModules()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('refused'))),
    )
    const offline = await import('../src/lib/analysisHelper')
    expect(await offline.connectHelper()).toBe(false)
    expect(get(offline.helperConnected)).toBe(false)
  })

  test('one slow answer during a long run does not drop the connection', async () => {
    vi.useFakeTimers()
    const running = {
      state: 'running',
      done: 10,
      total: 2000,
      rate: 1,
      etaSec: 100,
      errors: 0,
      startedAt: 't0',
    }
    let fail = false
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        fail
          ? Promise.reject(new DOMException('slow', 'TimeoutError'))
          : Promise.resolve(new Response(JSON.stringify({ job: running }))),
      ),
    )
    const helper = await import('../src/lib/analysisHelper')
    await helper.connectHelper()
    fail = true
    await vi.advanceTimersByTimeAsync(2000) // one poll times out under load
    expect(get(helper.helperConnected)).toBe(true)
    expect(get(helper.helperJob)).toMatchObject({ state: 'running' })
    await vi.advanceTimersByTimeAsync(4000) // …but a helper that stays silent is gone
    expect(get(helper.helperConnected)).toBe(false)
    vi.useRealTimers()
  })

  test('a finished job whose result failed to download is fetched again', async () => {
    const done = {
      state: 'done',
      done: 1,
      total: 1,
      rate: 1,
      etaSec: null,
      errors: 0,
      startedAt: 't0',
    }
    const fetch = answering(done)
    vi.stubGlobal('fetch', fetch)
    const helper = await import('../src/lib/analysisHelper')
    await helper.connectHelper() // /status → done → /result fails (500)
    await helper.connectHelper() // polls again: the result must be asked for again
    const resultCalls = fetch.mock.calls.filter(([url]) => String(url).endsWith('/result'))
    expect(resultCalls).toHaveLength(2)
  })
})

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

  const status = () => vi.fn(() => Promise.resolve(new Response(JSON.stringify({ job: null }))))

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

describe('the first Connect from the deployed site', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  test('waits while Chrome asks for local-network access', async () => {
    // Chrome holds the request until the person answers its prompt; a request
    // that gives up after a poll's deadline would report "no helper".
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const answer = setTimeout(
              () => resolve(new Response(JSON.stringify({ job: null }))),
              1200,
            )
            init?.signal?.addEventListener('abort', () => {
              clearTimeout(answer)
              reject(new DOMException('aborted', 'AbortError'))
            })
          }),
      ),
    )
    const helper = await import('../src/lib/analysisHelper')

    expect(await helper.connectHelper()).toBe(true)
  })
})

describe('a finished job is merged once, across sessions', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  const job = {
    state: 'done',
    done: 1,
    total: 1,
    rate: 1,
    etaSec: 0,
    errors: 0,
    startedAt: 'run-1',
  }
  const helperAnswering = () =>
    vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(url.endsWith('/status') ? { job } : { zodiacAnalysis: 1, tracks: {} }),
        ),
      ),
    )
  function storage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial))
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
      items,
    }
  }

  test('a merged job is remembered', async () => {
    const local = storage()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('fetch', helperAnswering())
    const helper = await import('../src/lib/analysisHelper')

    await helper.connectHelper()

    expect(local.items.get('vdt-helper-merged')).toBe('run-1')
  })

  test('a job this browser already merged is not fetched again after a reload', async () => {
    vi.stubGlobal('localStorage', storage({ 'vdt-helper': '1', 'vdt-helper-merged': 'run-1' }))
    const fetch = helperAnswering()
    vi.stubGlobal('fetch', fetch)
    const helper = await import('../src/lib/analysisHelper')

    await helper.connectHelper()

    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/result'))).toHaveLength(0)
  })
})
