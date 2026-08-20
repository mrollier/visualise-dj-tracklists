import { isAudioFileName } from '../../core/audio/formats'
import { buildFileIndex } from '../../core/audio/pathMatch'
import { type AudioSource, MAX_INDEXED_FILES } from './source'

/**
 * The `<input type="file" webkitdirectory>` backend — everything that is not
 * Chromium. The browser hands over a flat File[] whose webkitRelativePath is
 * relative to the picked folder, which is exactly the shape the suffix matcher
 * wants. Nothing here survives a reload, so the user re-picks once a session.
 */
export function openPickerSource(files: readonly File[]): AudioSource {
  const audio = files.filter((file) => isAudioFileName(file.name)).slice(0, MAX_INDEXED_FILES)
  const rootName = audio[0]?.webkitRelativePath.split('/')[0] ?? 'your music folder'
  const entries = audio.map((file) => ({
    // A browser that gives no relative path still gives a name; a one-segment
    // path matches on basename alone, which is the common case anyway.
    path: file.webkitRelativePath === '' ? [file.name] : file.webkitRelativePath.split('/'),
    handle: file,
  }))
  return {
    kind: 'picker',
    rootName,
    index: buildFileIndex(entries),
    fileFor: (file) => (file instanceof File ? Promise.resolve(file) : file.getFile()),
    ensurePermission: () => Promise.resolve(true),
  }
}
