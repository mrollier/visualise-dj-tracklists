/**
 * The few IndexedDB operations the app needs, over one object store per
 * database. Raw IndexedDB rather than a helper library: four operations, no
 * new dependency. Every call opens its own connection and closes it when its
 * transaction settles, so nothing holds the database open between saves.
 *
 * Failures reject — including IndexedDB being unavailable (private-mode
 * Firefox, locked-down profiles) — so each caller decides what a failure
 * means for it.
 */
export interface KeyValueStore {
  getMany(keys: readonly string[]): Promise<unknown[]>
  /** All in one transaction: either every entry lands or none does. */
  putMany(entries: readonly (readonly [string, unknown])[]): Promise<void>
  delete(keys: readonly string[]): Promise<void>
}

function open(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'))
      return
    }
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(storeName)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'))
  })
}

async function transact<T>(
  dbName: string,
  storeName: string,
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => () => T,
): Promise<T> {
  const db = await open(dbName, storeName)
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode)
      const result = act(tx.objectStore(storeName))
      tx.oncomplete = () => resolve(result())
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
    })
  } finally {
    db.close()
  }
}

export function openStore(dbName: string, storeName: string): KeyValueStore {
  return {
    getMany: (keys) =>
      transact(dbName, storeName, 'readonly', (store) => {
        const requests = keys.map((key) => store.get(key))
        return () => requests.map((r) => r.result as unknown)
      }),
    putMany: (entries) =>
      transact(dbName, storeName, 'readwrite', (store) => {
        for (const [key, value] of entries) store.put(value, key)
        return () => undefined
      }),
    delete: (keys) =>
      transact(dbName, storeName, 'readwrite', (store) => {
        for (const key of keys) store.delete(key)
        return () => undefined
      }),
  }
}
