/**
 * AIFF → WAV, for browsers that ship no AIFF decoder (Chrome, Firefox).
 *
 * Plain AIFF and WAV hold the same uncompressed PCM; AIFF stores each sample
 * big-endian and WAV little-endian. So the conversion is a new 44-byte header
 * plus a byte swap per sample, done in place on the bytes read from disk. The
 * Blob then holds its own copy, so a load briefly needs about twice the file's
 * size. Compressed AIFF-C and bit depths other than 16 and
 * 24 are refused (null), and the caller hands the file on untouched.
 */

const ascii = (view: DataView, at: number) =>
  String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  )

/** COMM's sample rate: an 80-bit IEEE extended float, big-endian. */
function extended80(view: DataView, at: number): number {
  const exponent = view.getUint16(at) & 0x7fff
  const mantissa = view.getUint32(at + 2) * 2 ** 32 + view.getUint32(at + 6)
  return Math.round(mantissa * 2 ** (exponent - 16383 - 63))
}

function wavHeader(channels: number, rate: number, bits: number, dataLength: number): ArrayBuffer {
  const header = new DataView(new ArrayBuffer(44))
  const blockAlign = (channels * bits) / 8
  const write = (at: number, text: string) => {
    for (let i = 0; i < 4; i += 1) header.setUint8(at + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  // An odd data chunk is followed by a pad byte, which the RIFF size counts.
  header.setUint32(4, 36 + dataLength + (dataLength % 2), true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true) // PCM
  header.setUint16(22, channels, true)
  header.setUint32(24, rate, true)
  header.setUint32(28, rate * blockAlign, true)
  header.setUint16(32, blockAlign, true)
  header.setUint16(34, bits, true)
  write(36, 'data')
  header.setUint32(40, dataLength, true)
  return header.buffer
}

/** Reverse each sample's bytes: 16-bit swaps a pair, 24-bit swaps the outer two. */
function swapBytes(audio: Uint8Array, width: number): void {
  for (let i = 0; i + width <= audio.length; i += width) {
    const first = audio[i]
    audio[i] = audio[i + width - 1]
    audio[i + width - 1] = first
  }
}

export function aiffToWav(bytes: ArrayBuffer): Blob | null {
  const view = new DataView(bytes)
  if (bytes.byteLength < 12 || ascii(view, 0) !== 'FORM' || ascii(view, 8) !== 'AIFF') return null
  let channels = 0
  let frames = 0
  let bits = 0
  let rate = 0
  let dataStart = -1
  let dataLength = 0
  for (let at = 12; at + 8 <= bytes.byteLength;) {
    const id = ascii(view, at)
    const size = view.getUint32(at + 4)
    const body = at + 8
    if (id === 'COMM' && body + 18 <= bytes.byteLength) {
      channels = view.getInt16(body)
      frames = view.getUint32(body + 2)
      bits = view.getInt16(body + 6)
      rate = extended80(view, body + 8)
    } else if (id === 'SSND' && body + 8 <= bytes.byteLength) {
      const offset = view.getUint32(body)
      dataStart = body + 8 + offset
      dataLength = size - 8 - offset
    }
    at = body + size + (size % 2)
  }
  if (channels < 1 || (bits !== 16 && bits !== 24) || rate <= 0 || dataStart < 0) return null
  const width = bits / 8
  const blockAlign = channels * width
  // The frame count, the chunk's size and the file's real end all bound the
  // audio; a file cut short plays what it has.
  const available = Math.min(frames * blockAlign, dataLength, bytes.byteLength - dataStart)
  const length = available - (available % blockAlign)
  if (length <= 0) return null
  const audio = new Uint8Array(bytes, dataStart, length)
  swapBytes(audio, width)
  const parts: BlobPart[] = [wavHeader(channels, rate, bits, length), audio]
  if (length % 2 === 1) parts.push(new Uint8Array(1))
  return new Blob(parts, { type: 'audio/wav' })
}
