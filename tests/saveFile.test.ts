import { afterEach, describe, expect, test, vi } from 'vitest'
import { saveFile, type SaveFormat } from '../src/lib/saveFile'

const text = (ext: string, body: string): SaveFormat => ({
  description: ext,
  mime: 'text/plain',
  ext,
  blob: () => new Blob([body], { type: 'text/plain' }),
})

/** A fake save picker that "chooses" `name`, recording what gets written. */
function stubPicker(name: string | Error) {
  const written: string[] = []
  const options: unknown[] = []
  vi.stubGlobal('showSaveFilePicker', (opts: unknown) => {
    options.push(opts)
    if (name instanceof Error) return Promise.reject(name)
    return Promise.resolve({
      name,
      createWritable: () =>
        Promise.resolve({
          write: async (blob: Blob) => void written.push(await blob.text()),
          close: () => Promise.resolve(),
        }),
    })
  })
  return { written, options }
}

/** A fake DOM for the download fallback, recording the anchor it clicks. */
function stubDownload() {
  const clicked: { download: string; href: string }[] = []
  vi.stubGlobal('document', {
    createElement: () => {
      const anchor = {
        href: '',
        download: '',
        click: () => clicked.push({ download: anchor.download, href: anchor.href }),
        remove() {},
      }
      return anchor
    },
    body: { append() {} },
  })
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL() {} })
  return clicked
}

afterEach(() => vi.unstubAllGlobals())

describe('saveFile', () => {
  test('the native picker suggests the name with the first format’s extension', async () => {
    const { options, written } = stubPicker('Friday.m3u8')
    await saveFile('Friday', [text('.m3u8', 'playlist')])
    expect(options[0]).toMatchObject({ suggestedName: 'Friday.m3u8' })
    expect(written).toEqual(['playlist'])
  })

  test('the extension the user picks decides which format is written', async () => {
    const { written } = stubPicker('poster.svg')
    await saveFile('poster', [text('.png', 'png bytes'), text('.svg', '<svg/>')])
    expect(written).toEqual(['<svg/>'])
  })

  test('cancelling the picker writes nothing and throws nothing', async () => {
    const { written } = stubPicker(new DOMException('cancelled', 'AbortError'))
    await expect(saveFile('x', [text('.csv', 'a')])).resolves.toBeUndefined()
    expect(written).toEqual([])
  })

  test('without a picker the first format downloads under the suggested name', async () => {
    const clicked = stubDownload()
    await saveFile('Friday', [text('.csv', 'a'), text('.txt', 'b')])
    expect(clicked).toEqual([{ download: 'Friday.csv', href: 'blob:x' }])
  })
})
