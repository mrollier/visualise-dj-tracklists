import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * sourceStore holds module-singleton state (source, pendingHandle), so every
 * test gets a fresh registry via vi.resetModules() + dynamic import. IndexedDB
 * is absent in node, so the handleStore module is mocked whole — its own
 * `typeof indexedDB` guard would otherwise make loadRootHandle a permanent
 * null and reconnect untestable.
 */

const handleStore = vi.hoisted(() => ({
  saveRootHandle: vi.fn(async () => {}),
  loadRootHandle: vi.fn(async (): Promise<unknown> => null),
  forgetRootHandle: vi.fn(async () => {}),
}))

vi.mock('../src/lib/audio/handleStore', () => handleStore)

type Store = typeof import('../src/lib/audio/sourceStore')

/**
 * A fake FSA directory handle. `events` records the order of permission
 * requests vs directory iteration — the heart of bug 1 is that the walk used
 * to come first.
 */
function fakeHandle(opts: {
  name: string
  permission: PermissionState
  request?: PermissionState
  files?: string[]
  failWalk?: boolean
}) {
  const events: string[] = []
  const handle = {
    name: opts.name,
    kind: 'directory' as const,
    queryPermission: vi.fn(async () => opts.permission),
    requestPermission: vi.fn(async () => {
      events.push('request')
      return opts.request ?? 'denied'
    }),
    entries() {
      events.push('iterate')
      async function* iterate(): AsyncGenerator<[string, { kind: 'file'; name: string }]> {
        if (opts.failWalk === true) throw new DOMException('not allowed', 'NotAllowedError')
        for (const name of opts.files ?? []) yield [name, { kind: 'file', name }]
      }
      return iterate()
    },
  }
  return { handle: handle as unknown as FileSystemDirectoryHandle, events, raw: handle }
}

async function freshStore(): Promise<Store> {
  return await import('../src/lib/audio/sourceStore')
}

describe('sourceStore link/reconnect failure paths (v40, Codex bugs 1+2)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    handleStore.loadRootHandle.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('bug 1: declining the reconnect prompt keeps the parked folder', async () => {
    const { handle, events } = fakeHandle({
      name: 'Music',
      permission: 'prompt',
      request: 'denied',
      failWalk: true, // Chromium: walking a prompt-state handle rejects.
    })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const store = await freshStore()
    await store.restoreSavedFolder()
    expect(get(store.sourceState)).toBe('needs-permission')

    await store.reconnect()

    expect(events).not.toContain('iterate')
    expect(handleStore.forgetRootHandle).not.toHaveBeenCalled()
    expect(get(store.sourceState)).toBe('needs-permission')
    expect(get(store.rootName)).toBe('Music')
  })

  test('bug 1: granting the reconnect prompt asks BEFORE walking, then adopts', async () => {
    const { handle, events, raw } = fakeHandle({
      name: 'Music',
      permission: 'prompt',
      request: 'granted',
      files: ['track.mp3'],
    })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const store = await freshStore()
    await store.restoreSavedFolder()

    await store.reconnect()

    expect(events[0]).toBe('request')
    expect(events).toContain('iterate')
    expect(raw.requestPermission).toHaveBeenCalledTimes(1)
    expect(get(store.sourceState)).toBe('ready')
  })

  test('bug 2: a failed replacement link keeps the working folder', async () => {
    const a = fakeHandle({ name: 'A', permission: 'granted', files: ['a.mp3'] })
    vi.stubGlobal('window', { showDirectoryPicker: async () => a.handle })
    const store = await freshStore()
    await store.linkFolder()
    expect(get(store.sourceState)).toBe('ready')
    const linked = store.currentSource()
    expect(linked?.rootName).toBe('A')

    const b = fakeHandle({ name: 'B', permission: 'granted', failWalk: true })
    vi.stubGlobal('window', { showDirectoryPicker: async () => b.handle })
    await store.linkFolder()

    expect(get(store.sourceState)).toBe('ready')
    expect(get(store.rootName)).toBe('A')
    expect(store.currentSource()).toBe(linked)
    expect(get(store.indexProgress)).toBeNull()
    expect(handleStore.forgetRootHandle).not.toHaveBeenCalled()
  })

  test('a failed link with nothing to fall back to still forgets (pinned behaviour)', async () => {
    const b = fakeHandle({ name: 'B', permission: 'granted', failWalk: true })
    vi.stubGlobal('window', { showDirectoryPicker: async () => b.handle })
    const store = await freshStore()

    await store.linkFolder()

    expect(get(store.sourceState)).toBe('no-source')
    expect(handleStore.forgetRootHandle).toHaveBeenCalled()
  })
})
