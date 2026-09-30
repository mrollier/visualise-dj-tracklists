/**
 * Remembering the granted music folder across reloads.
 *
 * A FileSystemDirectoryHandle is structured-cloneable, so IndexedDB can hold
 * it — that is what turns "pick your folder every session" into "pick it once,
 * ever" on Chromium. Firefox and Safari have no handle to store, so they get
 * the session-only picker instead. Raw IndexedDB rather than a helper library:
 * see src/lib/idb.ts.
 */
import { openStore } from '../idb'

const store = openStore('visualise-dj-tracklists:audio', 'handles')
const KEY = 'musicRoot'

// A lost handle only means picking the folder again, so storage failures are
// swallowed here rather than surfaced.
export async function saveRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await store.putMany([[KEY, handle]]).catch(() => undefined)
}

export async function loadRootHandle(): Promise<FileSystemDirectoryHandle | null> {
  const [stored] = await store.getMany([KEY]).catch(() => [null])
  // Anything else in there is from a future or corrupted version; ignore it.
  // The typeof guard is not optional: `instanceof` evaluates its right-hand
  // side unconditionally, and this module is reached on every browser, not
  // only the ones with File System Access.
  if (typeof FileSystemDirectoryHandle === 'undefined') return null
  return stored instanceof FileSystemDirectoryHandle ? stored : null
}

export async function forgetRootHandle(): Promise<void> {
  await store.delete([KEY]).catch(() => undefined)
}
