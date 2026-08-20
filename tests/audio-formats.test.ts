import { describe, expect, test } from 'vitest'
import {
  extensionOf,
  formatVerdict,
  isAudioFileName,
  type CanPlayProbe,
} from '../src/core/audio/formats'

/** Chrome: no AIFF at all, AAC in mp4 but not ALAC, Vorbis+Opus in ogg. */
const chrome: CanPlayProbe = (mime) =>
  /^audio\/(mpeg|wav|flac|ogg)/.test(mime) || mime === 'audio/mp4; codecs="mp4a.40.2"'

/** Safari: AIFF and ALAC yes, ogg no. */
const safari: CanPlayProbe = (mime) =>
  /^audio\/(mpeg|wav|x-aiff|aiff)/.test(mime) || mime.startsWith('audio/mp4')

describe('extensionOf', () => {
  test('returns the lowercased extension', () => {
    expect(extensionOf('Track.MP3')).toBe('mp3')
  })

  test('uses only the final dot in a dotted name', () => {
    expect(extensionOf('Artist - Title (feat. Someone).flac')).toBe('flac')
  })

  test('returns null when there is no extension', () => {
    expect(extensionOf('README')).toBe(null)
  })

  test('returns null for a dotfile with no extension', () => {
    expect(extensionOf('.DS_Store')).toBe(null)
  })
})

describe('isAudioFileName', () => {
  test('accepts every extension the importer accepts', () => {
    for (const name of ['a.mp3', 'a.wav', 'a.flac', 'a.aif', 'a.aiff', 'a.m4a', 'a.ogg']) {
      expect(isAudioFileName(name)).toBe(true)
    }
  })

  test('is case-insensitive', () => {
    expect(isAudioFileName('A.AIFF')).toBe(true)
  })

  test('rejects the sidecars a Rekordbox folder is full of', () => {
    for (const name of ['a.asd', 'cover.jpg', 'notes.txt', 'a.mp3.bak']) {
      expect(isAudioFileName(name)).toBe(false)
    }
  })
})

describe('formatVerdict', () => {
  test('mp3 is supported everywhere', () => {
    expect(formatVerdict('mp3', chrome)).toBe('supported')
    expect(formatVerdict('mp3', safari)).toBe('supported')
  })

  test('aiff is unsupported in Chrome and supported in Safari', () => {
    expect(formatVerdict('aiff', chrome)).toBe('unsupported')
    expect(formatVerdict('aif', chrome)).toBe('unsupported')
    expect(formatVerdict('aiff', safari)).toBe('supported')
  })

  test('m4a is unknown in Chrome — the container hides AAC vs ALAC', () => {
    expect(formatVerdict('m4a', chrome)).toBe('unknown')
  })

  test('m4a is supported in Safari, which plays both codecs', () => {
    expect(formatVerdict('m4a', safari)).toBe('supported')
  })

  test('ogg is unsupported in Safari, which plays neither codec', () => {
    expect(formatVerdict('ogg', safari)).toBe('unsupported')
  })

  test('an unrecognised extension is unsupported', () => {
    expect(formatVerdict('wma', chrome)).toBe('unsupported')
  })

  test('a missing extension is unsupported', () => {
    expect(formatVerdict(null, chrome)).toBe('unsupported')
  })
})
