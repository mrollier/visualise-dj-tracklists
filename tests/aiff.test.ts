import { describe, expect, test } from 'vitest'
import { aiffToWav } from '../src/core/audio/aiff'
import { aiffBytes, aiffChunk } from './aiffFixture'

async function wavOf(blob: Blob | null) {
  expect(blob).not.toBeNull()
  const bytes = await blob!.arrayBuffer()
  const view = new DataView(bytes)
  const text = (at: number) => String.fromCharCode(...new Uint8Array(bytes, at, 4))
  return { blob: blob!, bytes, view, text }
}

/** A little-endian signed 24-bit sample. */
const int24 = (view: DataView, at: number) =>
  ((view.getUint8(at) | (view.getUint8(at + 1) << 8) | (view.getUint8(at + 2) << 16)) << 8) >> 8

describe('aiffToWav', () => {
  test('16-bit stereo becomes PCM WAV with the same samples, little-endian', async () => {
    const samples = [1, -1, 32767, -32768, 258, -258]
    const { blob, view, text } = await wavOf(aiffToWav(aiffBytes({ samples })))
    expect(blob.type).toBe('audio/wav')
    expect(text(0)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + 12)
    expect(text(8)).toBe('WAVE')
    expect(text(12)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(2)
    expect(view.getUint32(24, true)).toBe(44100)
    expect(view.getUint32(28, true)).toBe(44100 * 4)
    expect(view.getUint16(32, true)).toBe(4)
    expect(view.getUint16(34, true)).toBe(16)
    expect(text(36)).toBe('data')
    expect(view.getUint32(40, true)).toBe(12)
    expect(samples.map((_, i) => view.getInt16(44 + i * 2, true))).toEqual(samples)
  })

  test('24-bit mono with an odd data length gets a pad byte', async () => {
    const samples = [1, -1, 8388607]
    const { bytes, view } = await wavOf(
      aiffToWav(aiffBytes({ channels: 1, bits: 24, rate: 48000, samples })),
    )
    expect(view.getUint32(24, true)).toBe(48000)
    expect(view.getUint16(32, true)).toBe(3)
    expect(view.getUint16(34, true)).toBe(24)
    expect(view.getUint32(40, true)).toBe(9)
    expect(view.getUint32(4, true)).toBe(36 + 9 + 1)
    expect(bytes.byteLength).toBe(44 + 10)
    expect([0, 1, 2].map((i) => int24(view, 44 + i * 3))).toEqual(samples)
  })

  test('reads the 80-bit sample rate for 44.1, 48 and 96 kHz', async () => {
    for (const rate of [44100, 48000, 96000]) {
      const { view } = await wavOf(aiffToWav(aiffBytes({ rate, samples: [0, 0] })))
      expect(view.getUint32(24, true)).toBe(rate)
    }
  })

  test('skips other chunks, including an odd-sized one, to find SSND', async () => {
    const extra = aiffChunk('NAME', new TextEncoder().encode('abc'))
    const { view } = await wavOf(aiffToWav(aiffBytes({ samples: [5, 6], extra })))
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([5, 6])
  })

  test('honours the SSND offset before the audio', async () => {
    const { view } = await wavOf(aiffToWav(aiffBytes({ samples: [7, 8], ssndOffset: 4 })))
    expect(view.getUint32(40, true)).toBe(4)
    expect([view.getInt16(44, true), view.getInt16(46, true)]).toEqual([7, 8])
  })

  test('audio that stops early converts the frames that are there', async () => {
    const { view } = await wavOf(aiffToWav(aiffBytes({ samples: [1, 2, 3, 4], frames: 10 })))
    expect(view.getUint32(40, true)).toBe(8)
  })

  test('refuses what it cannot convert', () => {
    expect(aiffToWav(aiffBytes({ samples: [0, 0], form: 'AIFC' }))).toBeNull()
    expect(aiffToWav(aiffBytes({ samples: [0, 0], bits: 8 }))).toBeNull()
    expect(aiffToWav(new TextEncoder().encode('RIFF....WAVEfmt ').buffer)).toBeNull()
    expect(aiffToWav(aiffBytes({ samples: [0, 0] }).slice(0, 20))).toBeNull()
    const commOnly = aiffBytes({ samples: [] }).slice(0, 12 + 8 + 18)
    expect(aiffToWav(commOnly)).toBeNull()
  })
})
