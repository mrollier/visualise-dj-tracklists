import { isAudioFileName } from '../../core/audio/formats'
import { buildFileIndex, type FileIndex, type IndexEntry } from '../../core/audio/pathMatch'
import { type AudioHandle, type AudioSource, MAX_INDEXED_FILES } from './source'

/**
 * The `<input type="file" webkitdirectory>` backend — everything that is not
 * Chromium. The browser hands over a flat File[] whose webkitRelativePath is
 * relative to the picked folder, which is exactly the shape the suffix matcher
 * wants. Nothing here survives a reload, so the user re-picks once a session.
 */

/** Folded per file, so a big pick has to yield or the progress bar never paints. */
const INDEX_CHUNK = 4000

export async function openPickerSource(
  files: readonly File[],
  onProgress?: (indexed: number, total: number) => void,
): Promise<AudioSource> {
  const audio = files.filter((file) => isAudioFileName(file.name)).slice(0, MAX_INDEXED_FILES)
  const rootName = audio[0]?.webkitRelativePath.split('/')[0] ?? 'your music folder'

  // buildFileIndex stays the pure, tested builder; it is simply run per chunk
  // and the buckets merged, so the fold (an NFC normalise per path segment)
  // can be interrupted. Unlike the FSA walk, the total is known up front here.
  const byName = new Map<string, IndexEntry<AudioHandle>[]>()
  let size = 0
  for (let start = 0; start < audio.length; start += INDEX_CHUNK) {
    const part = buildFileIndex(
      audio.slice(start, start + INDEX_CHUNK).map((file) => ({
        // A browser that gives no relative path still gives a name; a one-segment
        // path matches on basename alone, which is the common case anyway.
        path: file.webkitRelativePath === '' ? [file.name] : file.webkitRelativePath.split('/'),
        handle: file,
      })),
    )
    for (const [name, entries] of part.byName) {
      const bucket = byName.get(name)
      if (bucket === undefined) byName.set(name, [...entries])
      else bucket.push(...entries)
    }
    size += part.size
    onProgress?.(Math.min(start + INDEX_CHUNK, audio.length), audio.length)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const index: FileIndex<AudioHandle> = { byName, size }

  return {
    kind: 'picker',
    rootName,
    index,
    fileFor: (file) => (file instanceof File ? Promise.resolve(file) : file.getFile()),
    ensurePermission: () => Promise.resolve(true),
  }
}
