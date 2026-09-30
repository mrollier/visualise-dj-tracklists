import { ensureExtension } from '../core/exporters/filename'

/** One file type an export can be saved as. `blob` runs only once chosen. */
export interface SaveFormat {
  description: string
  mime: string
  /** With the dot: '.m3u8'. */
  ext: string
  blob: () => Blob | Promise<Blob>
}

/** Hand a blob to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  // Revoked on the next tick, not synchronously: Safari can cancel a download
  // whose URL is revoked in the same task as the click.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Save an export. Where the browser has a native save dialog (Chromium's
 * showSaveFilePicker) the user names the file and picks among `formats` —
 * the chosen extension decides which one is written. Elsewhere the first
 * format downloads under `baseName`. Cancelling is not an error.
 *
 * The picker is called before anything is awaited: it needs the click's user
 * activation, which an earlier await would spend.
 */
export async function saveFile(baseName: string, formats: readonly SaveFormat[]): Promise<void> {
  const [first] = formats
  const suggestedName = ensureExtension(baseName, first.ext)
  const host = globalThis as unknown as Window
  if (typeof host.showSaveFilePicker !== 'function') {
    downloadBlob(await first.blob(), suggestedName)
    return
  }
  let handle: FileSystemFileHandle
  try {
    handle = await host.showSaveFilePicker({
      suggestedName,
      types: formats.map((f) => ({ description: f.description, accept: { [f.mime]: [f.ext] } })),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    throw error
  }
  const name = handle.name.toLowerCase()
  const chosen = formats.find((f) => name.endsWith(f.ext.toLowerCase())) ?? first
  const writable = await handle.createWritable()
  await writable.write(await chosen.blob())
  await writable.close()
}
