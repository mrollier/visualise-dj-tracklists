/**
 * Remembering the granted music folder across reloads.
 *
 * A FileSystemDirectoryHandle is structured-cloneable, so IndexedDB can hold
 * it — that is what turns "pick your folder every session" into "pick it once,
 * ever" on Chromium. Firefox and Safari have no handle to store, so they get
 * the session-only picker instead. Raw IndexedDB rather than a helper library:
 * one object store, three operations, no new dependency.
 */
const DB_NAME = 'visualise-dj-tracklists:audio'
const STORE = 'handles'
const KEY = 'musicRoot'

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, 1)
    } catch {
      // Private-mode Firefox and locked-down profiles throw outright.
      resolve(null)
      return
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>) {
  return open().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (db === null) {
          resolve(null)
          return
        }
        const request = act(db.transaction(STORE, mode).objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => resolve(null)
      }),
  )
}

export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await run('readwrite', (store) => store.put(handle, KEY))
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const stored = await run<unknown>('readonly', (store) => store.get(KEY))
  // Anything else in there is from a future or corrupted version; ignore it.
  return stored instanceof FileSystemDirectoryHandle ? stored : null
}

export async function forgetRootHandle(): Promise<void> {
  await run('readwrite', (store) => store.delete(KEY))
}
