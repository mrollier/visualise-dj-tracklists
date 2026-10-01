/**
 * Builds AIFF files in memory for the converter's tests and the browser probe.
 * Samples are signed integers at the given bit depth, interleaved by channel,
 * written big-endian as AIFF stores them.
 */
export interface AiffFixture {
  channels?: number
  bits?: number
  rate?: number
  samples: number[]
  /** Bytes of padding the SSND chunk declares before the audio starts. */
  ssndOffset?: number
  /** A whole chunk (use `aiffChunk`) placed between COMM and SSND. */
  extra?: Uint8Array
  form?: string
  /** The frame count COMM claims; defaults to the real one. */
  frames?: number
}

const ascii = (text: string) => new TextEncoder().encode(text)

/** An IFF chunk: id, big-endian size, body, and a pad byte after an odd body. */
export function aiffChunk(id: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + body.length + (body.length % 2))
  out.set(ascii(id), 0)
  new DataView(out.buffer).setUint32(4, body.length)
  out.set(body, 8)
  return out
}

/** A sample rate as the 80-bit extended float COMM stores. Integer rates only. */
function extended80(rate: number): Uint8Array {
  const out = new Uint8Array(10)
  const view = new DataView(out.buffer)
  const exponent = Math.floor(Math.log2(rate))
  view.setUint16(0, exponent + 16383)
  view.setBigUint64(2, BigInt(rate) << BigInt(63 - exponent))
  return out
}

export function aiffBytes(opts: AiffFixture): ArrayBuffer {
  const { channels = 2, bits = 16, rate = 44100, samples, ssndOffset = 0, form = 'AIFF' } = opts
  const width = bits / 8
  const comm = new Uint8Array(18)
  const commView = new DataView(comm.buffer)
  commView.setInt16(0, channels)
  commView.setUint32(2, opts.frames ?? samples.length / channels)
  commView.setInt16(6, bits)
  comm.set(extended80(rate), 8)

  const ssnd = new Uint8Array(8 + ssndOffset + samples.length * width)
  new DataView(ssnd.buffer).setUint32(0, ssndOffset)
  samples.forEach((sample, i) => {
    for (let b = 0; b < width; b += 1) {
      ssnd[8 + ssndOffset + i * width + b] = (sample >> (8 * (width - 1 - b))) & 0xff
    }
  })

  const chunks = [
    aiffChunk('COMM', comm),
    ...(opts.extra ? [opts.extra] : []),
    aiffChunk('SSND', ssnd),
  ]
  const formSize = 4 + chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(8 + formSize)
  out.set(ascii('FORM'), 0)
  new DataView(out.buffer).setUint32(4, formSize)
  out.set(ascii(form), 8)
  let at = 12
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out.buffer
}
