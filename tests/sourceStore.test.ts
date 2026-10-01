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
  loadRootHandle: vi.fn((): Promise<unknown> => Promise.resolve(null)),
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
    queryPermission: vi.fn(() => Promise.resolve(opts.permission)),
    requestPermission: vi.fn(() => {
      events.push('request')
      return Promise.resolve(opts.request ?? 'denied')
    }),
    entries() {
      events.push('iterate')
      // A sync generator suffices: `for await … of` iterates it natively.
      function* iterate(): Generator<[string, { kind: 'file'; name: string }]> {
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
    vi.stubGlobal('window', { showDirectoryPicker: () => Promise.resolve(a.handle) })
    const store = await freshStore()
    await store.linkFolder()
    expect(get(store.sourceState)).toBe('ready')
    const linked = store.currentSource()
    expect(linked?.rootName).toBe('A')

    const b = fakeHandle({ name: 'B', permission: 'granted', failWalk: true })
    vi.stubGlobal('window', { showDirectoryPicker: () => Promise.resolve(b.handle) })
    await store.linkFolder()

    expect(get(store.sourceState)).toBe('ready')
    expect(get(store.rootName)).toBe('A')
    expect(store.currentSource()).toBe(linked)
    expect(get(store.indexProgress)).toBeNull()
    expect(handleStore.forgetRootHandle).not.toHaveBeenCalled()
  })

  test('a failed link with nothing to fall back to still forgets (pinned behaviour)', async () => {
    const b = fakeHandle({ name: 'B', permission: 'granted', failWalk: true })
    vi.stubGlobal('window', { showDirectoryPicker: () => Promise.resolve(b.handle) })
    const store = await freshStore()

    await store.linkFolder()

    expect(get(store.sourceState)).toBe('no-source')
    expect(handleStore.forgetRootHandle).toHaveBeenCalled()
  })

  test('a remembered folder on an unmounted drive stays remembered, ready to reconnect', async () => {
    // Permission granted, but the walk fails: the volume is not plugged in.
    const { handle } = fakeHandle({ name: 'SD 1TB', permission: 'granted', failWalk: true })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const store = await freshStore()

    await store.restoreSavedFolder()

    expect(handleStore.forgetRootHandle).not.toHaveBeenCalled()
    expect(get(store.sourceState)).toBe('needs-permission')
    expect(get(store.rootName)).toBe('SD 1TB')
  })

  test('a reconnect that cannot reach the drive keeps the folder for the next try', async () => {
    const { handle } = fakeHandle({
      name: 'SD 1TB',
      permission: 'prompt',
      request: 'granted',
      failWalk: true,
    })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const store = await freshStore()
    await store.restoreSavedFolder()

    await store.reconnect()

    expect(handleStore.forgetRootHandle).not.toHaveBeenCalled()
    expect(get(store.sourceState)).toBe('needs-permission')
  })
})

/**
 * A granted folder that answers path lookups (getDirectoryHandle /
 * getFileHandle) as well as a walk (entries), recording both.
 */
function pathHandle(opts: { name: string; files: string[]; unreachable?: boolean; hold?: string }) {
  const events: string[] = []
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
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
      if (path === opts.hold) return held.then(() => ({ kind: 'file', name, path }))
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
  return { handle: folder('') as FileSystemDirectoryHandle, events, release }
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
    await withLibrary([
      at('/Volumes/SD 1TB/Music/House/a.mp3'),
      at('/Volumes/SD 1TB/Music/House/b.mp3'),
    ])
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

  test('a re-imported library that no longer runs through the folder gets the walk', async () => {
    const { handle, events } = pathHandle({ name: 'Music', files: ['House/a.mp3', 'House/b.mp3'] })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const stores = await withLibrary([
      at('/Volumes/SD 1TB/Music/House/a.mp3'),
      at('/Volumes/SD 1TB/Music/House/b.mp3'),
    ])
    const store = await freshStore()
    store.setProbe(() => true)
    await store.restoreSavedFolder()
    const { track } = await import('./helpers')

    stores.library.set([
      track({ id: 'x0', location: at('/Users/other/Tunes/House/a.mp3') }),
      track({ id: 'x1', location: at('/Users/other/Tunes/House/b.mp3') }),
    ])
    await store.reindex()

    expect(events).toContain('iterate')
    expect(get(store.coverage)?.playable).toBe(2)
  })

  test('a few new tracks from elsewhere do not trigger a walk', async () => {
    const { handle, events } = pathHandle({ name: 'Music', files: ['House/a.mp3', 'House/b.mp3'] })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const a = at('/Volumes/SD 1TB/Music/House/a.mp3')
    const b = at('/Volumes/SD 1TB/Music/House/b.mp3')
    const stores = await withLibrary([a, b])
    const store = await freshStore()
    store.setProbe(() => true)
    await store.restoreSavedFolder()
    const { track } = await import('./helpers')

    stores.library.set([
      track({ id: 't0', location: a }),
      track({ id: 't1', location: b }),
      track({ id: 't2', location: at('/Users/dj/Downloads/c.mp3') }),
    ])
    await store.reindex()

    expect(events).not.toContain('iterate')
    expect(get(store.coverage)?.notFound).toBe(1)
  })

  test('a lookup overtaken by a newer pass leaves no progress bar behind', async () => {
    const { handle, release } = pathHandle({
      name: 'Music',
      files: ['House/a.mp3', 'House/b.mp3'],
      hold: 'House/b.mp3',
    })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const a = at('/Volumes/SD 1TB/Music/House/a.mp3')
    const stores = await withLibrary([a])
    const store = await freshStore()
    store.setProbe(() => true)
    await store.restoreSavedFolder()
    const { track } = await import('./helpers')

    stores.library.set([
      track({ id: 't0', location: a }),
      track({ id: 't1', location: at('/Volumes/SD 1TB/Music/House/b.mp3') }),
    ])
    const overtaken = store.reindex()
    stores.library.set([track({ id: 't0', location: a })])
    await store.reindex()
    release()
    await overtaken

    expect(get(store.indexProgress)).toBeNull()
  })

  test('emptying the library during a lookup leaves no stale coverage', async () => {
    const { handle, release } = pathHandle({
      name: 'Music',
      files: ['House/a.mp3', 'House/b.mp3'],
      hold: 'House/b.mp3',
    })
    handleStore.loadRootHandle.mockResolvedValue(handle)
    const a = at('/Volumes/SD 1TB/Music/House/a.mp3')
    const stores = await withLibrary([a])
    const store = await freshStore()
    store.setProbe(() => true)
    await store.restoreSavedFolder()
    const { track } = await import('./helpers')

    stores.library.set([
      track({ id: 't0', location: a }),
      track({ id: 't1', location: at('/Volumes/SD 1TB/Music/House/b.mp3') }),
    ])
    const overtaken = store.reindex()
    stores.library.set([])
    await store.reindex()
    release()
    await overtaken

    expect(get(store.coverage)).toBeNull()
  })
})
