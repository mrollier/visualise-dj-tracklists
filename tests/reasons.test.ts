import { describe, expect, test } from 'vitest'
import {
  type ReasonContext,
  reasonDetail,
  reasonLabel,
  type UnplayableReason,
} from '../src/core/audio/reasons'

const ALL: UnplayableReason[] = [
  'no-source',
  'needs-permission',
  'no-location',
  'not-found',
  'ambiguous',
  'unsupported',
  'decode-failed',
  'read-error',
]

const base: ReasonContext = { sampleLibrary: false, rootName: 'Music' }

describe('reasonLabel', () => {
  test('every reason has a short line, and none of them shouts', () => {
    for (const reason of ALL) {
      const label = reasonLabel(reason, base)
      expect(label.length).toBeGreaterThan(0)
      // The deck row is one line beside a seek bar; anything longer truncates.
      expect(label.length).toBeLessThanOrEqual(56)
      expect(label[0]).toBe(label[0].toLowerCase())
    }
  })

  test('names the format it cannot play', () => {
    expect(reasonLabel('unsupported', { ...base, extension: 'aiff' })).toBe(
      'this browser can’t play AIFF',
    )
  })

  test('falls back when the file has no extension to name', () => {
    expect(reasonLabel('unsupported', base)).toBe('this browser can’t play this format')
  })

  test('names the folder it looked in', () => {
    expect(reasonLabel('not-found', base)).toBe('file not found in “Music”')
    expect(reasonLabel('not-found', { ...base, rootName: null })).toBe(
      'file not found in “your music folder”',
    )
  })

  test('a decode failure is not the same line as an unsupported format', () => {
    expect(reasonLabel('decode-failed', base)).not.toBe(reasonLabel('unsupported', base))
  })

  test('blames the demo collection rather than the folder', () => {
    expect(reasonLabel('no-location', { ...base, sampleLibrary: true })).toBe(
      'demo collection has no audio',
    )
    expect(reasonLabel('no-location', base)).toBe('no file path in the library')
  })

  test('counts the files that share a name', () => {
    expect(reasonLabel('ambiguous', { ...base, ambiguousCount: 4 })).toContain('4 files')
  })

  test('no two reasons produce the same line', () => {
    // Moved here from audio-coverage.test.ts in v29, along with the rest of
    // the copy checks — the wording lives in reasons.ts, so its tests do too.
    const labels = ALL.map((reason) => reasonLabel(reason, base))
    expect(new Set(labels).size).toBe(ALL.length)
  })
})

describe('reasonDetail', () => {
  test('every reason explains itself in a sentence or more', () => {
    for (const reason of ALL) {
      const detail = reasonDetail(reason, base)
      expect(detail.length).toBeGreaterThan(60)
      expect(detail).not.toBe(reasonLabel(reason, base))
    }
  })

  test('an unsupported AIFF says which browsers decode it and what to do', () => {
    const detail = reasonDetail('unsupported', { ...base, extension: 'aiff' })
    expect(detail).toContain('AIFF')
    expect(detail).toContain('Safari')
    expect(detail).toContain('FLAC')
  })

  test('an unsupported m4a points at ALAC, since the extension hides the codec', () => {
    expect(reasonDetail('unsupported', { ...base, extension: 'm4a' })).toContain('ALAC')
  })

  test('says whether the browser guessed or actually tried', () => {
    const guessed = reasonDetail('unsupported', { ...base, extension: 'aiff' })
    const tried = reasonDetail('unsupported', { ...base, extension: 'aiff', raised: true })
    expect(guessed).toContain('not even tried')
    expect(tried).toContain('refused it')
  })

  test('an unknown extension is described rather than blamed on the format', () => {
    expect(reasonDetail('unsupported', { ...base, extension: 'xyz' })).toContain('.xyz')
  })

  test('a missing file suggests linking a parent folder', () => {
    expect(reasonDetail('not-found', base)).toContain('parent folder')
  })

  test('an ambiguous match explains why guessing is worse than refusing', () => {
    const detail = reasonDetail('ambiguous', { ...base, ambiguousCount: 3 })
    expect(detail).toContain('3 files')
    expect(detail).toContain('refuses to guess')
  })

  test('the demo collection gets its own explanation', () => {
    expect(reasonDetail('no-location', { ...base, sampleLibrary: true })).toContain('generated')
    expect(reasonDetail('no-location', base)).toContain('imported without a file path')
  })

  test('every detail that mentions the folder uses its real name', () => {
    for (const reason of ALL) {
      const detail = reasonDetail(reason, base)
      expect(detail).not.toContain('“your music folder”')
    }
  })
})
